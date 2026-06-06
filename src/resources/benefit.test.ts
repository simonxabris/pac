import { beforeEach, describe, expect, it } from "vitest";
import { Benefit, benefitSpec } from "./benefit.js";
import { count, eventName, Meter, and } from "./meter.js";
import { resetRegistry } from "./registry.js";

describe("Benefit", () => {
  beforeEach(() => {
    resetRegistry();
  });

  it("creates a canonical meter-credit Benefit resource", () => {
    const benefit = new Benefit("included-requests", {
      type: "meter-credit",
      description: "10k API requests",
      meter: "meter.requests",
      units: 10_000,
      rollover: true,
    });

    expect(benefit.toDesiredResource()).toEqual({
      source: "desired",
      kind: "benefit",
      key: "included-requests",
      address: "benefit.included-requests",
      spec: {
        type: "meter-credit",
        description: "10k API requests",
        meter: "meter.requests",
        units: 10_000,
        rollover: true,
      },
    });
  });

  it("normalizes a Meter instance reference to its address", () => {
    const meter = new Meter("requests", {
      name: "Requests",
      filter: and(eventName("eq", "api_request")),
      aggregation: count(),
    });
    const benefit = new Benefit("included-requests", {
      type: "meter-credit",
      description: "10k API requests",
      meter,
      units: 10_000,
    });

    expect(benefit.toDesiredResource().spec.meter).toBe("meter.requests");
  });

  it("normalizes a Meter address string", () => {
    const benefit = new Benefit("included-requests", {
      type: "meter-credit",
      description: "10k API requests",
      meter: "meter.requests",
      units: 10_000,
    });

    expect(benefit.toDesiredResource().spec.meter).toBe("meter.requests");
  });

  it("defaults rollover to false", () => {
    const benefit = new Benefit("included-requests", {
      type: "meter-credit",
      description: "10k API requests",
      meter: "meter.requests",
      units: 10_000,
    });

    expect(benefit.toDesiredResource().spec.rollover).toBe(false);
  });

  it("validates description length", () => {
    expect(() =>
      benefitSpec({
        type: "meter-credit",
        description: "no",
        meter: "meter.requests",
        units: 1,
      }),
    ).toThrow();

    expect(() =>
      benefitSpec({
        type: "meter-credit",
        description: "x".repeat(43),
        meter: "meter.requests",
        units: 1,
      }),
    ).toThrow();
  });

  it("validates units as an integer from 1 through 2,147,483,647", () => {
    for (const units of [0, 1.5, 2_147_483_648]) {
      expect(() =>
        benefitSpec({
          type: "meter-credit",
          description: "Valid description",
          meter: "meter.requests",
          units,
        }),
      ).toThrow();
    }
  });

  it("rejects invalid Meter addresses", () => {
    expect(() =>
      benefitSpec({
        type: "meter-credit",
        description: "Valid description",
        meter: "requests" as "meter.requests",
        units: 1,
      }),
    ).toThrow();
  });
});
