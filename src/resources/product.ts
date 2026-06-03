import type { ProductVisibility } from "@polar-sh/sdk/models/components/productvisibility.js";
import type { SubscriptionRecurringInterval } from "@polar-sh/sdk/models/components/subscriptionrecurringinterval.js";
import * as Schema from "effect/Schema";
import { decodeResourceKey } from "../core/address.js";
import type { DesiredResource } from "../core/resource.js";
import { registerResource } from "./registry.js";

const MajorAmount = Schema.Union([Schema.String, Schema.Number]);
const ProductVisibilitySchema = Schema.Union([
  Schema.Literal("draft"),
  Schema.Literal("private"),
  Schema.Literal("public"),
]);
const RecurringIntervalSchema = Schema.Union([
  Schema.Literal("day"),
  Schema.Literal("week"),
  Schema.Literal("month"),
  Schema.Literal("year"),
]);

const FixedPriceConfigSchema = Schema.Struct({
  type: Schema.Literal("fixed"),
  amount: MajorAmount,
  currency: Schema.String,
});

const FreePriceConfigSchema = Schema.Struct({
  type: Schema.Literal("free"),
  currency: Schema.String,
});

const CustomPriceConfigSchema = Schema.Struct({
  type: Schema.Literal("custom"),
  currency: Schema.String,
  minimumAmount: Schema.optionalKey(MajorAmount),
  maximumAmount: Schema.optionalKey(Schema.NullOr(MajorAmount)),
  presetAmount: Schema.optionalKey(Schema.NullOr(MajorAmount)),
});

const ProductPriceConfigSchema = Schema.Union([
  FixedPriceConfigSchema,
  FreePriceConfigSchema,
  CustomPriceConfigSchema,
]);

const ProductConfigSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  price: ProductPriceConfigSchema,
  visibility: Schema.optionalKey(ProductVisibilitySchema),
  recurringInterval: Schema.optionalKey(Schema.NullOr(RecurringIntervalSchema)),
  recurringIntervalCount: Schema.optionalKey(Schema.Number),
});

const decodeMajorAmount = Schema.decodeUnknownSync(MajorAmount);
const decodeFixedPriceConfig = Schema.decodeUnknownSync(FixedPriceConfigSchema, {
  onExcessProperty: "error",
});
const decodeFreePriceConfig = Schema.decodeUnknownSync(FreePriceConfigSchema, {
  onExcessProperty: "error",
});
const decodeCustomPriceConfig = Schema.decodeUnknownSync(CustomPriceConfigSchema, {
  onExcessProperty: "error",
});
const decodeProductConfig = Schema.decodeUnknownSync(ProductConfigSchema, {
  onExcessProperty: "error",
});

export type FixedPriceConfig = typeof FixedPriceConfigSchema.Type;
export type FreePriceConfig = typeof FreePriceConfigSchema.Type;
export type CustomPriceConfig = typeof CustomPriceConfigSchema.Type;
export type ProductPriceConfig = typeof ProductPriceConfigSchema.Type;
export type ProductConfig = typeof ProductConfigSchema.Type;

export type ProductPricePayload =
  | {
    readonly amountType: "fixed";
    readonly priceAmount: number;
    readonly priceCurrency: string;
  }
  | {
    readonly amountType: "free";
    readonly priceCurrency: string;
  }
  | {
    readonly amountType: "custom";
    readonly priceCurrency: string;
    readonly minimumAmount: number;
    readonly maximumAmount: number | null;
    readonly presetAmount: number | null;
  };

export type ProductCreatePayload = {
  readonly name: string;
  readonly description: string | null;
  readonly visibility: ProductVisibility;
  readonly recurringInterval: SubscriptionRecurringInterval | null;
  readonly recurringIntervalCount: number | null;
  readonly prices: ReadonlyArray<ProductPricePayload>;
  readonly metadata: Record<string, string | number | boolean>;
};

export type ProductUpdatePayload = Partial<Omit<ProductCreatePayload, "metadata" | "prices">> & {
  readonly prices?: ReadonlyArray<ProductPricePayload>;
  readonly isArchived?: boolean;
};

export type DesiredProduct = DesiredResource & {
  readonly kind: "product";
  readonly key: string;
  readonly address: `product.${string}`;
};

export const dollarsToCents = (value: string | number): number => {
  const numberValue = Number(decodeMajorAmount(value));
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Invalid product price: ${String(value)}`);
  }
  return Math.round(numberValue * 100);
};

const amountOrNullToCents = (value: string | number | null | undefined): number | null =>
  value === null || value === undefined ? null : dollarsToCents(value);

export const fixedPrice = (config: Omit<FixedPriceConfig, "type">): FixedPriceConfig =>
  decodeFixedPriceConfig({ type: "fixed", ...config });

export const freePrice = (config: Omit<FreePriceConfig, "type">): FreePriceConfig =>
  decodeFreePriceConfig({ type: "free", ...config });

export const customPrice = (config: Omit<CustomPriceConfig, "type">): CustomPriceConfig =>
  decodeCustomPriceConfig({ type: "custom", ...config });

const toCanonicalPrice = (price: ProductPriceConfig): ProductPricePayload => {
  switch (price.type) {
    case "fixed":
      return {
        amountType: "fixed",
        priceAmount: dollarsToCents(price.amount),
        priceCurrency: price.currency.toLowerCase(),
      };
    case "free":
      return { amountType: "free", priceCurrency: price.currency.toLowerCase() };
    case "custom":
      return {
        amountType: "custom",
        priceCurrency: price.currency.toLowerCase(),
        minimumAmount: dollarsToCents(price.minimumAmount ?? 0),
        maximumAmount: amountOrNullToCents(price.maximumAmount),
        presetAmount: amountOrNullToCents(price.presetAmount),
      };
  }
};

export class Product {
  readonly type = "product" as const;
  readonly kind = "product" as const;
  readonly key: string;
  readonly address: `product.${string}`;
  readonly config: ProductConfig;

  constructor(key: string, config: ProductConfig) {
    this.key = decodeResourceKey(key);
    this.address = `product.${this.key}`;
    this.config = decodeProductConfig(config);
    registerResource(this);
  }

  toDesiredResource(): DesiredProduct {
    const recurringInterval = this.config.recurringInterval ?? null;
    const price = toCanonicalPrice(this.config.price);
    const managed = {
      name: this.config.name,
      description: this.config.description ?? null,
      visibility: this.config.visibility ?? "public",
      isArchived: false,
      billing: {
        recurringInterval,
        recurringIntervalCount:
          recurringInterval === null ? null : (this.config.recurringIntervalCount ?? 1),
      },
      prices: [
        price.amountType === "fixed"
          ? {
            key: "base" as const,
            type: "fixed" as const,
            amount: price.priceAmount,
            currency: price.priceCurrency,
          }
          : price.amountType === "free"
            ? {
              key: "base" as const,
              type: "free" as const,
              currency: price.priceCurrency,
            }
            : {
              key: "base" as const,
              type: "custom" as const,
              currency: price.priceCurrency,
              minimumAmount: price.minimumAmount,
              maximumAmount: price.maximumAmount,
              presetAmount: price.presetAmount,
            },
      ],
    };

    return {
      kind: "product",
      key: this.key,
      address: this.address,
      dependencies: [],
      config: { managed },
    };
  }

  toDesired(): DesiredProduct {
    return this.toDesiredResource();
  }
}
