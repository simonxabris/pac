# Event API Experiment Plan

## Goal

Introduce a public PAC `Event` API that acts as a typed contract between:

1. Meter filter / aggregation configuration at deploy time.
2. Runtime event ingestion through the Polar SDK.

Polar does not expose Event as a deployable resource, so PAC should treat `Event` as a local contract/generation primitive rather than a managed remote resource.

## Desired User API

`Event.metadata` describes the user-defined Polar event metadata fields as JSON Schema. PAC should accept the schema as user-owned input and interpret the parts it understands to generate runtime TypeScript types and build meter property references.

Target authoring style:

```ts
const tokenUsageEvent = new Event("token-usage", {
  name: "token-usage",
  metadata: {
    type: "object",
    properties: {
      tokens: { type: "number" },
      model: { type: "string" },
      cacheHit: { type: "boolean" },
    },
    required: ["tokens", "model"],
  },
});

const tokenUsageMeter = new Meter("token-usage", {
  name: "token usage",
  unit: "token",
  filter: eventName(tokenUsageEvent),
  aggregation: sum(tokenUsageEvent.metadata.tokens),
});
```

Runtime usage target:

```ts
import { Polar } from "@polar-sh/sdk";
import { TokenUsageEvent } from "./pac.runtime";

const client = new Polar();

await client.events.ingest(
  new TokenUsageEvent({
    externalCustomerId: "user_123",
    model: "gpt-5.5",
    tokens: 100_000,
  }),
);
```

Note: Polar requires either `customerId` or `externalCustomerId` for ingested events, so the runtime constructor must include customer identity fields in addition to event metadata fields.

## JSON Schema Direction

PAC should use JSON Schema as the event metadata description format.

Why JSON Schema instead of Standard Schema:

- JSON Schema is introspectable.
- PAC can enumerate metadata keys.
- PAC can inspect primitive value types.
- PAC can generate standalone runtime TypeScript types.
- PAC can derive typed meter property refs.
- Users can still author schemas with their preferred ecosystem if they can produce JSON Schema.

Standard Schema is useful for validation but does not provide a portable schema AST, so it is a poor fit for PAC code generation and meter helper typing.

## Metadata Authoring Model

The public API should accept JSON Schema directly. Users can author with libraries like Zod if they convert those schemas to JSON Schema before passing them to `Event`.

There are two possible API levels:

### Direct JSON Schema

```ts
const tokenUsageEvent = new Event("token-usage", {
  name: "token-usage",
  metadata: {
    type: "object",
    properties: {
      tokens: { type: "number" },
      model: { type: "string" },
      cacheHit: { type: "boolean" },
    },
    required: ["tokens", "model"],
  },
});
```

### Schema-library authoring

PAC's `Event` API should receive JSON Schema. Users can still author with another schema library, but the value passed to `metadata` should be the generated JSON Schema, not the library-specific schema object.

Example shape:

```ts
const tokenUsageMetadataSchema = toJsonSchema(
  z.object({
    tokens: z.number(),
    model: z.string(),
    cacheHit: z.boolean().optional(),
  }),
);

const tokenUsageEvent = new Event("token-usage", {
  name: "token-usage",
  metadata: tokenUsageMetadataSchema,
});
```

The exact conversion function is library-dependent. PAC should not rely on Zod/ArkType/etc. internals in the core `Event` API. If we want first-class ergonomics later, we can add explicit adapter helpers, but those helpers should still return JSON Schema.

PAC should not validate or reject the supplied JSON Schema for now. Users can supply whatever JSON Schema they want. PAC will only interpret the parts it understands for metadata refs and runtime type generation.

## JSON Schema Interpretation for Code Generation

The first implementation should treat JSON Schema as user-owned input and interpret it best-effort.

For code generation and meter helper typing, PAC only needs to understand this common top-level object shape when present:

```ts
type EventMetadataJsonSchemaLike = {
  readonly type?: "object";
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: ReadonlyArray<string>;
};
```

Best-effort interpretation:

