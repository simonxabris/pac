import { Product, fixedPrice } from "paac";

export const updated = new Product("update-mutable", {
  name: "E2E Mutable Product V1",
  description: "Before mutable update",
  visibility: "private",
  prices: [fixedPrice({ amount: 10, currency: "usd" })],
});
