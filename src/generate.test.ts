import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { DesiredResource, CurrentResource } from "./core/resource.js";
import { CodeGenerator } from "./generate.js";
import type { Plan } from "./planner.js";

const productDesired: DesiredResource<"product"> = {
  source: "desired",
  kind: "product",
  key: "pro",
  address: "product.pro",
  spec: {},
};

const productCurrent: CurrentResource<"product"> = {
  source: "current",
  kind: "product",
  key: "pro",
  address: "product.pro",
  polarId: "product-id",
  isRemoved: false,
  spec: {},
  raw: {
    id: "product-id",
    name: "Pro",
    metadata: {
      paac: '{"v":1,"kind":"product","addr":"product.pro","key":"pro"}',
      public: "kept",
    },
    prices: [
      {
        id: "price-id",
        amountType: "fixed",
        priceAmount: 4000,
        priceCurrency: "usd",
        isArchived: false,
      },
    ],
  },
};

const plan: Plan = {
  _tag: "PlanGraph",
  nodes: new Map([
    [
      "product.pro",
      {
        _tag: "Noop",
        address: "product.pro",
        kind: "product",
        desired: productDesired,
        current: productCurrent,
      },
    ],
  ]),
  edges: [],
  diagnostics: [],
  desiredResources: [productDesired],
  desiredResourcesByAddress: new Map([["product.pro", productDesired]]),
  currentResources: [productCurrent],
  currentResourcesByAddress: new Map([["product.pro", productCurrent]]),
};

describe("CodeGenerator.generate", () => {
  it.effect("removes PAAC metadata and renders product price amounts in major units", () =>
    Effect.gen(function*() {
      const codeGenerator = yield* CodeGenerator;
      const contents = yield* codeGenerator.generate(plan);

      expect(contents).toContain("export const products = {");
      expect(contents).toContain("pro: {");
      expect(contents).toContain('"priceAmount": "40"');
      expect(contents).toContain('"public": "kept"');
      expect(contents).not.toContain("paac");
    }).pipe(Effect.provide(CodeGenerator.layer)),
  );
});
