import { enqueueRepoMapWarmJob } from "@kumiwork/queue";
import { getRepoMap, insertRepoMap } from "@kumiwork/db";
import { createLogger } from "@kumiwork/logger";
import type { SandboxProvider } from "./sandbox/types";
import { cloneIntoSandbox, resolveCloneTarget, resolveDefaultBranchSha } from "./scm-provider";
import { resolveSandboxImage } from "./sandbox-image-select";
import { issueSandboxModelCredential } from "./sandbox-model-access";
import { getDefaultAgentRuntime } from "./agent-runtime/registry";
import type { RepoMapResult } from "./agent-runtime/types";
import { isRepoMapFileCreationSummary } from "./repo-map-validate";
import { describeError, recordJobOutcome, type JobOutcomeFields } from "./job-outcome";

const log = createLogger("repo-map");

const MAX_CONTENT_LENGTH = 16384;
// How long a cache miss waits for a warm job to land before giving up and running without a map.
//
// This is a partial, best-effort mitigation, not a fix for the race it was originally written
// for. Generation is measured at 33-38s even on an 884KB repo — about as small as they get — so
// a run with no head start (created and started back-to-back) will not catch a fresh generation
// inside this window. On task T-070 the 17-second head start from warming at task creation plus
// this poll happened to land inside the 33-38s range, but that is a coincidence of that specific
// gap, not a general guarantee.
//
// The actual fix — an explicit wait-or-proceed choice surfaced at the moment a codebase is set,
// so the user decides instead of a guessed constant. Once that ships for both places a codebase
// can be set (task creation and the task edit page), this poll will be removed in the same
// change, since there is no other path left for it to cover. Until then it stays as a
// strictly-better-than-nothing chance of catching a warm that was already substantially underway
// from an earlier trigger.
export const CACHE_POLL_TIMEOUT_MS = 20_000;
export const CACHE_POLL_INTERVAL_MS = 1_000;
// Design spec's "its own short wall-clock cap (e.g. 2 minutes), independent of the triggering
// run's budget" — a hung generation must not stall or fail the user's actual task.
const GENERATION_TIMEOUT_MS = 2 * 60 * 1000;
const GENERATION_CREDENTIAL_MARGIN_MS = 30 * 1000;

async function execToString(sandboxProvider: SandboxProvider, sandboxId: string, cmd: string[]): Promise<string> {
  let stdout = "";
  for await (const chunk of sandboxProvider.exec(sandboxId, cmd)) {
    if (chunk.stream === "stdout") stdout += chunk.data;
  }
  return stdout;
}

async function getSandboxHeadSha(sandboxProvider: SandboxProvider, sandboxId: string): Promise<string> {
  const stdout = await execToString(sandboxProvider, sandboxId, ["git", "-C", "/workspace", "rev-parse", "HEAD"]);
  return stdout.trim();
}

// Runs the one-shot generation turn (apps/worker/sandbox-image/generate-repo-map.ts) in the
// sandbox that already has the repo checked out. Returns undefined on any failure — caller
// treats that identically to "no map available", never throws further up.
interface GenerationAttempt {
  result?: RepoMapResult;
  error?: string;
}

async function generateRepoMap(
  sandboxProvider: SandboxProvider,
  sandboxId: string,
  orgId: number,
): Promise<GenerationAttempt> {
  const generator = getDefaultAgentRuntime().repoMap;
  if (!generator) return { error: "No repo map generator registered for the default runtime" };
  const credential = issueSandboxModelCredential(
    { orgId, purpose: "repo-map", provider: generator.model.family },
    undefined,
    GENERATION_TIMEOUT_MS + GENERATION_CREDENTIAL_MARGIN_MS,
  );
  try {
    const result = await Promise.race([
      generator.generate({ sandboxProvider, sandboxId, modelEndpoint: credential.endpoint }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Repo map generation timed out")), GENERATION_TIMEOUT_MS),
      ),
    ]);
    return { result };
  } catch (err) {
    log.error("Repo map generation failed", { err });
    return { error: describeError(err) };
  } finally {
    credential.revoke();
  }
}

