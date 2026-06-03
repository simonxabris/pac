import * as Equal from "effect/Equal";
import * as Effect from "effect/Effect";
import { decodeJsonObject, type JsonObject, type JsonValue } from "../../../../core/json.js";
import { encodePaacMetadata } from "../../../../core/metadata.js";
import type { Operation, ResourceChange } from "../../../../core/plan.js";
import type { CanonicalResource } from "../../../../core/resource.js";
import { errorDiagnostic } from "../../../../core/diagnostic.js";
import {
  decodeProductManagedV1,
  type CanonicalProductPrice,
  type ProductManagedV1,
} from "./schema.js";

const pricePayload = (price: CanonicalProductPrice): JsonObject => {
  switch (price.type) {
    case "fixed":
      return decodeJsonObject({
        amountType: "fixed",
        priceAmount: price.amount,
        priceCurrency: price.currency,
      });
    case "free":
      return decodeJsonObject({
        amountType: "free",
        priceCurrency: price.currency,
      });
    case "custom":
      return decodeJsonObject({
        amountType: "custom",
        priceCurrency: price.currency,
        minimumAmount: price.minimumAmount,
        maximumAmount: price.maximumAmount,
        presetAmount: price.presetAmount,
      });
    case "meteredUnit":
      return decodeJsonObject({
        amountType: "metered_unit",
        meterAddress: price.meter,
        unitAmount: price.unitAmount,
        priceCurrency: price.currency,
        capAmount: price.capAmount,
      });
  }
};

const productCreatePayload = (resource: CanonicalResource): JsonObject => {
  const managed = decodeProductManagedV1(resource.managed);
  return decodeJsonObject({
    name: managed.name,
    description: managed.description,
    visibility: managed.visibility,
    prices: managed.prices.map(pricePayload),
    metadata: encodePaacMetadata(resource.metadata),
    recurringInterval: managed.billing.recurringInterval,
    recurringIntervalCount: managed.billing.recurringIntervalCount,
  });
};

const hasDiff = (change: ResourceChange, path: string): boolean =>
  change.diffs.some((diff) => diff.path === path || diff.path.startsWith(`${path}/`));

const getPriceIdsByKey = (
  resource: CanonicalResource | undefined,
): Readonly<Record<string, string>> => {
  const raw = resource?.raw;
  if (raw === null || typeof raw !== "object" || !("priceIdsByKey" in raw)) return {};
  const value = raw.priceIdsByKey;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
};

const productUpdatePricesPayload = (
  change: ResourceChange,
  managed: ProductManagedV1,
): ReadonlyArray<JsonObject> => {
  const beforePrices =
    change.before === undefined ? [] : decodeProductManagedV1(change.before.managed).prices;
  const beforeByKey = new Map(beforePrices.map((price) => [price.key, price] as const));
  const priceIdsByKey = getPriceIdsByKey(change.before);

  return managed.prices.map((price) => {
    const beforePrice = beforeByKey.get(price.key);
    const existingId = priceIdsByKey[price.key];
    if (beforePrice !== undefined && existingId !== undefined && Equal.equals(beforePrice, price)) {
      return decodeJsonObject({ id: existingId });
    }
    return pricePayload(price);
  });
};

const productUpdatePayload = (change: ResourceChange, managed: ProductManagedV1): JsonObject => {
  const entries: Array<readonly [string, JsonValue]> = [];
  if (hasDiff(change, "/name")) entries.push(["name", managed.name]);
  if (hasDiff(change, "/description")) entries.push(["description", managed.description]);
  if (hasDiff(change, "/visibility")) entries.push(["visibility", managed.visibility]);
  if (hasDiff(change, "/isArchived")) entries.push(["isArchived", managed.isArchived]);
  if (hasDiff(change, "/prices"))
    entries.push(["prices", productUpdatePricesPayload(change, managed)]);
  return decodeJsonObject(Object.fromEntries(entries));
};

export const planProductCreate = (
  resource: CanonicalResource,
): Effect.Effect<ReadonlyArray<Operation>> =>
  Effect.succeed([
    {
      id: `product.create:${resource.address}`,
      provider: "polar" as const,
      kind: "product",
      address: resource.address,
      action: "create" as const,
      call: "products.create",
      input: productCreatePayload(resource),
      dependsOn: [],
      preview: {
        title: "create Polar product",
        lines: [`name: ${decodeProductManagedV1(resource.managed).name}`],
      },
    },
  ]);

export const planProductUpdate = (
  change: ResourceChange,
): Effect.Effect<ReadonlyArray<Operation>, ReturnType<typeof errorDiagnostic>> =>
  Effect.gen(function* () {
    if (change.after === undefined) {
      return yield* Effect.fail(
        errorDiagnostic({
          code: "PAAC_PRODUCT_UPDATE_MISSING_AFTER",
          message: "Cannot update a product without desired canonical state.",
          address: change.address,
        }),
      );
    }
    if (change.providerId === undefined) {
      return yield* Effect.fail(
        errorDiagnostic({
          code: "PAAC_PRODUCT_UPDATE_MISSING_ID",
          message: "Cannot update a product without a Polar product ID.",
          address: change.address,
        }),
      );
    }
    const managed = decodeProductManagedV1(change.after.managed);
    const productUpdate = productUpdatePayload(change, managed);
    return [
      {
        id: `product.${change.action}:${change.address}`,
        provider: "polar" as const,
        kind: "product",
        address: change.address,
        action: change.action === "unarchive" ? ("unarchive" as const) : ("update" as const),
        call: "products.update",
        input: decodeJsonObject({ id: change.providerId, productUpdate }),
        dependsOn: [],
        preview: {
          title: change.action === "unarchive" ? "unarchive Polar product" : "update Polar product",
          lines: change.diffs.map(
            (diff) =>
              `${diff.path}: ${JSON.stringify(diff.before)} -> ${JSON.stringify(diff.after)}`,
          ),
        },
      },
    ];
  });

export const planProductArchive = (
  resource: CanonicalResource,
): Effect.Effect<ReadonlyArray<Operation>, ReturnType<typeof errorDiagnostic>> =>
  Effect.gen(function* () {
    if (resource.providerId === undefined) {
      return yield* Effect.fail(
        errorDiagnostic({
          code: "PAAC_PRODUCT_ARCHIVE_MISSING_ID",
          message: "Cannot archive a product without a Polar product ID.",
          address: resource.address,
        }),
      );
    }
    return [
      {
        id: `product.archive:${resource.address}`,
        provider: "polar" as const,
        kind: "product",
        address: resource.address,
        action: "archive" as const,
        call: "products.update",
        input: decodeJsonObject({ id: resource.providerId, productUpdate: { isArchived: true } }),
        dependsOn: [],
        preview: {
          title: "archive Polar product",
          lines: ["isArchived: true"],
        },
      },
    ];
  });
