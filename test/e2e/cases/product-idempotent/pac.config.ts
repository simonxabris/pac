import { Product, fixedPrice } from "pac";

export const idempotent = new Product("idempotent", {
  name: "E2E Idempotent Product",
  description: "Created once by PAC E2E",
  visibility: "public",
  prices: [fixedPrice({ amount: 12, currency: "usd" })],
});
