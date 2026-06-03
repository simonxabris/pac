import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Plan } from "../core/plan.js";
import { renderPlan } from "./render.js";

export type PlanRendererShape = {
  readonly render: (plan: Plan, mode?: "preview" | "deploy") => Effect.Effect<string>;
};

export class PlanRenderer extends Context.Service<PlanRenderer, PlanRendererShape>()("@paac/PlanRenderer") {
  static readonly layer = Layer.sync(PlanRenderer, () =>
    PlanRenderer.of({
      render: Effect.fn("PlanRenderer.render")((plan, mode) =>
        Effect.succeed(renderPlan(plan, mode)),
      ),
    }),
  );
}
