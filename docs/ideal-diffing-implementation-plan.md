# Ideal PAAC Diffing Architecture Plan

PAAC is intended to be "Polar as code": a user declares Polar payment infrastructure in TypeScript, runs `paac plan` to preview changes, and runs `paac deploy` to reconcile Polar with that desired configuration.

This document describes the ideal diffing and planning architecture as if the current ad hoc `Product`-only diff did not exist. The design is intentionally extensible to future Polar resources: products, keyed product prices, meters, benefits, discounts, files/media, product-benefit attachments, checkout links, custom fields, and any other Polar resource that can be managed safely.

## Goals

1. Support many Polar resource kinds without rewriting the diff engine.
2. Separate generic reconciliation from Polar-specific API details.
3. Diff stable canonical resource snapshots, not raw SDK objects.
4. Encode field-level semantics: updateable, immutable, replace-only, ignored, computed, or unsafe.
5. Model relationships as a resource graph so operations can be ordered safely.
6. Produce a plan that is both human-readable and machine-executable.
7. Be conservative around payment infrastructure: block unsafe or ambiguous operations instead of guessing.
8. Keep metadata-based ownership as the primary remote identity mechanism.
9. Leave room for imports, renames, state snapshots, drift detection, and provider migrations.

## Non-goals for the first implementation

The architecture should allow these later, but the first refactor does not need to implement or decide every resource-specific policy:

- Full coverage of every Polar API resource.
- Automatic migration of unsupported remote resource shapes.
- Cross-provider support beyond Polar.
- Complex state backend or remote state locking.
- Perfect semantic equivalence for all Polar filters/aggregations.

## Problems with the current diffing approach

The current implementation is useful as a prototype, but should not become the long-term foundation.

Current behavior:

- Accepts desired products and remote products only.
- Filters remote resources by PAAC metadata.
- Matches by address.
- Builds hand-written comparable product objects.
- Compares a small fixed field list.
- Special-cases only the first price.
- Emits product-specific actions.
- Executor directly switches on product action types.

Limitations:

- Adding `Meter`, `Benefit`, `Discount`, etc. would duplicate planner logic.
- Resource relationships are not represented.
- It cannot safely express replacement, blocked changes, partial support, imports, or renames.
- SDK payload shape and canonical diff shape are mixed together.
- Price handling is too simplistic for Polar's pricing model.
- Unsupported remote states can be silently normalized into incorrect comparable values.

The replacement should be a resource reconciliation engine, not a larger product diff function.

---

# Architecture overview

The ideal flow:

```txt
User config
  -> desired resource registry
  -> desired resource graph
  -> provider adapters normalize desired resources
  -> Polar remote resources are fetched
  -> provider adapters identify managed remotes
  -> remote resource graph
  -> generic matcher pairs desired and remote resources
  -> generic canonical diff engine computes field/resource diffs
  -> adapters convert diffs into provider operations
  -> dependency graph orders operations
  -> plan renderer displays changes
  -> executor applies operations
```

Core concept split:

| Layer | Responsibility |
| --- | --- |
| Public resource API | User-facing `new Product(...)`, `new Meter(...)`, etc. |
| Desired graph builder | Converts registered resources into plain desired resources and edges. |
| Provider adapters | Know how to list, identify, normalize, create, update, archive/delete each Polar resource kind. |
| Canonical diff engine | Generic JSON/object diff over normalized managed data. |
| Field semantics | Knows whether each path is updateable, create-only, replace-only, ignored, computed, or blocked. |
| Planner | Matches desired/remotes and creates `ResourceChange`s. |
| Operation planner | Converts resource changes into Polar API operations. |
| Graph scheduler | Orders operations by dependencies. |
| Renderer | Human-readable plan output. |
| Executor | Executes generic provider operations. |

---

# Core data model

## Address

Every managed PAAC resource has a stable address.

Examples:

```txt
product.pro
meter.apiRequests
benefit.proCredits
discount.launch
file.logo
productBenefitAttachment.product.pro.benefit.proCredits
```

Addresses should be:

- globally unique within the Polar Organization selected by provider configuration and active Polar credentials
- stable across deploys
- independent of Polar IDs
- safe to store in metadata
- usable in config references
- formed as `{kind}.{key}`

Resource keys should be user-chosen stable identifiers constrained to:

```txt
[a-zA-Z][a-zA-Z0-9_-]*
```

Recommended type:

```ts
export type ResourceAddress = `${string}.${string}`;
```

Long-term, use a parser instead of raw strings:

```ts
export type ParsedAddress = {
  readonly kind: string;
  readonly key: string;
};
```

Renaming an address should be treated as archive/delete plus create until explicit moves/imports exist.

## Managed identity metadata

Polar metadata should remain the primary ownership and identity mechanism.

Recommended metadata shape:

```json
{
  "paac": "{\"v\":1,\"kind\":\"product\",\"addr\":\"product.pro\",\"key\":\"pro\"}"
}
```

