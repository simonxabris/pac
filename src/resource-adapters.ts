import { eraseResourceAdapter, makeResourceAdapterRegistryLayer } from "./resource-adapter-registry.js";
import { MeterResourceAdapter } from "./resources/meter-adapter.js";
import { ProductResourceAdapter } from "./resources/product-adapter.js";

export const ResourceAdapterRegistryLive = makeResourceAdapterRegistryLayer([
  eraseResourceAdapter(ProductResourceAdapter),
  eraseResourceAdapter(MeterResourceAdapter),
]);
