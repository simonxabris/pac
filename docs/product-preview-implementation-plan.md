# Product Preview Implementation Plan

Goal: implement the first useful `paac` flow where a user can declare Polar products with a class-based public API, the CLI loads that declaration file, compares desired products against Polar products identified by metadata, and prints a plan instead of mutating Polar.

This plan intentionally stops before `POST /v1/products` or `PATCH /v1/products/{id}`. The CLI should only print what it would create, update, archive/delete, or leave unchanged.

## Target user API

Example user file, probably `paac.config.ts`:

```ts
import { Product } from "paac";

export const pro = new Product("pro", {
  name: "Pro plan",
  description: "For serious users",
  price: "20",
  currency: "usd",
  recurringInterval: "month",
});
```

The class constructor registers a desired resource. It does **not** call Polar.

The stable local resource address is:

```txt
product.pro
```

## Polar product fields to support first

From `docs/reference/polar-openapi.json`:

- Product create endpoint: `POST /v1/products`
- Product list endpoint: `GET /v1/products`
- Product update endpoint: `PATCH /v1/products/{id}`
- Create schema: `ProductCreate`, one of:
  - `ProductCreateRecurring`
  - `ProductCreateOneTime`
- Product metadata supports string/integer/number/boolean values, up to 50 keys. Metadata key max length is 40, string value max length is 500.

Support this minimal PAAC config shape first:

```ts
type ProductConfig = {
  readonly name: string;
  readonly description?: string | null;
  readonly price: string | number;
  readonly currency?: string;
  readonly visibility?: "public" | "hidden";
  readonly recurringInterval?: "day" | "week" | "month" | "year" | null;
  readonly recurringIntervalCount?: number;
  readonly organizationId?: string;
};
```

Map it to Polar create payload:

```ts
{
  name: config.name,
  description: config.description ?? null,
  visibility: config.visibility ?? "public",
  organization_id: config.organizationId,
  recurring_interval: config.recurringInterval ?? null,
  recurring_interval_count: config.recurringInterval ? config.recurringIntervalCount ?? 1 : null,
  prices: [
    {
      amount_type: "fixed",
      price_amount: dollarsToCents(config.price),
      price_currency: config.currency ?? "usd"
    }
  ],
  metadata: {
    ...userMetadataIfSupportedLater,
    paac_type: "product",
    paac_key: key,
    paac_addr: `product.${key}`,
    paac_project: projectName
  }
}
```

Use `paac_addr` instead of `paac_address` because Polar metadata keys have a 40-character limit and shorter keys leave more room for future namespacing.

## Important metadata identity model

Every PAAC-managed Polar product should have metadata:

```json
{
  "paac_type": "product",
  "paac_key": "pro",
  "paac_addr": "product.pro",
  "paac_project": "default"
}
```

Matching rules during plan:

1. Fetch/list all Polar products.
2. Filter products whose metadata has `paac_project === currentProject` and `paac_type === "product"`.
3. Match desired product by `paac_addr`.
4. If no match exists, plan `create`.
5. If a match exists, normalize remote shape and compare fields.
6. If fields differ, plan `update`.
7. If fields are equal, plan `no-op`.
8. If a remote PAAC-managed product exists but no desired local resource has the same address, plan `archive` rather than hard delete, because Polar `ProductUpdate` supports `is_archived` and product deletion is not shown in the OpenAPI product paths.

## CLI shape

Replace the temporary `hello` command with at least:

```bash
paac plan --config paac.config.ts
```

Optional alias later:

```bash
paac deploy --dry-run
```

For this milestone, `plan` is enough.

Flags:

- `--config`, `-c`: path to config file, default `paac.config.ts`
- `--project`, `-p`: metadata project namespace, default directory/package name or `default`
- `--api-token`: optional, or read `POLAR_ACCESS_TOKEN`
- `--api-url`: default Polar API URL; useful for sandbox/testing
- `--mock-remote`: optional path to a JSON fixture of remote products so planning can be tested without real Polar credentials

## Internal architecture

Suggested files:

```txt
src/index.ts                  Effect CLI entrypoint
src/resources/registry.ts     global registry lifecycle
src/resources/product.ts      public Product class and product normalization
src/config/load.ts            load/run user config file
src/polar/client.ts           minimal Polar client interface
src/polar/http-client.ts      real GET /v1/products implementation later
src/polar/mock-client.ts      fixture-backed client for current milestone
src/plan/diff.ts              desired-vs-remote comparison
src/plan/render.ts            human-readable plan output
```

### Registry

The registry exists because user config has side-effectful class construction:

```ts
export const pro = new Product("pro", { ... });
```

Needed functions:

```ts
resetRegistry(): void
registerResource(resource: Resource): void
getResources(): ReadonlyArray<Resource>
```

`Product` constructor should call `registerResource(this)`.

Before loading a config file, always call `resetRegistry()`.

### Product class

Public class:

```ts
export class Product {
  readonly type = "product" as const;
  readonly key: string;
  readonly address: `product.${string}`;
  readonly config: ProductConfig;

  constructor(key: string, config: ProductConfig) {
    this.key = key;
    this.address = `product.${key}`;
    this.config = config;
    registerResource(this);
  }

  toDesired(project: string): DesiredProduct {
    // returns plain data used by planner
  }
}
```

Do not make the planner rely on `instanceof Product`. Use `resource.type === "product"` so duplicated modules or future plugin boundaries do not break detection.

### Config loading

For local development, use dynamic import through `tsx` or another TypeScript loader strategy.

Options:

1. Require users to run through `tsx` during development.
2. Use `tsx` programmatically to import `paac.config.ts`.
3. Initially support `.js` config only and add `.ts` later.

Recommended for this project: use `tsx` because it is already installed.

Important issue: dynamic imports are cached. Add a cache-busting query when importing config during repeated runs:

```ts
await import(pathToFileURL(configPath).href + `?t=${Date.now()}`)
```

### Polar client interface

Start with an interface that can be backed by mock data now and real HTTP later:

```ts
type PolarClient = {
  readonly listProducts: Effect.Effect<ReadonlyArray<RemoteProduct>, PolarError>;
};
```

For this milestone, if `--mock-remote remote-products.json` is provided, load it and return those products.

If no mock is provided and no token exists, print a helpful error:

```txt
No Polar token found. Set POLAR_ACCESS_TOKEN or use --mock-remote for local planning.
```

The real client can initially only implement `GET /v1/products`. Creation/update still only appears in the plan output.

## Diff behavior

Normalize both desired and remote into comparable objects:

```ts
type ComparableProduct = {
  readonly name: string;
  readonly description: string | null;
  readonly visibility: string;
  readonly recurring_interval: string | null;
  readonly recurring_interval_count: number | null;
  readonly prices: ReadonlyArray<{
    readonly amount_type: "fixed";
    readonly price_amount: number;
    readonly price_currency: string;
  }>;
};
```

For first version, compare only the first fixed price. If remote prices are more complex, show a warning and plan an update only for supported fields.

Planned actions:

```ts
type PlanAction =
  | { type: "create"; address: string; payload: ProductCreatePayload }
  | { type: "update"; address: string; remoteId: string; changes: ReadonlyArray<FieldChange>; payload: ProductUpdatePayload }
  | { type: "archive"; address: string; remoteId: string }
  | { type: "no-op"; address: string; remoteId: string };
```

## Example output

```txt
PAAC plan for project default

+ create product.pro
  name: Pro plan
  price: 2000 usd
  recurring: month x 1

~ update product.team (8d7c...)
  name: "Team" -> "Team plan"
  price_amount: 3000 -> 5000

- archive product.legacy (a63f...)

Plan: 1 to create, 1 to update, 1 to archive, 0 unchanged.
No changes were applied.
```

## First implementation steps

1. Fix/remove the invalid `src/example.ts` or convert it into a valid sample config.
2. Export `Product` from the package entrypoint while keeping the CLI runnable as `paac`.
   - If the same `src/index.ts` is both CLI and library export, split into `src/cli.ts` and `src/index.ts` later.
   - Preferred now: keep bin pointed at `dist/cli.js`, and make `src/index.ts` export public API.
3. Add registry and `Product` class.
4. Add `plan` command to Effect CLI.
5. Implement config loading and registry extraction.
6. Implement mock Polar client from JSON fixture.
7. Implement desired/remote matching by metadata.
8. Implement create/update/archive/no-op planning.
9. Render a human-readable plan.
10. Add a sample `paac.config.ts` and `remote-products.example.json` for manual testing.

## Later milestones

- Generate or hand-write stronger TypeScript types from the OpenAPI schema.
- Add real `GET /v1/products` pagination and auth.
- Add actual `paac deploy` that applies creates, updates, and archives.
- Add state file as optional backup/recovery mechanism.
- Add `Discount` class with references to `Product` instances.
- Add dependency graph and topological ordering.
- Add import command for existing manually-created Polar products.
