import { Option, Schema } from "effect";

const PaacMetadataContainer = Schema.Struct({
  metadata: Schema.Struct({ paac: Schema.Unknown }),
});

export const hasPaacMetadata = (remote: unknown): boolean =>
  Option.isSome(Schema.decodeUnknownOption(PaacMetadataContainer)(remote));

export const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
};
