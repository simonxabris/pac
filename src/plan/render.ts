import type { PlanAction } from "./diff.js";

const counts = (actions: ReadonlyArray<PlanAction>) => ({
  create: actions.filter((action) => action.type === "create").length,
  update: actions.filter((action) => action.type === "update").length,
  archive: actions.filter((action) => action.type === "archive").length,
  noop: actions.filter((action) => action.type === "no-op").length,
});

export const renderPlan = (project: string, actions: ReadonlyArray<PlanAction>): string => {
  const lines = [`PAAC plan for project ${project}`, ""];
  for (const action of actions) {
    if (action.type === "create") {
      const price = action.payload.prices[0];
      lines.push(`+ create ${action.address}`);
      lines.push(`  name: ${action.payload.name}`);
      lines.push(`  price: ${price.price_amount} ${price.price_currency}`);
      lines.push(`  recurring: ${action.payload.recurring_interval ?? "one-time"}${action.payload.recurring_interval_count === null ? "" : ` x ${action.payload.recurring_interval_count}`}`);
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
  lines.push("No changes were applied.");
  return lines.join("\n");
};
