# Operation Planner Plan

## Goal

Introduce an `OperationPlanner` stage between the semantic `Plan` graph and actual Polar execution.

The planner pipeline should become:

```ts
Planner.plan(input) -> Plan
OperationPlanner.create(plan) -> ReadonlyArray<Operation>
Executor.execute(operations) -> ExecutionResult
```

## Responsibilities

### `Planner`

The existing `Planner` should stay semantic and graph-oriented.

It owns:

- matching desired/current resources by address
- create/update/archive/noop/block decisions
- field-level diffing through resource adapters
- dependency graph construction
- dependency validation
- blocking diagnostics
- cycle detection

It should **not** calculate an executable operation sequence.

### `OperationPlanner`

`OperationPlanner` takes a produced `Plan` and outputs an ordered array of operations.

It owns:

- rejecting or blocking plans with error diagnostics / blocked nodes
- topological ordering of executable plan nodes
- lifecycle-aware dependency ordering
- lowering plan nodes into operation objects
- producing symbolic references for values known only during execution

### `Executor`

The executor takes the operation array and actually calls Polar.

It owns:

- resolving symbolic references at execution time
- maintaining resource bindings such as `ResourceAddress -> polarId`
- seeding bindings from current resources
- recording outputs from create/update calls
- invoking Polar API methods
- surfacing execution errors

## Operation shape

Operations should be a discriminated union of concrete-ish operation types, not `any` long-term.

Example direction:

```ts
export type Operation =
  | CreateMeterOperation
  | UpdateMeterOperation
  | ArchiveMeterOperation
  | CreateProductOperation
  | UpdateProductOperation
  | ArchiveProductOperation;
```

The operations should be close to Polar API actions/payloads, but allow symbolic refs where values are only known after earlier operations execute.

## Symbolic references

We know we will need symbolic references.

Example: creating a product with a metered price may need the Polar ID of a meter that is created earlier in the same operation batch.

Represent this explicitly:

```ts
export type OperationRef = {
  readonly _tag: "Ref";
  readonly address: ResourceAddress;
  readonly field: "polarId";
};

export type Resolvable<T> = T | OperationRef;
```

Example operation payload:

```ts
{
  _tag: "CreateProduct",
  address: "product.pro",
  payload: {
    name: "Pro",
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

The operation is concrete enough to preview the API-shaped work, but still executable when IDs are discovered at runtime.

## Executor bindings

The executor should maintain a bindings table:

```ts
const bindings = new Map<ResourceAddress, { polarId: string }>();
```

Seed it from current resources before running operations:

```txt
meter.requests  -> existing Polar meter ID
product.pro     -> existing Polar product ID
```

After create/update operations return remote objects, update bindings:

```txt
CreateMeter meter.requests returns id met_123
bindings[meter.requests] = { polarId: "met_123" }
```

Later operations can resolve refs against this table.

## Ordering rules

Current edge meaning:

```ts
{ _tag: "DependsOn", from: "product.pro", to: "meter.requests" }
```

means:

```txt
product.pro depends on meter.requests
```

Operation ordering is lifecycle-aware:

- for create/update, dependency first
  - `meter.requests` before `product.pro`
- for archive, dependent first
  - `product.pro` before `meter.requests`

This ordering belongs in `OperationPlanner`, not `Planner`.

## Rejected alternative: purely semantic operations

A simpler operation shape would mirror plan nodes:

```ts
{
  _tag: ("Create", desired);
}
{
  _tag: ("Update", desired, current, changes);
}
{
  _tag: ("Archive", current);
}
```

Drawbacks:

- executor becomes responsible for most lowering
- dry-run output cannot show API-shaped payloads
- final API payload tests cannot live at the operation-planner boundary
- symbolic references still need to be invented later

Because symbolic references are definitely required, operations should move toward concrete API-shaped actions now, with refs built in from the beginning.

## Reverse / rollback operations

Operation execution is not transactional because Polar is an external API. Rollback should therefore be represented as **compensating operations**, not as a perfect inverse.

Each operation should eventually carry its rollback/compensation action:

```ts
export type Operation = {
  readonly id: string;
  readonly address: ResourceAddress;
  readonly action: OperationAction;
  readonly rollback: RollbackAction;
};

