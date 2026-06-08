import { Effect, Option, Schema } from "effect";
import type { ResourceAddress } from "../core/address.js";
import type { ResourceKind } from "../core/kind.js";
import type { DesiredResource } from "../core/resource.js";
import type { RemoteBenefit, RemoteMeter, RemoteProduct } from "../polar/client.js";
import {
  RemoteBenefitSdk,
  RemoteMeterSdk,
  RemoteProductSdk,
  remoteBenefitToSpec,
  remoteMeterToSpec,
  remoteProductToSpec,
  type PolarInventory,
} from "../remote-resource-fetcher.js";
import type { BenefitAddress, BenefitSpec } from "../resources/benefit.js";
import type { MeterAddress, MeterSpec } from "../resources/meter.js";
import type { ProductSpec } from "../resources/product.js";
import { errorMessage } from "../utils.js";
import { assignImportIdentities, type AssignedImportIdentity } from "./classify.js";

export type ImportSkippedResource = {
  readonly kind: ResourceKind;
  readonly polarId: string;
  readonly label: string;
  readonly reason: string;
};

type ImportResourceModel<
  Kind extends ResourceKind = ResourceKind,
  Spec = unknown,
  Raw = unknown,
> = {
  readonly desired: DesiredResource<Kind, Spec>;
  readonly variableName: string;
  readonly polarId: string;
  readonly raw: Raw;
  readonly adoption: "NeedsAdoption" | "AlreadyManaged";
};

type ImportMeterResourceModel = ImportResourceModel<"meter", MeterSpec, typeof RemoteMeterSdk.Type>;

type ImportBenefitResourceModel = ImportResourceModel<
  "benefit",
  BenefitSpec,
  typeof RemoteBenefitSdk.Type
>;

type ImportProductResourceModel = ImportResourceModel<
  "product",
  ProductSpec,
  typeof RemoteProductSdk.Type
>;

export type ImportModel = {
  readonly meters: ReadonlyArray<ImportMeterResourceModel>;
  readonly benefits: ReadonlyArray<ImportBenefitResourceModel>;
  readonly products: ReadonlyArray<ImportProductResourceModel>;
  readonly resources: ReadonlyArray<
    ImportMeterResourceModel | ImportBenefitResourceModel | ImportProductResourceModel
  >;
  readonly skipped: ReadonlyArray<ImportSkippedResource>;
};

export class ImportProjectionError extends Schema.TaggedErrorClass<ImportProjectionError>()(
  "ImportProjectionError",
  {
    message: Schema.String,
  },
) {}

const RemoteImportResourceInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
});

const decodeRemoteImportResourceInfo = Schema.decodeUnknownOption(RemoteImportResourceInfo);

const remoteInfo = (remote: unknown): typeof RemoteImportResourceInfo.Type =>
  Option.getOrElse(decodeRemoteImportResourceInfo(remote), () => ({ id: "unknown" }));

const remoteId = (remote: unknown): string => remoteInfo(remote).id;

const remoteLabel = (remote: unknown): string => {
  const info = remoteInfo(remote);
  return info.name ?? info.description ?? info.id;
};

const decodeRemoteMeter = (meter: RemoteMeter) =>
  Schema.decodeUnknownEffect(RemoteMeterSdk)(meter).pipe(
    Effect.mapError(
      (cause) =>
        new ImportProjectionError({
          message: `Failed to decode remote meter: ${errorMessage(cause)}`,
        }),
    ),
  );

const decodeRemoteBenefit = (benefit: RemoteBenefit) =>
  Schema.decodeUnknownEffect(RemoteBenefitSdk)(benefit).pipe(
    Effect.mapError(
      (cause) =>
        new ImportProjectionError({
          message: `Failed to decode remote benefit: ${errorMessage(cause)}`,
        }),
    ),
  );

const decodeRemoteProduct = (product: RemoteProduct) =>
  Schema.decodeUnknownEffect(RemoteProductSdk)(product).pipe(
    Effect.mapError(
      (cause) =>
        new ImportProjectionError({
          message: `Failed to decode remote product: ${errorMessage(cause)}`,
        }),
    ),
  );

const identityByPolarId = (
  identities: ReadonlyArray<AssignedImportIdentity>,
): ReadonlyMap<string, AssignedImportIdentity> =>
  new Map(identities.map((identity) => [identity.polarId, identity]));

const addressesByPolarId = <Kind extends ResourceKind>(
  resources: ReadonlyArray<ImportResourceModel<Kind>>,
): Readonly<Record<string, ResourceAddress<Kind>>> =>
  Object.fromEntries(
    resources.map((resource) => [resource.polarId, resource.desired.address]),
  ) as Record<string, ResourceAddress<Kind>>;

const failProjection = (message: string): Effect.Effect<never, ImportProjectionError> =>
  Effect.fail(new ImportProjectionError({ message }));

type BuildImportModelOptions = {
  readonly inventory: PolarInventory;
  readonly skipUnsupported?: boolean;
  readonly force?: boolean;
};

