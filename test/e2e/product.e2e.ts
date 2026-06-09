import type { Product as RemoteProduct } from "@polar-sh/sdk/models/components/product.js";
import { describe, expect, it } from "vitest";
import { deployConfig } from "./helpers/deploy.js";
import { e2eOrganizationFromEnv } from "./helpers/env.js";
import {
  findProductByKey,
  findProductsByKey,
  getProductById,
  pacMetadata,
} from "./helpers/polar.js";

type RemoteProductPrice = RemoteProduct["prices"][number];

const activePrices = (product: RemoteProduct): Array<RemoteProductPrice> =>
  product.prices.filter((price) => !price.isArchived);

const requireProduct = (product: RemoteProduct | undefined, key: string): RemoteProduct => {
  expect(product, `Expected product '${key}' to exist`).toBeDefined();
  if (product === undefined) throw new Error(`Expected product '${key}' to exist`);
  return product;
};

const onlyActivePrice = (product: RemoteProduct): RemoteProductPrice => {
  const prices = activePrices(product);
  expect(prices).toHaveLength(1);
  const [price] = prices;
  if (price === undefined) throw new Error(`Expected ${product.id} to have one active price`);
  return price;
};

const expectManagedProduct = (product: RemoteProduct, key: string): void => {
  expect(product.metadata.pac).toBe(pacMetadata("product", key));
};

