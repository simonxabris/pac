import { Effect } from "effect";
import type { OperationAction } from "../operations/actions.js";
import type { Operation, RollbackAction } from "../operations/operation.js";
import type { OperationRef } from "../operations/ref.js";
import type { FieldChange } from "../planner.js";
import type {
  CreateOperationsFromPlanContext,
  ResourceAdapter,
  ResourceExecutablePlanNode,
} from "../resource-adapter-registry.js";
import type { MeterKind, MeterSpec } from "./meter.js";

const valuesEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const pushFieldChange = (
  changes: Array<FieldChange>,
  path: ReadonlyArray<string | number>,
  before: unknown,
  after: unknown,
): void => {
  if (valuesEqual(before, after)) return;
  changes.push({
    _tag: "FieldChange",
    path,
    before,
    after,
  });
};

const polarIdRef = (address: OperationRef["address"]): OperationRef => ({
  _tag: "Ref",
  address,
  field: "polarId",
});

const unsupportedRollback = (reason: string): RollbackAction => ({
  _tag: "UnsupportedRollback",
  reason,
});

const createMeterOperationFromPlanNode = (
  node: ResourceExecutablePlanNode<MeterKind, MeterSpec>,
  context: CreateOperationsFromPlanContext,
): Operation => {
  const id = context.nextOperationId();

  switch (node._tag) {
    case "Create":
      return {
        _tag: "Operation",
        id,
        address: node.address,
        kind: "meter",
        action: {
          _tag: "CreateMeter",
          payload: node.desired.spec,
        },
        rollback: {
          _tag: "RollbackOperation",
          action: {
            _tag: "ArchiveMeter",
            id: polarIdRef(node.address),
          },
        },
      };
    case "Update": {
      const action: OperationAction = {
        _tag: "UpdateMeter",
        id: node.current.polarId,
        payload: {
          spec: node.desired.spec,
          changes: node.changes,
        },
      };

      return {
        _tag: "Operation",
        id,
        address: node.address,
        kind: "meter",
        action,
        rollback: {
          _tag: "RollbackOperation",
          action: {
            _tag: "UpdateMeter",
            id: node.current.polarId,
            payload: node.current.spec,
          },
        },
      };
    }
    case "Archive":
      return {
        _tag: "Operation",
        id,
        address: node.address,
        kind: "meter",
        action: {
          _tag: "ArchiveMeter",
          id: node.current.polarId,
        },
        rollback: unsupportedRollback("Archive rollback is not implemented yet."),
      };
  }
};

export const MeterResourceAdapter: ResourceAdapter<MeterKind, MeterSpec> = {
  kind: "meter",

  dependencies: () => Effect.succeed([]),

  diff: (desired, current) =>
    Effect.sync(() => {
      const changes: Array<FieldChange> = [];

      pushFieldChange(changes, ["name"], current.spec.name, desired.spec.name);
      pushFieldChange(changes, ["unit"], current.spec.unit, desired.spec.unit);
      pushFieldChange(changes, ["customLabel"], current.spec.customLabel, desired.spec.customLabel);
      pushFieldChange(
        changes,
        ["customMultiplier"],
        current.spec.customMultiplier,
        desired.spec.customMultiplier,
      );
      pushFieldChange(changes, ["filter"], current.spec.filter, desired.spec.filter);
      pushFieldChange(changes, ["aggregation"], current.spec.aggregation, desired.spec.aggregation);

      if (changes.length === 0) {
        return {
          _tag: "Planned",
          node: {
            _tag: "Noop",
            address: desired.address,
            kind: "meter",
            desired,
            current,
          },
          diagnostics: [],
        };
      }

      return {
        _tag: "Planned",
        node: {
          _tag: "Update",
          address: desired.address,
          kind: "meter",
          desired,
          current,
          changes,
        },
        diagnostics: [],
      };
    }),

  createOperationsFromPlan: (node, context) =>
    Effect.succeed([createMeterOperationFromPlanNode(node, context)]),
};
