import { describe, expect, it } from "vitest";
import {
  addConvergeBeforeDestroyDependencies,
  addResourceOperationDependencies,
  orderOperations,
} from "./graph.js";
import type { Operation, ResourceChange } from "./plan.js";

const operation = (
  id: string,
  address: `product.${string}`,
  dependsOn: ReadonlyArray<string> = [],
  action: Operation["action"] = "create",
): Operation => ({
  id,
  provider: "polar",
  kind: "product",
  address,
  action,
  call: "products.create",
  input: {},
  dependsOn,
  preview: { title: id, lines: [] },
});

const change = (
  address: `product.${string}`,
  operations: ReadonlyArray<string>,
  dependsOn: ReadonlyArray<`product.${string}`> = [],
): ResourceChange => ({
  address,
  kind: "product",
  action: "create",
  diffs: [],
  operations,
  dependsOn,
});

describe("operation graph", () => {
  it("translates resource dependencies into operation dependencies", () => {
    const operations = addResourceOperationDependencies(
      [change("product.base", ["create:base"]), change("product.pro", ["create:pro"], ["product.base"])],
      [operation("create:pro", "product.pro"), operation("create:base", "product.base")],
    );

    expect(operations.find((item) => item.id === "create:pro")?.dependsOn).toEqual(["create:base"]);
  });

  it("orders operations by dependency", () => {
    const result = orderOperations([
      operation("create:pro", "product.pro", ["create:base"]),
      operation("create:base", "product.base"),
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.operations.map((item) => item.id)).toEqual(["create:base", "create:pro"]);
  });

  it("adds dependencies so convergent operations run before destructive operations", () => {
    const operations = addConvergeBeforeDestroyDependencies([
      operation("meter.archive:requests", "product.requests", [], "archive"),
      operation("meter.create:tokens", "product.tokens"),
      operation("product.update:pro", "product.pro", ["meter.create:tokens"], "update"),
    ]);
    const result = orderOperations(operations);

    expect(result.diagnostics).toEqual([]);
    expect(result.operations.map((item) => item.id)).toEqual([
      "meter.create:tokens",
      "product.update:pro",
      "meter.archive:requests",
    ]);
  });

  it("reports dependency cycles", () => {
    const result = orderOperations([
      operation("a", "product.a", ["b"]),
      operation("b", "product.b", ["a"]),
    ]);

    expect(result.diagnostics).toMatchObject([
      { severity: "error", code: "PAAC_OPERATION_DEPENDENCY_CYCLE" },
    ]);
  });
});
