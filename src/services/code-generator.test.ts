import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import type { CurrentResource, DesiredResource } from "../core/resource.js";
import type { ImportModel } from "../import/project.js";
import { Event } from "../events/event.js";
import { Benefit } from "../resources/benefit.js";
import { Meter, and, count, eventName } from "../resources/meter.js";
import { Product, fixedPrice } from "../resources/product.js";
import type { Plan } from "./planner.js";
import { CodeGenerator } from "./code-generator.js";

const assertParses = (source: string, filePath = "generated.ts"): void => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile(filePath, source);
  const diagnostics = project.getProgram().getSyntacticDiagnostics();
  expect(diagnostics.map((diagnostic) => diagnostic.getMessageText())).toEqual([]);
};

const makeCurrentResource = <Kind extends CurrentResource["kind"], Spec>(
  kind: Kind,
  key: string,
  raw: unknown,
): CurrentResource<Kind, Spec> => ({
  source: "current",
  kind,
  key,
  address: `${kind}.${key}`,
  spec: {} as Spec,
  polarId: `polar-${key}`,
  isRemoved: false,
  raw,
});

const makeDesiredResource = <Kind extends DesiredResource["kind"], Spec>(
  kind: Kind,
  key: string,
  spec: Spec,
): DesiredResource<Kind, Spec> => ({
  source: "desired",
  kind,
  key,
  address: `${kind}.${key}`,
  spec,
});

const makePlan = (currentResources: ReadonlyArray<CurrentResource>): Plan => {
  const nodes = new Map(
    currentResources.map((resource) => [
      resource.address,
      {
        _tag: "Noop" as const,
        address: resource.address,
        kind: resource.kind,
        desired: makeDesiredResource(resource.kind, resource.key, resource.spec),
        current: resource,
      },
    ]),
  );

  return {
    _tag: "PlanGraph",
    nodes,
    edges: [],
    diagnostics: [],
    desiredResources: [],
    desiredResourcesByAddress: new Map(),
    currentResources,
    currentResourcesByAddress: new Map(
      currentResources.map((resource) => [resource.address, resource]),
    ),
  };
};

describe("CodeGenerator", () => {
  describe("generateRuntime", () => {
    it("generates a runtime file for resources and events", async () => {
      const plan = makePlan([
        makeCurrentResource("product", "premium", {
          id: "product-1",
          name: "Premium Plan",
          prices: [{ amountType: "fixed", priceAmount: 2000, priceCurrency: "usd" }],
        }),
        makeCurrentResource("meter", "api-calls", {
          id: "meter-1",
          name: "API Calls",
        }),
        makeCurrentResource("benefit", "credits", {
          id: "benefit-1",
          description: "Monthly Credits",
        }),
      ]);

      const event = new Event("api-call", {
        name: "api_call",
        metadata: {
          type: "object",
          properties: {
            endpoint: { type: "string" },
            durationMs: { type: "number" },
            cached: { type: "boolean" },
            extra: {},
          },
          required: ["endpoint"],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const generator = yield* CodeGenerator;
          return yield* generator.generateRuntime(plan, [event.toEventDefinition()]);
        }).pipe(Effect.provide(CodeGenerator.layer)),
      );

      expect(result).toMatchSnapshot();
      assertParses(result, "pac.runtime.ts");
    });

    it("generates an empty runtime file when there are no resources or events", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const generator = yield* CodeGenerator;
          return yield* generator.generateRuntime(makePlan([]));
        }).pipe(Effect.provide(CodeGenerator.layer)),
      );

      expect(result).toMatchSnapshot();
      assertParses(result, "pac.runtime.ts");
    });
  });

  describe("generateConfig", () => {
    it("generates a config file for meters, benefits, and products", async () => {
      const apiCallsMeter = new Meter("api-calls", {
        name: "API Calls",
        filter: and(eventName("eq", "api_call")),
        aggregation: count(),
      });

      const creditsBenefit = new Benefit("credits", {
        type: "meter-credit",
        description: "Monthly API Credits",
        meter: apiCallsMeter,
        units: 1000,
      });

      const premiumProduct = new Product("premium", {
        name: "Premium Plan",
        prices: [fixedPrice({ amount: "2000", currency: "usd" })],
        benefits: [creditsBenefit],
      });

      const meters: ImportModel["meters"] = [
        {
          desired: apiCallsMeter.toDesiredResource(),
          variableName: "apiCallsMeter",
          polarId: "meter-1",
          raw: {} as never,
          adoption: "AlreadyManaged",
        },
      ];

      const benefits: ImportModel["benefits"] = [
        {
          desired: creditsBenefit.toDesiredResource(),
          variableName: "creditsBenefit",
          polarId: "benefit-1",
          raw: {} as never,
          adoption: "AlreadyManaged",
        },
      ];

      const products: ImportModel["products"] = [
        {
          desired: premiumProduct.toDesiredResource(),
          variableName: "premiumProduct",
          polarId: "product-1",
          raw: {} as never,
          adoption: "AlreadyManaged",
        },
      ];

      const model: ImportModel = {
        meters,
        benefits,
        products,
        resources: [...meters, ...benefits, ...products],
        skipped: [],
      };

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const generator = yield* CodeGenerator;
          return yield* generator.generateConfig(model);
        }).pipe(Effect.provide(CodeGenerator.layer)),
      );

      expect(result).toMatchSnapshot();
      assertParses(result, "pac.config.ts");
    });
  });
});
