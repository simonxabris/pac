import { Effect } from "effect";
import type { ResourceAddress } from "../core/address.js";
import type { OperationAction } from "../operations/actions.js";
import type { Operation } from "../operations/operation.js";
import type {
  BenefitCreateOperationPayload,
  BenefitCustomUpdateOperationPayload,
  BenefitFeatureFlagUpdateOperationPayload,
  BenefitMeterCreditPropertiesOperationPayload,
  BenefitMeterCreditUpdateOperationPayload,
  BenefitOperationMetadata,
  BenefitUpdateOperationPayload,
} from "../operations/payloads/benefit.js";
import type { Diagnostic, FieldChange } from "../services/planner.js";
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
import type {
  BenefitKind,
  BenefitMetadata,
  BenefitMeterCreditSpec,
  BenefitSpec,
} from "./benefit.js";

const assertNever = (value: never): never => {
  throw new Error(`Unexpected Benefit spec variant: ${JSON.stringify(value)}`);
};

const benefitDependencies = (spec: BenefitSpec): ReadonlyArray<ResourceAddress> => {
  switch (spec.type) {
    case "meter-credit":
      return [spec.meter];
    case "custom":
      return [];
    case "feature-flag":
      return [];
  }
};

const benefitMeterCreditPropertiesPayload = (
  spec: BenefitMeterCreditSpec,
): BenefitMeterCreditPropertiesOperationPayload => ({
  meterId: polarIdRef(spec.meter),
  units: spec.units,
  rollover: spec.rollover,
});

const benefitMetadataPayload = (
  userMetadata: BenefitMetadata,
  resource: { readonly kind: BenefitKind; readonly address: ResourceAddress; readonly key: string },
): BenefitOperationMetadata => ({
  ...userMetadata,
  ...managedMetadata(resource.kind, resource.address, resource.key),
});

const benefitCreatePayload = (
  node: ResourceExecutablePlanNode<BenefitKind, BenefitSpec> & { readonly _tag: "Create" },
): BenefitCreateOperationPayload => {
  const metadata = benefitMetadataPayload({}, node.desired);

  switch (node.desired.spec.type) {
    case "meter-credit":
      return {
        metadata,
        type: "meter_credit",
        description: node.desired.spec.description,
        properties: benefitMeterCreditPropertiesPayload(node.desired.spec),
      };
    case "custom":
      return {
        metadata,
        type: "custom",
        description: node.desired.spec.description,
        properties: { note: node.desired.spec.note },
      };
    case "feature-flag":
      return {
        metadata: benefitMetadataPayload(node.desired.spec.metadata, node.desired),
        type: "feature_flag",
        description: node.desired.spec.description,
        properties: {},
      };
  }
};

type KeysOfUnion<T> = T extends T ? keyof T : never;

type BenefitSpecField = KeysOfUnion<BenefitSpec>;

const hasChanged = (changes: ReadonlyArray<FieldChange>, field: BenefitSpecField): boolean =>
  changes.some((change) => change.path[0] === field);

const benefitUpdatePayload = (
  resource: {
    readonly kind: BenefitKind;
    readonly address: ResourceAddress;
    readonly key: string;
    readonly spec: BenefitSpec;
  },
  changes: ReadonlyArray<FieldChange>,
): BenefitUpdateOperationPayload => {
  const { spec } = resource;

  switch (spec.type) {
    case "meter-credit": {
      const payload: BenefitMeterCreditUpdateOperationPayload = { type: "meter_credit" };

      if (hasChanged(changes, "description")) {
        payload.description = spec.description;
      }

      if (
        hasChanged(changes, "meter") ||
        hasChanged(changes, "units") ||
        hasChanged(changes, "rollover")
      ) {
        payload.properties = benefitMeterCreditPropertiesPayload(spec);
      }

      return payload;
    }
    case "custom": {
      const payload: BenefitCustomUpdateOperationPayload = { type: "custom" };

      if (hasChanged(changes, "description")) {
        payload.description = spec.description;
      }

      if (hasChanged(changes, "note")) {
        payload.properties = { note: spec.note };
      }

      return payload;
    }
    case "feature-flag": {
      const payload: BenefitFeatureFlagUpdateOperationPayload = { type: "feature_flag" };

      if (hasChanged(changes, "description")) {
        payload.description = spec.description;
      }

      if (hasChanged(changes, "metadata")) {
        payload.metadata = benefitMetadataPayload(spec.metadata, resource);
      }

      return payload;
    }
  }
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
        payload: benefitUpdatePayload(node.desired, node.changes),
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
            payload: benefitUpdatePayload(node.current, node.changes),
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
        rollback: unsupportedRollback(
          "Delete rollback is not implemented because revoked grants cannot be restored.",
        ),
      };
  }
};

export const BenefitResourceAdapter: ResourceAdapter<BenefitKind, BenefitSpec> = {
  kind: "benefit",
  removalMode: "delete",

  dependencies: (resource) => Effect.succeed(benefitDependencies(resource.spec)),

  diff: (desired, current) =>
    Effect.sync(() => {
      if (desired.spec.type !== current.spec.type) {
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

      switch (desired.spec.type) {
        case "meter-credit": {
          if (current.spec.type !== "meter-credit") {
            throw new Error("Benefit type mismatch after immutable-type check.");
          }

          pushFieldChange(changes, ["meter"], current.spec.meter, desired.spec.meter);
          pushFieldChange(changes, ["units"], current.spec.units, desired.spec.units);
          pushFieldChange(changes, ["rollover"], current.spec.rollover, desired.spec.rollover);
          break;
        }
        case "custom": {
          if (current.spec.type !== "custom") {
            throw new Error("Benefit type mismatch after immutable-type check.");
          }

          pushFieldChange(changes, ["note"], current.spec.note, desired.spec.note);
          break;
        }
        case "feature-flag": {
          if (current.spec.type !== "feature-flag") {
            throw new Error("Benefit type mismatch after immutable-type check.");
          }

          pushFieldChange(changes, ["metadata"], current.spec.metadata, desired.spec.metadata);
          break;
        }
        default:
          assertNever(desired.spec);
      }

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
