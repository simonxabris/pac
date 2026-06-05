import { describe, expect, it, beforeEach } from "@effect/vitest";
import { Effect } from "effect";
import { ProductResourceAdapter } from "./product-adapter.js";
import {
  customPrice,
  fixedPrice,
  freePrice,
  meteredUnitPrice,
  Product,
  type CurrentProductResource,
  type ProductResource,
} from "./product.js";
import { resetRegistry } from "./registry.js";

const currentFromDesired = (
  desired: ProductResource,
  spec: CurrentProductResource["spec"] = desired.spec,
): CurrentProductResource => ({
  source: "current",
  kind: "product",
  key: desired.key,
  address: desired.address,
  polarId: `polar-${desired.key}`,
  spec,
});

describe("ProductResourceAdapter.createOperationsFromPlan", () => {
  beforeEach(() => {
    resetRegistry();
  });

  it.effect("creates a Polar-shaped create product payload with metered price refs", () =>
    Effect.gen(function*() {
      const desired = new Product("pro", {
        name: "Pro",
        description: "For serious users",
        visibility: "public",
        recurringInterval: "month",
        recurringIntervalCount: 1,
        prices: [
          fixedPrice({ amount: "3000", currency: "usd" }),
          freePrice({ currency: "eur" }),
          customPrice({ currency: "usd", minimumAmount: "500", maximumAmount: null, presetAmount: "1000" }),
          meteredUnitPrice({ meter: "meter.requests", amount: "0.01", currency: "usd", capAmount: "100" }),
        ],
      }).toDesiredResource();

      const operations = yield* ProductResourceAdapter.createOperationsFromPlan(
        {
          _tag: "Create",
          address: desired.address,
          kind: "product",
          desired,
        },
        { nextOperationId: () => "op_1" },
      );

      expect(operations).toEqual([
        {
          _tag: "Operation",
          id: "op_1",
          address: "product.pro",
          kind: "product",
          action: {
            _tag: "CreateProduct",
            payload: {
              metadata: {
                paac: JSON.stringify({
                  v: 1,
                  kind: "product",
                  addr: "product.pro",
                  key: "pro",
                }),
              },
              name: "Pro",
              description: "For serious users",
              visibility: "public",
              prices: [
                {
                  amountType: "fixed",
                  priceCurrency: "usd",
                  priceAmount: 3000,
                },
                {
                  amountType: "free",
                  priceCurrency: "eur",
                },
                {
                  amountType: "custom",
                  priceCurrency: "usd",
                  minimumAmount: 500,
                  maximumAmount: null,
                  presetAmount: 1000,
                },
                {
                  amountType: "metered_unit",
                  priceCurrency: "usd",
                  meterId: {
                    _tag: "Ref",
                    address: "meter.requests",
                    field: "polarId",
                  },
                  unitAmount: "0.01",
                  capAmount: 100,
                },
              ],
              recurringInterval: "month",
              recurringIntervalCount: 1,
            },
          },
          rollback: {
            _tag: "RollbackOperation",
            action: {
              _tag: "ArchiveProduct",
              id: {
                _tag: "Ref",
                address: "product.pro",
                field: "polarId",
              },
            },
          },
        },
      ]);
    }),
  );
});

describe("ProductResourceAdapter.diff", () => {
  beforeEach(() => {
    resetRegistry();
  });

  it.effect("returns a planned noop when product specs match", () =>
    Effect.gen(function*() {
      const desired = new Product("pro", {
        name: "Pro",
        prices: [fixedPrice({ amount: "2000", currency: "usd" })],
      }).toDesiredResource();
      const current = currentFromDesired(desired);

      const result = yield* ProductResourceAdapter.diff(desired, current);

      expect(result).toEqual({
        _tag: "Planned",
        node: {
          _tag: "Noop",
          address: "product.pro",
          kind: "product",
          desired,
          current,
        },
        diagnostics: [],
      });
    }),
  );

  it.effect("returns an update node with field changes for changed product fields", () =>
    Effect.gen(function*() {
      const desired = new Product("pro", {
        name: "Pro",
        description: "New description",
        visibility: "public",
        prices: [fixedPrice({ amount: "2000", currency: "usd" })],
      }).toDesiredResource();
      const current = currentFromDesired(desired, {
        ...desired.spec,
        name: "Old Pro",
        description: "Old description",
        visibility: "private",
      });

      const result = yield* ProductResourceAdapter.diff(desired, current);

      expect(result).toEqual({
        _tag: "Planned",
        node: {
          _tag: "Update",
          address: "product.pro",
          kind: "product",
          desired,
          current,
          changes: [
            {
              _tag: "FieldChange",
              path: ["name"],
              before: "Old Pro",
              after: "Pro",
            },
            {
              _tag: "FieldChange",
              path: ["description"],
              before: "Old description",
              after: "New description",
            },
            {
              _tag: "FieldChange",
              path: ["visibility"],
              before: "private",
              after: "public",
            },
          ],
        },
        diagnostics: [],
      });
    }),
  );

  it.effect("returns price field changes for changed product prices", () =>
    Effect.gen(function*() {
      const desired = new Product("usage", {
        name: "Usage",
        prices: [meteredUnitPrice({ meter: "meter.requests", amount: "0.02", currency: "usd", capAmount: "1000" })],
      }).toDesiredResource();
      const current = currentFromDesired(desired, {
        ...desired.spec,
        prices: [
          {
            type: "meteredUnit",
            meter: "meter.requests",
            amount: "0.01",
            currency: "usd",
            capAmount: null,
          },
        ],
      });

      const result = yield* ProductResourceAdapter.diff(desired, current);

      expect(result).toEqual({
        _tag: "Planned",
        node: {
          _tag: "Update",
          address: "product.usage",
          kind: "product",
          desired,
          current,
          changes: [
            {
              _tag: "FieldChange",
              path: ["prices", 0, "amount"],
              before: "0.01",
              after: "0.02",
            },
            {
              _tag: "FieldChange",
              path: ["prices", 0, "capAmount"],
              before: null,
              after: "1000",
            },
          ],
        },
        diagnostics: [],
      });
    }),
  );

  it.effect("returns a blocked result with diagnostics when recurring interval changes", () =>
    Effect.gen(function*() {
      const desired = new Product("monthly", {
        name: "Monthly",
        recurringInterval: "month",
        recurringIntervalCount: 1,
        prices: [fixedPrice({ amount: "2000", currency: "usd" })],
      }).toDesiredResource();
      const current = currentFromDesired(desired, {
        ...desired.spec,
        recurringInterval: "year",
        recurringIntervalCount: 1,
      });

      const result = yield* ProductResourceAdapter.diff(desired, current);

      expect(result).toEqual({
        _tag: "Blocked",
        node: {
          _tag: "Blocked",
          address: "product.monthly",
          kind: "product",
          desired,
          current,
        },
        diagnostics: [
          {
            _tag: "Diagnostic",
            severity: "error",
            code: "product.recurringInterval.immutable",
            address: "product.monthly",
            path: ["recurringInterval"],
            message: "Product recurringInterval cannot be changed after creation.",
          },
        ],
      });
    }),
  );
});
