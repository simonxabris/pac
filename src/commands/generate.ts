import { Console, Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Command from "effect/unstable/cli/Command";
import { ConfigLoader, type UserConfigLoadError } from "../services/config-loader.js";
import { CodeGenerator, type CodeGenerationError } from "../services/code-generator.js";
import {
  DuplicateCurrentResourceAddress,
  DuplicateDesiredResourceAddress,
  Planner,
  PlanNotUpToDate,
} from "../services/planner.js";
import {
  MissingResourceAdapter,
  ResourceAdapterPlanError,
} from "../services/resource-adapter-registry.js";
import {
  DuplicateRemoteResourceAddress,
  RemoteResourceFetcher,
  RemoteResourceFetchError,
} from "../services/remote-resource-fetcher.js";
import { configFlag, generatePathFlag } from "./options.js";

export const defaultRuntimeFileName = "pac.runtime.ts";

export type GenerateCommandInput = {
  readonly config: string;
  readonly path: string;
};

type GenerateOutputDestination = {
  readonly directory: string;
  readonly filePath: string;
};

type GenerateCommandError =
  | UserConfigLoadError
  | RemoteResourceFetchError
  | DuplicateRemoteResourceAddress
  | DuplicateDesiredResourceAddress
  | DuplicateCurrentResourceAddress
  | MissingResourceAdapter
  | ResourceAdapterPlanError
  | PlanNotUpToDate
  | CodeGenerationError
  | GenerateOutputPathError
  | PlatformError;

export class GenerateOutputPathError extends Schema.TaggedErrorClass<GenerateOutputPathError>()(
  "GenerateOutputPathError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

const resolveGenerateOutputPath = (
  inputPath: string,
  fs: FileSystem.FileSystem,
  path: Path.Path,
): Effect.Effect<GenerateOutputDestination, GenerateOutputPathError> =>
  Effect.gen(function* () {
    const absoluteInputPath = path.resolve(inputPath);
    const exists = yield* fs.exists(absoluteInputPath);

    if (exists) {
      const info = yield* fs.stat(absoluteInputPath);

      if (info.type === "Directory") {
        return {
          directory: absoluteInputPath,
          filePath: path.join(absoluteInputPath, defaultRuntimeFileName),
        };
      }

      if (info.type === "File") {
        return {
          directory: path.dirname(absoluteInputPath),
          filePath: absoluteInputPath,
        };
      }

      return yield* new GenerateOutputPathError({
        path: absoluteInputPath,
        message: `Generate path must be a file or directory, got ${info.type}: ${absoluteInputPath}`,
      });
    }

    if (path.extname(absoluteInputPath) !== "") {
      return {
        directory: path.dirname(absoluteInputPath),
        filePath: absoluteInputPath,
      };
    }

    return {
      directory: absoluteInputPath,
      filePath: path.join(absoluteInputPath, defaultRuntimeFileName),
    };
  }).pipe(
    Effect.mapError((error) => {
      if (error instanceof GenerateOutputPathError) return error;
      return new GenerateOutputPathError({
        path: inputPath,
        message: `Failed to resolve generate output path: ${error.message}`,
      });
    }),
  );

export class GenerateCommand extends Context.Service<
  GenerateCommand,
  {
    readonly generate: (input: GenerateCommandInput) => Effect.Effect<void, GenerateCommandError>;
  }
>()("@app/GenerateCommand") {
  static readonly layer = Layer.effect(
    GenerateCommand,
    Effect.gen(function* () {
      const configLoader = yield* ConfigLoader;
      const remoteResourceFetcher = yield* RemoteResourceFetcher;
      const planner = yield* Planner;
      const codeGenerator = yield* CodeGenerator;
      const fs = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;

      return GenerateCommand.of({
        generate: ({ config, path }) =>
          Effect.gen(function* () {
            const loadedConfig = yield* configLoader.loadConfig(config);

            const currentResourcesByAddress = yield* remoteResourceFetcher.fetch();
            const plan = yield* planner.plan({
              desiredResources: loadedConfig.desiredResources,
              currentResources: [...currentResourcesByAddress.values()],
            });

            yield* planner.assertPlanUpToDate(plan).pipe(
              Effect.tapError((error) =>
                Effect.gen(function* () {
                  yield* Console.log(
                    "Cannot generate runtime file because the PAC config is not fully in sync with Polar.",
                  );
                  yield* Console.log(error.message);
                  yield* Console.log(
                    "Run `pac plan` to inspect changes or `pac deploy` to apply them.",
                  );
                }),
              ),
            );

            const contents = yield* codeGenerator.generateRuntime(
              plan,
              loadedConfig.eventDefinitions,
            );
            const destination = yield* resolveGenerateOutputPath(path, fs, pathService);

            yield* fs.makeDirectory(destination.directory, { recursive: true });
            yield* fs.writeFileString(destination.filePath, contents);
            yield* Console.log(`Generated runtime file: ${destination.filePath}`);
          }),
      });
    }),
  );
}

export const generateCommand = Command.make(
  "generate",
  { config: configFlag, path: generatePathFlag },
  ({ config, path }) =>
    Effect.gen(function* () {
      const generateCommand = yield* GenerateCommand;
      yield* generateCommand.generate({ config, path });
    }),
).pipe(Command.withDescription("Generate a runtime data file from deployed Polar resources"));
