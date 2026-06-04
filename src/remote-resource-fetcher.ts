import { Effect, Layer, Option, Schema, SchemaGetter, SchemaIssue } from "effect";
import * as Context from "effect/Context";
import { ResourceAddress as ResourceAddressSchema, type ResourceAddress } from "./core/address.js";
import type { CurrentResource } from "./core/resource.js";
import {
  CurrentMeterResourceSchema,
  MeterAddressSchema,
  MeterAggregationSpecSchema,
  MeterFilterSpecSchema,
  type CurrentMeterResource,
} from "./resources/meter.js";
import {
  CurrentProductResourceSchema,
  type CurrentProductResource,
  type ProductPriceSpec,
} from "./resources/product.js";

export type RemoteResourceMap = ReadonlyMap<ResourceAddress, CurrentResource>;

type ManagedIdentity = {
  readonly version: 1;
  readonly kind: string;
  readonly address: ResourceAddress;
  readonly key: string;
};

const MetadataValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]);
const MetadataRecord = Schema.Record(Schema.String, MetadataValue);

const ManagedIdentityEnvelope = Schema.Struct({
  v: Schema.Literal(1),
  kind: Schema.String,
  addr: ResourceAddressSchema,
  key: Schema.String,
});

const RemoteProductPriceFixed = Schema.Struct({
  amountType: Schema.Literal("fixed"),
  priceAmount: Schema.Number,
  priceCurrency: Schema.String,
  isArchived: Schema.Boolean,
});

const RemoteProductPriceFree = Schema.Struct({
  amountType: Schema.Literal("free"),
  priceCurrency: Schema.String,
  isArchived: Schema.Boolean,
});

const RemoteProductPriceCustom = Schema.Struct({
  amountType: Schema.Literal("custom"),
  priceCurrency: Schema.String,
  isArchived: Schema.Boolean,
  minimumAmount: Schema.Number,
  maximumAmount: Schema.NullOr(Schema.Number),
  presetAmount: Schema.NullOr(Schema.Number),
});

const RemoteProductPriceMeteredUnit = Schema.Struct({
  amountType: Schema.Literal("metered_unit"),
  priceCurrency: Schema.String,
  isArchived: Schema.Boolean,
  unitAmount: Schema.String,
  capAmount: Schema.NullOr(Schema.Number),
  meterId: Schema.String,
});

const RemoteProductPrice = Schema.Union([
  RemoteProductPriceFixed,
  RemoteProductPriceFree,
  RemoteProductPriceCustom,
  RemoteProductPriceMeteredUnit,
]);

type RemoteProductPrice = typeof RemoteProductPrice.Type;

const RemoteProductSdk = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  visibility: Schema.Union([Schema.Literal("draft"), Schema.Literal("private"), Schema.Literal("public")]),
  recurringInterval: Schema.NullOr(
    Schema.Union([Schema.Literal("day"), Schema.Literal("week"), Schema.Literal("month"), Schema.Literal("year")]),
  ),
  recurringIntervalCount: Schema.NullOr(Schema.Number),
  metadata: MetadataRecord,
  prices: Schema.Array(RemoteProductPrice),
});

const RemoteProductResourceInput = Schema.Struct({
  product: RemoteProductSdk,
  meterAddressesById: Schema.Record(Schema.String, MeterAddressSchema),
});

const RemoteMeterSdk = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  unit: Schema.Union([Schema.Literal("scalar"), Schema.Literal("token"), Schema.Literal("custom")]),
  customLabel: Schema.optionalKey(Schema.NullOr(Schema.String)),
  customMultiplier: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  filter: MeterFilterSpecSchema,
  aggregation: MeterAggregationSpecSchema,
  metadata: MetadataRecord,
});

const schemaIssue = (actual: unknown, message: string): SchemaIssue.Issue =>
  new SchemaIssue.InvalidValue(Option.some(actual), { message });

const parseManagedIdentity = (metadata: typeof MetadataRecord.Type): ManagedIdentity => {
  const value = metadata.paac;
  if (typeof value !== "string") {
    throw new Error("Remote resource does not contain PAAC metadata.");
  }

  const envelope = Schema.decodeUnknownSync(ManagedIdentityEnvelope)(JSON.parse(value) as unknown);
  if (envelope.addr !== `${envelope.kind}.${envelope.key}`) {
    throw new Error("PAAC metadata addr must equal `${kind}.${key}`.");
  }

  return {
    version: envelope.v,
    kind: envelope.kind,
    address: envelope.addr as ResourceAddress,
    key: envelope.key,
  };
};

const identityForKind = (kind: "product" | "meter", metadata: typeof MetadataRecord.Type): ManagedIdentity => {
  const identity = parseManagedIdentity(metadata);
  if (identity.kind !== kind) {
    throw new Error(`Expected PAAC metadata kind '${kind}', got '${identity.kind}'.`);
  }
  return identity;
};

const currency = (value: string): string => value.toLowerCase();
const amount = (value: string | number): string => String(value);
const optionalAmount = (value: number | null): string | null => value === null ? null : String(value);

const productPriceToSpec = (
  price: RemoteProductPrice,
  meterAddressesById: Readonly<Record<string, ResourceAddress<"meter">>>,
): ProductPriceSpec => {
  switch (price.amountType) {
    case "fixed":
      return { type: "fixed", amount: amount(price.priceAmount), currency: currency(price.priceCurrency) };
    case "free":
      return { type: "free", currency: currency(price.priceCurrency) };
    case "custom":
      return {
        type: "custom",
        currency: currency(price.priceCurrency),
        minimumAmount: amount(price.minimumAmount),
        maximumAmount: optionalAmount(price.maximumAmount),
        presetAmount: optionalAmount(price.presetAmount),
      };
    case "metered_unit": {
      const meterAddress = meterAddressesById[price.meterId];
      if (meterAddress === undefined) {
        throw new Error(`Metered product price references unmanaged or unknown meter '${price.meterId}'.`);
      }
      return {
        type: "meteredUnit",
        meter: meterAddress,
        amount: amount(price.unitAmount),
        currency: currency(price.priceCurrency),
        capAmount: optionalAmount(price.capAmount),
      };
    }
  }
};

