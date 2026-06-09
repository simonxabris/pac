# Feature Flag Benefit Support Plan

## Goal

Add PAC support for Polar's `feature_flag` Benefit type using the existing standalone `Benefit` resource lifecycle.

A Feature Flag Benefit is Polar's lightweight feature-gating primitive: if a customer has an active grant for the Benefit, the application should treat the feature as enabled. The grant is visible in Customer State and `customer.state_changed` webhook payloads as a benefit grant with `benefit_type: "feature_flag"` and `benefit_metadata`.

## Sources Reviewed

- Current code:
  - `src/resources/benefit.ts`
  - `src/resources/benefit-adapter.ts`
  - `src/operations/payloads/benefit.ts`
  - `src/remote-resource-fetcher.ts`
  - `src/polar/service.ts`
  - `src/executor.ts`
  - Benefit tests under `src/resources/`
- Existing plans/docs:
  - `docs/benefit-plan.md`
  - `docs/custom-benefit-plan.md`
  - `CONTEXT.md`
- OpenAPI spec:
  - `docs/reference/polar-openapi.json`
- User-provided Polar docs for Feature Flag Benefits.

## OpenAPI Findings

Relevant schemas in `docs/reference/polar-openapi.json`:

- `BenefitType` includes `feature_flag` alongside `custom`, `meter_credit`, and other unsupported types.
- `BenefitCreate` is a discriminated union on `type` and includes `BenefitFeatureFlagCreate`.
- `BenefitFeatureFlagCreate`
  - required: `type`, `description`, `properties`
  - `type`: constant `feature_flag`
  - `description`: string, min length `3`, max length `42`
  - `metadata`: optional Polar metadata record
  - `properties`: `BenefitFeatureFlagCreateProperties`
- `BenefitFeatureFlagCreateProperties`
  - empty object schema: no type-specific create properties
- `BenefitFeatureFlag`
  - `type`: constant `feature_flag`
  - `description`: string
  - `is_deleted`: boolean in OpenAPI, exposed by the SDK as `isDeleted`
  - `metadata`: `MetadataOutputType`
  - `properties`: empty object schema
- `BenefitFeatureFlagUpdate`
  - required: `type`
  - `type`: constant `feature_flag`
  - optional nullable `description`
  - optional `metadata`
  - optional nullable `properties`, using the empty feature-flag properties schema
- `CustomerStateBenefitGrant`
  - includes `benefit_type`, `benefit_metadata`, and `properties`
  - `BenefitGrantFeatureFlagProperties` is also an empty object schema

Polar metadata constraints on create/update:

- up to 50 key-value pairs;
- key length `1..40`;
- string values length `1..500`;
- values may be string, integer/number, or boolean;
- no `null` values in create/update metadata.

Because PAC already reserves one metadata key named `pac`, user-supplied Feature Flag metadata should allow at most 49 entries and must reject the reserved key `pac`.

## Existing Pattern to Follow

The current Benefit implementation already supports multiple variants:

- `meter-credit`
- `custom`

The generic lifecycle is already in place:

- one public `Benefit` class;
- discriminated public config union;
- discriminated canonical `BenefitSpec` union;
- type-aware dependency discovery;
- type-aware diffing;
- type-aware Polar create/update payload mapping;
- remote fetch/decode through a `RemoteBenefitSdk` union;
- generic executor actions: `CreateBenefit`, `UpdateBenefit`, `DeleteBenefit`.

Feature Flag should be added as a third Benefit variant. No new resource kind, operation action, or executor branch is needed.

## Proposed PAC API

```ts
import { Benefit, Product, fixedPrice } from "pac";

export const premiumFeatures = new Benefit("premium-features", {
  type: "feature-flag",
  description: "Premium Features",
  metadata: {
    role: "editor",
    max_upload_size: 10,
    priority: "elevated",
  },
});

export const pro = new Product("pro", {
  name: "Pro",
  prices: [fixedPrice({ amount: "30", currency: "usd" })],
  recurringInterval: "month",
  recurringIntervalCount: 1,
  benefits: [premiumFeatures],
});
```

