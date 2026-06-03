import { errorDiagnostic, type Diagnostic } from "./diagnostic.js";
import type { Operation, ResourceChange } from "./plan.js";

const unique = <A>(values: ReadonlyArray<A>): ReadonlyArray<A> => [...new Set(values)];

export const addResourceOperationDependencies = (
  changes: ReadonlyArray<ResourceChange>,
  operations: ReadonlyArray<Operation>,
): ReadonlyArray<Operation> => {
  const operationIdsByAddress = new Map(
    changes.map((change) => [change.address, change.operations] as const),
  );

  return operations.map((operation) => {
    const change = changes.find((item) => item.address === operation.address);
    if (change === undefined || change.dependsOn.length === 0) return operation;

    const resourceOperationDependencies = change.dependsOn.flatMap(
      (address) => operationIdsByAddress.get(address) ?? [],
    );

    return {
      ...operation,
      dependsOn: unique([...operation.dependsOn, ...resourceOperationDependencies]),
    };
  });
};

export const orderOperations = (
  operations: ReadonlyArray<Operation>,
): {
  readonly operations: ReadonlyArray<Operation>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
} => {
  const byId = new Map(operations.map((operation) => [operation.id, operation] as const));
  const pending = new Set(byId.keys());
  const ordered: Array<Operation> = [];

  while (pending.size > 0) {
    const ready = [...pending]
      .map((id) => byId.get(id))
      .filter((operation): operation is Operation => operation !== undefined)
      .filter((operation) =>
        operation.dependsOn.every(
          (dependency) => !byId.has(dependency) || !pending.has(dependency),
        ),
      )
      .sort((left, right) => left.id.localeCompare(right.id));

    if (ready.length === 0) {
      return {
        operations,
        diagnostics: [
          errorDiagnostic({
            code: "PAAC_OPERATION_DEPENDENCY_CYCLE",
            message: "Operation dependency graph contains a cycle and cannot be safely ordered.",
          }),
        ],
      };
    }

    for (const operation of ready) {
      pending.delete(operation.id);
      ordered.push(operation);
    }
  }

  return { operations: ordered, diagnostics: [] };
};
