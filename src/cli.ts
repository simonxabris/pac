#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { basename } from "node:path";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import { loadDesiredProducts } from "./config/load.js";
import { AppConfig } from "./config/service.js";
import { PolarClient } from "./polar/service.js";
import { PlanBuilder } from "./plan/builder.js";
import { PlanExecutor } from "./plan/executor.js";
import { PlanRenderer } from "./plan/renderer.js";

const defaultProject = (): string => basename(process.cwd()) || "default";

const planOptions = {
  config: Flag.string("config").pipe(
    Flag.withAlias("c"),
    Flag.withDefault("paac.config.ts"),
    Flag.withDescription("Path to config file"),
  ),
  project: Flag.string("project").pipe(
    Flag.withAlias("p"),
    Flag.withDefault(defaultProject()),
    Flag.withDescription("Metadata project namespace"),
  ),
};

type PlanOptions = {
  readonly config: string;
  readonly project: string;
};

const plan = Command.make(
  "plan",
  planOptions,
  Effect.fn("Cli.runPlan")(function* (options: PlanOptions) {
    const polar = yield* PolarClient;
    const builder = yield* PlanBuilder;
    const renderer = yield* PlanRenderer;

    const desired = yield* loadDesiredProducts(options.config, options.project);
    const remote = yield* polar.listProducts();
    const actions = yield* builder.build(desired, remote, options.project);
    const output = yield* renderer.render(options.project, actions, "preview");
    yield* Console.log(output);
  }),
).pipe(Command.withDescription("Preview Polar product changes"));

const deploy = Command.make(
  "deploy",
  planOptions,
  Effect.fn("Cli.runDeploy")(function* (options: PlanOptions) {
    const polar = yield* PolarClient;
    const builder = yield* PlanBuilder;
    const renderer = yield* PlanRenderer;
    const executor = yield* PlanExecutor;

    const desired = yield* loadDesiredProducts(options.config, options.project);
    const remote = yield* polar.listProducts();
    const actions = yield* builder.build(desired, remote, options.project);
    const output = yield* renderer.render(options.project, actions, "deploy");
    yield* Console.log(output);
    yield* executor.execute(actions);
    yield* Console.log("Deploy complete.");
  }),
).pipe(Command.withDescription("Apply Polar product changes"));

const cli = Command.make("paac").pipe(
  Command.withDescription("Polar as code"),
  Command.withSubcommands([plan, deploy]),
);

const polarLayer = PolarClient.layer.pipe(Layer.provide(AppConfig.layer));

const planExecutorLayer = PlanExecutor.layer.pipe(Layer.provide(polarLayer));

const layer = Layer.mergeAll(
  NodeServices.layer,
  polarLayer,
  PlanBuilder.layer,
  PlanRenderer.layer,
  planExecutorLayer,
);

Command.run(cli, { version: "1.0.0" }).pipe(Effect.provide(layer), NodeRuntime.runMain);
