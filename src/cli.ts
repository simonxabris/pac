#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Layer, Schema } from "effect";
import * as Command from "effect/unstable/cli/Command";
import * as Effect from "effect/Effect";
import { AppConfig } from "./config/service.js";
import type { DesiredResource } from "./core/resource.js";
import { Executor } from "./executor.js";
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
  Executor.layer.pipe(
    Layer.provide(PolarClient.layer.pipe(Layer.provide(AppConfig.layer))),
  ),
  Renderer.layer,
);

const plan = Command.make("plan", {}, () =>
  Effect.gen(function*() {
    const desiredResources = yield* loadDesiredResources();
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

const deploy = Command.make("deploy", {}, () =>
  Effect.gen(function*() {
    const desiredResources = yield* loadDesiredResources();
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

    const program = yield* operationPlanner.create(plan);
    yield* executor.execute(program);
  }),
).pipe(Command.withDescription("Apply Polar resource changes"));

const cli = Command.make("paac").pipe(
  Command.withDescription("Polar as code"),
  Command.withSubcommands([plan, deploy]),
);

Command.run(cli, { version: "1.0.0" }).pipe(
  Effect.provide(Layer.mergeAll(CliLive, NodeServices.layer)),
  NodeRuntime.runMain,
);
