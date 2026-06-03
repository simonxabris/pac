import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type { RemoteProduct } from "./client.js";

export type PolarClientShape = {
  readonly listProducts: () => Effect.Effect<ReadonlyArray<RemoteProduct>, Error>;
};

const parseListResponse = (parsed: unknown): ReadonlyArray<RemoteProduct> => {
  if (Array.isArray(parsed)) return parsed as ReadonlyArray<RemoteProduct>;
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { items?: unknown }).items)
  ) {
    return (parsed as { items: ReadonlyArray<RemoteProduct> }).items;
  }
  return [];
};

export class PolarClient extends Context.Service<PolarClient, PolarClientShape>()("@paac/PolarClient") {
  static readonly httpLayer = (apiUrl: string, token: string) =>
    Layer.effect(
      PolarClient,
      Effect.gen(function*() {
        const http = yield* HttpClient.HttpClient;

        const listProducts = Effect.fn("PolarClient.listProducts")(function*() {
          const request = HttpClientRequest.get(new URL("/v1/products", apiUrl).toString()).pipe(
            HttpClientRequest.setHeader("Authorization", `Bearer ${token}`),
          );
          const response = yield* http.execute(request);
          const json = yield* response.json;
          return parseListResponse(json);
        });

        return PolarClient.of({
          listProducts: () =>
            listProducts().pipe(
              Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
            ),
        });
      }),
    );
}
