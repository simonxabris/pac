import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { RemoteBenefit, RemoteMeter, RemoteProduct } from "../types/polar-sdk-types.js";
import { PolarClient, PolarClientError } from "./polar-client.js";
import { managedMetadata } from "../resources/adapter-utils.js";
import { RemoteResourceFetcher } from "./remote-resource-fetcher.js";

const unused = <A>(operation: string): Effect.Effect<A, PolarClientError> =>
  Effect.fail(new PolarClientError({ operation, message: "not implemented in test" }));

const fakePolarClientLayer = ({
  products,
  meters,
  benefits,
  calls,
}: {
  readonly products: ReadonlyArray<RemoteProduct>;
  readonly meters: ReadonlyArray<RemoteMeter>;
  readonly benefits: ReadonlyArray<RemoteBenefit>;
  readonly calls: Array<string>;
}) =>
  Layer.succeed(
    PolarClient,
    PolarClient.of({
      listBenefits: () =>
        Effect.sync(() => {
          calls.push("listBenefits");
          return benefits;
        }),
      createBenefit: () => unused("createBenefit"),
      updateBenefit: () => unused("updateBenefit"),
      deleteBenefit: () => unused("deleteBenefit"),
      listProducts: () =>
        Effect.sync(() => {
          calls.push("listProducts");
          return products;
        }),
      createProduct: () => unused("createProduct"),
      updateProduct: () => unused("updateProduct"),
      archiveProduct: () => unused("archiveProduct"),
      updateProductBenefits: () => unused("updateProductBenefits"),
      listMeters: () =>
        Effect.sync(() => {
          calls.push("listMeters");
          return meters;
        }),
      createMeter: () => unused("createMeter"),
      updateMeter: () => unused("updateMeter"),
      archiveMeter: () => unused("archiveMeter"),
    }),
  );

describe("RemoteResourceFetcher.fetchInventory", () => {
  it.effect("fetches raw inventory without PAAC Metadata filtering", () => {
    const calls: Array<string> = [];
    const unmanagedMeter = { id: "met_unmanaged", metadata: {} } as unknown as RemoteMeter;
    const managedMeter = {
      id: "met_managed",
      metadata: managedMetadata("meter", "meter.tokens", "tokens"),
    } as unknown as RemoteMeter;
    const product = { id: "prod_unmanaged", metadata: {} } as unknown as RemoteProduct;
    const benefit = { id: "ben_unmanaged", metadata: {} } as unknown as RemoteBenefit;

    return Effect.gen(function* () {
      const fetcher = yield* RemoteResourceFetcher;

      const inventory = yield* fetcher.fetchInventory();

      expect(inventory).toEqual({
        products: [product],
        meters: [unmanagedMeter, managedMeter],
        benefits: [benefit],
      });
      expect(calls.sort()).toEqual(["listBenefits", "listMeters", "listProducts"]);
    }).pipe(
      Effect.provide(
        RemoteResourceFetcher.layer.pipe(
          Layer.provide(
            fakePolarClientLayer({
              products: [product],
              meters: [unmanagedMeter, managedMeter],
              benefits: [benefit],
              calls,
            }),
          ),
        ),
      ),
    );
  });
});
