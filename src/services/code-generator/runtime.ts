import { Effect } from "effect";
import type { SourceFile } from "ts-morph";
import {
  minorToMajorUnitAmount,
  optionalMinorToMajorUnitAmount,
  type CurrencyAmountInput,
} from "../../currency/currency.js";
import type { ResourceKind } from "../../core/kind.js";
import { PAC_METADATA_KEY } from "../../core/metadata.js";
import type { CurrentResource } from "../../core/resource.js";
import type { EventDefinition, EventMetadataField } from "../../events/event.js";
import type { Plan } from "../planner.js";
import { CodeGenerationError } from "./code-generation-error.js";
import { addConstExport, addTypeAlias, createProject, quoteKey } from "./helpers.js";

type RuntimeExportName = "products" | "meters" | "benefits";

const exportNameByKind: Record<ResourceKind, RuntimeExportName> = {
  product: "products",
  meter: "meters",
  benefit: "benefits",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);

const removePacMetadata = (metadata: Record<string, unknown>): Record<string, unknown> => {
  const { [PAC_METADATA_KEY]: _pac, ...rest } = metadata;
  return rest;
};

const sanitizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(value)) {
    if (key === "metadata" && isRecord(entryValue)) {
      sanitized[key] = removePacMetadata(entryValue);
      continue;
    }

    sanitized[key] = sanitizeValue(entryValue);
  }

  return sanitized;
};

const isCurrencyAmountInput = (value: unknown): value is CurrencyAmountInput =>
  typeof value === "string" || typeof value === "number" || typeof value === "bigint";

const productPriceCurrency = (price: Record<string, unknown>): string | undefined =>
  typeof price.priceCurrency === "string" ? price.priceCurrency : undefined;

const convertMinorAmountField = (
  price: Record<string, unknown>,
  field: string,
  currency: string,
): void => {
  const value = price[field];
  if (isCurrencyAmountInput(value)) {
    price[field] = minorToMajorUnitAmount(value, currency);
  }
};

const convertOptionalMinorAmountField = (
  price: Record<string, unknown>,
  field: string,
  currency: string,
): void => {
  const value = price[field];
  if (value === null || value === undefined || isCurrencyAmountInput(value)) {
    price[field] = optionalMinorToMajorUnitAmount(value, currency);
  }
};

const sanitizeProductPrice = (price: unknown): unknown => {
  const sanitized = sanitizeValue(price);
  if (!isRecord(sanitized)) return sanitized;

  const currency = productPriceCurrency(sanitized);
  if (currency === undefined) return sanitized;

  switch (sanitized.amountType) {
    case "fixed":
      convertMinorAmountField(sanitized, "priceAmount", currency);
      return sanitized;
    case "custom":
      convertOptionalMinorAmountField(sanitized, "minimumAmount", currency);
      convertOptionalMinorAmountField(sanitized, "maximumAmount", currency);
      convertOptionalMinorAmountField(sanitized, "presetAmount", currency);
      return sanitized;
    case "metered_unit":
      convertMinorAmountField(sanitized, "unitAmount", currency);
      convertOptionalMinorAmountField(sanitized, "capAmount", currency);
      return sanitized;
    default:
      return sanitized;
  }
};