Use single-key JSON rather than flat metadata keys. This consumes fewer Polar metadata keys and gives PAAC one versioned envelope to evolve, at the cost of being slightly less inspectable in the Polar UI.

Recommended interface:

```ts
export type ManagedIdentity = {
  readonly version: 1;
  readonly kind: string;
  readonly address: ResourceAddress;
  readonly key: string;
};
```

Utility functions:

```ts
export const encodePaacMetadata = (identity: ManagedIdentity): Record<string, string | number | boolean>;
export const decodePaacMetadata = (metadata: unknown): ManagedIdentity | undefined;
```

The planner must detect:

- malformed PAAC metadata
- duplicate remote identities
- remote kind/address mismatches

## Desired resource

Desired resources are plain data produced from the public API. They are not SDK payloads.

```ts
export type DesiredResource = {
  readonly kind: string;
  readonly key: string;
  readonly address: ResourceAddress;
  readonly config: unknown;
  readonly dependencies: ReadonlyArray<ResourceAddress>;
};
```

Example product desired resource:

```ts
{
  kind: "product",
  key: "pro",
  address: "product.pro",
  config: {
    name: "Pro plan",
    description: "For serious users",
    billing: { type: "recurring", interval: "month", intervalCount: 1 },
    prices: [{ key: "base", type: "fixed", amount: 2000, currency: "usd" }],
    benefits: [ref("benefit.proCredits")]
  },
  dependencies: ["benefit.proCredits"]
}
```

## Canonical resource

The diff engine compares canonical resources.

```ts
export type CanonicalResource = {
  readonly kind: string;
  readonly address: ResourceAddress;
  readonly provider: "polar";
  readonly providerId?: string;
  readonly managed: JsonObject;
  readonly metadata: ManagedIdentity;
  readonly raw?: unknown;
};
```

`managed` contains only fields PAAC intends to own. PAAC ownership is field-scoped within a PAAC-managed resource: manual changes to managed fields are drift and should be reconciled, while unmanaged fields should be left alone unless they make a managed field unsafe to compare or update.

It must not include:

- timestamps
- server-computed fields
- Polar IDs except where the user explicitly references imported resources
- remote-only stats
- display-only expanded objects
- unmanaged metadata

## JSON value model

Use an explicit JSON type instead of `unknown` for canonical data.

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonArray = ReadonlyArray<JsonValue>;
```

---

# Resource adapter interface

Each resource kind has an adapter.

```ts
export type ResourceAdapter<Desired = unknown, Remote = unknown> = {
  readonly kind: string;

  readonly listRemote: () => Effect.Effect<ReadonlyArray<Remote>, ProviderError>;

  readonly getRemoteIdentity: (remote: Remote) => ManagedIdentity | undefined;

  readonly normalizeDesired: (
    desired: DesiredResource,
    context: NormalizeContext,
  ) => Effect.Effect<CanonicalResource, Diagnostic>;

  readonly normalizeRemote: (
    remote: Remote,
    context: NormalizeContext,
  ) => Effect.Effect<CanonicalResource, Diagnostic>;

  readonly fieldSemantics: FieldSemantics;

  readonly planCreate: (
    resource: CanonicalResource,
    context: OperationContext,
  ) => Effect.Effect<ReadonlyArray<Operation>, Diagnostic>;

  readonly planUpdate: (
    change: ResourceChange,
    context: OperationContext,
  ) => Effect.Effect<ReadonlyArray<Operation>, Diagnostic>;

  readonly planDelete: (
    resource: CanonicalResource,
    context: OperationContext,
  ) => Effect.Effect<ReadonlyArray<Operation>, Diagnostic>;
};
```

The generic planner should not know how Polar products, meters, or benefits work. It only calls adapter methods.

## Adapter registry

```ts
export type AdapterRegistry = {
  readonly get: (kind: string) => ResourceAdapter | undefined;
  readonly all: () => ReadonlyArray<ResourceAdapter>;
};
```

Initial registry:

```ts
registerPolarAdapter(productAdapter);
```

Future registry:

```ts
registerPolarAdapter(productAdapter);
registerPolarAdapter(meterAdapter);
registerPolarAdapter(benefitAdapter);
registerPolarAdapter(discountAdapter);
registerPolarAdapter(fileAdapter);
registerPolarAdapter(productBenefitAttachmentAdapter);
```

---

# Canonicalization rules

Canonicalization is where provider quirks are handled.

## General rules

1. Normalize field names to PAAC's canonical names, not Polar SDK names.
2. Normalize defaults explicitly.
3. Convert `undefined` to absent or `null` consistently.
4. Sort maps and unordered arrays deterministically.
5. Do not include server-generated fields.
6. Do not include unmanaged metadata.
7. Preserve enough remote information to plan safe updates.
8. Emit diagnostics for unsupported remote shapes instead of silently approximating.

## Example product canonical shape

```ts
export type CanonicalProduct = {
  readonly name: string;
  readonly description: string | null;
  readonly visibility: "draft" | "private" | "public";
  readonly billing: {
    readonly type: "oneTime" | "recurring";
    readonly recurringInterval: "day" | "week" | "month" | "year" | null;
    readonly recurringIntervalCount: number | null;
  };
  readonly prices: ReadonlyArray<CanonicalProductPrice>;
  readonly media: ReadonlyArray<ResourceAddress>;
  readonly customFields: ReadonlyArray<ResourceAddress>;
};
```

Product Prices are nested managed parts of a Product, not top-level PAAC resources. They should have stable keys within the Product for matching and diffing.

```ts
export type CanonicalProductPrice =
  | {
      readonly key: string;
      readonly type: "fixed";
      readonly amount: number;
      readonly currency: string;
    }
  | {
      readonly key: string;
      readonly type: "free";
      readonly currency: string;
    }
  | {
      readonly key: string;
      readonly type: "custom";
      readonly currency: string;
      readonly minimumAmount: number;
      readonly maximumAmount: number | null;
      readonly presetAmount: number | null;
    }
  | {
      readonly key: string;
      readonly type: "meteredUnit";
      readonly meter: ResourceAddress;
      readonly unitAmount: string;
      readonly currency: string;
      readonly capAmount: number | null;
    }
  | {
      readonly key: string;
      readonly type: "seatBased";
      readonly currency: string;
      readonly tiers: ReadonlyArray<unknown>;
    };
