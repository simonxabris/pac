import { Schema } from "effect";
import { makeAddress, type ResourceAddress } from "../core/address.js";
import type { CurrentResource, DesiredResource } from "../core/resource.js";
import { MeterAddressSchema, type MeterAddress } from "./meter.js";
import { registerResource } from "./registry.js";

export type ProductKind = "product";
export type ProductAddress = ResourceAddress<ProductKind>;
export const ProductAddressSchema = Schema.TemplateLiteral(["product.", Schema.String]);

export type FixedPriceConfig = {
  readonly type: "fixed";
  readonly amount: string | number;
  readonly currency: string;
};

export type FreePriceConfig = {
  readonly type: "free";
  readonly currency: string;
};

export type CustomPriceConfig = {
  readonly type: "custom";
  readonly currency: string;
  readonly minimumAmount?: string | number | null;
  readonly maximumAmount?: string | number | null;
  readonly presetAmount?: string | number | null;
};

export type MeteredUnitPriceConfig = {
  readonly type: "meteredUnit";
  readonly meter: string;
  readonly amount: string | number;
  readonly currency: string;
  readonly capAmount?: string | number | null;
};

export type ProductPriceConfig =
  | FixedPriceConfig
  | FreePriceConfig
  | CustomPriceConfig
  | MeteredUnitPriceConfig;

export type ProductConfig = {
  readonly name: string;
  readonly description?: string | null;
  readonly prices: ReadonlyArray<ProductPriceConfig>;
  readonly visibility?: "draft" | "private" | "public";
  readonly recurringInterval?: "day" | "week" | "month" | "year" | null;
  readonly recurringIntervalCount?: number;
};

export type ProductFixedPriceSpec = {
  readonly type: "fixed";
  readonly amount: string;
  readonly currency: string;
  readonly capAmount?: never;
};

export type ProductFreePriceSpec = {
  readonly type: "free";
  readonly currency: string;
  readonly capAmount?: never;
};

export type ProductCustomPriceSpec = {
  readonly type: "custom";
  readonly currency: string;
  readonly minimumAmount: string | null;
  readonly maximumAmount: string | null;
  readonly presetAmount: string | null;
  readonly capAmount?: never;
};

export type ProductMeteredUnitPriceSpec = {
  readonly type: "meteredUnit";
  readonly meter: MeterAddress;
  readonly amount: string;
  readonly currency: string;
  readonly capAmount: string | null;
};

export type ProductPriceSpec =
  | ProductFixedPriceSpec
  | ProductFreePriceSpec
  | ProductCustomPriceSpec
  | ProductMeteredUnitPriceSpec;

export type ProductSpec = {
  readonly name: string;
  readonly description: string | null;
  readonly prices: ReadonlyArray<ProductPriceSpec>;
  readonly visibility: "draft" | "private" | "public";
  readonly recurringInterval: "day" | "week" | "month" | "year" | null;
  readonly recurringIntervalCount: number | null;
};

export type CurrentProductProviderState = {
  readonly prices: ReadonlyArray<{
    readonly polarPriceId: string;
    readonly spec: ProductPriceSpec;
  }>;
};

export type ProductResource = DesiredResource<ProductKind, ProductSpec>;
export type CurrentProductResource = Omit<
  CurrentResource<ProductKind, ProductSpec, CurrentProductProviderState>,
  "providerState"
> & {
  readonly providerState: CurrentProductProviderState;
};

export const ProductFixedPriceSpecSchema = Schema.Struct({
  type: Schema.Literal("fixed"),
  amount: Schema.String,
  currency: Schema.String,
});

export const ProductFreePriceSpecSchema = Schema.Struct({
  type: Schema.Literal("free"),
  currency: Schema.String,
});

export const ProductCustomPriceSpecSchema = Schema.Struct({
  type: Schema.Literal("custom"),
  currency: Schema.String,
  minimumAmount: Schema.NullOr(Schema.String),
  maximumAmount: Schema.NullOr(Schema.String),
  presetAmount: Schema.NullOr(Schema.String),
});

export const ProductMeteredUnitPriceSpecSchema = Schema.Struct({
  type: Schema.Literal("meteredUnit"),
  meter: MeterAddressSchema,
  amount: Schema.String,
  currency: Schema.String,
  capAmount: Schema.NullOr(Schema.String),
});

export const ProductPriceSpecSchema: Schema.Codec<ProductPriceSpec> = Schema.Union([
  ProductFixedPriceSpecSchema,
  ProductFreePriceSpecSchema,
  ProductCustomPriceSpecSchema,
  ProductMeteredUnitPriceSpecSchema,
]);

export const ProductSpecSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  prices: Schema.Array(ProductPriceSpecSchema),
  visibility: Schema.Union([Schema.Literal("draft"), Schema.Literal("private"), Schema.Literal("public")]),
  recurringInterval: Schema.NullOr(
    Schema.Union([Schema.Literal("day"), Schema.Literal("week"), Schema.Literal("month"), Schema.Literal("year")]),
  ),
  recurringIntervalCount: Schema.NullOr(Schema.Number),
});

