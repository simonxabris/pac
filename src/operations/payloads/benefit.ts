import type { BenefitCustomCreate } from "@polar-sh/sdk/models/components/benefitcustomcreate.js";
import type { BenefitCustomUpdate } from "@polar-sh/sdk/models/components/benefitcustomupdate.js";
import type { BenefitFeatureFlagCreate } from "@polar-sh/sdk/models/components/benefitfeatureflagcreate.js";
import type { BenefitFeatureFlagUpdate } from "@polar-sh/sdk/models/components/benefitfeatureflagupdate.js";
import type { BenefitMeterCreditCreate } from "@polar-sh/sdk/models/components/benefitmetercreditcreate.js";
import type { BenefitMeterCreditUpdate } from "@polar-sh/sdk/models/components/benefitmetercreditupdate.js";
import { PAC_METADATA_KEY } from "../../core/metadata.js";
import type { Resolvable } from "../ref.js";

export type BenefitOperationMetadata = Readonly<Record<string, string | number | boolean>> & {
  readonly [PAC_METADATA_KEY]: string;
};

export type BenefitMeterCreditPropertiesOperationPayload = Omit<
  BenefitMeterCreditCreate["properties"],
  "meterId"
> & {
  readonly meterId: Resolvable<string>;
};

export type BenefitMeterCreditCreateOperationPayload = Omit<
  BenefitMeterCreditCreate,
  "properties"
> & {
  readonly metadata: BenefitOperationMetadata;
  readonly properties: BenefitMeterCreditPropertiesOperationPayload;
};

export type BenefitCustomCreateOperationPayload = BenefitCustomCreate & {
  readonly metadata: BenefitOperationMetadata;
};

export type BenefitFeatureFlagCreateOperationPayload = BenefitFeatureFlagCreate & {
  readonly metadata: BenefitOperationMetadata;
};

export type BenefitCreateOperationPayload =
  | BenefitMeterCreditCreateOperationPayload
  | BenefitCustomCreateOperationPayload
  | BenefitFeatureFlagCreateOperationPayload;

export type BenefitMeterCreditUpdateOperationPayload = Omit<
  BenefitMeterCreditUpdate,
  "properties"
> & {
  properties?: BenefitMeterCreditPropertiesOperationPayload | null | undefined;
};

export type BenefitCustomUpdateOperationPayload = BenefitCustomUpdate;

export type BenefitFeatureFlagUpdateOperationPayload = BenefitFeatureFlagUpdate;

export type BenefitUpdateOperationPayload =
  | BenefitMeterCreditUpdateOperationPayload
  | BenefitCustomUpdateOperationPayload
  | BenefitFeatureFlagUpdateOperationPayload;
