import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";
import { ResourceAddress as ResourceAddressSchema, type ResourceAddress } from "../core/address.js";
import type { Operation } from "../operations/operation.js";
import type { Plan, PlanNodeMap } from "./planner.js";
import type {
  ExecutablePlanNode,
  LoweredPlanNodes,
  OperationConstraint,
  OperationGroup,
  OperationId,
  OperationProgram,
} from "../operation-planner/types.js";
import {
  MissingResourceAdapter,
  ResourceAdapterPlanError,
  ResourceAdapterRegistry,
  type ResourceAdapterRegistryShape,
} from "./resource-adapter-registry.js";

const isExecutablePlanNode = (
  node: PlanNodeMap extends ReadonlyMap<ResourceAddress, infer Node> ? Node : never,
): node is ExecutablePlanNode =>
  node._tag === "Create" || node._tag === "Update" || node._tag === "Remove";

export const lowerPlanNodesToOperationGroups = (
  nodes: PlanNodeMap,
  adapterRegistry: ResourceAdapterRegistryShape,
): Effect.Effect<LoweredPlanNodes, MissingResourceAdapter | ResourceAdapterPlanError> =>
  Effect.gen(function*() {
    const groups: Array<OperationGroup> = [];
    const groupsByAddress = new Map<ResourceAddress, OperationGroup>();
    const operations: Array<Operation> = [];
    let operationIndex = 1;

    const nextOperationId = (): OperationId => {
      const operationId = `op_${operationIndex}`;
      operationIndex += 1;
      return operationId;
    };

    for (const node of nodes.values()) {
      if (!isExecutablePlanNode(node)) continue;

      const adapter = yield* adapterRegistry.get(node.kind);
      const groupOperations = yield* adapter.createOperationsFromPlan(node, { nextOperationId });

      if (groupOperations.length === 0) {
        return yield* new ResourceAdapterPlanError({
          kind: node.kind,
          address: node.address,
          message: "Resource adapter produced no operations for executable plan node.",
        });
      }

      const firstOperation = groupOperations[0];
      const lastOperation = groupOperations[groupOperations.length - 1];

      if (firstOperation === undefined || lastOperation === undefined) {
        return yield* new ResourceAdapterPlanError({
          kind: node.kind,
          address: node.address,
          message: "Resource adapter produced no operations for executable plan node.",
        });
      }

      const group: OperationGroup = {
        address: node.address,
        node,
        operations: groupOperations,
        firstOperationId: firstOperation.id,
        lastOperationId: lastOperation.id,
      };

      groups.push(group);
      groupsByAddress.set(node.address, group);
      operations.push(...groupOperations);
    }

    return {
      groups,
      groupsByAddress,
      operations,
    };
  });

export class PlanNotExecutable extends Schema.TaggedErrorClass<PlanNotExecutable>()(
  "PlanNotExecutable",
  {
    message: Schema.String,
    blockedAddresses: Schema.Array(ResourceAddressSchema),
    diagnosticCodes: Schema.Array(Schema.String),
  },
) { }

const buildOperationConstraints = (
  plan: Plan,
  groups: ReadonlyArray<OperationGroup>,
  groupsByAddress: ReadonlyMap<ResourceAddress, OperationGroup>,
): ReadonlyArray<OperationConstraint> => {
  const constraints: Array<OperationConstraint> = [];
  const addConstraint = (constraint: OperationConstraint) => {
    if (constraint.before === constraint.after) return;
    constraints.push(constraint);
  };

  for (const group of groups) {
    for (let index = 0; index < group.operations.length - 1; index++) {
      const before = group.operations[index];
      const after = group.operations[index + 1];
      if (before === undefined || after === undefined) continue;

      addConstraint({
        before: before.id,
        after: after.id,
        reason: `Operations within ${group.address} execute in order.`,
      });
    }
  }

  for (const edge of plan.edges) {
    const fromGroup = groupsByAddress.get(edge.from);
    const toGroup = groupsByAddress.get(edge.to);
    if (fromGroup === undefined || toGroup === undefined) continue;

    if (fromGroup.node._tag === "Remove") {
      addConstraint({
        before: fromGroup.lastOperationId,
        after: toGroup.firstOperationId,
        reason: `${edge.from} must be removed before dependency ${edge.to}.`,
      });
      continue;
    }

    addConstraint({
      before: toGroup.lastOperationId,
      after: fromGroup.firstOperationId,
      reason: `${edge.from} depends on ${edge.to}.`,
    });
  }

  return constraints;
};

