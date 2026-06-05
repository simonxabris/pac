import type { ResourceAddress } from "../core/address.js";

export type ResourceBinding = {
  readonly polarId: string;
};

export type ResourceBindings = ReadonlyMap<ResourceAddress, ResourceBinding>;
