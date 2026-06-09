import { Console } from "effect";
import * as Effect from "effect/Effect";
import * as Command from "effect/unstable/cli/Command";
import { AppConfig } from "../services/app-config.js";
import { OAuth } from "../services/oauth.js";

const loginCommand = Command.make("login", {}, () =>
  Effect.gen(function*() {
    const config = yield* AppConfig;
    const server = config.polarEnv;
    const oauth = yield* OAuth;
    const token = yield* oauth.login(server);
    const organization = yield* oauth.selectOrganization(server);
    const user = token.user?.email ?? token.user?.name ?? token.user?.id ?? "unknown user";
    yield* Console.log(
      `Successfully logged into Polar ${server} as ${user} with organization ${organization.name} (${organization.slug})`,
    );
  }),
).pipe(Command.withDescription("Log in to Polar with OAuth"));

const logoutCommand = Command.make("logout", {}, () =>
  Effect.gen(function*() {
    const oauth = yield* OAuth;
    yield* oauth.logout();
    yield* Console.log("Successfully logged out of Polar");
  }),
).pipe(Command.withDescription("Log out of Polar"));

const whoamiCommand = Command.make("whoami", {}, () =>
  Effect.gen(function*() {
    const config = yield* AppConfig;
    const server = config.polarEnv;
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

const orgCommand = Command.make("org", {}, () =>
  Effect.gen(function*() {
    const config = yield* AppConfig;
    const server = config.polarEnv;
    const oauth = yield* OAuth;
    const authenticated = yield* oauth.isAuthenticated(server);

    if (!authenticated) {
      yield* Console.log(`Not logged in to Polar ${server}`);
      return;
    }

    const organization = yield* oauth.selectOrganization(server);

    yield* Console.log(
      `Selected Polar ${server} organization: ${organization.name} (${organization.slug})`,
    );
  }),
).pipe(Command.withDescription("Select the active Polar organization"));

export const authCommand = Command.make("auth").pipe(
  Command.withDescription("Manage Polar authentication"),
  Command.withSubcommands([loginCommand, logoutCommand, whoamiCommand, orgCommand]),
);
