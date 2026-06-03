import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import { isJsonObject, type JsonValue } from "./json.js";
import { resolveFieldRule, type FieldRule, type FieldSemantics } from "./field-semantics.js";

export type FieldDiff = {
  readonly path: string;
  readonly before: JsonValue | undefined;
  readonly after: JsonValue | undefined;
  readonly change: "added" | "removed" | "changed";
  readonly rule: FieldRule;
};

export type ArrayRule =
  | { readonly path: string; readonly array: { readonly mode: "ordered" } }
  | { readonly path: string; readonly array: { readonly mode: "unordered" } }
  | { readonly path: string; readonly array: { readonly mode: "keyed"; readonly key: string } };

export type DiffOptions = {
  readonly semantics: FieldSemantics;
  readonly arrays?: ReadonlyArray<ArrayRule>;
};

const JsonKey = Schema.Union([Schema.String, Schema.Number]);
const isJsonKey = Schema.is(JsonKey);

const pointer = (base: string, segment: string | number): string =>
  `${base}/${String(segment).replaceAll("~", "~0").replaceAll("/", "~1")}`;

const findArrayRule = (rules: ReadonlyArray<ArrayRule>, path: string): ArrayRule | undefined =>
  rules.find((rule) => rule.path === path);

const makeDiff = (
  path: string,
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  semantics: FieldSemantics,
): ReadonlyArray<FieldDiff> => {
  const rule = resolveFieldRule(semantics, path);
  if (rule.mode === "ignore" || rule.mode === "computed") return [];
  return [
    {
      path,
      before,
      after,
      change: before === undefined ? "added" : after === undefined ? "removed" : "changed",
      rule,
    },
  ];
};

const keyedArray = (
  values: ReadonlyArray<JsonValue>,
  key: string,
): ReadonlyMap<string, JsonValue> => {
  const entries = values.flatMap((value) => {
    if (!isJsonObject(value)) return [];
    const keyValue = value[key];
    return isJsonKey(keyValue) ? [[String(keyValue), value] as const] : [];
  });
  return new Map(entries);
};

const unorderedArray = (values: ReadonlyArray<JsonValue>): ReadonlyArray<JsonValue> =>
  [...values].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const diffValues = (
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  path: string,
  options: DiffOptions,
): ReadonlyArray<FieldDiff> => {
  if (Equal.equals(before, after)) return [];
  if (before === undefined || after === undefined) {
    return makeDiff(path, before, after, options.semantics);
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const arrayRule = findArrayRule(options.arrays ?? [], path);
    if (arrayRule?.array.mode === "keyed") {
      const beforeByKey = keyedArray(before, arrayRule.array.key);
      const afterByKey = keyedArray(after, arrayRule.array.key);
      const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort();
      return keys.flatMap((key) =>
        diffValues(beforeByKey.get(key), afterByKey.get(key), pointer(path, key), options),
      );
    }

    const orderedBefore = arrayRule?.array.mode === "unordered" ? unorderedArray(before) : before;
    const orderedAfter = arrayRule?.array.mode === "unordered" ? unorderedArray(after) : after;
    const length = Math.max(orderedBefore.length, orderedAfter.length);
    return Array.from({ length }, (_, index) =>
      diffValues(orderedBefore[index], orderedAfter[index], pointer(path, index), options),
    ).flat();
  }

  if (isJsonObject(before) && isJsonObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) => diffValues(before[key], after[key], pointer(path, key), options));
  }

  return makeDiff(path, before, after, options.semantics);
};

export const diffJson = (
  before: JsonValue,
  after: JsonValue,
  options: DiffOptions,
): ReadonlyArray<FieldDiff> => diffValues(before, after, "", options);
