import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { renderPlan } from "./render.js";
import type { PlanAction } from "./diff.js";

export type PlanRendererShape = {
  readonly render: (
    project: string,
    actions: ReadonlyArray<PlanAction>,
    mode?: "preview" | "deploy",
  ) => Effect.Effect<string>;
};

export class PlanRenderer extends Context.Service<PlanRenderer, PlanRendererShape>()("@paac/PlanRenderer") {
  static readonly layer = Layer.sync(PlanRenderer, () =>
    PlanRenderer.of({
      render: Effect.fn("PlanRenderer.render")((project, actions, mode) =>
        Effect.succeed(renderPlan(project, actions, mode)),
      ),
    }),
  );
}
