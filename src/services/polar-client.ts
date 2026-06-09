import { Polar } from "@polar-sh/sdk";
import type { BenefitCreate } from "@polar-sh/sdk/models/components/benefitcreate.js";
import type { MeterCreate } from "@polar-sh/sdk/models/components/metercreate.js";
import type { MeterUpdate } from "@polar-sh/sdk/models/components/meterupdate.js";
import type { ProductCreate } from "@polar-sh/sdk/models/components/productcreate.js";
import type { ProductBenefitsUpdate } from "@polar-sh/sdk/models/components/productbenefitsupdate.js";
import type { ProductUpdate } from "@polar-sh/sdk/models/components/productupdate.js";
import type { BenefitsUpdateBenefitUpdate } from "@polar-sh/sdk/models/operations/benefitsupdate.js";
import { Effect, Layer, Redacted, Schema } from "effect";
import * as Context from "effect/Context";
import { AppConfig } from "./app-config.js";
import { OAuth } from "./oauth.js";
import { errorMessage } from "../utils.js";
import type { RemoteBenefit, RemoteMeter, RemoteProduct } from "../types/polar-sdk-types.js";

export type PolarClientShape = {
  readonly listBenefits: () => Effect.Effect<ReadonlyArray<RemoteBenefit>, PolarClientError>;
  readonly createBenefit: (
    payload: BenefitCreate,
  ) => Effect.Effect<RemoteBenefit, PolarClientError>;
  readonly updateBenefit: (
    id: string,
    payload: BenefitsUpdateBenefitUpdate,
  ) => Effect.Effect<RemoteBenefit, PolarClientError>;
  readonly deleteBenefit: (id: string) => Effect.Effect<void, PolarClientError>;
  readonly listProducts: () => Effect.Effect<ReadonlyArray<RemoteProduct>, PolarClientError>;
  readonly createProduct: (
    payload: ProductCreate,
  ) => Effect.Effect<RemoteProduct, PolarClientError>;
  readonly updateProduct: (
    id: string,
    payload: ProductUpdate,
  ) => Effect.Effect<RemoteProduct, PolarClientError>;
  readonly archiveProduct: (id: string) => Effect.Effect<RemoteProduct, PolarClientError>;
  readonly updateProductBenefits: (
    id: string,
    benefitIds: ReadonlyArray<string>,
  ) => Effect.Effect<RemoteProduct, PolarClientError>;
  readonly listMeters: () => Effect.Effect<ReadonlyArray<RemoteMeter>, PolarClientError>;
  readonly createMeter: (payload: MeterCreate) => Effect.Effect<RemoteMeter, PolarClientError>;
  readonly updateMeter: (
    id: string,
    payload: MeterUpdate,
  ) => Effect.Effect<RemoteMeter, PolarClientError>;
  readonly archiveMeter: (id: string) => Effect.Effect<RemoteMeter, PolarClientError>;
};

