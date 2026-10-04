export const PLUGIN_API_VERSION = 1;
export const MIN_SUPPORTED_PLUGIN_API_VERSION = 1;

export type PluginSurface = "web" | "worker";

export const PLUGIN_SURFACES: readonly PluginSurface[] = ["web", "worker"];

declare const contributionType: unique symbol;

export interface ExtensionPoint<Contribution> {
  readonly name: string;
  readonly [contributionType]?: Contribution;
}

export function defineExtensionPoint<Contribution>(name: string): ExtensionPoint<Contribution> {
  return { name };
}

export type ContributionOf<Point> = Point extends ExtensionPoint<infer Contribution> ? Contribution : never;

export type PluginLogContext = Record<string, unknown>;

export interface PluginLogger {
  debug(message: string, context?: PluginLogContext): void;
  info(message: string, context?: PluginLogContext): void;
  warn(message: string, context?: PluginLogContext): void;
  error(message: string, context?: PluginLogContext): void;
}

export interface PluginHost {
  readonly surface: PluginSurface;
  readonly apiVersion: number;
  readonly logger: PluginLogger;
  contribute<Contribution>(point: ExtensionPoint<Contribution>, contribution: NoInfer<Contribution>): void;
}

export interface KumiworkPlugin {
  readonly id: string;
  readonly apiVersion: number;
  readonly surfaces?: readonly PluginSurface[];
  register(host: PluginHost): void | Promise<void>;
}

export function definePlugin(plugin: KumiworkPlugin): KumiworkPlugin {
  return plugin;
}

export { extensionPoints } from "./extension-points";
