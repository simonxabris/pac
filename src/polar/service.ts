import { Polar } from "@polar-sh/sdk";
import type { ProductCreate } from "@polar-sh/sdk/models/components/productcreate.js";
import type { ProductUpdate } from "@polar-sh/sdk/models/components/productupdate.js";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { AppConfig } from "../config/service.js";
import type { ProductCreatePayload, ProductUpdatePayload } from "../resources/product.js";
import type { RemoteProduct } from "./client.js";

export type PolarClientShape = {
  readonly listProducts: () => Effect.Effect<ReadonlyArray<RemoteProduct>, Error>;
  readonly createProduct: (payload: ProductCreatePayload) => Effect.Effect<void>;
  readonly updateProduct: (id: string, payload: ProductUpdatePayload) => Effect.Effect<void>;
  readonly archiveProduct: (id: string) => Effect.Effect<void>;
};

const fromPromise = <A>(try_: () => Promise<A>): Effect.Effect<A> =>
  Effect.tryPromise({ try: try_, catch: (cause) => cause }).pipe(Effect.orDie);

export class PolarClient extends Context.Service<PolarClient, PolarClientShape>()(
  "@paac/PolarClient",
) {
  static readonly layer = Layer.effect(
    PolarClient,
    Effect.gen(function*() {
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

      return PolarClient.of({ listProducts, createProduct, updateProduct, archiveProduct });
    }),
  );
}
