import { Console } from "effect";
import * as Effect from "effect/Effect";
import * as Command from "effect/unstable/cli/Command";
import { OAuth, type PolarEnvironment } from "../services/oauth.js";
import { polarEnvFlag } from "./options.js";

export const whoamiCommand = Command.make("whoami", { env: polarEnvFlag }, ({ env }) =>
  Effect.gen(function*() {
    const server = env as PolarEnvironment;
    const oauth = yield* OAuth;
    const authenticated = yield* oauth.isAuthenticated(server);

    if (!authenticated) {
      yield* Console.log(`Not logged in to Polar ${server}`);
      return;
    }

    const token = yield* oauth.getAccessToken(server);
    const organization = yield* oauth.getSelectedOrganization(server);
    const user = token.user?.email ?? token.user?.name ?? token.user?.id ?? "unknown user";
    const selectedOrganization = organization
      ? `${organization.name} (${organization.slug})`
      : "none selected";

    yield* Console.log(`Environment: ${server}`);
    yield* Console.log(`User: ${user}`);
    yield* Console.log(`Selected organization: ${selectedOrganization}`);
  }),
).pipe(Command.withDescription("Show the current Polar login and selected organization"));
