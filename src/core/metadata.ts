import * as Schema from "effect/Schema";
import { ResourceAddress, ResourceKey, type ResourceAddress as ResourceAddressType } from "./address.js";
import { errorDiagnostic, type Diagnostic } from "./diagnostic.js";

export type ManagedIdentity = {
  readonly version: 1;
  readonly kind: string;
  readonly address: ResourceAddressType;
  readonly key: string;
};

export type PaacMetadataDecodeResult =
  | { readonly _tag: "managed"; readonly identity: ManagedIdentity }
  | { readonly _tag: "unmanaged" }
  | { readonly _tag: "malformed"; readonly diagnostic: Diagnostic };

const MetadataValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]);
const MetadataEnvelope = Schema.Struct({
  paac: Schema.optionalKey(Schema.Unknown),
});

const ManagedIdentityEnvelope = Schema.Struct({
  v: Schema.Literal(1),
  kind: ResourceKey,
  addr: ResourceAddress,
  key: ResourceKey,
});

const decodeMetadataEnvelope = Schema.decodeUnknownSync(MetadataEnvelope);
const decodeManagedIdentityEnvelope = Schema.decodeUnknownSync(ManagedIdentityEnvelope);
const isString = Schema.is(Schema.String);

const malformed = (message: string): PaacMetadataDecodeResult => ({
  _tag: "malformed",
  diagnostic: errorDiagnostic({
    code: "PAAC_MALFORMED_METADATA",
    message,
    hint: "Remove the paac metadata key or replace it with the v1 PAAC metadata envelope.",
  }),
});

export const encodePaacMetadata = (
  identity: ManagedIdentity,
): Record<string, string | number | boolean> => ({
  paac: JSON.stringify({
    v: identity.version,
    kind: identity.kind,
    addr: identity.address,
    key: identity.key,
  }),
});

export const decodePaacMetadataResult = (metadata: unknown): PaacMetadataDecodeResult => {
  let envelope: typeof MetadataEnvelope.Type;
  try {
    envelope = decodeMetadataEnvelope(metadata);
  } catch {
    return { _tag: "unmanaged" };
  }

  if (envelope.paac === undefined) return { _tag: "unmanaged" };
  if (!isString(envelope.paac)) {
    return malformed("PAAC metadata key must be a JSON string v1 envelope.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope.paac) as unknown;
  } catch {
    return malformed("PAAC metadata key contains invalid JSON.");
  }

  try {
    const identity = decodeManagedIdentityEnvelope(parsed);
    if (identity.addr !== `${identity.kind}.${identity.key}`) {
      return malformed("PAAC metadata addr must equal `${kind}.${key}`.");
    }
    return {
      _tag: "managed",
      identity: {
        version: identity.v,
        kind: identity.kind,
        address: identity.addr as ResourceAddressType,
        key: identity.key,
      },
    };
  } catch {
    return malformed("PAAC metadata does not match the v1 managed identity envelope.");
  }
};

export const decodePaacMetadata = (metadata: unknown): ManagedIdentity | undefined => {
  const result = decodePaacMetadataResult(metadata);
  return result._tag === "managed" ? result.identity : undefined;
};

export const MetadataRecord = Schema.Record(Schema.String, MetadataValue);
