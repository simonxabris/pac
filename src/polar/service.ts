import { Polar } from "@polar-sh/sdk";
import type { MeterCreate } from "@polar-sh/sdk/models/components/metercreate.js";
import type { MeterUpdate } from "@polar-sh/sdk/models/components/meterupdate.js";
import type { ProductCreate } from "@polar-sh/sdk/models/components/productcreate.js";
import type { ProductUpdate } from "@polar-sh/sdk/models/components/productupdate.js";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { AppConfig } from "../config/service.js";
import type { MeterCreatePayload, MeterUpdatePayload } from "../resources/meter.js";
import type { ProductCreatePayload, ProductUpdatePayload } from "../resources/product.js";
import type { RemoteMeter, RemoteProduct } from "./client.js";

export type PolarClientShape = {
  readonly listProducts: () => Effect.Effect<ReadonlyArray<RemoteProduct>, Error>;
  readonly createProduct: (payload: ProductCreatePayload) => Effect.Effect<void>;
  readonly updateProduct: (id: string, payload: ProductUpdatePayload) => Effect.Effect<void>;
  readonly archiveProduct: (id: string) => Effect.Effect<void>;
  readonly listMeters: () => Effect.Effect<ReadonlyArray<RemoteMeter>, Error>;
  readonly createMeter: (payload: MeterCreatePayload) => Effect.Effect<void>;
  readonly updateMeter: (id: string, payload: MeterUpdatePayload) => Effect.Effect<void>;
  readonly archiveMeter: (id: string) => Effect.Effect<void>;
};

const fromPromise = <A>(try_: () => Promise<A>): Effect.Effect<A> =>
  Effect.tryPromise({ try: try_, catch: (cause) => cause }).pipe(Effect.orDie);

export class PolarClient extends Context.Service<PolarClient, PolarClientShape>()(
  "@paac/PolarClient",
) {
  static readonly layer = Layer.effect(
    PolarClient,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const sdk = new Polar({
        accessToken: Redacted.value(config.polarAccessToken),
        server: "sandbox",
      });

      const listProducts = Effect.fn("PolarClient.listProducts")(() =>
        fromPromise(async () => {
          const iterator = await sdk.products.list({ limit: 100 });
          const products: Array<RemoteProduct> = [];
          for await (const page of iterator) {
            products.push(...page.result.items);
          }
          return products;
        }),
      );

      const createProduct = Effect.fn("PolarClient.createProduct")(
        (payload: ProductCreatePayload) =>
          fromPromise(() => sdk.products.create(payload as ProductCreate)).pipe(Effect.asVoid),
      );

      const updateProduct = Effect.fn("PolarClient.updateProduct")(
        (id: string, payload: ProductUpdatePayload) =>
          fromPromise(() =>
            sdk.products.update({ id, productUpdate: payload as ProductUpdate }),
          ).pipe(Effect.asVoid),
      );

      const archiveProduct = Effect.fn("PolarClient.archiveProduct")((id: string) =>
        updateProduct(id, { isArchived: true }),
      );

      const listMeters = Effect.fn("PolarClient.listMeters")(() =>
        fromPromise(async () => {
          const iterator = await sdk.meters.list({ limit: 100 });
          const meters: Array<RemoteMeter> = [];
          for await (const page of iterator) {
            meters.push(...page.result.items);
          }
          return meters;
        }),
      );

      const createMeter = Effect.fn("PolarClient.createMeter")((payload: MeterCreatePayload) =>
        fromPromise(() => sdk.meters.create(payload as MeterCreate)).pipe(Effect.asVoid),
      );

      const updateMeter = Effect.fn("PolarClient.updateMeter")(
        (id: string, payload: MeterUpdatePayload) =>
          fromPromise(() => sdk.meters.update({ id, meterUpdate: payload as MeterUpdate })).pipe(
            Effect.asVoid,
          ),
      );

      const archiveMeter = Effect.fn("PolarClient.archiveMeter")((id: string) =>
        updateMeter(id, { isArchived: true }),
      );

      return PolarClient.of({
        listProducts,
        createProduct,
        updateProduct,
        archiveProduct,
        listMeters,
        createMeter,
        updateMeter,
        archiveMeter,
      });
    }),
  );
}
