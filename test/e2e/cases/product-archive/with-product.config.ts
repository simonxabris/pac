import { Product, fixedPrice } from "paac";

export const archived = new Product("archive-me", {
  name: "E2E Product To Archive",
  description: "Archived by PAAC E2E",
  prices: [fixedPrice({ amount: 9, currency: "usd" })],
});
