import { Schema } from "effect";
import * as Effect from "effect/Effect";
import * as Command from "effect/unstable/cli/Command";
import { ConfigLoader } from "../services/config-loader.js";
import { Executor } from "../services/executor.js";
import { OperationPlanner } from "../services/operation-planner.js";
import { Planner, type Plan } from "../services/planner.js";
import { RemoteResourceFetcher } from "../services/remote-resource-fetcher.js";
import { Renderer } from "../services/renderer.js";
import { allowDeleteFlag, configFlag } from "./options.js";

export class DeleteModeRemovalNotAllowed extends Schema.TaggedErrorClass<DeleteModeRemovalNotAllowed>()(
  "DeleteModeRemovalNotAllowed",
  {
    addresses: Schema.Array(Schema.String),
    message: Schema.String,
  },
) {}

const assertDeleteModeRemovalsAllowed = (
  plan: Plan,
  allowDelete: boolean,
): Effect.Effect<void, DeleteModeRemovalNotAllowed> => {
  const deleteAddresses = [...plan.nodes.values()]
    .filter((node) => node._tag === "Remove" && node.mode === "delete")
    .map((node) => node.address);

  if (allowDelete || deleteAddresses.length === 0) {
    return Effect.void;
  }

  return Effect.fail(
    new DeleteModeRemovalNotAllowed({
      addresses: deleteAddresses,
      message: `Deploy contains delete-mode removals (${deleteAddresses.join(", ")}). Re-run with --allow-delete to confirm destructive deletion.`,
    }),
  );
};

export const deployCommand = Command.make(
  "deploy",
  { config: configFlag, allowDelete: allowDeleteFlag },
  ({ config, allowDelete }) =>
    Effect.gen(function* () {
      const configLoader = yield* ConfigLoader;
      const desiredResources = yield* configLoader.loadDesiredResources(config);
      const remoteResourceFetcher = yield* RemoteResourceFetcher;
      const planner = yield* Planner;
      const renderer = yield* Renderer;
      const operationPlanner = yield* OperationPlanner;
      const executor = yield* Executor;

      const currentResourcesByAddress = yield* remoteResourceFetcher.fetch();
      const plan = yield* planner.plan({
        desiredResources,
        currentResources: [...currentResourcesByAddress.values()],
      });

      yield* renderer.render(plan);
      yield* assertDeleteModeRemovalsAllowed(plan, allowDelete);

      const program = yield* operationPlanner.create(plan);
      yield* executor.execute(program);
    }),
).pipe(Command.withDescription("Apply Polar resource changes"));
