import { Effect, Schema } from "effect";
import { ResourceAddress as ResourceAddressSchema, type ResourceAddress } from "../core/address.js";
import { ResourceKindSchema, type ResourceKind } from "../core/kind.js";
import {
  identityForKind,
  MetadataRecord,
  type ManagedIdentity,
} from "../services/remote-resource-fetcher.js";
import { errorMessage, hasPaacMetadata } from "../utils.js";

const ManagedIdentitySchema = Schema.Struct({
  version: Schema.Literal(1),
  kind: ResourceKindSchema,
  address: ResourceAddressSchema,
  key: Schema.String,
});

const ImportResourceClassification = Schema.TaggedUnion({
  AlreadyManaged: { identity: ManagedIdentitySchema },
  Unmanaged: {},
  ConflictingMetadata: { reason: Schema.String },
  Unsupported: { reason: Schema.String },
  SkippedRemoved: { reason: Schema.String },
});

type ImportResourceClassification = typeof ImportResourceClassification.Type;

type ImportIdentityInput = {
  readonly kind: ResourceKind;
  readonly polarId: string;
  readonly label: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly isRemoved?: boolean;
  readonly supported?: boolean;
};

export type AssignedImportIdentity = {
  readonly kind: ResourceKind;
  readonly polarId: string;
  readonly key: string;
  readonly address: ResourceAddress;
  readonly variableName: string;
  readonly adoption: "AlreadyManaged" | "NeedsAdoption";
  readonly identity: ManagedIdentity;
};

export class ImportClassificationError extends Schema.TaggedErrorClass<ImportClassificationError>()(
  "ImportClassificationError",
  {
    polarId: Schema.String,
    kind: ResourceKindSchema,
    message: Schema.String,
  },
) {}

const reservedWords = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const shortPolarIdSuffix = (polarId: string): string => {
  const suffix = polarId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(-6);
  return suffix.length > 0 ? suffix : "remote";
};

const keyFromLabel = (kind: ResourceKind, label: string, polarId: string): string => {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const base = normalized.length === 0 ? `${kind}-${shortPolarIdSuffix(polarId)}` : normalized;
  return /^[a-z]/.test(base) ? base : `${kind}-${base}`;
};

const pascalCase = (value: string): string =>
  value
    .split(/[^a-zA-Z0-9]+/g)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");

const variableNameFor = (kind: ResourceKind, key: string): string => {
  const base = `${kind}${pascalCase(key)}`.replace(/[^a-zA-Z0-9_$]/g, "");
  const candidate = /^[a-zA-Z_$]/.test(base) ? base : `${kind}${base}`;
  return reservedWords.has(candidate) ? `${candidate}Resource` : candidate;
};

const classifyImportResource = ({
  kind,
  metadata,
  isRemoved = false,
  supported = true,
}: ImportIdentityInput): ImportResourceClassification => {
  if (isRemoved) {
    return ImportResourceClassification.cases.SkippedRemoved.make({
      reason: "Remote resource is archived or deleted.",
    });
  }

  if (!supported) {
    return ImportResourceClassification.cases.Unsupported.make({
      reason: "Remote resource is not supported by PAAC import yet.",
    });
  }

  if (!hasPaacMetadata({ metadata })) {
    return ImportResourceClassification.cases.Unmanaged.make({});
  }

  try {
    const decodedMetadata = Schema.decodeUnknownSync(MetadataRecord)(metadata);
    const identity = identityForKind(kind, decodedMetadata);
    return ImportResourceClassification.cases.AlreadyManaged.make({
      identity: {
        version: identity.version,
        kind,
        address: identity.address,
        key: identity.key,
      },
    });
  } catch (cause) {
    return ImportResourceClassification.cases.ConflictingMetadata.make({
      reason: errorMessage(cause),
    });
  }
};

const resourceAddress = (kind: ResourceKind, key: string): ResourceAddress =>
  `${kind}.${key}` as ResourceAddress;

