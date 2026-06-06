import { Effect, Layer, Option, Schema, SchemaGetter, SchemaIssue } from "effect";
import * as Context from "effect/Context";
import {
  normalizeCurrency,
  optionalPolarIntegerMinorUnitAmount,
  optionalPolarIntegerMinorUnitNumber,
  polarDecimalMinorUnitAmount,
  polarIntegerMinorUnitAmount,
  polarIntegerMinorUnitNumber,
} from "./currency//currency.js";
import { ResourceAddress as ResourceAddressSchema, type ResourceAddress } from "./core/address.js";
import type { CurrentResource } from "./core/resource.js";
import { PolarClient } from "./polar/service.js";
import {
  CurrentBenefitResourceSchema,
  type BenefitAddress,
  type CurrentBenefitResource,
} from "./resources/benefit.js";
import {
  CurrentMeterResourceSchema,
  MeterAddressSchema,
  MeterAggregationSpecSchema,
  MeterFilterSpecSchema,
  type CurrentMeterResource,
  type MeterAddress,
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
  id: Schema.String,
  amountType: Schema.Literal("fixed"),
  priceAmount: Schema.Number,
  priceCurrency: Schema.String,
  isArchived: Schema.Boolean,
});

const RemoteProductPriceFree = Schema.Struct({
  id: Schema.String,
  amountType: Schema.Literal("free"),
  priceCurrency: Schema.String,
  isArchived: Schema.Boolean,
});

const RemoteProductPriceCustom = Schema.Struct({
  id: Schema.String,
  amountType: Schema.Literal("custom"),
  priceCurrency: Schema.String,
  isArchived: Schema.Boolean,
  minimumAmount: Schema.Number,
  maximumAmount: Schema.NullOr(Schema.Number),
  presetAmount: Schema.NullOr(Schema.Number),
});

const RemoteProductPriceMeteredUnit = Schema.Struct({
  id: Schema.String,
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

const RemoteProductBenefit = Schema.Struct({
  id: Schema.String,
});

const RemoteProductSdk = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  visibility: Schema.Union([
    Schema.Literal("draft"),
    Schema.Literal("private"),
    Schema.Literal("public"),
  ]),
  recurringInterval: Schema.NullOr(
    Schema.Union([
      Schema.Literal("day"),
      Schema.Literal("week"),
      Schema.Literal("month"),
      Schema.Literal("year"),
    ]),
  ),
  recurringIntervalCount: Schema.NullOr(Schema.Number),
  isArchived: Schema.Boolean,
  metadata: MetadataRecord,
  prices: Schema.Array(RemoteProductPrice),
  benefits: Schema.Array(RemoteProductBenefit),
});

const RemoteProductResourceInput = Schema.Struct({
  product: RemoteProductSdk,
  meterAddressesById: Schema.Record(Schema.String, MeterAddressSchema),
  benefitAddressesById: Schema.Record(Schema.String, Schema.TemplateLiteral(["benefit.", Schema.String])),
});

const RemoteBenefitMeterCreditSdk = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("meter_credit"),
  description: Schema.String,
  isDeleted: Schema.Boolean,
  metadata: MetadataRecord,
  properties: Schema.Struct({
    units: Schema.Number,
    rollover: Schema.Boolean,
    meterId: Schema.String,
  }),
});

const RemoteBenefitCustomSdk = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("custom"),
  description: Schema.String,
  isDeleted: Schema.Boolean,
  metadata: MetadataRecord,
  properties: Schema.Struct({
    note: Schema.NullOr(Schema.String),
  }),
});

const RemoteBenefitSdk = Schema.Union([RemoteBenefitMeterCreditSdk, RemoteBenefitCustomSdk]);

const RemoteBenefitResourceInput = Schema.Struct({
  benefit: RemoteBenefitSdk,
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
  archivedAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
});

const schemaIssue = (actual: unknown, message: string): SchemaIssue.Issue =>
  new SchemaIssue.InvalidValue(Option.some(actual), { message });

const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return String(cause);
};

const hasPaacMetadata = (remote: {
  readonly metadata?: Readonly<Record<string, unknown>>;
}): boolean => remote.metadata?.paac !== undefined;

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

