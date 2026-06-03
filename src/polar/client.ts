import type * as Effect from "effect/Effect";
import type { Meter as RemoteMeter } from "@polar-sh/sdk/models/components/meter.js";
import type { Product as RemoteProduct } from "@polar-sh/sdk/models/components/product.js";

export type { Meter as RemoteMeter } from "@polar-sh/sdk/models/components/meter.js";
export type { Product as RemoteProduct } from "@polar-sh/sdk/models/components/product.js";

export type PolarClient<R = never> = {
  readonly listProducts: Effect.Effect<ReadonlyArray<RemoteProduct>, Error, R>;
  readonly listMeters: Effect.Effect<ReadonlyArray<RemoteMeter>, Error, R>;
};
