import type { Meter as RemoteMeter } from "@polar-sh/sdk/models/components/meter.js";
import type { Product as RemoteProduct } from "@polar-sh/sdk/models/components/product.js";
import { describe, expect, it } from "vitest";
import { deployConfig } from "./helpers/deploy.js";
import { e2eOrganizationFromEnv } from "./helpers/env.js";
import { findMeterByKey, findProductByKey, pacMetadata } from "./helpers/polar.js";

type RemoteProductPrice = RemoteProduct["prices"][number];

const requireMeter = (meter: RemoteMeter | undefined, key: string): RemoteMeter => {
  expect(meter, `Expected meter '${key}' to exist`).toBeDefined();
  if (meter === undefined) throw new Error(`Expected meter '${key}' to exist`);
  return meter;
};

const requireProduct = (product: RemoteProduct | undefined, key: string): RemoteProduct => {
  expect(product, `Expected product '${key}' to exist`).toBeDefined();
  if (product === undefined) throw new Error(`Expected product '${key}' to exist`);
  return product;
};

const activePrices = (product: RemoteProduct): Array<RemoteProductPrice> =>
  product.prices.filter((price) => !price.isArchived);

const priceByType = <T extends RemoteProductPrice["amountType"]>(
  product: RemoteProduct,
  amountType: T,
): Extract<RemoteProductPrice, { readonly amountType: T }> => {
  const price = activePrices(product).find((entry) => entry.amountType === amountType);
  expect(
    price,
    `Expected product '${product.id}' to have an active ${amountType} price`,
  ).toBeDefined();
  if (price === undefined) throw new Error(`Expected active ${amountType} price`);
  return price as Extract<RemoteProductPrice, { readonly amountType: T }>;
};

describe("metered Product e2e", () => {
  it("creates a Meter used by a metered Product price, then updates only the Meter", async () => {
    const org = e2eOrganizationFromEnv();

    await deployConfig("test/e2e/cases/metered-product/v1.config.ts", org.env);

    const meterV1 = requireMeter(
      await findMeterByKey(org, "metered-product-requests"),
      "metered-product-requests",
    );
    expect(meterV1.metadata.pac).toBe(pacMetadata("meter", "metered-product-requests"));
    expect(meterV1.archivedAt ?? null).toBeNull();
    expect(meterV1).toMatchObject({
      name: "E2E Metered Product Requests V1",
      unit: "custom",
      customLabel: "requests",
      customMultiplier: 1000,
      filter: {
        conjunction: "and",
        clauses: [
          { property: "name", operator: "eq", value: "request" },
          { property: "plan", operator: "eq", value: "pro" },
        ],
      },
      aggregation: { func: "sum", property: "quantity" },
    });

    const productV1 = requireProduct(
      await findProductByKey(org, "metered-product-pro"),
      "metered-product-pro",
    );
    expect(productV1.metadata.pac).toBe(pacMetadata("product", "metered-product-pro"));
    expect(productV1).toMatchObject({
      name: "E2E Metered Product Pro",
      description: "Fixed monthly fee plus metered request usage",
      recurringInterval: "month",
      recurringIntervalCount: 1,
      isArchived: false,
    });
    expect(activePrices(productV1)).toHaveLength(2);
    expect(priceByType(productV1, "fixed")).toMatchObject({
      priceCurrency: "usd",
      priceAmount: 2900,
      isArchived: false,
    });
    const meteredPriceV1 = priceByType(productV1, "metered_unit");
    expect(meteredPriceV1).toMatchObject({
      priceCurrency: "usd",
      capAmount: 10000,
      meterId: meterV1.id,
      isArchived: false,
    });
    expect(Number(meteredPriceV1.unitAmount)).toBe(1);

    const productId = productV1.id;
    const priceIds = activePrices(productV1)
      .map((price) => price.id)
      .sort();

    await deployConfig("test/e2e/cases/metered-product/v2.config.ts", org.env);

    const meterV2 = requireMeter(
      await findMeterByKey(org, "metered-product-requests"),
      "metered-product-requests",
    );
    expect(meterV2.id).toBe(meterV1.id);
    expect(meterV2.archivedAt ?? null).toBeNull();
    expect(meterV2).toMatchObject({
      name: "E2E Metered Product Requests V2",
      unit: "custom",
      customLabel: "API requests",
      customMultiplier: 1,
      filter: {
        conjunction: "and",
        clauses: [
          {
            conjunction: "or",
            clauses: [
              { property: "name", operator: "eq", value: "request" },
              { property: "name", operator: "eq", value: "api_request" },
            ],
          },
          { property: "plan", operator: "eq", value: "pro" },
        ],
      },
      aggregation: { func: "sum", property: "billable_quantity" },
    });

    const productV2 = requireProduct(
      await findProductByKey(org, "metered-product-pro"),
      "metered-product-pro",
    );
    expect(productV2.id).toBe(productId);
    expect(
      activePrices(productV2)
        .map((price) => price.id)
        .sort(),
    ).toEqual(priceIds);
    const meteredPriceV2 = priceByType(productV2, "metered_unit");
    expect(meteredPriceV2).toMatchObject({
      meterId: meterV2.id,
      capAmount: 10000,
      isArchived: false,
    });
    expect(Number(meteredPriceV2.unitAmount)).toBe(1);
  });
});