```

First implementation should support one static Product Price: fixed, free, or custom. Metered and seat-based Product Prices are deferred, but the canonical shape should already be a keyed list.

Unsupported remote fields outside PAAC's managed surface should usually be ignored or reported as warnings. Unsupported remote shapes inside PAAC's managed surface should produce error diagnostics and block deploy rather than being normalized into guessed values.

## Remote unsupported-state example

Bad current-style behavior:

```ts
remote.prices[0]?.priceAmount ?? 0
```

Ideal behavior:

```txt
Diagnostic: product.pro has unsupported remote pricing shape.
Remote has 3 prices, but this PAAC version only supports one managed static Product Price.
This resource cannot be safely diffed. Import it with explicit price keys or mark prices as unmanaged.
```

---

# Field semantics

A plain deep diff says fields differ. PAAC must also know what that difference means operationally.

```ts
export type FieldRule =
  | { readonly mode: "update" }
  | { readonly mode: "replace" }
  | { readonly mode: "createOnly" }
  | { readonly mode: "ignore" }
  | { readonly mode: "computed" }
  | { readonly mode: "manual"; readonly reason: string }
  | { readonly mode: "custom"; readonly handler: string };

export type FieldSemantics = ReadonlyArray<{
  readonly path: string; // JSON pointer or glob-like path
  readonly rule: FieldRule;
}>;
```

Examples for products:

```ts
const productFieldSemantics: FieldSemantics = [
  { path: "/name", rule: { mode: "update" } },
  { path: "/description", rule: { mode: "update" } },
  { path: "/visibility", rule: { mode: "update" } },
  { path: "/billing/recurringInterval", rule: { mode: "createOnly" } },
  { path: "/billing/recurringIntervalCount", rule: { mode: "createOnly" } },
  { path: "/prices", rule: { mode: "custom", handler: "productPrices" } },
  { path: "/media", rule: { mode: "custom", handler: "productMedia" } },
  { path: "/customFields", rule: { mode: "custom", handler: "productCustomFields" } }
];
```

Examples for meters:

```ts
const meterFieldSemantics: FieldSemantics = [
  { path: "/name", rule: { mode: "update" } },
  { path: "/unit", rule: { mode: "update" } },
  { path: "/customLabel", rule: { mode: "update" } },
  { path: "/customMultiplier", rule: { mode: "update" } },
  { path: "/filter", rule: { mode: "update" } },
  { path: "/aggregation", rule: { mode: "update" } }
];
```

## Resource action classification

Diffs are classified into resource-level actions:

```ts
export type ResourceAction =
  | "create"
  | "update"
  | "replace"
  | "archive"
  | "unarchive"
  | "delete"
  | "noop"
  | "blocked";
```

Rules:

- Missing remote + desired exists => `create`
- Remote exists + desired missing => adapter delete policy: `archive`, `delete`, or `blocked`
- No effective field diffs => `noop`
- Any manual/blocked diff => `blocked`
- Any replace diff => `replace`
- Only updateable/custom-update diffs => `update`

For payment resources, default should be conservative:

- products: archive instead of delete
- meters: archive if supported
- benefits: delete only if safe and no active grants, otherwise blocked or configurable
- discounts: delete/archive depending on Polar support and active usage
- product prices: user-facing plans should present Product Price differences as Product changes; provider-specific price lifecycle details belong inside the Product adapter

---

# Diff engine

The generic diff engine compares canonical JSON values and emits field diffs.

```ts
export type FieldDiff = {
  readonly path: string;
  readonly before: JsonValue | undefined;
  readonly after: JsonValue | undefined;
  readonly change: "added" | "removed" | "changed";
  readonly rule: FieldRule;
};
```

Requirements:

1. Stable output order.
2. JSON pointer paths.
3. Object key sorting.
4. Array handling configurable by path:
   - ordered arrays
   - unordered arrays
   - keyed arrays
5. Optional custom equivalence functions.
6. Ability to ignore fields.
7. Ability to treat missing and default-equivalent values as equal.

## Keyed array diffing

Polar resources often have arrays that should not be compared by index.

Examples:

- product prices
- product benefits
- media files
- custom fields
- discount products

The diff engine should support keyed arrays:

```ts
export type ArrayRule =
  | { readonly mode: "ordered" }
  | { readonly mode: "unordered" }
  | { readonly mode: "keyed"; readonly key: string };
