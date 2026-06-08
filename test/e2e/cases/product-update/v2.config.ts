import { Product, fixedPrice } from "paac";

export const updated = new Product("update-mutable", {
  name: "E2E Mutable Product V2",
  description: "After mutable update",
  visibility: "public",
  prices: [fixedPrice({ amount: 20, currency: "usd" })],
});
