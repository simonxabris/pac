import * as Effect from "effect/Effect";
import { Console } from "effect";
import * as Command from "effect/unstable/cli/Command";
import { ConfigLoader } from "../services/config-loader.js";
import { Executor } from "../services/executor.js";
import { OperationPlanner } from "../services/operation-planner.js";
import { Planner } from "../services/planner.js";
import { RemoteResourceFetcher } from "../services/remote-resource-fetcher.js";
import { Renderer } from "../services/renderer.js";
import { allowDestructiveFlag, configFlag } from "./options.js";

export const deployCommand = Command.make(
  "deploy",
  { config: configFlag, allowDestructive: allowDestructiveFlag },
  ({ config, allowDestructive }) =>
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
      yield* executor
        .execute(program, {
          allowDestructive,
        })
        .pipe(
          Effect.catchTag("DestructiveOperationRejected", () =>
            Effect.gen(function* () {
              yield* Console.log("");
              yield* Console.log("Deploy cancelled: destructive operations were not approved.");
            }),
          ),
        );
    }),
).pipe(Command.withDescription("Apply Polar resource changes"));
