import { Product, customPrice, fixedPrice, freePrice } from "paac";

export const fixedRecurring = new Product("full-shape-fixed-recurring", {
  name: "E2E Full Shape Fixed Recurring",
  description: "Full Product shape created by PAAC E2E",
  visibility: "private",
  recurringInterval: "month",
  recurringIntervalCount: 2,
  prices: [fixedPrice({ amount: 30, currency: "usd" })],
});

export const freeOneTime = new Product("full-shape-free", {
  name: "E2E Full Shape Free",
  description: "Free Product price created by PAAC E2E",
  visibility: "public",
  prices: [freePrice({ currency: "usd" })],
});

export const customOneTime = new Product("full-shape-custom", {
  name: "E2E Full Shape Custom",
  description: "Custom Product price created by PAAC E2E",
  visibility: "draft",
  prices: [
    customPrice({
      currency: "usd",
      minimumAmount: 5,
      maximumAmount: 50,
      presetAmount: 10,
    }),
  ],
});
