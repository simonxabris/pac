import { Product, fixedPrice } from "paac";

export const starter = new Product("starter", {
  name: "E2E Starter Product",
  description: "Created by PAAC E2E",
  prices: [fixedPrice({ amount: "30", currency: "usd" })],
});
