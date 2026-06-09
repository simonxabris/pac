#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Layer } from "effect";
import * as Effect from "effect/Effect";
import * as Command from "effect/unstable/cli/Command";
import { deployCommand } from "./commands/deploy.js";
import { generateCommand, GenerateCommand } from "./commands/generate.js";
import { importCommand, ImportCommand } from "./commands/import.js";
import { authCommand } from "./commands/auth.js";
import { polarRuntimeEnvFlag } from "./commands/options.js";
import { planCommand } from "./commands/plan.js";
import { ConfigLoader } from "./services/config-loader.js";
import { AppConfig } from "./services/app-config.js";
import { Executor } from "./services/executor.js";
import { CodeGenerator } from "./services/code-generator.js";
import { ResourceAdopter } from "./services/resource-adopter.js";
import { OperationPlanner } from "./services/operation-planner.js";
import { OAuth } from "./services/oauth.js";
import { Planner } from "./services/planner.js";
import { PolarClient } from "./services/polar-client.js";
import { RemoteResourceFetcher } from "./services/remote-resource-fetcher.js";
import { Renderer } from "./services/renderer.js";
import { ResourceAdapterRegistryLive } from "./services/resource-adapters.js";

const PolarClientLive = PolarClient.layer;

const ResourceCommandBaseLive = Layer.mergeAll(
  Planner.layer.pipe(Layer.provide(ResourceAdapterRegistryLive)),
  OperationPlanner.layer.pipe(Layer.provide(ResourceAdapterRegistryLive)),
  RemoteResourceFetcher.layer.pipe(Layer.provide(PolarClientLive)),
  Executor.layer.pipe(Layer.provide(PolarClientLive)),
  Renderer.layer,
  CodeGenerator.layer,
  ConfigLoader.layer,
);

const ResourceAdopterLive = ResourceAdopter.layer.pipe(Layer.provide(PolarClientLive));

const ResourceCommandLive = Layer.mergeAll(
  ResourceCommandBaseLive,
  ResourceAdopterLive,
  GenerateCommand.layer.pipe(
    Layer.provide(Layer.mergeAll(ResourceCommandBaseLive, NodeServices.layer)),
  ),
  ImportCommand.layer.pipe(
    Layer.provide(Layer.mergeAll(ResourceCommandBaseLive, ResourceAdopterLive, NodeServices.layer)),
  ),
);

const planCommandLive = planCommand.pipe(Command.provide(ResourceCommandLive));
const deployCommandLive = deployCommand.pipe(Command.provide(ResourceCommandLive));
const generateCommandLive = generateCommand.pipe(Command.provide(ResourceCommandLive));
const importCommandLive = importCommand.pipe(Command.provide(ResourceCommandLive));
const authCommandLive = authCommand;

const cli = Command.make("paac").pipe(
  Command.withSharedFlags({ env: polarRuntimeEnvFlag }),
  Command.withDescription("Polar as code"),
  Command.withSubcommands([
    planCommandLive,
    deployCommandLive,
    generateCommandLive,
    importCommandLive,
    authCommandLive,
  ]),
  Command.provide(({ env }) => Layer.mergeAll(AppConfig.layerWithCliEnv(env), OAuth.layer)),
);

Command.run(cli, { version: "1.0.0" }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
