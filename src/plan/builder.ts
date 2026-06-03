import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { DesiredResource } from "../core/resource.js";
import { Planner } from "../core/planner.js";
import type { Plan } from "../core/plan.js";

export type PlanBuilderShape = {
  readonly build: (desiredResources: ReadonlyArray<DesiredResource>) => Effect.Effect<Plan, Error>;
};

export class PlanBuilder extends Context.Service<PlanBuilder, PlanBuilderShape>()("@paac/PlanBuilder") {
  static readonly layer = Layer.effect(
    PlanBuilder,
    Effect.gen(function*() {
      const planner = yield* Planner;
      return PlanBuilder.of({
        build: Effect.fn("PlanBuilder.build")((desiredResources) =>
          planner.buildPlan({ desired: desiredResources }),
        ),
      });
    }),
  );
}
