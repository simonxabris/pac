import { Schema } from "effect";

export type ResourceKind = "product" | "meter";

export const ResourceKindSchema = Schema.Union([
  Schema.Literal("product"),
  Schema.Literal("meter"),
]);
