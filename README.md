# PAC - Polar as Code

> [!WARNING]
> This project is **not affiliated with** Polar.

> [!WARNING]
> This project is in alpha state and has limited support for polar resources. Use at your own peril.

pac is an IaC style solution for [polar](https://polar.sh)

# Example

Define your products and pricing in code:

```ts
import { Product, fixedPrice, Meter, meteredUnitPrice, and, eventName, sum, Benefit } from "paac";

export const tokens = new Meter("tokens", {
  name: "Paac tokens",
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

export const pro = new Product("pro", {
  name: "Paac Pro plan",
  description: "For serious users",
  prices: [
    fixedPrice({ amount: "30", currency: "usd" }),
    meteredUnitPrice({ meter: tokens, amount: "0.001", currency: "usd", capAmount: "100" }),
  ],
  recurringIntervalCount: 1,
  recurringInterval: "month",
  benefits: [includedTokens],
});
```

run the `deploy` command to create the resources.

# Supported

- Product with all supported pricing strategies
- Meter with all possible filtering and aggregation
- Benefit with only `meter-credit` type.
