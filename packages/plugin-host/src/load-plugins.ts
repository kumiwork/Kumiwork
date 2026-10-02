import {
  MIN_SUPPORTED_PLUGIN_API_VERSION,
  PLUGIN_API_VERSION,
  PLUGIN_SURFACES,
  type ExtensionPoint,
  type KumiworkPlugin,
  type PluginHost,
  type PluginLogger,
  type PluginSurface,
} from "@agentfactory/plugin-api";

export class PluginLoadError extends Error {
  constructor(
    readonly pluginId: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`Plugin "${pluginId}": ${message}`, options);
    this.name = "PluginLoadError";
  }
}

export interface PluginRegistry {
  readonly surface: PluginSurface;
  readonly loadedPluginIds: readonly string[];
  getContributions<Contribution>(point: ExtensionPoint<Contribution>): readonly Contribution[];
}

export interface PluginHostLogger extends PluginLogger {
  child(bindings: Record<string, unknown>): PluginLogger;
}

export interface LoadPluginsOptions {
  plugins: readonly KumiworkPlugin[];
  surface: PluginSurface;
  knownPoints: readonly ExtensionPoint<unknown>[];
  logger: PluginHostLogger;
}

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function validatePlugin(plugin: KumiworkPlugin, seenIds: ReadonlySet<string>): void {
  if (!PLUGIN_ID_PATTERN.test(plugin.id)) {
    throw new PluginLoadError(plugin.id, "id must be lowercase letters, digits and dashes");
  }
  if (seenIds.has(plugin.id)) {
    throw new PluginLoadError(plugin.id, "id is registered more than once");
  }
  if (plugin.apiVersion < MIN_SUPPORTED_PLUGIN_API_VERSION || plugin.apiVersion > PLUGIN_API_VERSION) {
    throw new PluginLoadError(
      plugin.id,
      `targets plugin API v${plugin.apiVersion}, host supports v${MIN_SUPPORTED_PLUGIN_API_VERSION}–v${PLUGIN_API_VERSION}`,
    );
  }
  const unknownSurface = plugin.surfaces?.find((surface) => !PLUGIN_SURFACES.includes(surface));
  if (unknownSurface) {
    throw new PluginLoadError(plugin.id, `declares unknown surface "${unknownSurface}"`);
  }
}

function targetsSurface(plugin: KumiworkPlugin, surface: PluginSurface): boolean {
  return plugin.surfaces === undefined || plugin.surfaces.includes(surface);
}

export async function loadPlugins(options: LoadPluginsOptions): Promise<PluginRegistry> {
  const { plugins, surface, knownPoints, logger } = options;
  const knownPointNames = new Set(knownPoints.map((point) => point.name));
  const contributions = new Map<string, unknown[]>();
  const loadedPluginIds: string[] = [];
  const seenIds = new Set<string>();

  for (const plugin of plugins) {
    validatePlugin(plugin, seenIds);
    seenIds.add(plugin.id);
    if (!targetsSurface(plugin, surface)) continue;

    let open = true;
    const host: PluginHost = {
      surface,
      apiVersion: PLUGIN_API_VERSION,
      logger: logger.child({ plugin: plugin.id }),
      contribute(point, contribution) {
        if (!open) {
          throw new PluginLoadError(plugin.id, `contributed to "${point.name}" after register() finished`);
        }
        if (!knownPointNames.has(point.name)) {
          throw new PluginLoadError(plugin.id, `contributed to extension point "${point.name}", unknown to this host`);
        }
        const existing = contributions.get(point.name) ?? [];
        existing.push(contribution);
        contributions.set(point.name, existing);
      },
    };

    try {
      await plugin.register(host);
    } catch (err) {
      if (err instanceof PluginLoadError) throw err;
      throw new PluginLoadError(plugin.id, "register() failed", { cause: err });
    } finally {
      open = false;
    }
    loadedPluginIds.push(plugin.id);
  }

  logger.info("Plugins loaded", { surface, plugins: loadedPluginIds });

  return {
    surface,
    loadedPluginIds,
    getContributions<Contribution>(point: ExtensionPoint<Contribution>): readonly Contribution[] {
      return (contributions.get(point.name) ?? []) as Contribution[];
    },
  };
}
