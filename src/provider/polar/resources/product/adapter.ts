import type { Product as RemoteProduct } from "@polar-sh/sdk/models/components/product.js";
import * as Effect from "effect/Effect";
import { decodeJsonObject } from "../../../../core/json.js";
import {
  decodePaacMetadata,
  decodePaacMetadataResult,
  type ManagedIdentity,
} from "../../../../core/metadata.js";
import type { ResourceAdapter } from "../../../../core/adapter.js";
import { errorDiagnostic } from "../../../../core/diagnostic.js";
import type { FieldSemantics } from "../../../../core/field-semantics.js";
import type { CanonicalResource, DesiredResource } from "../../../../core/resource.js";
import type { PolarClientShape } from "../../../../polar/service.js";
import { planProductArchive, planProductCreate, planProductUpdate } from "./operations.js";
import {
  decodeProductDesiredConfig,
  decodeRemoteProductPriceArchiveState,
  decodeRemoteProductV1,
  decodeRemoteSupportedProductPrice,
  productManagedJson,
  type CanonicalProductPrice,
  type RemoteProductV1,
  type RemoteSupportedProductPrice,
} from "./schema.js";

export const productFieldSemantics: FieldSemantics = [
  { path: "/name", rule: { mode: "update" } },
  { path: "/description", rule: { mode: "update" } },
  { path: "/visibility", rule: { mode: "update" } },
  { path: "/isArchived", rule: { mode: "update" } },
  { path: "/billing/recurringInterval", rule: { mode: "createOnly" } },
  { path: "/billing/recurringIntervalCount", rule: { mode: "createOnly" } },
  { path: "/prices", rule: { mode: "custom", handler: "productPrices" } },
];

const identityForDesired = (desired: DesiredResource): ManagedIdentity => ({
  version: 1,
  kind: "product",
  address: desired.address,
  key: desired.key,
});

const meterPriceKey = (meterAddress: string): string =>
  meterAddress.startsWith("meter.")
    ? `meter:${meterAddress.slice("meter.".length)}`
    : `meter:${meterAddress}`;

const remoteStaticPriceToCanonical = (
  price: RemoteSupportedProductPrice,
): CanonicalProductPrice => {
  switch (price.amountType) {
    case "fixed":
      return {
        key: "base",
        type: "fixed",
        amount: price.priceAmount,
        currency: price.priceCurrency.toLowerCase(),
      };
    case "free":
      return {
        key: "base",
        type: "free",
        currency: price.priceCurrency.toLowerCase(),
      };
    case "custom":
      return {
        key: "base",
        type: "custom",
        currency: price.priceCurrency.toLowerCase(),
        minimumAmount: price.minimumAmount,
        maximumAmount: price.maximumAmount,
        presetAmount: price.presetAmount,
      };
    case "metered_unit":
      throw new Error("Metered prices require meter address resolution.");
  }
};

const isActivePrice = (price: unknown): boolean => {
  try {
    return decodeRemoteProductPriceArchiveState(price).isArchived !== true;
  } catch {
    return true;
  }
};

type NormalizedPrices = {
  readonly prices: ReadonlyArray<CanonicalProductPrice>;
  readonly priceIdsByKey: Record<string, string>;
};

const managedMeterAddressesById = (polar: PolarClientShape) =>
  Effect.gen(function* () {
    const meters = yield* polar.listMeters();
    const map = new Map<string, string>();
    for (const meter of meters) {
      const identity = decodePaacMetadata(meter.metadata);
      if (identity?.kind === "meter") {
        map.set(meter.id, identity.address);
      }
    }
    return map;
  });

