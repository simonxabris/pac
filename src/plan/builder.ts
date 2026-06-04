import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export class PlanBuilder extends Context.Service<PlanBuilder, {}>("@paac/PlanBuilder") {
  static readonly layer = Layer.succeed(PlanBuilder, PlanBuilder.of({}));
}