export type RollbackAction =
  | { readonly _tag: "RollbackOperation"; readonly action: OperationAction }
  | { readonly _tag: "NoopRollback"; readonly reason: string }
  | { readonly _tag: "UnsupportedRollback"; readonly reason: string };
```

`OperationAction` is the concrete-ish API action union:

```ts
export type OperationAction =
  | CreateMeterAction
  | UpdateMeterAction
  | ArchiveMeterAction
  | CreateProductAction
  | UpdateProductAction
  | ArchiveProductAction;
```

Example update with rollback:

```ts
{
  id: "op_2",
  address: "product.pro",
  action: {
    _tag: "UpdateProduct",
    id: "prod_123",
    payload: {
      name: "New name"
    }
  },
  rollback: {
    _tag: "RollbackOperation",
    action: {
      _tag: "UpdateProduct",
      id: "prod_123",
      payload: {
        name: "Old name"
      }
    }
  }
}
```

Example create with rollback that uses a runtime ref:

```ts
{
  id: "op_1",
  address: "meter.requests",
  action: {
    _tag: "CreateMeter",
    payload: { /* ... */ }
  },
  rollback: {
    _tag: "RollbackOperation",
    action: {
      _tag: "ArchiveMeter",
      id: {
        _tag: "Ref",
        address: "meter.requests",
        field: "polarId"
      }
    }
  }
}
```

Execution should maintain a rollback stack. After an operation succeeds, push its rollback action if it has one. If a later operation fails, walk the stack backwards and execute compensations:

```ts
const rollbackStack: Array<OperationAction> = [];

for (const operation of operations) {
  try {
    const result = await execute(operation.action);
    recordBindings(operation.address, result);

    if (operation.rollback._tag === "RollbackOperation") {
      rollbackStack.push(operation.rollback.action);
    }
  } catch (error) {
    for (const rollback of rollbackStack.reverse()) {
      await execute(rollback);
    }
    throw error;
  }
}
```

Expected compensation shapes:

- `CreateX` rollback: usually `ArchiveX` using the created resource's returned `polarId`.
- `UpdateX` rollback: `UpdateX` with previous/current field values.
- `ArchiveX` rollback: possibly `UpdateX({ is_archived: false })` if Polar supports unarchiving.
- Some actions may be `UnsupportedRollback` if no safe compensation exists.

The rollback belongs in the operation AST rather than being hidden in executor logic. `OperationPlanner` has access to desired/current state and can construct the most accurate compensation payload.

## Plan-to-operations algorithm

The operation planner should transform a `Plan` graph into an ordered operation array through explicit intermediate structures.

Do **not** lower directly from plan nodes to a flat `Operation[]`. Instead, lower plan nodes into operation groups first.

```ts
type OperationId = string;

type OperationGroup = {
  readonly address: ResourceAddress;
  readonly node: CreatePlanNode | UpdatePlanNode | ArchivePlanNode;
  readonly operations: ReadonlyArray<Operation>;

  // Boundary ids for dependency constraints.
  readonly firstOperationId: OperationId;
  readonly lastOperationId: OperationId;
};

type OperationConstraint = {
  readonly before: OperationId;
  readonly after: OperationId;
  readonly reason: string;
};
```

`OperationConstraint` means:

```txt
before must execute before after
```

The high-level algorithm:

```ts
const groups = lowerNodes(plan.nodes);
const constraints = buildConstraints(plan.edges, groups);
const operations = flattenGroups(groups);
const sorted = topoSort(operations, constraints);

