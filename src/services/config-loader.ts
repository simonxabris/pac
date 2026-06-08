import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";
import type { DesiredResource } from "../core/resource.js";
import { getResources, resetRegistry } from "../resources/registry.js";
import { errorMessage } from "../utils.js";

export class UserConfigLoadError extends Schema.TaggedErrorClass<UserConfigLoadError>()(
  "UserConfigLoadError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

const loadDesiredResources = (
  configPath = "paac.config.ts",
): Effect.Effect<ReadonlyArray<DesiredResource>, UserConfigLoadError> =>
  Effect.tryPromise({
    try: async () => {
      resetRegistry();
      const absolutePath = resolve(process.cwd(), configPath);
      await import(`${pathToFileURL(absolutePath).href}?t=${Date.now()}`);
      return getResources().map((resource) => resource.toDesiredResource());
    },
    catch: (cause) =>
      new UserConfigLoadError({
        path: configPath,
        message: `Failed to load PAAC config: ${errorMessage(cause)}`,
      }),
  });

export class ConfigLoader extends Context.Service<
  ConfigLoader,
  {
    readonly loadDesiredResources: (
      configPath?: string,
    ) => Effect.Effect<ReadonlyArray<DesiredResource>, UserConfigLoadError>;
  }
>()("@app/ConfigLoader") {
  static readonly layer = Layer.succeed(
    ConfigLoader,
    ConfigLoader.of({
      loadDesiredResources,
    }),
  );
}
