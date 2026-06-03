import type * as Effect from "effect/Effect";

export type MetadataValue = string | number | boolean | null | undefined;

export type RemoteProduct = {
  readonly id: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly visibility?: string;
  readonly recurring_interval?: string | null;
  readonly recurring_interval_count?: number | null;
  readonly prices?: ReadonlyArray<{
    readonly amount_type?: string;
    readonly price_amount?: number;
    readonly price_currency?: string;
  }>;
  readonly metadata?: Record<string, MetadataValue>;
};

export type PolarClient<R = never> = {
  readonly listProducts: Effect.Effect<ReadonlyArray<RemoteProduct>, Error, R>;
};
