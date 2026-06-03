#!/usr/bin/env node

const main = async (): Promise<void> => {
  console.log("paac CLI scaffold is ready.");
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
