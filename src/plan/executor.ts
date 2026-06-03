import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { hasErrors } from "../core/diagnostic.js";
import type { Plan } from "../core/plan.js";
import { PolarOperationExecutor } from "../provider/polar/operation-executor.js";

export type PlanExecutorShape = {
  readonly execute: (plan: Plan) => Effect.Effect<void, Error>;
};

export class PlanExecutor extends Context.Service<PlanExecutor, PlanExecutorShape>()("@paac/PlanExecutor") {
  static readonly layer = Layer.effect(
    PlanExecutor,
    Effect.gen(function*() {
      const operationExecutor = yield* PolarOperationExecutor;

      const execute = Effect.fn("PlanExecutor.execute")(function* (plan: Plan) {
        if (hasErrors(plan.diagnostics)) {
          return yield* Effect.fail(new Error("Refusing to deploy a plan with error diagnostics."));
        }

        yield* Effect.forEach(
          plan.operations,
          (operation) => {
            if (!operationExecutor.canExecute(operation)) {
              return Effect.fail(new Error(`No executor can run operation ${operation.id}.`));
            }
            return operationExecutor.execute(operation);
          },
          { discard: true, concurrency: 1 },
        );
      });

      return PlanExecutor.of({ execute });
    }),
  );
}