async function generateValidatedRepoMap(
  sandboxProvider: SandboxProvider,
  sandboxId: string,
  orgId: number,
  repoFullName: string,
): Promise<GenerationAttempt> {
  const first = await generateRepoMap(sandboxProvider, sandboxId, orgId);
  if (!first.result || !isRepoMapFileCreationSummary(first.result.text)) return first;

  log.warn("Repo map generation returned a file-creation summary instead of a map; retrying once", {
    repoFullName,
  });
  const retry = await generateRepoMap(sandboxProvider, sandboxId, orgId);
  if (!retry.result || !isRepoMapFileCreationSummary(retry.result.text)) return retry;

  log.warn("Repo map generation returned a file-creation summary again after retry; caching nothing", {
    repoFullName,
  });
  return { error: "Generation returned a file-creation summary twice; nothing cached" };
}

// Run-time path: called from the run pipeline right after clone, with a sandbox that already
// has the target repo checked out. Cache key is the exact commit sha being worked on — that
// (not repoFullName alone, not a merge-base) is the invalidation mechanism.
//
// Deliberately NON-BLOCKING on a cache miss. Generation is itself a full agent turn against a
// second model, measured at 33-38s on an 884KB repo, and it used to sit directly on the critical
// path between the user sending a message and the agent's first token: it was ~35s of run 32's
// 101s total. Because the cache key is an exact sha, an actively developed repo misses on the
// first run after every single commit, so that cost was being paid over and over rather than
// once. A miss now schedules generation on the repo-map-warm queue (a throwaway sandbox, off this
// run's critical path) and returns "" — the run proceeds with no map, exactly as it already did
// whenever generation failed. Later runs against the same commit, including the next turn of this
// same session, get the cached map for free.
//
// Never throws: any failure here falls back to "" (no map), and the run proceeds exactly as it
// did before this feature existed.
export async function ensureRepoMap(
  sandboxProvider: SandboxProvider,
  sandboxId: string,
  orgId: number,
  repoFullName: string,
  deps?: { sleep?: (ms: number) => Promise<void> },
): Promise<string> {
  try {
    const sha = await getSandboxHeadSha(sandboxProvider, sandboxId);
    const cached = await getRepoMap(orgId, repoFullName, sha);
    // The overwhelmingly common path, and it must stay free: a run that already has a map pays
    // nothing for the poll below.
    if (cached) return cached.content;

    // Best-effort, and awaited only for the Redis round trip (single-digit ms) — never for the
    // generation itself. A failure to even enqueue must not fail the run that triggered it, and
    // must not skip the poll either: the map may already be in flight from an earlier warm (task
    // creation, a task marked done, an agent or team pointed at this codebase), which is exactly
    // the case the poll exists to catch.
    await enqueueRepoMapWarmJob(orgId, repoFullName).catch((err: unknown) => {
      log.error("Failed to schedule repo map generation", { repoFullName, err });
    });

    // Counted attempts rather than a wall-clock deadline: the loop is then deterministic, and a
    // test can inject an instant sleep without the loop spinning until 20 real seconds elapse.
    const sleep = deps?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const attempts = Math.floor(CACHE_POLL_TIMEOUT_MS / CACHE_POLL_INTERVAL_MS);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await sleep(CACHE_POLL_INTERVAL_MS);
      const warmed = await getRepoMap(orgId, repoFullName, sha);
      if (warmed) {
        log.info("Repo map landed while polling", { repoFullName, sha, pollMs: attempt * CACHE_POLL_INTERVAL_MS });
        return warmed.content;
      }
    }
    log.info("Repo map did not land within poll timeout; running without it", { repoFullName, sha, timeoutMs: CACHE_POLL_TIMEOUT_MS });
    return "";
  } catch (err) {
    log.error("Repo map operation failed", { err });
    return "";
  }
}

