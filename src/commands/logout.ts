import { Console } from "effect";
import * as Effect from "effect/Effect";
import * as Command from "effect/unstable/cli/Command";
import { OAuth } from "../services/oauth.js";

export const logoutCommand = Command.make("logout", {}, () =>
  Effect.gen(function*() {
    const oauth = yield* OAuth;
    yield* oauth.logout();
    yield* Console.log("Successfully logged out of Polar");
  }),
).pipe(Command.withDescription("Log out of Polar"));
