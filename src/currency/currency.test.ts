import { describe, expect, it } from "vitest";
import {
  currencyDecimalFactor,
  formatMinorUnitAmount,
  majorToMinorUnitAmount,
  majorToMinorUnitDecimalAmount,
  minorToMajorUnitAmount,
  normalizeCurrency,
  optionalMajorToMinorUnitAmount,
  optionalPolarIntegerMinorUnitAmount,
  optionalPolarIntegerMinorUnitNumber,
  polarDecimalMinorUnitAmount,
  polarIntegerMinorUnitAmount,
  polarIntegerMinorUnitNumber,
} from "./currency.js";

describe("currency amounts", () => {
  it("normalizes supported Polar presentment currencies", () => {
    expect(normalizeCurrency("USD")).toBe("usd");
    expect(normalizeCurrency(" jpy ")).toBe("jpy");
  });

  it("matches Polar decimal factors", () => {
    expect(currencyDecimalFactor("usd")).toBe("100");
    expect(currencyDecimalFactor("jpy")).toBe("1");
  });

  it("converts major unit config amounts to integer minor units", () => {
    expect(majorToMinorUnitAmount(30, "usd")).toBe("3000");
    expect(majorToMinorUnitAmount(30, "jpy")).toBe("30");
    expect(majorToMinorUnitAmount("30.25", "usd")).toBe("3025");
    expect(majorToMinorUnitAmount("0030.00", "usd")).toBe("3000");
  });

  it("rejects major unit config amounts that cannot be integer minor units", () => {
    expect(() => majorToMinorUnitAmount("0.001", "usd")).toThrow(
      "cannot be represented as integer minor units",
    );
    expect(() => majorToMinorUnitAmount("30.5", "jpy")).toThrow(
      "cannot be represented as integer minor units",
    );
  });

  it("normalizes optional major-unit config amounts", () => {
    expect(optionalMajorToMinorUnitAmount(null, "usd")).toBeNull();
    expect(optionalMajorToMinorUnitAmount(undefined, "usd")).toBeNull();
    expect(optionalMajorToMinorUnitAmount(30, "usd")).toBe("3000");
  });

  it("converts minor unit amounts back to major units", () => {
    expect(minorToMajorUnitAmount("4000", "usd")).toBe("40");
    expect(minorToMajorUnitAmount("1234", "usd")).toBe("12.34");
    expect(minorToMajorUnitAmount("40", "jpy")).toBe("40");
    expect(minorToMajorUnitAmount("0.1", "usd")).toBe("0.001");
  });

  it("formats minor unit amounts as localized currency values", () => {
    expect(formatMinorUnitAmount("4000", "usd", { locale: "en-US" })).toBe("$40.00");
    expect(formatMinorUnitAmount("40", "jpy", { locale: "en-US" })).toBe("¥40");
    expect(formatMinorUnitAmount("0.1", "usd", { locale: "en-US" })).toBe("$0.001");
  });

  it("normalizes integer minor unit amounts from Polar", () => {
    expect(polarIntegerMinorUnitAmount(3000, "usd")).toBe("3000");
    expect(polarIntegerMinorUnitAmount("003000", "usd")).toBe("3000");
  });

  it("serializes integer minor unit amounts to numbers only after safe-integer validation", () => {
    expect(polarIntegerMinorUnitNumber("3000", "usd")).toBe(3000);
    expect(optionalPolarIntegerMinorUnitNumber(null, "usd")).toBeNull();
    expect(optionalPolarIntegerMinorUnitNumber("3000", "usd")).toBe(3000);
    expect(() => polarIntegerMinorUnitNumber("9007199254740992", "usd")).toThrow(
      "safe integer range",
    );
  });

  it("normalizes optional integer minor unit amounts from Polar", () => {
    expect(optionalPolarIntegerMinorUnitAmount(null, "usd")).toBeNull();
    expect(optionalPolarIntegerMinorUnitAmount(undefined, "usd")).toBeNull();
    expect(optionalPolarIntegerMinorUnitAmount("003000", "usd")).toBe("3000");
  });

  it("converts major unit config amounts to decimal minor units", () => {
    expect(majorToMinorUnitDecimalAmount("0.001", "usd")).toBe("0.1");
    expect(majorToMinorUnitDecimalAmount("30", "usd")).toBe("3000");
    expect(majorToMinorUnitDecimalAmount("0.001", "jpy")).toBe("0.001");
  });

  it("normalizes decimal minor unit amounts from Polar", () => {
    expect(polarDecimalMinorUnitAmount("0.1", "usd")).toBe("0.1");
    expect(polarDecimalMinorUnitAmount("003.1000", "usd")).toBe("3.1");
  });

  it("rejects unsupported, negative, and exponent amounts", () => {
    expect(() => normalizeCurrency("btc")).toThrow("Unsupported Polar presentment currency");
    expect(() => majorToMinorUnitAmount("-1", "usd")).toThrow("must be non-negative");
    expect(() => majorToMinorUnitDecimalAmount("1e-3", "usd")).toThrow("without exponent notation");
  });
});
