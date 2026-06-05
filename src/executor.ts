import { Effect, Layer } from "effect";
import * as Context from "effect/Context";
import type { ResourceAddress } from "./core/address.js";
import type { Operation } from "./operations/operation.js";

export type ResourceBinding = {
  readonly polarId: string;
};

export type ResourceBindings = ReadonlyMap<ResourceAddress, ResourceBinding>;

export class Executor extends Context.Service<
  Executor,
  {
    readonly execute: (operations: ReadonlyArray<Operation>) => Effect.Effect<void>;
  }
>()("@app/Executor") {
  static readonly layer = Layer.succeed(
    Executor,
    Executor.of({
      execute: (_operations) => Effect.void,
    }),
  );
}
