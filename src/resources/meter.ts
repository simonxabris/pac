import type { MeterUnit } from "@polar-sh/sdk/models/components/meterunit.js";
import * as Schema from "effect/Schema";
import { decodeResourceKey } from "../core/address.js";
import type { DesiredResource } from "../core/resource.js";
import { registerResource } from "./registry.js";

const FilterConjunctionSchema = Schema.Union([Schema.Literal("and"), Schema.Literal("or")]);
const FilterOperatorSchema = Schema.Union([
  Schema.Literal("eq"),
  Schema.Literal("ne"),
  Schema.Literal("gt"),
  Schema.Literal("gte"),
  Schema.Literal("lt"),
  Schema.Literal("lte"),
  Schema.Literal("like"),
  Schema.Literal("not_like"),
]);
const FilterValueSchema = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);

const MeterFilterClauseSchema = Schema.Struct({
  property: Schema.String,
  operator: FilterOperatorSchema,
  value: FilterValueSchema,
});

export type MeterFilterConjunction = typeof FilterConjunctionSchema.Type;
export type MeterFilterOperator = typeof FilterOperatorSchema.Type;
export type MeterFilterValue = typeof FilterValueSchema.Type;
export type MeterTimestampFilterValue = string | number | Date;
export type MeterFilterClause = typeof MeterFilterClauseSchema.Type;
export type MeterFilter = {
  readonly conjunction: MeterFilterConjunction;
  readonly clauses: ReadonlyArray<MeterFilterClause | MeterFilter>;
};

const MeterFilterSchema: Schema.Codec<MeterFilter> = Schema.suspend(
  (): Schema.Codec<MeterFilter> =>
    Schema.Struct({
      conjunction: FilterConjunctionSchema,
      clauses: Schema.Array(Schema.Union([MeterFilterClauseSchema, MeterFilterSchema])),
    }),
);

const CountAggregationFunctionSchema = Schema.Literal("count");
const PropertyAggregationFunctionSchema = Schema.Union([
  Schema.Literal("sum"),
  Schema.Literal("max"),
  Schema.Literal("min"),
  Schema.Literal("avg"),
]);
const UniqueAggregationFunctionSchema = Schema.Literal("unique");
const AggregationFunctionSchema = Schema.Union([
  CountAggregationFunctionSchema,
  PropertyAggregationFunctionSchema,
  UniqueAggregationFunctionSchema,
]);

const CountAggregationSchema = Schema.Struct({
  func: CountAggregationFunctionSchema,
});
const PropertyAggregationSchema = Schema.Struct({
  func: PropertyAggregationFunctionSchema,
  property: Schema.String,
});
const UniqueAggregationSchema = Schema.Struct({
  func: UniqueAggregationFunctionSchema,
  property: Schema.String,
});
const MeterAggregationSchema = Schema.Union([
  CountAggregationSchema,
  PropertyAggregationSchema,
  UniqueAggregationSchema,
]);

const StandardMeterConfigSchema = Schema.Struct({
  name: Schema.String,
  unit: Schema.optionalKey(Schema.Union([Schema.Literal("scalar"), Schema.Literal("token")])),
  filter: MeterFilterSchema,
  aggregation: MeterAggregationSchema,
});

const CustomMeterConfigSchema = Schema.Struct({
  name: Schema.String,
  unit: Schema.Literal("custom"),
  customLabel: Schema.String,
  customMultiplier: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  filter: MeterFilterSchema,
  aggregation: MeterAggregationSchema,
});

const MeterConfigSchema = Schema.Union([StandardMeterConfigSchema, CustomMeterConfigSchema]);

const decodeMeterConfig = Schema.decodeUnknownSync(MeterConfigSchema, {
  onExcessProperty: "error",
});
const decodeMeterFilterClause = Schema.decodeUnknownSync(MeterFilterClauseSchema, {
  onExcessProperty: "error",
});
const decodeMeterFilter = Schema.decodeUnknownSync(MeterFilterSchema, {
  onExcessProperty: "error",
});
const decodeCountAggregation = Schema.decodeUnknownSync(CountAggregationSchema, {
  onExcessProperty: "error",
});
const decodePropertyAggregation = Schema.decodeUnknownSync(PropertyAggregationSchema, {
  onExcessProperty: "error",
});
const decodeUniqueAggregation = Schema.decodeUnknownSync(UniqueAggregationSchema, {
  onExcessProperty: "error",
});