const productToCurrentResource = ({
  product,
  meterAddressesById,
}: typeof RemoteProductResourceInput.Type): CurrentProductResource => {
  const identity = identityForKind("product", product.metadata);
  return {
    source: "current",
    kind: "product",
    key: identity.key,
    address: identity.address as `product.${string}`,
    polarId: product.id,
    spec: {
      name: product.name,
      description: product.description,
      prices: product.prices
        .filter((price) => !price.isArchived)
        .map((price) => productPriceToSpec(price, meterAddressesById)),
      visibility: product.visibility,
      recurringInterval: product.recurringInterval,
      recurringIntervalCount: product.recurringInterval === null ? null : product.recurringIntervalCount ?? 1,
    },
    raw: product,
  };
};

const productResourceToRemoteInput = (resource: CurrentProductResource): typeof RemoteProductResourceInput.Type => ({
  product: {
    id: resource.polarId,
    name: resource.spec.name,
    description: resource.spec.description,
    visibility: resource.spec.visibility,
    recurringInterval: resource.spec.recurringInterval,
    recurringIntervalCount: resource.spec.recurringIntervalCount,
    metadata: {},
    prices: resource.spec.prices.map((price) => {
      switch (price.type) {
        case "fixed":
          return { amountType: "fixed", priceAmount: Number(price.amount), priceCurrency: price.currency, isArchived: false };
        case "free":
          return { amountType: "free", priceCurrency: price.currency, isArchived: false };
        case "custom":
          return {
            amountType: "custom",
            priceCurrency: price.currency,
            isArchived: false,
            minimumAmount: Number(price.minimumAmount ?? 0),
            maximumAmount: price.maximumAmount === null ? null : Number(price.maximumAmount),
            presetAmount: price.presetAmount === null ? null : Number(price.presetAmount),
          };
        case "meteredUnit":
          return {
            amountType: "metered_unit",
            priceCurrency: price.currency,
            isArchived: false,
            unitAmount: price.amount,
            capAmount: price.capAmount === null ? null : Number(price.capAmount),
            meterId: price.meter,
          };
      }
    }),
  },
  meterAddressesById: {},
});

const meterToCurrentResource = (meter: typeof RemoteMeterSdk.Type): CurrentMeterResource => {
  const identity = identityForKind("meter", meter.metadata);
  return {
    source: "current",
    kind: "meter",
    key: identity.key,
    address: identity.address as `meter.${string}`,
    polarId: meter.id,
    spec: {
      name: meter.name,
      unit: meter.unit,
      customLabel: meter.customLabel ?? null,
      customMultiplier: meter.customMultiplier ?? null,
      filter: meter.filter,
      aggregation: meter.aggregation,
    },
    raw: meter,
  };
};

const meterResourceToRemote = (resource: CurrentMeterResource): typeof RemoteMeterSdk.Type => ({
  id: resource.polarId,
  name: resource.spec.name,
  unit: resource.spec.unit,
  customLabel: resource.spec.customLabel,
  customMultiplier: resource.spec.customMultiplier,
  filter: resource.spec.filter,
  aggregation: resource.spec.aggregation,
  metadata: {},
});

export const RemoteProductResourceSchema = RemoteProductResourceInput.pipe(
  Schema.decodeTo(CurrentProductResourceSchema, {
    decode: SchemaGetter.transformOrFail((input) =>
      Effect.try({
        try: () => productToCurrentResource(input),
        catch: (cause) => schemaIssue(input, cause instanceof Error ? cause.message : String(cause)),
      }),
    ),
    encode: SchemaGetter.transform(productResourceToRemoteInput),
  }),
);

export const RemoteMeterResourceSchema = RemoteMeterSdk.pipe(
  Schema.decodeTo(CurrentMeterResourceSchema, {
    decode: SchemaGetter.transformOrFail((meter) =>
      Effect.try({
        try: () => meterToCurrentResource(meter),
        catch: (cause) => schemaIssue(meter, cause instanceof Error ? cause.message : String(cause)),
      }),
    ),
    encode: SchemaGetter.transform(meterResourceToRemote),
  }),
);

export const decodeRemoteProductResource = Schema.decodeUnknownEffect(RemoteProductResourceSchema);
export const decodeRemoteMeterResource = Schema.decodeUnknownEffect(RemoteMeterResourceSchema);

export class RemoteResourceFetchError extends Schema.TaggedErrorClass<RemoteResourceFetchError>()(
  "RemoteResourceFetchError",
  {
    message: Schema.String,
  },
) {}

export class DuplicateRemoteResourceAddress extends Schema.TaggedErrorClass<DuplicateRemoteResourceAddress>()(
  "DuplicateRemoteResourceAddress",
  {
    address: ResourceAddressSchema,
  },
) {}

export class RemoteResourceFetcher extends Context.Service<
  RemoteResourceFetcher,
  {
    readonly fetch: () => Effect.Effect<RemoteResourceMap, RemoteResourceFetchError | DuplicateRemoteResourceAddress>;
  }
>()("@app/RemoteResourceFetcher") {
  static readonly layer = Layer.sync(RemoteResourceFetcher, () => ({
    fetch: () => Effect.succeed(new Map<ResourceAddress, CurrentResource>()),
  }));
}
