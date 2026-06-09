import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { AsyncEntry } from "@napi-rs/keyring";
import type { TokenResponse } from "@polar-sh/sdk/models/components/tokenresponse.js";
import { Schema } from "effect";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

export type PolarEnvironment = "production" | "sandbox";

export type CamelToSnakeCase<S extends string> = S extends `${infer T}${infer U}`
  ? `${T extends Capitalize<T> ? "_" : ""}${Lowercase<T>}${CamelToSnakeCase<U>}`
  : S;

export type KeysToSnakeCase<T> = {
  [K in keyof T as CamelToSnakeCase<string & K>]: T[K];
};

export const TokenScope = Schema.Array(Schema.String);

export const Token = Schema.Struct({
  token: Schema.RedactedFromValue(Schema.String),
  refreshToken: Schema.optionalKey(Schema.RedactedFromValue(Schema.String)),
  expiresIn: Schema.Number,
  expiresAt: Schema.DateFromString,
  scope: TokenScope,
  server: Schema.Union([Schema.Literal("production"), Schema.Literal("sandbox")]),
});

export type Token = Schema.Schema.Type<typeof Token>;

export const Tokens = Schema.Struct({
  production: Schema.optionalKey(Token),
  sandbox: Schema.optionalKey(Token),
});
export type Tokens = Schema.Schema.Type<typeof Tokens>;

export type OAuthShape = {
  readonly login: (server: PolarEnvironment) => Effect.Effect<Token, OAuthError>;
  readonly logout: () => Effect.Effect<void, OAuthError>;
  readonly refresh: (token: Token) => Effect.Effect<Token, OAuthError>;
  readonly isAuthenticated: (server: PolarEnvironment) => Effect.Effect<boolean, OAuthError>;
  readonly getAccessToken: (server: PolarEnvironment) => Effect.Effect<Token, OAuthError>;
  readonly resolveAccessToken: (server: PolarEnvironment) => Effect.Effect<Token, OAuthError>;
};

export class OAuthError extends Schema.TaggedErrorClass<OAuthError>()("OAuthError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) { }

const SANDBOX_CLIENT_ID = "polar_ci_AHVAKf9SDOaffma2auRGMXR3H8jg9QBgOfW7s1hYgW9";
const PRODUCTION_CLIENT_ID = "polar_ci_gBnJ_Yv_uSGm5mtoPa2cCA";

const SANDBOX_AUTHORIZATION_URL = "https://sandbox.polar.sh/oauth2/authorize";
const PRODUCTION_AUTHORIZATION_URL = "https://polar.sh/oauth2/authorize";

const SANDBOX_TOKEN_URL = "https://sandbox-api.polar.sh/v1/oauth2/token";
const PRODUCTION_TOKEN_URL = "https://api.polar.sh/v1/oauth2/token";

const KEYRING_SERVICE = "paac.polar.oauth";

const config = {
  scopes: [
    "benefits:read",
    "benefits:write",
    "checkout_links:read",
    "checkout_links:write",
    "checkouts:read",
    "checkouts:write",
    "custom_fields:read",
    "custom_fields:write",
    "customer_meters:read",
    "customer_portal:read",
    "customer_portal:write",
    "customer_seats:read",
    "customer_seats:write",
    "customer_sessions:write",
    "customers:read",
    "customers:write",
    "discounts:read",
    "discounts:write",
    "disputes:read",
    "email",
    "events:read",
    "events:write",
    "files:read",
    "files:write",
    "license_keys:read",
    "license_keys:write",
    "member_sessions:write",
    "members:read",
    "members:write",
    "meters:read",
    "meters:write",
    "metrics:read",
    "metrics:write",
    "notification_recipients:read",
    "notification_recipients:write",
    "notifications:read",
    "notifications:write",
    "openid",
    "orders:read",
    "orders:write",
    "organization_access_tokens:read",
    "organization_access_tokens:write",
    "organizations:read",
    "organizations:write",
    "payments:read",
    "payouts:read",
    "payouts:write",
    "products:read",
    "products:write",
    "profile",
    "refunds:read",
    "refunds:write",
    "subscriptions:read",
    "subscriptions:write",
    "transactions:read",
    "transactions:write",
    "user:read",
    "user:write",
    "wallets:read",
    "wallets:write",
    "webhooks:read",
    "webhooks:write",
  ],
  redirectUrl: "http://127.0.0.1:3333/oauth/callback",
};

const keyringEntry = (server: PolarEnvironment) => new AsyncEntry(KEYRING_SERVICE, server);

const readToken = (server: PolarEnvironment): Effect.Effect<Token | undefined, OAuthError> =>
  Effect.gen(function*() {
    const raw = yield* Effect.tryPromise({
      try: () => keyringEntry(server).getPassword(),
      catch: (cause) => new OAuthError({ message: "Failed to read token from keyring", cause }),
    });

    if (!raw) return undefined;

    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) => new OAuthError({ message: "Failed to parse token from keyring", cause }),
    });

    return yield* Schema.decodeUnknownEffect(Token)(parsed).pipe(
      Effect.mapError(
        (cause) =>
          new OAuthError({
            message: "Failed to decode token from keyring",
            cause,
          }),
      ),
    );
  });

