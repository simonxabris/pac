import { Product, fixedPrice } from "paac";

export const pro = new Product("pro", {
  name: "Paac Pro plan",
  description: "For serious users",
  price: fixedPrice({ amount: "30", currency: "usd" }),
  recurringInterval: "month",
});
