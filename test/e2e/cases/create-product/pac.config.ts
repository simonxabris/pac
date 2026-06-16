import { Product, fixedPrice } from "@simonxabris/pac";

export const starter = new Product("starter", {
  name: "E2E Starter Product",
  description: "Created by PAC E2E",
  prices: [fixedPrice({ amount: "30", currency: "usd" })],
});
