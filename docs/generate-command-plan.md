# `generate` CLI Command Plan

## Goal

Add a new CLI command, `generate`, that writes a runtime file such as `pac.runtime.ts` containing the current Polar IDs and useful metadata for PAAC-managed resources declared in the user's config.

Example desired output for products:

```ts
export const products = [
  {
    id: "polar_product_id",
    key: "pro",
    address: "product.pro",
    name: "Pro",
  },
] as const;
```

## Best Source of Data

The command should reuse the existing `RemoteResourceFetcher.fetch()` infrastructure in `src/remote-resource-fetcher.ts`.

`RemoteResourceFetcher.fetch()` already:

- calls Polar through `PolarClient`
- lists Products, Meters, and Benefits
- filters to PAAC-managed resources via `metadata.paac`
- decodes Polar SDK objects into PAAC `CurrentResource` shapes
- resolves relationships between resources
- preserves useful provider state such as Product Price IDs and attached Benefit IDs

This avoids duplicating Polar SDK calls and PAAC metadata decoding logic.

## Recommended Flow

The `generate` command should:

1. Load desired resources from the user config using the existing config loader.
2. Fetch current PAAC-managed Polar resources with `RemoteResourceFetcher.fetch()`.
3. Match desired resources by `ResourceAddress` against the fetched current resources.
4. Fail if a desired resource is missing or removed in Polar.
5. Project current resources into a runtime snapshot model.
6. Render that model to `pac.runtime.ts`.

Pseudo-flow:

```ts
const desiredResources = yield* loadDesiredResources(config);
const remoteResourceFetcher = yield* RemoteResourceFetcher;

const currentResourcesByAddress = yield* remoteResourceFetcher.fetch();

const runtimeResources = desiredResources.map((desired) => {
  const current = currentResourcesByAddress.get(desired.address);

  if (current === undefined || current.isRemoved) {
    throw new Error(
      `Resource ${desired.address} does not exist in Polar yet. Run paac deploy first.`,
    );
  }

  return projectRuntimeResource(current, currentResourcesByAddress);
});

const file = renderRuntimeFile(runtimeResources);
```

## Why Match Against Desired Resources?

The desired config should define which resources appear in the generated runtime file.

If generation used only `RemoteResourceFetcher.fetch()`, it could include stale PAAC-managed resources that are still present in Polar but no longer declared in the user's config, such as archived Products or old Meters.

Therefore:

- desired resources decide **what to include**
- remote current resources provide **actual Polar IDs and provider state**

## Required Planner Validation

The command should use `Planner` to verify that the user's config is fully in sync with Polar before generating the runtime file.

```ts
const plan = yield* planner.plan({
  desiredResources,
  currentResources: [...currentResourcesByAddress.values()],
});
```

For `generate`, the plan should effectively contain only `Noop` nodes for the desired resources being generated. This means the resources declared in code already exist in Polar and their managed fields are up to date.

If the planner detects any config changes relative to Polar, the CLI should explain the pending changes to the user and abort without writing the generated file. This includes:

- `Create` nodes: resource exists in config but has not been deployed to Polar yet
- `Update` nodes: resource exists in Polar but config changes have not been deployed yet
- `Remove` nodes: Polar contains managed resources no longer present in config
- `Blocked` nodes: resource cannot be reconciled because of diagnostics
- error diagnostics, including missing dependencies or dependency cycles

Recommended behavior:

1. fetch current resources
2. run the planner
3. if the plan contains anything other than acceptable `Noop` state, render the plan or a concise diagnostic summary
4. tell the user to run `paac plan` or `paac deploy`
5. abort execution before calling `CodeGenerator.generate(...)`

Runtime data should still be projected from `currentResourcesByAddress`, not from the plan. The planner is used as a safety gate to ensure generated IDs and API objects correspond to the currently deployed config.

## Runtime Output Shape

The generated file should export one object per resource kind:

- `products`
- `meters`
- `benefits`

Each exported object should be keyed by the resource key within that kind. For example, a resource declared as:

```ts
new Product("pro", { ... })
```

has Resource Address `product.pro`, and should appear under `products.pro`:

```ts
export const products = {
  pro: {
    // raw Polar Product API response
  },
} as const;
```

The value should be the raw resource object returned by the Polar API, not a reduced PAAC projection. The current infrastructure already preserves this value on `CurrentResource.raw` when resources are decoded by `RemoteResourceFetcher.fetch()`.

The same shape applies to all resource kinds:

```ts
export const products = {
  pro: {
    // raw Polar Product API response
  },
} as const;

export const meters = {
  tokens: {
    // raw Polar Meter API response
  },
} as const;

export const benefits = {
  "included-tokens": {
    // raw Polar Benefit API response
  },
} as const;
```

Generated property names should be quoted when necessary. Resource keys may contain hyphens, so `"included-tokens"` is valid while `included-tokens` is not valid unquoted JavaScript property syntax.

### Products

For Products, the object value should be the raw Polar Product API response. This includes Polar's actual Product ID, prices, benefits, metadata, and any other fields returned by the SDK.

Example conceptual output:

```ts
export const products = {
  pro: {
    id: "polar_product_id",
    name: "Pro",
    prices: [
      {
        id: "polar_price_id",
        // other Polar price fields
      },
    ],
    benefits: [
      {
        id: "polar_benefit_id",
        // other Polar benefit reference fields
      },
    ],
    // other Polar Product fields
  },
} as const;
```

### Meters

For Meters, the object value should be the raw Polar Meter API response.

