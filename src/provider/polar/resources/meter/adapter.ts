import type { Meter as RemoteMeter } from "@polar-sh/sdk/models/components/meter.js";
import * as Effect from "effect/Effect";
import { decodeJsonObject } from "../../../../core/json.js";
import {
  decodePaacMetadata,
  decodePaacMetadataResult,
  type ManagedIdentity,
} from "../../../../core/metadata.js";
import type { ResourceAdapter } from "../../../../core/adapter.js";
import { errorDiagnostic } from "../../../../core/diagnostic.js";
import type { FieldSemantics } from "../../../../core/field-semantics.js";
import type { CanonicalResource, DesiredResource } from "../../../../core/resource.js";
import type { PolarClientShape } from "../../../../polar/service.js";
import { planMeterArchive, planMeterCreate, planMeterUpdate } from "./operations.js";
import { decodeMeterDesiredConfig, decodeRemoteMeterV1, meterManagedJson } from "./schema.js";

export const meterFieldSemantics: FieldSemantics = [
  { path: "/name", rule: { mode: "update" } },
  { path: "/unit", rule: { mode: "update" } },
  { path: "/customLabel", rule: { mode: "update" } },
  { path: "/customMultiplier", rule: { mode: "update" } },
  { path: "/filter", rule: { mode: "update" } },
  { path: "/aggregation", rule: { mode: "update" } },
  { path: "/isArchived", rule: { mode: "update" } },
];

const identityForDesired = (desired: DesiredResource): ManagedIdentity => ({
  version: 1,
  kind: "meter",
  address: desired.address,
  key: desired.key,
});

export const makeMeterAdapter = (polar: PolarClientShape): ResourceAdapter<RemoteMeter> => ({
  kind: "meter",
  listRemote: polar.listMeters,
  getRemoteIdentity: (remote) => decodePaacMetadataResult(remote.metadata),
  fieldSemantics: meterFieldSemantics,
  normalizeDesired: (desired) =>
    Effect.gen(function* () {
      try {
        const config = decodeMeterDesiredConfig(desired.config);
        return {
          kind: "meter",
          address: desired.address,
          provider: "polar" as const,
          managed: meterManagedJson(config.managed),
          metadata: identityForDesired(desired),
          raw: decodeJsonObject({}),
        } satisfies CanonicalResource;
      } catch {
        return yield* Effect.fail(
          errorDiagnostic({
            code: "PAAC_INVALID_METER_CONFIG",
            message: `Desired meter ${desired.address} does not match the Meter adapter schema.`,
            address: desired.address,
          }),
        );
      }
    }),
  normalizeRemote: (remote) =>
    Effect.gen(function* () {
      let meter: ReturnType<typeof decodeRemoteMeterV1>;
      try {
        meter = decodeRemoteMeterV1(remote);
      } catch {
        const identity = decodePaacMetadata(remote.metadata);
        return yield* Effect.fail(
          errorDiagnostic({
            code: "PAAC_UNSUPPORTED_REMOTE_SHAPE",
            message:
              "Remote meter does not match the Polar meter schema supported by this adapter.",
            ...(identity === undefined ? {} : { address: identity.address }),
          }),
        );
      }

      const identity = decodePaacMetadata(meter.metadata);
      if (identity === undefined) {
        return yield* Effect.fail(
          errorDiagnostic({
            code: "PAAC_MISSING_REMOTE_IDENTITY",
            message: "Remote meter is missing PAAC managed identity metadata.",
          }),
        );
      }
      if (identity.kind !== "meter") {
        return yield* Effect.fail(
          errorDiagnostic({
            code: "PAAC_REMOTE_KIND_MISMATCH",
            message: `Remote metadata kind ${identity.kind} does not match meter adapter.`,
            address: identity.address,
          }),
        );
      }

      return {
        kind: "meter",
        address: identity.address,
        provider: "polar" as const,
        providerId: meter.id,
        managed: meterManagedJson({
          name: meter.name,
          unit: meter.unit,
          ...(meter.unit === "custom"
            ? {
                customLabel: meter.customLabel ?? null,
                customMultiplier: meter.customMultiplier ?? null,
              }
            : {}),
          filter: meter.filter,
          aggregation: meter.aggregation,
          isArchived: meter.archivedAt != null,
        }),
        metadata: identity,
        raw: remote,
      } satisfies CanonicalResource;
    }),
  planCreate: (resource) => planMeterCreate(resource),
  planUpdate: (change) => planMeterUpdate(change),
  planDelete: (resource) => planMeterArchive(resource),
});
