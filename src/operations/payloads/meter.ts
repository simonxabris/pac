import type { MeterCreate } from "@polar-sh/sdk/models/components/metercreate.js";
import type { MeterUpdate } from "@polar-sh/sdk/models/components/meterupdate.js";

export type MeterCreateOperationPayload = MeterCreate & {
  readonly metadata: { readonly paac: string };
};

export type MeterUpdateOperationPayload = MeterUpdate;

export type MeterArchiveOperationPayload = {
  readonly isArchived: true;
};