export class PolarClientError extends Schema.TaggedErrorClass<PolarClientError>()(
  "PolarClientError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) { }

const fromPromise = <A>(
  operation: string,
  try_: () => Promise<A>,
): Effect.Effect<A, PolarClientError> =>
  Effect.tryPromise({
    try: try_,
    catch: (cause) => new PolarClientError({ operation, message: errorMessage(cause) }),
  });

export class PolarClient extends Context.Service<PolarClient, PolarClientShape>()(
  "@paac/PolarClient",
) {
  static readonly layer = Layer.effect(
    PolarClient,
    Effect.gen(function*() {
      const config = yield* AppConfig;
      let accessToken = config.polarAccessToken;
      let organizationId: string | undefined;

      if (!accessToken) {
        const oauth = yield* OAuth;
        const token = yield* oauth.resolveAccessToken(config.polarEnv);
        const organization = yield* oauth.resolveSelectedOrganization(config.polarEnv);
        accessToken = token.token;
        organizationId = organization.id;
      }

      const withOrganizationId = <A extends object>(payload: A): A & { organizationId?: string } =>
        organizationId ? { ...payload, organizationId } : payload;

      const sdk = new Polar({
        accessToken: Redacted.value(accessToken),
        server: config.polarEnv,
        serverURL: config.polarServerUrl,
      });

      const listBenefits = Effect.fn("PolarClient.listBenefits")(() =>
        fromPromise("benefits.list", async () => {
          const iterator = await sdk.benefits.list(withOrganizationId({ limit: 100 }));
          const benefits: Array<RemoteBenefit> = [];
          for await (const page of iterator) {
            benefits.push(...page.result.items);
          }
          return benefits;
        }),
      );

      const createBenefit = Effect.fn("PolarClient.createBenefit")((payload: BenefitCreate) =>
        fromPromise("benefits.create", () => sdk.benefits.create(withOrganizationId(payload))),
      );

      const updateBenefit = Effect.fn("PolarClient.updateBenefit")(
        (id: string, payload: BenefitsUpdateBenefitUpdate) =>
          fromPromise("benefits.update", () => sdk.benefits.update({ id, requestBody: payload })),
      );

      const deleteBenefit = Effect.fn("PolarClient.deleteBenefit")((id: string) =>
        fromPromise("benefits.delete", () => sdk.benefits.delete({ id })),
      );

      const listProducts = Effect.fn("PolarClient.listProducts")(() =>
        fromPromise("products.list", async () => {
          const iterator = await sdk.products.list(withOrganizationId({ limit: 100 }));
          const products: Array<RemoteProduct> = [];
          for await (const page of iterator) {
            products.push(...page.result.items);
          }
          return products;
        }),
      );

      const createProduct = Effect.fn("PolarClient.createProduct")((payload: ProductCreate) =>
        fromPromise("products.create", () => sdk.products.create(withOrganizationId(payload))),
      );

      const updateProduct = Effect.fn("PolarClient.updateProduct")(
        (id: string, payload: ProductUpdate) =>
          fromPromise("products.update", () => sdk.products.update({ id, productUpdate: payload })),
      );

      const archiveProduct = Effect.fn("PolarClient.archiveProduct")((id: string) =>
        updateProduct(id, { isArchived: true }),
      );

      const updateProductBenefits = Effect.fn("PolarClient.updateProductBenefits")(
        (id: string, benefitIds: ReadonlyArray<string>) =>
          fromPromise("products.updateBenefits", () =>
            sdk.products.updateBenefits({
              id,
              productBenefitsUpdate: { benefits: [...benefitIds] } satisfies ProductBenefitsUpdate,
            }),
          ),
      );

      const listMeters = Effect.fn("PolarClient.listMeters")(() =>
        fromPromise("meters.list", async () => {
          const iterator = await sdk.meters.list(withOrganizationId({ limit: 100 }));
          const meters: Array<RemoteMeter> = [];
          for await (const page of iterator) {
            meters.push(...page.result.items);
          }
          return meters;
        }),
      );

      const createMeter = Effect.fn("PolarClient.createMeter")((payload: MeterCreate) =>
        fromPromise("meters.create", () => sdk.meters.create(withOrganizationId(payload))),
      );

      const updateMeter = Effect.fn("PolarClient.updateMeter")((id: string, payload: MeterUpdate) =>
        fromPromise("meters.update", () => sdk.meters.update({ id, meterUpdate: payload })),
      );

      const archiveMeter = Effect.fn("PolarClient.archiveMeter")((id: string) =>
        updateMeter(id, { isArchived: true }),
      );

      return PolarClient.of({
        listBenefits,
        createBenefit,
        updateBenefit,
        deleteBenefit,
        listProducts,
        createProduct,
        updateProduct,
        archiveProduct,
        updateProductBenefits,
        listMeters,
        createMeter,
        updateMeter,
        archiveMeter,
      });
    }),
  );
}
