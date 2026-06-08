import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type PolarE2EOrganization = {
  readonly accessToken: string;
  readonly apiUrl: string;
  readonly env: NodeJS.ProcessEnv;
};

type PersistedE2EOrganization = {
  readonly accessToken: string;
  readonly apiUrl: string;
};

const currentOrgPath = resolve(process.cwd(), ".polar-e2e/current-org.json");
const defaultPolarApiUrl = "http://localhost:8101";

export const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const readPersistedE2EOrganization = (): PersistedE2EOrganization | undefined => {
  if (!existsSync(currentOrgPath)) return undefined;
  return JSON.parse(readFileSync(currentOrgPath, "utf8")) as PersistedE2EOrganization;
};

export const e2eOrganizationFromEnv = (): PolarE2EOrganization => {
  const persisted = readPersistedE2EOrganization();
  const apiUrl =
    process.env.PAAC_E2E_POLAR_API_URL ??
    process.env.POLAR_API_URL ??
    process.env.POLAR_SERVER_URL ??
    persisted?.apiUrl ??
    defaultPolarApiUrl;
  const accessToken =
    process.env.PAAC_E2E_POLAR_ACCESS_TOKEN ??
    process.env.POLAR_ACCESS_TOKEN ??
    persisted?.accessToken;

  if (accessToken === undefined || accessToken === "") {
    throw new Error(
      `Missing E2E Polar access token. Run the Vitest global setup or set PAAC_E2E_POLAR_ACCESS_TOKEN.`,
    );
  }

  return {
    apiUrl,
    accessToken,
    env: {
      ...process.env,
      POLAR_ENV: process.env.POLAR_ENV ?? "sandbox",
      POLAR_SERVER_URL: apiUrl,
      POLAR_ACCESS_TOKEN: accessToken,
    },
  };
};
