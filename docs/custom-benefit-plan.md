# Custom Benefit Support Plan

## Goal

Add PAAC support for Polar's `custom` Benefit type, using the same `Benefit` resource lifecycle that currently supports `meter-credit` Benefits.

Custom Benefits let a merchant attach a customer-visible private Markdown note to a paying customer. Typical uses are onboarding links, private support contact details, coupon codes, or post-purchase instructions.

## OpenAPI Findings

Source: `docs/reference/polar-openapi.json`.

Relevant schemas:

- `BenefitCreate` is a discriminated union on `type` and already includes `BenefitCustomCreate`.
- `BenefitCustomCreate`
  - required: `type`, `description`, `properties`
  - `type`: constant `custom`
  - `description`: string, min length `3`, max length `42`
  - `properties`: `BenefitCustomCreateProperties`
- `BenefitCustomCreateProperties`
  - `note`: nullable string; described as the private note shared with customers who have this benefit granted
- `BenefitCustom`
  - `type`: constant `custom`
  - `description`: string
  - `is_deleted`: boolean
  - `metadata`: `MetadataOutputType`
  - `properties`: `BenefitCustomProperties`
- `BenefitCustomProperties`
  - required: `note`
  - `note`: nullable string
- `BenefitCustomUpdate`
  - required: `type`
  - `type`: constant `custom`
  - optional nullable `description`
  - optional nullable `properties`, using `BenefitCustomProperties`
- `BenefitType` includes `custom`, `meter_credit`, and the other unsupported types.

Important behavior from Polar docs:

- The customer-facing title is the Benefit `description`.
- The private customer content is `properties.note`.
- The note supports Markdown.
- This type should not be positioned as PAAC's feature-gating primitive; use PAAC's `feature-flag` Benefit support for that.

## Existing Meter-Credit Support to Reuse

Current implementation points:

- Public and canonical Benefit model: `src/resources/benefit.ts`
- Benefit planning and operation payload mapping: `src/resources/benefit-adapter.ts`
- Polar operation payload types: `src/operations/payloads/benefit.ts`
- Remote Polar Benefit decoding/encoding: `src/remote-resource-fetcher.ts`
- Executor already delegates generic create/update/delete Benefit actions: `src/executor.ts`
- Tests already cover meter-credit Benefit behavior in:
  - `src/resources/benefit.test.ts`
  - `src/resources/benefit-adapter.test.ts`
  - `src/operation-planner.test.ts`
  - `src/executor.test.ts`

The generic Benefit resource shape and operation actions do not need a new resource kind. Add a second discriminant variant beside `meter-credit`.

## Proposed PAAC API

```ts
import { Benefit, Product, fixedPrice } from "paac";

export const onboarding = new Benefit("onboarding", {
  type: "custom",
  description: "Your onboarding link",
  note: "Book your onboarding call here: [Calendly](https://calendly.com/acme/onboarding)",
});

export const pro = new Product("pro", {
  name: "Pro",
  prices: [fixedPrice({ amount: 30, currency: "usd" })],
  benefits: [onboarding],
});
```

Recommended public config:

```ts
type CustomBenefitConfig = {
  readonly type: "custom";
  readonly description: string;
  readonly note?: string | null;
};

type BenefitConfig =
  | MeterCreditBenefitConfig
  | CustomBenefitConfig;
```

Canonical spec:

```ts
type BenefitCustomSpec = {
  readonly type: "custom";
  readonly description: string;
  readonly note: string | null;
};

type BenefitSpec =
  | BenefitMeterCreditSpec
  | BenefitCustomSpec;
```

Default `note` to `null`, matching Polar's nullable field and keeping the canonical spec explicit.

## Step-by-Step Implementation Plan

### 1. Extend the Benefit domain model

File: `src/resources/benefit.ts`

- Add `CustomBenefitConfig` with `type: "custom"`, `description`, and optional `note?: string | null`.
- Add `BenefitCustomSpec` with `type: "custom"`, `description`, and normalized `note: string | null`.
- Change `BenefitConfig` and `BenefitSpec` into unions of meter-credit and custom variants.
- Add `BenefitCustomSpecSchema`:
  - `type`: literal `custom`
  - `description`: reuse `BenefitDescriptionSchema`
  - `note`: nullable string
- Change `BenefitSpecSchema` from only `BenefitMeterCreditSpecSchema` to a union of `BenefitMeterCreditSpecSchema` and `BenefitCustomSpecSchema`.
- Update `benefitSpec` to normalize custom config into the canonical spec and default missing `note` to `null`.

### 2. Make Benefit dependencies type-aware

File: `src/resources/benefit-adapter.ts`

- Update `benefitDependencies`:
  - `meter-credit` returns `[spec.meter]`
  - `custom` returns `[]`
- This preserves existing `Product -> Benefit -> Meter` ordering for meter credits while allowing custom Benefits with no Meter dependency.

### 3. Generalize create payload mapping

File: `src/resources/benefit-adapter.ts`

- Keep the create path generic, but branch by `node.desired.spec.type`.
- For meter-credit, keep the existing payload:

```ts
{
  metadata,
  type: "meter_credit",
  description,
  properties: { meterId, units, rollover }
}
```

- For custom, emit:

```ts
{
  metadata,
  type: "custom",
  description: spec.description,
  properties: { note: spec.note }
}
```

### 4. Generalize update payload mapping

File: `src/resources/benefit-adapter.ts`

- Preserve the existing immutable type check; changing from `meter-credit` to `custom` or back should stay blocked with `benefit.type.immutable`.
- Make `benefitUpdatePayload` branch by current desired spec type.
- For `custom` updates:
  - always include `type: "custom"`
  - include `description` when the `description` field changed
  - include `properties: { note: spec.note }` when `note` changed
- Continue using partial update payloads so unchanged fields are not sent.

### 5. Make diff field comparison variant-specific

File: `src/resources/benefit-adapter.ts`

- Continue comparing `description` for all Benefits.
- For `meter-credit`, compare `meter`, `units`, and `rollover`.
- For `custom`, compare `note`.
- Avoid referencing `spec.meter` on the union without narrowing.

### 6. Extend operation payload types

File: `src/operations/payloads/benefit.ts`

- Import Polar SDK types for custom create/update:
  - `BenefitCustomCreate`
  - `BenefitCustomUpdate`
- Add a custom properties operation payload type if useful:

```ts
type BenefitCustomPropertiesOperationPayload = BenefitCustomCreate["properties"];
```

- Change `BenefitCreateOperationPayload` into a union of:
  - the existing meter-credit create payload with resolvable `meterId`
  - a custom create payload with PAAC metadata
- Change `BenefitUpdateOperationPayload` into a union of:
  - the existing meter-credit update payload with resolvable `meterId`
  - `BenefitCustomUpdate`

The executor can remain unchanged because it already passes create/update payloads to the Polar client.

### 7. Extend remote Benefit decoding

File: `src/remote-resource-fetcher.ts`

- Replace `RemoteBenefitMeterCreditSdk` / `RemoteBenefitResourceInput` with a discriminated union that accepts both:
  - `type: "meter_credit"` with meter-credit properties
  - `type: "custom"` with custom properties
- For custom remote Benefits, decode into:

```ts
spec: {
  type: "custom",
  description: benefit.description,
  note: benefit.properties.note,
}
```

- Do not require `meterAddressesById` for custom Benefits.
- Keep the existing error when a meter-credit Benefit references an unmanaged or unknown meter.

### 8. Extend remote Benefit encoding for tests/schema round-trips

File: `src/remote-resource-fetcher.ts`

- Update `benefitResourceToRemoteInput` to branch on `resource.spec.type`.
- For custom, encode:

```ts
{
  id: resource.polarId,
  type: "custom",
  description: resource.spec.description,
  isDeleted: resource.isRemoved,
  metadata: {},
  properties: { note: resource.spec.note },
}
```

### 9. Add tests for the public model

File: `src/resources/benefit.test.ts`

Add coverage that:

- `new Benefit("onboarding", { type: "custom", description, note })` produces a desired resource with `spec.type: "custom"`.
- missing `note` normalizes to `null`.
- Markdown note strings are preserved exactly.
- description validation remains `3..42` chars.

### 10. Add tests for adapter planning and payloads

File: `src/resources/benefit-adapter.test.ts`

Add coverage that:

- custom Benefit create operation emits `type: "custom"` and `properties.note`.
- custom Benefit has no dependencies.
- custom Benefit description drift creates an update payload with `description` only.
- custom Benefit note drift creates an update payload with `properties.note`.
- custom Benefit no-op has no changes.
- changing type between custom and meter-credit remains blocked as immutable.

### 11. Add remote fetcher tests

Likely files: existing remote-resource-fetcher tests, or create/extend tests near that module.

Add coverage that:

- a managed remote `custom` Benefit decodes to a current `BenefitCustomSpec`.
- `note: null` round-trips.
- remote meter-credit behavior is unchanged.
- unsupported Benefit types are still rejected or ignored according to the existing managed-resource fetch behavior.

### 12. Add executor-level tests only if payload typing needs protection

File: `src/executor.test.ts`

The executor likely needs no implementation change. Add a regression test only if TypeScript narrowing or payload unions make it easy to accidentally break `createBenefit` / `updateBenefit` calls for custom payloads.

### 13. Update documentation/examples

Potential files:

- `README.md`
- `docs/benefit-plan.md` or a dedicated Benefit usage doc if one exists

Document:

- `type: "custom"`
- `description` is the customer-facing title
- `note` is private Markdown customer content
- custom Benefits are for notes/instructions, not feature gating
- product attachment is unchanged: add the Benefit to `ProductConfig.benefits`

### 14. Run validation

Run the project's normal checks after implementation:

```sh
pnpm test
pnpm typecheck
```

If exact scripts differ, inspect `package.json` and run the equivalent test/typecheck commands.

## Expected Code Impact Summary

- `src/resources/benefit.ts`: add the public/canonical custom variant and schema.
- `src/resources/benefit-adapter.ts`: branch dependencies, diffing, create payloads, update payloads by Benefit type.
- `src/operations/payloads/benefit.ts`: union Polar SDK payload types for meter-credit and custom.
- `src/remote-resource-fetcher.ts`: accept/decode/encode both `meter_credit` and `custom` remote Benefit shapes.
- Tests: add custom Benefit coverage alongside existing meter-credit tests.

No new operation action or executor branch should be required.
