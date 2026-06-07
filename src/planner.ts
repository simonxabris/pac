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
  readonly relatedAddresses?: ReadonlyArray<ResourceAddress>;
};

export type UpdatePlanNode = {
  readonly _tag: "Update";
  readonly address: ResourceAddress;
  readonly kind: ResourceKind;
  readonly desired: DesiredResource;
  readonly current: CurrentResource;
  readonly changes: ReadonlyArray<FieldChange>;
};

export type RemovalMode = "archive" | "delete";

export type RemovePlanNode = {
  readonly _tag: "Remove";
  readonly mode: RemovalMode;
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

export type PlanNode =
  | CreatePlanNode
  | UpdatePlanNode
  | RemovePlanNode
  | NoopPlanNode
  | BlockedPlanNode;

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

type PendingDependency = {
  readonly from: ResourceAddress;
  readonly to: ResourceAddress;
  readonly basis: "desired" | "current";
};

const cycleKey = (cycle: ReadonlyArray<ResourceAddress>): string => {
  const cycleWithoutRepeatedStart = cycle.slice(0, -1);
  const rotations = cycleWithoutRepeatedStart.map((_, index) => [
    ...cycleWithoutRepeatedStart.slice(index),
    ...cycleWithoutRepeatedStart.slice(0, index),
  ].join("->"));

  return rotations.sort()[0] ?? cycle.join("->");
};

const findDependencyCycles = (
  nodes: ReadonlyMap<ResourceAddress, PlanNode>,
  edges: ReadonlyArray<PlanEdge>,
): ReadonlyArray<ReadonlyArray<ResourceAddress>> => {
  const adjacency = new Map<ResourceAddress, Array<ResourceAddress>>();

  for (const address of nodes.keys()) {
    adjacency.set(address, []);
  }

  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
  }

  const visited = new Set<ResourceAddress>();
  const stack: Array<ResourceAddress> = [];
  const stackIndex = new Map<ResourceAddress, number>();
  const cycles = new Map<string, ReadonlyArray<ResourceAddress>>();

  const visit = (address: ResourceAddress) => {
    visited.add(address);
    stackIndex.set(address, stack.length);
    stack.push(address);

    for (const dependency of adjacency.get(address) ?? []) {
      const dependencyStackIndex = stackIndex.get(dependency);
      if (dependencyStackIndex !== undefined) {
        const cycle = [...stack.slice(dependencyStackIndex), dependency];
        cycles.set(cycleKey(cycle), cycle);
        continue;
      }

      if (!visited.has(dependency)) {
        visit(dependency);
      }
    }

    stack.pop();
    stackIndex.delete(address);
  };

  for (const address of nodes.keys()) {
    if (!visited.has(address)) {
      visit(address);
    }
  }

  return [...cycles.values()];
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

export class PlanNotUpToDate extends Schema.TaggedErrorClass<PlanNotUpToDate>()(
  "PlanNotUpToDate",
  {
    nodeCount: Schema.Number,
    diagnosticCount: Schema.Number,
    message: Schema.String,
  },
) { }

const assertPlanUpToDate = (plan: Plan): Effect.Effect<void, PlanNotUpToDate> => {
  const nonNoopNodes = [...plan.nodes.values()].filter((node) => node._tag !== "Noop");
  const errorDiagnostics = plan.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

  if (nonNoopNodes.length === 0 && errorDiagnostics.length === 0) {
    return Effect.void;
  }

  return Effect.fail(
    new PlanNotUpToDate({
      nodeCount: nonNoopNodes.length,
      diagnosticCount: errorDiagnostics.length,
      message:
        "Cannot continue because the PAAC config is not fully in sync with Polar.",
    }),
  );
};

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
    readonly assertPlanUpToDate: (plan: Plan) => Effect.Effect<void, PlanNotUpToDate>;
  }
