import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { DesiredProduct } from "../resources/product.js";
import type { RemoteProduct } from "../polar/client.js";
import { buildPlan, type PlanAction } from "./diff.js";

export type PlanBuilderShape = {
  readonly build: (
    desiredProducts: ReadonlyArray<DesiredProduct>,
    remoteProducts: ReadonlyArray<RemoteProduct>,
    project: string,
  ) => Effect.Effect<ReadonlyArray<PlanAction>>;
};

export class PlanBuilder extends Context.Service<PlanBuilder, PlanBuilderShape>()("@paac/PlanBuilder") {
  static readonly layer = Layer.sync(PlanBuilder, () =>
    PlanBuilder.of({
      build: Effect.fn("PlanBuilder.build")((desiredProducts, remoteProducts, project) =>
        Effect.succeed(buildPlan(desiredProducts, remoteProducts, project)),
      ),
    }),
  );
}