export const assignImportIdentities = (
  inputs: ReadonlyArray<ImportIdentityInput>,
  options: { readonly allowConflictingMetadata?: boolean } = {},
): Effect.Effect<ReadonlyArray<AssignedImportIdentity>, ImportClassificationError> =>
  Effect.gen(function* () {
    const classified = inputs.map((input) => ({
      input,
      classification: classifyImportResource(input),
    }));

    const isUnsupportedClassification = ImportResourceClassification.guards.Unsupported;
    const isConflictingClassification = ImportResourceClassification.guards.ConflictingMetadata;

    for (const { input, classification } of classified) {
      if (
        isUnsupportedClassification(classification) ||
        (isConflictingClassification(classification) && !options.allowConflictingMetadata)
      ) {
        return yield* new ImportClassificationError({
          kind: input.kind,
          polarId: input.polarId,
          message: ImportResourceClassification.match(classification, {
            AlreadyManaged: () => "Already managed.",
            Unmanaged: () => "Unmanaged.",
            SkippedRemoved: ({ reason }) => reason,
            ConflictingMetadata: ({ reason }) => reason,
            Unsupported: ({ reason }) => reason,
          }),
        });
      }
    }

    const active = classified.filter(
      ({ classification }) => !ImportResourceClassification.guards.SkippedRemoved(classification),
    );
    const managedKeysByKind = new Map<ResourceKind, Set<string>>();
    const generatedBaseCounts = new Map<string, number>();

    for (const { input, classification } of active) {
      if (ImportResourceClassification.guards.AlreadyManaged(classification)) {
        const managedKeys = managedKeysByKind.get(input.kind) ?? new Set<string>();
        managedKeys.add(classification.identity.key);
        managedKeysByKind.set(input.kind, managedKeys);
      } else if (
        ImportResourceClassification.guards.Unmanaged(classification) ||
        ImportResourceClassification.guards.ConflictingMetadata(classification)
      ) {
        const base = keyFromLabel(input.kind, input.label, input.polarId);
        const mapKey = `${input.kind}:${base}`;
        generatedBaseCounts.set(mapKey, (generatedBaseCounts.get(mapKey) ?? 0) + 1);
      }
    }

    const usedAddresses = new Set<ResourceAddress>();
    const usedVariableNames = new Set<string>();
    const identities: Array<AssignedImportIdentity> = [];

    for (const { input, classification } of active) {
      const baseKey = keyFromLabel(input.kind, input.label, input.polarId);
      const key = ImportResourceClassification.match(classification, {
        AlreadyManaged: ({ identity }) => identity.key,
        Unmanaged: () => {
          const managedKeys = managedKeysByKind.get(input.kind) ?? new Set<string>();
          const hasGeneratedCollision =
            (generatedBaseCounts.get(`${input.kind}:${baseKey}`) ?? 0) > 1;
          return managedKeys.has(baseKey) || hasGeneratedCollision
            ? `${baseKey}-${shortPolarIdSuffix(input.polarId)}`
            : baseKey;
        },
        ConflictingMetadata: () => {
          const managedKeys = managedKeysByKind.get(input.kind) ?? new Set<string>();
          const hasGeneratedCollision =
            (generatedBaseCounts.get(`${input.kind}:${baseKey}`) ?? 0) > 1;
          return managedKeys.has(baseKey) || hasGeneratedCollision
            ? `${baseKey}-${shortPolarIdSuffix(input.polarId)}`
            : baseKey;
        },
        SkippedRemoved: () => baseKey,
        Unsupported: () => baseKey,
      });
      const address = resourceAddress(input.kind, key);

      if (usedAddresses.has(address)) {
        return yield* new ImportClassificationError({
          kind: input.kind,
          polarId: input.polarId,
          message: `Multiple remote resources map to Resource Address '${address}'.`,
        });
      }
      usedAddresses.add(address);

      const variableBase = variableNameFor(input.kind, key);
      let variableName = variableBase;
      for (let index = 2; usedVariableNames.has(variableName); index += 1) {
        variableName = `${variableBase}${index}`;
      }
      usedVariableNames.add(variableName);

      const adoption = ImportResourceClassification.guards.AlreadyManaged(classification)
        ? "AlreadyManaged"
        : "NeedsAdoption";
      identities.push({
        kind: input.kind,
        polarId: input.polarId,
        key,
        address,
        variableName,
        adoption,
        identity: {
          version: 1,
          kind: input.kind,
          address,
          key,
        },
      });
    }

    return identities;
  });
