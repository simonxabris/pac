import type {
  BenefitCreateOperationPayload,
  BenefitUpdateOperationPayload,
} from "./payloads/benefit.js";
import type {
  MeterArchiveOperationPayload,
  MeterCreateOperationPayload,
  MeterUpdateOperationPayload,
} from "./payloads/meter.js";
import type {
  ProductArchiveOperationPayload,
  ProductBenefitsUpdateOperationPayload,
  ProductCreateOperationPayload,
  ProductUpdateOperationPayload,
} from "./payloads/product.js";
import type { Resolvable } from "./ref.js";

export type CreateMeterAction = {
  readonly _tag: "CreateMeter";
  readonly payload: MeterCreateOperationPayload;
};

export type UpdateMeterAction = {
  readonly _tag: "UpdateMeter";
  readonly id: Resolvable<string>;
  readonly payload: MeterUpdateOperationPayload;
};

export type ArchiveMeterAction = {
  readonly _tag: "ArchiveMeter";
  readonly id: Resolvable<string>;
  readonly payload: MeterArchiveOperationPayload;
};

export type CreateBenefitAction = {
  readonly _tag: "CreateBenefit";
  readonly payload: BenefitCreateOperationPayload;
};

export type UpdateBenefitAction = {
  readonly _tag: "UpdateBenefit";
  readonly id: Resolvable<string>;
  readonly payload: BenefitUpdateOperationPayload;
};

export type DeleteBenefitAction = {
  readonly _tag: "DeleteBenefit";
  readonly id: Resolvable<string>;
};

export type CreateProductAction = {
  readonly _tag: "CreateProduct";
  readonly payload: ProductCreateOperationPayload;
};

export type UpdateProductAction = {
  readonly _tag: "UpdateProduct";
  readonly id: Resolvable<string>;
  readonly payload: ProductUpdateOperationPayload;
};

export type ArchiveProductAction = {
  readonly _tag: "ArchiveProduct";
  readonly id: Resolvable<string>;
  readonly payload: ProductArchiveOperationPayload;
};

export type UpdateProductBenefitsAction = {
  readonly _tag: "UpdateProductBenefits";
  readonly id: Resolvable<string>;
  readonly payload: ProductBenefitsUpdateOperationPayload;
};

export type OperationAction =
  | CreateMeterAction
  | UpdateMeterAction
  | ArchiveMeterAction
  | CreateBenefitAction
  | UpdateBenefitAction
  | DeleteBenefitAction
  | CreateProductAction
  | UpdateProductAction
  | ArchiveProductAction
  | UpdateProductBenefitsAction;
