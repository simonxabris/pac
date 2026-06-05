import type { ProductPriceCustomCreate } from "@polar-sh/sdk/models/components/productpricecustomcreate.js";
import type { ProductPriceFixedCreate } from "@polar-sh/sdk/models/components/productpricefixedcreate.js";
import type { ProductPriceFreeCreate } from "@polar-sh/sdk/models/components/productpricefreecreate.js";
import type { ProductPriceMeteredUnitCreate } from "@polar-sh/sdk/models/components/productpricemeteredunitcreate.js";
import type { Resolvable } from "../ref.js";

export type ProductPriceMeteredUnitCreatePayload = Omit<ProductPriceMeteredUnitCreate, "meterId"> & {
  readonly meterId: Resolvable<string>;
};

export type ProductPriceCreatePayload =
  | ProductPriceCustomCreate
  | ProductPriceFixedCreate
  | ProductPriceFreeCreate
  | ProductPriceMeteredUnitCreatePayload;

export type ProductCreateOperationPayload = {
  readonly metadata: { readonly paac: string };
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
