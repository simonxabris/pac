import { Polar } from "@polar-sh/sdk";
import type { Product as RemoteProduct } from "@polar-sh/sdk/models/components/product.js";
import type { PolarE2EOrganization } from "./env.js";

type RemoteWithMetadata = {
  readonly metadata?: Readonly<Record<string, unknown>>;
};

const paacMetadata = (kind: "product" | "meter", key: string): string =>
  JSON.stringify({
    v: 1,
    kind,
    addr: `${kind}.${key}`,
    key,
  });

const hasPaacAddress = (
  resource: RemoteWithMetadata,
  kind: "product" | "meter",
  key: string,
): boolean => resource.metadata?.paac === paacMetadata(kind, key);

export const polarSdk = (org: PolarE2EOrganization): Polar =>
  new Polar({
    accessToken: org.accessToken,
    server: "sandbox",
    serverURL: org.apiUrl,
  });

export const listProducts = async (org: PolarE2EOrganization): Promise<Array<RemoteProduct>> => {
  const iterator = await polarSdk(org).products.list({ limit: 100 });
  const products: Array<RemoteProduct> = [];
  for await (const page of iterator) {
    products.push(...page.result.items);
  }
  return products;
};

export const findProductByKey = async (
  org: PolarE2EOrganization,
  key: string,
): Promise<RemoteProduct | undefined> => {
  const products = await listProducts(org);
  return products.find((product) => hasPaacAddress(product, "product", key));
};
