import type { DesiredResource } from "../core/resource.js";

export type Resource = {
  readonly type: string;
  readonly kind: string;
  readonly key: string;
  readonly address: string;
  readonly toDesiredResource: () => DesiredResource;
};

const registryKey = Symbol.for("paac.resources");

type GlobalWithRegistry = typeof globalThis & { [registryKey]?: Array<Resource> };

const globalRegistry = globalThis as GlobalWithRegistry;

const resources = (): Array<Resource> => {
  globalRegistry[registryKey] ??= [];
  return globalRegistry[registryKey];
};

export const resetRegistry = (): void => {
  globalRegistry[registryKey] = [];
};

export const registerResource = (resource: Resource): void => {
  resources().push(resource);
};

export const getResources = (): ReadonlyArray<Resource> => resources();
