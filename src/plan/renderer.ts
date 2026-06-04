import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export class PlanRenderer extends Context.Service<PlanRenderer, {}>("@paac/PlanRenderer") {
  static readonly layer = Layer.succeed(PlanRenderer, PlanRenderer.of({}));
}
