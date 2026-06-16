import { Effect, Layer } from "effect";
import * as Context from "effect/Context";
import type { ImportModel } from "../../import/project.js";
import type { EventDefinition } from "../../events/event.js";
import type { Plan } from "../planner.js";
import { CodeGenerationError } from "./code-generation-error.js";
import { generateConfig } from "./config.js";
import { generateRuntime } from "./runtime.js";

export { CodeGenerationError } from "./code-generation-error.js";

export class CodeGenerator extends Context.Service<
  CodeGenerator,
  {
    readonly generateRuntime: (
      plan: Plan,
      eventDefinitions?: ReadonlyArray<EventDefinition>,
    ) => Effect.Effect<string, CodeGenerationError>;

    readonly generateConfig: (model: ImportModel) => Effect.Effect<string, CodeGenerationError>;
  }
>()("@app/CodeGenerator") {
  static readonly layer = Layer.succeed(
    CodeGenerator,
    CodeGenerator.of({
      generateRuntime,
      generateConfig,
    }),
  );
}
