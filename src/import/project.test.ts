import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { RemoteBenefit, RemoteMeter, RemoteProduct } from "../polar/client.js";
import type { PolarInventory } from "../services/remote-resource-fetcher.js";
import { managedMetadata } from "../resources/adapter-utils.js";
import { buildImportModel } from "./project.js";

const meter = (
  overrides: Readonly<Record<string, unknown>> & { readonly id: string; readonly name: string },
): RemoteMeter =>
  ({
    unit: "token",
    customLabel: null,
    customMultiplier: null,
    filter: { conjunction: "and", clauses: [] },
    aggregation: { func: "count" },
    metadata: {},
    archivedAt: null,
    ...overrides,
  }) as unknown as RemoteMeter;

const meterCreditBenefit = (
  overrides: Readonly<Record<string, unknown>> & {
    readonly id: string;
    readonly description: string;
  },
): RemoteBenefit =>
  ({
    type: "meter_credit",
    isDeleted: false,
    metadata: {},
    properties: {
      units: 10_000,
      rollover: false,
      meterId: "met_tokens",
    },
    ...overrides,
  }) as RemoteBenefit;

const customBenefit = (
  overrides: Readonly<Record<string, unknown>> & {
    readonly id: string;
    readonly description: string;
  },
): RemoteBenefit =>
  ({
    type: "custom",
    isDeleted: false,
    metadata: {},
    properties: { note: null },
    ...overrides,
  }) as RemoteBenefit;

const product = (
  overrides: Readonly<Record<string, unknown>> & { readonly id: string; readonly name: string },
): RemoteProduct =>
  ({
    description: null,
    visibility: "public",
    recurringInterval: null,
    recurringIntervalCount: null,
    isArchived: false,
    metadata: {},
    prices: [],
    benefits: [],
    ...overrides,
  }) as unknown as RemoteProduct;

