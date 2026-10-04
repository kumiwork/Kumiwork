import { afterEach, describe, expect, it } from "vitest";
import { defineExtensionPoint } from "@agentfactory/plugin-api";
import { getContributions, initPlugins } from "../runtime";

const somePoint = defineExtensionPoint<string>("test.some-point");

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("agentfactory.plugin-runtime")];
});

describe("plugin runtime", () => {
  it("loads the default empty plugin list once per process", async () => {
    const first = initPlugins("web");
    expect(initPlugins("web")).toBe(first);
    expect((await first).loadedPluginIds).toEqual([]);
  });

  it("refuses to initialize a second surface in the same process", () => {
    void initPlugins("web");
    expect(() => initPlugins("worker")).toThrow(/already initialized for surface "web"/);
  });

  it("returns contributions once initialized", async () => {
    void initPlugins("worker");
    await expect(getContributions(somePoint)).resolves.toEqual([]);
  });

  it("fails loudly when read before initialization", async () => {
    await expect(getContributions(somePoint)).rejects.toThrow(/not initialized/);
  });
});
