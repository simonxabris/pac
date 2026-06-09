import { Equal } from "effect";
import type { ResourceKind } from "../core/kind.js";
import { PAC_METADATA_KEY } from "../core/metadata.js";
import type { RollbackAction } from "../operations/operation.js";
import type { OperationRef } from "../operations/ref.js";
import type { FieldChange } from "../services/planner.js";

export const valuesEqual = (left: unknown, right: unknown): boolean => Equal.equals(left, right);

export const fieldChange = (
  path: ReadonlyArray<string | number>,
  before: unknown,
  after: unknown,
): FieldChange | undefined =>
  valuesEqual(before, after)
    ? undefined
    : {
        _tag: "FieldChange",
        path,
        before,
        after,
      };

export const pushFieldChange = (
  changes: Array<FieldChange>,
  path: ReadonlyArray<string | number>,
  before: unknown,
  after: unknown,
): void => {
  const change = fieldChange(path, before, after);
  if (change !== undefined) {
    changes.push(change);
  }
};

export const polarIdRef = (address: OperationRef["address"]): OperationRef => ({
  _tag: "Ref",
  address,
  field: "polarId",
});

export const unsupportedRollback = (reason: string): RollbackAction => ({
  _tag: "UnsupportedRollback",
  reason,
});

export const managedMetadata = (
  kind: ResourceKind,
  address: OperationRef["address"],
  key: string,
) => ({
  [PAC_METADATA_KEY]: JSON.stringify({
    v: 1,
    kind,
    addr: address,
    key,
  }),
});
