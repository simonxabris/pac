import type { PlanAction } from "./diff.js";

const counts = (actions: ReadonlyArray<PlanAction>) => ({
  create: actions.filter((action) => action.type === "create").length,
  update: actions.filter((action) => action.type === "update").length,
  archive: actions.filter((action) => action.type === "archive").length,
  noop: actions.filter((action) => action.type === "no-op").length,
});

export const renderPlan = (
  project: string,
  actions: ReadonlyArray<PlanAction>,
  mode: "preview" | "deploy" = "preview",
): string => {
  const lines = [`PAAC plan for project ${project}`, ""];
  for (const action of actions) {
    if (action.type === "create") {
      const price = action.payload.prices[0];
      lines.push(`+ create ${action.address}`);
      lines.push(`  name: ${action.payload.name}`);
      lines.push(`  price: ${price.priceAmount} ${price.priceCurrency}`);
      lines.push(`  recurring: ${action.payload.recurringInterval ?? "one-time"}${action.payload.recurringIntervalCount === null ? "" : ` x ${action.payload.recurringIntervalCount}`}`);
    } else if (action.type === "update") {
      lines.push(`~ update ${action.address} (${action.remoteId})`);
      for (const change of action.changes) lines.push(`  ${change.field}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`);
    } else if (action.type === "archive") {
      lines.push(`- archive ${action.address} (${action.remoteId})`);
    } else {
      lines.push(`= no-op ${action.address} (${action.remoteId})`);
    }
    lines.push("");
  }
  const summary = counts(actions);
  lines.push(`Plan: ${summary.create} to create, ${summary.update} to update, ${summary.archive} to archive, ${summary.noop} unchanged.`);
  lines.push(mode === "preview" ? "No changes were applied." : "Ready to apply changes.");
  return lines.join("\n");
};
