import { Polar } from "@polar-sh/sdk";
import type { Meter as RemoteMeter } from "@polar-sh/sdk/models/components/meter.js";
import type { Product as RemoteProduct } from "@polar-sh/sdk/models/components/product.js";
import type { PolarE2EOrganization } from "./env.js";

type RemoteWithMetadata = {
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export const pacMetadata = (kind: "product" | "meter", key: string): string =>
  JSON.stringify({
    v: 1,
    kind,
    addr: `${kind}.${key}`,
    key,
  });

const hasPacAddress = (
  resource: RemoteWithMetadata,
  kind: "product" | "meter",
  key: string,
): boolean => resource.metadata?.pac === pacMetadata(kind, key);

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

export const listMeters = async (org: PolarE2EOrganization): Promise<Array<RemoteMeter>> => {
  const iterator = await polarSdk(org).meters.list({ limit: 100 });
  const meters: Array<RemoteMeter> = [];
  for await (const page of iterator) {
    meters.push(...page.result.items);
  }
  return meters;
};

export const getProductById = async (
  org: PolarE2EOrganization,
  id: string,
): Promise<RemoteProduct> => polarSdk(org).products.get({ id });

export const getMeterById = async (org: PolarE2EOrganization, id: string): Promise<RemoteMeter> =>
  polarSdk(org).meters.get({ id });

export const findProductsByKey = async (
  org: PolarE2EOrganization,
  key: string,
): Promise<Array<RemoteProduct>> => {
  const products = await listProducts(org);
  return products.filter((product) => hasPacAddress(product, "product", key));
};

export const findMetersByKey = async (
  org: PolarE2EOrganization,
  key: string,
): Promise<Array<RemoteMeter>> => {
  const meters = await listMeters(org);
  return meters.filter((meter) => hasPacAddress(meter, "meter", key));
};

export const findProductByKey = async (
  org: PolarE2EOrganization,
  key: string,
): Promise<RemoteProduct | undefined> => (await findProductsByKey(org, key))[0];

export const findMeterByKey = async (
  org: PolarE2EOrganization,
  key: string,
): Promise<RemoteMeter | undefined> => (await findMetersByKey(org, key))[0];