const normalizeRemotePrices = (
  product: RemoteProductV1,
  polar: PolarClientShape,
): Effect.Effect<NormalizedPrices, ReturnType<typeof errorDiagnostic>, never> =>
  Effect.gen(function* () {
    const identity = decodePaacMetadata(product.metadata);
    const activePrices = product.prices.filter(isActivePrice);
    if (activePrices.length === 0) {
      return yield* Effect.fail(
        errorDiagnostic({
          code: "PAAC_UNSUPPORTED_REMOTE_SHAPE",
          message: "Remote product has no active Product Prices.",
          ...(identity === undefined ? {} : { address: identity.address }),
          path: "/prices",
        }),
      );
    }

    const supportedPrices: Array<RemoteSupportedProductPrice> = [];
    for (const price of activePrices) {
      try {
        supportedPrices.push(decodeRemoteSupportedProductPrice(price));
      } catch {
        return yield* Effect.fail(
          errorDiagnostic({
            code: "PAAC_UNSUPPORTED_REMOTE_SHAPE",
            message:
              "Remote active product price is not a supported fixed, free, custom, or metered Product Price.",
            ...(identity === undefined ? {} : { address: identity.address }),
            path: "/prices",
          }),
        );
      }
    }

    const staticPrices = supportedPrices.filter((price) => price.amountType !== "metered_unit");
    if (staticPrices.length > 1) {
      return yield* Effect.fail(
        errorDiagnostic({
          code: "PAAC_UNSUPPORTED_REMOTE_SHAPE",
          message:
            "Remote product has unsupported pricing shape. PAAC supports at most one active static Product Price and any number of active metered Product Prices.",
          ...(identity === undefined ? {} : { address: identity.address }),
          path: "/prices",
          hint: "Archive or remove extra active static prices until keyed Product Price imports are implemented.",
        }),
      );
    }

    const meterAddressesById = supportedPrices.some((price) => price.amountType === "metered_unit")
      ? yield* managedMeterAddressesById(polar).pipe(
          Effect.mapError((error) =>
            errorDiagnostic({
              code: "PAAC_METER_LOOKUP_FAILED",
              message: `Failed to list Polar meters while normalizing Product prices: ${error.message}`,
              ...(identity === undefined ? {} : { address: identity.address }),
              path: "/prices",
            }),
          ),
        )
      : new Map<string, string>();

    const prices: Array<CanonicalProductPrice> = [];
    const priceIdsByKey: Record<string, string> = {};

    for (const price of supportedPrices) {
      const canonical =
        price.amountType === "metered_unit"
          ? (() => {
              const meterAddress = meterAddressesById.get(price.meterId);
              if (meterAddress === undefined) return undefined;
              return {
                key: meterPriceKey(meterAddress),
                type: "meteredUnit" as const,
                meter: meterAddress,
                unitAmount: price.unitAmount,
                currency: price.priceCurrency.toLowerCase(),
                capAmount: price.capAmount,
              };
            })()
          : remoteStaticPriceToCanonical(price);

      if (canonical === undefined) {
        return yield* Effect.fail(
          errorDiagnostic({
            code: "PAAC_UNSUPPORTED_REMOTE_SHAPE",
            message: "Remote metered Product Price references a Meter not managed by PAAC.",
            ...(identity === undefined ? {} : { address: identity.address }),
            path: "/prices",
          }),
        );
      }

      prices.push(canonical);
      if (price.id !== undefined) {
        priceIdsByKey[canonical.key] = price.id;
      }
    }

    return { prices, priceIdsByKey };
  });

export const makeProductAdapter = (polar: PolarClientShape): ResourceAdapter<RemoteProduct> => ({
  kind: "product",
  listRemote: polar.listProducts,
  getRemoteIdentity: (remote) => decodePaacMetadataResult(remote.metadata),
  fieldSemantics: productFieldSemantics,
  normalizeDesired: (desired) =>
    Effect.gen(function* () {
      try {
        const config = decodeProductDesiredConfig(desired.config);
        return {
          kind: "product",
          address: desired.address,
          provider: "polar" as const,
          managed: productManagedJson(config.managed),
          metadata: identityForDesired(desired),
          raw: decodeJsonObject({}),
        } satisfies CanonicalResource;
      } catch {
        return yield* Effect.fail(
          errorDiagnostic({
            code: "PAAC_INVALID_PRODUCT_CONFIG",
            message: `Desired product ${desired.address} does not match the Product adapter schema.`,
            address: desired.address,
          }),
        );
      }
    }),
  normalizeRemote: (remote) =>
    Effect.gen(function* () {
      let product: ReturnType<typeof decodeRemoteProductV1>;
      try {
        product = decodeRemoteProductV1(remote);
      } catch {
        const identity = decodePaacMetadata(remote.metadata);
        return yield* Effect.fail(
          errorDiagnostic({
            code: "PAAC_UNSUPPORTED_REMOTE_SHAPE",
            message:
              "Remote product does not match the Polar product schema supported by this adapter.",
            ...(identity === undefined ? {} : { address: identity.address }),
          }),
        );
      }

      const identity = decodePaacMetadata(product.metadata);
      if (identity === undefined) {
        return yield* Effect.fail(
          errorDiagnostic({
            code: "PAAC_MISSING_REMOTE_IDENTITY",
            message: "Remote product is missing PAAC managed identity metadata.",
          }),
        );
      }
      if (identity.kind !== "product") {
        return yield* Effect.fail(
          errorDiagnostic({
            code: "PAAC_REMOTE_KIND_MISMATCH",
            message: `Remote metadata kind ${identity.kind} does not match product adapter.`,
            address: identity.address,
          }),
        );
      }

      const normalizedPrices = yield* normalizeRemotePrices(product, polar);
      return {
        kind: "product",
        address: identity.address,
        provider: "polar" as const,
        providerId: product.id,
        managed: productManagedJson({
          name: product.name,
          description: product.description,
          visibility: product.visibility,
          isArchived: product.isArchived,
          billing: {
            recurringInterval: product.recurringInterval,
            recurringIntervalCount: product.recurringIntervalCount,
          },
          prices: normalizedPrices.prices,
        }),
        metadata: identity,
        raw: { product: remote, priceIdsByKey: normalizedPrices.priceIdsByKey },
      } satisfies CanonicalResource;
    }),
  planCreate: (resource) => planProductCreate(resource),
  planUpdate: (change) => planProductUpdate(change),
  planDelete: (resource) => planProductArchive(resource),
});
