# Benefit Resource Plan

## Scope

Add Benefits as standalone PAAC resources, initially supporting only Polar's
`meter_credit` type. The design must allow additional Polar Benefit types to be
added without changing the generic resource, planning, or execution model.

Polar behavior relevant to this plan:

- Benefits are standalone resources reusable across Products.
- A meter-credit Benefit grants units to a Meter balance.
- Subscription Products grant credits each subscription cycle.
- One-time Products grant credits once at purchase.
- Rollover affects newly issued credits only.
- Deleting a Benefit revokes its grants and removes customer access.

Sources:

- `docs/reference/polar-openapi.json`
- https://polar.sh/docs/features/benefits/introduction
- https://polar.sh/docs/features/benefits/credits

## Proposed Public API

```ts
import {
  Benefit,
  Meter,
  Product,
  and,
  count,
  eventName,
  fixedPrice,
} from "paac";

export const requests = new Meter("requests", {
  name: "API requests",
  filter: and(eventName("eq", "api_request")),
  aggregation: count(),
});

export const includedRequests = new Benefit("included-requests", {
  type: "meterCredit",
  description: "10,000 API requests per billing period",
  meter: requests,
  units: 10_000,
  rollover: false,
});

export const pro = new Product("pro", {
  name: "Pro",
  prices: [fixedPrice({ amount: 30, currency: "usd" })],
  recurringInterval: "month",
  benefits: [includedRequests],
});
```

Address strings remain supported for references:

```ts
new Benefit("included-requests", {
  type: "meterCredit",
  description: "10,000 API requests per billing period",
  meter: "meter.requests",
  units: 10_000,
});

new Product("pro", {
  name: "Pro",
  prices: [fixedPrice({ amount: 30, currency: "usd" })],
  benefits: ["benefit.included-requests"],
});
```

Recommended public types:

```ts
type BenefitKind = "benefit";
type BenefitAddress = ResourceAddress<BenefitKind>;

type MeterReference = MeterAddress | Pick<Meter, "address">;
type BenefitReference = BenefitAddress | Pick<Benefit, "address">;

type MeterCreditBenefitConfig = {
  readonly type: "meterCredit";
  readonly description: string;
  readonly meter: MeterReference;
  readonly units: number;
  readonly rollover?: boolean;
};

type BenefitConfig =
  | MeterCreditBenefitConfig;

type ProductConfig = {
  // existing fields
  readonly benefits?: ReadonlyArray<BenefitReference>;
};
```

The single `Benefit` class is intentional. Benefit types are a discriminated
configuration union, matching Polar's API model. Future types add a config/spec
variant and adapter branches, not a new resource kind or lifecycle.

Public names use PAAC's camel-case convention (`meterCredit`); the adapter maps
this to Polar's `meter_credit`.

Defaults and validation:

- `rollover` defaults to `false`.
- `benefits` defaults to an empty authoritative set.
- `description` must contain 3-42 characters.
- `units` must be an integer from 1 through 2,147,483,647.
- Product Benefit references are deduplicated and sorted by address because
  attachment order has no documented meaning.

## Canonical Resource Model

Add `benefit` to `ResourceKind`.

```ts
type BenefitMeterCreditSpec = {
  readonly type: "meterCredit";
  readonly description: string;
  readonly meter: MeterAddress;
  readonly units: number;
  readonly rollover: boolean;
};

type BenefitSpec =
  | BenefitMeterCreditSpec;
```

Keep the canonical spec as a discriminated union rather than mirroring Polar's
generic `properties` object. This keeps plans and diagnostics in user-facing
terms while allowing each future Benefit type to own its fields.

Dependencies:

```text
Product -> Benefit -> Meter
```

A Product also keeps its existing direct Meter dependencies from metered prices.

## Product Attachment Semantics

`ProductConfig.benefits` is the complete managed attachment set. Deployment
replaces Polar's Product Benefit list with the declared list.

This is preferable to merge semantics because:

- code remains the source of truth;
- removing an item from the array has deterministic meaning;
- drift is visible and repairable;
- shared Benefits remain standalone resources.

If a managed Product has an attached Benefit without valid PAAC metadata, block
the Product with a `product.benefits.unmanaged` diagnostic. Do not silently
detach an unmanaged Benefit or hide it from the plan.

Changing only Product Benefit attachments must produce an Update plan node and
an `UpdateProductBenefits` operation.

## Removal Semantics

The current generic `Archive` plan node is too provider-specific:

- Products and Meters are archived.
- Benefits are deleted.
- Polar Benefit deletion revokes grants and cannot be rolled back.

