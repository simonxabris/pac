import type { ExistingProductPrice } from "@polar-sh/sdk/models/components/existingproductprice.js";
import type { ProductPriceCustomCreate } from "@polar-sh/sdk/models/components/productpricecustomcreate.js";
import type { ProductPriceFixedCreate } from "@polar-sh/sdk/models/components/productpricefixedcreate.js";
import type { ProductPriceFreeCreate } from "@polar-sh/sdk/models/components/productpricefreecreate.js";
import type { ProductPriceMeteredUnitCreate } from "@polar-sh/sdk/models/components/productpricemeteredunitcreate.js";
import type { ProductUpdate } from "@polar-sh/sdk/models/components/productupdate.js";
import { PAC_METADATA_KEY } from "../../core/metadata.js";
import type { Resolvable } from "../ref.js";

export type ProductPriceMeteredUnitCreatePayload = Omit<
  ProductPriceMeteredUnitCreate,
  "meterId"
> & {
  readonly meterId: Resolvable<string>;
};

export type ProductPriceCreatePayload =
  | ProductPriceCustomCreate
  | ProductPriceFixedCreate
  | ProductPriceFreeCreate
  | ProductPriceMeteredUnitCreatePayload;

export type ProductCreateOperationPayload = {
  readonly metadata: { readonly [PAC_METADATA_KEY]: string };
  readonly name: string;
  readonly description: string | null;
  readonly visibility: "draft" | "private" | "public";
  readonly prices: ReadonlyArray<ProductPriceCreatePayload>;
} & (
  | {
      readonly recurringInterval: "day" | "week" | "month" | "year";
      readonly recurringIntervalCount: number;
    }
  | {
      readonly recurringInterval: null;
      readonly recurringIntervalCount: null;
    }
);

export type ProductUpdatePricePayload = ExistingProductPrice | ProductPriceCreatePayload;

export type ProductUpdateOperationPayload = Omit<ProductUpdate, "prices"> & {
  prices?: ReadonlyArray<ProductUpdatePricePayload> | null | undefined;
};

export type ProductArchiveOperationPayload = {
  readonly isArchived: true;
};

export type ProductBenefitsUpdateOperationPayload = {
  readonly benefits: ReadonlyArray<Resolvable<string>>;
};
