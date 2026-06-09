import { Schema } from "effect";
import { makeAddress, type ResourceAddress } from "../core/address.js";
import { PAC_METADATA_KEY } from "../core/metadata.js";
import type { CurrentResource, DesiredResource } from "../core/resource.js";
import { MeterAddressSchema, type Meter, type MeterAddress } from "./meter.js";
import { registerResource } from "./registry.js";

export type BenefitKind = "benefit";
export type BenefitAddress = ResourceAddress<BenefitKind>;
export const BenefitAddressSchema = Schema.TemplateLiteral(["benefit.", Schema.String]);

export type MeterReference = MeterAddress | Pick<Meter, "address">;

export type MeterCreditBenefitConfig = {
  readonly type: "meter-credit";
  readonly description: string;
  readonly meter: MeterReference;
  readonly units: number;
  readonly rollover?: boolean;
};

export type CustomBenefitConfig = {
  readonly type: "custom";
  readonly description: string;
  readonly note?: string | null;
};

export type BenefitMetadataValue = string | number | boolean;
export type BenefitMetadata = Readonly<Record<string, BenefitMetadataValue>>;

export type FeatureFlagBenefitConfig = {
  readonly type: "feature-flag";
  readonly description: string;
  readonly metadata?: BenefitMetadata;
};

export type BenefitConfig =
  | MeterCreditBenefitConfig
  | CustomBenefitConfig
  | FeatureFlagBenefitConfig;

export type BenefitMeterCreditSpec = {
  readonly type: "meter-credit";
  readonly description: string;
  readonly meter: MeterAddress;
  readonly units: number;
  readonly rollover: boolean;
};

export type BenefitCustomSpec = {
  readonly type: "custom";
  readonly description: string;
  readonly note: string | null;
};

export type BenefitFeatureFlagSpec = {
  readonly type: "feature-flag";
  readonly description: string;
  readonly metadata: BenefitMetadata;
};

export type BenefitSpec = BenefitMeterCreditSpec | BenefitCustomSpec | BenefitFeatureFlagSpec;

export type BenefitResource = DesiredResource<BenefitKind, BenefitSpec>;
export type CurrentBenefitResource = CurrentResource<BenefitKind, BenefitSpec>;

const BenefitDescriptionSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(3), Schema.isMaxLength(42)),
);

const BenefitUnitsSchema = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 2_147_483_647 })),
);

export const BenefitMetadataValueSchema = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
]);
export const BenefitMetadataSchema = Schema.Record(Schema.String, BenefitMetadataValueSchema);

export const normalizeBenefitMetadata = (metadata: BenefitMetadata = {}): BenefitMetadata => {
  const entries = Object.entries(metadata);

  if (entries.length > 49) {
    throw new Error(
      "Feature Flag Benefit metadata may contain at most 49 entries; PAC reserves one metadata slot.",
    );
  }

  const normalized: Record<string, BenefitMetadataValue> = {};

  for (const [key, value] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (key.length === 0) {
      throw new Error("Feature Flag Benefit metadata keys must not be empty.");
    }
    if (key.length > 40) {
      throw new Error("Feature Flag Benefit metadata keys must be at most 40 characters.");
    }
    if (key === PAC_METADATA_KEY) {
      throw new Error(
        `Feature Flag Benefit metadata key '${PAC_METADATA_KEY}' is reserved by PAC.`,
      );
    }

    switch (typeof value) {
      case "string":
        if (value.length === 0) {
          throw new Error("Feature Flag Benefit metadata string values must not be empty.");
        }
        if (value.length > 500) {
          throw new Error(
            "Feature Flag Benefit metadata string values must be at most 500 characters.",
          );
        }
        normalized[key] = value;
        break;
      case "number":
        if (!Number.isFinite(value)) {
          throw new Error("Feature Flag Benefit metadata number values must be finite.");
        }
        normalized[key] = value;
        break;
      case "boolean":
        normalized[key] = value;
        break;
      default:
        throw new Error(
          "Feature Flag Benefit metadata values must be strings, numbers, or booleans.",
        );
    }
  }

  return normalized;
};

export const BenefitMeterCreditSpecSchema = Schema.Struct({
  type: Schema.Literal("meter-credit"),
  description: BenefitDescriptionSchema,
  meter: MeterAddressSchema,
  units: BenefitUnitsSchema,
  rollover: Schema.Boolean,
});

export const BenefitCustomSpecSchema = Schema.Struct({
  type: Schema.Literal("custom"),
  description: BenefitDescriptionSchema,
  note: Schema.NullOr(Schema.String),
});

export const BenefitFeatureFlagSpecSchema = Schema.Struct({
  type: Schema.Literal("feature-flag"),
  description: BenefitDescriptionSchema,
  metadata: BenefitMetadataSchema,
});

export const BenefitSpecSchema: Schema.Codec<BenefitSpec> = Schema.Union([
  BenefitMeterCreditSpecSchema,
  BenefitCustomSpecSchema,
  BenefitFeatureFlagSpecSchema,
]);

export const BenefitResourceSchema = Schema.Struct({
  source: Schema.Literal("desired"),
  kind: Schema.Literal("benefit"),
  key: Schema.String,
  address: BenefitAddressSchema,
  spec: BenefitSpecSchema,
});

export const CurrentBenefitResourceSchema = Schema.Struct({
  source: Schema.Literal("current"),
  kind: Schema.Literal("benefit"),
  key: Schema.String,
  address: BenefitAddressSchema,
  polarId: Schema.String,
  isRemoved: Schema.Boolean,
  spec: BenefitSpecSchema,
  raw: Schema.optionalKey(Schema.Unknown),
});

const decodeMeterAddress = Schema.decodeUnknownSync(MeterAddressSchema);
const decodeBenefitResource = Schema.decodeUnknownSync(BenefitResourceSchema);
const decodeBenefitSpec = Schema.decodeUnknownSync(BenefitSpecSchema);

const meterReference = (meter: MeterReference): string => {
  if (typeof meter === "string") return meter;
  return meter.address;
};

export const benefitSpec = (config: BenefitConfig): BenefitSpec => {
  switch (config.type) {
    case "meter-credit":
      return decodeBenefitSpec({
        type: "meter-credit",
        description: config.description,
        meter: decodeMeterAddress(meterReference(config.meter)),
        units: config.units,
        rollover: config.rollover ?? false,
      });
    case "custom":
      return decodeBenefitSpec({
        type: "custom",
        description: config.description,
        note: config.note ?? null,
      });
    case "feature-flag":
      return decodeBenefitSpec({
        type: "feature-flag",
        description: config.description,
        metadata: normalizeBenefitMetadata(config.metadata ?? {}),
      });
  }
};

export class Benefit {
  readonly type = "benefit" as const;
  readonly kind = "benefit" as const;
  readonly key: string;
  readonly address: BenefitAddress;
  readonly config: BenefitConfig;

  constructor(key: string, config: BenefitConfig) {
    this.key = key;
    this.address = makeAddress("benefit", key);
    this.config = config;
    registerResource(this);
  }

  toDesiredResource(): BenefitResource {
    return decodeBenefitResource({
      source: "desired",
      kind: this.kind,
      key: this.key,
      address: this.address,
      spec: benefitSpec(this.config),
    });
  }
}
