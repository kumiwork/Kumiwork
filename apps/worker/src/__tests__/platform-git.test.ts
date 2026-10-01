import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  platformGitEnv,
  refuseUnsafeGitConfig,
  retryOnRepoNotFound,
  unsafeGitConfigError,
  unsafeGitConfigKeys,
} from "../platform-git";

let repo: string;

function sh(script: string, env: Record<string, string> = {}): string {
  return execFileSync("sh", ["-c", script], {
    cwd: repo,
    env: { PATH: process.env.PATH ?? "", HOME: repo, ...env },
    encoding: "utf8",
  });
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "platform-git-"));
  sh("git init -q . && git -c user.email=a@b -c user.name=a commit -q --allow-empty -m init");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("platformGitEnv", () => {
  it("stops a repo-installed hook from running during a platform commit", () => {
    const marker = path.join(repo, "hook-ran");
    mkdirSync(path.join(repo, ".husky"));
    writeFileSync(path.join(repo, ".husky", "pre-commit"), `#!/bin/sh\ntouch "${marker}"\n`);
    chmodSync(path.join(repo, ".husky", "pre-commit"), 0o755);
    sh("git config core.hooksPath .husky");

    sh("git -c user.email=a@b -c user.name=a commit -q --allow-empty -m platform", platformGitEnv());

    expect(existsSync(marker)).toBe(false);
  });

  it("really does run that hook without the platform env, proving the test exercises it", () => {
    const marker = path.join(repo, "hook-ran");
    mkdirSync(path.join(repo, ".husky"));
    writeFileSync(path.join(repo, ".husky", "pre-commit"), `#!/bin/sh\ntouch "${marker}"\n`);
    chmodSync(path.join(repo, ".husky", "pre-commit"), 0o755);
    sh("git config core.hooksPath .husky");

    sh("git -c user.email=a@b -c user.name=a commit -q --allow-empty -m plain");

    expect(existsSync(marker)).toBe(true);
  });
});

describe("refuseUnsafeGitConfig", () => {
  const check = () => sh(`${refuseUnsafeGitConfig(repo)}\necho SAFE`, platformGitEnv());

  it("passes a freshly cloned-style config", () => {
    expect(check()).toBe("SAFE\n");
  });

  it("passes husky's hooksPath, which the platform env overrides instead", () => {
    sh("git config core.hooksPath .husky");
    expect(check()).toBe("SAFE\n");
  });

  it.each([
    ["url.https://evil.example/.insteadOf", "https://github.com/", "url.https://evil.example/.insteadof"],
    ["http.https://github.com/.proxy", "http://evil.example:8080", "http.https://github.com/.proxy"],
    ["http.sslVerify", "false", "http.sslverify"],
    ["credential.helper", "!sh -c 'cat > /tmp/stolen'", "credential.helper"],
    ["include.path", "/tmp/more-config", "include.path"],
    ["filter.x.clean", "sh -c 'env > /tmp/env'", "filter.x.clean"],
    ["merge.x.driver", "sh -c id", "merge.x.driver"],
    ["diff.x.textconv", "sh -c id", "diff.x.textconv"],
    ["core.sshCommand", "sh -c id", "core.sshcommand"],
  ])("refuses %s before any token is used", (key, value, reported) => {
    sh(`git config ${JSON.stringify(key)} ${JSON.stringify(value)}`);

    const output = check();

    expect(output).not.toMatch(/^SAFE$/m);
    expect(unsafeGitConfigKeys(output)).toEqual([reported]);
  });
});

describe("unsafeGitConfigKeys", () => {
  it("returns undefined when nothing was refused", () => {
    expect(unsafeGitConfigKeys("SYNC_UP_TO_DATE\n")).toBeUndefined();
  });

  it("names the offending keys in the error", () => {
    expect(unsafeGitConfigError(["http.proxy"]).message).toContain("http.proxy");
  });
});

describe("retryOnRepoNotFound", () => {
  function runWithFakeGit(failures: { count: number; message: string }) {
    const dir = path.join(repo, "fake-git");
    mkdirSync(dir);
    const calls = path.join(dir, "calls");
    writeFileSync(calls, "");
    writeFileSync(
      path.join(dir, "git"),
      `#!/bin/sh
echo call >> "${calls}"
if [ "$(wc -l < "${calls}")" -le ${failures.count} ]; then
  echo "${failures.message}" >&2
  exit 128
fi
echo "git $*"
`,
    );
    chmodSync(path.join(dir, "git"), 0o755);
    const result = spawnSync("sh", ["-c", `${retryOnRepoNotFound}\nretry_on_repo_not_found git clone somewhere`], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, REPO_NOT_FOUND_RETRY_DELAYS: "0 0 0" },
    });
    return { ...result, attempts: readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).length };
  }

  it("retries until GitHub recognises a freshly minted token", () => {
    const result = runWithFakeGit({ count: 2, message: "remote: Repository not found." });
    expect(result.status).toBe(0);
    expect(result.attempts).toBe(3);
    expect(result.stdout).toContain("git clone somewhere");
  });

  it("gives up after the last delay and surfaces git's error", () => {
    const result = runWithFakeGit({ count: 99, message: "remote: Repository not found." });
    expect(result.status).toBe(128);
    expect(result.attempts).toBe(4);
    expect(result.stderr).toContain("Repository not found");
  });

  it("does not retry any other git failure", () => {
    const result = runWithFakeGit({ count: 99, message: "fatal: couldn't find remote ref agent/new-branch" });
    expect(result.status).toBe(128);
    expect(result.attempts).toBe(1);
    expect(result.stderr).toContain("couldn't find remote ref");
  });
});
