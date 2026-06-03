import type { PresentmentCurrency } from "@polar-sh/sdk/models/components/presentmentcurrency.js";
import type { ProductVisibility } from "@polar-sh/sdk/models/components/productvisibility.js";
import type { SubscriptionRecurringInterval } from "@polar-sh/sdk/models/components/subscriptionrecurringinterval.js";
import { registerResource } from "./registry.js";

export type ProductConfig = {
  readonly name: string;
  readonly description?: string | null;
  readonly price: string | number;
  readonly currency?: string;
  readonly visibility?: ProductVisibility;
  readonly recurringInterval?: SubscriptionRecurringInterval | null;
  readonly recurringIntervalCount?: number;
  readonly organizationId?: string;
};

export type ProductPricePayload = {
  readonly amountType: "fixed";
  readonly priceAmount: number;
  readonly priceCurrency: PresentmentCurrency;
};

export type ProductCreatePayload = {
  readonly name: string;
  readonly description: string | null;
  readonly visibility: ProductVisibility;
  readonly organizationId?: string;
  readonly recurringInterval: SubscriptionRecurringInterval | null;
  readonly recurringIntervalCount: number | null;
  readonly prices: ReadonlyArray<ProductPricePayload>;
  readonly metadata: Record<string, string | number | boolean>;
};

export type ProductUpdatePayload = Partial<
  Omit<ProductCreatePayload, "metadata" | "prices">
> & {
  readonly prices?: ReadonlyArray<ProductPricePayload>;
  readonly isArchived?: boolean;
};

export type DesiredProduct = {
  readonly type: "product";
  readonly key: string;
  readonly address: `product.${string}`;
  readonly payload: ProductCreatePayload;
};

export const dollarsToCents = (value: string | number): number => {
  const numberValue = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Invalid product price: ${String(value)}`);
  }
  return Math.round(numberValue * 100);
};

export class Product {
  readonly type = "product" as const;
  readonly key: string;
  readonly address: `product.${string}`;
  readonly config: ProductConfig;

  constructor(key: string, config: ProductConfig) {
    this.key = key;
    this.address = `product.${key}`;
    this.config = config;
    registerResource(this);
  }

  toDesired(project: string): DesiredProduct {
    const recurringInterval = this.config.recurringInterval ?? null;
    return {
      type: "product",
      key: this.key,
      address: this.address,
      payload: {
        name: this.config.name,
        description: this.config.description ?? null,
        visibility: this.config.visibility ?? "public",
        ...(this.config.organizationId === undefined
          ? {}
          : { organizationId: this.config.organizationId }),
        recurringInterval,
        recurringIntervalCount:
          recurringInterval === null
            ? null
            : (this.config.recurringIntervalCount ?? 1),
        prices: [
          {
            amountType: "fixed",
            priceAmount: dollarsToCents(this.config.price),
            priceCurrency: (this.config.currency ?? "usd") as PresentmentCurrency,
          },
        ],
        metadata: {
          paac: JSON.stringify({
            type: "product",
            key: this.key,
            addr: this.address,
            project,
          }),
        },
      },
    };
  }
}
