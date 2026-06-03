import { registerResource } from "./registry.js";

export type ProductConfig = {
  readonly name: string;
  readonly description?: string | null;
  readonly price: string | number;
  readonly currency?: string;
  readonly visibility?: "public" | "hidden";
  readonly recurringInterval?: "day" | "week" | "month" | "year" | null;
  readonly recurringIntervalCount?: number;
  readonly organizationId?: string;
};

export type ProductPricePayload = {
  readonly amount_type: "fixed";
  readonly price_amount: number;
  readonly price_currency: string;
};

export type ProductCreatePayload = {
  readonly name: string;
  readonly description: string | null;
  readonly visibility: "public" | "hidden";
  readonly organization_id?: string;
  readonly recurring_interval: "day" | "week" | "month" | "year" | null;
  readonly recurring_interval_count: number | null;
  readonly prices: ReadonlyArray<ProductPricePayload>;
  readonly metadata: Record<string, string | number | boolean>;
};

export type ProductUpdatePayload = Partial<
  Omit<ProductCreatePayload, "metadata" | "prices">
> & {
  readonly prices?: ReadonlyArray<ProductPricePayload>;
  readonly is_archived?: boolean;
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
          : { organization_id: this.config.organizationId }),
        recurring_interval: recurringInterval,
        recurring_interval_count:
          recurringInterval === null
            ? null
            : (this.config.recurringIntervalCount ?? 1),
        prices: [
          {
            amount_type: "fixed",
            price_amount: dollarsToCents(this.config.price),
            price_currency: this.config.currency ?? "usd",
          },
        ],
        metadata: {
          paac_type: "product",
          paac_key: this.key,
          paac_addr: this.address,
          paac_project: project,
        },
      },
    };
  }
}
