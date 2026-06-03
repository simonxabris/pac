import { describe, expect, it } from "vitest";
import {
  decodePaacMetadata,
  decodePaacMetadataResult,
  encodePaacMetadata,
} from "../../src/core/metadata.js";

const identity = {
  version: 1 as const,
  kind: "product",
  address: "product.pro" as const,
  key: "pro",
};

describe("PAAC metadata", () => {
  it("encodes and decodes the v1 managed identity envelope", () => {
    expect(decodePaacMetadata(encodePaacMetadata(identity))).toEqual(identity);
  });

  it("does not decode prerelease legacy metadata", () => {
    expect(
      decodePaacMetadataResult({
        paac: JSON.stringify({ type: "product", addr: "product.pro", key: "pro", project: "app" }),
      }),
    ).toMatchObject({ _tag: "malformed", diagnostic: { code: "PAAC_MALFORMED_METADATA" } });
  });

  it("rejects addr values that do not match kind and key", () => {
    expect(
      decodePaacMetadataResult({
        paac: JSON.stringify({ v: 1, kind: "product", addr: "product.pro", key: "wrong" }),
      }),
    ).toMatchObject({ _tag: "malformed", diagnostic: { code: "PAAC_MALFORMED_METADATA" } });
  });

  it("returns unmanaged for metadata without a paac key", () => {
    expect(decodePaacMetadataResult({ other: "value" })).toEqual({ _tag: "unmanaged" });
  });

  it("reports malformed paac metadata", () => {
    expect(decodePaacMetadataResult({ paac: "not-json" })).toMatchObject({
      _tag: "malformed",
      diagnostic: { severity: "error", code: "PAAC_MALFORMED_METADATA" },
    });
  });
});
