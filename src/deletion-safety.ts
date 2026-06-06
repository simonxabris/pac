import { Effect, Schema } from "effect";
import type { Plan } from "./planner.js";

export class DeleteModeRemovalNotAllowed extends Schema.TaggedErrorClass<DeleteModeRemovalNotAllowed>()(
  "DeleteModeRemovalNotAllowed",
  {
    addresses: Schema.Array(Schema.String),
    message: Schema.String,
  },
) { }

export const assertDeleteModeRemovalsAllowed = (
  plan: Plan,
  allowDelete: boolean,
): Effect.Effect<void, DeleteModeRemovalNotAllowed> => {
  const deleteAddresses = [...plan.nodes.values()]
    .filter((node) => node._tag === "Remove" && node.mode === "delete")
    .map((node) => node.address);

  if (allowDelete || deleteAddresses.length === 0) {
    return Effect.void;
  }

  return Effect.fail(
    new DeleteModeRemovalNotAllowed({
      addresses: deleteAddresses,
      message: `Deploy contains delete-mode removals (${deleteAddresses.join(", ")}). Re-run with --allow-delete to confirm destructive deletion.`,
    }),
  );
};