export type CountAggregationFunction = typeof CountAggregationFunctionSchema.Type;
export type PropertyAggregationFunction = typeof PropertyAggregationFunctionSchema.Type;
export type UniqueAggregationFunction = typeof UniqueAggregationFunctionSchema.Type;
export type AggregationFunction = typeof AggregationFunctionSchema.Type;
export type CountAggregation = typeof CountAggregationSchema.Type;
export type PropertyAggregation = typeof PropertyAggregationSchema.Type;
export type UniqueAggregation = typeof UniqueAggregationSchema.Type;
export type MeterAggregation = typeof MeterAggregationSchema.Type;
type MeterConfigBase = {
  readonly name: string;
  readonly filter: MeterFilter;
  readonly aggregation: MeterAggregation;
};

export type StandardMeterConfig = MeterConfigBase & {
  readonly unit?: Exclude<MeterUnit, "custom">;
  readonly customLabel?: never;
  readonly customMultiplier?: never;
};

export type CustomMeterConfig = MeterConfigBase & {
  readonly unit: "custom";
  readonly customLabel: string;
  readonly customMultiplier?: number | null;
};

export type MeterConfig = StandardMeterConfig | CustomMeterConfig;

export type MeterCreatePayload = {
  readonly name: string;
  readonly unit: MeterUnit;
  readonly customLabel?: string | null;
  readonly customMultiplier?: number | null;
  readonly filter: MeterFilter;
  readonly aggregation: MeterAggregation;
  readonly metadata: Record<string, string | number | boolean>;
};

export type MeterUpdatePayload = Partial<Omit<MeterCreatePayload, "metadata">> & {
  readonly isArchived?: boolean;
};

export type DesiredMeter = DesiredResource & {
  readonly kind: "meter";
  readonly key: string;
  readonly address: `meter.${string}`;
};

export const where = (
  property: string,
  operator: MeterFilterOperator,
  value: MeterFilterValue,
): MeterFilterClause => decodeMeterFilterClause({ property, operator, value });

export const eventName = (
  operator: MeterFilterOperator,
  value: MeterFilterValue,
): MeterFilterClause => where("name", operator, value);

export const eventTimestamp = (
  operator: MeterFilterOperator,
  value: MeterTimestampFilterValue,
): MeterFilterClause =>
  where("timestamp", operator, value instanceof Date ? value.toISOString() : value);

export const metadata = (
  property: string,
  operator: MeterFilterOperator,
  value: MeterFilterValue,
): MeterFilterClause => where(property, operator, value);

const filter = (
  conjunction: MeterFilterConjunction,
  clauses: ReadonlyArray<MeterFilterClause | MeterFilter>,
): MeterFilter => decodeMeterFilter({ conjunction, clauses });

export const and = (...clauses: ReadonlyArray<MeterFilterClause | MeterFilter>): MeterFilter =>
  filter("and", clauses);

export const or = (...clauses: ReadonlyArray<MeterFilterClause | MeterFilter>): MeterFilter =>
  filter("or", clauses);

export function aggregate(func: CountAggregationFunction): CountAggregation;
export function aggregate(func: PropertyAggregationFunction, property: string): PropertyAggregation;
export function aggregate(func: UniqueAggregationFunction, property: string): UniqueAggregation;
export function aggregate(func: AggregationFunction, property?: string): MeterAggregation {
  if (func === "count") return decodeCountAggregation({ func });
  if (func === "unique") return decodeUniqueAggregation({ func, property });
  return decodePropertyAggregation({ func, property });
}

export const count = (): CountAggregation => aggregate("count");

const propertyAggregation = (
  func: PropertyAggregationFunction,
  property: string,
): PropertyAggregation => aggregate(func, property);

export const sum = (property: string): PropertyAggregation => propertyAggregation("sum", property);
export const max = (property: string): PropertyAggregation => propertyAggregation("max", property);
export const min = (property: string): PropertyAggregation => propertyAggregation("min", property);
export const avg = (property: string): PropertyAggregation => propertyAggregation("avg", property);
export const unique = (property: string): UniqueAggregation => aggregate("unique", property);

export class Meter {
  readonly type = "meter" as const;
  readonly kind = "meter" as const;
  readonly key: string;
  readonly address: `meter.${string}`;
  readonly config: MeterConfig;

  constructor(key: string, config: MeterConfig) {
    this.key = decodeResourceKey(key);
    this.address = `meter.${this.key}`;
    this.config = decodeMeterConfig(config) as MeterConfig;
    registerResource(this);
  }

  toDesiredResource(): DesiredMeter {
    const unit = this.config.unit ?? "scalar";
    const customFields =
      unit === "custom"
        ? {
            customLabel: this.config.customLabel,
            customMultiplier: this.config.customMultiplier ?? 1,
          }
        : {};
    return {
      kind: "meter",
      key: this.key,
      address: this.address,
      dependencies: [],
      config: {
        managed: {
          name: this.config.name,
          unit,
          ...customFields,
          filter: this.config.filter,
          aggregation: this.config.aggregation,
          isArchived: false,
        },
      },
    };
  }

  toDesired(): DesiredMeter {
    return this.toDesiredResource();
  }
}
