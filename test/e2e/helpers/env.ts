export type PolarE2EOrganization = {
  readonly accessToken: string;
  readonly apiUrl: string;
  readonly env: NodeJS.ProcessEnv;
};

export const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const defaultPolarApiUrl = "http://localhost:8101";
const defaultPolarAccessToken = "polar_oat_E54PRw9xzMW1CNtSkaph9zIQCCD4nfcWxXf8R0bGVJQ";

export const polarApiUrlFromEnv = (): string =>
  process.env.PAAC_E2E_POLAR_API_URL ?? process.env.POLAR_API_URL ?? process.env.POLAR_SERVER_URL ?? defaultPolarApiUrl;

export const polarAccessTokenFromEnv = (): string =>
  process.env.PAAC_E2E_POLAR_ACCESS_TOKEN ?? process.env.POLAR_ACCESS_TOKEN ?? defaultPolarAccessToken;

export const e2eOrganizationFromEnv = (): PolarE2EOrganization => {
  const apiUrl = polarApiUrlFromEnv() || requireEnv("PAAC_E2E_POLAR_API_URL");
  const accessToken = polarAccessTokenFromEnv() || requireEnv("PAAC_E2E_POLAR_ACCESS_TOKEN");

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
