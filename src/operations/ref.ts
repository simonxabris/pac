import type { ResourceAddress } from "../core/address.js";

export type OperationRef = {
  readonly _tag: "Ref";
  readonly address: ResourceAddress;
  readonly field: "polarId";
};

export type Resolvable<T> = T | OperationRef;
