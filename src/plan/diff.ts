import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import type { DesiredProduct, ProductCreatePayload, ProductUpdatePayload } from "../resources/product.js";
import type { RemoteProduct } from "../polar/client.js";

export type FieldChange = { readonly field: string; readonly before: unknown; readonly after: unknown };

export type PlanAction =
  | { readonly type: "create"; readonly address: string; readonly payload: ProductCreatePayload }
  | { readonly type: "update"; readonly address: string; readonly remoteId: string; readonly changes: ReadonlyArray<FieldChange>; readonly payload: ProductUpdatePayload }
  | { readonly type: "archive"; readonly address: string; readonly remoteId: string }
  | { readonly type: "no-op"; readonly address: string; readonly remoteId: string };

const ProductPriceState = Schema.Struct({
  amountType: Schema.Literal("fixed"),
  priceAmount: Schema.Number,
  priceCurrency: Schema.String,
});

const ProductState = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  visibility: Schema.String,
  recurringInterval: Schema.NullOr(Schema.String),
  recurringIntervalCount: Schema.NullOr(Schema.Number),
  prices: Schema.Array(ProductPriceState),
});

type ProductState = typeof ProductState.Type;

const decodeProductState = Schema.decodeUnknownSync(ProductState);
const productStateEquals = Schema.toEquivalence(ProductState);

const PaacMetadata = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  key: Schema.optionalKey(Schema.String),
  addr: Schema.optionalKey(Schema.String),
  project: Schema.optionalKey(Schema.String),
});

type PaacMetadata = typeof PaacMetadata.Type;

const desiredProductState = (desired: DesiredProduct): ProductState =>
  decodeProductState({
    name: desired.payload.name,
    description: desired.payload.description,
    visibility: desired.payload.visibility,
    recurringInterval: desired.payload.recurringInterval,
    recurringIntervalCount: desired.payload.recurringIntervalCount,
    prices: desired.payload.prices.map((price) => ({
      amountType: "fixed",
      priceAmount: price.priceAmount,
      priceCurrency: price.priceCurrency.toLowerCase(),
    })),
  });

const remoteProductState = (remote: RemoteProduct): ProductState => {
  const price = remote.prices[0];
  return decodeProductState({
    name: remote.name,
    description: remote.description,
    visibility: remote.visibility,
    recurringInterval: remote.recurringInterval,
    recurringIntervalCount: remote.recurringIntervalCount,
    prices: [
      {
        amountType: "fixed",
        priceAmount: price !== undefined && "priceAmount" in price ? price.priceAmount : 0,
        priceCurrency: String(
          price !== undefined && "priceCurrency" in price ? price.priceCurrency : "usd",
        ).toLowerCase(),
      },
    ],
  });
};

const parsePaacMetadata = (metadata: RemoteProduct["metadata"]): PaacMetadata | undefined => {
  const value = metadata?.paac;
  if (typeof value !== "string") return undefined;
  try {
    return Schema.decodeUnknownSync(PaacMetadata)(JSON.parse(value));
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const appendPath = (base: string, segment: string): string => (base === "" ? segment : `${base}.${segment}`);

const diffCanonical = (before: unknown, after: unknown, path = ""): ReadonlyArray<FieldChange> => {
  if (Equal.equals(before, after)) return [];

  if (Array.isArray(before) && Array.isArray(after)) {
    const changes: Array<FieldChange> = [];
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index++) {
      changes.push(...diffCanonical(before[index], after[index], `${path}[${index}]`));
    }
    return changes;
  }

  if (isRecord(before) && isRecord(after)) {
    const changes: Array<FieldChange> = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      changes.push(...diffCanonical(before[key], after[key], appendPath(path, key)));
    }
    return changes;
  }

  return [{ field: path, before, after }];
};

const productChanges = (before: ProductState, after: ProductState): ReadonlyArray<FieldChange> =>
  productStateEquals(before, after) ? [] : diffCanonical(before, after);

const productUpdatePayload = (desired: DesiredProduct): ProductUpdatePayload => ({
  name: desired.payload.name,
  description: desired.payload.description,
  visibility: desired.payload.visibility,
  recurringInterval: desired.payload.recurringInterval,
  recurringIntervalCount: desired.payload.recurringIntervalCount,
  prices: desired.payload.prices,
});

export const buildPlan = (
  desiredProducts: ReadonlyArray<DesiredProduct>,
  remoteProducts: ReadonlyArray<RemoteProduct>,
  project: string,
): ReadonlyArray<PlanAction> => {
  const managedRemote = remoteProducts.filter((product) => {
    const metadata = parsePaacMetadata(product.metadata);
    return metadata?.project === project && metadata.type === "product";
  });
  const remoteByAddress = new Map(
    managedRemote.flatMap((product) => {
      const address = parsePaacMetadata(product.metadata)?.addr;
      return address === undefined ? [] : [[address, product] as const];
    }),
  );
  const desiredAddresses = new Set<string>(desiredProducts.map((product) => product.address));
  const actions: Array<PlanAction> = [];

  for (const desired of desiredProducts) {
    const remote = remoteByAddress.get(desired.address);
    if (remote === undefined) {
      actions.push({ type: "create", address: desired.address, payload: desired.payload });
      continue;
    }

    const before = remoteProductState(remote);
    const after = desiredProductState(desired);
    const changes = productChanges(before, after);

    if (changes.length === 0) {
      actions.push({ type: "no-op", address: desired.address, remoteId: remote.id });
    } else {
      actions.push({
        type: "update",
        address: desired.address,
        remoteId: remote.id,
        changes,
        payload: productUpdatePayload(desired),
      });
    }
  }

  for (const remote of managedRemote) {
    const address = parsePaacMetadata(remote.metadata)?.addr;
    if (address !== undefined && !desiredAddresses.has(address)) {
      actions.push({ type: "archive", address, remoteId: remote.id });
    }
  }
  return actions;
};
