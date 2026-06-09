# Executor Plan

## Goal

Implement an `Executor` service that takes an ordered array of operations and applies them to Polar.

Pipeline:

```ts
Planner.plan(input) -> Plan
OperationPlanner.create(plan) -> ReadonlyArray<Operation>
Executor.execute(operations) -> void
```

The executor should not calculate diffs or operation ordering. It receives an already ordered operation list and is responsible for running it safely.

## Inputs

```ts
readonly execute: (operations: ReadonlyArray<Operation>) => Effect.Effect<void>
```

`Operation` already contains:

- operation id
- resource address
- resource kind
- action
- rollback / compensation action

Supported action tags:

```ts
CreateMeter;
UpdateMeter;
ArchiveMeter;
CreateProduct;
UpdateProduct;
ArchiveProduct;
```

Payloads are Polar-shaped operation payloads produced by resource adapters.

## Responsibilities

Executor owns:

- resolving symbolic refs inside operation actions/payloads
- maintaining resource bindings
- dispatching actions to `PolarClient`
- recording returned Polar IDs after successful operations
- maintaining a rollback stack
- executing rollback/compensation actions in reverse order on failure
- surfacing execution failures

Executor does **not** own:

- diffing desired/current resources
- validating dependency graph
- ordering operations
- deciding which fields changed
- creating operation payloads

## Symbolic references

Operation payloads may contain refs:

```ts
{
  _tag: "Ref",
  address: "meter.requests",
  field: "polarId"
}
```

Example product create payload:

```ts
{
  _tag: "CreateProduct",
  payload: {
    prices: [
      {
        amountType: "metered_unit",
        meterId: {
          _tag: "Ref",
          address: "meter.requests",
          field: "polarId"
        }
      }
    ]
  }
}
```

Executor resolves refs generically before dispatching an action.

## Bindings

Executor should maintain a bindings table:

```ts
type ResourceBinding = {
  readonly polarId: string;
};

const bindings = new Map<ResourceAddress, ResourceBinding>();
```

Bindings are updated after successful operations:

```txt
CreateMeter meter.requests returns id met_123
bindings[meter.requests] = { polarId: "met_123" }
```

Then later refs can resolve against this table.

## Ref resolution

Ref resolution is driven by a global execution-local bindings map.

Conceptually:

```ts
for (const operation of operations) {
  const resolvedAction = resolveRefs(operation.action, bindings);
  const result = executeResolvedAction(resolvedAction);
  recordBinding(operation.address, result);
}
```

`bindings` holds resource outputs discovered before or during execution:

```ts
const bindings = new Map<ResourceAddress, { polarId: string }>();
```

When an operation is about to execute, its action/payload is traversed and a new fully resolved action is produced. This resolved action is what is supplied to the Polar SDK call.

Implement generic recursive resolution:

```ts
resolveRefs(value, bindings);
```

Rules:

1. Primitive values return unchanged.
2. Arrays resolve each element.
3. Plain objects resolve each property.
4. If an object is an `OperationRef`, resolve it from `bindings`.
5. If a referenced binding is missing, fail immediately because execution cannot proceed safely.

Example ref-aware payload:

```ts
{
  amountType: "metered_unit",
  meterId: {
    _tag: "Ref",
    address: "meter.requests",
    field: "polarId"
  },
  unitAmount: "0.01"
}
```

Given bindings:

```ts
bindings.set("meter.requests", { polarId: "met_123" });
```

The resolved payload becomes:

```ts
{
  amountType: "metered_unit",
  meterId: "met_123",
  unitAmount: "0.01"
}
```

If the binding is missing, execution should fail with a tagged error such as:

```txt
Cannot resolve ref meter.requests.polarId
```

and rollback should start for already-successful operations.

For now refs only support:

```ts
field: "polarId";
```

Important nuance: bindings are not “all refs”. Bindings are known resource outputs:

```txt
address -> fields known from current state or execution result
```

Currently that means:

```ts
{
  polarId: "...";
}
```

Later this can grow if we need richer references:

```ts
{
  polarId: "prod_123",
  priceIdsByKey: { /* ... */ }
}
```

## Resolved action types

Operation actions are ref-aware because operation payloads may contain values such as:

```ts
meterId: {
  _tag: "Ref",
  address: "meter.requests",
  field: "polarId"
}
```

The executor should resolve those into a separate internal resolved action type before dispatching to `PolarClient`.

Conceptually:

```ts
OperationAction; // ref-aware operation AST
ResolvedOperationAction; // no refs, safe to pass to PolarClient
```

A useful type-level model is a recursive `DeepResolved<T>`:

```ts
type DeepResolved<T> = T extends OperationRef
  ? string
  : T extends ReadonlyArray<infer A>
    ? ReadonlyArray<DeepResolved<A>>
    : T extends object
      ? { readonly [K in keyof T]: DeepResolved<T[K]> }
      : T;
```

Then:

```ts
type ResolvedOperationAction = DeepResolved<OperationAction>;
```

Example ref-aware action:

```ts
{
  _tag: "CreateProduct",
  payload: {
    prices: [
      {
        amountType: "metered_unit",
        meterId: {
          _tag: "Ref",
          address: "meter.requests",
          field: "polarId"
        }
      }
    ]
  }
}
```

After resolution it is typed/structured as:

```ts
{
  _tag: "CreateProduct",
  payload: {
    prices: [
      {
        amountType: "metered_unit",
        meterId: "met_123"
      }
    ]
  }
}
```

Runtime resolver shape:

```ts
const resolveRefs = <A>(
  value: A,
  bindings: ResourceBindings,
): Effect.Effect<DeepResolved<A>, ExecutorRefResolutionError>
```

Executor flow:

```ts
const resolvedAction = yield * resolveRefs(operation.action, bindings);
yield * executeResolvedAction(resolvedAction);
```

`executeResolvedAction` should only accept fully resolved actions:

```ts
const executeResolvedAction = (action: ResolvedOperationAction) => {
  switch (action._tag) {
    case "CreateProduct":
      return polar.createProduct(action.payload);

    case "UpdateProduct":
      return polar.updateProduct(action.id, action.payload);

    case "ArchiveProduct":
      return polar.updateProduct(action.id, action.payload);

    // etc.
  }
};
```

Keep these resolved types private to `executor.ts` unless tests need them. The operation program should remain ref-aware; resolution happens just-in-time before dispatch.

## Action dispatch

After ref resolution, execution should be centralized in the `Executor`, not delegated back to resource adapters.

Adapters own deterministic lowering:

```ts
createOperationsFromPlan(...) -> Operation[]
```

Executor owns side effects:

```ts
execute(operations) -> void
```

At execution time the action is already concrete and Polar-shaped:

```ts
{
  _tag: "CreateProduct",
  payload: { /* ProductCreate-shaped payload */ }
}
```

So the executor can use a centralized dispatch table / switch:

```ts
switch (action._tag) {
  case "CreateProduct":
    return polar.createProduct(action.payload);

  case "UpdateProduct":
    return polar.updateProduct(action.id, action.payload);

  case "ArchiveProduct":
    return polar.updateProduct(action.id, action.payload);
  // or polar.archiveProduct(action.id)

  case "CreateMeter":
    return polar.createMeter(action.payload);

  case "UpdateMeter":
    return polar.updateMeter(action.id, action.payload);

  case "ArchiveMeter":
    return polar.updateMeter(action.id, action.payload);
  // or polar.archiveMeter(action.id)
}
```

Why centralized dispatch is preferred:

1. Adapters remain deterministic/pure-ish and only create operation actions.
2. Executor is the only service performing IO.
3. Ref resolution, bindings, rollback, and error wrapping all stay in one place.
4. Operations are already provider-specific (`CreateProduct`, `UpdateMeter`, etc.), so resource adapters do not need to be involved again.
5. Hidden side effects inside adapters would make rollback behavior harder to reason about.

Current `PolarClient` exposes:

```ts
createMeter(payload);
updateMeter(id, payload);
archiveMeter(id);
createProduct(payload);
updateProduct(id, payload);
archiveProduct(id);
```

