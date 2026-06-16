import type { ResourceAddress } from "../core/address.js";
import type { ResourceKind } from "../core/kind.js";
import type { DesiredResource } from "../core/resource.js";
import type { EventDefinition } from "../events/event.js";

export type Resource<Kind extends ResourceKind = ResourceKind, Spec = unknown> = {
  readonly type: Kind;
  readonly kind: Kind;
  readonly key: string;
  readonly address: ResourceAddress<Kind>;
  readonly toDesiredResource: () => DesiredResource<Kind, Spec>;
};

const registryKey = Symbol.for("pac.resources");
const eventRegistryKey = Symbol.for("pac.events");

type GlobalWithRegistry = typeof globalThis & {
  [registryKey]?: Array<Resource>;
  [eventRegistryKey]?: Array<EventDefinition>;
};

const globalRegistry = globalThis as GlobalWithRegistry;

const resources = (): Array<Resource> => {
  globalRegistry[registryKey] ??= [];
  return globalRegistry[registryKey];
};

const eventDefinitions = (): Array<EventDefinition> => {
  globalRegistry[eventRegistryKey] ??= [];
  return globalRegistry[eventRegistryKey];
};

export const resetRegistry = (): void => {
  globalRegistry[registryKey] = [];
  globalRegistry[eventRegistryKey] = [];
};

export const registerResource = (resource: Resource): void => {
  resources().push(resource);
};

export const getResources = (): ReadonlyArray<Resource> => resources();

export const registerEventDefinition = (definition: EventDefinition): void => {
  eventDefinitions().push(definition);
};

export const getEventDefinitions = (): ReadonlyArray<EventDefinition> => eventDefinitions();
