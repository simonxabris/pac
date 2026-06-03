import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ResourceAdapter } from "../../core/adapter.js";
import { AdapterRegistry } from "../../core/adapter-registry.js";
import { PolarClient } from "../../polar/service.js";
import { makeMeterAdapter } from "./resources/meter/adapter.js";
import { makeProductAdapter } from "./resources/product/adapter.js";

export const PolarAdapterRegistryLive = Layer.effect(
  AdapterRegistry,
  Effect.gen(function* () {
    const polar = yield* PolarClient;
    return AdapterRegistry.of(
      AdapterRegistry.make([
        makeProductAdapter(polar) as unknown as ResourceAdapter,
        makeMeterAdapter(polar) as unknown as ResourceAdapter,
      ]),
    );
  }),
);
