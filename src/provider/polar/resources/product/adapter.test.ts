import type { Meter as RemoteMeter } from "@polar-sh/sdk/models/components/meter.js";
import type { Product as RemoteProduct } from "@polar-sh/sdk/models/components/product.js";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { encodePaacMetadata } from "../../../../core/metadata.js";
import type { DesiredResource } from "../../../../core/resource.js";
import type { PolarClientShape } from "../../../../polar/service.js";
import { makeProductAdapter } from "./adapter.js";

const fakePolar: PolarClientShape = {
  listProducts: () => Effect.succeed([]),
  createProduct: () => Effect.void,
  updateProduct: () => Effect.void,
  archiveProduct: () => Effect.void,
  listMeters: () => Effect.succeed([]),
  createMeter: () => Effect.void,
  updateMeter: () => Effect.void,
  archiveMeter: () => Effect.void,
};

const adapter = makeProductAdapter(fakePolar);

const productIdentity = {
  version: 1 as const,
  kind: "product",
  address: "product.pro" as const,
  key: "pro",
};

const meterIdentity = {
  version: 1 as const,
  kind: "meter",
  address: "meter.requests" as const,
  key: "requests",
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
        id: "price-base",
        amountType: "fixed",
        priceAmount: 2000,
        priceCurrency: "USD",
      },
    ],
    ...overrides,
  }) as RemoteProduct;

const remoteMeter = (overrides: Partial<RemoteMeter> = {}): RemoteMeter =>
  ({
    id: "polar-meter-id",
    name: "Requests",
    unit: "custom",
    customLabel: "request",
    customMultiplier: 1,
    filter: {
      conjunction: "and",
      clauses: [{ property: "event", operator: "eq", value: "api.request" }],
    },
    aggregation: { func: "count" },
    metadata: encodePaacMetadata(meterIdentity),
    archivedAt: null,
    ...overrides,
  }) as RemoteMeter;

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

  it("normalizes remote metered prices through managed Meter metadata", () => {
    const adapterWithMeter = makeProductAdapter({
      ...fakePolar,
      listMeters: () => Effect.succeed([remoteMeter()]),
    });

    const canonical = Effect.runSync(
      adapterWithMeter.normalizeRemote(
        remoteProduct({
          prices: [
            { id: "price-base", amountType: "fixed", priceAmount: 2000, priceCurrency: "usd" },
            {
              id: "price-requests",
              amountType: "metered_unit",
              priceCurrency: "usd",
              unitAmount: "0.1",
              capAmount: null,
              meterId: "polar-meter-id",
            },
          ] as RemoteProduct["prices"],
        }),
        {},
      ),
    );

    expect(canonical).toMatchObject({
      managed: {
        prices: [
          { key: "base", type: "fixed", amount: 2000, currency: "usd" },
          {
            key: "meter:requests",
            type: "meteredUnit",
            meter: "meter.requests",
            unitAmount: "0.1",
            currency: "usd",
            capAmount: null,
          },
        ],
      },
      raw: { priceIdsByKey: { base: "price-base", "meter:requests": "price-requests" } },
    });
  });

  it("preserves unchanged existing prices when planning price updates", () => {
    const before = Effect.runSync(adapter.normalizeRemote(remoteProduct(), {}));
    const meteredPrice = {
      key: "meter:requests",
      type: "meteredUnit" as const,
      meter: "meter.requests",
      unitAmount: "0.1",
      currency: "usd",
      capAmount: null,
    };
    const after = Effect.runSync(
      adapter.normalizeDesired(
        {
          kind: "product",
          key: "pro",
          address: "product.pro",
          dependencies: ["meter.requests"],
          config: {
            managed: {
              name: "Pro plan",
              description: null,
              visibility: "public",
              isArchived: false,
              billing: { recurringInterval: "month", recurringIntervalCount: 1 },
              prices: [
                { key: "base", type: "fixed", amount: 2000, currency: "usd" },
                meteredPrice,
              ],
            },
          },
        },
        {},
      ),
    );

    const operations = Effect.runSync(
      adapter.planUpdate(
        {
          address: "product.pro",
          kind: "product",
          providerId: "polar-product-id",
          action: "update",
          before,
          after,
          diffs: [
            {
              path: "/prices/meter:requests",
              before: undefined,
              after: meteredPrice,
              change: "added",
              rule: { mode: "custom", handler: "productPrices" },
            },
          ],
          operations: [],
          dependsOn: ["meter.requests"],
        },
        {},
      ),
    );

    expect(operations[0]?.input).toMatchObject({
      productUpdate: {
        prices: [
          { id: "price-base" },
          {
            amountType: "metered_unit",
            meterAddress: "meter.requests",
            unitAmount: "0.1",
            priceCurrency: "usd",
            capAmount: null,
          },
        ],
      },
    });
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
    expect(
      adapter.getRemoteIdentity(remoteProduct({ metadata: { paac: "not-json" } })),
    ).toMatchObject({
      _tag: "malformed",
      diagnostic: { severity: "error", code: "PAAC_MALFORMED_METADATA" },
    });
  });
});
