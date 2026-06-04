import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export class PlanExecutor extends Context.Service<PlanExecutor, {}>("@paac/PlanExecutor") {
  static readonly layer = Layer.succeed(PlanExecutor, PlanExecutor.of({}));
}
