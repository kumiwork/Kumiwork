import type { ExtensionPoint } from "./index";

export const extensionPoints = {} satisfies Record<string, ExtensionPoint<unknown>>;
