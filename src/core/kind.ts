import { Schema } from "effect";

export type ResourceKind = "product" | "meter" | "benefit";

export const ResourceKindSchema = Schema.Union([
  Schema.Literal("product"),
  Schema.Literal("meter"),
  Schema.Literal("benefit"),
]);
