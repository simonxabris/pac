#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Console, Layer, Schema } from "effect";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import * as Effect from "effect/Effect";
import { AppConfig } from "./config/service.js";
import type { DesiredResource } from "./core/resource.js";
import { assertDeleteModeRemovalsAllowed } from "./deletion-safety.js";
import { Executor } from "./executor.js";
import {
  CodeGenerationNotImplemented,
  resolveGenerateOutputPath,
  selectCurrentResourcesForGeneration,
} from "./generate.js";
import { OperationPlanner } from "./operation-planner.js";
import { Planner } from "./planner.js";
import { PolarClient } from "./polar/service.js";
import { RemoteResourceFetcher } from "./remote-resource-fetcher.js";
import { Renderer } from "./renderer.js";
import { ResourceAdapterRegistryLive } from "./resource-adapters.js";
import { getResources, resetRegistry } from "./resources/registry.js";

export class UserConfigLoadError extends Schema.TaggedErrorClass<UserConfigLoadError>()(
  "UserConfigLoadError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) { }

const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return String(cause);
};

const loadDesiredResources = (
  configPath = "paac.config.ts",
): Effect.Effect<ReadonlyArray<DesiredResource>, UserConfigLoadError> =>
  Effect.tryPromise({
    try: async () => {
      resetRegistry();
      const absolutePath = resolve(process.cwd(), configPath);
      await import(`${pathToFileURL(absolutePath).href}?t=${Date.now()}`);
      return getResources().map((resource) => resource.toDesiredResource());
    },
    catch: (cause) =>
      new UserConfigLoadError({
        path: configPath,
        message: `Failed to load PAAC config: ${errorMessage(cause)}`,
      }),
  });

const CliLive = Layer.mergeAll(
  Planner.layer.pipe(Layer.provide(ResourceAdapterRegistryLive)),
  OperationPlanner.layer.pipe(Layer.provide(ResourceAdapterRegistryLive)),
  RemoteResourceFetcher.layer.pipe(
    Layer.provide(PolarClient.layer.pipe(Layer.provide(AppConfig.layer))),
  ),
  Executor.layer.pipe(Layer.provide(PolarClient.layer.pipe(Layer.provide(AppConfig.layer)))),
  Renderer.layer,
);

const configFlag = Flag.string("config").pipe(
  Flag.withDefault("paac.config.ts"),
  Flag.withDescription("Path to the PAAC config file to load"),
);

const allowDeleteFlag = Flag.boolean("allow-delete").pipe(
  Flag.withDescription("Allow destructive delete-mode removals during deploy"),
);

const generatePathFlag = Flag.string("path").pipe(
  Flag.withDefault("."),
  Flag.withDescription(
    "Output directory or file path. Directories use the default file name pac.runtime.ts.",
  ),
);

const plan = Command.make("plan", { config: configFlag }, ({ config }) =>
  Effect.gen(function*() {
    const desiredResources = yield* loadDesiredResources(config);
    const remoteResourceFetcher = yield* RemoteResourceFetcher;
    const planner = yield* Planner;
    const renderer = yield* Renderer;

    const currentResourcesByAddress = yield* remoteResourceFetcher.fetch();
    const plan = yield* planner.plan({
      desiredResources,
      currentResources: [...currentResourcesByAddress.values()],
    });

    yield* renderer.render(plan);
  }),
).pipe(Command.withDescription("Preview Polar resource changes"));

const deploy = Command.make(
  "deploy",
  { config: configFlag, allowDelete: allowDeleteFlag },
  ({ config, allowDelete }) =>
    Effect.gen(function*() {
      const desiredResources = yield* loadDesiredResources(config);
      const remoteResourceFetcher = yield* RemoteResourceFetcher;
      const planner = yield* Planner;
      const renderer = yield* Renderer;
      const operationPlanner = yield* OperationPlanner;
      const executor = yield* Executor;

      const currentResourcesByAddress = yield* remoteResourceFetcher.fetch();
      const plan = yield* planner.plan({
        desiredResources,
        currentResources: [...currentResourcesByAddress.values()],
      });

      yield* renderer.render(plan);
      yield* assertDeleteModeRemovalsAllowed(plan, allowDelete);

      const program = yield* operationPlanner.create(plan);
      yield* executor.execute(program);
    }),
).pipe(Command.withDescription("Apply Polar resource changes"));

const generate = Command.make(
  "generate",
  { config: configFlag, path: generatePathFlag },
  ({ config, path }) =>
    Effect.gen(function*() {
      const desiredResources = yield* loadDesiredResources(config);
      const remoteResourceFetcher = yield* RemoteResourceFetcher;
      const planner = yield* Planner;

      const currentResourcesByAddress = yield* remoteResourceFetcher.fetch();
      const plan = yield* planner.plan({
        desiredResources,
        currentResources: [...currentResourcesByAddress.values()],
      });

      yield* planner.assertPlanUpToDate(plan).pipe(
        Effect.tapError((error) =>
          Effect.gen(function*() {
            yield* Console.log(
              "Cannot generate runtime file because the PAAC config is not fully in sync with Polar.",
            );
            yield* Console.log(error.message);
            yield* Console.log(
              "Run `paac plan` to inspect changes or `paac deploy` to apply them.",
            );
          }),
        ),
      );

      const currentResources = yield* selectCurrentResourcesForGeneration({
        desiredResources,
        currentResourcesByAddress,
      });
      const destination = yield* resolveGenerateOutputPath(path);

      yield* Console.log(
        `Generation preflight complete. ${currentResources.length} resources are ready for CodeGenerator.generate(...).`,
      );
      yield* Console.log(`Output path resolved to: ${destination.filePath}`);

      return yield* new CodeGenerationNotImplemented({
        filePath: destination.filePath,
        resourceCount: currentResources.length,
        message: "CodeGenerator.generate(...) is not implemented yet.",
      });
    }),
).pipe(Command.withDescription("Generate a runtime data file from deployed Polar resources"));

const cli = Command.make("paac").pipe(
  Command.withDescription("Polar as code"),
  Command.withSubcommands([plan, deploy, generate]),
);

Command.run(cli, { version: "1.0.0" }).pipe(
  Effect.provide(Layer.mergeAll(CliLive, NodeServices.layer)),
  NodeRuntime.runMain,
);