Recommended public config variant:

```ts
type BenefitMetadataValue = string | number | boolean;

type FeatureFlagBenefitConfig = {
  readonly type: "feature-flag";
  readonly description: string;
  readonly metadata?: Readonly<Record<string, BenefitMetadataValue>>;
};

type BenefitConfig = MeterCreditBenefitConfig | CustomBenefitConfig | FeatureFlagBenefitConfig;
```

Canonical spec variant:

```ts
type BenefitFeatureFlagSpec = {
  readonly type: "feature-flag";
  readonly description: string;
  readonly metadata: Readonly<Record<string, BenefitMetadataValue>>;
};

type BenefitSpec = BenefitMeterCreditSpec | BenefitCustomSpec | BenefitFeatureFlagSpec;
```

Normalize missing `metadata` to `{}`. Sort metadata keys during normalization if practical so plans and tests stay deterministic.

## Metadata Ownership Decision

Feature Flag metadata is not just incidental Polar metadata; it is the application-facing payload returned in Customer State and webhooks. Therefore, for `feature-flag` Benefits, PAC should treat user metadata as a managed field.

Rules:

- PAC continues to own the reserved `metadata.pac` key for Managed Resource identity.
- `FeatureFlagBenefitConfig.metadata` owns all non-`pac` metadata keys on PAC-managed Feature Flag Benefits.
- Remote decoding strips `pac` before storing metadata in `BenefitFeatureFlagSpec`.
- Create/update payloads merge user metadata with `managedMetadata(...)`.
- Reject user metadata containing a `pac` key.
- Reject more than 49 user metadata keys so the merged Polar metadata has at most 50 keys.
- Do not add user metadata support to `meter-credit` or `custom` in this change unless deliberately broadening scope.

This keeps PAC metadata semantics compatible with `CONTEXT.md` while exposing the behavior Polar documents for Feature Flag Benefits.

## Step-by-Step Implementation Plan

### 1. Extend the Benefit domain model

File: `src/resources/benefit.ts`

Add:

- `BenefitMetadataValue`
- `BenefitMetadata`
- `FeatureFlagBenefitConfig`
- `BenefitFeatureFlagSpec`

Update:

- `BenefitConfig` union to include `FeatureFlagBenefitConfig`.
- `BenefitSpec` union to include `BenefitFeatureFlagSpec`.
- `BenefitSpecSchema` union to include a new `BenefitFeatureFlagSpecSchema`.
- `benefitSpec` to normalize:

```ts
{
  type: "feature-flag",
  description: config.description,
  metadata: normalizeBenefitMetadata(config.metadata ?? {}),
}
```

Validation to add:

- reuse `BenefitDescriptionSchema` for `description`;
- metadata key length `1..40`;
- metadata string values length `1..500`;
- metadata values: string, finite number, boolean;
- metadata entry count `<= 49`;
- reserved key `pac` is rejected.

### 2. Export the new public types

File: `src/index.ts`

Export the new types alongside existing Benefit exports:

- `BenefitFeatureFlagSpec`
- `FeatureFlagBenefitConfig`
- `BenefitMetadata`
- `BenefitMetadataValue`

### 3. Make dependencies type-aware for Feature Flags

File: `src/resources/benefit-adapter.ts`

Update `benefitDependencies`:

- `meter-credit` returns `[spec.meter]`;
- `custom` returns `[]`;
- `feature-flag` returns `[]`.

### 4. Map Feature Flag create payloads

File: `src/resources/benefit-adapter.ts`

Add a create branch:

```ts
case "feature-flag":
  return {
    metadata: benefitMetadataPayload(node.desired.spec.metadata, node),
    type: "feature_flag",
    description: node.desired.spec.description,
    properties: {},
  };
```

