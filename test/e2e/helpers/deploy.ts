import { spawn } from "node:child_process";
import { resolve } from "node:path";

export const deployConfig = async (
  configPath: string,
  env: NodeJS.ProcessEnv,
): Promise<void> =>
  new Promise((resolveDeploy, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(process.cwd(), "dist/cli.js"), "deploy", "--config", resolve(process.cwd(), configPath)],
      {
        cwd: process.cwd(),
        env,
        stdio: "pipe",
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveDeploy();
        return;
      }

      reject(
        new Error(
          `paac deploy failed with code ${code ?? "null"} signal ${signal ?? "null"}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`,
        ),
      );
    });
  });
