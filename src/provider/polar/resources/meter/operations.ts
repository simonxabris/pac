import * as Effect from "effect/Effect";
import { decodeJsonObject, type JsonObject, type JsonValue } from "../../../../core/json.js";
import { encodePaacMetadata } from "../../../../core/metadata.js";
import type { Operation, ResourceChange } from "../../../../core/plan.js";
import type { CanonicalResource } from "../../../../core/resource.js";
import { errorDiagnostic } from "../../../../core/diagnostic.js";
import { decodeMeterManagedV1, type MeterManagedV1 } from "./schema.js";

const meterCreatePayload = (resource: CanonicalResource): JsonObject => {
  const managed = decodeMeterManagedV1(resource.managed);
  return decodeJsonObject({
    name: managed.name,
    unit: managed.unit,
    ...(managed.unit === "custom"
      ? {
          customLabel: managed.customLabel,
          customMultiplier: managed.customMultiplier,
        }
      : {}),
    filter: managed.filter,
    aggregation: managed.aggregation,
    metadata: encodePaacMetadata(resource.metadata),
  });
};

const hasDiff = (change: ResourceChange, path: string): boolean =>
  change.diffs.some((diff) => diff.path === path || diff.path.startsWith(`${path}/`));

const meterUpdatePayload = (change: ResourceChange, managed: MeterManagedV1): JsonObject => {
  const entries: Array<readonly [string, JsonValue]> = [];
  if (hasDiff(change, "/name")) entries.push(["name", managed.name]);
  if (hasDiff(change, "/unit")) entries.push(["unit", managed.unit]);
  if (managed.unit === "custom" && hasDiff(change, "/customLabel"))
    entries.push(["customLabel", managed.customLabel ?? null]);
  if (managed.unit === "custom" && hasDiff(change, "/customMultiplier"))
    entries.push(["customMultiplier", managed.customMultiplier ?? null]);
  if (hasDiff(change, "/filter")) entries.push(["filter", decodeJsonObject(managed.filter)]);
  if (hasDiff(change, "/aggregation"))
    entries.push(["aggregation", decodeJsonObject(managed.aggregation)]);
  if (hasDiff(change, "/isArchived")) entries.push(["isArchived", managed.isArchived]);
  return decodeJsonObject(Object.fromEntries(entries));
};

export const planMeterCreate = (
  resource: CanonicalResource,
): Effect.Effect<ReadonlyArray<Operation>> =>
  Effect.succeed([
    {
      id: `meter.create:${resource.address}`,
      provider: "polar" as const,
      kind: "meter",
      address: resource.address,
      action: "create" as const,
      call: "meters.create",
      input: meterCreatePayload(resource),
      dependsOn: [],
      preview: {
        title: "create Polar meter",
        lines: [`name: ${decodeMeterManagedV1(resource.managed).name}`],
      },
    },
  ]);

export const planMeterUpdate = (
  change: ResourceChange,
): Effect.Effect<ReadonlyArray<Operation>, ReturnType<typeof errorDiagnostic>> =>
  Effect.gen(function* () {
    if (change.after === undefined) {
      return yield* Effect.fail(
        errorDiagnostic({
          code: "PAAC_METER_UPDATE_MISSING_AFTER",
          message: "Cannot update a meter without desired canonical state.",
          address: change.address,
        }),
      );
    }
    if (change.providerId === undefined) {
      return yield* Effect.fail(
        errorDiagnostic({
          code: "PAAC_METER_UPDATE_MISSING_ID",
          message: "Cannot update a meter without a Polar meter ID.",
          address: change.address,
        }),
      );
    }
    const managed = decodeMeterManagedV1(change.after.managed);
    const meterUpdate = meterUpdatePayload(change, managed);
    return [
      {
        id: `meter.${change.action}:${change.address}`,
        provider: "polar" as const,
        kind: "meter",
        address: change.address,
        action: change.action === "unarchive" ? ("unarchive" as const) : ("update" as const),
        call: "meters.update",
        input: decodeJsonObject({ id: change.providerId, meterUpdate }),
        dependsOn: [],
        preview: {
          title: change.action === "unarchive" ? "unarchive Polar meter" : "update Polar meter",
          lines: change.diffs.map(
            (diff) =>
              `${diff.path}: ${JSON.stringify(diff.before)} -> ${JSON.stringify(diff.after)}`,
          ),
        },
      },
    ];
  });

export const planMeterArchive = (
  resource: CanonicalResource,
): Effect.Effect<ReadonlyArray<Operation>, ReturnType<typeof errorDiagnostic>> =>
  Effect.gen(function* () {
    if (resource.providerId === undefined) {
      return yield* Effect.fail(
        errorDiagnostic({
          code: "PAAC_METER_ARCHIVE_MISSING_ID",
          message: "Cannot archive a meter without a Polar meter ID.",
          address: resource.address,
        }),
      );
    }
    return [
      {
        id: `meter.archive:${resource.address}`,
        provider: "polar" as const,
        kind: "meter",
        address: resource.address,
        action: "archive" as const,
        call: "meters.update",
        input: decodeJsonObject({ id: resource.providerId, meterUpdate: { isArchived: true } }),
        dependsOn: [],
        preview: {
          title: "archive Polar meter",
          lines: ["isArchived: true"],
        },
      },
    ];
  });
