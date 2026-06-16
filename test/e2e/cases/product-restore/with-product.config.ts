import { Product, fixedPrice } from "@simonxabris/pac";

export const restored = new Product("restore-archived", {
  name: "E2E Product To Restore",
  description: "Restored by PAC E2E after archive",
  prices: [fixedPrice({ amount: 12, currency: "usd" })],
});
