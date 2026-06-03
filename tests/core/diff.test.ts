import { describe, expect, it } from "vitest";
import { diffJson } from "../../src/core/diff.js";
import { decodeJsonObject } from "../../src/core/json.js";

const productSemantics = [
  { path: "/name", rule: { mode: "update" as const } },
  { path: "/billing/recurringInterval", rule: { mode: "createOnly" as const } },
  { path: "/prices", rule: { mode: "custom" as const, handler: "productPrices" } },
  { path: "/computed", rule: { mode: "ignore" as const } },
];

describe("canonical JSON diff", () => {
  it("emits stable JSON pointer paths and field semantics", () => {
    const diffs = diffJson(
      decodeJsonObject({ name: "Pro", billing: { recurringInterval: "month" } }),
      decodeJsonObject({ name: "Team", billing: { recurringInterval: "year" } }),
      { semantics: productSemantics },
    );

    expect(diffs.map((diff) => [diff.path, diff.rule.mode])).toEqual([
      ["/billing/recurringInterval", "createOnly"],
      ["/name", "update"],
    ]);
  });

  it("diffs keyed arrays by stable item key instead of array index", () => {
    const diffs = diffJson(
      decodeJsonObject({ prices: [{ key: "base", type: "fixed", amount: 2000, currency: "usd" }] }),
      decodeJsonObject({ prices: [{ key: "base", type: "fixed", amount: 2500, currency: "usd" }] }),
      {
        semantics: productSemantics,
        arrays: [{ path: "/prices", array: { mode: "keyed", key: "key" } }],
      },
    );

    expect(diffs).toMatchObject([
      {
        path: "/prices/base/amount",
        before: 2000,
        after: 2500,
        change: "changed",
        rule: { mode: "custom", handler: "productPrices" },
      },
    ]);
  });

  it("omits ignored fields", () => {
    expect(
      diffJson(decodeJsonObject({ computed: "old" }), decodeJsonObject({ computed: "new" }), {
        semantics: productSemantics,
      }),
    ).toEqual([]);
  });
});