const readTokens: Effect.Effect<Tokens, OAuthError> = Effect.gen(function*() {
  const production = yield* readToken("production");
  const sandbox = yield* readToken("sandbox");
  return Tokens.make({
    ...(production ? { production } : {}),
    ...(sandbox ? { sandbox } : {}),
  });
});

const saveToken = (token: Token): Effect.Effect<Token, OAuthError> =>
  Effect.gen(function*() {
    const encoded = yield* Schema.encodeUnknownEffect(Token)(token).pipe(
      Effect.mapError(
        (cause) => new OAuthError({ message: "Failed to encode token", cause }),
      ),
    );

    yield* Effect.tryPromise({
      try: () => keyringEntry(token.server).setPassword(JSON.stringify(encoded)),
      catch: (cause) => new OAuthError({ message: "Failed to save token to keyring", cause }),
    });

    return token;
  });

const deleteToken = (server: PolarEnvironment): Effect.Effect<void, OAuthError> =>
  Effect.tryPromise({
    try: async () => {
      await keyringEntry(server).deleteCredential();
    },
    catch: (cause) => new OAuthError({ message: "Failed to delete token from keyring", cause }),
  }).pipe(Effect.catch(() => Effect.void));

const logout = (): Effect.Effect<void, OAuthError> =>
  Effect.all([deleteToken("production"), deleteToken("sandbox")], {
    concurrency: "unbounded",
  }).pipe(Effect.asVoid);

const getAccessToken = (server: PolarEnvironment): Effect.Effect<Token, OAuthError> =>
  Effect.gen(function*() {
    const tokens = yield* readTokens;
    const token = tokens[server];

    if (!token) {
      return yield* new OAuthError({
        message: "No access token found for the selected server",
        cause: undefined,
      });
    }

    return token;
  });

const login = (server: PolarEnvironment): Effect.Effect<Token, OAuthError> =>
  Effect.gen(function*() {
    const token = yield* captureAccessTokenFromHTTPServer(server);
    return yield* saveToken(token);
  });

const refresh = (token: Token): Effect.Effect<Token, OAuthError> =>
  Effect.gen(function*() {
    const refreshedToken = yield* refreshAccessToken(token);
    return yield* saveToken(refreshedToken);
  });

const isAuthenticated = (server: PolarEnvironment): Effect.Effect<boolean, OAuthError> =>
  Effect.gen(function*() {
    const token = yield* readToken(server);
    return token ? token.expiresAt > new Date() : false;
  });

const resolveAccessToken = (server: PolarEnvironment): Effect.Effect<Token, OAuthError> =>
  Effect.gen(function*() {
    const authenticated = yield* isAuthenticated(server);
    return yield* authenticated ? getAccessToken(server) : login(server);
  });

const captureAccessTokenFromHTTPServer = (
  server: PolarEnvironment,
): Effect.Effect<Token, OAuthError> =>
  Effect.gen(function*() {
    const codeVerifier = yield* generateRandomString;
    const codeChallenge = yield* generateHash(codeVerifier);
    const state = yield* generateRandomString;
    const authorizationUrl = buildAuthorizationUrl(server, state, codeChallenge);

    return yield* Effect.callback<Token, OAuthError>((resume, signal) => {
      let completed = false;
      let httpServer: Server | undefined;
      const sockets = new Set<Socket>();

      const closeServer = () => {
        if (!httpServer) return;
        const serverToClose = httpServer;
        httpServer = undefined;
        serverToClose.close();
        serverToClose.closeAllConnections();
        for (const socket of sockets) {
          socket.destroy();
        }
        sockets.clear();
      };

      httpServer = createServer((request, response) => {
        if (completed) return;
        completed = true;

        response.setHeader("Connection", "close");
        response.end("Login completed for the console client ...", () => {
          closeServer();
        });

        resume(redeemCodeForAccessToken(server, request.url ?? "", state, codeVerifier));
      });

      httpServer.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("close", () => {
          sockets.delete(socket);
        });
      });

      httpServer.on("error", (cause) => {
        if (completed) return;
        completed = true;
        closeServer();
        resume(
          Effect.fail(new OAuthError({ message: "Temporary HTTP server failed", cause })),
        );
      });

      signal.addEventListener("abort", closeServer, { once: true });

      httpServer.listen(3333, "127.0.0.1", () => {
        openBrowser(authorizationUrl);
      });
    });
  });

