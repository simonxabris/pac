import { Product, fixedPrice } from "./index.js";

export const pro = new Product("pro", {
  name: "Pro plan",
  prices: [fixedPrice({ amount: "20", currency: "usd" })],
  recurringInterval: "month",
});
