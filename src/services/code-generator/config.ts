import { Effect } from "effect";
import { VariableDeclarationKind } from "ts-morph";
import { minorToMajorUnitAmount, optionalMinorToMajorUnitAmount } from "../../currency/currency.js";
import type { ImportModel } from "../../import/project.js";
import type { BenefitSpec } from "../../resources/benefit.js";
import type {
  MeterAggregationSpec,
  MeterFilterClauseSpec,
  MeterFilterSpec,
  MeterSpec,
} from "../../resources/meter.js";
import type { ProductPriceSpec, ProductSpec } from "../../resources/product.js";
import { CodeGenerationError } from "./code-generation-error.js";
import { createProject, quoteKey } from "./helpers.js";

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);

const renderConfigValue = (value: unknown, level = 0): string => {
  const currentIndent = "  ".repeat(level);
  const nextIndent = "  ".repeat(level + 1);

  if (value === null || value === undefined) return "null";

  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";

    return [
      "[",
      ...value.map((entry) => `${nextIndent}${renderConfigValue(entry, level + 1)},`),
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
          `${nextIndent}${quoteKey(key)}: ${renderConfigValue(entryValue, level + 1)},`,
      ),
      `${currentIndent}}`,
    ].join("\n");
  }

  const rendered = JSON.stringify(value);
  if (rendered === undefined) {
    throw new Error("Config value is not JSON-serializable.");
  }
  return rendered;
};

const renderObjectEntries = (
  entries: ReadonlyArray<readonly [string, string]>,
  level: number,
): string => {
  const currentIndent = "  ".repeat(level);
  const nextIndent = "  ".repeat(level + 1);
  return [
    "{",
    ...entries.map(([key, value]) => `${nextIndent}${quoteKey(key)}: ${value},`),
    `${currentIndent}}`,
  ].join("\n");
};

const renderExpressionArray = (expressions: ReadonlyArray<string>, level: number): string => {
  if (expressions.length === 0) return "[]";
  const currentIndent = "  ".repeat(level);
  const nextIndent = "  ".repeat(level + 1);
  return [
    "[",
    ...expressions.map((expression) => {
      const indented = expression
        .split("\n")
        .map((line, index) => (index === 0 ? line : `${nextIndent}${line}`))
        .join("\n");
      return `${nextIndent}${indented},`;
    }),
    `${currentIndent}]`,
  ].join("\n");
};

const variableForAddress = (address: string, context: RenderConfigContext): string => {
  const variableName = context.variableByAddress.get(address);
  if (variableName === undefined) {
    throw new Error(`No generated variable name for Resource Address '${address}'.`);
  }
  return variableName;
};

const isMeterFilterSpec = (
  value: MeterFilterSpec | MeterFilterClauseSpec,
): value is MeterFilterSpec => "clauses" in value;

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
    case "feature-flag":
      return renderObjectEntries(
        [
          ["type", renderConfigValue("feature-flag", level + 1)],
          ["description", renderConfigValue(spec.description, level + 1)],
          ["metadata", renderConfigValue(spec.metadata, level + 1)],
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

const renderResourceInitializer = (
  resource: ImportModel["resources"][number],
  context: RenderConfigContext,
): string => {
  switch (resource.desired.kind) {
    case "meter":
      addImport(context, "Meter");
      return `new Meter(${JSON.stringify(resource.desired.key)}, ${renderMeterConfig(resource.desired.spec, context, 0)})`;
    case "benefit":
      addImport(context, "Benefit");
      return `new Benefit(${JSON.stringify(resource.desired.key)}, ${renderBenefitConfig(resource.desired.spec, context, 0)})`;
    case "product":
      addImport(context, "Product");
      return `new Product(${JSON.stringify(resource.desired.key)}, ${renderProductConfig(resource.desired.spec, context, 0)})`;
  }
};

export const generateConfig = (model: ImportModel): Effect.Effect<string, CodeGenerationError> =>
  Effect.try({
    try: () => {
      const variableByAddress = new Map(
        model.resources.map((resource) => [resource.desired.address, resource.variableName]),
      );
      const context: RenderConfigContext = {
        imports: new Set(),
        variableByAddress,
      };

      const orderedResources = [...model.meters, ...model.benefits, ...model.products];
      const initializers = orderedResources.map((resource) => ({
        resource,
        initializer: renderResourceInitializer(resource, context),
      }));

      const project = createProject();
      const sourceFile = project.createSourceFile("pac.config.ts");

      const imports = [...context.imports].sort();
      sourceFile.addImportDeclaration({
        moduleSpecifier: "@simonxabris/pac",
        namedImports: imports.map((name) => ({ name })),
      });

      for (const { resource, initializer } of initializers) {
        sourceFile.addVariableStatement({
          isExported: true,
          declarationKind: VariableDeclarationKind.Const,
          declarations: [
            {
              name: resource.variableName,
              initializer,
            },
          ],
        });
      }

      return sourceFile.getFullText();
    },
    catch: (cause) =>
      new CodeGenerationError({
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });
