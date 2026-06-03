#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Command from "effect/unstable/cli/Command";

const hello = Command.make("hello", {}, () => Console.log("hello")).pipe(
  Command.withDescription("Print hello"),
);

const cli = Command.make("paac").pipe(
  Command.withDescription("Polar as code"),
  Command.withSubcommands([hello]),
);

Command.run(cli, { version: "1.0.0" }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