const identityForKind = (
  kind: "product" | "meter" | "benefit",
  metadata: typeof MetadataRecord.Type,
): ManagedIdentity => {
  const identity = parseManagedIdentity(metadata);
  if (identity.kind !== kind) {
    throw new Error(`Expected PAAC metadata kind '${kind}', got '${identity.kind}'.`);
  }
  return identity;
};

const productPriceToSpec = (
  price: RemoteProductPrice,
  meterAddressesById: Readonly<Record<string, ResourceAddress<"meter">>>,
): ProductPriceSpec => {
  switch (price.amountType) {
    case "fixed": {
      const priceCurrency = normalizeCurrency(price.priceCurrency);
      return {
        type: "fixed",
        amount: polarIntegerMinorUnitAmount(price.priceAmount, priceCurrency),
        currency: priceCurrency,
      };
    }
    case "free":
      return { type: "free", currency: normalizeCurrency(price.priceCurrency) };
    case "custom": {
      const priceCurrency = normalizeCurrency(price.priceCurrency);
      return {
        type: "custom",
        currency: priceCurrency,
        minimumAmount: polarIntegerMinorUnitAmount(price.minimumAmount, priceCurrency),
        maximumAmount: optionalPolarIntegerMinorUnitAmount(price.maximumAmount, priceCurrency),
        presetAmount: optionalPolarIntegerMinorUnitAmount(price.presetAmount, priceCurrency),
      };
    }
    case "metered_unit": {
      const meterAddress = meterAddressesById[price.meterId];
      if (meterAddress === undefined) {
        throw new Error(
          `Metered product price references unmanaged or unknown meter '${price.meterId}'.`,
        );
      }
      const priceCurrency = normalizeCurrency(price.priceCurrency);
      return {
        type: "meteredUnit",
        meter: meterAddress,
        amount: polarDecimalMinorUnitAmount(price.unitAmount, priceCurrency),
        currency: priceCurrency,
        capAmount: optionalPolarIntegerMinorUnitAmount(price.capAmount, priceCurrency),
      };
    }
  }
};

const productToCurrentResource = ({
  product,
  meterAddressesById,
  benefitAddressesById,
}: typeof RemoteProductResourceInput.Type): CurrentProductResource => {
  const identity = identityForKind("product", product.metadata);
  const activePrices = product.prices.filter((price) => !price.isArchived);
  const prices = activePrices.map((price) => productPriceToSpec(price, meterAddressesById));
  const attachedBenefits = product.benefits.map((benefit) => ({
    polarBenefitId: benefit.id,
    address: benefitAddressesById[benefit.id] ?? null,
  }));
  const benefits = [
    ...new Set(
      attachedBenefits.flatMap((benefit) => benefit.address === null ? [] : [benefit.address]),
    ),
  ].sort() as ReadonlyArray<BenefitAddress>;

  return {
    source: "current",
    kind: "product",
    key: identity.key,
    address: identity.address as `product.${string}`,
    polarId: product.id,
    isRemoved: product.isArchived,
    spec: {
      name: product.name,
      description: product.description,
      prices,
      benefits,
      visibility: product.visibility,
      recurringInterval: product.recurringInterval,
      recurringIntervalCount:
        product.recurringInterval === null ? null : (product.recurringIntervalCount ?? 1),
    },
    providerState: {
      prices: activePrices.map((price, index) => ({
        polarPriceId: price.id,
        spec: prices[index] as ProductPriceSpec,
      })),
      benefits: attachedBenefits,
    },
    raw: product,
  };
};

