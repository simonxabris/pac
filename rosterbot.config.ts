import { Product, fixedPrice } from "paac";

export const productHallOfFamer = new Product("hall-of-famer", {
  name: "Hall of famer",
  description:
    "With the Hall of famer tier you have access to the following:\n\n- Ulimited synced leagues\n- Unlimited amount of messages",
  prices: [
    fixedPrice({
      amount: "11.99",
      currency: "usd",
    }),
  ],
  recurringInterval: "month",
  recurringIntervalCount: 1,
});

export const productProBowler = new Product("pro-bowler", {
  name: "Pro bowler",
  description:
    "With the Pro bowler theme you get access to the following:\n\n- Sync up to 3 leagues\n- Unlimited messages",
  prices: [
    fixedPrice({
      amount: "9.99",
      currency: "usd",
    }),
  ],
  recurringInterval: "month",
  recurringIntervalCount: 1,
});

export const productRookie = new Product("rookie", {
  name: "Rookie",
  description:
    "With the Rookie tier you have access the following:\n\n- Sync one league\n- Unlimited messages",
  prices: [
    fixedPrice({
      amount: "7.99",
      currency: "usd",
    }),
  ],
  recurringInterval: "month",
  recurringIntervalCount: 1,
});
