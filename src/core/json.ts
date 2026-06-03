import * as Schema from "effect/Schema";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonArray = ReadonlyArray<JsonValue>;

export const JsonPrimitive = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
]);

export const JsonValue: Schema.Codec<JsonValue> = Schema.suspend(
  (): Schema.Codec<JsonValue> => Schema.Union([JsonPrimitive, JsonObject, JsonArray]),
);

export const JsonObject: Schema.Codec<JsonObject> = Schema.Record(Schema.String, JsonValue);
export const JsonArray: Schema.Codec<JsonArray> = Schema.Array(JsonValue);

export const decodeJsonObject = Schema.decodeUnknownSync(JsonObject);
export const isJsonObject = Schema.is(JsonObject);
export const isJsonPrimitive = Schema.is(JsonPrimitive);
