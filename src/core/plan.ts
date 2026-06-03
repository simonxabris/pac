import type { ResourceAddress } from "./address.js";
import type { Diagnostic } from "./diagnostic.js";
import type { FieldDiff } from "./diff.js";
import type { JsonObject } from "./json.js";
import type { CanonicalResource } from "./resource.js";

export type ResourceAction =
  | "create"
  | "update"
  | "replace"
  | "archive"
  | "unarchive"
  | "delete"
  | "noop"
  | "blocked";

export type OperationId = string;

export type OperationPreview = {
  readonly title: string;
  readonly lines: ReadonlyArray<string>;
};

export type Operation = {
  readonly id: OperationId;
  readonly provider: "polar";
  readonly kind: string;
  readonly address: ResourceAddress;
  readonly action: Exclude<ResourceAction, "noop" | "blocked"> | "read";
  readonly call: string;
  readonly input: JsonObject;
  readonly dependsOn: ReadonlyArray<OperationId>;
  readonly preview: OperationPreview;
};

export type ResourceChange = {
  readonly address: ResourceAddress;
  readonly kind: string;
  readonly providerId?: string;
  readonly action: ResourceAction;
  readonly before?: CanonicalResource;
  readonly after?: CanonicalResource;
  readonly diffs: ReadonlyArray<FieldDiff>;
  readonly operations: ReadonlyArray<OperationId>;
  readonly dependsOn: ReadonlyArray<ResourceAddress>;
};

export type PlanSummary = {
  readonly create: number;
  readonly update: number;
  readonly replace: number;
  readonly archive: number;
  readonly unarchive: number;
  readonly delete: number;
  readonly blocked: number;
  readonly noop: number;
};

export type Plan = {
  readonly provider: "polar";
  readonly changes: ReadonlyArray<ResourceChange>;
  readonly operations: ReadonlyArray<Operation>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly summary: PlanSummary;
};

export const summarizeChanges = (changes: ReadonlyArray<ResourceChange>): PlanSummary => ({
  create: changes.filter((change) => change.action === "create").length,
  update: changes.filter((change) => change.action === "update").length,
  replace: changes.filter((change) => change.action === "replace").length,
  archive: changes.filter((change) => change.action === "archive").length,
  unarchive: changes.filter((change) => change.action === "unarchive").length,
  delete: changes.filter((change) => change.action === "delete").length,
  blocked: changes.filter((change) => change.action === "blocked").length,
  noop: changes.filter((change) => change.action === "noop").length,
});
