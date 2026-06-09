import { Option, Schema } from "effect";

const PacMetadataContainer = Schema.Struct({
  metadata: Schema.Struct({ pac: Schema.Unknown }),
});

export const hasPacMetadata = (remote: unknown): boolean =>
  Option.isSome(Schema.decodeUnknownOption(PacMetadataContainer)(remote));

export const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
};
