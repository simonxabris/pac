import * as Schema from "effect/Schema";

const MetadataValue = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
]);

export const RemoteProduct = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  visibility: Schema.optionalKey(Schema.String),
  recurringInterval: Schema.optionalKey(Schema.NullOr(Schema.String)),
  recurringIntervalCount: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  prices: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        amountType: Schema.optionalKey(Schema.String),
        priceAmount: Schema.optionalKey(Schema.Number),
        priceCurrency: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
  metadata: Schema.optionalKey(Schema.Record(Schema.String, MetadataValue)),
});

export const RemoteProductsResponse = Schema.Union([
  Schema.Array(RemoteProduct),
  Schema.Struct({ items: Schema.Array(RemoteProduct) }),
]);

export type RemoteProduct = typeof RemoteProduct.Type;
