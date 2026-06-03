import * as Schema from "effect/Schema";
import type { Diagnostic } from "../core/diagnostic.js";
import type { FieldDiff } from "../core/diff.js";
import type { Plan, ResourceChange } from "../core/plan.js";

const RenderableProductPrice = Schema.Struct({
  key: Schema.String,
  currency: Schema.String,
});

const RenderableProductManaged = Schema.Struct({
  prices: Schema.Array(RenderableProductPrice),
});

const decodeRenderableProductManaged = Schema.decodeUnknownSync(RenderableProductManaged);

const marker = (change: ResourceChange): string => {
  switch (change.action) {
    case "create":
      return "+";
    case "update":
      return "~";
    case "replace":
      return "+/-";
    case "archive":
    case "delete":
      return "-";
    case "unarchive":
      return "~";
    case "blocked":
      return "!";
    case "noop":
      return "=";
  }
};

const actionLabel = (change: ResourceChange): string => {
  switch (change.action) {
    case "create":
      return "create";
    case "update":
      return "update";
    case "replace":
      return "replace";
    case "archive":
      return "archive";
    case "unarchive":
      return "unarchive";
    case "delete":
      return "delete";
    case "blocked":
      return "blocked";
    case "noop":
      return "no-op";
  }
};

const renderValue = (value: FieldDiff["before"]): string =>
  value === undefined ? "<absent>" : JSON.stringify(value);

const renderDiagnostic = (diagnostic: Diagnostic): string => {
  const location = [diagnostic.address, diagnostic.path].filter(Boolean).join(" ");
  const hint = diagnostic.hint === undefined ? "" : `\n  hint: ${diagnostic.hint}`;
  return `${diagnostic.severity} ${diagnostic.code}${location === "" ? "" : ` ${location}`}\n  ${diagnostic.message}${hint}`;
};

const amountPriceFields = new Set(["amount", "minimumAmount", "maximumAmount", "presetAmount"]);

const decodePointerSegment = (segment: string): string =>
  segment.replaceAll("~1", "/").replaceAll("~0", "~");

const productPriceAmountPath = (path: string): { readonly key: string; readonly field: string } | undefined => {
  const segments = path.split("/").slice(1).map(decodePointerSegment);
  if (segments.length !== 3 || segments[0] !== "prices" || !amountPriceFields.has(segments[2])) {
    return undefined;
  }
  return { key: segments[1], field: segments[2] };
};

const priceCurrency = (change: ResourceChange, key: string): string | undefined => {
  const candidates = [change.after?.managed, change.before?.managed];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    try {
      const managed = decodeRenderableProductManaged(candidate);
      const price = managed.prices.find((item) => item.key === key);
      if (price !== undefined) return price.currency;
    } catch {
      continue;
    }
  }
  return undefined;
};

const renderMajorAmount = (value: FieldDiff["before"], currency: string): string => {
  if (typeof value === "number") return `${(value / 100).toFixed(2)} ${currency}`;
  return renderValue(value);
};

const priceAmountLabel = (key: string, field: string): string => {
  const suffix = key === "base" ? "" : ` (${key})`;
  switch (field) {
    case "amount":
      return `price${suffix}`;
    case "minimumAmount":
      return `minimum price${suffix}`;
    case "maximumAmount":
      return `maximum price${suffix}`;
    case "presetAmount":
      return `preset price${suffix}`;
    default:
      return `price${suffix}`;
  }
};

const renderProductPriceAmountDiff = (
  change: ResourceChange,
  diff: FieldDiff,
): string | undefined => {
  const pricePath = productPriceAmountPath(diff.path);
  if (pricePath === undefined) return undefined;
  const currency = priceCurrency(change, pricePath.key);
  if (currency === undefined) return undefined;
  const label = priceAmountLabel(pricePath.key, pricePath.field);
  return ` ! ${label}: ${renderMajorAmount(diff.before, currency)} -> ${renderMajorAmount(diff.after, currency)}`;
};

const renderChange = (change: ResourceChange): ReadonlyArray<string> => {
  const id = change.providerId === undefined ? "" : ` (${change.providerId})`;
  const lines = [`${marker(change)} ${change.address}${id} ${actionLabel(change)}`];
  if (change.diffs.length === 0) return lines;

  for (const diff of change.diffs) {
    const renderedPricingDiff = renderProductPriceAmountDiff(change, diff);
    if (renderedPricingDiff !== undefined) {
      lines.push(renderedPricingDiff);
      continue;
    }

    const prefix =
      diff.rule.mode === "createOnly" || diff.rule.mode === "manual" || diff.path.startsWith("/prices/")
        ? "!"
        : " ";
    lines.push(` ${prefix} ${diff.path}: ${renderValue(diff.before)} -> ${renderValue(diff.after)}`);
  }
  return lines;
};

export const renderPlan = (
  plan: Plan,
  mode: "preview" | "deploy" = "preview",
): string => {
  const lines = ["PAAC plan", ""];

  if (plan.diagnostics.length > 0) {
    lines.push("Diagnostics:");
    for (const diagnostic of plan.diagnostics) lines.push(renderDiagnostic(diagnostic));
    lines.push("");
  }

  for (const change of plan.changes.filter((item) => item.action !== "noop")) {
    lines.push(...renderChange(change));
    lines.push("");
  }

  lines.push(
    `Plan: ${plan.summary.create} to create, ${plan.summary.update} to update, ${plan.summary.unarchive} to unarchive, ${plan.summary.archive} to archive, ${plan.summary.blocked} blocked, ${plan.summary.noop} unchanged.`,
  );
  lines.push(mode === "preview" ? "No changes were applied." : "Ready to apply changes.");
  return lines.join("\n");
};
