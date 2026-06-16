import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";
import type { DesiredResource } from "../core/resource.js";
import type { EventDefinition } from "../events/event.js";
import { getEventDefinitions, getResources, resetRegistry } from "../resources/registry.js";
import { errorMessage } from "../utils.js";

export class UserConfigLoadError extends Schema.TaggedErrorClass<UserConfigLoadError>()(
  "UserConfigLoadError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export type LoadedConfig = {
  readonly desiredResources: ReadonlyArray<DesiredResource>;
  readonly eventDefinitions: ReadonlyArray<EventDefinition>;
};

const loadConfig = (
  configPath = "pac.config.ts",
): Effect.Effect<LoadedConfig, UserConfigLoadError> =>
  Effect.tryPromise({
    try: async () => {
      resetRegistry();
      const absolutePath = resolve(process.cwd(), configPath);
      await import(`${pathToFileURL(absolutePath).href}?t=${Date.now()}`);
      return {
        desiredResources: getResources().map((resource) => resource.toDesiredResource()),
        eventDefinitions: [...getEventDefinitions()],
      };
    },
    catch: (cause) =>
      new UserConfigLoadError({
        path: configPath,
        message: `Failed to load PAC config: ${errorMessage(cause)}`,
      }),
  });

export class ConfigLoader extends Context.Service<
  ConfigLoader,
  {
    readonly loadConfig: (configPath?: string) => Effect.Effect<LoadedConfig, UserConfigLoadError>;
  }
>()("@app/ConfigLoader") {
  static readonly layer = Layer.succeed(
    ConfigLoader,
    ConfigLoader.of({
      loadConfig,
    }),
  );
}
