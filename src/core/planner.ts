import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { AdapterRegistry, type AdapterRegistryShape } from "./adapter-registry.js";
import type { ResourceAdapter } from "./adapter.js";
import type { ResourceAddress } from "./address.js";
import { errorDiagnostic, type Diagnostic } from "./diagnostic.js";
import { diffJson, type FieldDiff } from "./diff.js";
import type { FieldRule } from "./field-semantics.js";
import type { ManagedIdentity } from "./metadata.js";
import { addResourceOperationDependencies, orderOperations } from "./graph.js";
import { type Operation, type Plan, type ResourceAction, type ResourceChange, summarizeChanges } from "./plan.js";
import type { CanonicalResource, DesiredResource } from "./resource.js";

export type PlanInput = {
  readonly desired: ReadonlyArray<DesiredResource>;
};

export type PlannerShape = {
  readonly buildPlan: (input: PlanInput) => Effect.Effect<Plan, Error>;
};

type ManagedRemote = {
  readonly adapter: ResourceAdapter<unknown>;
  readonly identity: ManagedIdentity;
  readonly remote: unknown;
};

type NormalizeResult =
  | { readonly _tag: "success"; readonly resource: CanonicalResource }
  | { readonly _tag: "failure"; readonly diagnostic: Diagnostic; readonly address: ResourceAddress; readonly kind: string };

const diagnosticForRule = (
  address: ResourceAddress,
  diff: FieldDiff,
  rule: FieldRule,
): Diagnostic | undefined => {
  if (rule.mode === "createOnly") {
    return errorDiagnostic({
      code: "PAAC_CREATE_ONLY_FIELD_CHANGED",
      message: `Field ${diff.path} can only be set during creation and cannot be safely updated.`,
      address,
      path: diff.path,
    });
  }
  if (rule.mode === "manual") {
    return errorDiagnostic({
      code: "PAAC_MANUAL_FIELD_CHANGED",
      message: rule.reason,
      address,
      path: diff.path,
    });
  }
  return undefined;
};

const classifyAction = (diffs: ReadonlyArray<FieldDiff>): ResourceAction => {
  if (diffs.length === 0) return "noop";
  if (diffs.some((diff) => diff.rule.mode === "manual" || diff.rule.mode === "createOnly")) return "blocked";
  if (diffs.some((diff) => diff.rule.mode === "replace")) return "replace";
  if (diffs.every((diff) => diff.path === "/isArchived" && diff.after === false)) return "unarchive";
  return "update";
};

const duplicateDiagnostics = (
  addresses: ReadonlyArray<ResourceAddress>,
  code: string,
  message: (address: ResourceAddress) => string,
): ReadonlyArray<Diagnostic> => {
  const counts = new Map<ResourceAddress, number>();
  for (const address of addresses) counts.set(address, (counts.get(address) ?? 0) + 1);
  return [...counts.entries()].flatMap(([address, count]) =>
    count > 1 ? [errorDiagnostic({ code, message: message(address), address })] : [],
  );
};

const byAddress = <A extends { readonly address: ResourceAddress }>(resources: ReadonlyArray<A>) =>
  new Map(resources.map((resource) => [resource.address, resource] as const));

const ManagedArchiveState = Schema.Struct({ isArchived: Schema.Boolean });
const isManagedArchiveState = Schema.is(ManagedArchiveState);

const isArchivedResource = (resource: CanonicalResource): boolean =>
  isManagedArchiveState(resource.managed) && resource.managed.isArchived;

