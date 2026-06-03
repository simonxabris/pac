import type { ResourceAddress } from "./address.js";
import type { JsonObject } from "./json.js";
import type { ManagedIdentity } from "./metadata.js";

export type DesiredResource = {
  readonly kind: string;
  readonly key: string;
  readonly address: ResourceAddress;
  readonly config: unknown;
  readonly dependencies: ReadonlyArray<ResourceAddress>;
};

export type CanonicalResource = {
  readonly kind: string;
  readonly address: ResourceAddress;
  readonly provider: "polar";
  readonly providerId?: string;
  readonly managed: JsonObject;
  readonly metadata: ManagedIdentity;
  readonly raw?: unknown;
};
