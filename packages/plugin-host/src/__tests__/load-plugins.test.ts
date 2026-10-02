import { describe, expect, it, vi } from "vitest";
import {
  PLUGIN_API_VERSION,
  defineExtensionPoint,
  definePlugin,
  type KumiworkPlugin,
  type PluginLogger,
} from "@agentfactory/plugin-api";
import { loadPlugins, PluginLoadError, type PluginHostLogger } from "../load-plugins";

interface Greeter {
  greet(name: string): string;
}

const greeters = defineExtensionPoint<Greeter>("test.greeters");
const unknownPoint = defineExtensionPoint<string>("test.unknown");

function silentLogger(): PluginHostLogger {
  const logger: PluginLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { ...logger, child: vi.fn(() => logger) };
}

function greeterPlugin(id: string, overrides: Partial<KumiworkPlugin> = {}): KumiworkPlugin {
  return definePlugin({
    id,
    apiVersion: PLUGIN_API_VERSION,
    register(host) {
      host.contribute(greeters, { greet: (name) => `${id}:${name}` });
    },
    ...overrides,
  });
}

function load(plugins: readonly KumiworkPlugin[], surface: "web" | "worker" = "web") {
  return loadPlugins({ plugins, surface, knownPoints: [greeters], logger: silentLogger() });
}

describe("loadPlugins", () => {
  it("returns no contributions when no plugins are installed", async () => {
    const registry = await load([]);
    expect(registry.loadedPluginIds).toEqual([]);
    expect(registry.getContributions(greeters)).toEqual([]);
  });

  it("collects contributions in plugin order", async () => {
    const registry = await load([greeterPlugin("alpha"), greeterPlugin("beta")]);
    expect(registry.loadedPluginIds).toEqual(["alpha", "beta"]);
    expect(registry.getContributions(greeters).map((g) => g.greet("x"))).toEqual(["alpha:x", "beta:x"]);
  });

  it("awaits async register functions", async () => {
    const plugin = greeterPlugin("async", {
      async register(host) {
        await Promise.resolve();
        host.contribute(greeters, { greet: () => "late" });
      },
    });
    const registry = await load([plugin]);
    expect(registry.getContributions(greeters)).toHaveLength(1);
  });

  it("skips plugins that do not target the current surface", async () => {
    const registry = await load([greeterPlugin("web-only", { surfaces: ["web"] })], "worker");
    expect(registry.loadedPluginIds).toEqual([]);
    expect(registry.getContributions(greeters)).toEqual([]);
  });

  it("hands each plugin its surface and a logger scoped to its id", async () => {
    const logger = silentLogger();
    const register = vi.fn();
    await loadPlugins({
      plugins: [greeterPlugin("scoped", { register })],
      surface: "worker",
      knownPoints: [greeters],
      logger,
    });
    expect(logger.child).toHaveBeenCalledWith({ plugin: "scoped" });
    expect(register.mock.calls[0]![0]).toMatchObject({ surface: "worker", apiVersion: PLUGIN_API_VERSION });
  });

  it("rejects duplicate plugin ids", async () => {
    await expect(load([greeterPlugin("dup"), greeterPlugin("dup")])).rejects.toThrow(/registered more than once/);
  });

  it("rejects malformed plugin ids", async () => {
    await expect(load([greeterPlugin("Not Valid")])).rejects.toThrow(PluginLoadError);
  });

  it("rejects plugins built against an unsupported API version", async () => {
    await expect(load([greeterPlugin("future", { apiVersion: PLUGIN_API_VERSION + 1 })])).rejects.toThrow(
      /targets plugin API/,
    );
  });

  it("rejects unknown surfaces", async () => {
    const plugin = greeterPlugin("odd", { surfaces: ["mobile" as "web"] });
    await expect(load([plugin])).rejects.toThrow(/unknown surface "mobile"/);
  });

  it("rejects contributions to extension points the host does not know", async () => {
    const plugin = greeterPlugin("newer", {
      register(host) {
        host.contribute(unknownPoint, "value");
      },
    });
    await expect(load([plugin])).rejects.toThrow(/"test.unknown", unknown to this host/);
  });

  it("rejects contributions made after register() finished", async () => {
    let captured: Parameters<KumiworkPlugin["register"]>[0] | undefined;
    const plugin = greeterPlugin("leaky", {
      register(host) {
        captured = host;
      },
    });
    await load([plugin]);
    expect(() => captured!.contribute(greeters, { greet: () => "" })).toThrow(/after register\(\) finished/);
  });

  it("wraps register() failures with the plugin id and keeps the cause", async () => {
    const cause = new Error("license missing");
    const plugin = greeterPlugin("broken", {
      register() {
        throw cause;
      },
    });
    const error = await load([plugin]).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(PluginLoadError);
    expect((error as PluginLoadError).pluginId).toBe("broken");
    expect((error as PluginLoadError).cause).toBe(cause);
  });
});
