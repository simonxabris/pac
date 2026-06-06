import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { OperationPlanner, PlanNotExecutable } from "./operation-planner.js";
import type { Operation } from "./operations/operation.js";
import type {
  ResourceAddress,
} from "./core/address.js";
import type { ResourceKind } from "./core/kind.js";
import type { CurrentResource, DesiredResource } from "./core/resource.js";
import type {
  BlockedPlanNode,
  CreatePlanNode,
  Diagnostic,
  NoopPlanNode,
  Plan,
  PlanEdge,
  PlanNode,
  RemovePlanNode,
  UpdatePlanNode,
  FieldChange,
} from "./planner.js";
import { ResourceAdapterRegistryLive } from "./resource-adapters.js";
import type { MeterSpec } from "./resources/meter.js";
import type { ProductSpec } from "./resources/product.js";

// --- Plan construction helpers ---

const makeDesiredResource = <K extends ResourceKind, S>(
  kind: K,
  key: string,
  spec: S,
): DesiredResource<K, S> => ({
  source: "desired",
  kind,
  key,
  address: `${kind}.${key}` as ResourceAddress<K>,
  spec,
});

const makeCurrentResource = <K extends ResourceKind, S>(
  kind: K,
  key: string,
  polarId: string,
  spec: S,
): CurrentResource<K, S> => ({
  source: "current",
  kind,
  key,
  address: `${kind}.${key}` as ResourceAddress<K>,
  polarId,
  isRemoved: false,
  spec,
});

const createNode = <K extends ResourceKind, S>(
  desired: DesiredResource<K, S>,
): CreatePlanNode => ({
  _tag: "Create",
  address: desired.address,
  kind: desired.kind,
  desired,
});

const updateNode = <K extends ResourceKind, S>(
  desired: DesiredResource<K, S>,
  current: CurrentResource<K, S>,
  changes: ReadonlyArray<FieldChange> = [],
): UpdatePlanNode => ({
  _tag: "Update",
  address: desired.address,
  kind: desired.kind,
  desired,
  current,
  changes,
});

const removeNode = <K extends ResourceKind, S>(
  current: CurrentResource<K, S>,
): RemovePlanNode => ({
  _tag: "Remove",
  mode: "archive",
  address: current.address,
  kind: current.kind,
  current,
});

const noopNode = <K extends ResourceKind, S>(
  desired: DesiredResource<K, S>,
  current: CurrentResource<K, S>,
): NoopPlanNode => ({
  _tag: "Noop",
  address: desired.address,
  kind: desired.kind,
  desired,
  current,
});

const blockedNode = <K extends ResourceKind>(
  address: ResourceAddress<K>,
  kind: K,
  desired?: DesiredResource<K>,
  current?: CurrentResource<K>,
): BlockedPlanNode => {
  const node: BlockedPlanNode = {
    _tag: "Blocked",
    address,
    kind,
  };
  if (desired !== undefined) {
    (node as any).desired = desired;
  }
  if (current !== undefined) {
    (node as any).current = current;
  }
  return node;
};

const dependsOn = (from: ResourceAddress, to: ResourceAddress): PlanEdge => ({
  _tag: "DependsOn",
  from,
  to,
});

const desiredResourcesFromNodes = (nodes: ReadonlyArray<PlanNode>): ReadonlyArray<DesiredResource> =>
  nodes.flatMap((node) => {
    switch (node._tag) {
      case "Create":
      case "Update":
      case "Noop":
        return [node.desired];
      case "Blocked":
        return node.desired === undefined ? [] : [node.desired];
      case "Remove":
        return [];
    }
  });

const currentResourcesFromNodes = (nodes: ReadonlyArray<PlanNode>): ReadonlyArray<CurrentResource> =>
  nodes.flatMap((node) => {
    switch (node._tag) {
      case "Update":
      case "Remove":
      case "Noop":
        return [node.current];
      case "Blocked":
        return node.current === undefined ? [] : [node.current];
      case "Create":
        return [];
    }
  });

const buildPlan = (input: {
  nodes: ReadonlyArray<PlanNode>;
  edges?: ReadonlyArray<PlanEdge>;
  diagnostics?: ReadonlyArray<Diagnostic>;
}): Plan => {
  const desiredResources = desiredResourcesFromNodes(input.nodes);
  const currentResources = currentResourcesFromNodes(input.nodes);

  return {
    _tag: "PlanGraph",
    nodes: new Map(input.nodes.map((n) => [n.address, n] as const)),
    edges: input.edges ?? [],
    diagnostics: input.diagnostics ?? [],
    desiredResources,
    desiredResourcesByAddress: new Map(desiredResources.map((resource) => [resource.address, resource])),
    currentResources,
    currentResourcesByAddress: new Map(currentResources.map((resource) => [resource.address, resource])),
  };
};

