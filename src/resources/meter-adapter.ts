import { Effect } from "effect";
import type { FieldChange } from "../planner.js";
import type { ResourceAdapter } from "../resource-adapter-registry.js";
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

  create: (desired) =>
    Effect.succeed([
      {
        type: "create",
        kind: "meter",
        address: desired.address,
        desired,
      },
    ]),

  update: (desired, current) =>
    Effect.succeed([
      {
        type: "update",
        kind: "meter",
        address: desired.address,
        desired,
        current,
      },
    ]),

  archive: (current) =>
    Effect.succeed([
      {
        type: "archive",
        kind: "meter",
        address: current.address,
        current,
      },
    ]),
};
