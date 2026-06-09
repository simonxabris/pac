# `import` CLI Command Plan

## Goal

Add a top-level `pac import` command that brings existing Polar resources under PAC management.

This command is for a Polar Organization that already has Products, Meters, and Benefits created outside PAC. It should:

1. fetch supported remote Polar resources, including resources that do not have PAC Metadata yet;
2. infer a `pac.config.ts`-style source file that declares equivalent PAC resources;
3. assign Resource Addresses to unmanaged resources;
4. write PAC Metadata back to those remote resources so future `pac plan` / `pac deploy` reconcile the existing Polar resources instead of creating duplicates;
5. verify that the generated config is deploy-safe.

`import` is distinct from the planned future `pull` command:

- `pac pull` does not exist yet. When added, it should recreate config for already Managed Resources only and should not mutate Polar.
- `pac import` adopts unmanaged Polar resources and therefore mutates Polar by default.

## Terminology

Use the language from `CONTEXT.md`:

- **Polar Organization**: the selected remote ownership boundary.
- **Managed Resource**: a Polar resource with PAC Metadata.
- **PAC Metadata**: the `metadata.pac` JSON string identifying PAC ownership and Resource Address.
- **Resource Address**: stable PAC identity such as `product.pro`.
- **Product Price**: part of a Product, not a standalone PAC resource.

Avoid describing imported resources as being matched by Polar ID in user-facing messages. Polar IDs are provider state, while Resource Addresses are PAC identity.

## CLI Shape

Initial command:

```bash
pac import --path pac.config.ts
```

Recommended flags:

```bash
pac import --path pac.config.ts --overwrite
pac import --path pac.config.ts --dry-run
pac import --path pac.config.ts --skip-unsupported
pac import --path pac.config.ts --force
```

### Flags

#### `--path`

Output path for the generated config file.

Default:

```bash
pac.config.ts
```

Unlike `generate`, this command should treat the path as a file path by default, because the output is specifically a config file.

#### `--overwrite`

Allow replacing an existing file.

Without this flag, `import` should fail if the target file already exists.

#### `--dry-run`

Preview the generated config and adoption plan without writing the file or mutating Polar.

Behavior:

- print the full generated config to stdout;
- print a concise resource summary;
- list which resources would receive PAC Metadata;
- do not write the file;
- do not mutate Polar.

Do not add a separate `--stdout` flag for the initial version. `--dry-run` is the read-only path and should show the generated config directly.

#### `--skip-unsupported`

Skip unsupported remote resources instead of failing the whole import.

Default should be fail-fast, because silently omitting a Product, Benefit, or Meter can produce a config that does not accurately represent the Polar Organization.

When `--skip-unsupported` is used:

- unsupported resources must not appear in the generated config;
- supported resources should still be generated when they can be represented faithfully;
- the CLI must print a warning listing every skipped resource and the reason it was skipped;
- any otherwise-supported resource that depends on a skipped unsupported resource should either be skipped with its own warning or fail if skipping it would make adoption unsafe.

Example: if a Product has an attached Benefit type PAC cannot represent, importing the Product while omitting that Benefit would make PAC's Product Benefit Attachment differ from Polar. In that case, the Product should be treated as not faithfully importable unless the implementation has a safe explicit strategy for preserving that attachment.

#### `--force`

Allow overwriting conflicting existing PAC Metadata.

Default should refuse conflicts.

A conflict means the remote resource already has `metadata.pac`, but it points to an address/key/kind that does not match the address the import process would assign.

## High-Level Flow

```text
pac import
  -> fetch raw Polar inventory
  -> classify supported resources
  -> generate/preserve Resource Addresses
  -> resolve relationships
  -> project remote resources to PAC specs
  -> render pac.config.ts
  -> write file unless --dry-run
  -> write PAC Metadata unless --dry-run
  -> fetch managed resources through normal RemoteResourceFetcher
  -> load generated config
  -> run Planner
  -> assert plan is up to date
```

## Detailed Flow

### 1. Fetch raw Polar inventory

