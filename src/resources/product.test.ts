import { describe, it, expect, beforeEach } from "vitest";
import { Product, fixedPrice, freePrice, customPrice, meteredUnitPrice, productSpec } from "./product.js";
import { Benefit } from "./benefit.js";
import { Meter } from "./meter.js";
import { resetRegistry } from "./registry.js";

describe("Product", () => {
  beforeEach(() => {
    resetRegistry();
  });

  describe("fixed price product", () => {
    it("creates a product with a fixed price", () => {
      const product = new Product("premium", {
        name: "Premium Plan",
        prices: [fixedPrice({ amount: "2000", currency: "usd" })],
      });

      const resource = product.toDesiredResource();

      expect(resource).toEqual({
        source: "desired",
        kind: "product",
        key: "premium",
        address: "product.premium",
        spec: {
          name: "Premium Plan",
          description: null,
          prices: [{ type: "fixed", amount: "200000", currency: "usd" }],
          benefits: [],
          visibility: "public",
          recurringInterval: null,
          recurringIntervalCount: null,
        },
      });
    });

    it("normalizes a numeric fixed price amount to minor units", () => {
      const product = new Product("numeric", {
        name: "Numeric Amount Plan",
        prices: [fixedPrice({ amount: 1500, currency: "USD" })],
      });

      const resource = product.toDesiredResource();

      expect(resource.spec.prices[0]).toEqual({
        type: "fixed",
        amount: "150000",
        currency: "usd",
      });
    });

    it("normalizes user-facing major-unit fixed prices to canonical minor units", () => {
      const usdProduct = new Product("usd-major", {
        name: "USD Major Unit Plan",
        prices: [fixedPrice({ amount: 30, currency: "usd" })],
      });
      const jpyProduct = new Product("jpy-major", {
        name: "JPY Major Unit Plan",
        prices: [fixedPrice({ amount: 30, currency: "jpy" })],
      });

      expect(usdProduct.toDesiredResource().spec.prices[0]).toEqual({
        type: "fixed",
        amount: "3000",
        currency: "usd",
      });
      expect(jpyProduct.toDesiredResource().spec.prices[0]).toEqual({
        type: "fixed",
        amount: "30",
        currency: "jpy",
      });
    });
  });

  describe("free price product", () => {
    it("creates a product with a free price", () => {
      const product = new Product("free-tier", {
        name: "Free Tier",
        prices: [freePrice({ currency: "usd" })],
      });

      const resource = product.toDesiredResource();

      expect(resource).toEqual({
        source: "desired",
        kind: "product",
        key: "free-tier",
        address: "product.free-tier",
        spec: {
          name: "Free Tier",
          description: null,
          prices: [{ type: "free", currency: "usd" }],
          benefits: [],
          visibility: "public",
          recurringInterval: null,
          recurringIntervalCount: null,
        },
      });
    });
  });

  describe("custom price product", () => {
    it("creates a product with a custom price including all optional amounts", () => {
      const product = new Product("pay-what-you-want", {
        name: "Pay What You Want",
        prices: [
          customPrice({
            currency: "EUR",
            minimumAmount: "500",
            maximumAmount: "5000",
            presetAmount: "2000",
          }),
        ],
      });

      const resource = product.toDesiredResource();

      expect(resource.spec.prices[0]).toEqual({
        type: "custom",
        currency: "eur",
        minimumAmount: "50000",
        maximumAmount: "500000",
        presetAmount: "200000",
      });
    });

    it("creates a custom price with no optional amounts (all null)", () => {
      const product = new Product("donation", {
        name: "Donation",
        prices: [customPrice({ currency: "usd" })],
      });

      const resource = product.toDesiredResource();

      expect(resource.spec.prices[0]).toEqual({
        type: "custom",
        currency: "usd",
        minimumAmount: null,
        maximumAmount: null,
        presetAmount: null,
      });
    });

    it("normalizes numeric optional amounts to strings and null to null", () => {
      const product = new Product("donation-num", {
        name: "Donation Numeric",
        prices: [
          customPrice({
            currency: "usd",
            minimumAmount: 100,
            maximumAmount: null,
            presetAmount: 500,
          }),
        ],
      });

      const resource = product.toDesiredResource();

      expect(resource.spec.prices[0]).toEqual({
        type: "custom",
        currency: "usd",
        minimumAmount: "10000",
        maximumAmount: null,
        presetAmount: "50000",
      });
    });

    it("normalizes user-facing major-unit custom price amounts to canonical minor units", () => {
      const product = new Product("custom-major", {
        name: "Custom Major Unit Amounts",
        prices: [
          customPrice({
            currency: "usd",
            minimumAmount: 5,
            maximumAmount: 50,
            presetAmount: 10,
          }),
        ],
      });

      expect(product.toDesiredResource().spec.prices[0]).toEqual({
        type: "custom",
        currency: "usd",
        minimumAmount: "500",
        maximumAmount: "5000",
        presetAmount: "1000",
      });
    });
  });

  describe("metered unit price product", () => {
    it("creates a product with a metered unit price referencing a meter by address string", () => {
      const meter = new Meter("api-calls", {
        name: "API Calls",
        filter: { conjunction: "and", clauses: [{ property: "name", operator: "eq", value: "api_call" }] },
        aggregation: { func: "count" },
      });

      const product = new Product("api-product", {
        name: "API Product",
        prices: [meteredUnitPrice({ meter: meter.address, amount: "0.01", currency: "usd" })],
      });

      const resource = product.toDesiredResource();

      expect(resource.spec.prices[0]).toEqual({
        type: "meteredUnit",
        meter: "meter.api-calls",
        amount: "1",
        currency: "usd",
        capAmount: null,
      });
    });

    it("creates a metered unit price with capAmount", () => {
      const product = new Product("capped-api", {
        name: "Capped API",
        prices: [meteredUnitPrice({ meter: "meter.requests", amount: 0.05, currency: "usd", capAmount: "100" })],
      });

      const resource = product.toDesiredResource();

      expect(resource.spec.prices[0]).toEqual({
        type: "meteredUnit",
        meter: "meter.requests",
        amount: "5",
        currency: "usd",
        capAmount: "10000",
      });
    });

    it("normalizes user-facing major-unit metered price and cap amounts", () => {
      const product = new Product("metered-major", {
        name: "Metered Major Unit Amounts",
        prices: [
          meteredUnitPrice({
            meter: "meter.requests",
            amount: "0.001",
            currency: "usd",
            capAmount: 100,
          }),
        ],
      });

      expect(product.toDesiredResource().spec.prices[0]).toEqual({
        type: "meteredUnit",
        meter: "meter.requests",
        amount: "0.1",
        currency: "usd",
        capAmount: "10000",
      });
    });

    it("sets capAmount to null when omitted", () => {
      const product = new Product("uncapped-api", {
        name: "Uncapped API",
        prices: [meteredUnitPrice({ meter: "meter.requests", amount: "0.05", currency: "usd" })],
      });

      const resource = product.toDesiredResource();

      expect(resource.spec.prices[0].capAmount).toBeNull();
    });
  });

  describe("mixed prices product", () => {
    it("creates a product with all four price types preserving order", () => {
      const product = new Product("all-prices", {
        name: "All Prices",
        prices: [
          fixedPrice({ amount: "2000", currency: "usd" }),
          freePrice({ currency: "usd" }),
          customPrice({ currency: "usd", minimumAmount: "100", maximumAmount: "5000" }),
          meteredUnitPrice({ meter: "meter.api-calls", amount: "0.10", currency: "usd", capAmount: "50" }),
        ],
      });

      const resource = product.toDesiredResource();

      const prices = resource.spec.prices;
      expect(prices).toHaveLength(4);
      expect(prices[0]).toEqual({ type: "fixed", amount: "200000", currency: "usd" });
      expect(prices[1]).toEqual({ type: "free", currency: "usd" });
      expect(prices[2]).toEqual({
        type: "custom",
        currency: "usd",
        minimumAmount: "10000",
        maximumAmount: "500000",
        presetAmount: null,
      });
      expect(prices[3]).toEqual({
        type: "meteredUnit",
        meter: "meter.api-calls",
        amount: "10",
        currency: "usd",
        capAmount: "5000",
      });
    });
  });

  describe("benefits", () => {
    it("normalizes Benefit instance and address references, then sorts them", () => {
      const requests = new Meter("requests", {
        name: "Requests",
        filter: { conjunction: "and", clauses: [] },
        aggregation: { func: "count" },
      });
      const includedRequests = new Benefit("included-requests", {
        type: "meter-credit",
        description: "Included requests",
        meter: requests,
        units: 10_000,
      });

      const product = new Product("pro", {
        name: "Pro",
        prices: [freePrice({ currency: "usd" })],
        benefits: ["benefit.z-extra", includedRequests],
      });

      expect(product.toDesiredResource().spec.benefits).toEqual([
        "benefit.included-requests",
        "benefit.z-extra",
      ]);
    });

    it("rejects duplicate Benefit references", () => {
      const requests = new Meter("requests", {
        name: "Requests",
        filter: { conjunction: "and", clauses: [] },
        aggregation: { func: "count" },
      });
      const includedRequests = new Benefit("included-requests", {
        type: "meter-credit",
        description: "Included requests",
        meter: requests,
        units: 10_000,
      });
      const product = new Product("pro", {
        name: "Pro",
        prices: [freePrice({ currency: "usd" })],
        benefits: [includedRequests, "benefit.included-requests"],
      });

      expect(() => product.toDesiredResource()).toThrow(
        "Product benefits contain duplicate reference 'benefit.included-requests'.",
      );
    });

    it("defaults benefits to an empty authoritative set", () => {
      const product = new Product("pro", {
        name: "Pro",
        prices: [freePrice({ currency: "usd" })],
      });

      expect(product.toDesiredResource().spec.benefits).toEqual([]);
    });
  });

  describe("defaults and overrides", () => {
    it("defaults visibility to public", () => {
      const product = new Product("default-vis", {
        name: "Default Visibility",
        prices: [fixedPrice({ amount: "1000", currency: "usd" })],
      });

      const resource = product.toDesiredResource();

      expect(resource.spec.visibility).toBe("public");
    });

    it("allows visibility to be set to draft", () => {
      const product = new Product("draft-product", {
        name: "Draft Product",
        prices: [fixedPrice({ amount: "1000", currency: "usd" })],
        visibility: "draft",
      });

      const resource = product.toDesiredResource();

      expect(resource.spec.visibility).toBe("draft");
    });

    it("allows visibility to be set to private", () => {
      const product = new Product("private-product", {
        name: "Private Product",
        prices: [fixedPrice({ amount: "1000", currency: "usd" })],
        visibility: "private",
      });

      const resource = product.toDesiredResource();

      expect(resource.spec.visibility).toBe("private");
    });

    it("defaults description to null", () => {
      const product = new Product("no-desc", {
        name: "No Description",
        prices: [freePrice({ currency: "usd" })],
      });

      const resource = product.toDesiredResource();

      expect(resource.spec.description).toBeNull();
    });

    it("preserves description when provided", () => {
      const product = new Product("with-desc", {
        name: "With Description",
        description: "A great product",
        prices: [freePrice({ currency: "usd" })],
      });

      const resource = product.toDesiredResource();

      expect(resource.spec.description).toBe("A great product");
    });

    it("defaults recurringInterval and recurringIntervalCount to null", () => {
      const product = new Product("one-time", {
        name: "One Time",
        prices: [fixedPrice({ amount: "5000", currency: "usd" })],
      });

      const resource = product.toDesiredResource();

      expect(resource.spec.recurringInterval).toBeNull();
      expect(resource.spec.recurringIntervalCount).toBeNull();
    });

    it("sets recurringInterval and recurringIntervalCount when provided", () => {
      const product = new Product("monthly", {
        name: "Monthly Plan",
        prices: [fixedPrice({ amount: "2000", currency: "usd" })],
        recurringInterval: "month",
        recurringIntervalCount: 3,
      });

      const resource = product.toDesiredResource();

      expect(resource.spec.recurringInterval).toBe("month");
      expect(resource.spec.recurringIntervalCount).toBe(3);
    });

    it("defaults recurringIntervalCount to 1 when recurringInterval is set without count", () => {
      const product = new Product("monthly-default-count", {
        name: "Monthly Default Count",
        prices: [fixedPrice({ amount: "2000", currency: "usd" })],
        recurringInterval: "month",
      });

      const resource = product.toDesiredResource();

      expect(resource.spec.recurringIntervalCount).toBe(1);
    });
  });

  describe("resource envelope shape", () => {
    it("always has source=desired and kind=product", () => {
      const product = new Product("envelope-test", {
        name: "Envelope Test",
        prices: [freePrice({ currency: "usd" })],
      });

      const resource = product.toDesiredResource();

      expect(resource.source).toBe("desired");
      expect(resource.kind).toBe("product");
      expect(resource.key).toBe("envelope-test");
      expect(resource.address).toBe("product.envelope-test");
    });
  });

  describe("productSpec", () => {
    it("can be called directly to produce a spec", () => {
      const spec = productSpec({
        name: "Direct Spec",
        description: null,
        prices: [fixedPrice({ amount: "999", currency: "USD" })],
      });

      expect(spec).toEqual({
        name: "Direct Spec",
        description: null,
        prices: [{ type: "fixed", amount: "99900", currency: "usd" }],
        benefits: [],
        visibility: "public",
        recurringInterval: null,
        recurringIntervalCount: null,
      });
    });
  });
});