const operationPlanner = Effect.fn("Planner.planOperations")(function* (
  registry: AdapterRegistryShape,
  changes: ReadonlyArray<ResourceChange>,
) {
  const diagnostics: Array<Diagnostic> = [];
  const operations: Array<Operation> = [];
  const changesWithOperations: Array<ResourceChange> = [];

  for (const change of changes) {
    const adapter = registry.get(change.kind);
    if (adapter === undefined) {
      diagnostics.push(
        errorDiagnostic({
          code: "PAAC_UNKNOWN_ADAPTER",
          message: `No adapter is registered for resource kind ${change.kind}.`,
          address: change.address,
        }),
      );
      changesWithOperations.push(change);
      continue;
    }

    const planned = yield* (() => {
      if (change.action === "create" && change.after !== undefined) {
        return adapter.planCreate(change.after, {}).pipe(
          Effect.match({
            onFailure: (diagnostic) => ({ _tag: "failure" as const, diagnostic }),
            onSuccess: (ops) => ({ _tag: "success" as const, ops }),
          }),
        );
      }
      if ((change.action === "update" || change.action === "unarchive") && change.after !== undefined) {
        return adapter.planUpdate(change, {}).pipe(
          Effect.match({
            onFailure: (diagnostic) => ({ _tag: "failure" as const, diagnostic }),
            onSuccess: (ops) => ({ _tag: "success" as const, ops }),
          }),
        );
      }
      if (change.action === "archive" && change.before !== undefined) {
        return adapter.planDelete(change.before, {}).pipe(
          Effect.match({
            onFailure: (diagnostic) => ({ _tag: "failure" as const, diagnostic }),
            onSuccess: (ops) => ({ _tag: "success" as const, ops }),
          }),
        );
      }
      return Effect.succeed({ _tag: "success" as const, ops: [] as ReadonlyArray<Operation> });
    })();

    if (planned._tag === "failure") {
      diagnostics.push(planned.diagnostic);
      changesWithOperations.push({ ...change, action: "blocked", operations: [] });
    } else {
      operations.push(...planned.ops);
      changesWithOperations.push({ ...change, operations: planned.ops.map((operation) => operation.id) });
    }
  }

  return { changes: changesWithOperations, operations, diagnostics };
});

