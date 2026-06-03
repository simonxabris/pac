import type { Product as RemoteProduct } from "@polar-sh/sdk/models/components/product.js";
import * as Effect from "effect/Effect";
import { decodeJsonObject } from "../../../../core/json.js";
import { decodePaacMetadata, decodePaacMetadataResult, type ManagedIdentity } from "../../../../core/metadata.js";
import type { ResourceAdapter } from "../../../../core/adapter.js";
import { errorDiagnostic } from "../../../../core/diagnostic.js";
import type { FieldSemantics } from "../../../../core/field-semantics.js";
import type { CanonicalResource, DesiredResource } from "../../../../core/resource.js";
import type { PolarClientShape } from "../../../../polar/service.js";
import { planProductArchive, planProductCreate, planProductUpdate } from "./operations.js";
import {
  decodeProductDesiredConfig,
  decodeRemoteProductV1,
  decodeRemoteProductPriceArchiveState,
  decodeRemoteStaticProductPrice,
  productManagedJson,
  type CanonicalProductPrice,
  type RemoteStaticProductPrice,
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

const remotePriceToCanonical = (price: RemoteStaticProductPrice): CanonicalProductPrice => {
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
  }
};

const isActivePrice = (price: unknown): boolean => {
  try {
    return decodeRemoteProductPriceArchiveState(price).isArchived !== true;
  } catch {
    return true;
  }
};

const normalizeRemotePrice = (remote: ReturnType<typeof decodeRemoteProductV1>) =>
  Effect.gen(function*() {
    const activePrices = remote.prices.filter(isActivePrice);
    if (activePrices.length !== 1) {
      const identity = decodePaacMetadata(remote.metadata);
      return yield* Effect.fail(
        errorDiagnostic({
          code: "PAAC_UNSUPPORTED_REMOTE_SHAPE",
          message:
            "Remote product has unsupported pricing shape. This PAAC version supports exactly one active managed static Product Price.",
          ...(identity === undefined ? {} : { address: identity.address }),
          path: "/prices",
          hint: "Archive or remove extra active prices until keyed Product Price imports are implemented.",
        }),
      );
    }

    try {
      return remotePriceToCanonical(decodeRemoteStaticProductPrice(activePrices[0]));
    } catch {
      const identity = decodePaacMetadata(remote.metadata);
      return yield* Effect.fail(
        errorDiagnostic({
          code: "PAAC_UNSUPPORTED_REMOTE_SHAPE",
          message:
            "Remote active product price is not a supported static fixed, free, or custom Product Price.",
          ...(identity === undefined ? {} : { address: identity.address }),
          path: "/prices/base",
        }),
      );
    }
  });

export const makeProductAdapter = (polar: PolarClientShape): ResourceAdapter<RemoteProduct> => ({
  kind: "product",
  listRemote: polar.listProducts,
  getRemoteIdentity: (remote) => decodePaacMetadataResult(remote.metadata),
  fieldSemantics: productFieldSemantics,
  normalizeDesired: (desired) =>
    Effect.gen(function*() {
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
    Effect.gen(function*() {
      let product: ReturnType<typeof decodeRemoteProductV1>;
      try {
        product = decodeRemoteProductV1(remote);
      } catch {
        const identity = decodePaacMetadata(remote.metadata);
        return yield* Effect.fail(
          errorDiagnostic({
            code: "PAAC_UNSUPPORTED_REMOTE_SHAPE",
            message: "Remote product does not match the Polar product schema supported by this adapter.",
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

      const price = yield* normalizeRemotePrice(product);
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
          prices: [price],
        }),
        metadata: identity,
        raw: remote,
      } satisfies CanonicalResource;
    }),
  planCreate: (resource) => planProductCreate(resource),
  planUpdate: (change) => planProductUpdate(change),
  planDelete: (resource) => planProductArchive(resource),
});
