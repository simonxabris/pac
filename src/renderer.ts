import { Console, Effect, Layer } from "effect";
import * as Context from "effect/Context";
import { formatMinorUnitAmount, type CurrencyAmountInput } from "./currency/currency.js";
import type { Diagnostic, FieldChange, Plan, PlanNode } from "./planner.js";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIdentifier = (value: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);

const renderPath = (path: ReadonlyArray<string | number>): string => {
  if (path.length === 0) return "(root)";

  return path
    .map((segment, index) => {
      if (typeof segment === "number") return `[${segment}]`;
      if (index === 0 && isIdentifier(segment)) return segment;
      if (isIdentifier(segment)) return `.${segment}`;
      return `[${JSON.stringify(segment)}]`;
    })
    .join("");
};

const renderValue = (value: unknown): string => {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);

  try {
    const rendered = JSON.stringify(value, null, 2);
    return rendered === undefined ? String(value) : rendered;
  } catch {
    return String(value);
  }
};

const PRICE_AMOUNT_FIELDS: ReadonlySet<string | number> = new Set([
  "amount",
  "minimumAmount",
  "maximumAmount",
  "presetAmount",
  "capAmount",
]);

const getPathValue = (value: unknown, path: ReadonlyArray<string | number>): unknown => {
  let cursor = value;

  for (const segment of path) {
    if (Array.isArray(cursor) && typeof segment === "number") {
      cursor = cursor[segment];
      continue;
    }

    if (isRecord(cursor) && typeof segment === "string") {
      cursor = cursor[segment];
      continue;
    }

    return undefined;
  }

  return cursor;
};

const priceCurrencyForPath = (spec: unknown, path: ReadonlyArray<string | number>): string | undefined => {
  const [collection, index, field] = path;
  if (collection !== "prices" || typeof index !== "number" || !PRICE_AMOUNT_FIELDS.has(field)) {
    return undefined;
  }

  const currency = getPathValue(spec, ["prices", index, "currency"]);
  return typeof currency === "string" ? currency : undefined;
};

const isCurrencyAmountInput = (value: unknown): value is CurrencyAmountInput =>
  typeof value === "string" || typeof value === "number" || typeof value === "bigint";

const renderPlanValue = (
  value: unknown,
  context?: { readonly spec: unknown; readonly path: ReadonlyArray<string | number> },
): string => {
  const currency = context === undefined ? undefined : priceCurrencyForPath(context.spec, context.path);

  if (currency !== undefined && isCurrencyAmountInput(value)) {
    try {
      return formatMinorUnitAmount(value, currency);
    } catch {
      return renderValue(value);
    }
  }

  return renderValue(value);
};

type RenderedField = {
  readonly path: ReadonlyArray<string | number>;
  readonly value: unknown;
};

const collectFields = (
  value: unknown,
  path: ReadonlyArray<string | number>,
  fields: Array<RenderedField>,
): void => {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      fields.push({ path, value });
      return;
    }

    for (let index = 0; index < value.length; index++) {
      collectFields(value[index], [...path, index], fields);
    }
    return;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      fields.push({ path, value });
      return;
    }

    for (const [key, entryValue] of entries) {
      collectFields(entryValue, [...path, key], fields);
    }
    return;
  }

  fields.push({ path, value });
};

const renderIndentedValue = (label: string, value: unknown, spaces: number): string => {
  const indentation = " ".repeat(spaces);
  const lines = renderValue(value).split("\n");
  const [firstLine, ...remainingLines] = lines;

  return [
    `${indentation}${label}: ${firstLine ?? ""}`,
    ...remainingLines.map((line) => `${indentation}${line}`),
  ].join("\n");
};

const renderField = (field: RenderedField, spec: unknown): string =>
  `      ${renderPath(field.path)}: ${renderPlanValue(field.value, { path: field.path, spec })}`;

const renderFieldChange = (change: FieldChange, node: Extract<PlanNode, { readonly _tag: "Update" }>): string => {
  const before = renderPlanValue(change.before, { path: change.path, spec: node.current.spec });
  const after = renderPlanValue(change.after, { path: change.path, spec: node.desired.spec });
  const path = renderPath(change.path);

  if (!before.includes("\n") && !after.includes("\n")) {
    return `      ${path}: ${before} -> ${after}`;
  }

  return [
    `      ${path}:`,
    renderIndentedValue("before", change.before, 8),
    renderIndentedValue("after", change.after, 8),
  ].join("\n");
};

