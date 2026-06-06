import type { ResourceAddress } from "../core/address.js";
import type { CreatePlanNode, RemovePlanNode, UpdatePlanNode } from "../planner.js";
import type { ResourceBindings } from "../operations/bindings.js";
import type { Operation } from "../operations/operation.js";

export type OperationId = string;

export type ExecutablePlanNode = CreatePlanNode | UpdatePlanNode | RemovePlanNode;

export type OperationGroup = {
  readonly address: ResourceAddress;
  readonly node: ExecutablePlanNode;
  readonly operations: ReadonlyArray<Operation>;
  readonly firstOperationId: OperationId;
  readonly lastOperationId: OperationId;
};

export type OperationConstraint = {
  readonly before: OperationId;
  readonly after: OperationId;
  readonly reason: string;
};

export type LoweredPlanNodes = {
  readonly groups: ReadonlyArray<OperationGroup>;
  readonly groupsByAddress: ReadonlyMap<ResourceAddress, OperationGroup>;
  readonly operations: ReadonlyArray<Operation>;
};

export type OperationProgram = {
  readonly operations: ReadonlyArray<Operation>;
  readonly initialBindings: ResourceBindings;
};
