import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";
import { ResourceAddress as ResourceAddressSchema, type ResourceAddress } from "./core/address.js";
import { ResourceKindSchema, type ResourceKind } from "./core/kind.js";
import type { CurrentResource, DesiredResource } from "./core/resource.js";
import type { ResourceDiffResult } from "./planner.js";

export type CreateResourceOperation<Kind extends ResourceKind = ResourceKind, Spec = unknown> = {
  readonly type: "create";
  readonly kind: Kind;
  readonly address: ResourceAddress<Kind>;
  readonly desired: DesiredResource<Kind, Spec>;
};

export type UpdateResourceOperation<Kind extends ResourceKind = ResourceKind, Spec = unknown> = {
  readonly type: "update";
  readonly kind: Kind;
  readonly address: ResourceAddress<Kind>;
  readonly desired: DesiredResource<Kind, Spec>;
  readonly current: CurrentResource<Kind, Spec>;
};

export type ArchiveResourceOperation<Kind extends ResourceKind = ResourceKind, Spec = unknown> = {
  readonly type: "archive";
  readonly kind: Kind;
  readonly address: ResourceAddress<Kind>;
  readonly current: CurrentResource<Kind, Spec>;
};

export type ResourceOperation<Kind extends ResourceKind = ResourceKind, Spec = unknown> =
  | CreateResourceOperation<Kind, Spec>
  | UpdateResourceOperation<Kind, Spec>
  | ArchiveResourceOperation<Kind, Spec>;

export type ResourceDependency = {
  readonly dependent: ResourceAddress;
  readonly dependency: ResourceAddress;
};

export class ResourceAdapterPlanError extends Schema.TaggedErrorClass<ResourceAdapterPlanError>()(
  "ResourceAdapterPlanError",
  {
    kind: ResourceKindSchema,
    address: ResourceAddressSchema,
    message: Schema.String,
  },
) {}

export type ResourceAdapter<Kind extends ResourceKind = ResourceKind, Spec = unknown> = {
  readonly kind: Kind;

  readonly dependencies: (
    resource: DesiredResource<Kind, Spec> | CurrentResource<Kind, Spec>,
  ) => Effect.Effect<ReadonlyArray<ResourceAddress>, ResourceAdapterPlanError>;

  readonly diff: (
    desired: DesiredResource<Kind, Spec>,
    current: CurrentResource<Kind, Spec>,
  ) => Effect.Effect<ResourceDiffResult, ResourceAdapterPlanError>;

  readonly create: (
    desired: DesiredResource<Kind, Spec>,
  ) => Effect.Effect<ReadonlyArray<ResourceOperation<Kind, Spec>>, ResourceAdapterPlanError>;

  readonly update: (
    desired: DesiredResource<Kind, Spec>,
    current: CurrentResource<Kind, Spec>,
  ) => Effect.Effect<ReadonlyArray<ResourceOperation<Kind, Spec>>, ResourceAdapterPlanError>;

  readonly archive: (
    current: CurrentResource<Kind, Spec>,
  ) => Effect.Effect<ReadonlyArray<ResourceOperation<Kind, Spec>>, ResourceAdapterPlanError>;
};

export type AnyResourceAdapter = {
  readonly kind: ResourceKind;

  readonly dependencies: (
    resource: DesiredResource | CurrentResource,
  ) => Effect.Effect<ReadonlyArray<ResourceAddress>, ResourceAdapterPlanError>;

  readonly diff: (
    desired: DesiredResource,
    current: CurrentResource,
  ) => Effect.Effect<ResourceDiffResult, ResourceAdapterPlanError>;

  readonly create: (
    desired: DesiredResource,
  ) => Effect.Effect<ReadonlyArray<ResourceOperation>, ResourceAdapterPlanError>;

  readonly update: (
    desired: DesiredResource,
    current: CurrentResource,
  ) => Effect.Effect<ReadonlyArray<ResourceOperation>, ResourceAdapterPlanError>;

  readonly archive: (
    current: CurrentResource,
  ) => Effect.Effect<ReadonlyArray<ResourceOperation>, ResourceAdapterPlanError>;
};

export const eraseResourceAdapter = <Kind extends ResourceKind, Spec>(
  adapter: ResourceAdapter<Kind, Spec>,
): AnyResourceAdapter => ({
  kind: adapter.kind,
  dependencies: (resource) =>
    adapter.dependencies(resource as DesiredResource<Kind, Spec> | CurrentResource<Kind, Spec>),
  diff: (desired, current) =>
    adapter.diff(desired as DesiredResource<Kind, Spec>, current as CurrentResource<Kind, Spec>),
  create: (desired) => adapter.create(desired as DesiredResource<Kind, Spec>),
  update: (desired, current) =>
    adapter.update(desired as DesiredResource<Kind, Spec>, current as CurrentResource<Kind, Spec>),
  archive: (current) => adapter.archive(current as CurrentResource<Kind, Spec>),
});

export class MissingResourceAdapter extends Schema.TaggedErrorClass<MissingResourceAdapter>()(
  "MissingResourceAdapter",
  {
    kind: ResourceKindSchema,
  },
) {}

export class DuplicateResourceAdapterKind extends Schema.TaggedErrorClass<DuplicateResourceAdapterKind>()(
  "DuplicateResourceAdapterKind",
  {
    kind: ResourceKindSchema,
  },
) {}

export class ResourceAdapterRegistry extends Context.Service<
  ResourceAdapterRegistry,
  {
    readonly get: (kind: ResourceKind) => Effect.Effect<AnyResourceAdapter, MissingResourceAdapter>;
  }
>()("@app/ResourceAdapterRegistry") {}

export const makeResourceAdapterRegistryLayer = (
  adapters: ReadonlyArray<AnyResourceAdapter>,
) =>
  Layer.effect(
    ResourceAdapterRegistry,
    Effect.gen(function*() {
      const adaptersByKind = new Map<ResourceKind, AnyResourceAdapter>();

      for (const adapter of adapters) {
        if (adaptersByKind.has(adapter.kind)) {
          return yield* new DuplicateResourceAdapterKind({ kind: adapter.kind });
        }

        adaptersByKind.set(adapter.kind, adapter);
      }

      return ResourceAdapterRegistry.of({
        get: (kind) => {
          const adapter = adaptersByKind.get(kind);
          return adapter === undefined
            ? Effect.fail(new MissingResourceAdapter({ kind }))
            : Effect.succeed(adapter);
        },
      });
    }),
  );
