import * as Flag from "effect/unstable/cli/Flag";

export const polarEnvFlag = Flag.choice("env", ["production", "sandbox"] as const).pipe(
  Flag.withDefault("sandbox"),
  Flag.withDescription("Polar environment to authenticate against"),
);

export const polarRuntimeEnvFlag = Flag.choice("env", ["production", "sandbox"] as const).pipe(
  Flag.withDefault("production"),
  Flag.withDescription("Polar environment to run against. POLAR_ENV takes precedence when set."),
);

export const configFlag = Flag.string("config").pipe(
  Flag.withDefault("pac.config.ts"),
  Flag.withDescription("Path to the PAC config file to load"),
);

export const allowDeleteFlag = Flag.boolean("allow-delete").pipe(
  Flag.withDescription("Allow destructive delete-mode removals during deploy"),
);

export const generatePathFlag = Flag.string("path").pipe(
  Flag.withDefault("."),
  Flag.withDescription(
    "Output directory or file path. Directories use the default file name pac.runtime.ts.",
  ),
);

export const importPathFlag = Flag.string("path").pipe(
  Flag.withDefault("pac.config.ts"),
  Flag.withDescription("Output path for the generated PAC config file"),
);

export const overwriteFlag = Flag.boolean("overwrite").pipe(
  Flag.withDescription("Allow replacing an existing output file"),
);

export const dryRunFlag = Flag.boolean("dry-run").pipe(
  Flag.withDescription(
    "Print the generated config and adoption plan without writing or mutating Polar",
  ),
);

export const skipUnsupportedFlag = Flag.boolean("skip-unsupported").pipe(
  Flag.withDescription("Skip unsupported remote resources instead of failing the import"),
);

export const forceFlag = Flag.boolean("force").pipe(
  Flag.withDescription("Overwrite conflicting existing PAC Metadata"),
);