Do not add a separate inventory-fetching service. Extend the existing `RemoteResourceFetcher` service with a second method that fetches raw Polar inventory without filtering by PAC Metadata.

Keep the existing `fetch()` method for current `plan`, `deploy`, and `generate` behavior. That method should continue returning only Managed Resources:

```ts
class RemoteResourceFetcher extends Context.Service<...>() {
  readonly fetch: () => Effect.Effect<RemoteResourceMap, RemoteResourceFetchError | DuplicateRemoteResourceAddress>;
  readonly fetchInventory: () => Effect.Effect<PolarInventory, RemoteResourceFetchError>;
}
```

`fetchInventory()` should call the same existing `PolarClient` methods as `fetch()`:

- `listProducts()`
- `listMeters()`
- `listBenefits()`

This lets `import` reuse the same Polar client wiring, concurrency, and error wrapping already owned by `RemoteResourceFetcher`, while avoiding a second service with nearly identical fetching logic.

Suggested inventory type:

```ts
type PolarInventory = {
  readonly products: ReadonlyArray<RemoteProduct>;
  readonly meters: ReadonlyArray<RemoteMeter>;
  readonly benefits: ReadonlyArray<RemoteBenefit>;
};
```

Implementation detail: factor the shared concurrent list calls into a private helper inside `src/remote-resource-fetcher.ts`, then have both `fetchInventory()` and `fetch()` call it. `fetch()` can continue applying PAC Metadata filtering and decoding on top of that raw inventory.

### 2. Filter / classify resources

By default, import active supported resources only:

- Products where `isArchived === false`
- Meters where `archivedAt == null` / not archived
- Benefits where `isDeleted === false`

Classify each remote resource with `Schema.TaggedUnion`, not a hand-written TypeScript union. Effect v4's `Schema.TaggedUnion` builds `_tag`-discriminated cases and exposes `match`, `guards`, and `isAnyOf` helpers for flow control.

The API shape in Effect v4 is:

```ts
const Shape = Schema.TaggedUnion({
  Circle: { radius: Schema.Number },
  Rectangle: { width: Schema.Number, height: Schema.Number },
});

const area = Shape.match(value, {
  Circle: (circle) => Math.PI * circle.radius ** 2,
  Rectangle: (rectangle) => rectangle.width * rectangle.height,
});
```

Use that pattern for import classification:

```ts
const ImportResourceClassification = Schema.TaggedUnion({
  AlreadyManaged: { identity: ManagedIdentitySchema },
  Unmanaged: {},
  ConflictingMetadata: { reason: Schema.String },
  Unsupported: { reason: Schema.String },
});

type ImportResourceClassification = typeof ImportResourceClassification.Type;
```

Then branch with:

```ts
ImportResourceClassification.match(classification, {
  AlreadyManaged: ({ identity }) => ...,
  Unmanaged: () => ...,
  ConflictingMetadata: ({ reason }) => ...,
  Unsupported: ({ reason }) => ...,
});
```

Already Managed Resources should preserve their Resource Address from PAC Metadata.

Unmanaged resources need generated Resource Addresses.

Unsupported resources should fail unless `--skip-unsupported` is enabled.

### 3. Generate Resource Addresses for unmanaged resources

For each unmanaged supported resource, generate a key and address.

Resource kind mapping:

- Product -> `product.${key}`
- Meter -> `meter.${key}`
- Benefit -> `benefit.${key}`

Suggested base key sources should come from human-readable resource names, not slugs:

- Product: `product.name`
- Meter: `meter.name`
- Benefit: `benefit.description` because the current supported Polar Benefit shapes expose `description` rather than a separate name field

Normalize to kebab-case:

```text
"Pro Plan" -> "pro-plan"
"Included monthly tokens" -> "included-monthly-tokens"
```

Rules:

- lowercase
- trim whitespace
- replace non-alphanumeric runs with `-`
- remove leading/trailing `-`
- if empty, use the resource kind plus a short Polar ID suffix
- de-duplicate within a kind deterministically