const sanitizeResourceRaw = (
  resource: CurrentResource,
): Effect.Effect<unknown, CodeGenerationError> =>
  Effect.try({
    try: () => {
      const sanitized = sanitizeValue(resource.raw);

      if (resource.kind !== "product" || !isRecord(sanitized) || !Array.isArray(sanitized.prices)) {
        return sanitized;
      }

      return {
        ...sanitized,
        prices: sanitized.prices.map(sanitizeProductPrice),
      };
    },
    catch: (cause) =>
      new CodeGenerationError({
        address: resource.address,
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });

const currentResourcesForGeneration = (plan: Plan): ReadonlyArray<CurrentResource> =>
  [...plan.nodes.values()].flatMap((node) => (node._tag === "Noop" ? [node.current] : []));

const assertRenderableResources = (
  resources: ReadonlyArray<CurrentResource>,
): Effect.Effect<void, CodeGenerationError> =>
  Effect.forEach(resources, (resource) => {
    if (resource.isRemoved) {
      return new CodeGenerationError({
        address: resource.address,
        message: `Resource ${resource.address} is removed in Polar. Run pac deploy first.`,
      });
    }

    if (resource.raw === undefined) {
      return new CodeGenerationError({
        address: resource.address,
        message: `Resource ${resource.address} is missing the raw Polar API response.`,
      });
    }

    return Effect.void;
  }).pipe(Effect.asVoid);

const computeResourceEntries = (
  resources: ReadonlyArray<CurrentResource>,
): Effect.Effect<ReadonlyArray<string>, CodeGenerationError> =>
  Effect.forEach(resources, (resource) =>
    Effect.gen(function* () {
      const sanitized = yield* sanitizeResourceRaw(resource);
      return `${quoteKey(resource.key)}: ${JSON.stringify(sanitized)}`;
    }),
  );

const addResourceExport = (
  sourceFile: SourceFile,
  kind: ResourceKind,
  entries: ReadonlyArray<string>,
): void => {
  const initializer = entries.length === 0 ? "{}" : `{\n  ${entries.join(",\n  ")}\n}`;

  addConstExport(sourceFile, exportNameByKind[kind], `${initializer} as const`);
};

const toPascalCase = (value: string): string => {
  const words = value.match(/[A-Za-z0-9]+/g) ?? [];
  const rendered = words
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join("");

  if (rendered.length === 0) return "Pac";
  return /^[A-Za-z_$]/.test(rendered) ? rendered : `Event${rendered}`;
};

const eventClassBaseName = (definition: EventDefinition): string => {
  const baseName = toPascalCase(definition.name || definition.key);
  return baseName.endsWith("Event") ? baseName : `${baseName}Event`;
};

const eventRuntimeNames = (
  definitions: ReadonlyArray<EventDefinition>,
): ReadonlyArray<readonly [EventDefinition, string]> => {
  const used = new Map<string, number>();

  return definitions.map((definition) => {
    const baseName = eventClassBaseName(definition);
    const count = used.get(baseName) ?? 0;
    used.set(baseName, count + 1);
    return [definition, count === 0 ? baseName : `${baseName}${count + 1}`] as const;
  });
};

const eventFieldTsType = (field: EventMetadataField): string => {
  switch (field.valueType) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "unknown":
      return "EventMetadataInput";
  }
};

const addEventMetadataType = (
  sourceFile: SourceFile,
  className: string,
  fields: ReadonlyArray<EventMetadataField>,
): void => {
  const type =
    fields.length === 0
      ? "Record<never, never>"
      : `{\n${fields
          .map(
            (field) =>
              `  ${quoteKey(field.key)}${field.optional ? "?" : ""}: ${eventFieldTsType(field)}${field.optional ? " | undefined" : ""};`,
          )
          .join("\n")}\n}`;

  addTypeAlias(sourceFile, `${className}Metadata`, type);
};

const addEventInputType = (sourceFile: SourceFile, className: string): void => {
  addTypeAlias(
    sourceFile,
    `${className}Input`,
    [
      "{",
      "  timestamp?: Date | undefined;",
      "  organizationId?: string | null | undefined;",
      "  externalId?: string | null | undefined;",
      "  parentId?: string | null | undefined;",
      `  metadata: ${className}Metadata;`,
      "} & (",
      "  | {",
      "      customerId: string;",
      "      memberId?: string | null | undefined;",
      "      externalCustomerId?: never;",
      "      externalMemberId?: never;",
      "    }",
      "  | {",
      "      externalCustomerId: string;",
      "      externalMemberId?: string | null | undefined;",
      "      customerId?: never;",
      "      memberId?: never;",
      "    }",
      ")",
    ].join("\n"),
  );
};

const addEventClass = (
  sourceFile: SourceFile,
  definition: EventDefinition,
  className: string,
): void => {
  sourceFile.addClass({
    isExported: true,
    name: className,
    properties: [
      { name: "timestamp", type: "Date | undefined", isReadonly: true, hasDeclareKeyword: true },
      { name: "name", type: "string", isReadonly: true, hasDeclareKeyword: true },
      {
        name: "organizationId",
        type: "string | null | undefined",
        isReadonly: true,
        hasDeclareKeyword: true,
      },
      {
        name: "externalId",
        type: "string | null | undefined",
        isReadonly: true,
        hasDeclareKeyword: true,
      },
      {
        name: "parentId",
        type: "string | null | undefined",
        isReadonly: true,
        hasDeclareKeyword: true,
      },
      {
        name: "metadata",
        type: `DefinedRecord<${className}Metadata>`,
        isReadonly: true,
        hasDeclareKeyword: true,
      },
      { name: "customerId", type: "string", isReadonly: true, hasDeclareKeyword: true },
      {
        name: "memberId",
        type: "string | null | undefined",
        isReadonly: true,
        hasDeclareKeyword: true,
      },
      { name: "externalCustomerId", type: "string", isReadonly: true, hasDeclareKeyword: true },
      {
        name: "externalMemberId",
        type: "string | null | undefined",
        isReadonly: true,
        hasDeclareKeyword: true,
      },
    ],
    ctors: [
      {
        parameters: [{ name: "input", type: `${className}Input` }],
        statements: [
          `const { timestamp, organizationId, externalId, parentId } = input;`,
          `const metadata = omitUndefined(input.metadata);`,
          `if (input.customerId !== undefined) {`,
          `  Object.assign(this, { timestamp, organizationId, externalId, parentId, customerId: input.customerId, memberId: input.memberId, name: ${JSON.stringify(definition.name)}, metadata });`,
          `  return;`,
          `}`,
          `Object.assign(this, { timestamp, organizationId, externalId, parentId, externalCustomerId: input.externalCustomerId, externalMemberId: input.externalMemberId, name: ${JSON.stringify(definition.name)}, metadata });`,
        ],
      },
    ],
  });
};

const addRuntimeEvent = (
  sourceFile: SourceFile,
  definition: EventDefinition,
  className: string,
): void => {
  addEventMetadataType(sourceFile, className, definition.fields);
  addEventInputType(sourceFile, className);
  addEventClass(sourceFile, definition, className);
};

const addRuntimeEvents = (
  sourceFile: SourceFile,
  definitions: ReadonlyArray<EventDefinition>,
): void => {
  if (definitions.length === 0) return;

  const entries = eventRuntimeNames(definitions);
  for (const [definition, className] of entries) {
    addRuntimeEvent(sourceFile, definition, className);
  }
};

export const generateRuntime = (
  plan: Plan,
  eventDefinitions: ReadonlyArray<EventDefinition> = [],
): Effect.Effect<string, CodeGenerationError> =>
  Effect.gen(function* () {
    const resources = currentResourcesForGeneration(plan);
    yield* assertRenderableResources(resources);

    const grouped: Record<ResourceKind, Array<CurrentResource>> = {
      product: [],
      meter: [],
      benefit: [],
    };

    for (const resource of resources) {
      grouped[resource.kind].push(resource);
    }

    const resourceExports: Record<ResourceKind, ReadonlyArray<string>> = {
      product: yield* computeResourceEntries(grouped.product),
      meter: yield* computeResourceEntries(grouped.meter),
      benefit: yield* computeResourceEntries(grouped.benefit),
    };

    return yield* Effect.try({
      try: () => {
        const project = createProject();
        const sourceFile = project.createSourceFile("pac.runtime.ts");

        sourceFile.addStatements("// This file is generated by PAC. Do not edit manually.");

        const hasUnknownEventFields = eventDefinitions.some((definition) =>
          definition.fields.some((field) => field.valueType === "unknown"),
        );

        if (hasUnknownEventFields) {
          sourceFile.addImportDeclaration({
            isTypeOnly: true,
            moduleSpecifier: "@polar-sh/sdk/models/components/eventmetadatainput.js",
            namedImports: ["EventMetadataInput"],
          });
        }

        if (eventDefinitions.length > 0) {
          sourceFile.addTypeAlias({
            isExported: true,
            name: "DefinedRecord",
            typeParameters: [{ name: "T", constraint: "object" }],
            type: "Partial<{ [Key in keyof T]: Exclude<T[Key], undefined> }>",
          });

          sourceFile.addFunction({
            name: "omitUndefined",
            typeParameters: [{ name: "T", constraint: "object" }],
            parameters: [{ name: "value", type: "T" }],
            returnType: "DefinedRecord<T>",
            statements: [
              "return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as DefinedRecord<T>;",
            ],
          });
        }

        for (const kind of ["product", "meter", "benefit"] as const) {
          addResourceExport(sourceFile, kind, resourceExports[kind]);
        }

        addRuntimeEvents(sourceFile, eventDefinitions);

        return sourceFile.getFullText();
      },
      catch: (cause) =>
        new CodeGenerationError({
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    });
  });
