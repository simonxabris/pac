import { describe, expect, it } from "vitest";
import { and, count, eventName, eventTimestamp, metadata, Meter, sum } from "../../src/index.js";

describe("Meter resource API", () => {
  it("requires resource keys to match the PAAC key grammar", () => {
    expect(
      () =>
        new Meter("bad.key", {
          name: "Bad",
          filter: and(eventName("eq", "api.request")),
          aggregation: count(),
        }),
    ).toThrow();
  });

  it("requires custom labels for custom units", () => {
    expect(
      () =>
        new Meter("requests", {
          name: "Requests",
          unit: "custom",
          filter: and(eventName("eq", "api.request")),
          aggregation: count(),
        }),
    ).toThrow("customLabel");
  });

  it("rejects custom fields for non-custom units", () => {
    expect(
      () =>
        new Meter("tokens", {
          name: "Tokens",
          unit: "token",
          customLabel: "tokens",
          filter: and(eventName("eq", "api.request")),
          aggregation: count(),
        } as never),
    ).toThrow("customLabel");
  });

  it("canonicalizes desired meter config", () => {
    const meter = new Meter("tokens", {
      name: "Tokens",
      unit: "token",
      filter: and(eventName("eq", "tokens.used")),
      aggregation: sum("tokens"),
    });

    expect(meter.toDesiredResource()).toMatchObject({
      kind: "meter",
      key: "tokens",
      address: "meter.tokens",
      config: {
        managed: {
          name: "Tokens",
          unit: "token",
          filter: {
            conjunction: "and",
            clauses: [{ property: "name", operator: "eq", value: "tokens.used" }],
          },
          aggregation: { func: "sum", property: "tokens" },
          isArchived: false,
        },
      },
    });
  });

  it("provides explicit helpers for event name, event timestamp, and metadata filters", () => {
    const timestamp = new Date("2026-01-01T00:00:00.000Z");

    expect(eventName("eq", "api.request")).toEqual({
      property: "name",
      operator: "eq",
      value: "api.request",
    });
    expect(eventTimestamp("gte", timestamp)).toEqual({
      property: "timestamp",
      operator: "gte",
      value: "2026-01-01T00:00:00.000Z",
    });
    expect(metadata("route", "eq", "/api/chat")).toEqual({
      property: "route",
      operator: "eq",
      value: "/api/chat",
    });
  });
});
