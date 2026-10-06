import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunTurnTimeoutError, runTurnTimeoutMs, withRunTurnTimeout } from "../run-timeout";

const TIMEOUT_MS = 30 * 60 * 1000;

function hangingWork(): () => Promise<string> {
  return () => new Promise<string>(() => {});
}

describe("withRunTurnTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the result of work that finishes before the limit", async () => {
    const interrupt = vi.fn().mockResolvedValue(undefined);

    const result = await withRunTurnTimeout(TIMEOUT_MS, interrupt, async () => "done");

    expect(result).toBe("done");
    expect(interrupt).not.toHaveBeenCalled();
  });

  it("rejects with RunTurnTimeoutError and interrupts when work outlives the limit", async () => {
    const interrupt = vi.fn().mockResolvedValue(undefined);

    const outcome = withRunTurnTimeout(TIMEOUT_MS, interrupt, hangingWork());
    const assertion = expect(outcome).rejects.toBeInstanceOf(RunTurnTimeoutError);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    await assertion;
    expect(interrupt).toHaveBeenCalledTimes(1);
  });

  it("states the limit in minutes in the error message", async () => {
    const outcome = withRunTurnTimeout(TIMEOUT_MS, async () => {}, hangingWork());
    const assertion = expect(outcome).rejects.toThrow("30 minutes");
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    await assertion;
  });

  it("still rejects when interrupt itself throws", async () => {
    const interrupt = vi.fn().mockRejectedValue(new Error("docker unreachable"));

    const outcome = withRunTurnTimeout(TIMEOUT_MS, interrupt, hangingWork());
    const assertion = expect(outcome).rejects.toBeInstanceOf(RunTurnTimeoutError);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    await assertion;
  });

  it("still rejects when interrupt never settles", async () => {
    const interrupt = vi.fn(() => new Promise<void>(() => {}));

    const outcome = withRunTurnTimeout(TIMEOUT_MS, interrupt, hangingWork());
    const assertion = expect(outcome).rejects.toBeInstanceOf(RunTurnTimeoutError);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    await assertion;
  });

  it("passes through the error of work that fails before the limit, without interrupting", async () => {
    const interrupt = vi.fn().mockResolvedValue(undefined);
    const failure = new Error("agent crashed");

    await expect(
      withRunTurnTimeout(TIMEOUT_MS, interrupt, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 2);

    expect(interrupt).not.toHaveBeenCalled();
  });

  it("stops the timer once work has finished", async () => {
    const interrupt = vi.fn().mockResolvedValue(undefined);

    await withRunTurnTimeout(TIMEOUT_MS, interrupt, async () => "done");
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 2);

    expect(interrupt).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not time out work that is still within the limit", async () => {
    const interrupt = vi.fn().mockResolvedValue(undefined);
    let finish!: (value: string) => void;
    const outcome = withRunTurnTimeout(
      TIMEOUT_MS,
      interrupt,
      () => new Promise<string>((resolve) => (finish = resolve)),
    );

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    finish("late but in time");

    await expect(outcome).resolves.toBe("late but in time");
    expect(interrupt).not.toHaveBeenCalled();
  });
});

describe("runTurnTimeoutMs", () => {
  afterEach(() => {
    delete process.env.RUN_TURN_TIMEOUT_MS;
  });

  it("defaults to 30 minutes", () => {
    delete process.env.RUN_TURN_TIMEOUT_MS;

    expect(runTurnTimeoutMs()).toBe(30 * 60 * 1000);
  });

  it("reads the limit from RUN_TURN_TIMEOUT_MS", () => {
    process.env.RUN_TURN_TIMEOUT_MS = "90000";

    expect(runTurnTimeoutMs()).toBe(90_000);
  });

  it.each(["", "abc", "0", "-5"])("falls back to the default for the unusable value %j", (value) => {
    process.env.RUN_TURN_TIMEOUT_MS = value;

    expect(runTurnTimeoutMs()).toBe(30 * 60 * 1000);
  });
});
