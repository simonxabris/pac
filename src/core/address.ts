import * as Schema from "effect/Schema";
import type { ResourceKind } from "./kind.js";

export type ResourceAddress<Kind extends ResourceKind = ResourceKind> = `${Kind}.${string}`;

export type ParsedAddress = {
  readonly kind: string;
  readonly key: string;
};

const resourceKeyPattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const resourceAddressPattern = /^[a-zA-Z][a-zA-Z0-9_-]*\.[a-zA-Z][a-zA-Z0-9_-]*$/;

export const ResourceKey = Schema.String.check(
  Schema.makeFilter(
    (value) => resourceKeyPattern.test(value),
    { message: "Resource keys must match [a-zA-Z][a-zA-Z0-9_-]*" },
  ),
);

export const ResourceAddress = Schema.String.check(
  Schema.makeFilter(
    (value) => resourceAddressPattern.test(value),
    { message: "Resource addresses must be formed as {kind}.{key}" },
  ),
);

export const decodeResourceKey = Schema.decodeUnknownSync(ResourceKey);
export const decodeResourceAddress = Schema.decodeUnknownSync(ResourceAddress);

export const makeAddress = <const Kind extends ResourceKind>(kind: Kind, key: string): ResourceAddress<Kind> =>
  decodeResourceAddress(`${decodeResourceKey(kind)}.${decodeResourceKey(key)}`) as ResourceAddress<Kind>;
