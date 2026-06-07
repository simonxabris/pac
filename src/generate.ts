import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";
import {
  minorToMajorUnitAmount,
  optionalMinorToMajorUnitAmount,
  type CurrencyAmountInput,
} from "./currency/currency.js";
import type { ResourceKind } from "./core/kind.js";
import type { CurrentResource } from "./core/resource.js";
import type { Plan } from "./planner.js";

export class CodeGenerationError extends Schema.TaggedErrorClass<CodeGenerationError>()(
  "CodeGenerationError",
  {
    address: Schema.optionalKey(Schema.String),
    message: Schema.String,
  },
) { }

type RuntimeExportName = "products" | "meters" | "benefits";

const exportNameByKind: Record<ResourceKind, RuntimeExportName> = {
  product: "products",
  meter: "meters",
  benefit: "benefits",
};

const isIdentifier = (value: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);

const renderPropertyKey = (key: string): string => (isIdentifier(key) ? key : JSON.stringify(key));

const indent = (text: string, spaces: number): string => {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);

const removePaacMetadata = (metadata: Record<string, unknown>): Record<string, unknown> => {
  const { paac: _paac, ...rest } = metadata;
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
      sanitized[key] = removePaacMetadata(entryValue);
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

const renderJsValue = (value: unknown, level = 0): string => {
  const currentIndent = "  ".repeat(level);
  const nextIndent = "  ".repeat(level + 1);

  if (value === null) return "null";

  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";

    return [
      "[",
      ...value.map((entry) => `${nextIndent}${renderJsValue(entry, level + 1)},`),
      `${currentIndent}]`,
    ].join("\n");
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";

    return [
      "{",
      ...entries.map(
        ([key, entryValue]) =>
          `${nextIndent}${renderPropertyKey(key)}: ${renderJsValue(entryValue, level + 1)},`,
      ),
      `${currentIndent}}`,
    ].join("\n");
  }

  const rendered = JSON.stringify(value);
  if (rendered === undefined) {
    throw new Error("Raw Polar API response is not JSON-serializable.");
  }
  return rendered;
};

const renderRawResource = (
  resource: CurrentResource,
): Effect.Effect<string, CodeGenerationError> =>
  Effect.gen(function*() {
    const raw = yield* sanitizeResourceRaw(resource);

    return yield* Effect.try({
      try: () => renderJsValue(raw),
      catch: (cause) =>
        new CodeGenerationError({
          address: resource.address,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    });
  });

const renderResourceEntries = (
  resources: ReadonlyArray<CurrentResource>,
): Effect.Effect<ReadonlyArray<string>, CodeGenerationError> =>
  Effect.forEach(resources, (resource) =>
    Effect.gen(function*() {
      const raw = yield* renderRawResource(resource);
      return `  ${renderPropertyKey(resource.key)}: ${indent(raw, 2).trimStart()},`;
    }),
  );

const renderExport = (
  name: RuntimeExportName,
  resources: ReadonlyArray<CurrentResource>,
): Effect.Effect<string, CodeGenerationError> =>
  Effect.gen(function*() {
    const entries = yield* renderResourceEntries(resources);

    if (entries.length === 0) {
      return `export const ${name} = {} as const;`;
    }

    return [`export const ${name} = {`, ...entries, `} as const;`].join("\n");
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
        message: `Resource ${resource.address} is removed in Polar. Run paac deploy first.`,
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

const generate = (plan: Plan): Effect.Effect<string, CodeGenerationError> =>
  Effect.gen(function*() {
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

    const exports = yield* Effect.forEach(["product", "meter", "benefit"] as const, (kind) =>
      renderExport(exportNameByKind[kind], grouped[kind]),
    );

    return [
      "// This file is generated by PAAC. Do not edit manually.",
      "",
      ...exports.flatMap((rendered) => [rendered, ""]),
    ].join("\n");
  });

export class CodeGenerator extends Context.Service<
  CodeGenerator,
  {
    readonly generate: (plan: Plan) => Effect.Effect<string, CodeGenerationError>;
  }
>()("@app/CodeGenerator") {
  static readonly layer = Layer.succeed(
    CodeGenerator,
    CodeGenerator.of({
      generate,
    }),
  );
}
