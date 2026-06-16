import { Schema } from "effect";
import { makeAddress, type ResourceAddress } from "../core/address.js";
import type { CurrentResource, DesiredResource } from "../core/resource.js";
import type { Event, EventMetadataRef, EventMetadataValueType } from "../events/event.js";
import { registerResource } from "./registry.js";

export type MeterKind = "meter";
export type MeterAddress = ResourceAddress<MeterKind>;
export const MeterAddressSchema = Schema.TemplateLiteral(["meter.", Schema.String]);

export type MeterFilterConjunction = "and" | "or";
export type MeterFilterOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "like" | "not_like";
export type MeterFilterValue = string | number | boolean;
export type MeterTimestampFilterValue = string | number | Date;

export type MeterFilterClause = {
  readonly property: string;
  readonly operator: MeterFilterOperator;
  readonly value: MeterFilterValue;
};

export type MeterFilter = {
  readonly conjunction: MeterFilterConjunction;
  readonly clauses: ReadonlyArray<MeterFilterClause | MeterFilter>;
};
export type MeterFilterInput = MeterFilter | MeterFilterClause;

export type CountAggregationFunction = "count";
export type PropertyAggregationFunction = "sum" | "max" | "min" | "avg";
export type UniqueAggregationFunction = "unique";
export type AggregationFunction =
  | CountAggregationFunction
  | PropertyAggregationFunction
  | UniqueAggregationFunction;

export type CountAggregation = { readonly func: "count" };
export type PropertyAggregation = {
  readonly func: PropertyAggregationFunction;
  readonly property: string;
};
export type UniqueAggregation = { readonly func: "unique"; readonly property: string };
export type MeterAggregation = CountAggregation | PropertyAggregation | UniqueAggregation;

export type MeterConfig = {
  readonly name: string;
  readonly unit?: "scalar" | "token" | "custom";
  readonly customLabel?: string | null;
  readonly customMultiplier?: number | null;
  readonly filter: MeterFilterInput;
  readonly aggregation: MeterAggregation;
};

export type MeterFilterClauseSpec = MeterFilterClause;
export type MeterFilterSpec = {
  readonly conjunction: MeterFilterConjunction;
  readonly clauses: ReadonlyArray<MeterFilterClauseSpec | MeterFilterSpec>;
};
export type MeterAggregationSpec = MeterAggregation;

export type MeterSpec = {
  readonly name: string;
  readonly unit: "scalar" | "token" | "custom";
  readonly customLabel: string | null;
  readonly customMultiplier: number | null;
  readonly filter: MeterFilterSpec;
  readonly aggregation: MeterAggregationSpec;
};

export type MeterResource = DesiredResource<MeterKind, MeterSpec>;
export type CurrentMeterResource = CurrentResource<MeterKind, MeterSpec>;

export const MeterFilterOperatorSchema = Schema.Union([
  Schema.Literal("eq"),
  Schema.Literal("ne"),
  Schema.Literal("gt"),
  Schema.Literal("gte"),
  Schema.Literal("lt"),
  Schema.Literal("lte"),
  Schema.Literal("like"),
  Schema.Literal("not_like"),
]);

export const MeterFilterClauseSpecSchema = Schema.Struct({
  property: Schema.String,
  operator: MeterFilterOperatorSchema,
  value: Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
});

export const MeterFilterSpecSchema: Schema.Codec<MeterFilterSpec> = Schema.suspend(
  (): Schema.Codec<MeterFilterSpec> =>
    Schema.Struct({
      conjunction: Schema.Union([Schema.Literal("and"), Schema.Literal("or")]),
      clauses: Schema.Array(Schema.Union([MeterFilterClauseSpecSchema, MeterFilterSpecSchema])),
    }),
);

export const MeterAggregationSpecSchema: Schema.Codec<MeterAggregationSpec> = Schema.Union([
  Schema.Struct({ func: Schema.Literal("count") }),
  Schema.Struct({
    func: Schema.Union([
      Schema.Literal("sum"),
      Schema.Literal("max"),
      Schema.Literal("min"),
      Schema.Literal("avg"),
    ]),
    property: Schema.String,
  }),
  Schema.Struct({ func: Schema.Literal("unique"), property: Schema.String }),
]);

