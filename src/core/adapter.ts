import type * as Effect from "effect/Effect";
import type { Diagnostic } from "./diagnostic.js";
import type { FieldSemantics } from "./field-semantics.js";
import type { PaacMetadataDecodeResult } from "./metadata.js";
import type { Operation, ResourceChange } from "./plan.js";
import type { CanonicalResource, DesiredResource } from "./resource.js";

export type ProviderError = Error;

export type NormalizeContext = Record<string, never>;
export type OperationContext = Record<string, never>;

export type ResourceAdapter<Remote = unknown> = {
  readonly kind: string;
  readonly listRemote: () => Effect.Effect<ReadonlyArray<Remote>, ProviderError>;
  readonly getRemoteIdentity: (remote: Remote) => PaacMetadataDecodeResult;
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
