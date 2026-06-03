import { describe, expect, it } from "vitest";
import { decodeJsonObject } from "../core/json.js";
import type { Plan } from "../core/plan.js";
import { renderPlan } from "./render.js";

const basePlan: Plan = {
  provider: "polar",
  changes: [],
  operations: [],
  diagnostics: [],
  summary: { create: 0, update: 0, replace: 0, archive: 0, unarchive: 0, delete: 0, blocked: 0, noop: 0 },
};

describe("plan renderer", () => {
  it("does not render project namespaces or operation ids by default", () => {
    const output = renderPlan({
      ...basePlan,
      changes: [
        {
          address: "product.pro",
          kind: "product",
          action: "create",
          diffs: [],
          operations: ["product.create:product.pro"],
          dependsOn: [],
        },
      ],
      operations: [
        {
          id: "product.create:product.pro",
          provider: "polar",
          kind: "product",
          address: "product.pro",
          action: "create",
          call: "products.create",
          input: {},
          dependsOn: [],
          preview: { title: "create", lines: [] },
        },
      ],
      summary: { ...basePlan.summary, create: 1 },
    });

    expect(output).toContain("PAAC plan\n");
    expect(output).not.toContain("project");
    expect(output).not.toContain("product.create:product.pro");
  });

  it("renders Product Price amount diffs in major currency units", () => {
    const output = renderPlan({
      ...basePlan,
      changes: [
        {
          address: "product.pro",
          kind: "product",
          action: "update",
          before: {
            kind: "product",
            address: "product.pro",
            provider: "polar",
            managed: decodeJsonObject({
              prices: [{ key: "base", type: "fixed", amount: 2000, currency: "usd" }],
            }),
            metadata: { version: 1, kind: "product", address: "product.pro", key: "pro" },
          },
          after: {
            kind: "product",
            address: "product.pro",
            provider: "polar",
            managed: decodeJsonObject({
              prices: [{ key: "base", type: "fixed", amount: 2500, currency: "usd" }],
            }),
            metadata: { version: 1, kind: "product", address: "product.pro", key: "pro" },
          },
          diffs: [
            {
              path: "/prices/base/amount",
              before: 2000,
              after: 2500,
              change: "changed",
              rule: { mode: "custom", handler: "productPrices" },
            },
          ],
          operations: [],
          dependsOn: [],
        },
      ],
      summary: { ...basePlan.summary, update: 1 },
    });

    expect(output).toContain("! price: 20.00 usd -> 25.00 usd");
    expect(output).not.toContain("price[base]");
    expect(output).not.toContain("/prices/base/amount: 2000 -> 2500");
  });
});
