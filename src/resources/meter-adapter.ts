import { Effect } from "effect";
import type { OperationAction } from "../operations/actions.js";
import type { Operation } from "../operations/operation.js";
import type {
  MeterCreateOperationPayload,
  MeterUpdateOperationPayload,
} from "../operations/payloads/meter.js";
import type { FieldChange } from "../services/planner.js";
import type {
  CreateOperationsFromPlanContext,
  ResourceAdapter,
  ResourceExecutablePlanNode,
} from "../services/resource-adapter-registry.js";
import {
  managedMetadata,
  polarIdRef,
  pushFieldChange,
  unsupportedRollback,
} from "./adapter-utils.js";
import type { MeterKind, MeterSpec } from "./meter.js";

const meterCreatePayload = (
  node: ResourceExecutablePlanNode<MeterKind, MeterSpec> & { readonly _tag: "Create" },
): MeterCreateOperationPayload => ({
  metadata: managedMetadata(node.kind, node.address, node.desired.key),
  name: node.desired.spec.name,
  unit: node.desired.spec.unit,
  customLabel: node.desired.spec.customLabel,
  customMultiplier: node.desired.spec.customMultiplier,
  filter: node.desired.spec.filter as MeterCreateOperationPayload["filter"],
  aggregation: node.desired.spec.aggregation as MeterCreateOperationPayload["aggregation"],
});

const hasChanged = (changes: ReadonlyArray<FieldChange>, field: keyof MeterSpec): boolean =>
  changes.some((change) => change.path[0] === field);

const meterUpdatePayload = (
  spec: MeterSpec,
  changes: ReadonlyArray<FieldChange>,
): MeterUpdateOperationPayload => {
  const payload: MeterUpdateOperationPayload = {};

  if (hasChanged(changes, "name")) {
    payload.name = spec.name;
  }

  if (hasChanged(changes, "unit")) {
    payload.unit = spec.unit;
  }

  if (hasChanged(changes, "customLabel")) {
    payload.customLabel = spec.customLabel;
  }

  if (hasChanged(changes, "customMultiplier")) {
    payload.customMultiplier = spec.customMultiplier;
  }

  if (hasChanged(changes, "filter")) {
    payload.filter = spec.filter as MeterUpdateOperationPayload["filter"];
  }

  if (hasChanged(changes, "aggregation")) {
    payload.aggregation = spec.aggregation as MeterUpdateOperationPayload["aggregation"];
  }

  return payload;
};

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
          payload: meterCreatePayload(node),
        },
        rollback: {
          _tag: "RollbackOperation",
          action: {
            _tag: "ArchiveMeter",
            id: polarIdRef(node.address),
            payload: { isArchived: true },
          },
        },
      };
    case "Update": {
      const action: OperationAction = {
        _tag: "UpdateMeter",
        id: node.current.polarId,
        payload: meterUpdatePayload(node.desired.spec, node.changes),
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
            payload: meterUpdatePayload(node.current.spec, node.changes),
          },
        },
      };
    }
    case "Remove":
      return {
        _tag: "Operation",
        id,
        address: node.address,
        kind: "meter",
        action: {
          _tag: "ArchiveMeter",
          id: node.current.polarId,
          payload: { isArchived: true },
        },
        rollback: unsupportedRollback("Archive rollback is not implemented yet."),
      };
  }
};

export const MeterResourceAdapter: ResourceAdapter<MeterKind, MeterSpec> = {
  kind: "meter",
  removalMode: "archive",

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