Replace the generic plan concept with `Remove`:

```ts
type RemovalMode = "archive" | "delete";

type RemovePlanNode = {
  readonly _tag: "Remove";
  readonly mode: RemovalMode;
  readonly address: ResourceAddress;
  readonly kind: ResourceKind;
  readonly current: CurrentResource;
};
```

Each Resource adapter declares its removal mode:

- Product: `archive`
- Meter: `archive`
- Benefit: `delete`

Rename generic `CurrentResource.isArchived` to `isRemoved`. Provider decoders
map Product/Meter archive state and Benefit `isDeleted` into this lifecycle
flag.

The renderer must show separate `Archive` and `Delete` sections. Benefit
deletion should also emit a warning that existing grants will be revoked.

Recommended safety rule: `paac deploy` refuses plans containing delete-mode
removals unless passed `--allow-delete`. `paac plan` always renders them.

This generic removal change should receive an ADR because it changes a central
planning concept and preserves the distinction between archival and destructive
deletion.

## Polar Client Changes

Extend `PolarClientShape`:

```ts
listBenefits(): Effect<ReadonlyArray<RemoteBenefit>, PolarClientError>
createBenefit(payload): Effect<RemoteBenefit, PolarClientError>
updateBenefit(id, payload): Effect<RemoteBenefit, PolarClientError>
deleteBenefit(id): Effect<void, PolarClientError>
```

Use:

- `sdk.benefits.list({ limit: 100 })`
- `sdk.benefits.create(payload)`
- `sdk.benefits.update({ id, benefitUpdate: payload })`
- `sdk.benefits.delete({ id })`

The existing `updateProductBenefits` client method becomes executable through a
new operation action.

Required token scopes are `benefits:read` and `benefits:write`.

## Remote Resource Fetching

Fetch Products, Meters, and Benefits concurrently, then decode in dependency
order:

1. Decode managed Meters and build `meterAddressesById`.
2. Decode managed Benefits using `meterAddressesById`.
3. Build `benefitAddressesById`.
4. Decode managed Products using both Meter and Benefit maps.

Add a remote Benefit schema for the supported `meter_credit` shape:

- `id`
- `type`
- `description`
- `isDeleted`
- `metadata`
- `properties.units`
- `properties.rollover`
- `properties.meterId`

Only resources carrying valid PAAC metadata enter the managed resource map.

Failure cases:

- A managed meter-credit Benefit referencing an unmanaged/unknown Meter is a
  fetch error.
- A managed Benefit with an unsupported type is a fetch error until that type
  is implemented.
- A managed Product attached to an unmanaged Benefit becomes a blocked Product
  diagnostic, not an implicit detach.

Product provider state should retain Polar Benefit IDs so rollback payloads can
restore the exact previous attachment set.

## Benefit Adapter

Create `src/resources/benefit-adapter.ts`.

`dependencies`:

- meter-credit: return its Meter address.
- future variants: return their own referenced resources.

`diff`:

- compare `description`, `meter`, `units`, and `rollover`;
- return Noop when equal;
- block type changes with `benefit.type.immutable`;
- otherwise return Update with field-level changes.

`createOperationsFromPlan`:

- Create -> `CreateBenefit`
- Update -> `UpdateBenefit`
- Remove -> `DeleteBenefit`

Create payload:

```ts
{
  type: "meter_credit",
  description,
  metadata: { paac: "..." },
  properties: {
    meterId: Ref("meter.requests", "polarId"),
    units,
    rollover,
  },
}
```

Polar requires the complete `properties` object on update. If any meter-credit
property changes, send all three properties.

Rollback:

- Create: `DeleteBenefit` rollback.
- Update: restore the previous description/properties.
- Delete: `UnsupportedRollback`, because recreating the Benefit would not
  restore revoked grants.

## Product Adapter Changes

Extend `ProductSpec` with:

```ts
readonly benefits: ReadonlyArray<BenefitAddress>;
```

Update:

- config normalization and schemas;
- dependency extraction;
- Product field diffing;
- current Product decoding;
- provider state.

Add `UpdateProductBenefitsAction` whose payload contains resolvable Benefit IDs.

Operation lowering:

- Product create with Benefits:
  1. `CreateProduct`
  2. `UpdateProductBenefits`
- Product update:
  - emit `UpdateProduct` only for ordinary Product field changes;
  - emit `UpdateProductBenefits` only when attachments change;
  - emit both in that order when both changed.
- Product archive remains one `ArchiveProduct` operation.

