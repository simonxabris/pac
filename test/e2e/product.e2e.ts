import { describe, expect, it } from "vitest";
import { deployConfig } from "./helpers/deploy.js";
import { e2eOrganizationFromEnv } from "./helpers/env.js";
import { findProductByKey } from "./helpers/polar.js";

describe("product e2e", () => {
  it("creates a product", async () => {
    const org = e2eOrganizationFromEnv();

    const productBeforeDeploy = await findProductByKey(org, "starter");
    expect(productBeforeDeploy).toBeUndefined();

    await deployConfig("test/e2e/cases/create-product/paac.config.ts", org.env);

    const product = await findProductByKey(org, "starter");
    expect(product).toBeDefined();
    expect(product?.name).toBe("E2E Starter Product");
  });
});
