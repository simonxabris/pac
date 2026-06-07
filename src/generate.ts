import { Effect, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { CurrentResource, DesiredResource } from "./core/resource.js";

export const defaultRuntimeFileName = "pac.runtime.ts";

export type GenerateOutputDestination = {
  readonly directory: string;
  readonly filePath: string;
};

export class GenerateOutputPathError extends Schema.TaggedErrorClass<GenerateOutputPathError>()(
  "GenerateOutputPathError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) { }

export class GenerateResourceSelectionError extends Schema.TaggedErrorClass<GenerateResourceSelectionError>()(
  "GenerateResourceSelectionError",
  {
    address: Schema.String,
    message: Schema.String,
  },
) { }

export class CodeGenerationNotImplemented extends Schema.TaggedErrorClass<CodeGenerationNotImplemented>()(
  "CodeGenerationNotImplemented",
  {
    filePath: Schema.String,
    resourceCount: Schema.Number,
    message: Schema.String,
  },
) { }

export const resolveGenerateOutputPath = (
  inputPath: string,
): Effect.Effect<GenerateOutputDestination, GenerateOutputPathError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

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

      return yield* Effect.fail(
        new GenerateOutputPathError({
          path: absoluteInputPath,
          message: `Generate path must be a file or directory, got ${info.type}: ${absoluteInputPath}`,
        }),
      );
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

export const selectCurrentResourcesForGeneration = ({
  desiredResources,
  currentResourcesByAddress,
}: {
  readonly desiredResources: ReadonlyArray<DesiredResource>;
  readonly currentResourcesByAddress: ReadonlyMap<string, CurrentResource>;
}): Effect.Effect<ReadonlyArray<CurrentResource>, GenerateResourceSelectionError> =>
  Effect.gen(function*() {
    const selected: Array<CurrentResource> = [];

    for (const desiredResource of desiredResources) {
      const currentResource = currentResourcesByAddress.get(desiredResource.address);

      if (currentResource === undefined) {
        return yield* Effect.fail(
          new GenerateResourceSelectionError({
            address: desiredResource.address,
            message: `Resource ${desiredResource.address} does not exist in Polar yet. Run paac deploy first.`,
          }),
        );
      }

      if (currentResource.isRemoved) {
        return yield* Effect.fail(
          new GenerateResourceSelectionError({
            address: desiredResource.address,
            message: `Resource ${desiredResource.address} is removed in Polar. Run paac deploy first.`,
          }),
        );
      }

      selected.push(currentResource);
    }

    return selected;
  });
