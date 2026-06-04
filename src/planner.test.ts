import { describe, expect, it, beforeEach } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Planner } from "./planner.js";
import { ResourceAdapterRegistryLive } from "./resource-adapters.js";
import { eraseResourceAdapter, makeResourceAdapterRegistryLayer } from "./resource-adapter-registry.js";
import { count, Meter, type CurrentMeterResource } from "./resources/meter.js";
import { MeterResourceAdapter } from "./resources/meter-adapter.js";
import {
  fixedPrice,
  meteredUnitPrice,
  Product,
  type CurrentProductResource,
} from "./resources/product.js";
import { ProductResourceAdapter } from "./resources/product-adapter.js";
import { resetRegistry } from "./resources/registry.js";

const testLayer = Planner.layer.pipe(Layer.provide(ResourceAdapterRegistryLive));
const cyclicTestLayer = Planner.layer.pipe(
  Layer.provide(
    makeResourceAdapterRegistryLayer([
      eraseResourceAdapter(ProductResourceAdapter),
      eraseResourceAdapter({
        ...MeterResourceAdapter,
        dependencies: () => Effect.succeed(["product.pro" as const]),
      }),
    ]),
  ),
);

describe("Planner.plan", () => {
  beforeEach(() => {
    resetRegistry();
  });

  it.effect("plans create nodes and dependency edges for a new metered product", () =>
    Effect.gen(function*() {
      const meter = new Meter("requests", {
        name: "Requests",
        filter: { conjunction: "and", clauses: [] },
        aggregation: count(),
      }).toDesiredResource();
      const product = new Product("pro", {
        name: "Pro",
        prices: [meteredUnitPrice({ meter: meter.address, amount: "0.01", currency: "usd" })],
      }).toDesiredResource();
      const planner = yield* Planner;

      const plan = yield* planner.plan({
        desiredResources: [meter, product],
        currentResources: [],
      });

      expect(plan._tag).toBe("PlanGraph");
      expect([...plan.nodes.entries()]).toEqual([
        [
          "meter.requests",
          {
            _tag: "Create",
            address: "meter.requests",
            kind: "meter",
            desired: meter,
          },
        ],
        [
          "product.pro",
          {
            _tag: "Create",
            address: "product.pro",
            kind: "product",
            desired: product,
          },
        ],
      ]);
      expect(plan.edges).toEqual([
        {
          _tag: "DependsOn",
          from: "product.pro",
          to: "meter.requests",
        },
      ]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("plans an update node when desired and current specs differ", () =>
    Effect.gen(function*() {
      const desired = new Product("pro", {
        name: "Pro",
        prices: [fixedPrice({ amount: "2000", currency: "usd" })],
      }).toDesiredResource();
      const current: CurrentProductResource = {
        source: "current",
        kind: "product",
        key: desired.key,
        address: desired.address,
        polarId: "polar-product-pro",
        spec: {
          ...desired.spec,
          name: "Old Pro",
        },
      };
      const planner = yield* Planner;

      const plan = yield* planner.plan({
        desiredResources: [desired],
        currentResources: [current],
      });

      expect([...plan.nodes.entries()]).toEqual([
        [
          "product.pro",
          {
            _tag: "Update",
            address: "product.pro",
            kind: "product",
            desired,
            current,
            changes: [
              {
                _tag: "FieldChange",
                path: ["name"],
                before: "Old Pro",
                after: "Pro",
              },
            ],
          },
        ],
      ]);
      expect(plan.edges).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("plans a noop node when desired and current specs match", () =>
    Effect.gen(function*() {
      const desired = new Meter("requests", {
        name: "Requests",
        filter: { conjunction: "and", clauses: [] },
        aggregation: count(),
      }).toDesiredResource();
      const current: CurrentMeterResource = {
        source: "current",
        kind: "meter",
        key: desired.key,
        address: desired.address,
        polarId: "polar-meter-requests",
        spec: desired.spec,
      };
      const planner = yield* Planner;

      const plan = yield* planner.plan({
        desiredResources: [desired],
        currentResources: [current],
      });

      expect([...plan.nodes.entries()]).toEqual([
        [
          "meter.requests",
          {
            _tag: "Noop",
            address: "meter.requests",
            kind: "meter",
            desired,
            current,
          },
        ],
      ]);
      expect(plan.edges).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("blocks a desired resource when its desired dependency is missing", () =>
    Effect.gen(function*() {
      const product = new Product("pro", {
        name: "Pro",
        prices: [meteredUnitPrice({ meter: "meter.requests", amount: "0.01", currency: "usd" })],
      }).toDesiredResource();
      const planner = yield* Planner;

      const plan = yield* planner.plan({
        desiredResources: [product],
        currentResources: [],
      });

      expect([...plan.nodes.entries()]).toEqual([
        [
          "product.pro",
          {
            _tag: "Blocked",
            address: "product.pro",
            kind: "product",
            desired: product,
          },
        ],
      ]);
      expect(plan.edges).toEqual([]);
      expect(plan.diagnostics).toEqual([
        {
          _tag: "Diagnostic",
          severity: "error",
          code: "dependency.missing",
          address: "product.pro",
          message: "Resource product.pro depends on missing desired resource meter.requests.",
        },
      ]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("blocks a desired resource when its dependency only exists in current resources", () =>
    Effect.gen(function*() {
      const meter = new Meter("requests", {
        name: "Requests",
        filter: { conjunction: "and", clauses: [] },
        aggregation: count(),
      }).toDesiredResource();
      const product = new Product("pro", {
        name: "Pro",
        prices: [meteredUnitPrice({ meter: meter.address, amount: "0.01", currency: "usd" })],
      }).toDesiredResource();
      const currentMeter: CurrentMeterResource = {
        source: "current",
        kind: "meter",
        key: meter.key,
        address: meter.address,
        polarId: "polar-meter-requests",
        spec: meter.spec,
      };
      const planner = yield* Planner;

      const plan = yield* planner.plan({
        desiredResources: [product],
        currentResources: [currentMeter],
      });

      expect([...plan.nodes.entries()]).toEqual([
        [
          "product.pro",
          {
            _tag: "Blocked",
            address: "product.pro",
            kind: "product",
            desired: product,
          },
        ],
        [
          "meter.requests",
          {
            _tag: "Archive",
            address: "meter.requests",
            kind: "meter",
            current: currentMeter,
          },
        ],
      ]);
      expect(plan.edges).toEqual([]);
      expect(plan.diagnostics).toEqual([
        {
          _tag: "Diagnostic",
          severity: "error",
          code: "dependency.missing",
          address: "product.pro",
          message: "Resource product.pro depends on missing desired resource meter.requests.",
        },
      ]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("blocks resources involved in dependency cycles", () =>
    Effect.gen(function*() {
      const meter = new Meter("requests", {
        name: "Requests",
        filter: { conjunction: "and", clauses: [] },
        aggregation: count(),
      }).toDesiredResource();
      const product = new Product("pro", {
        name: "Pro",
        prices: [meteredUnitPrice({ meter: meter.address, amount: "0.01", currency: "usd" })],
      }).toDesiredResource();
      const planner = yield* Planner;

      const plan = yield* planner.plan({
        desiredResources: [meter, product],
        currentResources: [],
      });

      expect([...plan.nodes.entries()]).toEqual([
        [
          "meter.requests",
          {
            _tag: "Blocked",
            address: "meter.requests",
            kind: "meter",
            desired: meter,
          },
        ],
        [
          "product.pro",
          {
            _tag: "Blocked",
            address: "product.pro",
            kind: "product",
            desired: product,
          },
        ],
      ]);
      expect(plan.edges).toEqual([
        {
          _tag: "DependsOn",
          from: "meter.requests",
          to: "product.pro",
        },
        {
          _tag: "DependsOn",
          from: "product.pro",
          to: "meter.requests",
        },
      ]);
      expect(plan.diagnostics).toEqual([
        {
          _tag: "Diagnostic",
          severity: "error",
          code: "dependency.cycle",
          message: "Dependency cycle detected: meter.requests -> product.pro -> meter.requests.",
          relatedAddresses: ["meter.requests", "product.pro", "meter.requests"],
        },
      ]);
    }).pipe(Effect.provide(cyclicTestLayer)),
  );

  it.effect("does not return dangling edges for current dependencies missing from the plan", () =>
    Effect.gen(function*() {
      const product = new Product("pro", {
        name: "Pro",
        prices: [meteredUnitPrice({ meter: "meter.requests", amount: "0.01", currency: "usd" })],
      }).toDesiredResource();
      const currentProduct: CurrentProductResource = {
        source: "current",
        kind: "product",
        key: product.key,
        address: product.address,
        polarId: "polar-product-pro",
        spec: product.spec,
      };
      const planner = yield* Planner;

      const plan = yield* planner.plan({
        desiredResources: [],
        currentResources: [currentProduct],
      });

      expect([...plan.nodes.entries()]).toEqual([
        [
          "product.pro",
          {
            _tag: "Archive",
            address: "product.pro",
            kind: "product",
            current: currentProduct,
          },
        ],
      ]);
      expect(plan.edges).toEqual([]);
      expect(plan.diagnostics).toEqual([
        {
          _tag: "Diagnostic",
          severity: "warning",
          code: "dependency.currentTargetMissing",
          address: "product.pro",
          message: "Current resource product.pro depends on missing current resource meter.requests.",
        },
      ]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("plans an archive node for a managed current resource absent from desired", () =>
    Effect.gen(function*() {
      const desiredShape = new Product("legacy", {
        name: "Legacy",
        prices: [fixedPrice({ amount: "1000", currency: "usd" })],
      }).toDesiredResource();
      const current: CurrentProductResource = {
        source: "current",
        kind: "product",
        key: desiredShape.key,
        address: desiredShape.address,
        polarId: "polar-product-legacy",
        spec: desiredShape.spec,
      };
      const planner = yield* Planner;

      const plan = yield* planner.plan({
        desiredResources: [],
        currentResources: [current],
      });

      expect([...plan.nodes.entries()]).toEqual([
        [
          "product.legacy",
          {
            _tag: "Archive",
            address: "product.legacy",
            kind: "product",
            current,
          },
        ],
      ]);
      expect(plan.edges).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("captures dependencies from current resources for archive ordering", () =>
    Effect.gen(function*() {
      const meter = new Meter("requests", {
        name: "Requests",
        filter: { conjunction: "and", clauses: [] },
        aggregation: count(),
      }).toDesiredResource();
      const product = new Product("pro", {
        name: "Pro",
        prices: [meteredUnitPrice({ meter: meter.address, amount: "0.01", currency: "usd" })],
      }).toDesiredResource();
      const currentMeter: CurrentMeterResource = {
        source: "current",
        kind: "meter",
        key: meter.key,
        address: meter.address,
        polarId: "polar-meter-requests",
        spec: meter.spec,
      };
      const currentProduct: CurrentProductResource = {
        source: "current",
        kind: "product",
        key: product.key,
        address: product.address,
        polarId: "polar-product-pro",
        spec: product.spec,
      };
      const planner = yield* Planner;

      const plan = yield* planner.plan({
        desiredResources: [],
        currentResources: [currentMeter, currentProduct],
      });

      expect(plan.edges).toEqual([
        {
          _tag: "DependsOn",
          from: "product.pro",
          to: "meter.requests",
        },
      ]);
    }).pipe(Effect.provide(testLayer)),
  );
});
