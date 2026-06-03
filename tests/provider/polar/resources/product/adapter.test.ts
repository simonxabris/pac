import type { Product as RemoteProduct } from "@polar-sh/sdk/models/components/product.js";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { encodePaacMetadata } from "../../../../../src/core/metadata.js";
import type { DesiredResource } from "../../../../../src/core/resource.js";
import type { PolarClientShape } from "../../../../../src/polar/service.js";
import { makeProductAdapter } from "../../../../../src/provider/polar/resources/product/adapter.js";

const fakePolar: PolarClientShape = {
  listProducts: () => Effect.succeed([]),
  createProduct: () => Effect.void,
  updateProduct: () => Effect.void,
  archiveProduct: () => Effect.void,
};

const adapter = makeProductAdapter(fakePolar);

const productIdentity = {
  version: 1 as const,
  kind: "product",
  address: "product.pro" as const,
  key: "pro",
};

const remoteProduct = (overrides: Partial<RemoteProduct> = {}): RemoteProduct =>
  ({
    id: "polar-product-id",
    name: "Pro plan",
    description: null,
    visibility: "public",
    recurringInterval: "month",
    recurringIntervalCount: 1,
    isArchived: false,
    metadata: encodePaacMetadata(productIdentity),
    prices: [
      {
        amountType: "fixed",
        priceAmount: 2000,
        priceCurrency: "USD",
      },
    ],
    ...overrides,
  }) as RemoteProduct;

describe("Polar product adapter", () => {
  it("normalizes desired product config through Effect Schema", () => {
    const desired: DesiredResource = {
      kind: "product",
      key: "pro",
      address: "product.pro",
      dependencies: [],
      config: {
        managed: {
          name: "Pro plan",
          description: null,
          visibility: "public",
          isArchived: false,
          billing: { recurringInterval: "month", recurringIntervalCount: 1 },
          prices: [{ key: "base", type: "fixed", amount: 2000, currency: "usd" }],
        },
      },
    };

    const canonical = Effect.runSync(adapter.normalizeDesired(desired, {}));

    expect(canonical).toMatchObject({
      kind: "product",
      address: "product.pro",
      managed: {
        name: "Pro plan",
        prices: [{ key: "base", type: "fixed", amount: 2000, currency: "usd" }],
      },
    });
  });

  it("normalizes one remote static price into keyed canonical prices", () => {
    const canonical = Effect.runSync(adapter.normalizeRemote(remoteProduct(), {}));

    expect(canonical).toMatchObject({
      providerId: "polar-product-id",
      managed: {
        billing: { recurringInterval: "month", recurringIntervalCount: 1 },
        prices: [{ key: "base", type: "fixed", amount: 2000, currency: "usd" }],
      },
    });
  });

  it("normalizes active prices only", () => {
    const canonical = Effect.runSync(
      adapter.normalizeRemote(
        remoteProduct({
          prices: [
            { amountType: "fixed", priceAmount: 2000, priceCurrency: "usd" },
            { amountType: "fixed", priceAmount: 3000, priceCurrency: "usd", isArchived: true },
          ] as RemoteProduct["prices"],
        }),
        {},
      ),
    );

    expect(canonical.managed.prices).toEqual([
      { key: "base", type: "fixed", amount: 2000, currency: "usd" },
    ]);
  });

  it("blocks unsupported remote product price shapes instead of guessing defaults", () => {
    const diagnostic = Effect.runSync(
      adapter
        .normalizeRemote(
          remoteProduct({
            prices: [
              { amountType: "fixed", priceAmount: 2000, priceCurrency: "usd" },
              { amountType: "fixed", priceAmount: 3000, priceCurrency: "usd" },
            ] as RemoteProduct["prices"],
          }),
          {},
        )
        .pipe(
          Effect.match({
            onFailure: (error) => error,
            onSuccess: () => undefined,
          }),
        ),
    );

    expect(diagnostic).toMatchObject({
      severity: "error",
      code: "PAAC_UNSUPPORTED_REMOTE_SHAPE",
      address: "product.pro",
      path: "/prices",
    });
  });

  it("reports malformed paac metadata instead of treating it as unmanaged", () => {
    expect(adapter.getRemoteIdentity(remoteProduct({ metadata: { paac: "not-json" } }))).toMatchObject({
      _tag: "malformed",
      diagnostic: { severity: "error", code: "PAAC_MALFORMED_METADATA" },
    });
  });
});
