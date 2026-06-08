import * as Effect from "effect/Effect";
import * as Command from "effect/unstable/cli/Command";
import { ConfigLoader } from "../services/config-loader.js";
import { Planner } from "../services/planner.js";
import { RemoteResourceFetcher } from "../services/remote-resource-fetcher.js";
import { Renderer } from "../services/renderer.js";
import { configFlag } from "./options.js";

export const planCommand = Command.make("plan", { config: configFlag }, ({ config }) =>
  Effect.gen(function* () {
    const configLoader = yield* ConfigLoader;
    const desiredResources = yield* configLoader.loadDesiredResources(config);
    const remoteResourceFetcher = yield* RemoteResourceFetcher;
    const planner = yield* Planner;
    const renderer = yield* Renderer;

    const currentResourcesByAddress = yield* remoteResourceFetcher.fetch();
    const plan = yield* planner.plan({
      desiredResources,
      currentResources: [...currentResourcesByAddress.values()],
    });

    yield* renderer.render(plan);
  }),
).pipe(Command.withDescription("Preview Polar resource changes"));