Where `benefitMetadataPayload` merges user metadata and `managedMetadata(...)`, with `pac` protected.

Keep existing meter-credit and custom create payloads unchanged except for any helper extraction required to share metadata merging.

### 5. Map Feature Flag update payloads

File: `src/resources/benefit-adapter.ts`

Extend `benefitUpdatePayload` for `feature-flag`:

- always include `type: "feature_flag"`;
- include `description` only when `description` changed;
- include `metadata` only when `metadata` changed;
- do not include `properties` unless needed for SDK/API compatibility. If included, it should be `{}`.

Rollback payloads should work through the existing update rollback path by passing `node.current.spec`.

### 6. Diff Feature Flag fields

File: `src/resources/benefit-adapter.ts`

Keep the existing immutable type check. Changing a Benefit between `meter-credit`, `custom`, and `feature-flag` should remain blocked with `benefit.type.immutable`.

After comparing `description`, add variant-specific comparisons:

- `meter-credit`: `meter`, `units`, `rollover`;
- `custom`: `note`;
- `feature-flag`: `metadata`.

Use a top-level `FieldChange` path of `["metadata"]` unless the renderer benefits from per-key metadata paths.

### 7. Extend operation payload types

File: `src/operations/payloads/benefit.ts`

Import Polar SDK types:

```ts
import type { BenefitFeatureFlagCreate } from "@polar-sh/sdk/models/components/benefitfeatureflagcreate.js";
import type { BenefitFeatureFlagUpdate } from "@polar-sh/sdk/models/components/benefitfeatureflagupdate.js";
```

Add operation payload variants:

```ts
type BenefitFeatureFlagCreateOperationPayload = BenefitFeatureFlagCreate & {
  readonly metadata: BenefitOperationMetadata;
};

type BenefitFeatureFlagUpdateOperationPayload = BenefitFeatureFlagUpdate;
```

Then extend:

```ts
type BenefitCreateOperationPayload =
  | BenefitMeterCreditCreateOperationPayload
  | BenefitCustomCreateOperationPayload
  | BenefitFeatureFlagCreateOperationPayload;

type BenefitUpdateOperationPayload =
  | BenefitMeterCreditUpdateOperationPayload
  | BenefitCustomUpdateOperationPayload
  | BenefitFeatureFlagUpdateOperationPayload;
```

Consider replacing `{ readonly pac: string }` with a shared `BenefitOperationMetadata` that permits PAC plus feature-flag user metadata:

```ts
type BenefitOperationMetadata = Readonly<Record<string, string | number | boolean>> & {
  readonly pac: string;
};
```

### 8. Extend remote Benefit decoding

File: `src/remote-resource-fetcher.ts`

Add a `RemoteBenefitFeatureFlagSdk` schema:

```ts
const RemoteBenefitFeatureFlagSdk = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("feature_flag"),
  description: Schema.String,
  isDeleted: Schema.Boolean,
  metadata: MetadataRecord,
  properties: Schema.Struct({}),
});
```

Update `RemoteBenefitSdk` to include it.

Update `benefitToCurrentResource`:

```ts
case "feature_flag":
  return {
    ...base,
    spec: {
      type: "feature-flag",
      description: benefit.description,
      metadata: stripPacMetadata(benefit.metadata),
    },
  };
```

`stripPacMetadata` should remove only the reserved `pac` key and validate/normalize the remaining values into the same canonical metadata shape used by desired resources.

### 9. Extend remote Benefit encoding

File: `src/remote-resource-fetcher.ts`

Update `benefitResourceToRemoteInput` with a feature-flag branch:

```ts
case "feature-flag":
  return {
    benefit: {
      id: resource.polarId,
      type: "feature_flag",
      description: resource.spec.description,
      isDeleted: resource.isRemoved,
      metadata: resource.spec.metadata,
      properties: {},
    },
    meterAddressesById: {},
  };
```

