import { Product, fixedPrice } from "pac";

export const archived = new Product("archive-me", {
  name: "E2E Product To Archive",
  description: "Archived by PAC E2E",
  prices: [fixedPrice({ amount: 9, currency: "usd" })],
});