describe("buildImportModel", () => {
  it.effect("builds import model Meters with managed and unmanaged identities", () =>
    Effect.gen(function* () {
      const managed = meter({
        id: "met_managed",
        name: "Managed Tokens",
        metadata: managedMetadata("meter", "meter.tokens", "tokens"),
      });
      const unmanaged = meter({
        id: "met_input",
        name: "Input Tokens",
        unit: "scalar",
        aggregation: { func: "sum", property: "tokens" },
      });
      const archived = meter({
        id: "met_archived",
        name: "Archived Tokens",
        archivedAt: new Date("2024-01-01T00:00:00Z"),
      });
      const inventory: PolarInventory = {
        products: [],
        benefits: [],
        meters: [managed, unmanaged, archived],
      };

      const model = yield* buildImportModel({ inventory });

      expect(model.meters).toEqual([
        {
          desired: {
            source: "desired",
            kind: "meter",
            key: "tokens",
            address: "meter.tokens",
            spec: {
              name: "Managed Tokens",
              unit: "token",
              customLabel: null,
              customMultiplier: null,
              filter: { conjunction: "and", clauses: [] },
              aggregation: { func: "count" },
            },
          },
          variableName: "meterTokens",
          polarId: "met_managed",
          raw: managed,
          adoption: "AlreadyManaged",
        },
        {
          desired: {
            source: "desired",
            kind: "meter",
            key: "input-tokens",
            address: "meter.input-tokens",
            spec: {
              name: "Input Tokens",
              unit: "scalar",
              customLabel: null,
              customMultiplier: null,
              filter: { conjunction: "and", clauses: [] },
              aggregation: { func: "sum", property: "tokens" },
            },
          },
          variableName: "meterInputTokens",
          polarId: "met_input",
          raw: unmanaged,
          adoption: "NeedsAdoption",
        },
      ]);
      expect(model.resources).toEqual(model.meters);
    }),
  );

  it.effect("resolves meter-credit Benefits to Meter Resource Addresses", () =>
    Effect.gen(function* () {
      const tokensMeter = meter({ id: "met_tokens", name: "Tokens" });
      const includedTokens = meterCreditBenefit({
        id: "ben_included_tokens",
        description: "Included monthly tokens",
      });
      const inviteLink = customBenefit({
        id: "ben_invite",
        description: "Invite link",
        properties: { note: "Visit this link" },
      });

      const model = yield* buildImportModel({
        inventory: {
          products: [],
          meters: [tokensMeter],
          benefits: [includedTokens, inviteLink],
        },
      });

      expect(model.benefits.map((benefitModel) => benefitModel.desired.spec)).toEqual([
        {
          type: "meter-credit",
          description: "Included monthly tokens",
          meter: "meter.tokens",
          units: 10_000,
          rollover: false,
        },
        {
          type: "custom",
          description: "Invite link",
          note: "Visit this link",
        },
      ]);
      expect(model.resources.map((resource) => resource.desired.kind)).toEqual([
        "meter",
        "benefit",
        "benefit",
      ]);
    }),
  );

  it.effect("fails unsupported Benefits by default", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        buildImportModel({
          inventory: {
            products: [],
            meters: [],
            benefits: [
              {
                id: "ben_discord",
                type: "discord",
                description: "Discord access",
                isDeleted: false,
                metadata: {},
                properties: {},
              } as unknown as RemoteBenefit,
            ],
          },
        }),
      );

      expect(error).toMatchObject({ _tag: "ImportProjectionError" });
      expect(error.message).toContain("Failed to decode remote benefit");
    }),
  );

  it.effect("resolves Product prices and attached Benefits to Resource Addresses", () =>
    Effect.gen(function* () {
      const tokensMeter = meter({ id: "met_tokens", name: "Tokens" });
      const includedTokens = meterCreditBenefit({
        id: "ben_included_tokens",
        description: "Included monthly tokens",
      });
      const pro = product({
        id: "prod_pro",
        name: "Pro",
        description: "For serious users",
        recurringInterval: "month",
        recurringIntervalCount: null,
        prices: [
          {
            id: "price_fixed",
            amountType: "fixed",
            priceAmount: 3000,
            priceCurrency: "USD",
            isArchived: false,
          },
          {
            id: "price_free",
            amountType: "free",
            priceCurrency: "USD",
            isArchived: false,
          },
          {
            id: "price_custom",
            amountType: "custom",
            priceCurrency: "USD",
            minimumAmount: 1000,
            maximumAmount: 10000,
            presetAmount: null,
            isArchived: false,
          },
          {
            id: "price_metered",
            amountType: "metered_unit",
            priceCurrency: "USD",
            unitAmount: "0.1",
            capAmount: 10000,
            meterId: "met_tokens",
            isArchived: false,
          },
          {
            id: "price_archived",
            amountType: "fixed",
            priceAmount: 9999,
            priceCurrency: "USD",
            isArchived: true,
          },
        ],
        benefits: [{ id: "ben_included_tokens" }],
      });

      const model = yield* buildImportModel({
        inventory: {
          meters: [tokensMeter],
          benefits: [includedTokens],
          products: [pro],
        },
      });

      expect(model.products).toHaveLength(1);
      expect(model.products[0]?.desired.spec).toEqual({
        name: "Pro",
        description: "For serious users",
        prices: [
          { type: "fixed", amount: "3000", currency: "usd" },
          { type: "free", currency: "usd" },
          {
            type: "custom",
            currency: "usd",
            minimumAmount: "1000",
            maximumAmount: "10000",
            presetAmount: null,
          },
          {
            type: "meteredUnit",
            meter: "meter.tokens",
            amount: "0.1",
            currency: "usd",
            capAmount: "10000",
          },
        ],
        benefits: ["benefit.included-monthly-tokens"],
        visibility: "public",
        recurringInterval: "month",
        recurringIntervalCount: 1,
      });
      expect(model.resources.map((resource) => resource.desired.kind)).toEqual([
        "meter",
        "benefit",
        "product",
      ]);
    }),
  );
});
