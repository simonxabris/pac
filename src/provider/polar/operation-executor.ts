import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { decodeJsonObject, isJsonObject, JsonObject, type JsonValue } from "../../core/json.js";
import { decodePaacMetadata } from "../../core/metadata.js";
import type { Operation } from "../../core/plan.js";
import { PolarClient, type PolarClientShape } from "../../polar/service.js";
import type { MeterCreatePayload, MeterUpdatePayload } from "../../resources/meter.js";
import type { ProductCreatePayload, ProductUpdatePayload } from "../../resources/product.js";

export type OperationResult = {
  readonly operationId: string;
};

export type OperationExecutorShape = {
  readonly canExecute: (operation: Operation) => boolean;
  readonly execute: (operation: Operation) => Effect.Effect<OperationResult, Error>;
};

const ProductsUpdateInput = Schema.Struct({
  id: Schema.String,
  productUpdate: JsonObject,
});
const MetersUpdateInput = Schema.Struct({
  id: Schema.String,
  meterUpdate: JsonObject,
});

const decodeProductsUpdateInput = Schema.decodeUnknownSync(ProductsUpdateInput);
const decodeMetersUpdateInput = Schema.decodeUnknownSync(MetersUpdateInput);

const hasUnresolvedMeterAddress = (value: JsonValue): boolean => {
  if (Array.isArray(value)) return value.some(hasUnresolvedMeterAddress);
  if (!isJsonObject(value)) return false;
  return (
    typeof value.meterAddress === "string" || Object.values(value).some(hasUnresolvedMeterAddress)
  );
};

const meterIdsByAddress = (polar: PolarClientShape) =>
  Effect.gen(function* () {
    const meters = yield* polar.listMeters();
    const map = new Map<string, string>();
    for (const meter of meters) {
      const identity = decodePaacMetadata(meter.metadata);
      if (identity?.kind === "meter") {
        map.set(identity.address, meter.id);
      }
    }
    return map;
  });

const resolveMeterAddresses = (
  value: JsonValue,
  idsByAddress: ReadonlyMap<string, string>,
): Effect.Effect<JsonValue, Error> =>
  Effect.gen(function* () {
    if (Array.isArray(value)) {
      return yield* Effect.forEach(value, (item) => resolveMeterAddresses(item, idsByAddress));
    }
    if (!isJsonObject(value)) return value;

    const entries: Array<readonly [string, JsonValue]> = [];
    for (const [key, child] of Object.entries(value)) {
      if (key === "meterAddress") continue;
      entries.push([key, yield* resolveMeterAddresses(child, idsByAddress)]);
    }

    if (typeof value.meterAddress === "string") {
      const meterId = idsByAddress.get(value.meterAddress);
      if (meterId === undefined) {
        return yield* Effect.fail(
          new Error(`Cannot resolve PAAC Meter address ${value.meterAddress} to a Polar meter ID.`),
        );
      }
      entries.push(["meterId", meterId]);
    }

    return decodeJsonObject(Object.fromEntries(entries));
  });

const resolveProductMeters = (
  polar: PolarClientShape,
  payload: JsonObject,
): Effect.Effect<JsonObject, Error> =>
  hasUnresolvedMeterAddress(payload)
    ? Effect.gen(function* () {
        const ids = yield* meterIdsByAddress(polar);
        return decodeJsonObject(yield* resolveMeterAddresses(payload, ids));
      })
    : Effect.succeed(payload);

export class PolarOperationExecutor extends Context.Service<
  PolarOperationExecutor,
  OperationExecutorShape
>()("@paac/PolarOperationExecutor") {
  static readonly layer = Layer.effect(
    PolarOperationExecutor,
    Effect.gen(function* () {
      const polar = yield* PolarClient;

      const execute = Effect.fn("PolarOperationExecutor.execute")(function* (operation: Operation) {
        switch (operation.call) {
          case "products.create": {
            const input = yield* resolveProductMeters(polar, operation.input);
            yield* polar.createProduct(input as ProductCreatePayload);
            return { operationId: operation.id };
          }
          case "products.update": {
            const input = decodeProductsUpdateInput(operation.input);
            const productUpdate = yield* resolveProductMeters(polar, input.productUpdate);
            yield* polar.updateProduct(input.id, productUpdate as ProductUpdatePayload);
            return { operationId: operation.id };
          }
          case "meters.create":
            yield* polar.createMeter(operation.input as MeterCreatePayload);
            return { operationId: operation.id };
          case "meters.update": {
            const input = decodeMetersUpdateInput(operation.input);
            yield* polar.updateMeter(input.id, input.meterUpdate as MeterUpdatePayload);
            return { operationId: operation.id };
          }
          default:
            return yield* Effect.fail(
              new Error(`No Polar executor for operation call ${operation.call}`),
            );
        }
      });

      return PolarOperationExecutor.of({
        canExecute: (operation) => operation.provider === "polar",
        execute,
      });
    }),
  );
}