This encoding is mainly for schema round-trips/tests. It should represent user metadata only; PAC metadata is added for API payloads, not as part of canonical spec.

### 10. Leave Polar client and executor unchanged

Files:

- `src/polar/service.ts`
- `src/executor.ts`
- `src/operations/actions.ts`

No changes should be required because:

- `BenefitCreate` already includes `BenefitFeatureFlagCreate` in the SDK;
- `BenefitsUpdateBenefitUpdate` already includes `BenefitFeatureFlagUpdate` in the SDK;
- executor benefit actions are generic.

Only TypeScript payload unions may need to be widened.

### 11. Add public model tests

File: `src/resources/benefit.test.ts`

Add coverage that:

- `new Benefit("premium-features", { type: "feature-flag", description })` creates a desired resource with `metadata: {}`.
- metadata values are preserved exactly for string, number, and boolean values.
- invalid metadata is rejected:
  - key too long;
  - empty key;
  - empty string value;
  - string value too long;
  - reserved key `pac`;
  - more than 49 entries.
- existing meter-credit and custom behavior remains unchanged.

### 12. Add adapter tests

File: `src/resources/benefit-adapter.test.ts`

Add coverage that:

- Feature Flag Benefits have no dependencies.
- Feature Flag create operation emits:
  - `type: "feature_flag"`;
  - `properties: {}`;
  - merged metadata containing user keys and `pac`.
- description drift emits update payload with `description` only.
- metadata drift emits update payload with merged `metadata` only.
- rollback for metadata drift restores previous metadata plus `pac`.
- matching Feature Flag specs plan as `Noop`.
- type changes between Feature Flag and other Benefit variants are blocked as immutable.

### 13. Add remote fetch/decode tests

There is currently no dedicated `remote-resource-fetcher` test file. Add one if needed, or place tests near existing fetcher coverage.

Test:

- managed remote `feature_flag` decodes to `BenefitFeatureFlagSpec`.
- `metadata.pac` is stripped from the canonical spec.
- user metadata round-trips through encode/decode.
- `properties: {}` is accepted.
- managed unsupported Benefit types are still rejected by the remote schema.
- existing remote `meter_credit` and `custom` behavior remains unchanged.

### 14. Update docs and examples

Files:

- `README.md`
- `CONTEXT.md`
- optionally `docs/custom-benefit-plan.md` to remove the forward-looking note that Feature Flag Benefits are not yet implemented.

Update supported feature list from:

```md
- Benefit with only `meter-credit` type.
```

to something like:

```md
- Benefits: `meter-credit`, `custom`, and `feature-flag`.
```

Add a glossary entry:

```md
**Feature Flag Benefit**:
A Benefit that gates application functionality through Polar customer grants. Applications check Customer State or customer state webhooks for a grant of the Feature Flag Benefit; optional Benefit metadata carries application-specific context.
_Avoid_: External flag, product feature, embedded entitlement
```

### 15. Run validation

After implementation:

```sh
pnpm typecheck
pnpm test
pnpm lint
```

Use `pnpm build` if public exports or SDK payload types need a final emit check.

## Expected Code Impact Summary

- `src/resources/benefit.ts`: add Feature Flag config/spec/schema and metadata normalization.
- `src/index.ts`: export Feature Flag and metadata types.
- `src/resources/benefit-adapter.ts`: add Feature Flag branches for dependencies, diffing, create payloads, and update payloads.
- `src/operations/payloads/benefit.ts`: widen create/update payload unions with SDK Feature Flag types.
- `src/remote-resource-fetcher.ts`: decode/encode remote `feature_flag` Benefits.
- Tests: extend Benefit model/adapter coverage and add remote fetcher coverage.
- Docs: update README and domain glossary.

## Non-Goals

- Implementing application-side Customer State helpers.
- Managing customer benefit grants directly.
- Adding support for Polar's Discord, GitHub, downloadables, or license-key Benefits.
- Adding user metadata management to every Benefit type.
