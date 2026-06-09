import { Console, Effect, Equal, Layer, Schema } from "effect";
import * as Context from "effect/Context";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Command from "effect/unstable/cli/Command";
import { ConfigLoader } from "../services/config-loader.js";
import { CodeGenerator, type CodeGenerationError } from "../services/code-generator.js";
import { ResourceAdopter, type ImportAdoptionError } from "../services/resource-adopter.js";
import {
  buildImportModel,
  type ImportModel,
  type ImportProjectionError,
} from "../import/project.js";
import { Planner } from "../services/planner.js";
import {
  RemoteResourceFetcher,
  RemoteResourceFetchError,
} from "../services/remote-resource-fetcher.js";
import {
  dryRunFlag,
  forceFlag,
  importPathFlag,
  overwriteFlag,
  skipUnsupportedFlag,
} from "./options.js";

export type ImportCommandInput = {
  readonly path: string;
  readonly overwrite: boolean;
  readonly dryRun: boolean;
  readonly skipUnsupported: boolean;
  readonly force: boolean;
};

type ImportCommandError =
  | RemoteResourceFetchError
  | ImportProjectionError
  | CodeGenerationError
  | ImportOutputPathError
  | ImportAdoptionError
  | ImportValidationError
  | PlatformError;

export class ImportOutputPathError extends Schema.TaggedErrorClass<ImportOutputPathError>()(
  "ImportOutputPathError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class ImportValidationError extends Schema.TaggedErrorClass<ImportValidationError>()(
  "ImportValidationError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

const resolveImportOutputPath = (
  inputPath: string,
  fs: FileSystem.FileSystem,
  path: Path.Path,
  overwrite: boolean,
): Effect.Effect<
  { readonly directory: string; readonly filePath: string },
  ImportOutputPathError | PlatformError
> =>
  Effect.gen(function* () {
    const filePath = path.resolve(inputPath);
    const exists = yield* fs.exists(filePath);

    if (exists) {
      const info = yield* fs.stat(filePath);
      if (info.type !== "File") {
        return yield* new ImportOutputPathError({
          path: filePath,
          message: `Import path must be a file path, got ${info.type}: ${filePath}`,
        });
      }

      if (!overwrite) {
        return yield* new ImportOutputPathError({
          path: filePath,
          message: `Refusing to overwrite existing file: ${filePath}. Re-run with --overwrite.`,
        });
      }
    }

    return { directory: path.dirname(filePath), filePath };
  });

const validationError = (path: string, message: string, cause: unknown): ImportValidationError =>
  cause instanceof ImportValidationError
    ? cause
    : new ImportValidationError({
        path,
        message: `${message} Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
      });

const resourceSummary = (model: ImportModel): string =>
  [
    `${model.meters.length} meter(s)`,
    `${model.benefits.length} benefit(s)`,
    `${model.products.length} product(s)`,
  ].join(", ");

const printWarnings = (model: ImportModel): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (const skipped of model.skipped) {
      yield* Console.warn(
        `Skipped unsupported ${skipped.kind} '${skipped.label}' (${skipped.polarId}): ${skipped.reason}`,
      );
    }
  });

const printAdoptionPlan = (model: ImportModel): Effect.Effect<void> =>
  Effect.gen(function* () {
    const resources = model.resources.filter((resource) => resource.adoption === "NeedsAdoption");
    if (resources.length === 0) {
      yield* Console.log("Adoption plan: no metadata updates needed.");
      return;
    }

    yield* Console.log(
      `Adoption plan: ${resources.length} resource(s) would receive PAC Metadata:`,
    );
    for (const resource of resources) {
      yield* Console.log(`- ${resource.desired.address}`);
    }
  });

export class ImportCommand extends Context.Service<
  ImportCommand,
  {
    readonly run: (input: ImportCommandInput) => Effect.Effect<void, ImportCommandError>;
  }
>()("@app/ImportCommand") {
  static readonly layer = Layer.effect(
    ImportCommand,
    Effect.gen(function* () {
      const remoteResourceFetcher = yield* RemoteResourceFetcher;
      const codeGenerator = yield* CodeGenerator;
      const resourceAdopter = yield* ResourceAdopter;
      const configLoader = yield* ConfigLoader;
      const planner = yield* Planner;
      const fs = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;

      const validateGeneratedConfig = (
        filePath: string,
        model: ImportModel,
      ): Effect.Effect<void, ImportValidationError> =>
        Effect.gen(function* () {
          const desiredResources = yield* configLoader.loadDesiredResources(filePath);
          const expectedByAddress = new Map(
            model.resources.map((resource) => [resource.desired.address, resource.desired]),
          );

          if (desiredResources.length !== expectedByAddress.size) {
            return yield* new ImportValidationError({
              path: filePath,
              message: `Generated config declared ${desiredResources.length} resource(s), expected ${expectedByAddress.size}.`,
            });
          }

          for (const desired of desiredResources) {
            const expected = expectedByAddress.get(desired.address);
            if (expected === undefined) {
              return yield* new ImportValidationError({
                path: filePath,
                message: `Generated config declared unexpected Resource Address '${desired.address}'.`,
              });
            }

            if (!Equal.equals(desired, expected)) {
              return yield* new ImportValidationError({
                path: filePath,
                message:
                  `Generated config changed Resource Address '${desired.address}' when loaded. ` +
                  "This usually means the import renderer emitted config that normalizes to a different Desired Resource than the import model. " +
                  `Expected: ${JSON.stringify(expected)}. Actual: ${JSON.stringify(desired)}.`,
              });
            }
          }
        }).pipe(
          Effect.mapError((cause) =>
            validationError(filePath, "Generated config failed pre-write validation.", cause),
          ),
        );

      const stageAndValidateGeneratedConfig = (
        destination: { readonly directory: string; readonly filePath: string },
        contents: string,
        model: ImportModel,
      ): Effect.Effect<void, ImportValidationError | PlatformError> =>
        Effect.gen(function* () {
          yield* fs.makeDirectory(destination.directory, { recursive: true });
          const stagedPath = pathService.join(
            destination.directory,
            `.pac-import-${Date.now()}-${Math.random().toString(36).slice(2)}.config.ts`,
          );
          yield* fs.writeFileString(stagedPath, contents);
          yield* validateGeneratedConfig(stagedPath, model).pipe(
            Effect.ensuring(Effect.ignore(fs.remove(stagedPath))),
          );
        });

      const assertPostAdoptionUpToDate = (
        filePath: string,
      ): Effect.Effect<void, ImportValidationError> =>
        Effect.gen(function* () {
          const desiredResources = yield* configLoader.loadDesiredResources(filePath);
          const currentResourcesByAddress = yield* remoteResourceFetcher.fetch();
          const plan = yield* planner.plan({
            desiredResources,
            currentResources: [...currentResourcesByAddress.values()],
          });
          yield* planner.assertPlanUpToDate(plan);
        }).pipe(
          Effect.mapError((cause) =>
            validationError(
              filePath,
              `Generated config is valid, but post-adoption validation failed. Import may have partially completed. Run \`pac plan --config ${filePath}\` to inspect the remaining changes.`,
              cause,
            ),
          ),
        );

      return ImportCommand.of({
        run: (input) =>
          Effect.gen(function* () {
            const inventory = yield* remoteResourceFetcher.fetchInventory();
            const model = yield* buildImportModel({
              inventory,
              skipUnsupported: input.skipUnsupported,
              force: input.force,
            });
            const contents = yield* codeGenerator.generateConfig(model);

            yield* printWarnings(model);
            yield* Console.log(`Import model: ${resourceSummary(model)}.`);

            if (input.dryRun) {
              yield* Console.log(contents);
              yield* printAdoptionPlan(model);
              return;
            }

            const destination = yield* resolveImportOutputPath(
              input.path,
              fs,
              pathService,
              input.overwrite,
            );
            yield* stageAndValidateGeneratedConfig(destination, contents, model);
            yield* fs.writeFileString(destination.filePath, contents);
            yield* Console.log(`Wrote config file: ${destination.filePath}`);

            const adoptionSummary = yield* resourceAdopter.adopt(model, { force: input.force });
            yield* Console.log(
              `Adoption complete: ${adoptionSummary.adopted} adopted, ${adoptionSummary.unchanged} already managed.`,
            );

            yield* assertPostAdoptionUpToDate(destination.filePath).pipe(
              Effect.tapError((error) => Console.error(error.message)),
            );
            yield* Console.log("Validation complete: generated config is up to date.");
          }),
      });
    }),
  );
}

export const importCommand = Command.make(
  "import",
  {
    path: importPathFlag,
    overwrite: overwriteFlag,
    dryRun: dryRunFlag,
    skipUnsupported: skipUnsupportedFlag,
    force: forceFlag,
  },
  ({ path, overwrite, dryRun, skipUnsupported, force }) =>
    Effect.gen(function* () {
      const command = yield* ImportCommand;
      yield* command.run({ path, overwrite, dryRun, skipUnsupported, force });
    }),
).pipe(Command.withDescription("Import existing Polar resources into PAC"));