export const ProductResourceSchema = Schema.Struct({
  source: Schema.Literal("desired"),
  kind: Schema.Literal("product"),
  key: Schema.String,
  address: ProductAddressSchema,
  spec: ProductSpecSchema,
});

export const CurrentProductProviderStateSchema = Schema.Struct({
  prices: Schema.Array(
    Schema.Struct({
      polarPriceId: Schema.String,
      spec: ProductPriceSpecSchema,
    }),
  ),
});

export const CurrentProductResourceSchema = Schema.Struct({
  source: Schema.Literal("current"),
  kind: Schema.Literal("product"),
  key: Schema.String,
  address: ProductAddressSchema,
  polarId: Schema.String,
  spec: ProductSpecSchema,
  providerState: CurrentProductProviderStateSchema,
  raw: Schema.optionalKey(Schema.Unknown),
});

const decodeMeterAddress = Schema.decodeUnknownSync(MeterAddressSchema);
const decodeProductResource = Schema.decodeUnknownSync(ProductResourceSchema);
const decodeProductSpec = Schema.decodeUnknownSync(ProductSpecSchema);

export const fixedPrice = (config: Omit<FixedPriceConfig, "type">): FixedPriceConfig => ({
  type: "fixed",
  amount: config.amount,
  currency: config.currency,
});

export const freePrice = (config: Omit<FreePriceConfig, "type">): FreePriceConfig => ({
  type: "free",
  currency: config.currency,
});

export const customPrice = (config: Omit<CustomPriceConfig, "type">): CustomPriceConfig => ({
  type: "custom",
  currency: config.currency,
  ...(config.minimumAmount !== undefined ? { minimumAmount: config.minimumAmount } : {}),
  ...(config.maximumAmount !== undefined ? { maximumAmount: config.maximumAmount } : {}),
  ...(config.presetAmount !== undefined ? { presetAmount: config.presetAmount } : {}),
});

const meterReference = (meter: unknown): string => {
  if (typeof meter === "string") return meter;
  if (typeof meter === "object" && meter !== null && "address" in meter) {
    const address = (meter as { readonly address: unknown }).address;
    if (typeof address === "string") return address;
  }
  return String(meter);
};

export const meteredUnitPrice = (
  config: Omit<MeteredUnitPriceConfig, "type" | "meter"> & { readonly meter: unknown },
): MeteredUnitPriceConfig => ({
  type: "meteredUnit",
  meter: meterReference(config.meter),
  amount: config.amount,
  currency: config.currency,
  ...(config.capAmount !== undefined ? { capAmount: config.capAmount } : {}),
});

const amountSpec = (amount: string | number): string => String(amount);
const optionalAmountSpec = (amount: string | number | null | undefined): string | null =>
  amount == null ? null : String(amount);
const currencySpec = (currency: string): string => currency.toLowerCase();

export const productPriceSpec = (price: ProductPriceConfig): ProductPriceSpec => {
  switch (price.type) {
    case "fixed":
      return {
        type: "fixed",
        amount: amountSpec(price.amount),
        currency: currencySpec(price.currency),
      };
    case "free":
      return {
        type: "free",
        currency: currencySpec(price.currency),
      };
    case "custom":
      return {
        type: "custom",
        currency: currencySpec(price.currency),
        minimumAmount: optionalAmountSpec(price.minimumAmount),
        maximumAmount: optionalAmountSpec(price.maximumAmount),
        presetAmount: optionalAmountSpec(price.presetAmount),
      };
    case "meteredUnit":
      return {
        type: "meteredUnit",
        meter: decodeMeterAddress(price.meter),
        amount: amountSpec(price.amount),
        currency: currencySpec(price.currency),
        capAmount: optionalAmountSpec(price.capAmount),
      };
  }
};

export const productSpec = (config: ProductConfig): ProductSpec => {
  const recurringInterval = config.recurringInterval ?? null;
  return decodeProductSpec({
    name: config.name,
    description: config.description ?? null,
    prices: config.prices.map(productPriceSpec),
    visibility: config.visibility ?? "public",
    recurringInterval,
    recurringIntervalCount: recurringInterval === null ? null : config.recurringIntervalCount ?? 1,
  });
};

export class Product {
  readonly type = "product" as const;
  readonly kind = "product" as const;
  readonly key: string;
  readonly address: ProductAddress;
  readonly config: ProductConfig;

  constructor(key: string, config: ProductConfig) {
    this.key = key;
    this.address = makeAddress("product", key);
    this.config = config;
    registerResource(this);
  }

  toDesiredResource(): ProductResource {
    return decodeProductResource({
      source: "desired",
      kind: this.kind,
      key: this.key,
      address: this.address,
      spec: productSpec(this.config),
    });
  }
}
