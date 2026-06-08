#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Layer } from "effect";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import * as Effect from "effect/Effect";
import { ConfigLoader } from "./config-loader.js";
import { AppConfig } from "./config/service.js";
import { assertDeleteModeRemovalsAllowed } from "./deletion-safety.js";
import { Executor } from "./executor.js";
import { CodeGenerator } from "./generate.js";
import { GenerateCommand } from "./generate-command.js";
import { ImportCommand } from "./import-command.js";
import { ResourceAdopter } from "./import/adopt.js";
import { OperationPlanner } from "./operation-planner.js";
import { Planner } from "./planner.js";
import { PolarClient } from "./polar/service.js";
import { RemoteResourceFetcher } from "./remote-resource-fetcher.js";
import { Renderer } from "./renderer.js";
import { ResourceAdapterRegistryLive } from "./resource-adapters.js";
const PolarClientLive = PolarClient.layer.pipe(Layer.provide(AppConfig.layer));

const CliBaseLive = Layer.mergeAll(
  Planner.layer.pipe(Layer.provide(ResourceAdapterRegistryLive)),
  OperationPlanner.layer.pipe(Layer.provide(ResourceAdapterRegistryLive)),
  RemoteResourceFetcher.layer.pipe(Layer.provide(PolarClientLive)),
  Executor.layer.pipe(Layer.provide(PolarClientLive)),
  Renderer.layer,
  CodeGenerator.layer,
  ConfigLoader.layer,
);

const ResourceAdopterLive = ResourceAdopter.layer.pipe(Layer.provide(PolarClientLive));

const CliLive = Layer.mergeAll(
  CliBaseLive,
  ResourceAdopterLive,
  GenerateCommand.layer.pipe(Layer.provide(Layer.mergeAll(CliBaseLive, NodeServices.layer))),
  ImportCommand.layer.pipe(
    Layer.provide(Layer.mergeAll(CliBaseLive, ResourceAdopterLive, NodeServices.layer)),
  ),
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

const importPathFlag = Flag.string("path").pipe(
  Flag.withDefault("paac.config.ts"),
  Flag.withDescription("Output path for the generated PAAC config file"),
);

const overwriteFlag = Flag.boolean("overwrite").pipe(
  Flag.withDescription("Allow replacing an existing output file"),
);

const dryRunFlag = Flag.boolean("dry-run").pipe(
  Flag.withDescription(
    "Print the generated config and adoption plan without writing or mutating Polar",
  ),
);

const skipUnsupportedFlag = Flag.boolean("skip-unsupported").pipe(
  Flag.withDescription("Skip unsupported remote resources instead of failing the import"),
);

const forceFlag = Flag.boolean("force").pipe(
  Flag.withDescription("Overwrite conflicting existing PAAC Metadata"),
);

const plan = Command.make("plan", { config: configFlag }, ({ config }) =>
  Effect.gen(function* () {
    const configLoader = yield* ConfigLoader;
    const desiredResources = yield* configLoader.loadDesiredResources(config);
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
    Effect.gen(function* () {
      const configLoader = yield* ConfigLoader;
      const desiredResources = yield* configLoader.loadDesiredResources(config);
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
    Effect.gen(function* () {
      const generateCommand = yield* GenerateCommand;
      yield* generateCommand.generate({ config, path });
    }),
).pipe(Command.withDescription("Generate a runtime data file from deployed Polar resources"));

const importCommand = Command.make(
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
).pipe(Command.withDescription("Import existing Polar resources into PAAC"));

const cli = Command.make("paac").pipe(
  Command.withDescription("Polar as code"),
  Command.withSubcommands([plan, deploy, generate, importCommand]),
);

Command.run(cli, { version: "1.0.0" }).pipe(
  Effect.provide(Layer.mergeAll(CliLive, NodeServices.layer)),
  NodeRuntime.runMain,
);
