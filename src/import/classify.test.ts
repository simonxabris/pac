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

  it.effect("skips archived or deleted resources", () =>
    Effect.gen(function* () {
      const identities = yield* assignImportIdentities([
        {
          kind: "product",
          polarId: "prod_archived",
          label: "Archived Pro",
          metadata: {},
          isRemoved: true,
        },
      ]);

      expect(identities).toEqual([]);
    }),
  );

  it.effect("fails unsupported resources by default", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        assignImportIdentities([
          {
            kind: "benefit",
            polarId: "ben_discord",
            label: "Discord access",
            metadata: {},
            supported: false,
          },
        ]),
      );

      expect(error).toMatchObject({
        _tag: "ImportClassificationError",
        kind: "benefit",
        polarId: "ben_discord",
      });
      expect(error.message).toContain("not supported by PAC import yet");
    }),
  );

  it.effect(
    "preserves managed metadata identity even when the label would generate a different key",
    () =>
      Effect.gen(function* () {
        const identities = yield* assignImportIdentities([
          {
            kind: "meter",
            polarId: "met_legacy",
            label: "Renamed Tokens",
            metadata: managedMetadata("meter", "meter.legacy-tokens", "legacy-tokens"),
          },
        ]);

        expect(identities).toHaveLength(1);
        expect(identities[0]).toMatchObject({
          key: "legacy-tokens",
          address: "meter.legacy-tokens",
          variableName: "meterLegacyTokens",
          adoption: "AlreadyManaged",
        });
      }),
  );

  it.effect(
    "reports conflicting PAC Metadata when the metadata kind does not match the remote kind",
    () =>
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
        expect(error.message).toContain("Expected PAC metadata kind 'meter'");
      }),
  );

  it.effect("reports malformed PAC Metadata", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        assignImportIdentities([
          {
            kind: "meter",
            polarId: "met_malformed",
            label: "Tokens",
            metadata: { pac: "not-json" },
          },
        ]),
      );

      expect(error).toMatchObject({
        _tag: "ImportClassificationError",
        kind: "meter",
        polarId: "met_malformed",
      });
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

  it.effect("suffixes all unmanaged resources that collide on the same generated key", () =>
    Effect.gen(function* () {
      const identities = yield* assignImportIdentities([
        {
          kind: "product",
          polarId: "prod_alpha111111",
          label: "Pro",
          metadata: {},
        },
        {
          kind: "product",
          polarId: "prod_beta222222",
          label: "Pro",
          metadata: {},
        },
      ]);

      expect(
        identities.map(({ key, address, variableName }) => ({ key, address, variableName })),
      ).toEqual([
        {
          key: "pro-111111",
          address: "product.pro-111111",
          variableName: "productPro111111",
        },
        {
          key: "pro-222222",
          address: "product.pro-222222",
          variableName: "productPro222222",
        },
      ]);
    }),
  );

  it.effect("fails when multiple managed resources declare the same Resource Address", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        assignImportIdentities([
          {
            kind: "meter",
            polarId: "met_first",
            label: "First Tokens",
            metadata: managedMetadata("meter", "meter.tokens", "tokens"),
          },
          {
            kind: "meter",
            polarId: "met_second",
            label: "Second Tokens",
            metadata: managedMetadata("meter", "meter.tokens", "tokens"),
          },
        ]),
      );

      expect(error).toMatchObject({
        _tag: "ImportClassificationError",
        kind: "meter",
        polarId: "met_second",
      });
      expect(error.message).toContain(
        "Multiple remote resources map to Resource Address 'meter.tokens'",
      );
    }),
  );
});
