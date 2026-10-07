import { createLogger } from "@kumiwork/logger";

const log = createLogger("run-timeout");

const DEFAULT_RUN_TURN_TIMEOUT_MS = 30 * 60 * 1000;

export function runTurnTimeoutMs(): number {
  const configured = Number(process.env.RUN_TURN_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RUN_TURN_TIMEOUT_MS;
}

export class RunTurnTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The agent turn exceeded the ${Math.round(timeoutMs / 60_000)} minutes limit and was stopped.`);
    this.name = "RunTurnTimeoutError";
  }
}

export async function withRunTurnTimeout<T>(
  timeoutMs: number,
  interrupt: () => Promise<void>,
  work: () => Promise<T>,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void interrupt().catch((err: unknown) => {
        log.error("Could not interrupt a timed-out agent turn", { err });
      });
      reject(new RunTurnTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