- top-level `properties` keys become event metadata keys;
- fields listed in `required` are required;
- fields not listed in `required` are optional;
- property schema `{ type: "string" }` maps to TypeScript `string`;
- property schema `{ type: "number" }` maps to TypeScript `number`;
- property schema `{ type: "integer" }` maps to TypeScript `number`;
- property schema `{ type: "boolean" }` maps to TypeScript `boolean`;
- property schemas PAC does not understand can fall back to `unknown` or a broader Polar metadata value type in generated code.

PAC should not reject nested objects, arrays, unions, refs, formats, refinements, or other JSON Schema features at config load time. Those features may simply be ignored or represented less precisely in generated TypeScript until we deliberately support them.

## Optional Metadata Properties

Optionality must come from JSON Schema's `required` array.

Example JSON Schema:

```ts
{
  type: "object",
  properties: {
    tokens: { type: "number" },
    model: { type: "string" },
    cacheHit: { type: "boolean" },
  },
  required: ["tokens", "model"],
}
```

This is the JSON Schema shape we would expect from a source schema where `cacheHit` was optional, such as a Zod `z.boolean().optional()` field.

Normalized JSON Schema should remain equivalent to:

```ts
{
  type: "object",
  properties: {
    tokens: { type: "number" },
    model: { type: "string" },
    cacheHit: { type: "boolean" },
  },
  required: ["tokens", "model"],
}
```

Generated runtime type should preserve explicit optional `undefined`:

```ts
export type TokenUsageEventMetadata = {
  tokens: number;
  model: string;
  cacheHit?: boolean | undefined;
};
```

This is intentional. With `exactOptionalPropertyTypes`, `cacheHit?: boolean` and `cacheHit?: boolean | undefined` are not equivalent for explicit `undefined` assignment. PAC should emit `?: T | undefined` for optional metadata fields.

When building the Polar SDK event payload, generated runtime code should omit metadata keys whose value is `undefined`, because Polar metadata values do not include `undefined`.

## Current Code Fit

Current meter helpers in `src/resources/meter.ts` already compile to Polar meter filter and aggregation specs:

```ts
eventName("eq", "token_consumed");
// { property: "name", operator: "eq", value: "token_consumed" }

sum("total_tokens");
// { func: "sum", property: "total_tokens" }

metadata("region", "eq", "us-east");
// { property: "metadata.region", operator: "eq", value: "us-east" }
```

The new `Event` API can reuse this existing representation by resolving event metadata fields into meter property paths.

## IaC Design

### Event as a non-resource contract

`Event` should not be a normal PAC resource because it has no matching Polar resource lifecycle. It should not participate in plan/create/update/remove operations.

Instead, it should be registered separately as an event definition so runtime code generation can discover it.

Possible file:

```txt
src/resources/event.ts
```

or:

```txt
src/events/event.ts
```

### Event metadata references

An event metadata field should be represented by a small ref object:

```ts
type EventMetadataRef = {
  readonly eventName: string;
  readonly key: string;
  readonly meterPath: `metadata.${string}`;
  readonly valueType: "string" | "number" | "boolean";
  readonly optional: boolean;
};
```

Then:

```ts
tokenUsageEvent.metadata.tokens;
```

would internally resolve to:

```ts
{
  eventName: "token-usage",
  key: "tokens",
  meterPath: "metadata.tokens",
  valueType: "number",
  optional: false,
}
```

For optional metadata:

```ts
tokenUsageEvent.metadata.cacheHit;
```

would resolve to:

```ts
{
  eventName: "token-usage",
  key: "cacheHit",
  meterPath: "metadata.cacheHit",
  valueType: "boolean",
  optional: true,
}
```

### Typed metadata proxy

`Event.metadata` can be exposed as a typed proxy generated from the JSON Schema keys PAC can interpret.

Conceptual type:

```ts
type EventMetadataRefs<Shape> = {
  readonly [Key in keyof Shape]-?: EventMetadataRefFor<Shape[Key]>;
};
```

At runtime, PAC can build this proxy from the JSON Schema `properties` object when present, or use a generic proxy that returns refs for accessed keys. For now, PAC should not validate schema shape or reject unsupported JSON Schema features during config loading.

### Helper overloads

Update meter helpers to accept event metadata refs.

