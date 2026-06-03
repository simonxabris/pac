import { Product, fixedPrice } from "./index.js";

export const pro = new Product("pro", {
  name: "Pro plan",
  price: fixedPrice({ amount: "20", currency: "usd" }),
  recurringInterval: "month",
});
