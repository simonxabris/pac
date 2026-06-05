import type { ResourceAddress } from "../core/address.js";
import type { ResourceKind } from "../core/kind.js";
import type { OperationAction } from "./actions.js";

export type RollbackAction =
  | {
    readonly _tag: "RollbackOperation";
    readonly action: OperationAction;
  }
  | {
    readonly _tag: "NoopRollback";
    readonly reason: string;
  }
  | {
    readonly _tag: "UnsupportedRollback";
    readonly reason: string;
  };

export type Operation = {
  readonly _tag: "Operation";
  readonly id: string;
  readonly address: ResourceAddress;
  readonly kind: ResourceKind;
  readonly action: OperationAction;
  readonly rollback: RollbackAction;
};