```ts
eventName(tokenUsageEvent);
// { property: "name", operator: "eq", value: "token-usage" }

sum(tokenUsageEvent.metadata.tokens);
// { func: "sum", property: "metadata.tokens" }
```

Keep the existing API working:

```ts
eventName("eq", "token_consumed");
sum("total_tokens");
```

Aggregation helper typing should use metadata value type:

```ts
sum(tokenUsageEvent.metadata.tokens); // allowed, number
sum(tokenUsageEvent.metadata.model); // type error, string
unique(tokenUsageEvent.metadata.model); // allowed
```

Open question: should optional numeric metadata be accepted by `sum`? It probably should be accepted type-wise if the field's base type is numeric, while runtime omission means that individual event will not contribute a numeric value for that field.

### Single-clause filters

The desired API uses:

```ts
filter: eventName(tokenUsageEvent);
```

Today `MeterConfig.filter` expects a full `MeterFilter`, usually produced by `and(...)`.

Consider changing:

```ts
readonly filter: MeterFilter;
```

to:

```ts
readonly filter: MeterFilter | MeterFilterClause;
```

Then normalize a single clause to:

```ts
and(clause);
```

inside `meterSpec`.

## Runtime Code Generation

### Polar SDK shape

The Polar SDK currently expects:

```ts
client.events.ingest(request: EventsIngest)
```

where `EventsIngest` is:

```ts
{
  events: Array<EventCreateCustomer | EventCreateExternalCustomer>;
}
```

Therefore this exact usage:

```ts
client.events.ingest(new TokenUsageEvent(...))
```

requires `TokenUsageEvent` to be an ingest request wrapper, not merely one raw event object.

### Generated wrapper class option

Given metadata schema:

```ts
{
  type: "object",
  properties: {
    tokens: { type: "number" },
    model: { type: "string" },
    cacheHit: { type: "boolean" },
  },
  required: ["tokens", "model"],
}
```

emit runtime code like:

```ts
import type { EventsIngest, Events } from "@polar-sh/sdk/models/components/eventsingest.js";

export type TokenUsageEventMetadata = {
  tokens: number;
  model: string;
  cacheHit?: boolean | undefined;
};

export type TokenUsageEventInput = TokenUsageEventMetadata & {
  timestamp?: Date;
  organizationId?: string | null;
  externalId?: string | null;
  parentId?: string | null;
} & (
    | {
        customerId: string;
        memberId?: string | null;
        externalCustomerId?: never;
        externalMemberId?: never;
      }
    | {
        externalCustomerId: string;
        externalMemberId?: string | null;
        customerId?: never;
        memberId?: never;
      }
  );

const omitUndefined = <T extends Record<string, unknown>>(value: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;

const toPolarTokenUsageEvent = (input: TokenUsageEventInput): Events => {
  const {
    timestamp,
    organizationId,
    externalId,
    parentId,
    customerId,
    memberId,
    externalCustomerId,
    externalMemberId,
    tokens,
    model,
    cacheHit,
  } = input;

  const metadata = omitUndefined({ tokens, model, cacheHit });

  if ("customerId" in input) {
    return {
      timestamp,
      organizationId,
      externalId,
      parentId,
      customerId,
      memberId,
      name: "token-usage",
      metadata,
    };
  }

  return {
    timestamp,
    organizationId,
    externalId,
    parentId,
    externalCustomerId,
    externalMemberId,
    name: "token-usage",
    metadata,
  };
};

export class TokenUsageEvent implements EventsIngest {
  readonly events: Array<Events>;

  constructor(input: TokenUsageEventInput) {
    this.events = [toPolarTokenUsageEvent(input)];
  }
}
```

This supports:

```ts
await client.events.ingest(
  new TokenUsageEvent({
    externalCustomerId: "user_123",
    model: "gpt-5.5",
    tokens: 100_000,
  }),
);
```

### Alternative raw event class option

Emit `TokenUsageEvent` as a single event item instead:

```ts
await client.events.ingest({
  events: [
    new TokenUsageEvent({
      externalCustomerId: "user_123",
      model: "gpt-5.5",
      tokens: 100_000,
    }),
  ],
});
```

This is closer to the SDK shape, but less ergonomic than the desired API.

## Input Shape and Reserved Metadata Keys

The desired runtime constructor flattens event metadata fields next to Polar event envelope fields:

```ts
new TokenUsageEvent({
  externalCustomerId: "user_123",
  model: "gpt-5.5",
  tokens: 100_000,
});
```

Because of this, metadata keys that collide with envelope fields are ambiguous:

- `timestamp`
- `organizationId`
- `externalId`
- `parentId`
- `customerId`
- `memberId`
- `externalCustomerId`
- `externalMemberId`
- `name`
- `metadata`
- `events`

For now, do not add JSON Schema validation or rejection for these collisions. Document the limitation and keep collision handling as an open design question. If collisions become important, switch to a nested metadata constructor shape:

```ts
new TokenUsageEvent({
  externalCustomerId: "user_123",
  metadata: {
    model: "gpt-5.5",
    tokens: 100_000,
  },
});
```

But start with the flattened constructor because it is the desired ergonomic shape.

## Implementation Areas

### `src/resources/event.ts`

Add:

- `Event` class.
- Store the user-supplied JSON Schema as-is.
- Best-effort JSON Schema interpretation for metadata refs and code generation.
- Event metadata refs exposed via `event.metadata.<key>`.
- Event definition registry for code generation.

### `src/resources/meter.ts`

Add:

- `eventName(event)` overload.
- Aggregation helper overloads for event metadata refs: `sum(ref)`, `max(ref)`, `min(ref)`, `avg(ref)`, `unique(ref)`.
- Optional support for `filter: MeterFilterClause`.
- Normalization from event metadata ref to `metadata.<key>`.

### `src/services/config-loader.ts`

Currently only desired resources are loaded from the resource registry:

```ts
return getResources().map((resource) => resource.toDesiredResource());
```

Add support for separately collected event definitions so code generation can see non-resource event contracts.

Possible return shape evolution:

```ts
type LoadedConfig = {
  readonly desiredResources: ReadonlyArray<DesiredResource>;
  readonly eventDefinitions: ReadonlyArray<EventDefinition>;
};
```

This may require touching plan/deploy/generate command boundaries.

### `src/services/code-generator.ts`

Extend runtime generation to render event classes in addition to current runtime resource exports:

```ts
export const products = { ... } as const;
export const meters = { ... } as const;
export const benefits = { ... } as const;

export class TokenUsageEvent implements EventsIngest { ... }
```

Runtime event type generation should come from the interpreted JSON Schema fields, including optional field handling:

```ts
required field: key: T;
optional field: key?: T | undefined;
```

### `src/index.ts`

Export the new public API:

```ts
export { Event } from "./resources/event.js";
```

and relevant types.

## Open Questions

1. Should generated runtime classes be ingest request wrappers or raw event objects?
   - Wrapper preserves `client.events.ingest(new TokenUsageEvent(...))`.
   - Raw event object better matches SDK semantics.

2. How should PAC accept Zod/ArkType/etc. schemas while remaining JSON Schema-based internally?
   - Direct JSON Schema only for the first implementation?
   - Built-in Zod support?
   - Adapter helper?

3. Should optional numeric metadata refs be accepted by `sum`, `avg`, `min`, and `max`?

4. How should flattened constructor collisions with Polar envelope fields be handled?
   - No validation initially.
   - Possible future nested `metadata: { ... }` constructor shape.

5. How should class names be derived?
   - `token-usage` -> `TokenUsageEvent`.
   - Need collision detection.

## Suggested Iteration Order

1. Add `Event` definition object and event registry.
2. Store event metadata JSON Schema as-is and add best-effort field interpretation.
3. Add metadata refs so `tokenUsageEvent.metadata.tokens` works when keys can be interpreted.
4. Add meter helper overloads so `eventName(event)` and `sum(event.metadata.tokens)` work.
5. Allow `MeterConfig.filter` to accept a single clause.
6. Add tests for desired meter spec output.
7. Extend config loading to retain event definitions.
8. Generate one runtime event wrapper class from interpreted JSON Schema fields.
9. Add tests for required and optional metadata type generation.
10. Add tests asserting generated runtime class satisfies Polar SDK `EventsIngest` shape.
11. Refine naming, schema adapters, collision handling, and batch ergonomics.
