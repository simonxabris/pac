import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import type { ResourceAdapter } from "./adapter.js";

export type AdapterRegistryShape = {
  readonly get: (kind: string) => ResourceAdapter | undefined;
  readonly all: () => ReadonlyArray<ResourceAdapter>;
};

export class AdapterRegistry extends Context.Service<AdapterRegistry, AdapterRegistryShape>()(
  "@paac/AdapterRegistry",
) {
  static make = (adapters: ReadonlyArray<ResourceAdapter>): AdapterRegistryShape => ({
    get: (kind) => adapters.find((adapter) => adapter.kind === kind),
    all: () => adapters,
  });

  static layer = (adapters: ReadonlyArray<ResourceAdapter>) =>
    Layer.sync(AdapterRegistry, () => AdapterRegistry.of(AdapterRegistry.make(adapters)));
}
