import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Executor } from "./executor.js";
import type { OperationProgram } from "./operation-planner/types.js";
import type { OperationAction } from "./operations/actions.js";
import type { ResourceBindings } from "./operations/bindings.js";
import type { Operation, RollbackAction } from "./operations/operation.js";
import type { MeterCreateOperationPayload } from "./operations/payloads/meter.js";
import type {
  ProductCreateOperationPayload,
  ProductUpdateOperationPayload,
} from "./operations/payloads/product.js";
import type { OperationRef } from "./operations/ref.js";
import type { PolarClientShape } from "./polar/service.js";
import { PolarClient } from "./polar/service.js";
import type { ResourceAddress } from "./core/address.js";
import type { ResourceKind } from "./core/kind.js";
import type { RemoteMeter, RemoteProduct } from "./polar/client.js";

type PolarCall =
  | { readonly method: "createProduct"; readonly payload: unknown }
  | { readonly method: "updateProduct"; readonly id: string; readonly payload: unknown }
  | { readonly method: "archiveProduct"; readonly id: string }
  | { readonly method: "createMeter"; readonly payload: unknown }
  | { readonly method: "updateMeter"; readonly id: string; readonly payload: unknown }
  | { readonly method: "archiveMeter"; readonly id: string };

const address = <K extends ResourceKind>(kind: K, key: string): ResourceAddress<K> =>
  `${kind}.${key}` as ResourceAddress<K>;

const polarIdRef = (resourceAddress: ResourceAddress): OperationRef => ({
  _tag: "Ref",
  address: resourceAddress,
  field: "polarId",
});

const noopRollback = (reason = "Not relevant for executor dispatch tests."): RollbackAction => ({
  _tag: "NoopRollback",
  reason,
});

const operation = (input: {
  readonly id: string;
  readonly address: ResourceAddress;
  readonly kind: ResourceKind;
  readonly action: OperationAction;
  readonly rollback?: RollbackAction;
}): Operation => ({
  _tag: "Operation",
  id: input.id,
  address: input.address,
  kind: input.kind,
  action: input.action,
  rollback: input.rollback ?? noopRollback(),
});

const createProductOperation = (
  key: string,
  payload: ProductCreateOperationPayload,
): Operation => operation({
  id: `op_create_product_${key}`,
  address: address("product", key),
  kind: "product",
  action: { _tag: "CreateProduct", payload },
});

const updateProductOperation = (
  key: string,
  id: string,
  payload: ProductUpdateOperationPayload,
): Operation => operation({
  id: `op_update_product_${key}`,
  address: address("product", key),
  kind: "product",
  action: { _tag: "UpdateProduct", id, payload },
});

const archiveProductOperation = (key: string, id: string): Operation => operation({
  id: `op_archive_product_${key}`,
  address: address("product", key),
  kind: "product",
  action: { _tag: "ArchiveProduct", id, payload: { isArchived: true } },
});

const createMeterOperation = (
  key: string,
  payload: MeterCreateOperationPayload,
): Operation => operation({
  id: `op_create_meter_${key}`,
  address: address("meter", key),
  kind: "meter",
  action: { _tag: "CreateMeter", payload },
});

const archiveMeterOperation = (key: string, id: string): Operation => operation({
  id: `op_archive_meter_${key}`,
  address: address("meter", key),
  kind: "meter",
  action: { _tag: "ArchiveMeter", id, payload: { isArchived: true } },
});

const program = (
  operations: ReadonlyArray<Operation>,
  initialBindings: ResourceBindings = new Map(),
): OperationProgram => ({ operations, initialBindings });

const bindings = (
  entries: ReadonlyArray<readonly [ResourceAddress, { readonly polarId: string }]>,
): ResourceBindings => new Map(entries);

const metadata = (kind: ResourceKind, key: string) => ({
  paac: JSON.stringify({
    v: 1,
    kind,
    addr: `${kind}.${key}`,
    key,
  }),
});

