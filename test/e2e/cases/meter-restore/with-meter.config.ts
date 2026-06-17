import { Meter, and, count, eventName } from "@simonxabris/pac";

export const requests = new Meter("restore-archived-meter", {
  name: "E2E Restore Archived Meter",
  unit: "scalar",
  filter: and(eventName("eq", "restore_archived_meter")),
  aggregation: count(),
});
