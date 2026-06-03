import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { JsonObject } from "../../core/json.js";
import type { Operation } from "../../core/plan.js";
import { PolarClient } from "../../polar/service.js";
import type { ProductCreatePayload, ProductUpdatePayload } from "../../resources/product.js";

export type OperationResult = {
  readonly operationId: string;
};

export type OperationExecutorShape = {
  readonly canExecute: (operation: Operation) => boolean;
  readonly execute: (operation: Operation) => Effect.Effect<OperationResult, Error>;
};

const ProductsUpdateInput = Schema.Struct({
  id: Schema.String,
  productUpdate: JsonObject,
});

const decodeProductsUpdateInput = Schema.decodeUnknownSync(ProductsUpdateInput);

export class PolarOperationExecutor extends Context.Service<
  PolarOperationExecutor,
  OperationExecutorShape
>()("@paac/PolarOperationExecutor") {
  static readonly layer = Layer.effect(
    PolarOperationExecutor,
    Effect.gen(function*() {
      const polar = yield* PolarClient;

      const execute = Effect.fn("PolarOperationExecutor.execute")(function* (operation: Operation) {
        switch (operation.call) {
          case "products.create":
            yield* polar.createProduct(operation.input as ProductCreatePayload);
            return { operationId: operation.id };
          case "products.update": {
            const input = decodeProductsUpdateInput(operation.input);
            yield* polar.updateProduct(input.id, input.productUpdate as ProductUpdatePayload);
            return { operationId: operation.id };
          }
          default:
            return yield* Effect.fail(new Error(`No Polar executor for operation call ${operation.call}`));
        }
      });

      return PolarOperationExecutor.of({
        canExecute: (operation) => operation.provider === "polar",
        execute,
      });
    }),
  );
}
