import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as Effect from "effect/Effect";
import { tsImport } from "tsx/esm/api";
import { getResources, resetRegistry } from "../resources/registry.js";

export const loadDesiredResources = Effect.fn("Config.loadDesiredResources")(function* (
  configPath: string,
) {
  resetRegistry();
  const absolutePath = resolve(configPath);
  yield* Effect.promise(() =>
    tsImport(pathToFileURL(absolutePath).href + `?t=${Date.now()}`, import.meta.url),
  );

  return getResources().map((resource) => resource.toDesiredResource());
});
