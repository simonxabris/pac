import { Meter, Product, and, eventName, fixedPrice, metadata, meteredUnitPrice, sum } from "pac";

export const requests = new Meter("metered-product-requests", {
  name: "E2E Metered Product Requests V1",
  unit: "custom",
  customLabel: "requests",
  customMultiplier: 1000,
  filter: and(eventName("eq", "request"), metadata("plan", "eq", "pro")),
  aggregation: sum("quantity"),
});

export const pro = new Product("metered-product-pro", {
  name: "E2E Metered Product Pro",
  description: "Fixed monthly fee plus metered request usage",
  recurringInterval: "month",
  recurringIntervalCount: 1,
  prices: [
    fixedPrice({ amount: 29, currency: "usd" }),
    meteredUnitPrice({ meter: requests, amount: "0.01", currency: "usd", capAmount: 100 }),
  ],
});