Collision strategy should be deterministic. Prefer appending a short stable suffix from the Polar ID over order-dependent counters:

```text
product.pro
product.pro-a1b2c3
```

### 4. Generate TypeScript variable names

Variable names are separate from Resource Address keys.

Examples:

```ts
new Product("pro-plan", ...)
// variable name:
export const productProPlan = new Product("pro-plan", ...);
```

Rules:

- derive camelCase from the key;
- prefix with kind if the result is empty or invalid;
- avoid reserved words;
- de-duplicate across the whole file, not only within a kind.

Use kind prefixes always for clarity and deterministic output, even when there is no collision.

Examples:

```text
meter.tokens -> meterTokens
benefit.included-tokens -> benefitIncludedTokens
product.pro-plan -> productProPlan
```

This makes references unambiguous and avoids output changing later when a new resource creates a cross-kind variable-name collision.

### 5. Resolve relationships

Build lookup tables from Polar IDs to assigned Resource Addresses and generated variable names:

```ts
type ImportReferenceIndex = {
  readonly metersByPolarId: ReadonlyMap<string, PulledMeter>;
  readonly benefitsByPolarId: ReadonlyMap<string, PulledBenefit>;
  readonly productsByPolarId: ReadonlyMap<string, PulledProduct>;
};
```

Relationships to resolve:

- Meter-credit Benefits reference Meters by remote `meterId`.
- Metered Product Prices reference Meters by remote `meterId`.
- Products reference Benefits through their attached benefit IDs.

If a relationship points to an unsupported, skipped, archived, deleted, or otherwise missing resource, fail by default.

With `--skip-unsupported`, skipping relationship targets is risky. Prefer still failing if a supported imported resource would produce an invalid config because of a missing dependency.

### 6. Project remote resources into PAC specs

Do not reuse the full `decodeRemote*Resource` path for import. Import primarily needs to validate and normalize the remote resource **spec**, not construct a full `CurrentResource` from already-present PAC Metadata.

The current code already contains the needed normalization logic inside `src/remote-resource-fetcher.ts`, but it is bundled into functions that produce full Managed Resource shapes:

- `decodeRemoteMeterResource`
- `decodeRemoteBenefitResource`
- `decodeRemoteProductResource`

Refactor that logic into spec-level projection functions and let both `RemoteResourceFetcher` and `import` call those shared functions. This avoids in-memory PAC Metadata injection and avoids forcing import to provide Managed Resource identity before decoding the remote shape.

Suggested shared API:

```ts
type ProductSpecProjectionInput = {
  readonly product: RemoteProduct;
  readonly meterAddressesById: Readonly<Record<string, MeterAddress>>;
  readonly benefitAddressesById: Readonly<Record<string, BenefitAddress>>;
};

type BenefitSpecProjectionInput = {
  readonly benefit: RemoteBenefit;
  readonly meterAddressesById: Readonly<Record<string, MeterAddress>>;
};

const remoteMeterToSpec: (
  meter: RemoteMeter,
) => Effect.Effect<MeterSpec, RemoteResourceProjectionError>;

const remoteBenefitToSpec: (
  input: BenefitSpecProjectionInput,
) => Effect.Effect<BenefitSpec, RemoteResourceProjectionError>;

const remoteProductToSpec: (
  input: ProductSpecProjectionInput,
) => Effect.Effect<ProductSpec, RemoteResourceProjectionError>;
```

Then `RemoteResourceFetcher` becomes responsible for Managed Resource identity:

```ts
const identity = identityForKind("meter", meter.metadata);
const spec = yield * remoteMeterToSpec(meter);

return {
  source: "current",
  kind: "meter",
  key: identity.key,
  address: identity.address,
  polarId: meter.id,
  isRemoved: meter.archivedAt != null,
  spec,
  raw: meter,
};
```

And `import` becomes responsible for generated/adopted identity:

```ts
const identity = assignImportIdentity(remoteMeter);
const spec = yield * remoteMeterToSpec(remoteMeter);

return {
  identity,
  polarId: remoteMeter.id,
  spec,
  raw: remoteMeter,
};
```

