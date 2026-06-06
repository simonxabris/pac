import { beforeEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { BenefitResourceAdapter } from "./benefit-adapter.js";
import { Benefit, type BenefitResource, type BenefitSpec, type CurrentBenefitResource } from "./benefit.js";
import { resetRegistry } from "./registry.js";

const currentFromDesired = (
  desired: BenefitResource,
  spec: CurrentBenefitResource["spec"] = desired.spec,
): CurrentBenefitResource => ({
  source: "current",
  kind: "benefit",
  key: desired.key,
  address: desired.address,
  polarId: `polar-${desired.key}`,
  isRemoved: false,
  spec,
});

describe("BenefitResourceAdapter", () => {
  beforeEach(() => {
    resetRegistry();
  });

  it.effect("discovers meter-credit Meter dependencies", () =>
    Effect.gen(function*() {
      const desired = new Benefit("included-requests", {
        type: "meter-credit",
        description: "10k API requests",
        meter: "meter.requests",
        units: 10_000,
      }).toDesiredResource();

      const dependencies = yield* BenefitResourceAdapter.dependencies(desired);

      expect(dependencies).toEqual(["meter.requests"]);
    }),
  );

  it.effect("returns a planned noop when Benefit specs match", () =>
    Effect.gen(function*() {
      const desired = new Benefit("included-requests", {
        type: "meter-credit",
        description: "10k API requests",
        meter: "meter.requests",
        units: 10_000,
        rollover: false,
      }).toDesiredResource();
      const current = currentFromDesired(desired);

      const result = yield* BenefitResourceAdapter.diff(desired, current);

      expect(result).toEqual({
        _tag: "Planned",
        node: {
          _tag: "Noop",
          address: "benefit.included-requests",
          kind: "benefit",
          desired,
          current,
        },
        diagnostics: [],
      });
    }),
  );

  it.effect("returns an update node with field-level changes", () =>
    Effect.gen(function*() {
      const desired = new Benefit("included-requests", {
        type: "meter-credit",
        description: "10k API requests",
        meter: "meter.requests",
        units: 10_000,
        rollover: true,
      }).toDesiredResource();
      const current = currentFromDesired(desired, {
        type: "meter-credit",
        description: "5k API requests",
        meter: "meter.old-requests",
        units: 5_000,
        rollover: false,
      });

      const result = yield* BenefitResourceAdapter.diff(desired, current);

      expect(result).toEqual({
        _tag: "Planned",
        node: {
          _tag: "Update",
          address: "benefit.included-requests",
          kind: "benefit",
          desired,
          current,
          changes: [
            {
              _tag: "FieldChange",
              path: ["description"],
              before: "5k API requests",
              after: "10k API requests",
            },
            {
              _tag: "FieldChange",
              path: ["meter"],
              before: "meter.old-requests",
              after: "meter.requests",
            },
            {
              _tag: "FieldChange",
              path: ["units"],
              before: 5_000,
              after: 10_000,
            },
            {
              _tag: "FieldChange",
              path: ["rollover"],
              before: false,
              after: true,
            },
          ],
        },
        diagnostics: [],
      });
    }),
  );

  it.effect("blocks Benefit type changes", () =>
    Effect.gen(function*() {
      const desired = new Benefit("included-requests", {
        type: "meter-credit",
        description: "10k API requests",
        meter: "meter.requests",
        units: 10_000,
      }).toDesiredResource();
      const current = currentFromDesired(desired, {
        ...desired.spec,
        type: "custom",
      } as unknown as BenefitSpec);

      const result = yield* BenefitResourceAdapter.diff(desired, current);

      expect(result).toEqual({
        _tag: "Blocked",
        node: {
          _tag: "Blocked",
          address: "benefit.included-requests",
          kind: "benefit",
          desired,
          current,
        },
        diagnostics: [
          {
            _tag: "Diagnostic",
            severity: "error",
            code: "benefit.type.immutable",
            address: "benefit.included-requests",
            path: ["type"],
            message: "Benefit type cannot be changed after creation.",
          },
        ],
      });
    }),
  );

  it.effect("creates a Polar-shaped create Benefit payload and delete rollback", () =>
    Effect.gen(function*() {
      const desired = new Benefit("included-requests", {
        type: "meter-credit",
        description: "10k API requests",
        meter: "meter.requests",
        units: 10_000,
        rollover: true,
      }).toDesiredResource();

      const operations = yield* BenefitResourceAdapter.createOperationsFromPlan(
        {
          _tag: "Create",
          address: desired.address,
          kind: "benefit",
          desired,
        },
        { nextOperationId: () => "op_1" },
      );

      expect(operations).toEqual([
        {
          _tag: "Operation",
          id: "op_1",
          address: "benefit.included-requests",
          kind: "benefit",
          action: {
            _tag: "CreateBenefit",
            payload: {
              metadata: {
                paac: JSON.stringify({
                  v: 1,
                  kind: "benefit",
                  addr: "benefit.included-requests",
                  key: "included-requests",
                }),
              },
              type: "meter_credit",
              description: "10k API requests",
              properties: {
                meterId: {
                  _tag: "Ref",
                  address: "meter.requests",
                  field: "polarId",
                },
                units: 10_000,
                rollover: true,
              },
            },
          },
          rollback: {
            _tag: "RollbackOperation",
            action: {
              _tag: "DeleteBenefit",
              id: {
                _tag: "Ref",
                address: "benefit.included-requests",
                field: "polarId",
              },
            },
          },
        },
      ]);
    }),
  );

  it.effect("creates Polar-shaped update Benefit payloads and rollback payloads", () =>
    Effect.gen(function*() {
      const desired = new Benefit("included-requests", {
        type: "meter-credit",
        description: "10k API requests",
        meter: "meter.requests",
        units: 10_000,
        rollover: true,
      }).toDesiredResource();
      const current = currentFromDesired(desired, {
        type: "meter-credit",
        description: "5k API requests",
        meter: "meter.old-requests",
        units: 5_000,
        rollover: false,
      });

      const operations = yield* BenefitResourceAdapter.createOperationsFromPlan(
        {
          _tag: "Update",
          address: desired.address,
          kind: "benefit",
          desired,
          current,
          changes: [
            { _tag: "FieldChange", path: ["description"], before: "5k API requests", after: "10k API requests" },
            { _tag: "FieldChange", path: ["meter"], before: "meter.old-requests", after: "meter.requests" },
            { _tag: "FieldChange", path: ["units"], before: 5_000, after: 10_000 },
            { _tag: "FieldChange", path: ["rollover"], before: false, after: true },
          ],
        },
        { nextOperationId: () => "op_1" },
      );

      expect(operations).toEqual([
        {
          _tag: "Operation",
          id: "op_1",
          address: "benefit.included-requests",
          kind: "benefit",
          action: {
            _tag: "UpdateBenefit",
            id: "polar-included-requests",
            payload: {
              type: "meter_credit",
              description: "10k API requests",
              properties: {
                meterId: {
                  _tag: "Ref",
                  address: "meter.requests",
                  field: "polarId",
                },
                units: 10_000,
                rollover: true,
              },
            },
          },
          rollback: {
            _tag: "RollbackOperation",
            action: {
              _tag: "UpdateBenefit",
              id: "polar-included-requests",
              payload: {
                type: "meter_credit",
                description: "5k API requests",
                properties: {
                  meterId: {
                    _tag: "Ref",
                    address: "meter.old-requests",
                    field: "polarId",
                  },
                  units: 5_000,
                  rollover: false,
                },
              },
            },
          },
        },
      ]);
    }),
  );

  it.effect("creates a delete-mode remove operation with unsupported rollback", () =>
    Effect.gen(function*() {
      const desired = new Benefit("included-requests", {
        type: "meter-credit",
        description: "10k API requests",
        meter: "meter.requests",
        units: 10_000,
      }).toDesiredResource();
      const current = currentFromDesired(desired);

      const operations = yield* BenefitResourceAdapter.createOperationsFromPlan(
        {
          _tag: "Remove",
          mode: "delete",
          address: desired.address,
          kind: "benefit",
          current,
        },
        { nextOperationId: () => "op_1" },
      );

      expect(BenefitResourceAdapter.removalMode).toBe("delete");
      expect(operations).toEqual([
        {
          _tag: "Operation",
          id: "op_1",
          address: "benefit.included-requests",
          kind: "benefit",
          action: {
            _tag: "DeleteBenefit",
            id: "polar-included-requests",
          },
          rollback: {
            _tag: "UnsupportedRollback",
            reason: "Delete rollback is not implemented because revoked grants cannot be restored.",
          },
        },
      ]);
    }),
  );
});
