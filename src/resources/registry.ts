import type { ResourceAddress } from "../core/address.js";
import type { ResourceKind } from "../core/kind.js";
import type { DesiredResource } from "../core/resource.js";

export type Resource<Kind extends ResourceKind = ResourceKind, Spec = unknown> = {
  readonly type: Kind;
  readonly kind: Kind;
  readonly key: string;
  readonly address: ResourceAddress<Kind>;
  readonly toDesiredResource: () => DesiredResource<Kind, Spec>;
};

const registryKey = Symbol.for("pac.resources");

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