export const MeterSpecSchema = Schema.Struct({
  name: Schema.String,
  unit: Schema.Union([Schema.Literal("scalar"), Schema.Literal("token"), Schema.Literal("custom")]),
  customLabel: Schema.NullOr(Schema.String),
  customMultiplier: Schema.NullOr(Schema.Number),
  filter: MeterFilterSpecSchema,
  aggregation: MeterAggregationSpecSchema,
});

export const MeterResourceSchema = Schema.Struct({
  source: Schema.Literal("desired"),
  kind: Schema.Literal("meter"),
  key: Schema.String,
  address: MeterAddressSchema,
  spec: MeterSpecSchema,
});

export const CurrentMeterResourceSchema = Schema.Struct({
  source: Schema.Literal("current"),
  kind: Schema.Literal("meter"),
  key: Schema.String,
  address: MeterAddressSchema,
  polarId: Schema.String,
  isRemoved: Schema.Boolean,
  spec: MeterSpecSchema,
  raw: Schema.optionalKey(Schema.Unknown),
});

const decodeMeterResource = Schema.decodeUnknownSync(MeterResourceSchema);

export const where = (
  property: string,
  operator: MeterFilterOperator,
  value: MeterFilterValue,
): MeterFilterClause => ({ property, operator, value });

export function eventName(event: Event<unknown>): MeterFilterClause;
export function eventName(
  operator: MeterFilterOperator,
  value: MeterFilterValue,
): MeterFilterClause;
export function eventName(
  eventOrOperator: Event<unknown> | MeterFilterOperator,
  value?: MeterFilterValue,
): MeterFilterClause {
  if (value === undefined) {
    if (typeof eventOrOperator === "string") {
      throw new TypeError("eventName(operator, value) requires a value.");
    }

    return { property: "name", operator: "eq", value: eventOrOperator.name };
  }

  if (typeof eventOrOperator !== "string") {
    throw new TypeError("eventName(event) does not accept a second argument.");
  }

  return { property: "name", operator: eventOrOperator, value };
}

export const eventTimestamp = (
  operator: MeterFilterOperator,
  value: MeterTimestampFilterValue,
): MeterFilterClause => ({
  property: "timestamp",
  operator,
  value: value instanceof Date ? value.toISOString() : value,
});

export const metadata = (
  property: string,
  operator: MeterFilterOperator,
  value: MeterFilterValue,
): MeterFilterClause => ({ property: `metadata.${property}`, operator, value });

export const and = (...clauses: ReadonlyArray<MeterFilterClause | MeterFilter>): MeterFilter => ({
  conjunction: "and",
  clauses,
});

export const or = (...clauses: ReadonlyArray<MeterFilterClause | MeterFilter>): MeterFilter => ({
  conjunction: "or",
  clauses,
});

export type AnyEventMetadataRef =
  | EventMetadataRef<EventMetadataValueType>
  | EventMetadataRef<"string">
  | EventMetadataRef<"number">
  | EventMetadataRef<"boolean">
  | EventMetadataRef<"unknown">;
export type MeterPropertyInput = string | AnyEventMetadataRef;
export type NumericMeterPropertyInput =
  | string
  | EventMetadataRef<"number">
  | EventMetadataRef<EventMetadataValueType>;
export type UniqueMeterPropertyInput =
  | string
  | EventMetadataRef<"string">
  | EventMetadataRef<"number">
  | EventMetadataRef<"boolean">
  | EventMetadataRef<EventMetadataValueType>;

const isEventMetadataRef = (value: unknown): value is AnyEventMetadataRef =>
  typeof value === "object" &&
  value !== null &&
  "meterPath" in value &&
  typeof (value as { readonly meterPath?: unknown }).meterPath === "string";

const aggregationPropertyPath = (property: MeterPropertyInput): string =>
  isEventMetadataRef(property) ? property.key : property;

const isMeterFilter = (filter: MeterFilterInput): filter is MeterFilter => "clauses" in filter;

