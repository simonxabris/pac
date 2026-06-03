import * as Schema from "effect/Schema";
import { decodeJsonObject } from "../../../../core/json.js";

export const ProductVisibility = Schema.Union([
  Schema.Literal("draft"),
  Schema.Literal("private"),
  Schema.Literal("public"),
]);
export const RecurringInterval = Schema.Union([
  Schema.Literal("day"),
  Schema.Literal("week"),
  Schema.Literal("month"),
  Schema.Literal("year"),
]);

export const CanonicalFixedProductPrice = Schema.Struct({
  key: Schema.Literal("base"),
  type: Schema.Literal("fixed"),
  amount: Schema.Number,
  currency: Schema.String,
});

export const CanonicalFreeProductPrice = Schema.Struct({
  key: Schema.Literal("base"),
  type: Schema.Literal("free"),
  currency: Schema.String,
});

export const CanonicalCustomProductPrice = Schema.Struct({
  key: Schema.Literal("base"),
  type: Schema.Literal("custom"),
  currency: Schema.String,
  minimumAmount: Schema.Number,
  maximumAmount: Schema.NullOr(Schema.Number),
  presetAmount: Schema.NullOr(Schema.Number),
});

export const CanonicalMeteredUnitProductPrice = Schema.Struct({
  key: Schema.String,
  type: Schema.Literal("meteredUnit"),
  meter: Schema.String,
  unitAmount: Schema.Union([Schema.String, Schema.Number]),
  currency: Schema.String,
  capAmount: Schema.NullOr(Schema.Number),
});

export const CanonicalProductPrice = Schema.Union([
  CanonicalFixedProductPrice,
  CanonicalFreeProductPrice,
  CanonicalCustomProductPrice,
  CanonicalMeteredUnitProductPrice,
]);

export const ProductManagedV1 = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  visibility: ProductVisibility,
  isArchived: Schema.Boolean,
  billing: Schema.Struct({
    recurringInterval: Schema.NullOr(RecurringInterval),
    recurringIntervalCount: Schema.NullOr(Schema.Number),
  }),
  prices: Schema.Array(CanonicalProductPrice),
});

export const ProductDesiredConfig = Schema.Struct({
  managed: ProductManagedV1,
});

const MetadataValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]);

const RemotePriceArchiveState = Schema.Struct({
  isArchived: Schema.optionalKey(Schema.Boolean),
});

const RemotePriceIdentity = {
  id: Schema.optionalKey(Schema.String),
  isArchived: Schema.optionalKey(Schema.Boolean),
} as const;

const RemoteFixedProductPrice = Schema.Struct({
  ...RemotePriceIdentity,
  amountType: Schema.Literal("fixed"),
  priceAmount: Schema.Number,
  priceCurrency: Schema.String,
});

const RemoteFreeProductPrice = Schema.Struct({
  ...RemotePriceIdentity,
  amountType: Schema.Literal("free"),
  priceCurrency: Schema.String,
});

const RemoteCustomProductPrice = Schema.Struct({
  ...RemotePriceIdentity,
  amountType: Schema.Literal("custom"),
  priceCurrency: Schema.String,
  minimumAmount: Schema.Number,
  maximumAmount: Schema.NullOr(Schema.Number),
  presetAmount: Schema.NullOr(Schema.Number),
});

const RemoteMeteredUnitProductPrice = Schema.Struct({
  ...RemotePriceIdentity,
  amountType: Schema.Literal("metered_unit"),
  priceCurrency: Schema.String,
  unitAmount: Schema.Union([Schema.String, Schema.Number]),
  capAmount: Schema.NullOr(Schema.Number),
  meterId: Schema.String,
});

export const RemoteStaticProductPrice = Schema.Union([
  RemoteFixedProductPrice,
  RemoteFreeProductPrice,
  RemoteCustomProductPrice,
]);

export const RemoteSupportedProductPrice = Schema.Union([
  RemoteFixedProductPrice,
  RemoteFreeProductPrice,
  RemoteCustomProductPrice,
  RemoteMeteredUnitProductPrice,
]);

export const RemoteProductV1 = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  visibility: ProductVisibility,
  recurringInterval: Schema.NullOr(RecurringInterval),
  recurringIntervalCount: Schema.NullOr(Schema.Number),
  isArchived: Schema.Boolean,
  metadata: Schema.Record(Schema.String, MetadataValue),
  prices: Schema.Array(Schema.Unknown),
});

export type ProductManagedV1 = typeof ProductManagedV1.Type;
export type ProductDesiredConfig = typeof ProductDesiredConfig.Type;
export type CanonicalProductPrice = typeof CanonicalProductPrice.Type;
export type RemoteProductV1 = typeof RemoteProductV1.Type;
export type RemoteStaticProductPrice = typeof RemoteStaticProductPrice.Type;
export type RemoteSupportedProductPrice = typeof RemoteSupportedProductPrice.Type;
export type RemoteProductPriceArchiveState = typeof RemotePriceArchiveState.Type;

export const decodeProductDesiredConfig = Schema.decodeUnknownSync(ProductDesiredConfig, {
  onExcessProperty: "error",
});
export const decodeProductManagedV1 = Schema.decodeUnknownSync(ProductManagedV1);
export const decodeRemoteProductV1 = Schema.decodeUnknownSync(RemoteProductV1);
export const decodeRemoteStaticProductPrice = Schema.decodeUnknownSync(RemoteStaticProductPrice);
export const decodeRemoteSupportedProductPrice = Schema.decodeUnknownSync(
  RemoteSupportedProductPrice,
);
export const decodeRemoteProductPriceArchiveState =
  Schema.decodeUnknownSync(RemotePriceArchiveState);

export const productManagedJson = (managed: ProductManagedV1) => decodeJsonObject(managed);
