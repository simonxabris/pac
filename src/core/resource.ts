import type { ResourceAddress } from "./address.js";

export type ResourceSource = "desired" | "current";

export type ResourceEnvelope<
  Source extends ResourceSource = ResourceSource,
  Kind extends string = string,
  Spec = unknown,
> = {
  readonly source: Source;
  readonly kind: Kind;
  readonly key: string;
  readonly address: ResourceAddress<Kind>;
  readonly spec: Spec;
};

export type DesiredResource<Kind extends string = string, Spec = unknown> = ResourceEnvelope<
  "desired",
  Kind,
  Spec
>;

export type CurrentResource<Kind extends string = string, Spec = unknown> = ResourceEnvelope<
  "current",
  Kind,
  Spec
> & {
  readonly polarId: string;
  readonly raw?: unknown;
};