const fixedPrice = (amount: number, currency: "usd" | "eur" = "usd") => ({
  amountType: "fixed" as const,
  priceCurrency: currency,
  priceAmount: amount,
});

const meteredPrice = (meter: ResourceAddress, amount = "0.01", currency: "usd" | "eur" = "usd") => ({
  amountType: "metered_unit" as const,
  priceCurrency: currency,
  meterId: polarIdRef(meter),
  unitAmount: amount,
  capAmount: null,
});

const fakePolarClientLayer = (calls: Array<PolarCall>) =>
  Layer.succeed(
    PolarClient,
    PolarClient.of({
      listProducts: () => Effect.succeed([]),
      createProduct: (payload) =>
        Effect.sync(() => {
          calls.push({ method: "createProduct", payload });
          return { id: "prod_created" } as RemoteProduct;
        }),
      updateProduct: (id, payload) =>
        Effect.sync(() => {
          calls.push({ method: "updateProduct", id, payload });
          return { id } as RemoteProduct;
        }),
      archiveProduct: (id) =>
        Effect.sync(() => {
          calls.push({ method: "archiveProduct", id });
          return { id } as RemoteProduct;
        }),
      updateProductBenefits: (id) => Effect.succeed({ id } as RemoteProduct),
      listMeters: () => Effect.succeed([]),
      createMeter: (payload) =>
        Effect.sync(() => {
          calls.push({ method: "createMeter", payload });
          return { id: "met_created" } as RemoteMeter;
        }),
      updateMeter: (id, payload) =>
        Effect.sync(() => {
          calls.push({ method: "updateMeter", id, payload });
          return { id } as RemoteMeter;
        }),
      archiveMeter: (id) =>
        Effect.sync(() => {
          calls.push({ method: "archiveMeter", id });
          return { id } as RemoteMeter;
        }),
    } satisfies PolarClientShape),
  );

const testLayer = (calls: Array<PolarCall>) =>
  Executor.layer.pipe(Layer.provide(fakePolarClientLayer(calls)));

const execute = (input: OperationProgram, calls: Array<PolarCall>) =>
  Effect.gen(function*() {
    const executor = yield* Executor;
    yield* executor.execute(input);
  }).pipe(Effect.provide(testLayer(calls)));

describe("Executor product create dispatch", () => {
  it.effect("creates a product with all supported product fields and a fixed price", () =>
    Effect.gen(function*() {
      const calls: Array<PolarCall> = [];
      const payload: ProductCreateOperationPayload = {
        metadata: metadata("product", "pro"),
        name: "Pro",
        description: "For serious users",
        visibility: "private",
        prices: [fixedPrice(3000, "usd")],
        recurringInterval: "month",
        recurringIntervalCount: 3,
      };

      yield* execute(program([createProductOperation("pro", payload)]), calls);

      expect(calls).toEqual([
        {
          method: "createProduct",
          payload,
        },
      ]);
    }),
  );

  it.effect("creates a product with a resolved metered price", () =>
    Effect.gen(function*() {
      const calls: Array<PolarCall> = [];
      const meterAddress = address("meter", "requests");
      const payload: ProductCreateOperationPayload = {
        metadata: metadata("product", "pro"),
        name: "Pro",
        description: null,
        visibility: "public",
        prices: [meteredPrice(meterAddress, "0.05", "usd")],
        recurringInterval: "month",
        recurringIntervalCount: 1,
      };

      yield* execute(
        program(
          [createProductOperation("pro", payload)],
          bindings([[meterAddress, { polarId: "met_requests" }]]),
        ),
        calls,
      );

      expect(calls).toEqual([
        {
          method: "createProduct",
          payload: {
            ...payload,
            prices: [
              {
                amountType: "metered_unit",
                priceCurrency: "usd",
                meterId: "met_requests",
                unitAmount: "0.05",
                capAmount: null,
              },
            ],
          },
        },
      ]);
    }),
  );

  it.effect("creates a product with fixed and resolved metered prices", () =>
    Effect.gen(function*() {
      const calls: Array<PolarCall> = [];
      const meterAddress = address("meter", "requests");
      const payload: ProductCreateOperationPayload = {
        metadata: metadata("product", "pro"),
        name: "Pro",
        description: "Fixed subscription plus usage",
        visibility: "public",
        prices: [fixedPrice(2000, "usd"), meteredPrice(meterAddress, "0.01", "usd")],
        recurringInterval: "month",
        recurringIntervalCount: 1,
      };

      yield* execute(
        program(
          [createProductOperation("pro", payload)],
          bindings([[meterAddress, { polarId: "met_requests" }]]),
        ),
        calls,
      );

      expect(calls).toEqual([
        {
          method: "createProduct",
          payload: {
            ...payload,
            prices: [
              fixedPrice(2000, "usd"),
              {
                amountType: "metered_unit",
                priceCurrency: "usd",
                meterId: "met_requests",
                unitAmount: "0.01",
                capAmount: null,
              },
            ],
          },
        },
      ]);
    }),
  );
});