```

Product prices example:

```ts
{
  path: "/prices",
  array: { mode: "keyed", key: "key" }
}
```

This produces paths like:

```txt
/prices/base/amount
/prices/base/currency
/prices/usage/unitAmount
```

---

# Plan model

The plan should represent resource changes and provider operations separately.

```ts
export type Plan = {
  readonly provider: "polar";
  readonly changes: ReadonlyArray<ResourceChange>;
  readonly operations: ReadonlyArray<Operation>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly summary: PlanSummary;
};
```

```ts
export type ResourceChange = {
  readonly address: ResourceAddress;
  readonly kind: string;
  readonly providerId?: string;
  readonly action: ResourceAction;
  readonly before?: CanonicalResource;
  readonly after?: CanonicalResource;
  readonly diffs: ReadonlyArray<FieldDiff>;
  readonly operations: ReadonlyArray<OperationId>;
  readonly dependsOn: ReadonlyArray<ResourceAddress>;
};
```

```ts
export type Operation = {
  readonly id: OperationId;
  readonly provider: "polar";
  readonly kind: string;
  readonly address: ResourceAddress;
  readonly action: "create" | "update" | "replace" | "archive" | "unarchive" | "delete" | "read";
  readonly call: string; // e.g. "products.create", "meters.update"
  readonly input: JsonObject; // full provider-client method input; for Polar this is SDK-shaped camelCase data
  readonly dependsOn: ReadonlyArray<OperationId>;
  readonly preview: OperationPreview;
};
```

```ts
export type OperationPreview = {
  readonly title: string;
  readonly lines: ReadonlyArray<string>;
};
```

## Diagnostics

```ts
export type Diagnostic = {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly address?: ResourceAddress;
  readonly path?: string;
  readonly hint?: string;
};
```

Examples:

```txt
error PAAC_DUPLICATE_DESIRED_ADDRESS product.pro
Two desired resources have the same address.
```

```txt
error PAAC_UNSUPPORTED_REMOTE_SHAPE product.pro /prices
Remote product has multiple prices but this adapter only supports one static Product Price.
```

Remote resources without PAAC metadata are unmanaged and ignored silently.

A plan with error diagnostics should not deploy. `paac plan` should still render the diagnostics and exit non-zero. `paac deploy` should render the diagnostics, refuse execution, and exit non-zero; the executor should also refuse error plans as a safety backstop.

---

# Dependency graph

PAAC should model dependencies explicitly.

Examples:

- Product with metered price depends on Meter.
- Benefit meter credit depends on Meter.
- Product-benefit attachment depends on Product and Benefit.
- Discount scoped to products depends on Products.
- Product media depends on File.

```ts
export type ResourceEdge = {
  readonly from: ResourceAddress;
  readonly to: ResourceAddress;
  readonly reason: string;
};
```

Create/update ordering:

```txt
meter.requests
benefit.proCredits
product.pro
productBenefitAttachment.product.pro.benefit.proCredits
discount.launch
```

Delete/archive ordering should reverse dependent edges:

```txt
discount.launch
productBenefitAttachment.product.pro.benefit.proCredits
product.pro
benefit.proCredits
meter.requests
```

The planner should detect cycles and fail with a useful diagnostic.

---

# Relationship resources

Relationships should often be first-class internal resources rather than hidden fields.

## Product benefit attachment

Polar exposes product benefit assignment separately:

```txt
POST /v1/products/{id}/benefits
```

Instead of treating benefits as a nested product field only, create internal relationship resources:

```txt
productBenefitAttachment.product.pro.benefit.proCredits
```

Canonical shape:

```ts
{
  product: "product.pro",
  benefit: "benefit.proCredits"
}
```

Operations:

- create/update attachment by calling product benefits endpoint with complete desired benefit ID list
- delete attachment by removing benefit from product's desired benefit list

The adapter can batch multiple attachment changes per product into a single Polar call.

## Discount product scoping

Discounts can reference products. This can be either:

1. a field on `discount.launch`, or
2. relationship resources like `discountProduct.discount.launch.product.pro`

Use field-based modeling first if Polar update requires the full product list. Use relationship resources if independent lifecycle is useful.

---

# Operation planning

Adapters convert resource changes into provider operations.

## Product create

Desired canonical product -> Polar product create payload.

Important details:

- Add PAAC metadata.
- Resolve resource references to Polar IDs.
- Convert canonical field names to SDK/API field names.
- Include only supported fields.
- Do not take organization ID from the Product declaration; if Polar requires one, resolve it from provider/client configuration.

Operation:

```ts
{
  call: "products.create",
  input: {
    name: "Pro plan",
    description: null,
    visibility: "public",
    recurringInterval: "month",
    recurringIntervalCount: 1,
    prices: [
      {
        amountType: "fixed",
        priceAmount: 2000,
        priceCurrency: "usd"
      }
    ],
    metadata: encodePaacMetadata(...)
  }
}
```

## Product update

Only include updateable fields in the payload.

Avoid always sending the full desired create payload. Full updates can accidentally remove remote provider data or cause immutable-field failures.

Good:

```ts
{
  name: "Pro plan",
  visibility: "private"
}
```

Risky:

```ts
{
  name,
  description,
  visibility,
  recurringInterval,
  recurringIntervalCount,
  prices
}
```

## Product Price changes

Product Prices are declared as part of Products in PAAC's user-facing model. Plans should present Product Price differences as Product changes, not as detached price lifecycle operations.

Provider adapters may need to use provider-specific payload rules internally. For Polar, updating a static Product Price means sending a Product update with the desired `prices` list; updating other Product fields should omit `prices` unless PAAC intends to change them.

Ideal behavior:

1. Canonical Product Prices have PAAC keys scoped to their Product.
2. Remote Product Prices can be matched to desired Product Price keys.
3. Unchanged Product Prices are not included in Product update payloads unless the provider requires it for a deliberate Product Price change.
4. Product Price changes are rendered as Product field changes, with pricing changes visually distinguished from low-risk fields such as description.
5. The plan must not expose provider-specific Product Price lifecycle details such as price IDs or attachment mechanics.
6. If a remote Product Price cannot be matched to a key, block or mark unmanaged.

First implementation can support one static Product Price and should block unsupported states instead of guessing.

## Delete/archive policy

Each adapter defines its delete policy.

```ts
export type DeletePolicy =
  | { readonly mode: "archive"; readonly call: string }
  | { readonly mode: "delete"; readonly call: string }
  | { readonly mode: "block"; readonly reason: string }
  | { readonly mode: "configurable"; readonly default: "archive" | "delete" | "block" };
