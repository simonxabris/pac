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

export const fixedPrice = (_config: Omit<FixedPriceConfig, "type">): FixedPriceConfig =>
  ({ type: "fixed", amount: "0", currency: "usd" });

export const freePrice = (_config: Omit<FreePriceConfig, "type">): FreePriceConfig =>
  ({ type: "free", currency: "usd" });

export const customPrice = (_config: Omit<CustomPriceConfig, "type">): CustomPriceConfig =>
  ({ type: "custom", currency: "usd" });

export const meteredUnitPrice = (
  _config: Omit<MeteredUnitPriceConfig, "type" | "meter"> & { readonly meter: unknown },
): MeteredUnitPriceConfig =>
  ({ type: "meteredUnit", meter: "meter.stub", amount: "0", currency: "usd" });

export class Product {
  readonly type = "product" as const;
  readonly kind = "product" as const;
  readonly key: string;
  readonly address: `product.${string}`;
  readonly config: ProductConfig;

  constructor(key: string, config: ProductConfig) {
    this.key = key;
    this.address = `product.${key}`;
    this.config = config;
  }

  toDesiredResource(): unknown {
    return {};
  }

  toDesired(): unknown {
    return {};
  }
}