The shared spec projection should still reuse existing helper logic where possible:

- price amount conversion helpers such as `polarIntegerMinorUnitAmount` / `polarDecimalMinorUnitAmount`;
- relationship resolution from Polar IDs to PAC Resource Addresses;
- `MeterSpec`, `BenefitSpec`, and `ProductSpec` schemas for validation.

Good candidate module names:

```text
src/remote-resource-projection.ts
src/remote-resource-specs.ts
```

The projection should target the same normalized specs used by desired resources:

- `MeterSpec`
- `BenefitSpec`
- `ProductSpec`

This ensures the generated config can round-trip through `ConfigLoader` and compare cleanly with `RemoteResourceFetcher.fetch()` after adoption.

#### Meters

Map remote Meter fields to `MeterSpec`:

```ts
type MeterSpec = {
  readonly name: string;
  readonly unit: "scalar" | "token" | "custom";
  readonly customLabel: string | null;
  readonly customMultiplier: number | null;
  readonly filter: MeterFilterSpec;
  readonly aggregation: MeterAggregationSpec;
};
```

Render helpers where possible:

```ts
and(eventName("eq", "token_consumed"));
or(metadata("plan", "eq", "pro"), metadata("plan", "eq", "business"));
where("some.property", "eq", "value");
sum("total_tokens");
count();
```

Fallback should render object literals if helper rendering cannot express the shape.

#### Benefits

Supported Benefit types initially:

- `meter_credit` -> `type: "meter-credit"`
- `custom` -> `type: "custom"`

Meter-credit example:

```ts
export const benefitIncludedTokens = new Benefit("included-tokens", {
  type: "meter-credit",
  description: "Included monthly tokens",
  meter: meterTokens,
  units: 10000,
  rollover: false,
});
```

Custom example:

```ts
export const benefitInviteLink = new Benefit("invite-link", {
  type: "custom",
  description: "Invite link",
  note: "Visit this link",
});
```

#### Products

Map remote Product fields:

- `name`
- `description`
- `visibility`
- `recurringInterval`
- `recurringIntervalCount`
- active prices
- attached supported Benefits

Render Product Prices using existing helpers:

```ts
fixedPrice({ amount: "30", currency: "usd" });
freePrice({ currency: "usd" });
customPrice({ currency: "usd", minimumAmount: "10" });
meteredUnitPrice({ meter: meterTokens, amount: "0.001", currency: "usd", capAmount: "100" });
```

Product Prices are not standalone PAC resources and should stay embedded in `new Product(...)` declarations.

### 7. Render `pac.config.ts`

Extend the existing `CodeGenerator` service instead of creating a separate rendering service.

Rename the existing runtime generation method from `generate` to `generateRuntime`, then add a config generation method:

```ts
class CodeGenerator extends Context.Service<...>() {
  readonly generateRuntime: (plan: Plan) => Effect.Effect<string, CodeGenerationError>;
  readonly generateConfig: (input: PulledConfigModel) => Effect.Effect<string, CodeGenerationError>;
}
```

Then update `GenerateCommand` to call `codeGenerator.generateRuntime(plan)`, while `ImportCommand` calls `codeGenerator.generateConfig(model)`.

Output order must respect dependencies:

1. Meters
2. Benefits
3. Products

Imports should include only used symbols.

Example output:

```ts
import { Product, fixedPrice, Meter, meteredUnitPrice, and, eventName, sum, Benefit } from "pac";

export const meterTokens = new Meter("tokens", {
  name: "Tokens",
  unit: "token",
  filter: and(eventName("eq", "token_consumed")),
  aggregation: sum("total_tokens"),
});

export const benefitIncludedTokens = new Benefit("included-tokens", {
  type: "meter-credit",
  description: "Included monthly tokens",
  meter: meterTokens,
  units: 10000,
  rollover: false,
});

export const productPro = new Product("pro", {
  name: "Pro",
  description: "For serious users",
  prices: [
    fixedPrice({ amount: "30", currency: "usd" }),
    meteredUnitPrice({ meter: meterTokens, amount: "0.001", currency: "usd" }),
  ],
  visibility: "public",
  recurringInterval: "month",
  recurringIntervalCount: 1,
  benefits: [benefitIncludedTokens],
});
```

