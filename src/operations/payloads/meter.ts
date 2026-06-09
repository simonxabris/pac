import type { MeterCreate } from "@polar-sh/sdk/models/components/metercreate.js";
import type { MeterUpdate } from "@polar-sh/sdk/models/components/meterupdate.js";
import { PAC_METADATA_KEY } from "../../core/metadata.js";

export type MeterCreateOperationPayload = MeterCreate & {
  readonly metadata: { readonly [PAC_METADATA_KEY]: string };
};

export type MeterUpdateOperationPayload = MeterUpdate;

export type MeterArchiveOperationPayload = {
  readonly isArchived: true;
};
