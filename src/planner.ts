import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";
import { ResourceAddress as ResourceAddressSchema, type ResourceAddress } from "./core/address.js";
import type { DesiredResource } from "./core/resource.js";
import { getResources } from "./resources/registry.js";

export type DesiredResourceMap = ReadonlyMap<ResourceAddress, DesiredResource>;

export type Plan = {
  readonly desiredResources: ReadonlyArray<DesiredResource>;
  readonly desiredResourcesByAddress: DesiredResourceMap;
};

export class DuplicateDesiredResourceAddress extends Schema.TaggedErrorClass<DuplicateDesiredResourceAddress>()(
  "DuplicateDesiredResourceAddress",
  {
    address: ResourceAddressSchema,
  },
) { }

export const collectDesiredResources = (): ReadonlyArray<DesiredResource> =>
  getResources().map((resource) => resource.toDesiredResource());

export const indexDesiredResources = (
  desiredResources: ReadonlyArray<DesiredResource>,
): Effect.Effect<DesiredResourceMap, DuplicateDesiredResourceAddress> =>
  Effect.gen(function*() {
    const byAddress = new Map<ResourceAddress, DesiredResource>();

    for (const resource of desiredResources) {
      if (byAddress.has(resource.address)) {
        return yield* new DuplicateDesiredResourceAddress({ address: resource.address });
      }

      byAddress.set(resource.address, resource);
    }

    return byAddress;
  });

export class Planner extends Context.Service<
  Planner,
  {
    readonly plan: () => Effect.Effect<Plan, DuplicateDesiredResourceAddress>;
  }
>()("@app/Planner") {
  static readonly layer = Layer.sync(Planner, () => ({
    plan: () =>
      Effect.gen(function*() {
        const desiredResources = collectDesiredResources();
        const desiredResourcesByAddress = yield* indexDesiredResources(desiredResources);

        return {
          desiredResources,
          desiredResourcesByAddress,
        } satisfies Plan;
      }),
  }));
}
