import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";
import {
  minorToMajorUnitAmount,
  optionalMinorToMajorUnitAmount,
  type CurrencyAmountInput,
} from "./currency/currency.js";
import type { ResourceKind } from "./core/kind.js";
import type { CurrentResource } from "./core/resource.js";
import type { ImportModel } from "./import/project.js";
import type { Plan } from "./planner.js";
import type { BenefitSpec } from "./resources/benefit.js";
import type {
  MeterAggregationSpec,
  MeterFilterClauseSpec,
  MeterFilterSpec,
  MeterSpec,
} from "./resources/meter.js";
import type { ProductPriceSpec, ProductSpec } from "./resources/product.js";

export class CodeGenerationError extends Schema.TaggedErrorClass<CodeGenerationError>()(
  "CodeGenerationError",
  {
    address: Schema.optionalKey(Schema.String),
    message: Schema.String,
  },
) {}

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

const renderRawResource = (resource: CurrentResource): Effect.Effect<string, CodeGenerationError> =>
  Effect.gen(function* () {
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
    Effect.gen(function* () {
      const raw = yield* renderRawResource(resource);
      return `  ${renderPropertyKey(resource.key)}: ${indent(raw, 2).trimStart()},`;
    }),
  );

const renderExport = (
  name: RuntimeExportName,
  resources: ReadonlyArray<CurrentResource>,
): Effect.Effect<string, CodeGenerationError> =>
  Effect.gen(function* () {
    const entries = yield* renderResourceEntries(resources);

    if (entries.length === 0) {
      return `export const ${name} = {} as const;`;
    }

    return [`export const ${name} = {`, ...entries, `} as const;`].join("\n");
  });

type ImportSymbol =
  | "Benefit"
  | "Meter"
  | "Product"
  | "and"
  | "avg"
  | "count"
  | "customPrice"
  | "eventName"
  | "eventTimestamp"
  | "fixedPrice"
  | "freePrice"
  | "max"
  | "metadata"
  | "meteredUnitPrice"
  | "min"
  | "or"
  | "sum"
  | "unique"
  | "where";

type RenderConfigContext = {
  readonly imports: Set<ImportSymbol>;
  readonly variableByAddress: ReadonlyMap<string, string>;
};

const addImport = (context: RenderConfigContext, symbol: ImportSymbol): void => {
  context.imports.add(symbol);
};

const renderCall = (
  name: ImportSymbol,
  args: ReadonlyArray<string>,
  context: RenderConfigContext,
): string => {
  addImport(context, name);
  return `${name}(${args.join(", ")})`;
};

const renderConfigValue = (value: unknown, level = 0): string => renderJsValue(value, level);

const renderMeterFilterClause = (
  clause: MeterFilterClauseSpec,
  context: RenderConfigContext,
): string => {
  const args = [JSON.stringify(clause.operator), renderConfigValue(clause.value)];
  if (clause.property === "name") return renderCall("eventName", args, context);
  if (clause.property === "timestamp") return renderCall("eventTimestamp", args, context);
  if (clause.property.startsWith("metadata.")) {
    return renderCall(
      "metadata",
      [JSON.stringify(clause.property.slice("metadata.".length)), ...args],
      context,
    );
  }
  return renderCall("where", [JSON.stringify(clause.property), ...args], context);
};

const isMeterFilterSpec = (
  value: MeterFilterSpec | MeterFilterClauseSpec,
): value is MeterFilterSpec => "clauses" in value;

const renderMeterFilter = (filter: MeterFilterSpec, context: RenderConfigContext): string => {
  const helper = filter.conjunction === "and" ? "and" : "or";
  return renderCall(
    helper,
    filter.clauses.map((clause) =>
      isMeterFilterSpec(clause)
        ? renderMeterFilter(clause, context)
        : renderMeterFilterClause(clause, context),
    ),
    context,
  );
};

const renderMeterAggregation = (
  aggregation: MeterAggregationSpec,
  context: RenderConfigContext,
): string => {
  switch (aggregation.func) {
    case "count":
      return renderCall("count", [], context);
    case "sum":
      return renderCall("sum", [JSON.stringify(aggregation.property)], context);
    case "max":
      return renderCall("max", [JSON.stringify(aggregation.property)], context);
    case "min":
      return renderCall("min", [JSON.stringify(aggregation.property)], context);
    case "avg":
      return renderCall("avg", [JSON.stringify(aggregation.property)], context);
    case "unique":
      return renderCall("unique", [JSON.stringify(aggregation.property)], context);
  }
};

const renderObjectEntries = (
  entries: ReadonlyArray<readonly [string, string]>,
  level: number,
): string => {
  const currentIndent = "  ".repeat(level);
  const nextIndent = "  ".repeat(level + 1);
  return [
    "{",
    ...entries.map(([key, value]) => `${nextIndent}${renderPropertyKey(key)}: ${value},`),
    `${currentIndent}}`,
  ].join("\n");
};

const renderMeterConfig = (spec: MeterSpec, context: RenderConfigContext, level: number): string =>
  renderObjectEntries(
    [
      ["name", renderConfigValue(spec.name, level + 1)],
      ["unit", renderConfigValue(spec.unit, level + 1)],
      ["customLabel", renderConfigValue(spec.customLabel, level + 1)],
      ["customMultiplier", renderConfigValue(spec.customMultiplier, level + 1)],
      ["filter", renderMeterFilter(spec.filter, context)],
      ["aggregation", renderMeterAggregation(spec.aggregation, context)],
    ],
    level,
  );

const variableForAddress = (address: string, context: RenderConfigContext): string => {
  const variableName = context.variableByAddress.get(address);
  if (variableName === undefined) {
    throw new Error(`No generated variable name for Resource Address '${address}'.`);
  }
  return variableName;
};

const renderBenefitConfig = (
  spec: BenefitSpec,
  context: RenderConfigContext,
  level: number,
): string => {
  switch (spec.type) {
    case "meter-credit":
      return renderObjectEntries(
        [
          ["type", renderConfigValue("meter-credit", level + 1)],
          ["description", renderConfigValue(spec.description, level + 1)],
          ["meter", variableForAddress(spec.meter, context)],
          ["units", renderConfigValue(spec.units, level + 1)],
          ["rollover", renderConfigValue(spec.rollover, level + 1)],
        ],
        level,
      );
    case "custom":
      return renderObjectEntries(
        [
          ["type", renderConfigValue("custom", level + 1)],
          ["description", renderConfigValue(spec.description, level + 1)],
          ["note", renderConfigValue(spec.note, level + 1)],
        ],
        level,
      );
  }
};

const renderProductPrice = (price: ProductPriceSpec, context: RenderConfigContext): string => {
  switch (price.type) {
    case "fixed":
      return renderCall(
        "fixedPrice",
        [
          renderObjectEntries(
            [
              ["amount", renderConfigValue(minorToMajorUnitAmount(price.amount, price.currency))],
              ["currency", renderConfigValue(price.currency)],
            ],
            0,
          ),
        ],
        context,
      );
    case "free":
      return renderCall(
        "freePrice",
        [renderObjectEntries([["currency", renderConfigValue(price.currency)]], 0)],
        context,
      );
    case "custom":
      return renderCall(
        "customPrice",
        [
          renderObjectEntries(
            [
              ["currency", renderConfigValue(price.currency)],
              [
                "minimumAmount",
                renderConfigValue(
                  optionalMinorToMajorUnitAmount(price.minimumAmount, price.currency),
                ),
              ],
              [
                "maximumAmount",
                renderConfigValue(
                  optionalMinorToMajorUnitAmount(price.maximumAmount, price.currency),
                ),
              ],
              [
                "presetAmount",
                renderConfigValue(
                  optionalMinorToMajorUnitAmount(price.presetAmount, price.currency),
                ),
              ],
            ],
            0,
          ),
        ],
        context,
      );
    case "meteredUnit":
      return renderCall(
        "meteredUnitPrice",
        [
          renderObjectEntries(
            [
              ["meter", variableForAddress(price.meter, context)],
              ["amount", renderConfigValue(minorToMajorUnitAmount(price.amount, price.currency))],
              ["currency", renderConfigValue(price.currency)],
              [
                "capAmount",
                renderConfigValue(optionalMinorToMajorUnitAmount(price.capAmount, price.currency)),
              ],
            ],
            0,
          ),
        ],
        context,
      );
  }
};

const renderExpressionArray = (expressions: ReadonlyArray<string>, level: number): string => {
  if (expressions.length === 0) return "[]";
  const currentIndent = "  ".repeat(level);
  const nextIndent = "  ".repeat(level + 1);
  return [
    "[",
    ...expressions.map((expression) => `${indent(expression, nextIndent.length).trimEnd()},`),
    `${currentIndent}]`,
  ].join("\n");
};

const renderProductConfig = (
  spec: ProductSpec,
  context: RenderConfigContext,
  level: number,
): string =>
  renderObjectEntries(
    [
      ["name", renderConfigValue(spec.name, level + 1)],
      ["description", renderConfigValue(spec.description, level + 1)],
      [
        "prices",
        renderExpressionArray(
          spec.prices.map((price) => renderProductPrice(price, context)),
          level + 1,
        ),
      ],
      [
        "benefits",
        renderExpressionArray(
          spec.benefits.map((benefit) => variableForAddress(benefit, context)),
          level + 1,
        ),
      ],
      ["visibility", renderConfigValue(spec.visibility, level + 1)],
      ["recurringInterval", renderConfigValue(spec.recurringInterval, level + 1)],
      ["recurringIntervalCount", renderConfigValue(spec.recurringIntervalCount, level + 1)],
    ],
    level,
  );

const renderConfigDeclaration = (
  resource: ImportModel["resources"][number],
  context: RenderConfigContext,
): string => {
  switch (resource.desired.kind) {
    case "meter":
      addImport(context, "Meter");
      return `export const ${resource.variableName} = new Meter(${JSON.stringify(resource.desired.key)}, ${renderMeterConfig(resource.desired.spec, context, 0)});`;
    case "benefit":
      addImport(context, "Benefit");
      return `export const ${resource.variableName} = new Benefit(${JSON.stringify(resource.desired.key)}, ${renderBenefitConfig(resource.desired.spec, context, 0)});`;
    case "product":
      addImport(context, "Product");
      return `export const ${resource.variableName} = new Product(${JSON.stringify(resource.desired.key)}, ${renderProductConfig(resource.desired.spec, context, 0)});`;
  }
};

const generateConfig = (model: ImportModel): Effect.Effect<string, CodeGenerationError> =>
  Effect.try({
    try: () => {
      const variableByAddress = new Map(
        model.resources.map((resource) => [resource.desired.address, resource.variableName]),
      );
      const context: RenderConfigContext = {
        imports: new Set(),
        variableByAddress,
      };
      const declarations = [...model.meters, ...model.benefits, ...model.products].map((resource) =>
        renderConfigDeclaration(resource, context),
      );
      const imports = [...context.imports].sort();

      return [
        `import { ${imports.join(", ")} } from "paac";`,
        "",
        ...declarations.flatMap((declaration) => [declaration, ""]),
      ].join("\n");
    },
    catch: (cause) =>
      new CodeGenerationError({
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

const generateRuntime = (plan: Plan): Effect.Effect<string, CodeGenerationError> =>
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
    readonly generateRuntime: (plan: Plan) => Effect.Effect<string, CodeGenerationError>;
    readonly generateConfig: (model: ImportModel) => Effect.Effect<string, CodeGenerationError>;
  }
>()("@app/CodeGenerator") {
  static readonly layer = Layer.succeed(
    CodeGenerator,
    CodeGenerator.of({
      generateRuntime,
      generateConfig,
    }),
  );
}
