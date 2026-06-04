#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Command from "effect/unstable/cli/Command";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { AppConfig } from "./config/service.js";
import { Planner } from "./core/planner.js";
import { PlanBuilder } from "./plan/builder.js";
import { PlanExecutor } from "./plan/executor.js";
import { PlanRenderer } from "./plan/renderer.js";

const cli = Command.make("paac").pipe(
  Command.withDescription("Polar as code (stub – engine removed for rebuild)"),
);

const layer = Layer.mergeAll(
  NodeServices.layer,
  AppConfig.layer,
  Planner.layer,
  PlanBuilder.layer,
  PlanExecutor.layer,
  PlanRenderer.layer,
);

Command.run(cli, { version: "1.0.0" }).pipe(Effect.provide(layer), NodeRuntime.runMain);
