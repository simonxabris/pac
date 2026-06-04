export type MeterFilterConjunction = "and" | "or";
export type MeterFilterOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "not_like";
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

export type CountAggregationFunction = "count";
export type PropertyAggregationFunction = "sum" | "max" | "min" | "avg";
export type UniqueAggregationFunction = "unique";
export type AggregationFunction =
  | CountAggregationFunction
  | PropertyAggregationFunction
  | UniqueAggregationFunction;

export type CountAggregation = { readonly func: "count" };
export type PropertyAggregation = { readonly func: PropertyAggregationFunction; readonly property: string };
export type UniqueAggregation = { readonly func: "unique"; readonly property: string };
export type MeterAggregation = CountAggregation | PropertyAggregation | UniqueAggregation;

export type MeterConfig = {
  readonly name: string;
  readonly unit?: "scalar" | "token" | "custom";
  readonly customLabel?: string;
  readonly customMultiplier?: number | null;
  readonly filter: MeterFilter;
  readonly aggregation: MeterAggregation;
};

export const where = (
  _property: string,
  _operator: MeterFilterOperator,
  _value: MeterFilterValue,
): MeterFilterClause => ({ property: "", operator: "eq", value: "" });

export const eventName = (
  _operator: MeterFilterOperator,
  _value: MeterFilterValue,
): MeterFilterClause => ({ property: "", operator: "eq", value: "" });

export const eventTimestamp = (
  _operator: MeterFilterOperator,
  _value: MeterTimestampFilterValue,
): MeterFilterClause => ({ property: "", operator: "eq", value: "" });

export const metadata = (
  _property: string,
  _operator: MeterFilterOperator,
  _value: MeterFilterValue,
): MeterFilterClause => ({ property: "", operator: "eq", value: "" });

export const and = (..._clauses: ReadonlyArray<MeterFilterClause | MeterFilter>): MeterFilter =>
  ({ conjunction: "and", clauses: [] });

export const or = (..._clauses: ReadonlyArray<MeterFilterClause | MeterFilter>): MeterFilter =>
  ({ conjunction: "or", clauses: [] });

export function aggregate(_func: CountAggregationFunction): CountAggregation;
export function aggregate(_func: PropertyAggregationFunction, _property: string): PropertyAggregation;
export function aggregate(_func: UniqueAggregationFunction, _property: string): UniqueAggregation;
export function aggregate(_func: AggregationFunction, _property?: string): MeterAggregation {
  return { func: "count" };
}

export const count = (): CountAggregation => ({ func: "count" });

export const sum = (_property: string): PropertyAggregation => ({ func: "sum", property: "" });
export const max = (_property: string): PropertyAggregation => ({ func: "max", property: "" });
export const min = (_property: string): PropertyAggregation => ({ func: "min", property: "" });
export const avg = (_property: string): PropertyAggregation => ({ func: "avg", property: "" });
export const unique = (_property: string): UniqueAggregation => ({ func: "unique", property: "" });

export class Meter {
  readonly type = "meter" as const;
  readonly kind = "meter" as const;
  readonly key: string;
  readonly address: `meter.${string}`;
  readonly config: MeterConfig;

  constructor(key: string, config: MeterConfig) {
    this.key = key;
    this.address = `meter.${key}`;
    this.config = config;
  }

  toDesiredResource(): unknown {
    return {};
  }

  toDesired(): unknown {
    return {};
  }
}
