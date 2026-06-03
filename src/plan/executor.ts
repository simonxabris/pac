import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { PlanAction } from "./diff.js";

export type PlanExecutorShape = {
  readonly execute: (actions: ReadonlyArray<PlanAction>) => Effect.Effect<void>;
};

export class PlanExecutor extends Context.Service<PlanExecutor, PlanExecutorShape>()("@paac/PlanExecutor") {}