The operation graph already supports multiple ordered operations per resource.
With dependency edges, creation order becomes:

```text
CreateMeter
CreateBenefit
CreateProduct
UpdateProductBenefits
```

Removal order becomes:

```text
ArchiveProduct
DeleteBenefit
ArchiveMeter
```

## Operation and Executor Changes

Add payload types:

- `BenefitCreateOperationPayload`
- `BenefitUpdateOperationPayload`
- `ProductBenefitsUpdateOperationPayload`

Add actions:

- `CreateBenefit`
- `UpdateBenefit`
- `DeleteBenefit`
- `UpdateProductBenefits`

Extend executor dispatch for all four actions. `CreateBenefit` records the
returned Polar ID in resource bindings. Nested Meter and Benefit references are
already supported by recursive ref resolution.

## File-Level Change List

Core planning:

- `src/core/kind.ts`: add `benefit`.
- `src/core/resource.ts`: rename `isArchived` to `isRemoved`.
- `src/planner.ts`: replace Archive nodes with Remove nodes and adapter removal
  modes.
- `src/resource-adapter-registry.ts`: expose removal mode and Remove node types.
- `src/operation-planner.ts`: preserve reverse dependency ordering for Remove.
- `src/operation-planner/types.ts`: use `RemovePlanNode`.
- `src/renderer.ts`: render Archive and Delete distinctly.
- `src/cli.ts`: add `--allow-delete` deployment guard.

Benefit resource:

- Add `src/resources/benefit.ts`.
- Add `src/resources/benefit-adapter.ts`.
- Add `src/operations/payloads/benefit.ts`.
- Register the adapter in `src/resource-adapters.ts`.
- Export Benefit APIs from `src/index.ts`.

Product integration:

- `src/resources/product.ts`: add Benefit references and canonical attachment
  set.
- `src/resources/product-adapter.ts`: dependencies, diffing, attachment
  operations, and rollback.
- `src/operations/payloads/product.ts`: Product Benefit payload.

Polar and execution:

- `src/polar/client.ts`: export remote Benefit type.
- `src/polar/service.ts`: list/create/update/delete Benefits.
- `src/remote-resource-fetcher.ts`: decode Benefits and Product attachments.
- `src/operations/actions.ts`: new actions.
- `src/executor.ts`: dispatch new actions.

Documentation:

- Update `CONTEXT.md` with Benefit terminology.
- Add an ADR for generic Remove semantics.
- Update operation/executor design docs from Archive-only terminology.
- Extend `paac.config.ts` with the public API example.

## Test Plan

Benefit resource tests:

- instance and address references normalize to `meter.*`;
- defaults `rollover` to false;
- validates description and units;
- produces canonical `BenefitSpec`.

Benefit adapter tests:

- Meter dependency;
- create/update/delete payloads and refs;
- field-level diff and Noop;
- blocked type change;
- create/update/delete rollback behavior.

Product tests:

- Benefit references normalize, deduplicate, and sort;
- Product dependencies include Benefits and metered-price Meters;
- attachment-only changes produce Product Update;
- create/update operation sequences and rollback payloads;
- unmanaged attached Benefit diagnostic.

Planner tests:

- create ordering: Meter -> Benefit -> Product;
- removal ordering: Product -> Benefit -> Meter;
- missing Meter blocks Benefit;
- missing Benefit blocks Product;
- dependency cycles remain diagnosed.

Operation planner tests:

- plans Benefit create/update/delete actions from adapter diffs;
- preserves dependency order for creates and reverse dependency order for removals;
- treats Product Benefit attachment changes as Product update operations;
- propagates missing-reference diagnostics from Benefit and Product adapters;
- keeps Noop decisions out of executable operation sequences.

Remote fetcher tests:

- meter-credit decode;
- Product attachment decode;
- deleted Benefits are skipped as already removed;
- unknown Meter, unsupported Benefit type, malformed metadata, and unmanaged
  Product attachment behavior.

Executor tests:

- all new Polar client dispatch paths;
- nested ref resolution for Benefit Meter and Product Benefit IDs;
- rollback ordering across the three-resource chain.

Renderer/CLI tests:

- delete-mode removals are visibly destructive;
- deploy blocks deletion without `--allow-delete`.

## Implementation Order

1. [x] Generalize Archive to Remove and add deletion safety.
2. Add Benefit domain types, schemas, exports, and adapter registration.
3. Add Polar Benefit client methods and operation actions.
4. Add remote Benefit decoding.
5. Add Product Benefit attachment modeling and operations.
6. Add planner/executor/renderer integration tests.
7. Update documentation.
