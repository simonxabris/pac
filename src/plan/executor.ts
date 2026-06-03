import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PolarClient } from "../polar/service.js";
import type { PlanAction } from "./diff.js";

export type PlanExecutorShape = {
  readonly execute: (actions: ReadonlyArray<PlanAction>) => Effect.Effect<void>;
};

export class PlanExecutor extends Context.Service<PlanExecutor, PlanExecutorShape>()("@paac/PlanExecutor") {
  static readonly layer = Layer.effect(
    PlanExecutor,
    Effect.gen(function*() {
      const polar = yield* PolarClient;

      const executeAction = Effect.fn("PlanExecutor.executeAction")(function* (action: PlanAction) {
        switch (action.type) {
          case "create":
            return yield* polar.createProduct(action.payload);
          case "update":
            return yield* polar.updateProduct(action.remoteId, action.payload);
          case "archive":
            return yield* polar.archiveProduct(action.remoteId);
          case "no-op":
            return undefined;
        }
      });

      const execute = Effect.fn("PlanExecutor.execute")(function* (actions: ReadonlyArray<PlanAction>) {
        yield* Effect.forEach(actions, executeAction, { discard: true, concurrency: 1 });
      });

      return PlanExecutor.of({ execute });
    }),
  );
}