For the first implementation, generate explicit config declarations rather than minimal ones. This means emitting fields even when they match public config defaults, for example:

- `Product.visibility: "public"`
- `Product.recurringInterval: null` for non-recurring Products
- `Product.recurringIntervalCount: 1` for recurring Products using the default count
- `Meter.unit: "scalar"`
- `Benefit.rollover: false`

Minimal config can be revisited later once the importer is stable. Explicit output is easier to reason about initially because the generated source stays closer to the normalized remote projection.

### 8. Write output file

Add shared output path handling for config-generation commands.

Rules:

- resolve relative to `process.cwd()`;
- fail if target exists and `--overwrite` is not set;
- create parent directory if needed;
- write only after projection and rendering succeed;
- in `--dry-run`, do not write.

### 9. Adopt resources by writing PAC Metadata

`pac import` should adopt by default, meaning it writes PAC Metadata to unmanaged remote resources.

Metadata shape should match existing `managedMetadata(...)`:

```ts
{
  pac: JSON.stringify({
    v: 1,
    kind,
    addr: address,
    key,
  });
}
```

Important: preserve existing non-PAC metadata keys.

Adoption update requirements:

- Products: update metadata on the Product.
- Meters: update metadata on the Meter.
- Benefits: update metadata on the Benefit.

The current adapters already create resources with PAC Metadata. Import adoption can call the existing `PolarClient.updateProduct`, `PolarClient.updateMeter`, and `PolarClient.updateBenefit` methods directly with metadata-only update payloads. If the local operation payload types need metadata fields later, extend them separately; import does not need to go through the operation planner.

Safety rules:

- If a resource has no PAC Metadata, write generated metadata.
- If a resource has matching PAC Metadata, leave it unchanged.
- If a resource has conflicting PAC Metadata, fail unless `--force`.
- If `--dry-run`, do not write metadata.

Confirmed against `docs/reference/polar-openapi.json`: `ProductUpdate`, `MeterUpdate`, `BenefitMeterCreditUpdate`, and `BenefitCustomUpdate` all include `metadata`. Because the SDK is generated from this spec, the SDK update types should expose metadata as well; still verify with TypeScript during implementation.

### 10. Validate generated config

After writing the file and adopting metadata:

1. Load the generated config through `ConfigLoader.loadDesiredResources(path)`.
2. Fetch current Managed Resources through `RemoteResourceFetcher.fetch()`.
3. Run `Planner.plan({ desiredResources, currentResources })`.
4. Assert the plan is up to date.

If validation fails, print a diagnostic that import partially completed and tell the user to run:

```bash
pac plan --config <path>
```

Potentially keep a record of adopted resources so a future rollback/import-repair command could be added, but do not implement rollback in the first version unless necessary.

## Proposed Internal Modules

Suggested files:

```text
src/import-command.ts
src/import/classify.ts
src/import/keygen.ts
src/import/project.ts
src/import/adopt.ts
src/import/validate.ts
# plus changes to src/remote-resource-fetcher.ts for RemoteResourceFetcher.fetchInventory
# plus changes to src/generate.ts for CodeGenerator.generateConfig
```

Alternative: keep under `src/import-command/` if we want command-specific modules grouped together.

Potential service names:

- `ImportPlanner` or `ImportProjector`
- `ResourceAdopter`
- `ImportCommand`

Do not add `PulledConfigGenerator` as a separate service. Config rendering should be a new `generateConfig` method on the existing `CodeGenerator` service.

Avoid naming a variable `import` in TypeScript because `import` is a keyword. In `src/cli.ts`, call it `importCommand`.

## Error Types

Use tagged errors following the existing codebase style:

```ts
export class ImportInventoryFetchError extends Schema.TaggedErrorClass<...>()(...)
export class ImportUnsupportedResourceError extends Schema.TaggedErrorClass<...>()(...)
export class ImportRelationshipError extends Schema.TaggedErrorClass<...>()(...)
export class ImportMetadataConflictError extends Schema.TaggedErrorClass<...>()(...)
export class ImportConfigGenerationError extends Schema.TaggedErrorClass<...>()(...)
export class ImportOutputPathError extends Schema.TaggedErrorClass<...>()(...)
export class ImportAdoptionError extends Schema.TaggedErrorClass<...>()(...)
export class ImportValidationError extends Schema.TaggedErrorClass<...>()(...)
```

## Testing Plan

### Unit tests

Projection:

- fixed/free/custom/metered Product Prices
- Product Benefit attachments
- meter-credit Benefits
- custom Benefits
- Meter filters
- Meter aggregations
- archived/deleted resources skipped
- unsupported resources fail by default

Adoption:

- writes metadata for unmanaged resources
- preserves existing metadata keys
- leaves matching Managed Resources unchanged
- refuses conflicts unless `--force`
- dry-run does not call update APIs

Validation:

- generated config + adopted resources creates clean plan
- validation error gives actionable message

### Integration-style tests

Using fake `PolarClient`:

1. import a small graph: Meter -> Benefit -> Product;
2. load the generated config through `ConfigLoader` instead of asserting exact formatting;
3. assert metadata update payloads;
4. assert post-import `RemoteResourceFetcher.fetch()` and `Planner` validation.

## MVP Scope

Recommended first implementation:

1. Add `pac import --path <file> --overwrite`.
2. Fetch all active Products, Meters, and Benefits.
3. Support current PAC resource surface:
   - Products
   - Meters
   - Benefits: `meter_credit` and `custom`
   - Product Prices: fixed, free, custom, metered unit
4. Generate deterministic Resource Addresses and variable names.
5. Render `pac.config.ts`.
6. Adopt resources by writing PAC Metadata.
7. Validate with existing `ConfigLoader`, `RemoteResourceFetcher`, and `Planner`.

Defer:

- selective import filters;
- interactive rename/editing;
- rollback of adoption metadata;
- separate stdout-only mode;
- sophisticated prettier formatting;
- importing archived/deleted resources;
- partial imports with missing dependencies.

## Decisions Captured So Far

1. `pac import` should include all active supported remote resources by default, whether already Managed Resources or currently unmanaged resources. It is aimed at producing a full config from the remote Polar Organization. Existing PAC Metadata is preserved; unmanaged resources are adopted.

2. Console output should be minimal during normal execution because the real output is the generated config file. Print a concise summary, warnings, the output path, and validation status.

3. Generated config should be explicit for the first implementation. Do not omit fields merely because PAC public API defaults would fill them in. Minimal config can be revisited later.

4. `--dry-run` should print the full generated config. Do not add a separate `--stdout` flag for the initial version.

5. Generate Resource Address keys from human-readable resource names as specified above. Do not use slugs for the first version. For current Benefit shapes, use `description` because that is the human-readable field exposed by Polar.

6. Unsupported resources are handled as follows:

   Clarification: “partial unsupported resources” means the Polar Organization contains a mixture of resources PAC can represent and resources PAC cannot represent yet. For example, PAC may support Products, Meters, meter-credit Benefits, and custom Benefits, while the Polar Organization also contains a Discord Benefit or another Benefit type outside PAC's current resource surface.
   - By default, any unsupported active remote resource fails the import because the generated config would not be a full representation of the Polar Organization.
   - With `--skip-unsupported`, unsupported resources are omitted from the generated config and the CLI prints warnings listing what was skipped and why.
   - If an otherwise-supported resource cannot be represented faithfully because it depends on a skipped unsupported resource, it must not be silently adopted into a config that would drift. Either skip that dependent resource with a warning or fail with a clear diagnostic.

7. Metadata updates are supported by Polar's OpenAPI schema for current MVP resources. `ProductUpdate`, `MeterUpdate`, `BenefitMeterCreditUpdate`, and `BenefitCustomUpdate` all include `metadata`; verify SDK type compatibility during implementation.

