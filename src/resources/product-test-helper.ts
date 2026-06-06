import type {
  CurrentProductProviderState,
  CurrentProductResource,
  ProductResource,
  ProductSpec,
} from "./product.js";

export const currentProductProviderState = (
  spec: ProductSpec,
  priceIds: ReadonlyArray<string> = [],
): CurrentProductProviderState => ({
  prices: spec.prices.map((price, index) => ({
    polarPriceId: priceIds[index] ?? `polar-price-${index}`,
    spec: price,
  })),
});

export const currentProductResource = ({
  desired,
  spec = desired.spec,
  polarId = `polar-${desired.key}`,
  priceIds,
  providerState = currentProductProviderState(spec, priceIds),
  isRemoved = false,
}: {
  readonly desired: ProductResource;
  readonly spec?: ProductSpec;
  readonly polarId?: string;
  readonly priceIds?: ReadonlyArray<string>;
  readonly providerState?: CurrentProductProviderState;
  readonly isRemoved?: boolean;
}): CurrentProductResource => ({
  source: "current",
  kind: "product",
  key: desired.key,
  address: desired.address,
  polarId,
  isRemoved,
  spec,
  providerState,
});
