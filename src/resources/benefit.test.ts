import { beforeEach, describe, expect, it } from "vitest";
import { PAC_METADATA_KEY } from "../core/metadata.js";
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

  it("creates a canonical custom Benefit resource", () => {
    const benefit = new Benefit("onboarding", {
      type: "custom",
      description: "Your onboarding link",
      note: "Book here: [Calendly](https://calendly.com/acme/onboarding)",
    });

    expect(benefit.toDesiredResource()).toEqual({
      source: "desired",
      kind: "benefit",
      key: "onboarding",
      address: "benefit.onboarding",
      spec: {
        type: "custom",
        description: "Your onboarding link",
        note: "Book here: [Calendly](https://calendly.com/acme/onboarding)",
      },
    });
  });

  it("defaults custom Benefit note to null", () => {
    const benefit = new Benefit("onboarding", {
      type: "custom",
      description: "Your onboarding link",
    });

    expect(benefit.toDesiredResource().spec).toEqual({
      type: "custom",
      description: "Your onboarding link",
      note: null,
    });
  });

  it("creates a canonical feature-flag Benefit resource", () => {
    const benefit = new Benefit("premium-features", {
      type: "feature-flag",
      description: "Premium Features",
      metadata: {
        priority: "elevated",
        seat_limit: 10,
        beta: true,
      },
    });

    expect(benefit.toDesiredResource()).toEqual({
      source: "desired",
      kind: "benefit",
      key: "premium-features",
      address: "benefit.premium-features",
      spec: {
        type: "feature-flag",
        description: "Premium Features",
        metadata: {
          beta: true,
          priority: "elevated",
          seat_limit: 10,
        },
      },
    });
  });

  it("defaults feature-flag Benefit metadata to an empty record", () => {
    const benefit = new Benefit("premium-features", {
      type: "feature-flag",
      description: "Premium Features",
    });

    expect(benefit.toDesiredResource().spec).toEqual({
      type: "feature-flag",
      description: "Premium Features",
      metadata: {},
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

    expect(benefit.toDesiredResource().spec).toMatchObject({
      type: "meter-credit",
      meter: "meter.requests",
    });
  });

  it("normalizes a Meter address string", () => {
    const benefit = new Benefit("included-requests", {
      type: "meter-credit",
      description: "10k API requests",
      meter: "meter.requests",
      units: 10_000,
    });

    expect(benefit.toDesiredResource().spec).toMatchObject({
      type: "meter-credit",
      meter: "meter.requests",
    });
  });

  it("defaults rollover to false", () => {
    const benefit = new Benefit("included-requests", {
      type: "meter-credit",
      description: "10k API requests",
      meter: "meter.requests",
      units: 10_000,
    });

    expect(benefit.toDesiredResource().spec).toMatchObject({
      type: "meter-credit",
      rollover: false,
    });
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

  it("validates feature-flag metadata", () => {
    expect(() =>
      benefitSpec({
        type: "feature-flag",
        description: "Premium Features",
        metadata: { "": "value" },
      }),
    ).toThrow();

    expect(() =>
      benefitSpec({
        type: "feature-flag",
        description: "Premium Features",
        metadata: { ["x".repeat(41)]: "value" },
      }),
    ).toThrow();

    expect(() =>
      benefitSpec({
        type: "feature-flag",
        description: "Premium Features",
        metadata: { [PAC_METADATA_KEY]: "reserved" },
      }),
    ).toThrow();

    expect(() =>
      benefitSpec({
        type: "feature-flag",
        description: "Premium Features",
        metadata: { empty: "" },
      }),
    ).toThrow();

    expect(() =>
      benefitSpec({
        type: "feature-flag",
        description: "Premium Features",
        metadata: { long: "x".repeat(501) },
      }),
    ).toThrow();

    expect(() =>
      benefitSpec({
        type: "feature-flag",
        description: "Premium Features",
        metadata: Object.fromEntries(
          Array.from({ length: 50 }, (_, index) => [`k${index}`, index]),
        ),
      }),
    ).toThrow();
  });
});