const renderCreateFields = (node: Extract<PlanNode, { readonly _tag: "Create" }>): ReadonlyArray<string> => {
  const fields: Array<RenderedField> = [{ path: ["key"], value: node.desired.key }];
  collectFields(node.desired.spec, [], fields);

  return ["    Fields:", ...fields.map((field) => renderField(field, node.desired.spec))];
};

const renderUpdateChanges = (node: Extract<PlanNode, { readonly _tag: "Update" }>): ReadonlyArray<string> => [
  "    Changes:",
  ...node.changes.map((change) => renderFieldChange(change, node)),
];

const renderNode = (node: PlanNode): string => {
  switch (node._tag) {
    case "Create":
      return [`  + ${node.address} (${node.kind})`, ...renderCreateFields(node)].join("\n");
    case "Update":
      return [`  ~ ${node.address} (${node.kind})`, ...renderUpdateChanges(node)].join("\n");
    case "Remove":
      return node.mode === "delete"
        ? `  ! ${node.address} (${node.kind})`
        : `  - ${node.address} (${node.kind})`;
    case "Noop":
      return `  = ${node.address} (${node.kind})`;
    case "Blocked":
      return `  ! ${node.address} (${node.kind})`;
  }
};

const renderDiagnostic = (diagnostic: Diagnostic): string => {
  const address = diagnostic.address ? ` [${diagnostic.address}]` : "";
  return `  [${diagnostic.severity.toUpperCase()}] ${diagnostic.code}${address}: ${diagnostic.message}`;
};

export class Renderer extends Context.Service<
  Renderer,
  {
    readonly render: (plan: Plan) => Effect.Effect<void>;
  }
>()("@app/Renderer") {
  static readonly layer = Layer.succeed(
    Renderer,
    Renderer.of({
      render: (plan) =>
        Effect.gen(function*() {
          const nodes = [...plan.nodes.values()];
          const creates = nodes.filter((n) => n._tag === "Create");
          const updates = nodes.filter((n) => n._tag === "Update");
          const archives = nodes.filter((n) => n._tag === "Remove" && n.mode === "archive");
          const deletes = nodes.filter((n) => n._tag === "Remove" && n.mode === "delete");
          const noops = nodes.filter((n) => n._tag === "Noop");
          const blocked = nodes.filter((n) => n._tag === "Blocked");

          yield* Console.log("");
          yield* Console.log(`Plan Summary (${nodes.length} resources)`);
          yield* Console.log("─".repeat(40));

          if (creates.length > 0) {
            yield* Console.log(`\nCreate (${creates.length}):`);
            for (const node of creates) {
              yield* Console.log(renderNode(node));
            }
          }

          if (updates.length > 0) {
            yield* Console.log(`\nUpdate (${updates.length}):`);
            for (const node of updates) {
              yield* Console.log(renderNode(node));
            }
          }

          if (archives.length > 0) {
            yield* Console.log(`\nArchive (${archives.length}):`);
            for (const node of archives) {
              yield* Console.log(renderNode(node));
            }
          }

          if (deletes.length > 0) {
            yield* Console.log(`\nDelete (${deletes.length}):`);
            yield* Console.log("  WARNING: delete-mode removals are destructive and may revoke existing access or grants.");
            for (const node of deletes) {
              yield* Console.log(renderNode(node));
            }
          }

          if (noops.length > 0) {
            yield* Console.log(`\nNo change (${noops.length}):`);
            for (const node of noops) {
              yield* Console.log(renderNode(node));
            }
          }

          if (blocked.length > 0) {
            yield* Console.log(`\nBlocked (${blocked.length}):`);
            for (const node of blocked) {
              yield* Console.log(renderNode(node));
            }
          }

          if (plan.edges.length > 0) {
            yield* Console.log(`\nDependencies (${plan.edges.length}):`);
            for (const edge of plan.edges) {
              yield* Console.log(`  ${edge.from} -> ${edge.to}`);
            }
          }

          if (plan.diagnostics.length > 0) {
            yield* Console.log(`\nDiagnostics (${plan.diagnostics.length}):`);
            for (const diagnostic of plan.diagnostics) {
              yield* Console.log(renderDiagnostic(diagnostic));
            }
          }

          yield* Console.log("");
        }),
    }),
  );
}