```

Recommended defaults:

| Resource | Default missing-desired behavior |
| --- | --- |
| Product | Archive |
| Meter | Archive if supported |
| Benefit | Block or delete only when safe |
| Discount | Delete or deactivate depending on Polar support |
| File | Block if referenced, delete otherwise |
| Attachment | Remove attachment |

A PAAC-managed Product that disappears from desired configuration should be archived automatically. If an Archived Product later reappears at the same Resource Address, PAAC should unarchive/update it when create-only fields still match; create-only differences remain unsafe and must not be silently changed.

---

# Planning algorithm

High-level algorithm:

```ts
export const buildPlan = Effect.fn("Planner.buildPlan")(function* (input: PlanInput) {
  const desiredResources = yield* buildDesiredGraph(input.config);
  const desiredValidation = validateDesiredGraph(desiredResources);

  const remoteByKind = yield* fetchRemoteResources(adapterRegistry);
  const remoteManaged = identifyManagedRemote(remoteByKind);
  const remoteValidation = validateRemoteIdentities(remoteManaged);

  const canonicalDesired = yield* normalizeDesiredResources(desiredResources, adapterRegistry);
  const canonicalRemote = yield* normalizeRemoteResources(remoteManaged, adapterRegistry);

  const matches = matchResources(canonicalDesired, canonicalRemote);

  const resourceChanges = yield* diffMatches(matches, adapterRegistry);
  const operations = yield* planOperations(resourceChanges, adapterRegistry);
  const orderedOperations = yield* orderOperations(operations, desiredResources.edges);

  return assemblePlan({
    changes: resourceChanges,
    operations: orderedOperations,
    diagnostics: [...desiredValidation, ...remoteValidation]
  });
});
```

## Matching rules

1. Desired resource addresses must be unique.
2. Remote managed addresses must be unique.
3. Desired + no remote => create.
4. Desired + matching remote => compare.
5. Remote + no desired => delete/archive/block according to adapter policy.
6. Unmanaged remote resource => ignore but optionally warn.

## Duplicate remote handling

If two Polar resources have the same PAAC address in metadata, do not choose one.

Plan diagnostic:

```txt
error PAAC_DUPLICATE_REMOTE_ADDRESS product.pro
Found multiple Polar product resources claiming PAAC address product.pro.
Resolve manually before deploying.
```

## Rename handling

Without state, renaming a resource address looks like delete + create.

Support explicit moves:

```ts
moved("product.old", "product.pro");
```

The planner should then treat the remote with old address as the same resource and update metadata.

Move operation:

```txt
~ move product.old -> product.pro
  metadata.paac.addr: "product.old" -> "product.pro"
