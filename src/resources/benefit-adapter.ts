import { Effect } from "effect";
import type { OperationAction } from "../operations/actions.js";
import type { Operation } from "../operations/operation.js";
import type {
  BenefitCreateOperationPayload,
  BenefitMeterCreditPropertiesOperationPayload,
  BenefitUpdateOperationPayload,
} from "../operations/payloads/benefit.js";
import type { Diagnostic, FieldChange } from "../planner.js";
import type {
  CreateOperationsFromPlanContext,
  ResourceAdapter,
  ResourceExecutablePlanNode,
} from "../resource-adapter-registry.js";
import {
  managedMetadata,
  polarIdRef,
  pushFieldChange,
  unsupportedRollback,
} from "./adapter-utils.js";
import type { BenefitKind, BenefitSpec } from "./benefit.js";

const benefitSpecType = (spec: BenefitSpec): string => spec.type;

const benefitDependencies = (spec: BenefitSpec): ReadonlyArray<BenefitSpec["meter"]> => {
  switch (spec.type) {
    case "meter-credit":
      return [spec.meter];
  }
};

const benefitMeterCreditPropertiesPayload = (
  spec: BenefitSpec,
): BenefitMeterCreditPropertiesOperationPayload => ({
  meterId: polarIdRef(spec.meter),
  units: spec.units,
  rollover: spec.rollover,
});

const benefitCreatePayload = (
  node: ResourceExecutablePlanNode<BenefitKind, BenefitSpec> & { readonly _tag: "Create" },
): BenefitCreateOperationPayload => ({
  metadata: managedMetadata(node.kind, node.address, node.desired.key),
  type: "meter_credit",
  description: node.desired.spec.description,
  properties: benefitMeterCreditPropertiesPayload(node.desired.spec),
});

const hasChanged = (changes: ReadonlyArray<FieldChange>, field: keyof BenefitSpec): boolean =>
  changes.some((change) => change.path[0] === field);

const benefitUpdatePayload = (
  spec: BenefitSpec,
  changes: ReadonlyArray<FieldChange>,
): BenefitUpdateOperationPayload => {
  const payload: BenefitUpdateOperationPayload = { type: "meter_credit" };

  if (hasChanged(changes, "description")) {
    payload.description = spec.description;
  }

  if (hasChanged(changes, "meter") || hasChanged(changes, "units") || hasChanged(changes, "rollover")) {
    payload.properties = benefitMeterCreditPropertiesPayload(spec);
  }

  return payload;
};

const createBenefitOperationFromPlanNode = (
  node: ResourceExecutablePlanNode<BenefitKind, BenefitSpec>,
  context: CreateOperationsFromPlanContext,
): Operation => {
  const id = context.nextOperationId();

  switch (node._tag) {
    case "Create":
      return {
        _tag: "Operation",
        id,
        address: node.address,
        kind: "benefit",
        action: {
          _tag: "CreateBenefit",
          payload: benefitCreatePayload(node),
        },
        rollback: {
          _tag: "RollbackOperation",
          action: {
            _tag: "DeleteBenefit",
            id: polarIdRef(node.address),
          },
        },
      };
    case "Update": {
      const action: OperationAction = {
        _tag: "UpdateBenefit",
        id: node.current.polarId,
        payload: benefitUpdatePayload(node.desired.spec, node.changes),
      };

      return {
        _tag: "Operation",
        id,
        address: node.address,
        kind: "benefit",
        action,
        rollback: {
          _tag: "RollbackOperation",
          action: {
            _tag: "UpdateBenefit",
            id: node.current.polarId,
            payload: benefitUpdatePayload(node.current.spec, node.changes),
          },
        },
      };
    }
    case "Remove":
      return {
        _tag: "Operation",
        id,
        address: node.address,
        kind: "benefit",
        action: {
          _tag: "DeleteBenefit",
          id: node.current.polarId,
        },
        rollback: unsupportedRollback("Delete rollback is not implemented because revoked grants cannot be restored."),
      };
  }
};

export const BenefitResourceAdapter: ResourceAdapter<BenefitKind, BenefitSpec> = {
  kind: "benefit",
  removalMode: "delete",

  dependencies: (resource) => Effect.succeed(benefitDependencies(resource.spec)),

  diff: (desired, current) =>
    Effect.sync(() => {
      if (benefitSpecType(desired.spec) !== benefitSpecType(current.spec)) {
        const diagnostics: Array<Diagnostic> = [
          {
            _tag: "Diagnostic",
            severity: "error",
            code: "benefit.type.immutable",
            address: desired.address,
            path: ["type"],
            message: "Benefit type cannot be changed after creation.",
          },
        ];

        return {
          _tag: "Blocked",
          node: {
            _tag: "Blocked",
            address: desired.address,
            kind: "benefit",
            desired,
            current,
          },
          diagnostics,
        };
      }

      const changes: Array<FieldChange> = [];

      pushFieldChange(changes, ["description"], current.spec.description, desired.spec.description);
      pushFieldChange(changes, ["meter"], current.spec.meter, desired.spec.meter);
      pushFieldChange(changes, ["units"], current.spec.units, desired.spec.units);
      pushFieldChange(changes, ["rollover"], current.spec.rollover, desired.spec.rollover);

      if (changes.length === 0) {
        return {
          _tag: "Planned",
          node: {
            _tag: "Noop",
            address: desired.address,
            kind: "benefit",
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
          kind: "benefit",
          desired,
          current,
          changes,
        },
        diagnostics: [],
      };
    }),

  createOperationsFromPlan: (node, context) =>
    Effect.succeed([createBenefitOperationFromPlanNode(node, context)]),
};
