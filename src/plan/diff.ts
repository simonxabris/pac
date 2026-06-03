import type {
  DesiredProduct,
  ProductCreatePayload,
  ProductUpdatePayload,
} from "../resources/product.js";
import type { RemoteProduct } from "../polar/client.js";

export type FieldChange = {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
};

export type PlanAction =
  | { readonly type: "create"; readonly address: string; readonly payload: ProductCreatePayload }
  | {
    readonly type: "update";
    readonly address: string;
    readonly remoteId: string;
    readonly changes: ReadonlyArray<FieldChange>;
    readonly payload: ProductUpdatePayload;
  }
  | { readonly type: "archive"; readonly address: string; readonly remoteId: string }
  | { readonly type: "no-op"; readonly address: string; readonly remoteId: string };

type ComparableProduct = {
  readonly name: string;
  readonly description: string | null;
  readonly visibility: string;
  readonly recurring_interval: string | null;
  readonly recurring_interval_count: number | null;
  readonly prices: ProductCreatePayload["prices"];
};

const comparableDesired = (desired: DesiredProduct): ComparableProduct => ({
  name: desired.payload.name,
  description: desired.payload.description,
  visibility: desired.payload.visibility,
  recurring_interval: desired.payload.recurring_interval,
  recurring_interval_count: desired.payload.recurring_interval_count,
  prices: desired.payload.prices,
});

const comparableRemote = (remote: RemoteProduct): ComparableProduct => ({
  name: remote.name ?? "",
  description: remote.description ?? null,
  visibility: remote.visibility ?? "public",
  recurring_interval: remote.recurring_interval ?? null,
  recurring_interval_count: remote.recurring_interval_count ?? null,
  prices: [
    {
      amount_type: "fixed",
      price_amount: remote.prices?.[0]?.price_amount ?? 0,
      price_currency: remote.prices?.[0]?.price_currency ?? "usd",
    },
  ],
});

const changesBetween = (
  before: ComparableProduct,
  after: ComparableProduct,
): ReadonlyArray<FieldChange> => {
  const changes: Array<FieldChange> = [];
  for (const field of [
    "name",
    "description",
    "visibility",
    "recurring_interval",
    "recurring_interval_count",
  ] as const) {
    if (before[field] !== after[field])
      changes.push({ field, before: before[field], after: after[field] });
  }
  const beforePrice = before.prices[0];
  const afterPrice = after.prices[0];
  for (const field of ["price_amount", "price_currency"] as const) {
    if (beforePrice[field] !== afterPrice[field])
      changes.push({ field, before: beforePrice[field], after: afterPrice[field] });
  }
  return changes;
};

export const buildPlan = (
  desiredProducts: ReadonlyArray<DesiredProduct>,
  remoteProducts: ReadonlyArray<RemoteProduct>,
  project: string,
): ReadonlyArray<PlanAction> => {
  const managedRemote = remoteProducts.filter(
    (product) =>
      product.metadata?.paac_project === project && product.metadata?.paac_type === "product",
  );
  const remoteByAddress = new Map(
    managedRemote.map((product) => [String(product.metadata?.paac_addr), product]),
  );
  const desiredAddresses = new Set<string>(desiredProducts.map((product) => product.address));
  const actions: Array<PlanAction> = [];

  for (const desired of desiredProducts) {
    const remote = remoteByAddress.get(desired.address);
    if (remote === undefined) {
      actions.push({ type: "create", address: desired.address, payload: desired.payload });
      continue;
    }
    const changes = changesBetween(comparableRemote(remote), comparableDesired(desired));
    if (changes.length === 0) {
      actions.push({ type: "no-op", address: desired.address, remoteId: remote.id });
    } else {
      actions.push({
        type: "update",
        address: desired.address,
        remoteId: remote.id,
        changes,
        payload: {
          name: desired.payload.name,
          description: desired.payload.description,
          visibility: desired.payload.visibility,
          recurring_interval: desired.payload.recurring_interval,
          recurring_interval_count: desired.payload.recurring_interval_count,
          prices: desired.payload.prices,
        },
      });
    }
  }

  for (const remote of managedRemote) {
    const address = String(remote.metadata?.paac_addr);
    if (!desiredAddresses.has(address))
      actions.push({ type: "archive", address, remoteId: remote.id });
  }
  return actions;
};