```

First implementation can skip moves, but the plan model should allow them later.

---

# State file

Metadata should remain primary. A state file is optional and useful for better UX.

Possible state file:

```json
{
  "version": 1,
  "provider": "polar",
  "resources": {
    "product.pro": {
      "kind": "product",
      "providerId": "...",
      "lastAppliedHash": "...",
      "lastAppliedManaged": {}
    }
  },
  "moves": [
    { "from": "product.old", "to": "product.pro" }
  ]
}
```

Uses:

- detect drift since last deploy
- help with renames
- recover from metadata issues
- cache provider IDs
- improve import/migration flows

Do not require state for basic operation.

---

# Renderer design

The renderer should consume generic `Plan`, not resource-specific actions.

Example output:

```txt
PAAC plan

+ product.pro
  create Polar product
  name: "Pro plan"
  price[base]: 2000 usd fixed
  billing: recurring month x 1

~ meter.apiRequests (meter-id)
  /name: "API Calls" -> "API Requests"
  /filter: {"event":"api_call"} -> {"event":"api_request"}

~ product.pro (product-id)
  ! /prices/base/amount: 2000 -> 2500

! product.enterprise blocked
  /billing/recurringInterval: "month" -> "year"
  Polar may not allow changing recurring interval after creation.

- product.legacy (product-id)
  archive Polar product

Plan: 1 to create, 1 to update, 1 to archive, 1 blocked, 0 unchanged.
No changes were applied.
```

The default human renderer should group output by `ResourceChange`, not operation order. Operations are execution details and should appear only in JSON, verbose, or explain modes. No-op resources should remain in the machine-readable `Plan` but be hidden by default in human output.

Renderer modes:

- summary
- detailed
- JSON output
- CI-friendly output
- explain a single resource

CLI examples:

```bash
paac plan
paac plan --json
paac plan --show-unchanged
paac plan --target product.pro
paac deploy
paac deploy --auto-approve
```

---

# Executor design

The executor should execute generic operations, not product-specific actions.

```ts
export type OperationExecutor = {
  readonly canExecute: (operation: Operation) => boolean;
  readonly execute: (operation: Operation) => Effect.Effect<OperationResult, ProviderError>;
};
```

Operations should be serializable data, not executable closures. `Operation.input` should be the full provider-client method input. For Polar, this means Polar SDK-shaped camelCase data, including wrapper parameters such as `id` and `productUpdate`.

Polar operation executor routes by `operation.call`:

```ts
switch (operation.call) {
  case "products.create":
    return polar.products.create(operation.input);
  case "products.update":
    return polar.products.update(operation.input);
  case "products.archive":
    return polar.products.update(operation.input);
}
```

Requirements:

1. Refuse to execute plans with error diagnostics.
2. Execute operations in dependency order.
3. Stop on first failure by default.
4. Support concurrency only for independent operations.
5. Record results for subsequent operations that need provider IDs.
6. Print clear failure context.
7. Leave room to write/update state later, but do not read or write state in the first implementation.

## Provider ID resolution

Some operations need IDs produced by earlier operations.

Use placeholders in operation input:

```ts
{
  productId: { ref: "product.pro" },
  benefitIds: [{ ref: "benefit.proCredits" }]
}
```

Before execution, resolve refs from:

1. current remote matches
2. operation results from earlier creates
3. future state file imports

---

# Product adapter first milestone

The first adapter should implement Product support on the generic architecture. Existing prototype APIs and payload types may be changed where needed.

## Product price helper API

Use explicit price helpers in user configuration. Helper amounts are major currency units; canonical data and Polar SDK payloads use minor units.

```ts
new Product("pro", {
  name: "Pro plan",
  price: fixedPrice({ amount: 20, currency: "usd" })
});

new Product("free", {
  name: "Free plan",
  price: freePrice({ currency: "usd" })
});

