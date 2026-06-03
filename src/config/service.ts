import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

export type AppConfigShape = {
  readonly polarAccessToken: Redacted.Redacted<string>;
};

const config = {
  polarAccessToken: Config.redacted("POLAR_ACCESS_TOKEN"),
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
    }),
  );
}