## Implementation Order

Implement `pac import` in small reviewable slices. Each slice should compile independently and either include focused tests or expose behavior that can be checked with existing tests.

### 1. Add raw inventory method to `RemoteResourceFetcher`

Goal: fetch all relevant Polar resources without filtering by PAC Metadata, while reusing the existing remote fetching service.

Scope:

- Add `RemoteResourceFetcher.fetchInventory()`.
- Factor the existing concurrent `PolarClient.listProducts`, `listMeters`, and `listBenefits` calls into a private helper used by both `fetchInventory()` and the existing managed `fetch()` method.
- Return raw inventory:

```ts
type PolarInventory = {
  readonly products: ReadonlyArray<RemoteProduct>;
  readonly meters: ReadonlyArray<RemoteMeter>;
  readonly benefits: ReadonlyArray<RemoteBenefit>;
};
```

Tests / review:

- Unit test with a fake `PolarClient` proving `fetchInventory()` uses all three list calls and does no PAC Metadata filtering.
- Existing tests for `fetch()` / planner behavior should keep passing, proving managed fetching behavior did not change.

### 2. Add import classification and identity assignment

Goal: decide which remote resources can be imported and assign stable Resource Addresses.

Scope:

- Add classification with `Schema.TaggedUnion`.
- Preserve identity for already Managed Resources.
- Generate keys and Resource Addresses for unmanaged resources.
- Skip archived/deleted resources for the MVP.
- Detect conflicting PAC Metadata.
- Generate kind-prefixed variable names such as `meterTokens`, `benefitIncludedTokens`, `productPro`.

Tests / review:

- A small unit test for an inventory containing one managed and one unmanaged resource.
- Verify generated addresses and variable names.
- Verify conflicting metadata is reported.

### 3. Build a Meter-only import model slice

Goal: prove the import model shape with the simplest resource kind before adding relationships.

Scope:

- Use `fetchInventory()` output and identity assignment for Meters.
- Project remote Meters into `MeterSpec`.
- Reuse existing Meter normalization logic from `RemoteResourceFetcher`; refactor only the Meter spec projection code needed for this slice.
- Produce Meter import model entries:

```ts
type ImportResourceModel = {
  readonly kind: ResourceKind;
  readonly key: string;
  readonly address: ResourceAddress;
  readonly variableName: string;
  readonly polarId: string;
  readonly spec: MeterSpec | BenefitSpec | ProductSpec;
  readonly raw: unknown;
  readonly adoption: "NeedsAdoption" | "AlreadyManaged";
};
```

Tests / review:

- Use one managed Meter and one unmanaged Meter.
- Assert generated addresses, variable names, adoption status, and `MeterSpec` values.

### 4. Extend the import model to Benefits

Goal: add the first relationship-bearing resource kind.

Scope:

- Add Benefit projection for supported Benefit types:
  - `meter_credit`
  - `custom`
- Build Meter ID -> Meter address / variable name lookup from the Meter import model.
- Resolve meter-credit Benefit `meterId` to a PAC Meter Resource Address.
- Reuse existing Benefit normalization logic from `RemoteResourceFetcher`; refactor only the Benefit spec projection code needed for this slice.

Tests / review:

- Use a fake graph: Meter -> meter-credit Benefit.
- Assert the Benefit spec references the Meter Resource Address, not the Polar Meter ID.
- Assert unsupported Benefit types fail by default.

### 5. Extend the import model to Products

Goal: complete the resource graph by adding Products, Product Prices, and Product Benefit Attachments.

Scope:

- Add Product projection.
- Build lookup tables:
  - Meter ID -> Meter address / variable name
  - Benefit ID -> Benefit address / variable name
- Resolve metered Product Price `meterId` to a PAC Meter Resource Address.
- Resolve Product Benefit attachments to PAC Benefit Resource Addresses.
- Reuse existing Product normalization logic from `RemoteResourceFetcher`; refactor only the Product spec projection code needed for this slice.

Tests / review:

- Use a fake graph: Meter -> meter-credit Benefit -> Product with metered price and attached Benefit.
- Assert the Product spec uses Resource Addresses, not Polar IDs.
- Assert fixed/free/custom/metered Product Prices project correctly.

### 6. Extend `CodeGenerator` for config output

Goal: add config rendering without wiring the CLI yet.

Scope:

- Rename existing `CodeGenerator.generate` to `generateRuntime`.
- Update `GenerateCommand` to call `generateRuntime`.
- Add `CodeGenerator.generateConfig(importModel)`.
- Render explicit config declarations in dependency order:
  1. Meters
  2. Benefits
  3. Products
- Use kind-prefixed variable names.
- Emit fields explicitly for the first version.

Tests / review:

- Existing generate command tests should keep passing.
- Add one round-trip test: render config, load it with `ConfigLoader`, and compare desired specs to the import model specs. Avoid brittle exact formatting tests unless necessary.

### 7. Add output path handling

Goal: safely write generated config files.

Scope:

- Add config output path resolution for `import`.
- Default to `pac.config.ts`.
- Treat `--path` as a file path.
- Refuse overwrite unless `--overwrite`.
- Create parent directories.

Tests / review:

- Unit test path resolution and overwrite behavior using Effect `FileSystem` test doubles if available, or small integration-style temp directory tests.

### 8. Add adoption metadata writer

Goal: write PAC Metadata to remote resources that need adoption.

Scope:

- Add `ResourceAdopter`.
- Preserve existing non-PAC metadata.
- Leave already Managed Resources unchanged when metadata matches.
- Refuse conflicting PAC Metadata unless `--force`.
- Use metadata-only update calls through `PolarClient.updateProduct`, `updateMeter`, and `updateBenefit`.

Tests / review:

- Fake `PolarClient` test asserting update payloads.
- Test dry-run does not call update methods.
- Test metadata preservation.

### 9. Add post-import validation

Goal: prove the generated config is deploy-safe after adoption.

Scope:

- Load generated config through `ConfigLoader`.
- Fetch Managed Resources through `RemoteResourceFetcher`.
- Run `Planner.plan`.
- Assert the plan is up to date.
- On failure, print actionable instructions to run `pac plan --config <path>`.

Tests / review:

- Fake managed fetch + config load path where validation passes.
- One failure test verifying the diagnostic message.

### 10. Wire the `pac import` CLI command

Goal: expose the complete command after internals are independently reviewed.

Scope:

- Add `src/import-command.ts` service.
- Add top-level `import` command in `src/cli.ts`.
- Flags:
  - `--path`
  - `--overwrite`
  - `--dry-run`
  - `--skip-unsupported`
  - `--force`
- Normal mode:
  1. fetch inventory
  2. build import model
  3. generate config
  4. write file
  5. adopt metadata
  6. validate
- Dry-run mode:
  1. fetch inventory
  2. build import model
  3. print full generated config
  4. print adoption summary
  5. do not write file
  6. do not mutate Polar

Tests / review:

- Command-level test with fake services for normal mode.
- Command-level test for dry-run.

### 11. Add unsupported resource handling polish

Goal: make unsupported-resource behavior safe and user-friendly.

Scope:

- Default: fail on unsupported active remote resources.
- With `--skip-unsupported`: omit unsupported resources and print warnings.
- Ensure supported resources that depend on skipped resources are not silently imported into drift.

Tests / review:

- Unsupported Benefit type fails by default.
- `--skip-unsupported` warns and omits it.
- Product depending on skipped Benefit is handled safely.

### 12. Manual end-to-end verification

Goal: verify against a real or sandbox Polar Organization.

Scope:

- Create a sandbox Polar Organization with:
  - one Meter
  - one meter-credit Benefit
  - one custom Benefit
  - one Product with fixed and metered prices
- Run:

```bash
pac import --path pac.config.ts --overwrite
pac plan --config pac.config.ts
```

Expected result:

- import writes config and metadata;
- `pac plan` is clean;
- generated config is readable enough to become the user's source of truth.