return sorted;
```

A more complete internal shape could be:

```ts
type LoweredPlan = {
  readonly groups: ReadonlyArray<OperationGroup>;
  readonly groupsByAddress: ReadonlyMap<ResourceAddress, OperationGroup>;
  readonly operations: ReadonlyArray<Operation>;
  readonly constraints: ReadonlyArray<OperationConstraint>;
};
```

### Step 1: reject non-executable plans

Before creating operations, reject plans with blocked nodes or error diagnostics:

```ts
const blockedNodes = nodes.filter((node) => node._tag === "Blocked");
const errorDiagnostics = plan.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

if (blockedNodes.length > 0 || errorDiagnostics.length > 0) {
  return Effect.fail(new PlanNotExecutable(/* ... */));
}
```

Warnings should not block operation creation.

### Step 2: skip noops

Only these plan nodes become operation groups:

```ts
Create;
Update;
Archive;
```

`Noop` nodes are rendered for humans but do not produce executable operations.

### Step 3: lower executable nodes into groups

Initially, one executable plan node can become one operation:

```txt
Create meter   -> CreateMeter operation
Update meter   -> UpdateMeter operation
Archive meter  -> ArchiveMeter operation
Create product -> CreateProduct operation
Update product -> UpdateProduct operation
Archive product -> ArchiveProduct operation
```

But the implementation should still use `OperationGroup`, because later one plan node may lower to multiple operations.

Example future product update group:

```txt
product.pro update group:
  op_10 update product base fields
  op_11 archive old price
  op_12 create new price
```

External dependency constraints should target group boundaries instead of knowing internal operation details.

### Step 4: convert plan edges into operation constraints

Current plan edge meaning:

```ts
{ _tag: "DependsOn", from: "product.pro", to: "meter.requests" }
```

means:

```txt
product.pro depends on meter.requests
```

If both resources are being created or updated, the dependency must happen first:

```txt
meter.requests before product.pro
```

So add a constraint from the dependency group to the dependent group:

```ts
constraints.push({
  before: meterGroup.lastOperationId,
  after: productGroup.firstOperationId,
  reason: "product.pro depends on meter.requests",
});
```

For archive, the dependent should be archived before the dependency:

```txt
product.pro before meter.requests
```

So add the opposite lifecycle constraint:

```ts
constraints.push({
  before: productGroup.lastOperationId,
  after: meterGroup.firstOperationId,
  reason: "archive dependent before dependency",
});
```

This keeps deletion/archive ordering safe.

### Step 5: topologically sort operations

Topologically sort the flattened operation list using `OperationConstraint[]`.

Suggested signature:

```ts
topoSort(
  operations: ReadonlyArray<Operation>,
  constraints: ReadonlyArray<OperationConstraint>,
): ReadonlyArray<Operation>
```

Use operation IDs as graph nodes.

Use deterministic tie-breaking, preferably original plan-node insertion order / operation creation order.

### Step 6: defensive cycle check

The `Planner` should already block dependency cycles, but `OperationPlanner` should still treat operation-order cycles as non-executable:

```ts
if (sorted.length !== operations.length) {
  return Effect.fail(new PlanNotExecutable(/* operation ordering cycle */));
}
```

This catches bugs in lowering or lifecycle constraint construction.

## Incremental implementation path

1. Keep the current empty `OperationPlanner` service scaffold.
2. Replace `Operation = any` with an initial discriminated union.
3. Add `OperationRef` and `Resolvable<T>`.
4. Add operation types for meters first:
   - `CreateMeterOperation`
   - `UpdateMeterOperation`
   - `ArchiveMeterOperation`
5. Add operation types for products:
   - `CreateProductOperation`
   - `UpdateProductOperation`
   - `ArchiveProductOperation`
6. Implement ordering from the plan graph.
7. Add lowering from plan nodes to operations.
8. Add tests asserting operation arrays for representative plans.
9. Implement executor reference resolution and Polar calls separately.
