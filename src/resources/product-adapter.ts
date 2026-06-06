import { Effect } from "effect";
import {
  optionalPolarIntegerMinorUnitNumber,
  polarDecimalMinorUnitAmount,
  polarIntegerMinorUnitNumber,
} from "../currency/currency.js";
import type { OperationAction } from "../operations/actions.js";
import type { Operation, RollbackAction } from "../operations/operation.js";
import type {
  ProductCreateOperationPayload,
  ProductPriceCreatePayload,
  ProductUpdateOperationPayload,
  ProductUpdatePricePayload,
} from "../operations/payloads/product.js";
import type { OperationRef } from "../operations/ref.js";
import type { Diagnostic, FieldChange } from "../planner.js";
import type {
  CreateOperationsFromPlanContext,
  ResourceAdapter,
  ResourceExecutablePlanNode,
} from "../resource-adapter-registry.js";
import type {
  CurrentProductProviderState,
  ProductKind,
  ProductPriceSpec,
  ProductSpec,
} from "./product.js";

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

const polarIdRef = (address: OperationRef["address"]): OperationRef => ({
  _tag: "Ref",
  address,
  field: "polarId",
});

const unsupportedRollback = (reason: string): RollbackAction => ({
  _tag: "UnsupportedRollback",
  reason,
});

const managedMetadata = (kind: ProductKind, address: OperationRef["address"], key: string) => ({
  paac: JSON.stringify({
    v: 1,
    kind,
    addr: address,
    key,
  }),
});

const productPriceCreatePayload = (price: ProductPriceSpec): ProductPriceCreatePayload => {
  switch (price.type) {
    case "fixed":
      return {
        amountType: "fixed",
        priceCurrency: price.currency as ProductPriceCreatePayload["priceCurrency"],
        priceAmount: polarIntegerMinorUnitNumber(price.amount, price.currency),
      };
    case "free":
      return {
        amountType: "free",
        priceCurrency: price.currency as ProductPriceCreatePayload["priceCurrency"],
      };
    case "custom": {
      const payload: ProductPriceCreatePayload = {
        amountType: "custom",
        priceCurrency: price.currency as ProductPriceCreatePayload["priceCurrency"],
        ...(price.minimumAmount === null
          ? {}
          : { minimumAmount: polarIntegerMinorUnitNumber(price.minimumAmount, price.currency) }),
        maximumAmount: optionalPolarIntegerMinorUnitNumber(price.maximumAmount, price.currency),
        presetAmount: optionalPolarIntegerMinorUnitNumber(price.presetAmount, price.currency),
      };
      return payload;
    }
    case "meteredUnit":
      return {
        amountType: "metered_unit",
        priceCurrency: price.currency as ProductPriceCreatePayload["priceCurrency"],
        meterId: polarIdRef(price.meter),
        unitAmount: polarDecimalMinorUnitAmount(price.amount, price.currency),
        capAmount: optionalPolarIntegerMinorUnitNumber(price.capAmount, price.currency),
      };
  }
};

const productCreatePayload = (
  desired: ResourceExecutablePlanNode<ProductKind, ProductSpec> & { readonly _tag: "Create" },
): ProductCreateOperationPayload => {
  const base = {
    metadata: managedMetadata(desired.kind, desired.address, desired.desired.key),
    name: desired.desired.spec.name,
    description: desired.desired.spec.description,
    visibility: desired.desired.spec.visibility,
    prices: desired.desired.spec.prices.map(productPriceCreatePayload),
  };

  if (desired.desired.spec.recurringInterval === null) {
    return {
      ...base,
      recurringInterval: null,
      recurringIntervalCount: null,
    };
  }

  return {
    ...base,
    recurringInterval: desired.desired.spec.recurringInterval,
    recurringIntervalCount: desired.desired.spec.recurringIntervalCount ?? 1,
  };
};

const hasChanged = (changes: ReadonlyArray<FieldChange>, field: keyof ProductSpec): boolean =>
  changes.some((change) => change.path[0] === field);

const productPriceUpdatePayloads = (
  prices: ReadonlyArray<ProductPriceSpec>,
  providerState: CurrentProductProviderState,
): ReadonlyArray<ProductUpdatePricePayload> =>
  prices.map((price, index) => {
    const currentPrice = providerState.prices[index];
    if (currentPrice !== undefined && valuesEqual(currentPrice.spec, price)) {
      return { id: currentPrice.polarPriceId };
    }

    return productPriceCreatePayload(price);
  });

const productUpdatePayload = (
  spec: ProductSpec,
  changes: ReadonlyArray<FieldChange>,
  providerState: CurrentProductProviderState,
): ProductUpdateOperationPayload => {
  const payload: ProductUpdateOperationPayload = {};

  if (hasChanged(changes, "name")) {
    payload.name = spec.name;
  }

  if (hasChanged(changes, "description")) {
    payload.description = spec.description;
  }

  if (hasChanged(changes, "visibility")) {
    payload.visibility = spec.visibility;
  }

  if (hasChanged(changes, "prices")) {
    payload.prices = productPriceUpdatePayloads(spec.prices, providerState);
  }

  return payload;
};

const createProductOperationFromPlanNode = (
  node: ResourceExecutablePlanNode<ProductKind, ProductSpec>,
  context: CreateOperationsFromPlanContext,
): Operation => {
  const id = context.nextOperationId();

  switch (node._tag) {
    case "Create":
      return {
        _tag: "Operation",
        id,
        address: node.address,
        kind: "product",
        action: {
          _tag: "CreateProduct",
          payload: productCreatePayload(node),
        },
        rollback: {
          _tag: "RollbackOperation",
          action: {
            _tag: "ArchiveProduct",
            id: polarIdRef(node.address),
            payload: { isArchived: true },
          },
        },
      };
    case "Update": {
      const providerState = node.current.providerState as CurrentProductProviderState;
      const action: OperationAction = {
        _tag: "UpdateProduct",
        id: node.current.polarId,
        payload: productUpdatePayload(node.desired.spec, node.changes, providerState),
      };

      return {
        _tag: "Operation",
        id,
        address: node.address,
        kind: "product",
        action,
        rollback: {
          _tag: "RollbackOperation",
          action: {
            _tag: "UpdateProduct",
            id: node.current.polarId,
            payload: productUpdatePayload(node.current.spec, node.changes, providerState),
          },
        },
      };
    }
    case "Remove":
      return {
        _tag: "Operation",
        id,
        address: node.address,
        kind: "product",
        action: {
          _tag: "ArchiveProduct",
          id: node.current.polarId,
          payload: { isArchived: true },
        },
        rollback: unsupportedRollback("Archive rollback is not implemented yet."),
      };
  }
};

export const ProductResourceAdapter: ResourceAdapter<ProductKind, ProductSpec> = {
  kind: "product",
  removalMode: "archive",

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

  createOperationsFromPlan: (node, context) =>
    Effect.succeed([createProductOperationFromPlanNode(node, context)]),
};
