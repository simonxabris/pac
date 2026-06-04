import { Effect } from "effect";
import type { Diagnostic, FieldChange } from "../planner.js";
import type { ResourceAdapter } from "../resource-adapter-registry.js";
import type { ProductKind, ProductPriceSpec, ProductSpec } from "./product.js";

const valuesEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const fieldChange = (
  path: ReadonlyArray<string | number>,
  before: unknown,
  after: unknown,
): FieldChange | undefined =>
  valuesEqual(before, after)
    ? undefined
    : {
      _tag: "FieldChange",
      path,
      before,
      after,
    };

const pushFieldChange = (
  changes: Array<FieldChange>,
  path: ReadonlyArray<string | number>,
  before: unknown,
  after: unknown,
): void => {
  const change = fieldChange(path, before, after);
  if (change !== undefined) {
    changes.push(change);
  }
};

type ProductPriceField =
  | "type"
  | "amount"
  | "currency"
  | "minimumAmount"
  | "maximumAmount"
  | "presetAmount"
  | "meter"
  | "capAmount";

const priceFieldNames = (price: ProductPriceSpec): ReadonlyArray<ProductPriceField> => {
  switch (price.type) {
    case "fixed":
      return ["type", "amount", "currency"];
    case "free":
      return ["type", "currency"];
    case "custom":
      return ["type", "currency", "minimumAmount", "maximumAmount", "presetAmount"];
    case "meteredUnit":
      return ["type", "meter", "amount", "currency", "capAmount"];
  }
};

const priceFieldValue = (price: ProductPriceSpec, field: ProductPriceField): unknown =>
  (price as Readonly<Record<string, unknown>>)[field];

const diffProductPrices = (
  changes: Array<FieldChange>,
  before: ReadonlyArray<ProductPriceSpec>,
  after: ReadonlyArray<ProductPriceSpec>,
): void => {
  if (before.length !== after.length) {
    pushFieldChange(changes, ["prices"], before, after);
    return;
  }

  for (let index = 0; index < before.length; index++) {
    const beforePrice = before[index];
    const afterPrice = after[index];

    if (beforePrice === undefined || afterPrice === undefined) {
      pushFieldChange(changes, ["prices"], before, after);
      return;
    }

    if (beforePrice.type !== afterPrice.type) {
      pushFieldChange(changes, ["prices", index], beforePrice, afterPrice);
      continue;
    }

    for (const field of priceFieldNames(afterPrice)) {
      pushFieldChange(
        changes,
        ["prices", index, field],
        priceFieldValue(beforePrice, field),
        priceFieldValue(afterPrice, field),
      );
    }
  }
};

export const ProductResourceAdapter: ResourceAdapter<ProductKind, ProductSpec> = {
  kind: "product",

  dependencies: (desired) =>
    Effect.succeed([
      ...new Set(
        desired.spec.prices.flatMap((price) => (price.type === "meteredUnit" ? [price.meter] : [])),
      ),
    ]),

  diff: (desired, current) =>
    Effect.sync(() => {
      const diagnostics: Array<Diagnostic> = [];

      if (desired.spec.recurringInterval !== current.spec.recurringInterval) {
        diagnostics.push({
          _tag: "Diagnostic",
          severity: "error",
          code: "product.recurringInterval.immutable",
          address: desired.address,
          path: ["recurringInterval"],
          message: "Product recurringInterval cannot be changed after creation.",
        });
      }

      if (desired.spec.recurringIntervalCount !== current.spec.recurringIntervalCount) {
        diagnostics.push({
          _tag: "Diagnostic",
          severity: "error",
          code: "product.recurringIntervalCount.immutable",
          address: desired.address,
          path: ["recurringIntervalCount"],
          message: "Product recurringIntervalCount cannot be changed after creation.",
        });
      }

      if (diagnostics.length > 0) {
        return {
          _tag: "Blocked",
          node: {
            _tag: "Blocked",
            address: desired.address,
            kind: "product",
            desired,
            current,
          },
          diagnostics,
        };
      }

      const changes: Array<FieldChange> = [];

      pushFieldChange(changes, ["name"], current.spec.name, desired.spec.name);
      pushFieldChange(changes, ["description"], current.spec.description, desired.spec.description);
      pushFieldChange(changes, ["visibility"], current.spec.visibility, desired.spec.visibility);
      diffProductPrices(changes, current.spec.prices, desired.spec.prices);

      if (changes.length === 0) {
        return {
          _tag: "Planned",
          node: {
            _tag: "Noop",
            address: desired.address,
            kind: "product",
            desired,
            current,
          },
          diagnostics: [],
        };
      }

      return {
        _tag: "Planned",
        node: {
          _tag: "Update",
          address: desired.address,
          kind: "product",
          desired,
          current,
          changes,
        },
        diagnostics: [],
      };
    }),

  create: (desired) =>
    Effect.succeed([
      {
        type: "create",
        kind: "product",
        address: desired.address,
        desired,
      },
    ]),

  update: (desired, current) =>
    Effect.succeed([
      {
        type: "update",
        kind: "product",
        address: desired.address,
        desired,
        current,
      },
    ]),

  archive: (current) =>
    Effect.succeed([
      {
        type: "archive",
        kind: "product",
        address: current.address,
        current,
      },
    ]),
};
