#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import { loadDesiredResources } from "./config/load.js";
import { AppConfig } from "./config/service.js";
import { hasErrors } from "./core/diagnostic.js";
import { Planner } from "./core/planner.js";
import { PolarClient } from "./polar/service.js";
import { PolarAdapterRegistryLive } from "./provider/polar/adapter-registry.js";
import { PolarOperationExecutor } from "./provider/polar/operation-executor.js";
import { PlanBuilder } from "./plan/builder.js";
import { PlanExecutor } from "./plan/executor.js";
import { PlanRenderer } from "./plan/renderer.js";

const planOptions = {
  config: Flag.string("config").pipe(
    Flag.withAlias("c"),
    Flag.withDefault("paac.config.ts"),
    Flag.withDescription("Path to config file"),
  ),
};

type PlanOptions = {
  readonly config: string;
};

const plan = Command.make(
  "plan",
  planOptions,
  Effect.fn("Cli.runPlan")(function* (options: PlanOptions) {
    const builder = yield* PlanBuilder;
    const renderer = yield* PlanRenderer;

    const desired = yield* loadDesiredResources(options.config);
    const builtPlan = yield* builder.build(desired);
    const output = yield* renderer.render(builtPlan, "preview");
    yield* Console.log(output);
    if (hasErrors(builtPlan.diagnostics)) {
      return yield* Effect.fail(new Error("Plan contains error diagnostics."));
    }
  }),
).pipe(Command.withDescription("Preview Polar product changes"));

const deploy = Command.make(
  "deploy",
  planOptions,
  Effect.fn("Cli.runDeploy")(function* (options: PlanOptions) {
    const builder = yield* PlanBuilder;
    const renderer = yield* PlanRenderer;
    const executor = yield* PlanExecutor;

    const desired = yield* loadDesiredResources(options.config);
    const builtPlan = yield* builder.build(desired);
    const output = yield* renderer.render(builtPlan, "deploy");
    yield* Console.log(output);
    yield* executor.execute(builtPlan);
    yield* Console.log("Deploy complete.");
  }),
).pipe(Command.withDescription("Apply Polar product changes"));

const cli = Command.make("paac").pipe(
  Command.withDescription("Polar as code"),
  Command.withSubcommands([plan, deploy]),
);

const polarLayer = PolarClient.layer.pipe(Layer.provide(AppConfig.layer));
const adapterRegistryLayer = PolarAdapterRegistryLive.pipe(Layer.provide(polarLayer));
const plannerLayer = Planner.layer.pipe(Layer.provide(adapterRegistryLayer));
const planBuilderLayer = PlanBuilder.layer.pipe(Layer.provide(plannerLayer));
const polarOperationExecutorLayer = PolarOperationExecutor.layer.pipe(Layer.provide(polarLayer));
const planExecutorLayer = PlanExecutor.layer.pipe(Layer.provide(polarOperationExecutorLayer));

const layer = Layer.mergeAll(
  NodeServices.layer,
  planBuilderLayer,
  PlanRenderer.layer,
  planExecutorLayer,
);

Command.run(cli, { version: "1.0.0" }).pipe(Effect.provide(layer), NodeRuntime.runMain);
