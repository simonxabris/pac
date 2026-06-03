import { describe, expect, it } from "vitest";
import { fixedPrice, Product } from "../../src/index.js";

describe("Product resource API", () => {
  it("requires resource keys to match the PAAC key grammar", () => {
    expect(
      () =>
        new Product("bad.key", { name: "Bad", price: fixedPrice({ amount: 20, currency: "usd" }) }),
    ).toThrow();
  });

  it("requires explicit price helper shapes", () => {
    expect(() => new Product("pro", { name: "Pro", price: "20" } as never)).toThrow();
  });
});