const topologicalSortOperations = (
  operations: ReadonlyArray<Operation>,
  constraints: ReadonlyArray<OperationConstraint>,
): ReadonlyArray<Operation> | undefined => {
  const operationsById = new Map<OperationId, Operation>();
  const operationOrder = new Map<OperationId, number>();
  const outgoing = new Map<OperationId, Array<OperationId>>();
  const indegree = new Map<OperationId, number>();

  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index];
    if (operation === undefined) continue;
    operationsById.set(operation.id, operation);
    operationOrder.set(operation.id, index);
    outgoing.set(operation.id, []);
    indegree.set(operation.id, 0);
  }

  const constraintKeys = new Set<string>();
  for (const constraint of constraints) {
    if (!operationsById.has(constraint.before) || !operationsById.has(constraint.after)) continue;

    const key = `${constraint.before}->${constraint.after}`;
    if (constraintKeys.has(key)) continue;
    constraintKeys.add(key);

    outgoing.get(constraint.before)?.push(constraint.after);
    indegree.set(constraint.after, (indegree.get(constraint.after) ?? 0) + 1);
  }

  const available = operations
    .filter((operation) => (indegree.get(operation.id) ?? 0) === 0)
    .map((operation) => operation.id);
  const sorted: Array<Operation> = [];

  while (available.length > 0) {
    available.sort(
      (left, right) => (operationOrder.get(left) ?? 0) - (operationOrder.get(right) ?? 0),
    );
    const operationId = available.shift();
    if (operationId === undefined) continue;

    const operation = operationsById.get(operationId);
    if (operation === undefined) continue;
    sorted.push(operation);

    for (const after of outgoing.get(operationId) ?? []) {
      const nextIndegree = (indegree.get(after) ?? 0) - 1;
      indegree.set(after, nextIndegree);
      if (nextIndegree === 0) {
        available.push(after);
      }
    }
  }

  return sorted.length === operations.length ? sorted : undefined;
};

const createInitialBindings = (plan: Plan): OperationProgram["initialBindings"] => {
  const bindings = new Map<ResourceAddress, { readonly polarId: string }>();

  for (const resource of plan.currentResources) {
    bindings.set(resource.address, { polarId: resource.polarId });
  }

  return bindings;
};

const assertPlanExecutable = (plan: Plan): Effect.Effect<void, PlanNotExecutable> => {
  const blockedAddresses = [...plan.nodes.values()]
    .filter((node) => node._tag === "Blocked")
    .map((node) => node.address);
  const diagnosticCodes = plan.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code);

  if (blockedAddresses.length === 0 && diagnosticCodes.length === 0) {
    return Effect.void;
  }

  return Effect.fail(
    new PlanNotExecutable({
      message: "Plan contains blocked resources or error diagnostics.",
      blockedAddresses,
      diagnosticCodes,
    }),
  );
};

export class OperationPlanner extends Context.Service<
  OperationPlanner,
  {
    readonly create: (
      plan: Plan,
    ) => Effect.Effect<
      OperationProgram,
      PlanNotExecutable | MissingResourceAdapter | ResourceAdapterPlanError
    >;
  }
>()("@app/OperationPlanner") {
  static readonly layer = Layer.effect(
    OperationPlanner,
    Effect.gen(function*() {
      const adapterRegistry = yield* ResourceAdapterRegistry;

      return OperationPlanner.of({
        create: (plan) =>
          Effect.gen(function*() {
            yield* assertPlanExecutable(plan);

            const lowered = yield* lowerPlanNodesToOperationGroups(plan.nodes, adapterRegistry);
            const constraints = buildOperationConstraints(
              plan,
              lowered.groups,
              lowered.groupsByAddress,
            );
            const sorted = topologicalSortOperations(lowered.operations, constraints);

            if (sorted === undefined) {
              return yield* new PlanNotExecutable({
                message: "Operation ordering cycle detected.",
                blockedAddresses: [],
                diagnosticCodes: ["operation.cycle"],
              });
            }

            return {
              operations: sorted,
              initialBindings: createInitialBindings(plan),
            };
          }),
      });
    }),
  );
}
