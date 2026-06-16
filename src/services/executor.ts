import { Effect, Exit, Layer, Schema } from "effect";
import * as Context from "effect/Context";
import { ResourceAddress as ResourceAddressSchema, type ResourceAddress } from "../core/address.js";
import type { OperationProgram } from "../types/operation-planner-types.js";
import type { OperationAction } from "../operations/actions.js";
import type { ResourceBinding } from "../operations/bindings.js";
import {
  isDestructiveOperation,
  OperationDestructiveness,
  type Operation,
} from "../operations/operation.js";
import type { OperationRef } from "../operations/ref.js";
import { PolarClient, PolarClientError } from "./polar-client.js";

export type { ResourceBinding, ResourceBindings } from "../operations/bindings.js";

export class ExecutorRefResolutionError extends Schema.TaggedErrorClass<ExecutorRefResolutionError>()(
  "ExecutorRefResolutionError",
  {
    address: ResourceAddressSchema,
    field: Schema.Literal("polarId"),
    message: Schema.String,
  },
) {}

export class DestructiveOperationRejected extends Schema.TaggedErrorClass<DestructiveOperationRejected>()(
  "DestructiveOperationRejected",
  {
    operationId: Schema.String,
    address: ResourceAddressSchema,
    action: Schema.String,
    reason: Schema.String,
    message: Schema.String,
  },
) {}

export type ExecutorOptions<E = never, R = never> = {
  readonly allowDestructive?: boolean;
  readonly confirmDestructive?: (operation: Operation) => Effect.Effect<boolean, E, R>;
};

type DeepResolved<T> = T extends OperationRef
  ? string
  : T extends ReadonlyArray<infer A>
    ? ReadonlyArray<DeepResolved<A>>
    : T extends object
      ? { readonly [K in keyof T]: DeepResolved<T[K]> }
      : T;

type ResolvedOperationAction = DeepResolved<OperationAction>;

type ExecutorError = ExecutorRefResolutionError | PolarClientError;

type ExecutorFailure = ExecutorError | DestructiveOperationRejected;

type ExecutionBindings = Map<ResourceAddress, ResourceBinding>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isOperationRef = (value: unknown): value is OperationRef =>
  isRecord(value) &&
  value._tag === "Ref" &&
  typeof value.address === "string" &&
  value.field === "polarId";

const resolveRefs = <A>(
  value: A,
  bindings: ExecutionBindings,
): Effect.Effect<DeepResolved<A>, ExecutorRefResolutionError> =>
  Effect.gen(function* () {
    if (isOperationRef(value)) {
      const binding = bindings.get(value.address);
      if (binding === undefined) {
        return yield* new ExecutorRefResolutionError({
          address: value.address,
          field: value.field,
          message: `Cannot resolve ref ${value.address}.${value.field}.`,
        });
      }

      return binding[value.field] as DeepResolved<A>;
    }

    if (Array.isArray(value)) {
      const resolved: Array<DeepResolved<A>> = [];
      for (const item of value) {
        resolved.push(yield* resolveRefs(item, bindings));
      }
      return resolved as DeepResolved<A>;
    }

    if (isRecord(value)) {
      const resolved: Record<string, unknown> = {};
      for (const [key, entryValue] of Object.entries(value)) {
        resolved[key] = yield* resolveRefs(entryValue, bindings);
      }
      return resolved as DeepResolved<A>;
    }

    return value as DeepResolved<A>;
  });

const recordBinding = (
  address: ResourceAddress,
  result: unknown,
  bindings: ExecutionBindings,
): void => {
  if (isRecord(result) && typeof result.id === "string") {
    bindings.set(address, { polarId: result.id });
  }
};

export class Executor extends Context.Service<
  Executor,
  {
    readonly execute: <E = never, R = never>(
      program: OperationProgram,
      options?: ExecutorOptions<E, R>,
    ) => Effect.Effect<void, ExecutorFailure | E, R>;
  }
