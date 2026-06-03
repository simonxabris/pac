import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";
import type { ResourceAdapter } from "../../src/core/adapter.js";
import { AdapterRegistry } from "../../src/core/adapter-registry.js";
import { errorDiagnostic } from "../../src/core/diagnostic.js";
import { decodeJsonObject } from "../../src/core/json.js";
import { Planner } from "../../src/core/planner.js";

const malformedMetadataAdapter: ResourceAdapter = {
  kind: "product",
  listRemote: () => Effect.succeed([{}]),
  getRemoteIdentity: () => ({
    _tag: "malformed",
    diagnostic: errorDiagnostic({
      code: "PAAC_MALFORMED_METADATA",
      message: "bad paac metadata",
    }),
  }),
  normalizeDesired: () => Effect.die("unused"),
  normalizeRemote: () => Effect.die("unused"),
  fieldSemantics: [],
  planCreate: () => Effect.succeed([]),
  planUpdate: () => Effect.succeed([]),
  planDelete: () => Effect.succeed([]),
};

const archivedProductAdapter: ResourceAdapter = {
  kind: "product",
  listRemote: () => Effect.succeed([{}]),
  getRemoteIdentity: () => ({
    _tag: "managed",
    identity: { version: 1, kind: "product", address: "product.pro", key: "pro" },
  }),
  normalizeDesired: () => Effect.die("unused"),
  normalizeRemote: () =>
    Effect.succeed({
      kind: "product",
      address: "product.pro",
      provider: "polar",
      providerId: "polar-product-id",
      managed: decodeJsonObject({ isArchived: true }),
      metadata: { version: 1, kind: "product", address: "product.pro", key: "pro" },
    }),
  fieldSemantics: [],
  planCreate: () => Effect.succeed([]),
  planUpdate: () => Effect.succeed([]),
  planDelete: () => Effect.succeed([]),
};

describe("Planner", () => {
  it("emits error diagnostics for malformed paac metadata", () => {
    const layer = Planner.layer.pipe(
      Layer.provide(AdapterRegistry.layer([malformedMetadataAdapter])),
    );

    const plan = Effect.runSync(
      Effect.gen(function*() {
        const planner = yield* Planner;
        return yield* planner.buildPlan({ desired: [] });
      }).pipe(Effect.provide(layer)),
    );

    expect(plan.diagnostics).toMatchObject([
      { severity: "error", code: "PAAC_MALFORMED_METADATA" },
    ]);
  });

  it("does not repeatedly archive missing resources that are already archived", () => {
    const layer = Planner.layer.pipe(
      Layer.provide(AdapterRegistry.layer([archivedProductAdapter])),
    );

    const plan = Effect.runSync(
      Effect.gen(function*() {
        const planner = yield* Planner;
        return yield* planner.buildPlan({ desired: [] });
      }).pipe(Effect.provide(layer)),
    );

    expect(plan.changes).toMatchObject([{ address: "product.pro", action: "noop" }]);
    expect(plan.summary.archive).toBe(0);
    expect(plan.summary.noop).toBe(1);
    expect(plan.operations).toEqual([]);
  });
});
