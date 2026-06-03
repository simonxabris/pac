import { Product, fixedPrice, Meter, meteredUnitPrice, and, eventName, sum } from "paac";

export const tokens = new Meter("tokens", {
  name: "Paac tokens",
  unit: "token",
  filter: and(eventName("eq", "token_consumed")),
  aggregation: sum("total_tokens"),
});

export const pro = new Product("pro", {
  name: "Paac Pro plan",
  description: "For serious users",
  prices: [
    fixedPrice({ amount: "30", currency: "usd" }),
    meteredUnitPrice({ meter: tokens, amount: "0.001", currency: "usd", capAmount: "100" }),
  ],
  recurringIntervalCount: 1,
  recurringInterval: "month",
});
