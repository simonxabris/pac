import { Product, fixedPrice } from "pac";

export const immutable = new Product("immutable-recurring", {
  name: "E2E Immutable Recurring Product",
  description: "Recurring interval cannot change",
  recurringInterval: "month",
  recurringIntervalCount: 1,
  prices: [fixedPrice({ amount: 15, currency: "usd" })],
});
