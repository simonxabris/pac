import type { BenefitCustomCreate } from "@polar-sh/sdk/models/components/benefitcustomcreate.js";
import type { BenefitCustomUpdate } from "@polar-sh/sdk/models/components/benefitcustomupdate.js";
import type { BenefitMeterCreditCreate } from "@polar-sh/sdk/models/components/benefitmetercreditcreate.js";
import type { BenefitMeterCreditUpdate } from "@polar-sh/sdk/models/components/benefitmetercreditupdate.js";
import type { Resolvable } from "../ref.js";

export type BenefitMeterCreditPropertiesOperationPayload = Omit<
  BenefitMeterCreditCreate["properties"],
  "meterId"
> & {
  readonly meterId: Resolvable<string>;
};

export type BenefitMeterCreditCreateOperationPayload = Omit<BenefitMeterCreditCreate, "properties"> & {
  readonly metadata: { readonly paac: string };
  readonly properties: BenefitMeterCreditPropertiesOperationPayload;
};

export type BenefitCustomCreateOperationPayload = BenefitCustomCreate & {
  readonly metadata: { readonly paac: string };
};

export type BenefitCreateOperationPayload =
  | BenefitMeterCreditCreateOperationPayload
  | BenefitCustomCreateOperationPayload;

export type BenefitMeterCreditUpdateOperationPayload = Omit<BenefitMeterCreditUpdate, "properties"> & {
  properties?: BenefitMeterCreditPropertiesOperationPayload | null | undefined;
};

export type BenefitCustomUpdateOperationPayload = BenefitCustomUpdate;

export type BenefitUpdateOperationPayload =
  | BenefitMeterCreditUpdateOperationPayload
  | BenefitCustomUpdateOperationPayload;