const generateRandomString = Effect.sync(() => randomBytes(48).toString("hex"));

const generateHash = (value: string) =>
  Effect.sync(() =>
    createHash("sha256")
      .update(value)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, ""),
  );

const getClientCredentials = (server: PolarEnvironment) =>
  server === "production" ? { clientId: PRODUCTION_CLIENT_ID } : { clientId: SANDBOX_CLIENT_ID };

const buildAuthorizationUrl = (
  server: PolarEnvironment,
  state: string,
  codeChallenge: string,
): string => {
  const baseUrl =
    server === "production" ? PRODUCTION_AUTHORIZATION_URL : SANDBOX_AUTHORIZATION_URL;
  const { clientId } = getClientCredentials(server);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: config.redirectUrl,
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    sub_type: "user",
  });

  return `${baseUrl}?${params.toString()}`;
};

const getLoginResult = (
  responseUrl: string,
): Effect.Effect<readonly [string, string], OAuthError> =>
  Effect.gen(function*() {
    const url = new URL(responseUrl, config.redirectUrl);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      return yield* new OAuthError({
        message: "Authorization code or state is missing in the response URL",
        cause: undefined,
      });
    }

    return [code, state] as const;
  });

const refreshAccessToken = (token: Token): Effect.Effect<Token, OAuthError> =>
  Effect.gen(function*() {
    const refreshToken = token.refreshToken;

    if (!refreshToken) {
      return yield* new OAuthError({ message: "No refresh token found", cause: undefined });
    }

    const { clientId } = getClientCredentials(token.server);
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: Redacted.value(refreshToken),
      scope: config.scopes.join(" "),
    });

    const data = yield* postTokenRequest(
      token.server === "production" ? PRODUCTION_TOKEN_URL : SANDBOX_TOKEN_URL,
      params,
      "refresh access token",
    );

    return yield* tokenFromTokenResponse(data, token.server);
  });

const redeemCodeForAccessToken = (
  server: PolarEnvironment,
  responseUrl: string,
  requestState: string,
  codeVerifier: string,
): Effect.Effect<Token, OAuthError> =>
  Effect.gen(function*() {
    const [code, responseState] = yield* getLoginResult(responseUrl);

    if (responseState !== requestState) {
      return yield* new OAuthError({
        message: "An invalid authorization response state was received",
        cause: undefined,
      });
    }

    const { clientId } = getClientCredentials(server);
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: config.redirectUrl,
      code,
      code_verifier: codeVerifier,
    });

    const data = yield* postTokenRequest(
      server === "production" ? PRODUCTION_TOKEN_URL : SANDBOX_TOKEN_URL,
      params,
      "redeem code for access token",
    );

    return yield* tokenFromTokenResponse(data, server);
  });

const postTokenRequest = (
  url: string,
  params: URLSearchParams,
  operation: string,
): Effect.Effect<KeysToSnakeCase<TokenResponse>, OAuthError> =>
  Effect.gen(function*() {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        }),
      catch: (cause) => new OAuthError({ message: `Failed to ${operation}`, cause }),
    });

    if (response.status >= 400) {
      const details = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) => new OAuthError({ message: "Failed to read token response", cause }),
      });

      return yield* new OAuthError({
        message: `Problem encountered while trying to ${operation}`,
        cause: { status: response.status, details },
      });
    }

    return yield* Effect.tryPromise({
      try: () => response.json() as Promise<KeysToSnakeCase<TokenResponse>>,
      catch: (cause) => new OAuthError({ message: "Failed to parse token response", cause }),
    });
  });

const tokenFromTokenResponse = (
  data: KeysToSnakeCase<TokenResponse>,
  server: PolarEnvironment,
): Effect.Effect<Token, OAuthError> =>
  Schema.decodeUnknownEffect(Token)({
    token: data.access_token,
    refreshToken: data.refresh_token ?? undefined,
    expiresIn: data.expires_in,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    scope: data.scope.split(" "),
    server,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new OAuthError({
          message: "Failed to parse token response into a Token schema",
          cause,
        }),
    ),
  );

const openBrowser = (url: string): void => {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
};

export class OAuth extends Context.Service<OAuth, OAuthShape>()("@paac/OAuth") {
  static readonly layer = Layer.succeed(
    OAuth,
    OAuth.of({
      login,
      logout,
      refresh,
      isAuthenticated,
      getAccessToken,
      resolveAccessToken,
    }),
  );
}
