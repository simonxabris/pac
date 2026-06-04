import { describe, it, expect, beforeEach } from "vitest";
import {
  Meter,
  where,
  eventName,
  eventTimestamp,
  metadata,
  and,
  or,
  count,
  sum,
  max,
  min,
  avg,
  unique,
  meterSpec,
  meterFilterSpec,
  meterAggregationSpec,
} from "./meter.js";
import { resetRegistry } from "./registry.js";

describe("Meter", () => {
  beforeEach(() => {
    resetRegistry();
  });

  describe("basic meter with count aggregation", () => {
    it("creates a meter with a simple filter and count aggregation", () => {
      const meter = new Meter("api-calls", {
        name: "API Calls",
        filter: and(eventName("eq", "api_call")),
        aggregation: count(),
      });

      const resource = meter.toDesiredResource();

      expect(resource).toEqual({
        source: "desired",
        kind: "meter",
        key: "api-calls",
        address: "meter.api-calls",
        spec: {
          name: "API Calls",
          unit: "scalar",
          customLabel: null,
          customMultiplier: null,
          filter: { conjunction: "and", clauses: [{ property: "name", operator: "eq", value: "api_call" }] },
          aggregation: { func: "count" },
        },
      });
    });
  });

  describe("aggregation types", () => {
    const filter = and(eventName("eq", "event"));

    it("creates a meter with sum aggregation", () => {
      const meter = new Meter("bytes-sent", {
        name: "Bytes Sent",
        filter,
        aggregation: sum("bytes"),
      });

      expect(meter.toDesiredResource().spec.aggregation).toEqual({ func: "sum", property: "bytes" });
    });

    it("creates a meter with max aggregation", () => {
      const meter = new Meter("peak-load", {
        name: "Peak Load",
        filter,
        aggregation: max("load"),
      });

      expect(meter.toDesiredResource().spec.aggregation).toEqual({ func: "max", property: "load" });
    });

    it("creates a meter with min aggregation", () => {
      const meter = new Meter("lowest-latency", {
        name: "Lowest Latency",
        filter,
        aggregation: min("latency_ms"),
      });

      expect(meter.toDesiredResource().spec.aggregation).toEqual({ func: "min", property: "latency_ms" });
    });

    it("creates a meter with avg aggregation", () => {
      const meter = new Meter("avg-latency", {
        name: "Avg Latency",
        filter,
        aggregation: avg("latency_ms"),
      });

      expect(meter.toDesiredResource().spec.aggregation).toEqual({ func: "avg", property: "latency_ms" });
    });

    it("creates a meter with unique aggregation", () => {
      const meter = new Meter("unique-users", {
        name: "Unique Users",
        filter,
        aggregation: unique("user_id"),
      });

      expect(meter.toDesiredResource().spec.aggregation).toEqual({ func: "unique", property: "user_id" });
    });
  });

  describe("unit types and custom configuration", () => {
    it("defaults unit to scalar, customLabel to null, and customMultiplier to null", () => {
      const meter = new Meter("default-unit", {
        name: "Default Unit",
        filter: and(eventName("eq", "event")),
        aggregation: count(),
      });

      const spec = meter.toDesiredResource().spec;

      expect(spec.unit).toBe("scalar");
      expect(spec.customLabel).toBeNull();
      expect(spec.customMultiplier).toBeNull();
    });

    it("creates a meter with token unit", () => {
      const meter = new Meter("token-usage", {
        name: "Token Usage",
        unit: "token",
        filter: and(eventName("eq", "completion")),
        aggregation: sum("tokens"),
      });

      expect(meter.toDesiredResource().spec.unit).toBe("token");
    });

    it("creates a meter with custom unit, custom label, and custom multiplier", () => {
      const meter = new Meter("gpt-tokens", {
        name: "GPT Tokens",
        unit: "custom",
        customLabel: "GPT Tokens",
        customMultiplier: 1000,
        filter: and(eventName("eq", "gpt_completion")),
        aggregation: sum("tokens"),
      });

      const spec = meter.toDesiredResource().spec;

      expect(spec.unit).toBe("custom");
      expect(spec.customLabel).toBe("GPT Tokens");
      expect(spec.customMultiplier).toBe(1000);
    });

    it("allows customMultiplier to be explicitly null", () => {
      const meter = new Meter("custom-no-mult", {
        name: "Custom No Multiplier",
        unit: "custom",
        customLabel: "Widgets",
        customMultiplier: null,
        filter: and(eventName("eq", "widget")),
        aggregation: count(),
      });

      expect(meter.toDesiredResource().spec.customMultiplier).toBeNull();
    });
  });

  describe("filter helpers", () => {
    it("where() creates a generic filter clause", () => {
      const clause = where("status", "eq", "active");

      expect(clause).toEqual({ property: "status", operator: "eq", value: "active" });
    });

    it("eventName() creates a filter clause on the name property", () => {
      const clause = eventName("eq", "api_call");

      expect(clause).toEqual({ property: "name", operator: "eq", value: "api_call" });
    });

    it("eventTimestamp() creates a filter clause with a string value", () => {
      const clause = eventTimestamp("gte", "2024-01-01T00:00:00Z");

      expect(clause).toEqual({ property: "timestamp", operator: "gte", value: "2024-01-01T00:00:00Z" });
    });

    it("eventTimestamp() converts a Date object to ISO string", () => {
      const date = new Date("2024-06-15T12:00:00Z");
      const clause = eventTimestamp("lte", date);

      expect(clause).toEqual({ property: "timestamp", operator: "lte", value: "2024-06-15T12:00:00.000Z" });
    });

    it("eventTimestamp() accepts a numeric timestamp", () => {
      const clause = eventTimestamp("gt", 1718438400000);

      expect(clause).toEqual({ property: "timestamp", operator: "gt", value: 1718438400000 });
    });

    it("metadata() creates a filter clause on a metadata property", () => {
      const clause = metadata("region", "eq", "us-east");

      expect(clause).toEqual({ property: "metadata.region", operator: "eq", value: "us-east" });
    });

    it("and() combines clauses with conjunction=and", () => {
      const filter = and(eventName("eq", "purchase"), where("amount", "gt", 0));

      expect(filter).toEqual({
        conjunction: "and",
        clauses: [
          { property: "name", operator: "eq", value: "purchase" },
          { property: "amount", operator: "gt", value: 0 },
        ],
      });
    });

    it("or() combines clauses with conjunction=or", () => {
      const filter = or(eventName("eq", "signup"), eventName("eq", "activation"));

      expect(filter).toEqual({
        conjunction: "or",
        clauses: [
          { property: "name", operator: "eq", value: "signup" },
          { property: "name", operator: "eq", value: "activation" },
        ],
      });
    });

    it("filter clauses support all operator types", () => {
      const operators = ["eq", "ne", "gt", "gte", "lt", "lte", "like", "not_like"] as const;

      for (const op of operators) {
        const clause = where("prop", op, "value");
        expect(clause.operator).toBe(op);
      }
    });

    it("filter values can be strings, numbers, or booleans", () => {
      const strClause = where("name", "eq", "hello");
      const numClause = where("count", "gt", 42);
      const boolClause = where("active", "eq", true);

      expect(strClause.value).toBe("hello");
      expect(numClause.value).toBe(42);
      expect(boolClause.value).toBe(true);
    });
  });

  describe("nested filter groups", () => {
    it("supports and() containing an or() subgroup", () => {
      const filter = and(
        eventName("eq", "purchase"),
        or(where("status", "eq", "completed"), where("status", "eq", "pending")),
      );

      const spec = meterFilterSpec(filter);

      expect(spec).toEqual({
        conjunction: "and",
        clauses: [
          { property: "name", operator: "eq", value: "purchase" },
          {
            conjunction: "or",
            clauses: [
              { property: "status", operator: "eq", value: "completed" },
              { property: "status", operator: "eq", value: "pending" },
            ],
          },
        ],
      });
    });

    it("supports or() containing an and() subgroup", () => {
      const filter = or(
        and(eventName("eq", "api_call"), metadata("env", "eq", "prod")),
        and(eventName("eq", "api_call"), metadata("env", "eq", "staging")),
      );

      const spec = meterFilterSpec(filter);

      expect(spec).toEqual({
        conjunction: "or",
        clauses: [
          {
            conjunction: "and",
            clauses: [
              { property: "name", operator: "eq", value: "api_call" },
              { property: "metadata.env", operator: "eq", value: "prod" },
            ],
          },
          {
            conjunction: "and",
            clauses: [
              { property: "name", operator: "eq", value: "api_call" },
              { property: "metadata.env", operator: "eq", value: "staging" },
            ],
          },
        ],
      });
    });

    it("deeply nests filter groups", () => {
      const filter = and(
        eventName("eq", "event"),
        or(
          where("x", "eq", 1),
          and(where("y", "eq", 2), where("z", "eq", 3)),
        ),
      );

      const spec = meterFilterSpec(filter);

      expect(spec).toEqual({
        conjunction: "and",
        clauses: [
          { property: "name", operator: "eq", value: "event" },
          {
            conjunction: "or",
            clauses: [
              { property: "x", operator: "eq", value: 1 },
              {
                conjunction: "and",
                clauses: [
                  { property: "y", operator: "eq", value: 2 },
                  { property: "z", operator: "eq", value: 3 },
                ],
              },
            ],
          },
        ],
      });
    });
  });

  describe("meterFilterSpec", () => {
    it("passes through filter clauses unchanged (they are already the Spec shape)", () => {
      const filter = and(where("name", "eq", "test"));
      const spec = meterFilterSpec(filter);

      expect(spec.clauses[0]).toEqual({ property: "name", operator: "eq", value: "test" });
    });
  });

  describe("meterAggregationSpec", () => {
    it("converts count aggregation", () => {
      expect(meterAggregationSpec({ func: "count" })).toEqual({ func: "count" });
    });

    it("converts property aggregations", () => {
      for (const func of ["sum", "max", "min", "avg"] as const) {
        expect(meterAggregationSpec({ func, property: "bytes" })).toEqual({ func, property: "bytes" });
      }
    });

    it("converts unique aggregation", () => {
      expect(meterAggregationSpec({ func: "unique", property: "user_id" })).toEqual({ func: "unique", property: "user_id" });
    });
  });

  describe("meterSpec direct call", () => {
    it("produces a spec with all defaults", () => {
      const spec = meterSpec({
        name: "Direct Meter",
        filter: and(eventName("eq", "click")),
        aggregation: count(),
      });

      expect(spec).toEqual({
        name: "Direct Meter",
        unit: "scalar",
        customLabel: null,
        customMultiplier: null,
        filter: { conjunction: "and", clauses: [{ property: "name", operator: "eq", value: "click" }] },
        aggregation: { func: "count" },
      });
    });

    it("preserves all explicit config values", () => {
      const spec = meterSpec({
        name: "Custom Tokens",
        unit: "custom",
        customLabel: "GPT Tokens",
        customMultiplier: 1000,
        filter: or(where("model", "eq", "gpt-4")),
        aggregation: sum("tokens"),
      });

      expect(spec).toEqual({
        name: "Custom Tokens",
        unit: "custom",
        customLabel: "GPT Tokens",
        customMultiplier: 1000,
        filter: { conjunction: "or", clauses: [{ property: "model", operator: "eq", value: "gpt-4" }] },
        aggregation: { func: "sum", property: "tokens" },
      });
    });
  });

  describe("resource envelope shape", () => {
    it("always has source=desired, kind=meter, correct key and address", () => {
      const meter = new Meter("envelope-check", {
        name: "Envelope Check",
        filter: and(eventName("eq", "test")),
        aggregation: count(),
      });

      const resource = meter.toDesiredResource();

      expect(resource.source).toBe("desired");
      expect(resource.kind).toBe("meter");
      expect(resource.key).toBe("envelope-check");
      expect(resource.address).toBe("meter.envelope-check");
    });
  });
});