// --- Minimal spec fixtures ---

const simpleMeterSpec: MeterSpec = {
  name: "Test Meter",
  unit: "scalar",
  customLabel: null,
  customMultiplier: null,
  filter: { conjunction: "and", clauses: [] },
  aggregation: { func: "count" },
};

const simpleProductSpec: ProductSpec = {
  name: "Test Product",
  description: null,
  prices: [{ type: "fixed", amount: "1000", currency: "usd" }],
  benefits: [],
  visibility: "public",
  recurringInterval: null,
  recurringIntervalCount: null,
};

// --- Test layer ---

const testLayer = OperationPlanner.layer.pipe(
  Layer.provide(ResourceAdapterRegistryLive),
);

// --- Assertions ---

const operationSummary = (operations: ReadonlyArray<Operation>) =>
  operations.map((operation) => ({
    address: operation.address,
    kind: operation.kind,
    action: operation.action._tag,
  }));

// --- Tests ---

describe("OperationPlanner.create", () => {
  it.effect("orders create dependencies before dependents", () =>
    Effect.gen(function*() {
      const meterDesired = makeDesiredResource("meter", "requests", simpleMeterSpec);
      const productDesired = makeDesiredResource("product", "pro", simpleProductSpec);

      const plan = buildPlan({
        nodes: [createNode(meterDesired), createNode(productDesired)],
        edges: [dependsOn("product.pro", "meter.requests")],
      });

      const operationPlanner = yield* OperationPlanner;
      const program = yield* operationPlanner.create(plan);
      const operations = program.operations;

      expect(operationSummary(operations)).toEqual([
        { address: "meter.requests", kind: "meter", action: "CreateMeter" },
        { address: "product.pro", kind: "product", action: "CreateProduct" },
      ]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("orders remove dependents before dependencies", () =>
    Effect.gen(function*() {
      const meterCurrent = makeCurrentResource("meter", "requests", "polar-meter-requests", simpleMeterSpec);
      const productCurrent = makeCurrentResource("product", "pro", "polar-product-pro", simpleProductSpec);

      const plan = buildPlan({
        nodes: [removeNode(meterCurrent), removeNode(productCurrent)],
        edges: [dependsOn("product.pro", "meter.requests")],
      });

      const operationPlanner = yield* OperationPlanner;
      const program = yield* operationPlanner.create(plan);
      const operations = program.operations;

      expect(operationSummary(operations)).toEqual([
        { address: "product.pro", kind: "product", action: "ArchiveProduct" },
        { address: "meter.requests", kind: "meter", action: "ArchiveMeter" },
      ]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("emits update operations for update nodes", () =>
    Effect.gen(function*() {
      const desired = makeDesiredResource("product", "pro", simpleProductSpec);
      const current = makeCurrentResource("product", "pro", "polar-product-pro", {
        ...simpleProductSpec,
        name: "Old Pro",
      });

      const plan = buildPlan({
        nodes: [
          updateNode(desired, current, [
            { _tag: "FieldChange", path: ["name"], before: "Old Pro", after: "Test Product" },
          ]),
        ],
      });

      const operationPlanner = yield* OperationPlanner;
      const program = yield* operationPlanner.create(plan);
      const operations = program.operations;

      expect(operationSummary(operations)).toEqual([
        { address: "product.pro", kind: "product", action: "UpdateProduct" },
      ]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("preserves existing product prices by id when adding a new price", () =>
    Effect.gen(function*() {
      const currentSpec: ProductSpec = {
        ...simpleProductSpec,
        prices: [{ type: "fixed", amount: "1000", currency: "usd" }],
      };
      const desiredSpec: ProductSpec = {
        ...simpleProductSpec,
        prices: [
          { type: "fixed", amount: "1000", currency: "usd" },
          { type: "free", currency: "usd" },
        ],
      };
      const desired = makeDesiredResource("product", "pro", desiredSpec);
      const current = {
        ...makeCurrentResource("product", "pro", "polar-product-pro", currentSpec),
        providerState: {
          prices: [
            {
              polarPriceId: "price_existing_fixed",
              spec: currentSpec.prices[0],
            },
          ],
        },
      };

      const plan = buildPlan({
        nodes: [
          updateNode(desired, current, [
            {
              _tag: "FieldChange",
              path: ["prices"],
              before: currentSpec.prices,
              after: desiredSpec.prices,
            },
          ]),
        ],
      });

      const operationPlanner = yield* OperationPlanner;
      const program = yield* operationPlanner.create(plan);
      const operations = program.operations;
      const operation = operations[0];

      expect(operation?.action).toEqual({
        _tag: "UpdateProduct",
        id: "polar-product-pro",
        payload: {
          prices: [
            { id: "price_existing_fixed" },
            { amountType: "free", priceCurrency: "usd" },
          ],
        },
      });
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects plans with blocked nodes or error diagnostics", () =>
    Effect.gen(function*() {
      const productDesired = makeDesiredResource("product", "pro", simpleProductSpec);

      const plan = buildPlan({
        nodes: [
          { ...blockedNode("product.pro", "product"), desired: productDesired },
        ],
        diagnostics: [
          {
            _tag: "Diagnostic" as const,
            severity: "error" as const,
            code: "dependency.missing",
            message: `Resource product.pro depends on missing desired resource meter.requests.`,
          },
        ],
      });

      const operationPlanner = yield* OperationPlanner;
      const result = yield* operationPlanner.create(plan).pipe(
        Effect.match({
          onFailure: (error) => ({ _tag: "Failure" as const, error }),
          onSuccess: (program) => ({ _tag: "Success" as const, program }),
        }),
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.error).toBeInstanceOf(PlanNotExecutable);
        if (result.error instanceof PlanNotExecutable) {
          expect(result.error.blockedAddresses).toEqual(["product.pro"]);
          expect(result.error.diagnosticCodes).toEqual(["dependency.missing"]);
        }
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("skips noop nodes", () =>
    Effect.gen(function*() {
      const desired = makeDesiredResource("meter", "requests", simpleMeterSpec);
      const current = makeCurrentResource("meter", "requests", "polar-meter-requests", simpleMeterSpec);

      const plan = buildPlan({
        nodes: [noopNode(desired, current)],
      });

      const operationPlanner = yield* OperationPlanner;
      const program = yield* operationPlanner.create(plan);
      const operations = program.operations;

      expect(operations).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("creates initial bindings from current resources", () =>
    Effect.gen(function*() {
      const meterDesired = makeDesiredResource("meter", "requests", simpleMeterSpec);
      const meterCurrent = makeCurrentResource(
        "meter",
        "requests",
        "polar-meter-requests",
        simpleMeterSpec,
      );
      const productDesired = makeDesiredResource("product", "pro", simpleProductSpec);

      const plan = buildPlan({
        nodes: [noopNode(meterDesired, meterCurrent), createNode(productDesired)],
        edges: [dependsOn("product.pro", "meter.requests")],
      });

      const operationPlanner = yield* OperationPlanner;
      const program = yield* operationPlanner.create(plan);

      expect([...program.initialBindings.entries()]).toEqual([
        ["meter.requests", { polarId: "polar-meter-requests" }],
      ]);
      expect(operationSummary(program.operations)).toEqual([
        { address: "product.pro", kind: "product", action: "CreateProduct" },
      ]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("orders removal of dependent before dependency even without explicit edge", () =>
    Effect.gen(function*() {
      // When removing both a dependent and its dependency, the dependent
      // must be removed first regardless of edge direction, since the
      // dependency edge goes dependent -> dependency.
      const meterCurrent = makeCurrentResource("meter", "requests", "polar-meter-requests", simpleMeterSpec);
      const productCurrent = makeCurrentResource("product", "pro", "polar-product-pro", simpleProductSpec);

      const plan = buildPlan({
        nodes: [removeNode(meterCurrent), removeNode(productCurrent)],
        edges: [dependsOn("product.pro", "meter.requests")],
      });

      const operationPlanner = yield* OperationPlanner;
      const program = yield* operationPlanner.create(plan);
      const operations = program.operations;

      const productIndex = operations.findIndex((o) => o.address === "product.pro");
      const meterIndex = operations.findIndex((o) => o.address === "meter.requests");
      expect(productIndex).toBeLessThan(meterIndex);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("detects operation ordering cycles", () =>
    Effect.gen(function*() {
      const resA = makeDesiredResource("meter", "a", simpleMeterSpec);
      const resB = makeDesiredResource("meter", "b", simpleMeterSpec);

      const plan = buildPlan({
        nodes: [createNode(resA), createNode(resB)],
        edges: [dependsOn("meter.a", "meter.b"), dependsOn("meter.b", "meter.a")],
      });

      const operationPlanner = yield* OperationPlanner;
      const result = yield* operationPlanner.create(plan).pipe(
        Effect.match({
          onFailure: (error) => ({ _tag: "Failure" as const, error }),
          onSuccess: (program) => ({ _tag: "Success" as const, program }),
        }),
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.error).toBeInstanceOf(PlanNotExecutable);
        if (result.error instanceof PlanNotExecutable) {
          expect(result.error.diagnosticCodes).toContain("operation.cycle");
        }
      }
    }).pipe(Effect.provide(testLayer)),
  );

});