export class Planner extends Context.Service<Planner, PlannerShape>()("@paac/Planner") {
  static readonly layer = Layer.effect(
    Planner,
    Effect.gen(function*() {
      const registry = yield* AdapterRegistry;

      const buildPlan = Effect.fn("Planner.buildPlan")(function* (input: PlanInput) {
        const diagnostics: Array<Diagnostic> = [];

        diagnostics.push(
          ...duplicateDiagnostics(
            input.desired.map((resource) => resource.address),
            "PAAC_DUPLICATE_DESIRED_ADDRESS",
            (address) => `Two desired resources have the same address ${address}.`,
          ),
        );

        const desiredResults: Array<NormalizeResult> = [];
        for (const desired of input.desired) {
          const adapter = registry.get(desired.kind);
          if (adapter === undefined) {
            desiredResults.push({
              _tag: "failure",
              address: desired.address,
              kind: desired.kind,
              diagnostic: errorDiagnostic({
                code: "PAAC_UNKNOWN_ADAPTER",
                message: `No adapter is registered for resource kind ${desired.kind}.`,
                address: desired.address,
              }),
            });
            continue;
          }

          desiredResults.push(
            yield* adapter.normalizeDesired(desired, {}).pipe(
              Effect.match({
                onFailure: (diagnostic): NormalizeResult => ({
                  _tag: "failure",
                  diagnostic,
                  address: desired.address,
                  kind: desired.kind,
                }),
                onSuccess: (resource): NormalizeResult => ({ _tag: "success", resource }),
              }),
            ),
          );
        }

        diagnostics.push(...desiredResults.flatMap((result) => (result._tag === "failure" ? [result.diagnostic] : [])));
        const desiredResources = desiredResults.flatMap((result) => (result._tag === "success" ? [result.resource] : []));
        const desiredByAddress = byAddress(desiredResources);

        const managedRemote: Array<ManagedRemote> = [];
        for (const adapter of registry.all() as ReadonlyArray<ResourceAdapter<unknown>>) {
          const remotes = yield* adapter.listRemote();
          for (const remote of remotes) {
            const identity = adapter.getRemoteIdentity(remote);
            if (identity._tag === "managed") {
              managedRemote.push({ adapter, identity: identity.identity, remote });
            } else if (identity._tag === "malformed") {
              diagnostics.push(identity.diagnostic);
            }
          }
        }

        diagnostics.push(
          ...duplicateDiagnostics(
            managedRemote.map((remote) => remote.identity.address),
            "PAAC_DUPLICATE_REMOTE_ADDRESS",
            (address) => `Found multiple Polar resources claiming PAAC address ${address}.`,
          ),
        );

        const remoteResults: Array<NormalizeResult> = [];
        for (const managed of managedRemote) {
          remoteResults.push(
            yield* managed.adapter.normalizeRemote(managed.remote, {}).pipe(
              Effect.match({
                onFailure: (diagnostic): NormalizeResult => ({
                  _tag: "failure",
                  diagnostic,
                  address: managed.identity.address,
                  kind: managed.identity.kind,
                }),
                onSuccess: (resource): NormalizeResult => ({ _tag: "success", resource }),
              }),
            ),
          );
        }

        diagnostics.push(...remoteResults.flatMap((result) => (result._tag === "failure" ? [result.diagnostic] : [])));
        const remoteResources = remoteResults.flatMap((result) => (result._tag === "success" ? [result.resource] : []));
        const remoteByAddress = byAddress(remoteResources);
        const failedRemoteByAddress = new Map(
          remoteResults
            .filter((result) => result._tag === "failure")
            .map((result) => [result.address, result] as const),
        );

        const addresses = [...new Set([...desiredByAddress.keys(), ...remoteByAddress.keys(), ...failedRemoteByAddress.keys()])].sort();
        const changes: Array<ResourceChange> = [];

        for (const address of addresses) {
          const desired = desiredByAddress.get(address);
          const remote = remoteByAddress.get(address);
          const failedRemote = failedRemoteByAddress.get(address);

          if (failedRemote !== undefined) {
            changes.push({
              address,
              kind: failedRemote.kind,
              action: "blocked",
              ...(desired === undefined ? {} : { after: desired }),
              diffs: [],
              operations: [],
              dependsOn: [],
            });
            continue;
          }

          if (desired !== undefined && remote === undefined) {
            changes.push({
              address,
              kind: desired.kind,
              action: "create",
              after: desired,
              diffs: [],
              operations: [],
              dependsOn: input.desired.find((resource) => resource.address === address)?.dependencies ?? [],
            });
            continue;
          }

          if (desired === undefined && remote !== undefined) {
            changes.push({
              address,
              kind: remote.kind,
              ...(remote.providerId === undefined ? {} : { providerId: remote.providerId }),
              action: isArchivedResource(remote) ? "noop" : "archive",
              before: remote,
              diffs: [],
              operations: [],
              dependsOn: [],
            });
            continue;
          }

          if (desired !== undefined && remote !== undefined) {
            const adapter = registry.get(desired.kind);
            const diffs = diffJson(remote.managed, desired.managed, {
              semantics: adapter?.fieldSemantics ?? [],
              arrays: [{ path: "/prices", array: { mode: "keyed", key: "key" } }],
            });
            diagnostics.push(
              ...diffs.flatMap((diff) => {
                const diagnostic = diagnosticForRule(address, diff, diff.rule);
                return diagnostic === undefined ? [] : [diagnostic];
              }),
            );
            changes.push({
              address,
              kind: desired.kind,
              ...(remote.providerId === undefined ? {} : { providerId: remote.providerId }),
              action: classifyAction(diffs),
              before: remote,
              after: desired,
              diffs,
              operations: [],
              dependsOn: input.desired.find((resource) => resource.address === address)?.dependencies ?? [],
            });
          }
        }

        const planned = yield* operationPlanner(registry, changes);
        diagnostics.push(...planned.diagnostics);
        const operationsWithDependencies = addResourceOperationDependencies(
          planned.changes,
          planned.operations,
        );
        const ordered = orderOperations(operationsWithDependencies);
        diagnostics.push(...ordered.diagnostics);

        return {
          provider: "polar" as const,
          changes: planned.changes,
          operations: ordered.operations,
          diagnostics,
          summary: summarizeChanges(planned.changes),
        } satisfies Plan;
      });

      return Planner.of({ buildPlan });
    }),
  );
}
