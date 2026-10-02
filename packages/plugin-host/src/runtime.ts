import { extensionPoints, type ExtensionPoint, type PluginSurface } from "@agentfactory/plugin-api";
import { plugins } from "@agentfactory/plugins";
import { createLogger } from "@agentfactory/logger";
import { loadPlugins, type PluginRegistry } from "./load-plugins";

interface PluginRuntimeState {
  surface: PluginSurface;
  registry: Promise<PluginRegistry>;
}

const RUNTIME_KEY = Symbol.for("agentfactory.plugin-runtime");

type GlobalWithPluginRuntime = typeof globalThis & { [RUNTIME_KEY]?: PluginRuntimeState };

function runtimeGlobal(): GlobalWithPluginRuntime {
  return globalThis as GlobalWithPluginRuntime;
}

export function initPlugins(surface: PluginSurface): Promise<PluginRegistry> {
  const global = runtimeGlobal();
  const existing = global[RUNTIME_KEY];
  if (existing) {
    if (existing.surface !== surface) {
      throw new Error(`Plugins already initialized for surface "${existing.surface}", not "${surface}"`);
    }
    return existing.registry;
  }
  const registry = loadPlugins({
    plugins,
    surface,
    knownPoints: Object.values(extensionPoints),
    logger: createLogger("plugins"),
  });
  global[RUNTIME_KEY] = { surface, registry };
  return registry;
}

export async function getContributions<Contribution>(
  point: ExtensionPoint<Contribution>,
): Promise<readonly Contribution[]> {
  const state = runtimeGlobal()[RUNTIME_KEY];
  if (!state) {
    throw new Error(`Plugins were not initialized before reading extension point "${point.name}"`);
  }
  return (await state.registry).getContributions(point);
}