>()("@app/Planner") {
  static readonly layer = Layer.effect(
    Planner,
    Effect.gen(function*() {
      const adapterRegistry = yield* ResourceAdapterRegistry;

      return Planner.of({
        assertPlanUpToDate,
        plan: ({ desiredResources, currentResources }) =>
          Effect.gen(function*() {
            const desiredResourcesByAddress = yield* indexDesiredResources(desiredResources);
            const currentResourcesByAddress = yield* indexCurrentResources(currentResources);
            const nodes = new Map<ResourceAddress, PlanNode>();
            const edges: Array<PlanEdge> = [];
            const diagnostics: Array<Diagnostic> = [];
            const pendingDependencies: Array<PendingDependency> = [];
            const edgeKeys = new Set<string>();
            const addDependencyEdge = (from: ResourceAddress, to: ResourceAddress) => {
              if (!nodes.has(from) || !nodes.has(to)) return;

              const key = `${from}->${to}`;
              if (edgeKeys.has(key)) return;
              edgeKeys.add(key);
              edges.push({ _tag: "DependsOn", from, to });
            };

            const blockNode = (address: ResourceAddress) => {
              const node = nodes.get(address);
              if (node === undefined || node._tag === "Blocked") return;

              switch (node._tag) {
                case "Create":
                  nodes.set(address, {
                    _tag: "Blocked",
                    address: node.address,
                    kind: node.kind,
                    desired: node.desired,
                  });
                  return;
                case "Update":
                case "Noop":
                  nodes.set(address, {
                    _tag: "Blocked",
                    address: node.address,
                    kind: node.kind,
                    desired: node.desired,
                    current: node.current,
                  });
                  return;
                case "Remove":
                  nodes.set(address, {
                    _tag: "Blocked",
                    address: node.address,
                    kind: node.kind,
                    current: node.current,
                  });
                  return;
              }
            };

            for (const [address, desiredResource] of desiredResourcesByAddress.entries()) {
              const adapter = yield* adapterRegistry.get(desiredResource.kind);
              const dependencies = yield* adapter.dependencies(desiredResource);

              for (const dependency of dependencies) {
                pendingDependencies.push({ from: address, to: dependency, basis: "desired" });
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
              if (desiredResourcesByAddress.has(address)) {
                continue;
              }

              if (currentResource.isRemoved) {
                continue;
              }

              const adapter = yield* adapterRegistry.get(currentResource.kind);
              const dependencies = yield* adapter.dependencies(currentResource);

              for (const dependency of dependencies) {
                pendingDependencies.push({ from: address, to: dependency, basis: "current" });
              }

              nodes.set(address, {
                _tag: "Remove",
                mode: adapter.removalMode,
                address,
                kind: currentResource.kind,
                current: currentResource,
              });
            }

            for (const dependency of pendingDependencies) {
              if (dependency.basis === "desired") {
                if (!desiredResourcesByAddress.has(dependency.to)) {
                  diagnostics.push({
                    _tag: "Diagnostic",
                    severity: "error",
                    code: "dependency.missing",
                    address: dependency.from,
                    message: `Resource ${dependency.from} depends on missing desired resource ${dependency.to}.`,
                  });
                  blockNode(dependency.from);
                  continue;
                }

                addDependencyEdge(dependency.from, dependency.to);
                continue;
              }

              if (!currentResourcesByAddress.has(dependency.to)) {
                diagnostics.push({
                  _tag: "Diagnostic",
                  severity: "warning",
                  code: "dependency.currentTargetMissing",
                  address: dependency.from,
                  message: `Current resource ${dependency.from} depends on missing current resource ${dependency.to}.`,
                });
                continue;
              }

              addDependencyEdge(dependency.from, dependency.to);
            }

            for (const cycle of findDependencyCycles(nodes, edges)) {
              const cycleNodes = cycle.slice(0, -1);

              diagnostics.push({
                _tag: "Diagnostic",
                severity: "error",
                code: "dependency.cycle",
                message: `Dependency cycle detected: ${cycle.join(" -> ")}.`,
                relatedAddresses: cycle,
              });

              for (const address of cycleNodes) {
                blockNode(address);
              }
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
