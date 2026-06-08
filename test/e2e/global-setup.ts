import { spawn } from "node:child_process";
import { resolve } from "node:path";

const bootstrapE2EOrganization = async (): Promise<void> =>
  new Promise((resolveBootstrap, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", resolve(process.cwd(), "scripts/polar-docker-bootstrap-e2e.ts")],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
      },
    );

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveBootstrap();
        return;
      }

      reject(new Error(`E2E Polar bootstrap failed with code ${code ?? "null"} signal ${signal ?? "null"}`));
    });
  });

export default async function setup() {
  await bootstrapE2EOrganization();
}