const productResourceToRemoteInput = (
  resource: CurrentProductResource,
): typeof RemoteProductResourceInput.Type => ({
  product: {
    id: resource.polarId,
    name: resource.spec.name,
    description: resource.spec.description,
    visibility: resource.spec.visibility,
    recurringInterval: resource.spec.recurringInterval,
    recurringIntervalCount: resource.spec.recurringIntervalCount,
    isArchived: resource.isRemoved,
    metadata: {},
    benefits: resource.providerState.benefits.map((benefit) => ({
      id: benefit.polarBenefitId,
    })),
    prices: resource.spec.prices.map((price, index) => {
      const providerPrice = resource.providerState.prices[index];
      if (providerPrice === undefined) {
        throw new Error(`Missing provider state for product price at index ${index}.`);
      }
      const id = providerPrice.polarPriceId;
      switch (price.type) {
        case "fixed":
          return {
            id,
            amountType: "fixed",
            priceAmount: polarIntegerMinorUnitNumber(price.amount, price.currency),
            priceCurrency: price.currency,
            isArchived: false,
          };
        case "free":
          return { id, amountType: "free", priceCurrency: price.currency, isArchived: false };
        case "custom":
          return {
            id,
            amountType: "custom",
            priceCurrency: price.currency,
            isArchived: false,
            minimumAmount: polarIntegerMinorUnitNumber(price.minimumAmount ?? "0", price.currency),
            maximumAmount: optionalPolarIntegerMinorUnitNumber(price.maximumAmount, price.currency),
            presetAmount: optionalPolarIntegerMinorUnitNumber(price.presetAmount, price.currency),
          };
        case "meteredUnit":
          return {
            id,
            amountType: "metered_unit",
            priceCurrency: price.currency,
            isArchived: false,
            unitAmount: polarDecimalMinorUnitAmount(price.amount, price.currency),
            capAmount: optionalPolarIntegerMinorUnitNumber(price.capAmount, price.currency),
            meterId: price.meter,
          };
      }
    }),
  },
  meterAddressesById: {},
  benefitAddressesById: {},
});

const benefitToCurrentResource = ({
  benefit,
  meterAddressesById,
}: typeof RemoteBenefitResourceInput.Type): CurrentBenefitResource => {
  const identity = identityForKind("benefit", benefit.metadata);

  const base = {
    source: "current" as const,
    kind: "benefit" as const,
    key: identity.key,
    address: identity.address as `benefit.${string}`,
    polarId: benefit.id,
    isRemoved: benefit.isDeleted,
    raw: benefit,
  };

  switch (benefit.type) {
    case "meter_credit": {
      const meterAddress = meterAddressesById[benefit.properties.meterId];
      if (meterAddress === undefined) {
        throw new Error(
          `Meter-credit benefit references unmanaged or unknown meter '${benefit.properties.meterId}'.`,
        );
      }

      return {
        ...base,
        spec: {
          type: "meter-credit",
          description: benefit.description,
          meter: meterAddress,
          units: benefit.properties.units,
          rollover: benefit.properties.rollover,
        },
      };
    }
    case "custom":
      return {
        ...base,
        spec: {
          type: "custom",
          description: benefit.description,
          note: benefit.properties.note,
        },
      };
  }
};

const benefitResourceToRemoteInput = (
  resource: CurrentBenefitResource,
): typeof RemoteBenefitResourceInput.Type => {
  switch (resource.spec.type) {
    case "meter-credit":
      return {
        benefit: {
          id: resource.polarId,
          type: "meter_credit",
          description: resource.spec.description,
          isDeleted: resource.isRemoved,
          metadata: {},
          properties: {
            units: resource.spec.units,
            rollover: resource.spec.rollover,
            meterId: resource.spec.meter,
          },
        },
        meterAddressesById: {},
      };
    case "custom":
      return {
        benefit: {
          id: resource.polarId,
          type: "custom",
          description: resource.spec.description,
          isDeleted: resource.isRemoved,
          metadata: {},
          properties: { note: resource.spec.note },
        },
        meterAddressesById: {},
      };
  }
};

