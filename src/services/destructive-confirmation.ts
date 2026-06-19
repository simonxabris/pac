import { Console, Effect, Layer } from "effect";
import * as Context from "effect/Context";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Prompt from "effect/unstable/cli/Prompt";
import * as Terminal from "effect/Terminal";
import kleur from "kleur";
import { OperationDestructiveness, type Operation } from "../operations/operation.js";

/**
 * Confirms destructive operations with the user before the executor applies
 * them.
 *
 * **Why a service**
 *
 * The live implementation renders a list and runs an interactive
 * {@link Prompt.confirm}, which requires the Prompt terminal environment
 * (`Terminal` / `FileSystem` / `Path`). Keeping that behind a service lets the
 * executor stay pure and lets tests provide a synchronous fake
 * (`Effect.succeed(false)`) instead of a real terminal.
 *
 * The service contract is `Effect<boolean>` (no environment requirement): the
 * live layer absorbs the Prompt environment internally so callers — including
 * tests — never need to provide it.
 */
export class DestructiveConfirmation extends Context.Service<
  DestructiveConfirmation,
  {
    readonly confirm: (operations: ReadonlyArray<Operation>) => Effect.Effect<boolean>;
  }
>()("@app/DestructiveConfirmation") {}

/** Implementation shape for {@link DestructiveConfirmation}. */
export type DestructiveConfirmationShape = Context.Service.Shape<typeof DestructiveConfirmation>;

const DESTRUCTIVE_ACTION_LABEL: Partial<Record<Operation["action"]["_tag"], string>> = {
  ArchiveMeter: "Archive meter",
  ArchiveProduct: "Archive product",
  DeleteBenefit: "Delete benefit",
};

const resourceKey = (address: Operation["address"]): string =>
  address.slice(address.indexOf(".") + 1);

const renderDestructiveOperation = (operation: Operation): string => {
  const { destructiveness } = operation;
  const reason = OperationDestructiveness.guards.Destructive(destructiveness)
    ? destructiveness.reason
    : "";
  const label = DESTRUCTIVE_ACTION_LABEL[operation.action._tag] ?? operation.action._tag;
  const key = resourceKey(operation.address);
  return kleur.yellow(`  ! ${label} \`${key}\`${reason === "" ? "" : `: ${reason}`}`);
};

/**
 * Live `DestructiveConfirmation` that renders the destructive operations as a
 * list and asks a single yes/no prompt.
 *
 * Requires the Prompt environment (`FileSystem` / `Path` / `Terminal`) and
 * absorbs it so the resulting service has no remaining requirements.
 */
export const DestructiveConfirmationLive = Layer.effect(
  DestructiveConfirmation,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const terminal = yield* Terminal.Terminal;

    const promptEnvironment = Layer.mergeAll(
      Layer.succeed(FileSystem.FileSystem, fileSystem),
      Layer.succeed(Path.Path, path),
      Layer.succeed(Terminal.Terminal, terminal),
    );

    return DestructiveConfirmation.of({
      confirm: (operations) =>
        Effect.gen(function* () {
          yield* Console.log("");
          yield* Console.log(kleur.bold().yellow(`Destructive operations (${operations.length}):`));
          for (const operation of operations) {
            yield* Console.log(renderDestructiveOperation(operation));
          }
          yield* Console.log("");

          return yield* Prompt.run(
            Prompt.confirm({
              message: `Apply these ${operations.length} destructive operation(s)?`,
              initial: false,
            }),
          ).pipe(
            Effect.provide(promptEnvironment),
            Effect.match({
              onFailure: () => false,
              onSuccess: (confirmed) => confirmed,
            }),
          );
        }),
    });
  }),
);
