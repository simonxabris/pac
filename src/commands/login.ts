import { Console } from "effect";
import * as Effect from "effect/Effect";
import * as Command from "effect/unstable/cli/Command";
import { OAuth, type PolarEnvironment } from "../services/oauth.js";
import { polarEnvFlag } from "./options.js";

export const loginCommand = Command.make("login", { env: polarEnvFlag }, ({ env }) =>
  Effect.gen(function*() {
    const server = env as PolarEnvironment;
    const oauth = yield* OAuth;
    const token = yield* oauth.login(server);
    const organization = yield* oauth.selectOrganization(server);
    const user = token.user?.email ?? token.user?.name ?? token.user?.id ?? "unknown user";
    yield* Console.log(
      `Successfully logged into Polar ${env} as ${user} with organization ${organization.name} (${organization.slug})`,
    );
  }),
).pipe(Command.withDescription("Log in to Polar with OAuth"));
