import { Product, fixedPrice, Meter, meteredUnitPrice, and, eventName, sum, Benefit } from "pac";

export const tokens = new Meter("tokens", {
  name: "Pac tokens",
  unit: "token",
  filter: and(eventName("eq", "token_consumed")),
  aggregation: sum("total_tokens"),
});

export const includedTokens = new Benefit("included-tokens", {
  type: "meter-credit",
  description: "Included monthly tokens",
  meter: tokens,
  units: 10_000,
});

export const customBenefit = new Benefit("custom-note", {
  type: "custom",
  description: "Invite link",
  note: "Visit this link",
});

export const pro = new Product("pro", {
  name: "Pac Pro plan",
  description: "For serious users",
  prices: [
    fixedPrice({ amount: "40", currency: "usd" }),
    meteredUnitPrice({ meter: tokens, amount: "0.001", currency: "usd", capAmount: "100" }),
  ],
  recurringIntervalCount: 3,
  recurringInterval: "month",
  benefits: [includedTokens, customBenefit],
});