const decodeSupportedResources = <A, B>(
  resources: ReadonlyArray<A>,
  decode: (resource: A) => Effect.Effect<B, ImportProjectionError>,
  skipped: Array<ImportSkippedResource>,
  input: {
    readonly kind: ResourceKind;
    readonly skipUnsupported: boolean;
  },
): Effect.Effect<ReadonlyArray<B>, ImportProjectionError> =>
  Effect.forEach(resources, (resource) =>
    decode(resource).pipe(
      Effect.map((decoded) => [decoded] as ReadonlyArray<B>),
      Effect.catchIf(
        () => input.skipUnsupported,
        (error) => {
          skipped.push({
            kind: input.kind,
            polarId: remoteId(resource),
            label: remoteLabel(resource),
            reason: error.message,
          });
          return Effect.succeed([] as ReadonlyArray<B>);
        },
      ),
    ),
  ).pipe(Effect.map((chunks) => chunks.flat()));

export const buildImportModel = ({
  inventory,
  skipUnsupported = false,
  force = false,
}: BuildImportModelOptions): Effect.Effect<ImportModel, ImportProjectionError> =>
  Effect.gen(function* () {
    const skipped: Array<ImportSkippedResource> = [];
    const meters = yield* decodeSupportedResources(inventory.meters, decodeRemoteMeter, skipped, {
      kind: "meter",
      skipUnsupported,
    });
    const benefits = yield* decodeSupportedResources(
      inventory.benefits,
      decodeRemoteBenefit,
      skipped,
      {
        kind: "benefit",
        skipUnsupported,
      },
    );
    const products = yield* decodeSupportedResources(
      inventory.products,
      decodeRemoteProduct,
      skipped,
      {
        kind: "product",
        skipUnsupported,
      },
    );

    const identities = yield* assignImportIdentities(
      [
        ...meters.map((meter) => ({
          kind: "meter" as const,
          polarId: meter.id,
          label: meter.name,
          metadata: meter.metadata,
          isRemoved: meter.archivedAt != null,
          supported: true,
        })),
        ...benefits.map((benefit) => ({
          kind: "benefit" as const,
          polarId: benefit.id,
          label: benefit.description,
          metadata: benefit.metadata,
          isRemoved: benefit.isDeleted,
          supported: true,
        })),
        ...products.map((product) => ({
          kind: "product" as const,
          polarId: product.id,
          label: product.name,
          metadata: product.metadata,
          isRemoved: product.isArchived,
          supported: true,
        })),
      ],
      { allowConflictingMetadata: force },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new ImportProjectionError({
            message: cause.message,
          }),
      ),
    );
    const identitiesByPolarId = identityByPolarId(identities);

    const meterModels = meters.flatMap((meter): ReadonlyArray<ImportMeterResourceModel> => {
      const identity = identitiesByPolarId.get(meter.id);
      if (identity === undefined) return [];

      return [
        {
          desired: {
            source: "desired",
            kind: "meter",
            key: identity.key,
            address: identity.address as ResourceAddress<"meter">,
            spec: remoteMeterToSpec(meter),
          },
          variableName: identity.variableName,
          polarId: meter.id,
          raw: meter,
          adoption: identity.adoption,
        },
      ];
    });

    const meterAddressesById = addressesByPolarId(meterModels) as Readonly<
      Record<string, MeterAddress>
    >;

    const benefitModels = yield* Effect.forEach(benefits, (benefit) => {
      const identity = identitiesByPolarId.get(benefit.id);
      if (identity === undefined)
        return Effect.succeed([] as ReadonlyArray<ImportBenefitResourceModel>);

      return Effect.try({
        try: (): ReadonlyArray<ImportBenefitResourceModel> => [
          {
            desired: {
              source: "desired",
              kind: "benefit",
              key: identity.key,
              address: identity.address as ResourceAddress<"benefit">,
              spec: remoteBenefitToSpec({ benefit, meterAddressesById }),
            },
            variableName: identity.variableName,
            polarId: benefit.id,
            raw: benefit,
            adoption: identity.adoption,
          },
        ],
        catch: (cause) =>
          new ImportProjectionError({
            message: `Failed to project remote benefit '${benefit.id}': ${errorMessage(cause)}`,
          }),
      });
    }).pipe(Effect.map((chunks) => chunks.flat()));

    const benefitAddressesById = addressesByPolarId(benefitModels) as Readonly<
      Record<string, BenefitAddress>
    >;

    const productModels = yield* Effect.forEach(products, (product) => {
      const identity = identitiesByPolarId.get(product.id);
      if (identity === undefined)
        return Effect.succeed([] as ReadonlyArray<ImportProductResourceModel>);

      const missingBenefit = product.benefits.find(
        (benefit) => benefitAddressesById[benefit.id] === undefined,
      );
      if (missingBenefit !== undefined) {
        return failProjection(
          `Product '${product.id}' references unmanaged or unknown benefit '${missingBenefit.id}'.`,
        );
      }

      return Effect.try({
        try: (): ReadonlyArray<ImportProductResourceModel> => [
          {
            desired: {
              source: "desired",
              kind: "product",
              key: identity.key,
              address: identity.address as ResourceAddress<"product">,
              spec: remoteProductToSpec({ product, meterAddressesById, benefitAddressesById }),
            },
            variableName: identity.variableName,
            polarId: product.id,
            raw: product,
            adoption: identity.adoption,
          },
        ],
        catch: (cause) =>
          new ImportProjectionError({
            message: `Failed to project remote product '${product.id}': ${errorMessage(cause)}`,
          }),
      });
    }).pipe(Effect.map((chunks) => chunks.flat()));

    return {
      meters: meterModels,
      benefits: benefitModels,
      products: productModels,
      resources: [...meterModels, ...benefitModels, ...productModels],
      skipped,
    };
  });
