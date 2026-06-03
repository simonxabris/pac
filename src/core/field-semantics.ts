export type FieldRule =
  | { readonly mode: "update" }
  | { readonly mode: "replace" }
  | { readonly mode: "createOnly" }
  | { readonly mode: "ignore" }
  | { readonly mode: "computed" }
  | { readonly mode: "manual"; readonly reason: string }
  | { readonly mode: "custom"; readonly handler: string };

export type FieldSemantics = ReadonlyArray<{
  readonly path: string;
  readonly rule: FieldRule;
}>;

const defaultRule: FieldRule = { mode: "update" };

export const resolveFieldRule = (semantics: FieldSemantics, path: string): FieldRule => {
  const matches = semantics.filter(
    (entry) => path === entry.path || (entry.path !== "" && path.startsWith(`${entry.path}/`)),
  );
  return matches.sort((left, right) => right.path.length - left.path.length)[0]?.rule ?? defaultRule;
};
