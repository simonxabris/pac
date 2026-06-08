import { beforeEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { PAAC_METADATA_KEY } from "../core/metadata.js";
import { MeterResourceAdapter } from "./meter-adapter.js";
import {
  and,
  count,
  eventName,
  Meter,
  sum,
  type CurrentMeterResource,
  type MeterResource,
} from "./meter.js";
import { resetRegistry } from "./registry.js";

const currentFromDesired = (
  desired: MeterResource,
  spec: CurrentMeterResource["spec"] = desired.spec,
): CurrentMeterResource => ({
  source: "current",
  kind: "meter",
  key: desired.key,
  address: desired.address,
  polarId: `polar-${desired.key}`,
  isRemoved: false,
  spec,
});

describe("MeterResourceAdapter.createOperationsFromPlan", () => {
  beforeEach(() => {
    resetRegistry();
  });

  it.effect("creates a Polar-shaped create meter payload", () =>
    Effect.gen(function* () {
      const desired = new Meter("requests", {
        name: "Requests",
        unit: "custom",
        customLabel: "requests",
        customMultiplier: 1000,
        filter: and(eventName("eq", "request")),
        aggregation: sum("quantity"),
      }).toDesiredResource();

      const operations = yield* MeterResourceAdapter.createOperationsFromPlan(
        {
          _tag: "Create",
          address: desired.address,
          kind: "meter",
          desired,
        },
        { nextOperationId: () => "op_1" },
      );

      expect(operations).toEqual([
        {
          _tag: "Operation",
          id: "op_1",
          address: "meter.requests",
          kind: "meter",
          action: {
            _tag: "CreateMeter",
            payload: {
              metadata: {
                [PAAC_METADATA_KEY]: JSON.stringify({
                  v: 1,
                  kind: "meter",
                  addr: "meter.requests",
                  key: "requests",
                }),
              },
              name: "Requests",
              unit: "custom",
              customLabel: "requests",
              customMultiplier: 1000,
              filter: {
                conjunction: "and",
                clauses: [{ property: "name", operator: "eq", value: "request" }],
              },
              aggregation: { func: "sum", property: "quantity" },
            },
          },
          rollback: {
            _tag: "RollbackOperation",
            action: {
              _tag: "ArchiveMeter",
              id: {
                _tag: "Ref",
                address: "meter.requests",
                field: "polarId",
              },
              payload: { isArchived: true },
            },
          },
        },
      ]);
    }),
  );

  it.effect("creates Polar-shaped update meter payloads and rollback payloads", () =>
    Effect.gen(function* () {
      const desired = new Meter("requests", {
        name: "Requests",
        unit: "custom",
        customLabel: "requests",
        customMultiplier: 1000,
        filter: and(eventName("eq", "request")),
        aggregation: sum("quantity"),
      }).toDesiredResource();
      const current = currentFromDesired(desired, {
        name: "Old Requests",
        unit: "scalar",
        customLabel: null,
        customMultiplier: null,
        filter: { conjunction: "and", clauses: [] },
        aggregation: count(),
      });

      const operations = yield* MeterResourceAdapter.createOperationsFromPlan(
        {
          _tag: "Update",
          address: desired.address,
          kind: "meter",
          desired,
          current,
          changes: [
            { _tag: "FieldChange", path: ["name"], before: "Old Requests", after: "Requests" },
            { _tag: "FieldChange", path: ["unit"], before: "scalar", after: "custom" },
            { _tag: "FieldChange", path: ["customLabel"], before: null, after: "requests" },
            { _tag: "FieldChange", path: ["customMultiplier"], before: null, after: 1000 },
            {
              _tag: "FieldChange",
              path: ["filter"],
              before: current.spec.filter,
              after: desired.spec.filter,
            },
            {
              _tag: "FieldChange",
              path: ["aggregation"],
              before: current.spec.aggregation,
              after: desired.spec.aggregation,
            },
          ],
        },
        { nextOperationId: () => "op_1" },
      );

      expect(operations).toEqual([
        {
          _tag: "Operation",
          id: "op_1",
          address: "meter.requests",
          kind: "meter",
          action: {
            _tag: "UpdateMeter",
            id: "polar-requests",
            payload: {
              name: "Requests",
              unit: "custom",
              customLabel: "requests",
              customMultiplier: 1000,
              filter: {
                conjunction: "and",
                clauses: [{ property: "name", operator: "eq", value: "request" }],
              },
              aggregation: { func: "sum", property: "quantity" },
            },
          },
          rollback: {
            _tag: "RollbackOperation",
            action: {
              _tag: "UpdateMeter",
              id: "polar-requests",
              payload: {
                name: "Old Requests",
                unit: "scalar",
                customLabel: null,
                customMultiplier: null,
                filter: { conjunction: "and", clauses: [] },
                aggregation: { func: "count" },
              },
            },
          },
        },
      ]);
    }),
  );
});
