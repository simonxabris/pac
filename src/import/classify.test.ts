import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { managedMetadata } from "../resources/adapter-utils.js";
import { assignImportIdentities } from "./classify.js";

describe("import identity assignment", () => {
  it.effect(
    "preserves managed identities and assigns deterministic identities for unmanaged resources",
    () =>
      Effect.gen(function* () {
        const identities = yield* assignImportIdentities([
          {
            kind: "meter",
            polarId: "met_managed",
            label: "Managed Tokens",
            metadata: managedMetadata("meter", "meter.tokens", "tokens"),
          },
          {
            kind: "meter",
            polarId: "met_input",
            label: "Input Tokens",
            metadata: {},
          },
          {
            kind: "meter",
            polarId: "met_archived",
            label: "Archived Tokens",
            metadata: {},
            isRemoved: true,
          },
        ]);

        expect(identities).toEqual([
          {
            kind: "meter",
            polarId: "met_managed",
            key: "tokens",
            address: "meter.tokens",
            variableName: "meterTokens",
            adoption: "AlreadyManaged",
            identity: {
              version: 1,
              kind: "meter",
              address: "meter.tokens",
              key: "tokens",
            },
          },
          {
            kind: "meter",
            polarId: "met_input",
            key: "input-tokens",
            address: "meter.input-tokens",
            variableName: "meterInputTokens",
            adoption: "NeedsAdoption",
            identity: {
              version: 1,
              kind: "meter",
              address: "meter.input-tokens",
              key: "input-tokens",
            },
          },
        ]);
      }),
  );

  it.effect("reports conflicting PAAC Metadata", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        assignImportIdentities([
          {
            kind: "meter",
            polarId: "met_conflict",
            label: "Tokens",
            metadata: managedMetadata("product", "product.pro", "pro"),
          },
        ]),
      );

      expect(error).toMatchObject({
        _tag: "ImportClassificationError",
        kind: "meter",
        polarId: "met_conflict",
      });
      expect(error.message).toContain("Expected PAAC metadata kind 'meter'");
    }),
  );

  it.effect("normalizes keys and variable names with kind prefixes", () =>
    Effect.gen(function* () {
      const identities = yield* assignImportIdentities([
        {
          kind: "meter",
          polarId: "met_123456789",
          label: "  2026 Tokens!! ",
          metadata: {},
        },
        {
          kind: "benefit",
          polarId: "ben_included",
          label: "Included Tokens",
          metadata: {},
        },
        {
          kind: "product",
          polarId: "prod_pro",
          label: "Pro",
          metadata: {},
        },
      ]);

      expect(identities.map(({ key, variableName }) => ({ key, variableName }))).toEqual([
        { key: "meter-2026-tokens", variableName: "meterMeter2026Tokens" },
        { key: "included-tokens", variableName: "benefitIncludedTokens" },
        { key: "pro", variableName: "productPro" },
      ]);
    }),
  );
});
