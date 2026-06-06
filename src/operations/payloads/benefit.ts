import type { BenefitMeterCreditCreate } from "@polar-sh/sdk/models/components/benefitmetercreditcreate.js";
import type { BenefitMeterCreditUpdate } from "@polar-sh/sdk/models/components/benefitmetercreditupdate.js";
import type { Resolvable } from "../ref.js";

export type BenefitMeterCreditPropertiesOperationPayload = Omit<
  BenefitMeterCreditCreate["properties"],
  "meterId"
> & {
  readonly meterId: Resolvable<string>;
};

export type BenefitCreateOperationPayload = Omit<BenefitMeterCreditCreate, "properties"> & {
  readonly metadata: { readonly paac: string };
  readonly properties: BenefitMeterCreditPropertiesOperationPayload;
};

export type BenefitUpdateOperationPayload = Omit<BenefitMeterCreditUpdate, "properties"> & {
  properties?: BenefitMeterCreditPropertiesOperationPayload | null | undefined;
};
