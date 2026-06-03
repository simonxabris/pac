import type * as Effect from "effect/Effect";
import type { Product as RemoteProduct } from "@polar-sh/sdk/models/components/product.js";

export type { Product as RemoteProduct } from "@polar-sh/sdk/models/components/product.js";

export type PolarClient<R = never> = {
  readonly listProducts: Effect.Effect<ReadonlyArray<RemoteProduct>, Error, R>;
};
