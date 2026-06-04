import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export class Planner extends Context.Service<Planner, {}>("@paac/Planner") {
  static readonly layer = Layer.succeed(Planner, Planner.of({}));
}
