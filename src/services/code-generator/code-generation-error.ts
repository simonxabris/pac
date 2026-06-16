import { Schema } from "effect";

export class CodeGenerationError extends Schema.TaggedErrorClass<CodeGenerationError>()(
  "CodeGenerationError",
  {
    address: Schema.optionalKey(Schema.String),
    message: Schema.String,
  },
) {}