new Product("supporter", {
  name: "Supporter",
  price: customPrice({
    currency: "usd",
    minimumAmount: 0,
    maximumAmount: null,
    presetAmount: 5
  })
});
```

## Supported product fields initially

- name
- description
- visibility
- recurring interval on create
- recurring interval count on create
- one static Product Price: fixed, free, or custom
- currency where required by the Product Price type
- organization ID on create only when resolved from provider/client configuration
- PAAC metadata
- archive when missing from desired
- unarchive an existing archived Product when it reappears in desired configuration and create-only fields still match

## Explicit unsupported product fields initially

- multiple prices
- metered/seat-based prices
- media files
- attached custom fields
- product benefit attachments
- trial fields
- price tax behavior unless deliberately supported

Unsupported fields should produce warnings or errors depending on whether they affect managed fields.

## First product canonical shape

```ts
type ProductManagedV1 = {
  readonly name: string;
  readonly description: string | null;
  readonly visibility: "draft" | "private" | "public";
  readonly billing: {
    readonly recurringInterval: "day" | "week" | "month" | "year" | null;
    readonly recurringIntervalCount: number | null;
  };
  readonly prices: ReadonlyArray<
    | { readonly key: "base"; readonly type: "fixed"; readonly amount: number; readonly currency: string }
    | { readonly key: "base"; readonly type: "free"; readonly currency: string }
    | {
        readonly key: "base";
        readonly type: "custom";
        readonly currency: string;
        readonly minimumAmount: number;
        readonly maximumAmount: number | null;
        readonly presetAmount: number | null;
      }
  >;
};
```

Represent Product Prices as keyed `prices` in v1, even though only the `base` static Product Price key is supported initially.

## Product update payload generation

Given field diffs:

```txt
/name
/description
/visibility
/prices/base/amount
```

Generate only relevant update payload fields. Do not include Product Billing Cadence fields in update payloads. If Product Billing Cadence differs between desired and remote, emit an error diagnostic and block the plan.

If the static Product Price changed, the Product adapter may include `prices` in the Product update payload. This should remain an adapter detail; the plan should describe the Product Price difference, not provider-specific price attachment mechanics.

---

# Future resource adapters

## Meter

Public API example:

```ts
export const requests = new Meter("requests", {
  name: "API Requests",
  unit: "scalar",
  filter: { event: "api_request" },
  aggregation: { func: "count" }
});
```

Canonical shape:

```ts
{
  name: "API Requests",
  unit: "scalar",
  customLabel: null,
  customMultiplier: null,
  filter: { event: "api_request" },
  aggregation: { func: "count" }
}
```

Default missing-desired action: archive.

## Benefit

Polar benefits are polymorphic:

- custom
- discord
- github_repository
- downloadables
- license_keys
- meter_credit
- feature_flag

Model each as either:

1. one `benefit` adapter with subtypes, or
2. distinct adapters like `benefit.meterCredit`, `benefit.discord`, etc.

Preferred external address:

```txt
benefit.proCredits
```

Canonical shape:

```ts
{
  type: "meter_credit",
  description: "10,000 credits per month",
  properties: {
    meter: "meter.requests",
    units: 10000,
    rollover: false
  }
}
```

Depends on meter when applicable.

## Product-benefit attachment

User-facing API could be nested:

```ts
new Product("pro", {
  benefits: [proCredits]
});
```

Internal graph adds:

```txt
productBenefitAttachment.product.pro.benefit.proCredits
```

## Discount

Public API example:

```ts
new Discount("launch", {
  name: "Launch discount",
  code: "LAUNCH",
  type: "percentage",
  basisPoints: 2500,
  duration: "once",
  products: [pro]
});
```

Canonical shape:

```ts
{
  name: "Launch discount",
  code: "LAUNCH",
  type: "percentage",
  basisPoints: 2500,
  duration: "once",
  durationInMonths: null,
  products: ["product.pro"],
  startsAt: null,
  endsAt: null,
  maxRedemptions: null
}
```

Depends on product references.

---

# Suggested file structure

```txt
src/core/address.ts
src/core/json.ts
src/core/metadata.ts
src/core/diagnostic.ts
src/core/resource.ts
src/core/adapter.ts
src/core/adapter-registry.ts
src/core/canonicalize.ts
src/core/diff.ts
src/core/field-semantics.ts
src/core/matcher.ts
src/core/graph.ts
src/core/plan.ts
src/core/planner.ts
src/core/render.ts
src/core/executor.ts

src/provider/polar/client.ts
src/provider/polar/operation-executor.ts
src/provider/polar/metadata.ts
src/provider/polar/types.ts

src/provider/polar/resources/product/adapter.ts
src/provider/polar/resources/product/canonical.ts
src/provider/polar/resources/product/operations.ts
src/provider/polar/resources/product/schema.ts

src/provider/polar/resources/meter/adapter.ts
src/provider/polar/resources/benefit/adapter.ts
src/provider/polar/resources/discount/adapter.ts

src/resources/product.ts
src/resources/meter.ts
src/resources/benefit.ts
src/resources/discount.ts
src/resources/registry.ts

