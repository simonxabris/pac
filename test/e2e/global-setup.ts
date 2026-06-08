import { e2eOrganizationFromEnv } from "./helpers/env.js";

export default async function setup() {
  // E2E setup is intentionally minimal: callers provide the Polar API URL and
  // an organization access token. Tests run in that organization; setup does
  // not create or destroy any Polar resources outside the test cases.
  e2eOrganizationFromEnv();
}