const meterToCurrentResource = (meter: typeof RemoteMeterSdk.Type): CurrentMeterResource => {
  const identity = identityForKind("meter", meter.metadata);
  return {
    source: "current",
    kind: "meter",
    key: identity.key,
    address: identity.address as `meter.${string}`,
    polarId: meter.id,
    isRemoved: meter.archivedAt != null,
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

export const RemoteBenefitResourceSchema = RemoteBenefitResourceInput.pipe(
  Schema.decodeTo(CurrentBenefitResourceSchema, {
    decode: SchemaGetter.transformOrFail((input) =>
      Effect.try({
        try: () => benefitToCurrentResource(input),
        catch: (cause) =>
          schemaIssue(input, cause instanceof Error ? cause.message : String(cause)),
      }),
    ),
    encode: SchemaGetter.transform(benefitResourceToRemoteInput),
  }),
);

export const RemoteProductResourceSchema = RemoteProductResourceInput.pipe(
  Schema.decodeTo(CurrentProductResourceSchema, {
    decode: SchemaGetter.transformOrFail((input) =>
      Effect.try({
        try: () => productToCurrentResource(input),
        catch: (cause) =>
          schemaIssue(input, cause instanceof Error ? cause.message : String(cause)),
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
        catch: (cause) =>
          schemaIssue(meter, cause instanceof Error ? cause.message : String(cause)),
      }),
    ),
    encode: SchemaGetter.transform(meterResourceToRemote),
  }),
);

export const decodeRemoteBenefitResource = Schema.decodeUnknownEffect(RemoteBenefitResourceSchema);
export const decodeRemoteProductResource = Schema.decodeUnknownEffect(RemoteProductResourceSchema);
export const decodeRemoteMeterResource = Schema.decodeUnknownEffect(RemoteMeterResourceSchema);

export class RemoteResourceFetchError extends Schema.TaggedErrorClass<RemoteResourceFetchError>()(
  "RemoteResourceFetchError",
  {
    message: Schema.String,
  },
) { }

export class DuplicateRemoteResourceAddress extends Schema.TaggedErrorClass<DuplicateRemoteResourceAddress>()(
  "DuplicateRemoteResourceAddress",
  {
    address: ResourceAddressSchema,
  },
) { }

export class RemoteResourceFetcher extends Context.Service<
  RemoteResourceFetcher,
  {
    readonly fetch: () => Effect.Effect<
      RemoteResourceMap,
      RemoteResourceFetchError | DuplicateRemoteResourceAddress
    >;
  }
>()("@app/RemoteResourceFetcher") {
  static readonly layer = Layer.effect(
    RemoteResourceFetcher,
    Effect.gen(function*() {
      const polar = yield* PolarClient;

      return RemoteResourceFetcher.of({
        fetch: () =>
          Effect.gen(function*() {
            const [remoteProducts, remoteMeters, remoteBenefits] = yield* Effect.all(
              [polar.listProducts(), polar.listMeters(), polar.listBenefits()] as const,
              { concurrency: "unbounded" },
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new RemoteResourceFetchError({
                    message: `Failed to fetch Polar resources: ${errorMessage(cause)}`,
                  }),
              ),
            );

            const meters = yield* Effect.forEach(
              remoteMeters.filter(hasPaacMetadata),
              (meter) =>
                decodeRemoteMeterResource(meter).pipe(
                  Effect.mapError(
                    (cause) =>
                      new RemoteResourceFetchError({
                        message: `Failed to decode remote meter: ${errorMessage(cause)}`,
                      }),
                  ),
                ),
              { concurrency: "unbounded" },
            );

            const meterAddressesById = Object.fromEntries(
              meters.map((meter) => [meter.polarId, meter.address]),
            ) as Record<string, MeterAddress>;

            const benefits = yield* Effect.forEach(
              remoteBenefits.filter(hasPaacMetadata),
              (benefit) =>
                decodeRemoteBenefitResource({ benefit, meterAddressesById }).pipe(
                  Effect.mapError(
                    (cause) =>
                      new RemoteResourceFetchError({
                        message: `Failed to decode remote benefit: ${errorMessage(cause)}`,
                      }),
                  ),
                ),
              { concurrency: "unbounded" },
            );

            const benefitAddressesById = Object.fromEntries(
              benefits.map((benefit) => [benefit.polarId, benefit.address]),
            ) as Record<string, BenefitAddress>;

            const products = yield* Effect.forEach(
              remoteProducts.filter(hasPaacMetadata),
              (product) =>
                decodeRemoteProductResource({ product, meterAddressesById, benefitAddressesById }).pipe(
                  Effect.mapError(
                    (cause) =>
                      new RemoteResourceFetchError({
                        message: `Failed to decode remote product: ${errorMessage(cause)}`,
                      }),
                  ),
                ),
              { concurrency: "unbounded" },
            );

            const resources = new Map<ResourceAddress, CurrentResource>();
            for (const resource of [...meters, ...benefits, ...products]) {
              if (resources.has(resource.address)) {
                return yield* new DuplicateRemoteResourceAddress({ address: resource.address });
              }
              resources.set(resource.address, resource);
            }

            return resources;
          }),
      });
    }),
  );
}
