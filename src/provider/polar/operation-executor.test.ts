import type { Meter as RemoteMeter } from "@polar-sh/sdk/models/components/meter.js";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";
import { decodeJsonObject } from "../../core/json.js";
import { encodePaacMetadata } from "../../core/metadata.js";
import type { Operation } from "../../core/plan.js";
import { PolarClient, type PolarClientShape } from "../../polar/service.js";
import { PolarOperationExecutor } from "./operation-executor.js";

const remoteMeter = (): RemoteMeter =>
  ({
    id: "polar-meter-id",
    name: "Requests",
    unit: "custom",
    customLabel: "request",
    customMultiplier: 1,
    filter: {
      conjunction: "and",
      clauses: [{ property: "event", operator: "eq", value: "api.request" }],
    },
    aggregation: { func: "count" },
    metadata: encodePaacMetadata({
      version: 1,
      kind: "meter",
      address: "meter.requests",
      key: "requests",
    }),
    archivedAt: null,
  }) as RemoteMeter;

describe("Polar operation executor", () => {
  it("resolves Product metered price meterAddress values before calling Polar", () => {
    let createdProduct: unknown;
    const fakePolar: PolarClientShape = {
      listProducts: () => Effect.succeed([]),
      createProduct: (payload) =>
        Effect.sync(() => {
          createdProduct = payload;
        }),
      updateProduct: () => Effect.void,
      archiveProduct: () => Effect.void,
      listMeters: () => Effect.succeed([remoteMeter()]),
      createMeter: () => Effect.void,
      updateMeter: () => Effect.void,
      archiveMeter: () => Effect.void,
    };
    const layer = PolarOperationExecutor.layer.pipe(
      Layer.provide(Layer.succeed(PolarClient, PolarClient.of(fakePolar))),
    );

    const operation: Operation = {
      id: "product.create:product.pro",
      provider: "polar",
      kind: "product",
      address: "product.pro",
      action: "create",
      call: "products.create",
      input: decodeJsonObject({
        name: "Pro",
        description: null,
        visibility: "public",
        recurringInterval: "month",
        recurringIntervalCount: 1,
        metadata: {},
        prices: [
          {
            amountType: "metered_unit",
            meterAddress: "meter.requests",
            unitAmount: "0.1",
            priceCurrency: "usd",
            capAmount: null,
          },
        ],
      }),
      dependsOn: [],
      preview: { title: "create Polar product", lines: [] },
    };

    Effect.runSync(
      Effect.gen(function* () {
        const executor = yield* PolarOperationExecutor;
        return yield* executor.execute(operation);
      }).pipe(Effect.provide(layer)),
    );

    expect(createdProduct).toMatchObject({
      prices: [
        {
          amountType: "metered_unit",
          meterId: "polar-meter-id",
          unitAmount: "0.1",
          priceCurrency: "usd",
          capAmount: null,
        },
      ],
    });
    expect(JSON.stringify(createdProduct)).not.toContain("meterAddress");
  });
});