>()("@app/Executor") {
  static readonly layer = Layer.effect(
    Executor,
    Effect.gen(function* () {
      const polar = yield* PolarClient;

      const executeResolvedAction = (
        action: ResolvedOperationAction,
      ): Effect.Effect<unknown, PolarClientError> => {
        switch (action._tag) {
          case "CreateMeter":
            return polar.createMeter(
              action.payload as unknown as Parameters<typeof polar.createMeter>[0],
            );

          case "UpdateMeter":
            return polar.updateMeter(
              action.id,
              action.payload as Parameters<typeof polar.updateMeter>[1],
            );

          case "ArchiveMeter":
            return polar.archiveMeter(action.id);

          case "CreateBenefit":
            return polar.createBenefit(
              action.payload as unknown as Parameters<typeof polar.createBenefit>[0],
            );

          case "UpdateBenefit":
            return polar.updateBenefit(
              action.id,
              action.payload as Parameters<typeof polar.updateBenefit>[1],
            );

          case "DeleteBenefit":
            return polar.deleteBenefit(action.id);

          case "CreateProduct":
            return polar.createProduct(
              action.payload as unknown as Parameters<typeof polar.createProduct>[0],
            );

          case "UpdateProduct":
            return polar.updateProduct(
              action.id,
              action.payload as Parameters<typeof polar.updateProduct>[1],
            );

          case "ArchiveProduct":
            return polar.archiveProduct(action.id);

          case "UpdateProductBenefits":
            return polar.updateProductBenefits(action.id, action.payload.benefits);
        }
      };

      const rollback = (
        rollbackStack: ReadonlyArray<OperationAction>,
        bindings: ExecutionBindings,
      ): Effect.Effect<void, ExecutorError> =>
        Effect.forEach(
          [...rollbackStack].reverse(),
          (action) =>
            Effect.gen(function* () {
              const resolvedAction = yield* resolveRefs(action, bindings);
              yield* executeResolvedAction(resolvedAction);
            }),
          { discard: true },
        );

      const executeOperation = (
        operation: Operation,
        bindings: ExecutionBindings,
      ): Effect.Effect<Exit.Exit<unknown, ExecutorError>> =>
        Effect.exit(
          Effect.gen(function* () {
            const resolvedAction = yield* resolveRefs(operation.action, bindings);
            const result = yield* executeResolvedAction(resolvedAction);
            recordBinding(operation.address, result, bindings);
            return result;
          }),
        );

      const confirmOperation = <E, R>(
        operation: Operation,
        options: ExecutorOptions<E, R> | undefined,
      ): Effect.Effect<void, DestructiveOperationRejected | E, R> =>
        Effect.gen(function* () {
          if (!isDestructiveOperation(operation) || options?.allowDestructive === true) {
            return;
          }

          const confirmed = options?.confirmDestructive
            ? yield* options.confirmDestructive(operation)
            : false;

          if (confirmed) {
            return;
          }

          const destructiveness = operation.destructiveness;
          return yield* new DestructiveOperationRejected({
            operationId: operation.id,
            address: operation.address,
            action: operation.action._tag,
            reason: OperationDestructiveness.guards.Destructive(destructiveness)
              ? destructiveness.reason
              : "",
            message: `Destructive operation ${operation.action._tag} on ${operation.address} was not confirmed.`,
          });
        });

      const executeOperations = <E, R>(
        operations: ReadonlyArray<Operation>,
        bindings: ExecutionBindings,
        rollbackStack: Array<OperationAction>,
        options: ExecutorOptions<E, R> | undefined,
      ): Effect.Effect<Exit.Exit<void, ExecutorError>, DestructiveOperationRejected | E, R> =>
        Effect.gen(function* () {
          for (const operation of operations) {
            yield* confirmOperation(operation, options);

            const exit = yield* executeOperation(operation, bindings);

            if (Exit.isFailure(exit)) {
              return Exit.failCause(exit.cause);
            }

            if (operation.rollback._tag === "RollbackOperation") {
              rollbackStack.push(operation.rollback.action);
            }
          }

          return Exit.succeed(undefined);
        });

      return Executor.of({
        execute: (program, options) =>
          Effect.gen(function* () {
            const bindings: ExecutionBindings = new Map(program.initialBindings);
            const rollbackStack: Array<OperationAction> = [];

            const result = yield* executeOperations(
              program.operations,
              bindings,
              rollbackStack,
              options,
            );

            if (Exit.isFailure(result)) {
              yield* rollback(rollbackStack, bindings);
              return yield* Effect.failCause(result.cause);
            }
          }),
      });
    }),
  );
}
