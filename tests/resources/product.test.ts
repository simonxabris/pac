import { describe, expect, it } from "vitest";
import {
  and,
  count,
  eventName,
  fixedPrice,
  Meter,
  meteredUnitPrice,
  Product,
} from "../../src/index.js";

const requestsMeter = () =>
  new Meter("requests", {
    name: "Requests",
    unit: "custom",
    customLabel: "request",
    filter: and(eventName("eq", "api.request")),
    aggregation: count(),
  });

describe("Product resource API", () => {
  it("requires resource keys to match the PAAC key grammar", () => {
    expect(
      () =>
        new Product("bad.key", {
          name: "Bad",
          prices: [fixedPrice({ amount: 20, currency: "usd" })],
        }),
    ).toThrow();
  });

  it("requires the prices list and does not support the legacy price field", () => {
    expect(() => new Product("pro", { name: "Pro", price: "20" } as never)).toThrow();
  });

  it("supports static plus metered prices and depends on the referenced meter", () => {
    const requests = requestsMeter();
    const product = new Product("pro", {
      name: "Pro",
      recurringInterval: "month",
      prices: [
        fixedPrice({ amount: "30", currency: "usd" }),
        meteredUnitPrice({ meter: requests, amount: "0.001", currency: "usd", capAmount: "100" }),
      ],
    });

    expect(product.toDesiredResource()).toMatchObject({
      dependencies: ["meter.requests"],
      config: {
        managed: {
          prices: [
            { key: "base", type: "fixed", amount: 3000, currency: "usd" },
            {
              key: "meter:requests",
              type: "meteredUnit",
              meter: "meter.requests",
              unitAmount: "0.1",
              currency: "usd",
              capAmount: 10000,
            },
          ],
        },
      },
    });
  });

  it("requires recurring products for metered prices", () => {
    const requests = requestsMeter();
    expect(
      () =>
        new Product("usage", {
          name: "Usage",
          prices: [meteredUnitPrice({ meter: requests, amount: "0.01", currency: "usd" })],
        }),
    ).toThrow("recurring");
  });
});