export function aggregate(func: CountAggregationFunction): CountAggregation;
export function aggregate(
  func: PropertyAggregationFunction,
  property: NumericMeterPropertyInput,
): PropertyAggregation;
export function aggregate(
  func: UniqueAggregationFunction,
  property: UniqueMeterPropertyInput,
): UniqueAggregation;
export function aggregate(
  func: AggregationFunction,
  property?: MeterPropertyInput,
): MeterAggregation {
  if (func === "count") return { func: "count" };
  if (property === undefined) {
    throw new TypeError(`Meter aggregation '${func}' requires a property.`);
  }
  return { func, property: aggregationPropertyPath(property) };
}

export const count = (): CountAggregation => ({ func: "count" });

export function sum(property: string): PropertyAggregation;
export function sum(property: EventMetadataRef<"number">): PropertyAggregation;
export function sum(property: EventMetadataRef<EventMetadataValueType>): PropertyAggregation;
export function sum(property: NumericMeterPropertyInput): PropertyAggregation {
  return { func: "sum", property: aggregationPropertyPath(property) };
}

export function max(property: string): PropertyAggregation;
export function max(property: EventMetadataRef<"number">): PropertyAggregation;
export function max(property: EventMetadataRef<EventMetadataValueType>): PropertyAggregation;
export function max(property: NumericMeterPropertyInput): PropertyAggregation {
  return { func: "max", property: aggregationPropertyPath(property) };
}

export function min(property: string): PropertyAggregation;
export function min(property: EventMetadataRef<"number">): PropertyAggregation;
export function min(property: EventMetadataRef<EventMetadataValueType>): PropertyAggregation;
export function min(property: NumericMeterPropertyInput): PropertyAggregation {
  return { func: "min", property: aggregationPropertyPath(property) };
}

export function avg(property: string): PropertyAggregation;
export function avg(property: EventMetadataRef<"number">): PropertyAggregation;
export function avg(property: EventMetadataRef<EventMetadataValueType>): PropertyAggregation;
export function avg(property: NumericMeterPropertyInput): PropertyAggregation {
  return { func: "avg", property: aggregationPropertyPath(property) };
}

export function unique(property: string): UniqueAggregation;
export function unique(property: EventMetadataRef<"string">): UniqueAggregation;
export function unique(property: EventMetadataRef<"number">): UniqueAggregation;
export function unique(property: EventMetadataRef<"boolean">): UniqueAggregation;
export function unique(property: EventMetadataRef<EventMetadataValueType>): UniqueAggregation;
export function unique(property: UniqueMeterPropertyInput): UniqueAggregation {
  return { func: "unique", property: aggregationPropertyPath(property) };
}

export const meterFilterSpec = (filter: MeterFilterInput): MeterFilterSpec => {
  if (!isMeterFilter(filter)) {
    return meterFilterSpec(and(filter));
  }

  return {
    conjunction: filter.conjunction,
    clauses: filter.clauses.map((clause) =>
      "clauses" in clause
        ? meterFilterSpec(clause)
        : {
            property: clause.property,
            operator: clause.operator,
            value: clause.value,
          },
    ),
  };
};

export const meterAggregationSpec = (aggregation: MeterAggregation): MeterAggregationSpec => {
  switch (aggregation.func) {
    case "count":
      return { func: "count" };
    case "sum":
    case "max":
    case "min":
    case "avg":
      return { func: aggregation.func, property: aggregation.property };
    case "unique":
      return { func: "unique", property: aggregation.property };
  }
};

export const meterSpec = (config: MeterConfig): MeterSpec => ({
  name: config.name,
  unit: config.unit ?? "scalar",
  customLabel: config.customLabel ?? null,
  customMultiplier: config.customMultiplier ?? null,
  filter: meterFilterSpec(config.filter),
  aggregation: meterAggregationSpec(config.aggregation),
});

export class Meter {
  readonly type = "meter" as const;
  readonly kind = "meter" as const;
  readonly key: string;
  readonly address: MeterAddress;
  readonly config: MeterConfig;

  constructor(key: string, config: MeterConfig) {
    this.key = key;
    this.address = makeAddress("meter", key);
    this.config = config;
    registerResource(this);
  }

  toDesiredResource(): MeterResource {
    return decodeMeterResource({
      source: "desired",
      kind: this.kind,
      key: this.key,
      address: this.address,
      spec: meterSpec(this.config),
    });
  }

  toDesired(): MeterResource {
    return this.toDesiredResource();
  }
}
