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

# Authentication

`paac` supports two ways to authenticate with Polar:

## OAuth

Use the built-in OAuth flow to log in interactively. This stores tokens securely in your system keyring and prompts you to select an organization.

```sh
# Log in (opens your browser)
paac auth login

# Check who you're logged in as and which organization is active
paac auth whoami

# Switch to a different organization
paac auth org

# Log out and clear stored credentials
paac auth logout
```

Tokens are scoped per environment (`production` or `sandbox`). The login command stores the access token and your selected organization in the system keyring so you don't have to re-authenticate on every run.

## Environment variable

Set `POLAR_ACCESS_TOKEN` to authenticate with a Polar API access token directly. When this variable is present, OAuth is skipped entirely.

```sh
export POLAR_ACCESS_TOKEN="polar_at_..."
```

You can also control the target environment:

- `POLAR_ENV` — `production` (default) or `sandbox`.
- `POLAR_SERVER_URL` — optional custom Polar API base URL.

# Supported

- Product with all supported pricing strategies
- Meter with all possible filtering and aggregation
- Benefits with `meter-credit`, `custom`, and `feature-flag` types.
