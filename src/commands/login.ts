import { Console } from "effect";
import * as Effect from "effect/Effect";
import * as Command from "effect/unstable/cli/Command";
import { OAuth, type PolarEnvironment } from "../services/oauth.js";
import { polarEnvFlag } from "./options.js";

export const loginCommand = Command.make("login", { env: polarEnvFlag }, ({ env }) =>
  Effect.gen(function*() {
    const oauth = yield* OAuth;
    yield* oauth.login(env as PolarEnvironment);
    yield* Console.log(`Successfully logged into Polar ${env}`);
  }),
).pipe(Command.withDescription("Log in to Polar with OAuth"));
