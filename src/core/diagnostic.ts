import type { ResourceAddress } from "./address.js";

export type Diagnostic = {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly address?: ResourceAddress;
  readonly path?: string;
  readonly hint?: string;
};

export const errorDiagnostic = (diagnostic: Omit<Diagnostic, "severity">): Diagnostic => ({
  severity: "error",
  ...diagnostic,
});

export const warningDiagnostic = (diagnostic: Omit<Diagnostic, "severity">): Diagnostic => ({
  severity: "warning",
  ...diagnostic,
});

export const hasErrors = (diagnostics: ReadonlyArray<Diagnostic>): boolean =>
  diagnostics.some((diagnostic) => diagnostic.severity === "error");