// Generates and caches the map for whatever commit is checked out in `sandboxId`, blocking until
// it finishes. Only the pre-warm path calls this — it runs on its own queue in its own throwaway
// sandbox, where wall-clock time costs nobody anything. Reports what happened rather than
// throwing, so the pre-warm job can record why a map did or did not land.
async function generateAndCacheRepoMap(
  sandboxProvider: SandboxProvider,
  sandboxId: string,
  orgId: number,
  repoFullName: string,
): Promise<WarmOutcome> {
  try {
    const sha = await getSandboxHeadSha(sandboxProvider, sandboxId);
    const cached = await getRepoMap(orgId, repoFullName, sha);
    if (cached) return { status: "skipped", reason: "already_cached", details: { sha } };

    const generated = await generateValidatedRepoMap(sandboxProvider, sandboxId, orgId, repoFullName);
    if (!generated.result) {
      return { status: "failed", reason: "generation_failed", error: generated.error, details: { sha } };
    }

    // Truncate once and store the same value — insertRepoMap enforces this cap independently
    // (defense-in-depth CHECK constraint), and the recorded length must match what got cached.
    const content = generated.result.text.slice(0, MAX_CONTENT_LENGTH);
    await insertRepoMap({
      orgId,
      repoFullName,
      commitSha: sha,
      content,
      generationCostUsd: generated.result.costUsd,
      generationTokens: generated.result.tokens,
    });
    return {
      status: "completed",
      reason: "generated",
      details: { sha, chars: content.length, tokens: generated.result.tokens, costUsd: generated.result.costUsd },
    };
  } catch (err) {
    log.error("Repo map generation failed", { err });
    return { status: "failed", reason: "generation_failed", error: describeError(err) };
  }
}

type WarmOutcome = Pick<JobOutcomeFields, "status" | "reason" | "error" | "details">;

// Pre-warm path: called when an agent's or team's defaultCodebase is set (apps/web's agent/team
// routes enqueue this via @kumiwork/queue's repo-map-warm queue). Resolves the default
// branch's current sha via the GitHub API alone first — no sandbox needed at all when that
// commit is already cached. On a miss, provisions a throwaway sandbox solely for this job and
// always tears it down, even when clone or generation fails partway through, so a failure here
// never leaks a container. Best-effort like ensureRepoMap: never throws, since a failed warm job
// just means the first real run pays the generation cost, exactly as if this feature didn't run.
export async function warmRepoMap(
  sandboxProvider: SandboxProvider,
  orgId: number,
  repoFullName: string,
): Promise<void> {
  const startedAt = Date.now();
  let outcome: WarmOutcome;
  try {
    outcome = await runRepoMapWarm(sandboxProvider, orgId, repoFullName);
  } catch (err) {
    log.error("Repo map pre-warm failed", { repoFullName, err });
    outcome = { status: "failed", reason: "exception", error: describeError(err) };
  }
  log.info("Repo map pre-warm finished", { repoFullName, ...outcome });
  await recordJobOutcome(startedAt, { orgId, jobType: "repo_map_warm", subject: repoFullName, ...outcome });
}

async function runRepoMapWarm(
  sandboxProvider: SandboxProvider,
  orgId: number,
  repoFullName: string,
): Promise<WarmOutcome> {
  const sha = await resolveDefaultBranchSha(orgId, repoFullName);
  if (!sha) return { status: "skipped", reason: "no_default_branch_sha" };
  if (await getRepoMap(orgId, repoFullName, sha)) return { status: "skipped", reason: "already_cached", details: { sha } };

  // Branch name only needs to be syntactically valid and not collide with whatever branch git
  // already checked out — cloneIntoSandbox runs `git checkout -b "$BRANCH_NAME"` on a fresh
  // clone, which fails if the default branch is also literally "main". This sandbox and its
  // local branch are both discarded when the container is torn down below.
  const workspace = await resolveCloneTarget(orgId, repoFullName, `repo-map-warm-${Date.now()}`);
  if (!workspace) return { status: "skipped", reason: "no_clone_target", details: { sha } };

  const image = await resolveSandboxImage(orgId, repoFullName);
  const sandbox = await sandboxProvider.create({ image, env: {} });
  try {
    await cloneIntoSandbox(sandboxProvider, sandbox.id, workspace);
    return await generateAndCacheRepoMap(sandboxProvider, sandbox.id, orgId, repoFullName);
  } finally {
    await sandboxProvider.destroy(sandbox.id).catch((err) => {
      log.error("Failed to tear down warm sandbox", { sandboxId: sandbox.id, repoFullName, err });
    });
  }
}