Archive operation payloads currently look like:

```ts
{
  isArchived: true;
}
```

But `PolarClient.archive*` already encodes that internally. We can choose either:

1. dispatch `Archive*` through `polar.archive*`, ignoring payload, or
2. dispatch through `polar.update*(id, payload)`.

Prefer option 2 if we want the operation payload to fully describe what gets sent to Polar. Prefer option 1 if we want to keep client methods semantic.

Decision still open.

If PAC later supports multiple providers, we may introduce a provider-specific action executor registry. But this should still be separate from resource adapters.

## Rollback / compensation

Operation execution is not transactional. Rollback means best-effort compensation.

Each operation has:

```ts
rollback:
  | { _tag: "RollbackOperation"; action: OperationAction }
  | { _tag: "NoopRollback"; reason: string }
  | { _tag: "UnsupportedRollback"; reason: string }
```

Execution should maintain a completed rollback stack, not just an index into the original operations array.

Reason: rollback should only include operations that actually succeeded **and** have a usable compensation.

The original operations array is not enough because:

1. Some operations may have `NoopRollback` or `UnsupportedRollback`.
2. A failing operation may fail after ref resolution but before Polar confirms success; it should not be rolled back unless the executor knows it succeeded.
3. Rollbacks are explicit compensation actions, not the original operation run backwards.
4. Some rollback actions contain runtime refs that only become valid after the forward operation succeeds.

First-pass execution flow:

```ts
const rollbackStack: Array<OperationAction> = [];

for (const operation of operations) {
  try {
    const resolvedAction = resolveRefs(operation.action, bindings);
    const result = executeResolvedAction(resolvedAction);

    recordBinding(operation.address, result);

    if (operation.rollback._tag === "RollbackOperation") {
      rollbackStack.push(operation.rollback.action);
    }
  } catch (error) {
    for (const rollbackAction of rollbackStack.reverse()) {
      const resolvedRollback = resolveRefs(rollbackAction, bindings);
      executeResolvedAction(resolvedRollback);
    }
    throw error;
  }
}
```

A richer future representation may be useful:

```ts
type CompletedOperation = {
  readonly operation: Operation;
  readonly result: unknown;
  readonly rollback: RollbackAction;
};
```

But the first pass can store just:

```ts
Array<OperationAction>;
```

Important: rollback actions may also contain refs, such as archiving a just-created resource:

```ts
{
  _tag: "ArchiveMeter",
  id: {
    _tag: "Ref",
    address: "meter.requests",
    field: "polarId"
  },
  payload: { isArchived: true }
}
```

Those refs should resolve using bindings recorded during forward execution.

## Error handling

Use tagged errors.

Likely errors:

```ts
ExecutorRefResolutionError;
ExecutorActionError;
ExecutorRollbackError;
```

Potential shape:

```ts
class ExecutorRefResolutionError extends Schema.TaggedErrorClass<...>()(
  "ExecutorRefResolutionError",
  {
    operationId: Schema.optional(Schema.String),
    address: ResourceAddressSchema,
    field: Schema.String,
    message: Schema.String,
  }
) {}
```

Execution errors from `PolarClient` can either pass through or be wrapped with operation context.

## First implementation slice

1. Add executor tests with a fake `PolarClient` layer.
2. Implement generic `resolveRefs`.
3. Execute `CreateMeter`, `UpdateMeter`, `CreateProduct`, `UpdateProduct`.
4. Record bindings from returned `id` fields.
5. Execute archive actions.
6. Add rollback stack behavior.
7. Add tests for:
   - product create resolves meter ref from previous create
   - missing ref fails
   - failure triggers rollback in reverse order
   - rollback actions resolve refs

## Open questions

- Should archive dispatch use `polar.archive*` or `polar.update*(id, payload)`?
- Should executor seed bindings from current resources, or should operation IDs already be literal for current resources?
- Should rollback failures be accumulated/suppressed or fail immediately?
- Should executor return an execution report instead of `void` later?