```ts
export const meters = {
  tokens: {
    id: "polar_meter_id",
    name: "Tokens",
    // other Polar Meter fields
  },
} as const;
```

### Benefits

For Benefits, the object value should be the raw Polar Benefit API response.

```ts
export const benefits = {
  "included-tokens": {
    id: "polar_benefit_id",
    description: "Included monthly tokens",
    // other Polar Benefit fields
  },
} as const;
```

## Domain Note: Product Prices

Product Prices are not standalone PAAC resources. `CONTEXT.md` defines them as part of a Product.

Therefore, price data should remain nested inside the raw Polar Product object rather than generated as a top-level `prices` export.

A top-level `prices` export could be added later as a convenience, but the canonical representation should remain nested under `products`.

## Code Generation Service

The generation logic should be encapsulated in a dedicated Effect service named `CodeGenerator`.

`CodeGenerator` should expose a single method:

```ts
type CodeGeneratorShape = {
  readonly generate: (
    currentResources: ReadonlyArray<CurrentResource>,
  ) => Effect.Effect<string>;
};
```

The input should be the list of current resources to include in the runtime file.

The output should be a single string containing the complete contents of the file to write, for example `pac.runtime.ts`.

This keeps the CLI command responsible only for orchestration:

1. load desired resources
2. fetch current resources
3. select and validate the current resources that correspond to desired resources
4. pass those current resources to `CodeGenerator.generate(...)`
5. write the returned string to disk

## CLI `--path` Behavior

The `generate` command should accept a `--path` flag that controls where the runtime file is written.

Examples:

```sh
paac generate --path src/billing
paac generate --path src/billing/polar.data.ts
```

The flag should support two forms:

1. **Directory path**: if the path is a directory-like path such as `src/billing`, write the generated file inside that directory using the default filename `pac.runtime.ts`.
2. **File path**: if the path ends with a file path such as `src/billing/polar.data.ts`, write the generated file to that exact file path.

Recommended default:

```txt
--path .
```

With the default, generation writes:

```txt
./pac.runtime.ts
```

### Path Resolution Rules

Use Effect's platform services instead of importing `node:path` or `node:fs` directly in the command implementation.

Relevant Effect APIs researched from Effect v4:

- `effect/Path`
  - service tag: `Path.Path`
  - useful methods:
    - `path.resolve(...)`
    - `path.join(...)`
    - `path.dirname(...)`
    - `path.basename(...)`
    - `path.extname(...)`
    - `path.normalize(...)`
    - `path.isAbsolute(...)`
- `effect/FileSystem`
  - service tag: `FileSystem.FileSystem`
  - useful methods:
    - `fs.exists(path)`
    - `fs.stat(path)` returning `File.Info` with `type: "File" | "Directory" | ...`
    - `fs.makeDirectory(path, { recursive: true })`
    - `fs.writeFileString(path, contents)`
- `@effect/platform-node/NodeServices.layer`
  - already provided by `src/cli.ts`
  - includes Node-backed `FileSystem` and `Path` services via `NodeFileSystem.layer` and `NodePath.layer`

Recommended imports:

```ts
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
```

Recommended destination resolution helper:

```ts
const defaultRuntimeFileName = "pac.runtime.ts";

const resolveGenerateOutputPath = (inputPath: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const absoluteInputPath = path.resolve(inputPath);
    const exists = yield* fs.exists(absoluteInputPath);

    if (exists) {
      const info = yield* fs.stat(absoluteInputPath);

      if (info.type === "Directory") {
        return {
          directory: absoluteInputPath,
          filePath: path.join(absoluteInputPath, defaultRuntimeFileName),
        };
      }

      if (info.type === "File") {
        return {
          directory: path.dirname(absoluteInputPath),
          filePath: absoluteInputPath,
        };
      }

      throw new Error(
        `Generate path must be a file or directory, got ${info.type}: ${absoluteInputPath}`,
      );
    }

    // If the path does not exist, use syntax to distinguish directory-like paths
    // from file-like paths. A path with an extension is treated as a file path.
    if (path.extname(absoluteInputPath) !== "") {
      return {
        directory: path.dirname(absoluteInputPath),
        filePath: absoluteInputPath,
      };
    }

    return {
      directory: absoluteInputPath,
      filePath: path.join(absoluteInputPath, defaultRuntimeFileName),
    };
  });
```

After resolving the destination:

```ts
yield* fs.makeDirectory(destination.directory, { recursive: true });
yield* fs.writeFileString(destination.filePath, generatedContents);
```

This allows both of these to work:

```txt
src/billing                  -> src/billing/pac.runtime.ts
src/billing/polar.data.ts    -> src/billing/polar.data.ts
```

## Suggested File Structure

Add a small runtime generation module rather than putting all logic directly in the CLI file:

```txt
src/code-generator.ts      # Effect service: CurrentResource[] -> generated file string
src/runtime/
  snapshot.ts             # CurrentResource[] -> runtime snapshot model
  render.ts               # runtime snapshot model -> pac.runtime.ts contents
```

Then `src/cli.ts` only wires the command and writes the generated string.

## Summary

Recommended pipeline:

```txt
loadDesiredResources(config)
        ↓
RemoteResourceFetcher.fetch()
        ↓
match desired addresses to current resources
        ↓
fail if missing / removed
        ↓
project CurrentResource -> runtime export model
        ↓
render pac.runtime.ts
```

This reuses the existing Polar-fetching, PAAC metadata parsing, resource decoding, relationship resolution, and provider state extraction infrastructure already present in the codebase.
