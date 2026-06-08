import type { MeterCreate } from "@polar-sh/sdk/models/components/metercreate.js";
import type { MeterUpdate } from "@polar-sh/sdk/models/components/meterupdate.js";
import { PAAC_METADATA_KEY } from "../../core/metadata.js";

export type MeterCreateOperationPayload = MeterCreate & {
  readonly metadata: { readonly [PAAC_METADATA_KEY]: string };
};

export type MeterUpdateOperationPayload = MeterUpdate;

export type MeterArchiveOperationPayload = {
  readonly isArchived: true;
};
