import type { BenefitsUpdateBenefitUpdate } from "@polar-sh/sdk/models/operations/benefitsupdate.js";
import type { MeterUpdate } from "@polar-sh/sdk/models/components/meterupdate.js";
import type { ProductUpdate } from "@polar-sh/sdk/models/components/productupdate.js";
import { Effect, Layer, Option, Schema } from "effect";
import * as Context from "effect/Context";
import { PolarClient, type PolarClientError } from "../polar/service.js";
import { managedMetadata } from "../resources/adapter-utils.js";
import { errorMessage, hasPaacMetadata } from "../utils.js";
import type { ImportModel } from "./project.js";

export type ImportAdoptionSummary = {
  readonly adopted: number;
  readonly unchanged: number;
};

export class ImportAdoptionError extends Schema.TaggedErrorClass<ImportAdoptionError>()(
  "ImportAdoptionError",
  {
    kind: Schema.String,
    polarId: Schema.String,
    message: Schema.String,
  },
) {}

const PolarMetadataValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);
const PolarMetadata = Schema.Record(Schema.String, PolarMetadataValue);
type PolarMetadata = typeof PolarMetadata.Type;

const RemoteMetadataContainer = Schema.Struct({ metadata: PolarMetadata });
const decodeRemoteMetadataContainer = Schema.decodeUnknownOption(RemoteMetadataContainer);

const metadataFromRaw = (raw: unknown): PolarMetadata =>
  Option.match(decodeRemoteMetadataContainer(raw), {
    onNone: () => ({}),
    onSome: ({ metadata }) => ({ ...metadata }),
  });

const adoptableMetadata = (resource: ImportModel["resources"][number]): PolarMetadata => ({
  ...metadataFromRaw(resource.raw),
  ...managedMetadata(resource.desired.kind, resource.desired.address, resource.desired.key),
});

const updatePayload = (
  resource: ImportModel["resources"][number],
  metadata: PolarMetadata,
): ProductUpdate | MeterUpdate | BenefitsUpdateBenefitUpdate => {
  switch (resource.desired.kind) {
    case "product":
      return { metadata } satisfies ProductUpdate;
    case "meter":
      return { metadata } satisfies MeterUpdate;
    case "benefit":
      switch (resource.desired.spec.type) {
        case "meter-credit":
          return { type: "meter_credit", metadata } satisfies BenefitsUpdateBenefitUpdate;
        case "custom":
          return { type: "custom", metadata } satisfies BenefitsUpdateBenefitUpdate;
        case "feature-flag":
          return { type: "feature_flag", metadata } satisfies BenefitsUpdateBenefitUpdate;
      }
  }
};

export class ResourceAdopter extends Context.Service<
  ResourceAdopter,
  {
    readonly adopt: (
      model: ImportModel,
      options?: { readonly dryRun?: boolean; readonly force?: boolean },
    ) => Effect.Effect<ImportAdoptionSummary, ImportAdoptionError>;
  }
>()("@app/ResourceAdopter") {
  static readonly layer = Layer.effect(
    ResourceAdopter,
    Effect.gen(function* () {
      const polarClient = yield* PolarClient;

      const updateResource = (
        resource: ImportModel["resources"][number],
        metadata: PolarMetadata,
      ): Effect.Effect<void, PolarClientError> => {
        switch (resource.desired.kind) {
          case "product":
            return polarClient
              .updateProduct(resource.polarId, updatePayload(resource, metadata) as ProductUpdate)
              .pipe(Effect.asVoid);
          case "meter":
            return polarClient
              .updateMeter(resource.polarId, updatePayload(resource, metadata) as MeterUpdate)
              .pipe(Effect.asVoid);
          case "benefit":
            return polarClient
              .updateBenefit(
                resource.polarId,
                updatePayload(resource, metadata) as BenefitsUpdateBenefitUpdate,
              )
              .pipe(Effect.asVoid);
        }
      };

      return ResourceAdopter.of({
        adopt: (model, options = {}) =>
          Effect.gen(function* () {
            let adopted = 0;
            let unchanged = 0;

            for (const resource of model.resources) {
              if (resource.adoption === "AlreadyManaged") {
                unchanged += 1;
                continue;
              }

              if (hasPaacMetadata(resource.raw) && !options.force) {
                return yield* new ImportAdoptionError({
                  kind: resource.desired.kind,
                  polarId: resource.polarId,
                  message:
                    "Remote resource already has conflicting PAAC Metadata. Re-run with --force to overwrite it.",
                });
              }

              adopted += 1;
              if (options.dryRun) continue;

              const metadata = adoptableMetadata(resource);
              yield* updateResource(resource, metadata).pipe(
                Effect.mapError(
                  (cause) =>
                    new ImportAdoptionError({
                      kind: resource.desired.kind,
                      polarId: resource.polarId,
                      message: errorMessage(cause),
                    }),
                ),
              );
            }

            return { adopted, unchanged };
          }),
      });
    }),
  );
}
