import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as Effect from "effect/Effect";
import { tsImport } from "tsx/esm/api";
import { getResources, resetRegistry } from "../resources/registry.js";
import type { Product } from "../resources/product.js";

export const loadDesiredProducts = Effect.fn("Config.loadDesiredProducts")(function* (
  configPath: string,
  project: string,
) {
  resetRegistry();
  const absolutePath = resolve(configPath);
  yield* Effect.promise(() =>
    tsImport(pathToFileURL(absolutePath).href + `?t=${Date.now()}`, import.meta.url),
  );

  return getResources()
    .filter((resource): resource is Product => resource.type === "product")
    .map((product) => product.toDesired(project));
});
