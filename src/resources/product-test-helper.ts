import type {
  CurrentProductProviderState,
  CurrentProductResource,
  ProductResource,
  ProductSpec,
} from "./product.js";

export const currentProductProviderState = (
  spec: ProductSpec,
  priceIds: ReadonlyArray<string> = [],
  benefitIds: ReadonlyArray<string> = [],
): CurrentProductProviderState => ({
  prices: spec.prices.map((price, index) => ({
    polarPriceId: priceIds[index] ?? `polar-price-${index}`,
    spec: price,
  })),
  benefits: spec.benefits.map((address, index) => ({
    polarBenefitId: benefitIds[index] ?? `polar-benefit-${index}`,
    address,
  })),
});

export const currentProductResource = ({
  desired,
  spec = desired.spec,
  polarId = `polar-${desired.key}`,
  priceIds,
  benefitIds,
  providerState = currentProductProviderState(spec, priceIds, benefitIds),
  isRemoved = false,
}: {
  readonly desired: ProductResource;
  readonly spec?: ProductSpec;
  readonly polarId?: string;
  readonly priceIds?: ReadonlyArray<string>;
  readonly benefitIds?: ReadonlyArray<string>;
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
