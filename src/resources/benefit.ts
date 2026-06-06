import { Schema } from "effect";
import { makeAddress, type ResourceAddress } from "../core/address.js";
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

export type BenefitConfig = MeterCreditBenefitConfig | CustomBenefitConfig;

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

export type BenefitSpec = BenefitMeterCreditSpec | BenefitCustomSpec;

export type BenefitResource = DesiredResource<BenefitKind, BenefitSpec>;
export type CurrentBenefitResource = CurrentResource<BenefitKind, BenefitSpec>;

const BenefitDescriptionSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(3), Schema.isMaxLength(42)),
);

const BenefitUnitsSchema = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 2_147_483_647 })),
);

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

export const BenefitSpecSchema: Schema.Codec<BenefitSpec> = Schema.Union([
  BenefitMeterCreditSpecSchema,
  BenefitCustomSpecSchema,
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
