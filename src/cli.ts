#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Command from "effect/unstable/cli/Command";
import * as Effect from "effect/Effect";

const plan = Command.make("plan").pipe(
  Command.withDescription("Preview Polar product changes (stub)"),
);

const deploy = Command.make("deploy").pipe(
  Command.withDescription("Apply Polar product changes (stub)"),
);

const cli = Command.make("paac").pipe(
  Command.withDescription("Polar as code"),
  Command.withSubcommands([plan, deploy]),
);

Command.run(cli, { version: "1.0.0" }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
