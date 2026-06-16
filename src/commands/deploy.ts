import * as Effect from "effect/Effect";
import * as Command from "effect/unstable/cli/Command";
import * as Prompt from "effect/unstable/cli/Prompt";
import { OperationDestructiveness, type Operation } from "../operations/operation.js";
import { ConfigLoader } from "../services/config-loader.js";
import { Executor } from "../services/executor.js";
import { OperationPlanner } from "../services/operation-planner.js";
import { Planner } from "../services/planner.js";
import { RemoteResourceFetcher } from "../services/remote-resource-fetcher.js";
import { Renderer } from "../services/renderer.js";
import { allowDeleteFlag, configFlag } from "./options.js";

const confirmDestructiveOperation = (operation: Operation) => {
  const { destructiveness } = operation;

  if (!OperationDestructiveness.guards.Destructive(destructiveness)) {
    return Effect.succeed(true);
  }

  return Prompt.run(
    Prompt.confirm({
      message: `Destructive operation ${operation.action._tag} on ${operation.address}: ${destructiveness.reason}\nContinue?`,
      initial: false,
    }),
  ).pipe(
    Effect.match({
      onFailure: () => false,
      onSuccess: (confirmed) => confirmed,
    }),
  );
};

export const deployCommand = Command.make(
  "deploy",
  { config: configFlag, allowDelete: allowDeleteFlag },
  ({ config, allowDelete }) =>
    Effect.gen(function* () {
      const configLoader = yield* ConfigLoader;
      const loadedConfig = yield* configLoader.loadConfig(config);
      const remoteResourceFetcher = yield* RemoteResourceFetcher;
      const planner = yield* Planner;
      const renderer = yield* Renderer;
      const operationPlanner = yield* OperationPlanner;
      const executor = yield* Executor;

      const currentResourcesByAddress = yield* remoteResourceFetcher.fetch();
      const plan = yield* planner.plan({
        desiredResources: loadedConfig.desiredResources,
        currentResources: [...currentResourcesByAddress.values()],
      });

      yield* renderer.render(plan);

      const program = yield* operationPlanner.create(plan);
      yield* executor.execute(program, {
        allowDestructive: allowDelete,
        confirmDestructive: confirmDestructiveOperation,
      });
    }),
).pipe(Command.withDescription("Apply Polar resource changes"));
