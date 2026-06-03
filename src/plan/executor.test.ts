import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";
import type { Plan } from "../core/plan.js";
import { PolarOperationExecutor } from "../provider/polar/operation-executor.js";
import { PlanExecutor } from "./executor.js";

const basePlan: Plan = {
  provider: "polar",
  changes: [],
  operations: [],
  diagnostics: [],
  summary: { create: 0, update: 0, replace: 0, archive: 0, unarchive: 0, delete: 0, blocked: 0, noop: 0 },
};

describe("plan executor", () => {
  it("refuses plans with error diagnostics", () => {
    const fakeOperations = Layer.succeed(
      PolarOperationExecutor,
      PolarOperationExecutor.of({
        canExecute: () => true,
        execute: () => Effect.succeed({ operationId: "unused" }),
      }),
    );
    const layer = PlanExecutor.layer.pipe(Layer.provide(fakeOperations));

    const program = Effect.gen(function*() {
      const executor = yield* PlanExecutor;
      return yield* executor.execute({
        ...basePlan,
        diagnostics: [{ severity: "error", code: "NOPE", message: "broken" }],
      });
    }).pipe(
      Effect.provide(layer),
      Effect.match({
        onFailure: (error) => error.message,
        onSuccess: () => "success",
      }),
    );

    expect(Effect.runSync(program)).toContain("Refusing to deploy");
  });
});
