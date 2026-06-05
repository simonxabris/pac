import type { ProductCreateOperationPayload } from "./payloads/product.js";
import type { Resolvable } from "./ref.js";

export type CreateMeterAction = {
  readonly _tag: "CreateMeter";
  readonly payload: unknown;
};

export type UpdateMeterAction = {
  readonly _tag: "UpdateMeter";
  readonly id: Resolvable<string>;
  readonly payload: unknown;
};

export type ArchiveMeterAction = {
  readonly _tag: "ArchiveMeter";
  readonly id: Resolvable<string>;
};

export type CreateProductAction = {
  readonly _tag: "CreateProduct";
  readonly payload: ProductCreateOperationPayload;
};

export type UpdateProductAction = {
  readonly _tag: "UpdateProduct";
  readonly id: Resolvable<string>;
  readonly payload: unknown;
};

export type ArchiveProductAction = {
  readonly _tag: "ArchiveProduct";
  readonly id: Resolvable<string>;
};

export type OperationAction =
  | CreateMeterAction
  | UpdateMeterAction
  | ArchiveMeterAction
  | CreateProductAction
  | UpdateProductAction
  | ArchiveProductAction;
