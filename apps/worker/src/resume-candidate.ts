import { runtimeForModel, type RuntimeKind } from "@kumiwork/core";
import type { ResumeCandidate } from "@kumiwork/db";

export function resumableSessionRef(
  candidate: ResumeCandidate | undefined,
  current: { sandboxId: string; runtimeKind: RuntimeKind },
): string | undefined {
  if (!candidate?.model) return undefined;
  if (candidate.sandboxId !== current.sandboxId) return undefined;
  if (runtimeForModel(candidate.model) !== current.runtimeKind) return undefined;
  return candidate.providerSessionRef;
}
