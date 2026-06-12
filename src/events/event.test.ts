import { describe, expect, it } from "vitest";
import { Event } from "./event.js";

describe("Event", () => {
  it("exposes typed metadata refs from top-level JSON Schema properties", () => {
    const event = new Event("token-usage", {
      name: "token-usage",
      metadata: {
        type: "object",
        properties: {
          tokens: { type: "number" },
          model: { type: "string" },
          count: { type: "integer" },
          cacheHit: { type: "boolean" },
          nested: { type: "object" },
        },
        required: ["tokens", "model", "count"],
      },
    });

    expect(event.metadata.tokens).toEqual({
      eventName: "token-usage",
      key: "tokens",
      meterPath: "metadata.tokens",
      valueType: "number",
      optional: false,
    });
    expect(event.metadata.model).toEqual({
      eventName: "token-usage",
      key: "model",
      meterPath: "metadata.model",
      valueType: "string",
      optional: false,
    });
    expect(event.metadata.count).toEqual({
      eventName: "token-usage",
      key: "count",
      meterPath: "metadata.count",
      valueType: "number",
      optional: false,
    });
    expect(event.metadata.cacheHit).toEqual({
      eventName: "token-usage",
      key: "cacheHit",
      meterPath: "metadata.cacheHit",
      valueType: "boolean",
      optional: true,
    });
    expect(event.metadata.nested).toEqual({
      eventName: "token-usage",
      key: "nested",
      meterPath: "metadata.nested",
      valueType: "unknown",
      optional: true,
    });
  });

  it("exposes generic metadata refs for schema keys PAC cannot interpret", () => {
    const event = new Event("token-usage", {
      name: "token-usage",
      metadata: { type: "object", properties: {} },
    });

    expect(event.metadata.someFutureField).toEqual({
      eventName: "token-usage",
      key: "someFutureField",
      meterPath: "metadata.someFutureField",
      valueType: "unknown",
      optional: true,
    });
  });
});