src/cli.ts
src/config/load.ts
```

Keep public user resources under `src/resources/*`. Keep provider implementation under `src/provider/polar/*`. Keep generic planning under `src/core/*`.

---

# Migration plan from current implementation

Because PAAC is prerelease, existing prototype internals are movable when they block the production-ready architecture. Prefer direct replacement over compatibility bridges; do not preserve product-specific types such as `PlanAction` once the generic plan model exists. See [ADR 0001](./adr/0001-full-replacement-over-compatibility-bridges.md).

## Phase 1: Introduce core types and generic plan model

Add:

- `core/json.ts`
- `core/address.ts`
- `core/metadata.ts`
- `core/diagnostic.ts`
- `core/plan.ts`
- `core/adapter.ts`

Replace `PlanAction` boundaries with the generic `Plan`, `ResourceChange`, `Operation`, and `Diagnostic` model as part of the first refactor rather than adapting back to product-specific actions.

Deliverable:

- Type definitions compile.
- Metadata encode/decode tests pass.
- `PlanBuilder`, `PlanRenderer`, and `PlanExecutor` speak generic plan types.

## Phase 2: Build generic diff engine

Add:

- canonical JSON deep diff
- field semantics resolver
- keyed array support, at least designed
- resource action classifier

Deliverable:

- Unit tests for scalar diff, object diff, ignored paths, blocked paths, keyed arrays.

## Phase 3: Implement product adapter V1

Move product-specific logic out of `src/plan/diff.ts` into a product adapter.

Adapter supports current product feature set:

- desired normalization
- remote normalization
- create operation planning
- update operation planning
- archive operation planning

Deliverable:

- `paac plan` output should be equivalent or better than current output.
- Unsupported product price shapes produce diagnostics.

## Phase 4: Wire CLI to generic plan execution

Update CLI commands to render and execute the generic `Plan` end-to-end.

Deliverable:

- `plan` renders from generic `Plan`.
- `deploy` executes generic operations.

## Phase 5: Add graph/dependency support

Add:

- desired graph builder
- dependency edge validation
- topological sort
- cycle diagnostics
- operation dependencies

Deliverable:

- Product-only graph still works.
- Tests cover ordering and cycles.

## Phase 6: Add second resource type: Meter

Meter is a good second adapter because products will eventually depend on meters for usage pricing.

Deliverable:

- `new Meter(...)`
- list/create/update/archive meters
- generic planner handles products and meters with no planner changes

## Phase 7: Add benefits and product-benefit attachments

Deliverable:

- create/update/delete benefits
- product benefit assignment operations
- dependency ordering: benefit before product attachment

## Phase 8: Add discounts

Deliverable:

- discounts can reference products
- dependency ordering works
- product scoped discounts resolve product IDs safely

## Phase 9: Add state/import/rename support

Deliverable:

- `paac import product.pro <polar-id>`
- `moved("product.old", "product.pro")`
- optional state file with last-applied snapshot

---

# Testing strategy

## Unit tests

- Metadata encode/decode.
- Address parsing and validation.
- Desired duplicate detection.
- Remote duplicate detection.
- Canonical JSON equality.
- Deep diff.
- Field semantics resolution.
- Keyed array diffing.
- Resource action classification.
- Topological sorting.
- Cycle detection.

## Adapter tests

For each adapter:

- desired config -> canonical resource
- remote SDK object -> canonical resource
- unsupported remote shape -> diagnostic
- create resource -> operation
- updateable field diff -> update operation
- blocked field diff -> blocked plan
- missing desired remote -> archive/delete/block operation

## Golden plan tests

Given desired config and remote fixtures, assert rendered output.

Examples:

- create product
- update product name
- archive missing product
- no-op product
- blocked recurring interval change
- unsupported multiple prices
- duplicate remote metadata

## Executor tests

Use a fake Polar operation executor.

- operations execute in dependency order
- independent operations can execute concurrently later
- failed operation stops deploy
- later operations can resolve IDs created by earlier operations

---

# Safety rules

1. Never mutate unmanaged Polar resources.
2. Never silently choose between duplicate managed remote resources.
3. Never normalize unsupported remote data into fake defaults.
4. Never deploy a plan with error diagnostics.
5. Never send full update payloads unless required and safe.
6. Prefer archive over hard delete for resources with customer/payment history.
7. Require explicit user confirmation for replacements or destructive changes.
8. Keep remote provider IDs out of user config where possible.
9. Preserve PAAC metadata on update.
10. Treat pricing changes as high-risk until explicitly modeled.

---

# Deferred design questions

These are deliberately out of scope for the first implementation:

- State backend behavior after the first deploy.
- Importing unmanaged resources into PAAC.
- Moving/renaming Resource Addresses without archive/create.
- Explicit unmanaged-field controls such as `ignoreChanges`.

Deferred resource-specific questions:

- Should benefit subtypes be separate adapters or one polymorphic benefit adapter?
- Should product-benefit attachments be visible in plan output as separate resources?
- What should be the default behavior for deleting benefits and discounts?

---

# Recommended immediate next step

Do not extend the current `src/plan/diff.ts` with more product-specific cases.

Instead:

1. Add generic core plan/diff/adapter types.
2. Replace `PlanAction` with generic `Plan`, `ResourceChange`, `Operation`, and `Diagnostic` end-to-end.
3. Implement a Product adapter with v1 PAAC metadata, explicit static Product Price helpers, Product canonicalization, Product operations, archive/unarchive, and blocked cadence changes.
4. Make `PlanBuilder` call the generic planner with only the Product adapter registered.
5. Render plans by resource change, hide no-ops by default, and refuse deploy for error diagnostics.
6. Add tests for metadata, generic diffing, keyed Product Price paths, Product adapter behavior, renderer basics, and executor refusal on error diagnostics.

This keeps the current milestone small while ensuring the next resource type proves the architecture instead of forcing another rewrite.
