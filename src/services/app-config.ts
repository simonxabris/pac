import { Option, Schema } from "effect";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

export type PolarEnvironment = "production" | "sandbox";

export type AppConfigShape = {
  readonly polarAccessToken?: Redacted.Redacted<string>;
  readonly polarEnv: PolarEnvironment;
  readonly polarServerUrl: string | undefined;
};

const config = {
  polarAccessToken: Config.redacted("POLAR_ACCESS_TOKEN").pipe(Config.option),
  polarEnv: Config.schema(
    Schema.Union([Schema.Literal("production"), Schema.Literal("sandbox")]),
    "POLAR_ENV",
  ).pipe(Config.option),
  polarServerUrl: Config.schema(Schema.String, "POLAR_SERVER_URL").pipe(Config.option),
};

export class AppConfig extends Context.Service<AppConfig, AppConfigShape>()("@pac/AppConfig") {
  static readonly layerWithCliEnv = (cliEnv?: PolarEnvironment) =>
    Layer.effect(
      AppConfig,
      Effect.gen(function* () {
        const values = yield* Config.all(config);
        return AppConfig.of({
          ...(Option.isSome(values.polarAccessToken)
            ? { polarAccessToken: values.polarAccessToken.value }
            : {}),
          polarEnv: Option.isSome(values.polarEnv)
            ? values.polarEnv.value
            : (cliEnv ?? "production"),
          polarServerUrl: Option.getOrUndefined(values.polarServerUrl),
        });
      }),
    );

  static readonly layer = AppConfig.layerWithCliEnv();

  static readonly testLayer = Layer.succeed(
    AppConfig,
    AppConfig.of({
      polarAccessToken: Redacted.make("test-polar-access-token"),
      polarEnv: "sandbox",
      polarServerUrl: "asd",
    }),
  );
}
