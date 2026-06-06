import type { ResourceAddress } from "./address.js";
import type { ResourceKind } from "./kind.js";

export type ResourceSource = "desired" | "current";

export type ResourceEnvelope<
  Source extends ResourceSource = ResourceSource,
  Kind extends ResourceKind = ResourceKind,
  Spec = unknown,
> = {
  readonly source: Source;
  readonly kind: Kind;
  readonly key: string;
  readonly address: ResourceAddress<Kind>;
  readonly spec: Spec;
};

export type DesiredResource<Kind extends ResourceKind = ResourceKind, Spec = unknown> = ResourceEnvelope<
  "desired",
  Kind,
  Spec
>;

export type CurrentResource<
  Kind extends ResourceKind = ResourceKind,
  Spec = unknown,
  ProviderState = unknown,
> = ResourceEnvelope<"current", Kind, Spec> & {
  readonly polarId: string;
  readonly isArchived: boolean;
  readonly providerState?: ProviderState;
  readonly raw?: unknown;
};
