import * as Schema from "effect/Schema";
import { decodeJsonObject } from "../../../../core/json.js";

export const MeterUnit = Schema.Union([
  Schema.Literal("scalar"),
  Schema.Literal("token"),
  Schema.Literal("custom"),
]);
export const FilterConjunction = Schema.Union([Schema.Literal("and"), Schema.Literal("or")]);
export const FilterOperator = Schema.Union([
  Schema.Literal("eq"),
  Schema.Literal("ne"),
  Schema.Literal("gt"),
  Schema.Literal("gte"),
  Schema.Literal("lt"),
  Schema.Literal("lte"),
  Schema.Literal("like"),
  Schema.Literal("not_like"),
]);
export const FilterValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);

export const CanonicalMeterFilterClause = Schema.Struct({
  property: Schema.String,
  operator: FilterOperator,
  value: FilterValue,
});

export type CanonicalMeterFilterClause = typeof CanonicalMeterFilterClause.Type;
export type CanonicalMeterFilter = {
  readonly conjunction: typeof FilterConjunction.Type;
  readonly clauses: ReadonlyArray<CanonicalMeterFilterClause | CanonicalMeterFilter>;
};

export const CanonicalMeterFilter: Schema.Codec<CanonicalMeterFilter> = Schema.suspend(
  (): Schema.Codec<CanonicalMeterFilter> =>
    Schema.Struct({
      conjunction: FilterConjunction,
      clauses: Schema.Array(Schema.Union([CanonicalMeterFilterClause, CanonicalMeterFilter])),
    }),
);

export const CountAggregationFunction = Schema.Literal("count");
export const PropertyAggregationFunction = Schema.Union([
  Schema.Literal("sum"),
  Schema.Literal("max"),
  Schema.Literal("min"),
  Schema.Literal("avg"),
]);
export const UniqueAggregationFunction = Schema.Literal("unique");
export const AggregationFunction = Schema.Union([
  CountAggregationFunction,
  PropertyAggregationFunction,
  UniqueAggregationFunction,
]);

export const CountAggregation = Schema.Struct({
  func: CountAggregationFunction,
});
export const PropertyAggregation = Schema.Struct({
  func: PropertyAggregationFunction,
  property: Schema.String,
});
export const UniqueAggregation = Schema.Struct({
  func: UniqueAggregationFunction,
  property: Schema.String,
});
export const CanonicalMeterAggregation = Schema.Union([
  CountAggregation,
  PropertyAggregation,
  UniqueAggregation,
]);

export const MeterManagedV1 = Schema.Struct({
  name: Schema.String,
  unit: MeterUnit,
  customLabel: Schema.optionalKey(Schema.NullOr(Schema.String)),
  customMultiplier: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  filter: CanonicalMeterFilter,
  aggregation: CanonicalMeterAggregation,
  isArchived: Schema.Boolean,
});

export const MeterDesiredConfig = Schema.Struct({
  managed: MeterManagedV1,
});

const MetadataValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]);

export const RemoteMeterV1 = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  unit: MeterUnit,
  customLabel: Schema.optionalKey(Schema.NullOr(Schema.String)),
  customMultiplier: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  filter: CanonicalMeterFilter,
  aggregation: CanonicalMeterAggregation,
  metadata: Schema.Record(Schema.String, MetadataValue),
  archivedAt: Schema.optionalKey(Schema.NullOr(Schema.Unknown)),
});

export type MeterManagedV1 = typeof MeterManagedV1.Type;
export type MeterDesiredConfig = typeof MeterDesiredConfig.Type;
export type AggregationFunction = typeof AggregationFunction.Type;
export type CanonicalMeterAggregation = typeof CanonicalMeterAggregation.Type;
export type RemoteMeterV1 = typeof RemoteMeterV1.Type;

export const decodeMeterDesiredConfig = Schema.decodeUnknownSync(MeterDesiredConfig, {
  onExcessProperty: "error",
});
export const decodeMeterManagedV1 = Schema.decodeUnknownSync(MeterManagedV1);
export const decodeRemoteMeterV1 = Schema.decodeUnknownSync(RemoteMeterV1);

export const meterManagedJson = (managed: MeterManagedV1) => decodeJsonObject(managed);
