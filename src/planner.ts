import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";
import { ResourceAddress as ResourceAddressSchema, type ResourceAddress } from "./core/address.js";
import type { ResourceKind } from "./core/kind.js";
import type { CurrentResource, DesiredResource } from "./core/resource.js";
import {
  MissingResourceAdapter,
  ResourceAdapterPlanError,
  ResourceAdapterRegistry,
} from "./resource-adapter-registry.js";

export type DesiredResourceMap = ReadonlyMap<ResourceAddress, DesiredResource>;
export type CurrentResourceMap = ReadonlyMap<ResourceAddress, CurrentResource>;

export type PlanInput = {
  readonly desiredResources: ReadonlyArray<DesiredResource>;
  readonly currentResources: ReadonlyArray<CurrentResource>;
};

export type CreatePlanNode = {
  readonly _tag: "Create";
  readonly address: ResourceAddress;
  readonly kind: ResourceKind;
  readonly desired: DesiredResource;
};

export type FieldChange = {
  readonly _tag: "FieldChange";
  readonly path: ReadonlyArray<string | number>;
  readonly before: unknown;
  readonly after: unknown;
};

export type DiagnosticSeverity = "info" | "warning" | "error";

export type Diagnostic = {
  readonly _tag: "Diagnostic";
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly address?: ResourceAddress;
  readonly path?: ReadonlyArray<string | number>;
};

export type UpdatePlanNode = {
  readonly _tag: "Update";
  readonly address: ResourceAddress;
  readonly kind: ResourceKind;
  readonly desired: DesiredResource;
  readonly current: CurrentResource;
  readonly changes: ReadonlyArray<FieldChange>;
};

export type ArchivePlanNode = {
  readonly _tag: "Archive";
  readonly address: ResourceAddress;
  readonly kind: ResourceKind;
  readonly current: CurrentResource;
};

export type NoopPlanNode = {
  readonly _tag: "Noop";
  readonly address: ResourceAddress;
  readonly kind: ResourceKind;
  readonly desired: DesiredResource;
  readonly current: CurrentResource;
};

export type BlockedPlanNode = {
  readonly _tag: "Blocked";
  readonly address: ResourceAddress;
  readonly kind: ResourceKind;
  readonly desired?: DesiredResource;
  readonly current?: CurrentResource;
};

export type PlanNode = CreatePlanNode | UpdatePlanNode | ArchivePlanNode | NoopPlanNode | BlockedPlanNode;

export type ResourceDiffResult =
  | {
      readonly _tag: "Planned";
      readonly node: UpdatePlanNode | NoopPlanNode;
      readonly diagnostics: ReadonlyArray<Diagnostic>;
    }
  | {
      readonly _tag: "Blocked";
      readonly node: BlockedPlanNode;
      readonly diagnostics: ReadonlyArray<Diagnostic>;
    };

export type PlanNodeMap = ReadonlyMap<ResourceAddress, PlanNode>;

export type PlanEdge = {
  readonly _tag: "DependsOn";
  readonly from: ResourceAddress;
  readonly to: ResourceAddress;
};

export type Plan = {
  readonly _tag: "PlanGraph";
  readonly nodes: PlanNodeMap;
  readonly edges: ReadonlyArray<PlanEdge>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly desiredResources: ReadonlyArray<DesiredResource>;
  readonly desiredResourcesByAddress: DesiredResourceMap;
  readonly currentResources: ReadonlyArray<CurrentResource>;
  readonly currentResourcesByAddress: CurrentResourceMap;
};

export class DuplicateDesiredResourceAddress extends Schema.TaggedErrorClass<DuplicateDesiredResourceAddress>()(
  "DuplicateDesiredResourceAddress",
  {
    address: ResourceAddressSchema,
  },
) { }

export class DuplicateCurrentResourceAddress extends Schema.TaggedErrorClass<DuplicateCurrentResourceAddress>()(
  "DuplicateCurrentResourceAddress",
  {
    address: ResourceAddressSchema,
  },
) { }

export const indexDesiredResources = (
  desiredResources: ReadonlyArray<DesiredResource>,
): Effect.Effect<DesiredResourceMap, DuplicateDesiredResourceAddress> =>
  Effect.gen(function*() {
    const byAddress = new Map<ResourceAddress, DesiredResource>();

    for (const resource of desiredResources) {
      if (byAddress.has(resource.address)) {
        return yield* new DuplicateDesiredResourceAddress({ address: resource.address });
      }

      byAddress.set(resource.address, resource);
    }

    return byAddress;
  });

export const indexCurrentResources = (
  currentResources: ReadonlyArray<CurrentResource>,
): Effect.Effect<CurrentResourceMap, DuplicateCurrentResourceAddress> =>
  Effect.gen(function*() {
    const byAddress = new Map<ResourceAddress, CurrentResource>();

    for (const resource of currentResources) {
      if (byAddress.has(resource.address)) {
        return yield* new DuplicateCurrentResourceAddress({ address: resource.address });
      }

      byAddress.set(resource.address, resource);
    }

    return byAddress;
  });

export class Planner extends Context.Service<
  Planner,
  {
    readonly plan: (
      input: PlanInput,
    ) => Effect.Effect<
      Plan,
      | DuplicateDesiredResourceAddress
      | DuplicateCurrentResourceAddress
      | MissingResourceAdapter
      | ResourceAdapterPlanError
    >;
  }
>()("@app/Planner") {
  static readonly layer = Layer.effect(
    Planner,
    Effect.gen(function*() {
      const adapterRegistry = yield* ResourceAdapterRegistry;

      return Planner.of({
        plan: ({ desiredResources, currentResources }) =>
          Effect.gen(function*() {
            const desiredResourcesByAddress = yield* indexDesiredResources(desiredResources);
            const currentResourcesByAddress = yield* indexCurrentResources(currentResources);
            const nodes = new Map<ResourceAddress, PlanNode>();
            const edges: Array<PlanEdge> = [];
            const diagnostics: Array<Diagnostic> = [];
            const edgeKeys = new Set<string>();
            const addDependencyEdge = (from: ResourceAddress, to: ResourceAddress) => {
              const key = `${from}->${to}`;
              if (edgeKeys.has(key)) return;
              edgeKeys.add(key);
              edges.push({ _tag: "DependsOn", from, to });
            };

            for (const [address, desiredResource] of desiredResourcesByAddress.entries()) {
              const adapter = yield* adapterRegistry.get(desiredResource.kind);
              const dependencies = yield* adapter.dependencies(desiredResource);

              for (const dependency of dependencies) {
                addDependencyEdge(address, dependency);
              }

              const currentResource = currentResourcesByAddress.get(desiredResource.address);

              if (!currentResource) {
                nodes.set(address, {
                  _tag: "Create",
                  address,
                  kind: desiredResource.kind,
                  desired: desiredResource,
                });
                continue;
              }

              const diffResult = yield* adapter.diff(desiredResource, currentResource);
              diagnostics.push(...diffResult.diagnostics);

              nodes.set(address, diffResult.node);
            }

            for (const [address, currentResource] of currentResourcesByAddress.entries()) {
              const adapter = yield* adapterRegistry.get(currentResource.kind);
              const dependencies = yield* adapter.dependencies(currentResource);

              for (const dependency of dependencies) {
                addDependencyEdge(address, dependency);
              }

              if (desiredResourcesByAddress.has(address)) {
                continue;
              }

              nodes.set(address, {
                _tag: "Archive",
                address,
                kind: currentResource.kind,
                current: currentResource,
              });
            }

            return {
              _tag: "PlanGraph",
              nodes,
              edges,
              diagnostics,
              desiredResources,
              desiredResourcesByAddress,
              currentResources,
              currentResourcesByAddress,
            };
          }),
      });
    }),
  );
}