describe("Executor meter create dispatch", () => {
  it.effect("creates a meter with all supported meter fields", () =>
    Effect.gen(function*() {
      const calls: Array<PolarCall> = [];
      const payload: MeterCreateOperationPayload = {
        metadata: metadata("meter", "requests"),
        name: "Requests",
        unit: "custom",
        customLabel: "request",
        customMultiplier: 1000,
        filter: {
          conjunction: "and",
          clauses: [
            { property: "name", operator: "eq", value: "request" },
            {
              conjunction: "or",
              clauses: [
                { property: "metadata.plan", operator: "eq", value: "pro" },
                { property: "metadata.plan", operator: "eq", value: "business" },
              ],
            },
          ],
        },
        aggregation: { func: "sum", property: "metadata.tokens" },
      };

      yield* execute(program([createMeterOperation("requests", payload)]), calls);

      expect(calls).toEqual([
        {
          method: "createMeter",
          payload,
        },
      ]);
    }),
  );
});

describe("Executor product update dispatch", () => {
  it.effect("updates a product from one fixed price to fixed and resolved metered prices", () =>
    Effect.gen(function*() {
      const calls: Array<PolarCall> = [];
      const meterAddress = address("meter", "requests");
      const payload: ProductUpdateOperationPayload = {
        prices: [fixedPrice(3000, "usd"), meteredPrice(meterAddress, "0.02", "usd")],
      };

      yield* execute(
        program(
          [updateProductOperation("pro", "prod_pro", payload)],
          bindings([[meterAddress, { polarId: "met_requests" }]]),
        ),
        calls,
      );

      expect(calls).toEqual([
        {
          method: "updateProduct",
          id: "prod_pro",
          payload: {
            prices: [
              fixedPrice(3000, "usd"),
              {
                amountType: "metered_unit",
                priceCurrency: "usd",
                meterId: "met_requests",
                unitAmount: "0.02",
                capAmount: null,
              },
            ],
          },
        },
      ]);
    }),
  );
});

describe("Executor archive dispatch", () => {
  it.effect("archives a product", () =>
    Effect.gen(function*() {
      const calls: Array<PolarCall> = [];

      yield* execute(program([archiveProductOperation("pro", "prod_pro")]), calls);

      expect(calls).toEqual([
        {
          method: "archiveProduct",
          id: "prod_pro",
        },
      ]);
    }),
  );

  it.effect("archives a meter", () =>
    Effect.gen(function*() {
      const calls: Array<PolarCall> = [];

      yield* execute(program([archiveMeterOperation("requests", "met_requests")]), calls);

      expect(calls).toEqual([
        {
          method: "archiveMeter",
          id: "met_requests",
        },
      ]);
    }),
  );
});
