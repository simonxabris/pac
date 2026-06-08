import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";
import { ResourceAddress as ResourceAddressSchema, type ResourceAddress } from "../core/address.js";
import { ResourceKindSchema, type ResourceKind } from "../core/kind.js";
import type { CurrentResource, DesiredResource } from "../core/resource.js";
import type { OperationId } from "../operation-planner/types.js";
import type { Operation } from "../operations/operation.js";
import type {
  CreatePlanNode,
  RemovePlanNode,
  RemovalMode,
  ResourceDiffResult,
  UpdatePlanNode,
} from "./planner.js";

export type ResourceCreatePlanNode<Kind extends ResourceKind = ResourceKind, Spec = unknown> =
  CreatePlanNode & {
    readonly kind: Kind;
    readonly desired: DesiredResource<Kind, Spec>;
  };

export type ResourceUpdatePlanNode<Kind extends ResourceKind = ResourceKind, Spec = unknown> =
  UpdatePlanNode & {
    readonly kind: Kind;
    readonly desired: DesiredResource<Kind, Spec>;
    readonly current: CurrentResource<Kind, Spec>;
  };

export type ResourceRemovePlanNode<Kind extends ResourceKind = ResourceKind, Spec = unknown> =
  RemovePlanNode & {
    readonly kind: Kind;
    readonly current: CurrentResource<Kind, Spec>;
  };

export type ResourceExecutablePlanNode<Kind extends ResourceKind = ResourceKind, Spec = unknown> =
  | ResourceCreatePlanNode<Kind, Spec>
  | ResourceUpdatePlanNode<Kind, Spec>
  | ResourceRemovePlanNode<Kind, Spec>;

export type CreateOperationsFromPlanContext = {
  readonly nextOperationId: () => OperationId;
};

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
  readonly removalMode: RemovalMode;

  readonly dependencies: (
    resource: DesiredResource<Kind, Spec> | CurrentResource<Kind, Spec>,
  ) => Effect.Effect<ReadonlyArray<ResourceAddress>, ResourceAdapterPlanError>;

  readonly diff: (
    desired: DesiredResource<Kind, Spec>,
    current: CurrentResource<Kind, Spec>,
  ) => Effect.Effect<ResourceDiffResult, ResourceAdapterPlanError>;

  readonly createOperationsFromPlan: (
    node: ResourceExecutablePlanNode<Kind, Spec>,
    context: CreateOperationsFromPlanContext,
  ) => Effect.Effect<ReadonlyArray<Operation>, ResourceAdapterPlanError>;
};

export type AnyResourceAdapter = {
  readonly kind: ResourceKind;
  readonly removalMode: RemovalMode;

  readonly dependencies: (
    resource: DesiredResource | CurrentResource,
  ) => Effect.Effect<ReadonlyArray<ResourceAddress>, ResourceAdapterPlanError>;

  readonly diff: (
    desired: DesiredResource,
    current: CurrentResource,
  ) => Effect.Effect<ResourceDiffResult, ResourceAdapterPlanError>;

  readonly createOperationsFromPlan: (
    node: ResourceExecutablePlanNode,
    context: CreateOperationsFromPlanContext,
  ) => Effect.Effect<ReadonlyArray<Operation>, ResourceAdapterPlanError>;
};

export const eraseResourceAdapter = <Kind extends ResourceKind, Spec>(
  adapter: ResourceAdapter<Kind, Spec>,
): AnyResourceAdapter => ({
  kind: adapter.kind,
  removalMode: adapter.removalMode,
  dependencies: (resource) =>
    adapter.dependencies(resource as DesiredResource<Kind, Spec> | CurrentResource<Kind, Spec>),
  diff: (desired, current) =>
    adapter.diff(desired as DesiredResource<Kind, Spec>, current as CurrentResource<Kind, Spec>),
  createOperationsFromPlan: (node, context) =>
    adapter.createOperationsFromPlan(node as ResourceExecutablePlanNode<Kind, Spec>, context),
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

export type ResourceAdapterRegistryShape = {
  readonly get: (kind: ResourceKind) => Effect.Effect<AnyResourceAdapter, MissingResourceAdapter>;
};

export class ResourceAdapterRegistry extends Context.Service<
  ResourceAdapterRegistry,
  ResourceAdapterRegistryShape
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
