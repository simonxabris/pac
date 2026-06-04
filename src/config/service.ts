import { Config, Effect, Layer, Redacted, Schema } from "effect";
import * as Context from "effect/Context";

export type AppConfigShape = {
  readonly polarAccessToken: Redacted.Redacted<string>;
  readonly polarEnv: "production" | "sandbox";
};

const config = {
  polarAccessToken: Config.redacted("POLAR_ACCESS_TOKEN"),
  polarEnv: Config.schema(
    Schema.Union([Schema.Literal("production"), Schema.Literal("sandbox")]),
    "POLAR_ENV",
  ),
};

export class AppConfig extends Context.Service<AppConfig, AppConfigShape>()("@paac/AppConfig") {
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function*() {
      const values = yield* Config.all(config);
      return AppConfig.of(values);
    }),
  );

  static readonly testLayer = Layer.succeed(
    AppConfig,
    AppConfig.of({
      polarAccessToken: Redacted.make("test-polar-access-token"),
      polarEnv: "sandbox",
    }),
  );
}