describe("product e2e", () => {
  it("creates Products with the supported Product shape and price variants", async () => {
    const org = e2eOrganizationFromEnv();

    await deployConfig("test/e2e/cases/product-full-shape/pac.config.ts", org.env);

    const fixedRecurring = requireProduct(
      await findProductByKey(org, "full-shape-fixed-recurring"),
      "full-shape-fixed-recurring",
    );
    expectManagedProduct(fixedRecurring, "full-shape-fixed-recurring");
    expect(fixedRecurring).toMatchObject({
      name: "E2E Full Shape Fixed Recurring",
      description: "Full Product shape created by PAC E2E",
      visibility: "private",
      recurringInterval: "month",
      recurringIntervalCount: 2,
      isArchived: false,
    });
    expect(onlyActivePrice(fixedRecurring)).toMatchObject({
      amountType: "fixed",
      priceCurrency: "usd",
      priceAmount: 3000,
      isArchived: false,
    });

    const freeOneTime = requireProduct(
      await findProductByKey(org, "full-shape-free"),
      "full-shape-free",
    );
    expectManagedProduct(freeOneTime, "full-shape-free");
    expect(freeOneTime).toMatchObject({
      name: "E2E Full Shape Free",
      description: "Free Product price created by PAC E2E",
      visibility: "public",
      recurringInterval: null,
      recurringIntervalCount: null,
      isArchived: false,
    });
    expect(onlyActivePrice(freeOneTime)).toMatchObject({
      amountType: "free",
      priceCurrency: "usd",
      isArchived: false,
    });

    const customOneTime = requireProduct(
      await findProductByKey(org, "full-shape-custom"),
      "full-shape-custom",
    );
    expectManagedProduct(customOneTime, "full-shape-custom");
    expect(customOneTime).toMatchObject({
      name: "E2E Full Shape Custom",
      description: "Custom Product price created by PAC E2E",
      visibility: "draft",
      recurringInterval: null,
      recurringIntervalCount: null,
      isArchived: false,
    });
    expect(onlyActivePrice(customOneTime)).toMatchObject({
      amountType: "custom",
      priceCurrency: "usd",
      minimumAmount: 500,
      maximumAmount: 5000,
      presetAmount: 1000,
      isArchived: false,
    });
  });

  it("deploys the same Product config idempotently", async () => {
    const org = e2eOrganizationFromEnv();
    const config = "test/e2e/cases/product-idempotent/pac.config.ts";

    await deployConfig(config, org.env);
    const productAfterFirstDeploy = requireProduct(
      await findProductByKey(org, "idempotent"),
      "idempotent",
    );
    const firstProductId = productAfterFirstDeploy.id;
    const firstActivePriceIds = activePrices(productAfterFirstDeploy).map((price) => price.id);

    await deployConfig(config, org.env);

    const products = await findProductsByKey(org, "idempotent");
    expect(products).toHaveLength(1);
    const productAfterSecondDeploy = requireProduct(products[0], "idempotent");
    expect(productAfterSecondDeploy.id).toBe(firstProductId);
    expect(productAfterSecondDeploy.isArchived).toBe(false);
    expect(activePrices(productAfterSecondDeploy).map((price) => price.id)).toEqual(
      firstActivePriceIds,
    );
  });

  it("updates mutable Product fields while keeping the same Product identity", async () => {
    const org = e2eOrganizationFromEnv();

    await deployConfig("test/e2e/cases/product-update/v1.config.ts", org.env);
    const productV1 = requireProduct(
      await findProductByKey(org, "update-mutable"),
      "update-mutable",
    );
    const productId = productV1.id;
    const priceV1 = onlyActivePrice(productV1);
    expect(priceV1).toMatchObject({ amountType: "fixed", priceCurrency: "usd", priceAmount: 1000 });

    await deployConfig("test/e2e/cases/product-update/v2.config.ts", org.env);

    const productV2 = requireProduct(
      await findProductByKey(org, "update-mutable"),
      "update-mutable",
    );
    expect(productV2.id).toBe(productId);
    expect(productV2).toMatchObject({
      name: "E2E Mutable Product V2",
      description: "After mutable update",
      visibility: "public",
      isArchived: false,
    });
    const priceV2 = onlyActivePrice(productV2);
    expect(priceV2).toMatchObject({
      amountType: "fixed",
      priceCurrency: "usd",
      priceAmount: 2000,
      isArchived: false,
    });
    expect(priceV2.id).not.toBe(priceV1.id);
  });

  it("blocks immutable recurring interval changes and leaves the remote Product unchanged", async () => {
    const org = e2eOrganizationFromEnv();

    await deployConfig("test/e2e/cases/product-immutable/v1.config.ts", org.env);
    const productV1 = requireProduct(
      await findProductByKey(org, "immutable-recurring"),
      "immutable-recurring",
    );
    const productId = productV1.id;
    expect(productV1).toMatchObject({
      recurringInterval: "month",
      recurringIntervalCount: 1,
      isArchived: false,
    });

    await expect(
      deployConfig("test/e2e/cases/product-immutable/v2.config.ts", org.env),
    ).rejects.toThrow(/product\.recurringInterval\.immutable/);

    const productAfterFailedDeploy = requireProduct(
      await findProductByKey(org, "immutable-recurring"),
      "immutable-recurring",
    );
    expect(productAfterFailedDeploy.id).toBe(productId);
    expect(productAfterFailedDeploy).toMatchObject({
      recurringInterval: "month",
      recurringIntervalCount: 1,
      isArchived: false,
    });
  });

  it("archives a Product when it is removed from config", async () => {
    const org = e2eOrganizationFromEnv();

    await deployConfig("test/e2e/cases/product-archive/with-product.config.ts", org.env);
    const productBeforeRemoval = requireProduct(
      await findProductByKey(org, "archive-me"),
      "archive-me",
    );
    expect(productBeforeRemoval.isArchived).toBe(false);

    await deployConfig("test/e2e/cases/product-archive/empty.config.ts", org.env);

    const productAfterRemoval = await getProductById(org, productBeforeRemoval.id);
    expect(productAfterRemoval.id).toBe(productBeforeRemoval.id);
    expect(productAfterRemoval.isArchived).toBe(true);

    await deployConfig("test/e2e/cases/product-archive/empty.config.ts", org.env);
    const productAfterSecondRemoval = await getProductById(org, productBeforeRemoval.id);
    expect(productAfterSecondRemoval.id).toBe(productBeforeRemoval.id);
    expect(productAfterSecondRemoval.isArchived).toBe(true);
  });
});
