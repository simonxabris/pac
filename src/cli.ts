#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { basename } from "node:path";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { loadDesiredProducts } from "./config/load.js";
import { PolarClient } from "./polar/service.js";
import { PlanBuilder } from "./plan/builder.js";
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
    const output = yield* renderer.render(options.project, actions);
    yield* Console.log(output);
  }),
).pipe(Command.withDescription("Preview Polar product changes"));

const cli = Command.make("paac").pipe(
  Command.withDescription("Polar as code"),
  Command.withSubcommands([plan]),
);

const polarLayer = PolarClient.httpLayer(
  "https://api.polar.sh",
  process.env.POLAR_ACCESS_TOKEN ?? "",
).pipe(Layer.provide(FetchHttpClient.layer));

const layer = Layer.mergeAll(NodeServices.layer, polarLayer, PlanBuilder.layer, PlanRenderer.layer);

Command.run(cli, { version: "1.0.0" }).pipe(Effect.provide(layer), NodeRuntime.runMain);
