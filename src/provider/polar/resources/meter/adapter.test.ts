import type { Meter as RemoteMeter } from "@polar-sh/sdk/models/components/meter.js";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { encodePaacMetadata } from "../../../../core/metadata.js";
import type { DesiredResource } from "../../../../core/resource.js";
import type { PolarClientShape } from "../../../../polar/service.js";
import { makeMeterAdapter } from "./adapter.js";

const fakePolar: PolarClientShape = {
  listProducts: () => Effect.succeed([]),
  createProduct: () => Effect.void,
  updateProduct: () => Effect.void,
  archiveProduct: () => Effect.void,
  listMeters: () => Effect.succeed([]),
  createMeter: () => Effect.void,
  updateMeter: () => Effect.void,
  archiveMeter: () => Effect.void,
};

const adapter = makeMeterAdapter(fakePolar);

const meterIdentity = {
  version: 1 as const,
  kind: "meter",
  address: "meter.requests" as const,
  key: "requests",
};

const desiredMeter = (overrides: Partial<DesiredResource["config"]> = {}): DesiredResource => ({
  kind: "meter",
  key: "requests",
  address: "meter.requests",
  dependencies: [],
  config: {
    managed: {
      name: "Requests",
      unit: "custom",
      customLabel: "request",
      customMultiplier: 1,
      filter: {
        conjunction: "and",
        clauses: [{ property: "event", operator: "eq", value: "api.request" }],
      },
      aggregation: { func: "count" },
      isArchived: false,
    },
    ...overrides,
  },
});

const remoteMeter = (overrides: Partial<RemoteMeter> = {}): RemoteMeter =>
  ({
    id: "polar-meter-id",
    name: "Requests",
    unit: "custom",
    customLabel: "request",
    customMultiplier: 1,
    filter: {
      conjunction: "and",
      clauses: [{ property: "event", operator: "eq", value: "api.request" }],
    },
    aggregation: { func: "count" },
    metadata: encodePaacMetadata(meterIdentity),
    archivedAt: null,
    ...overrides,
  }) as RemoteMeter;

describe("Polar meter adapter", () => {
  it("normalizes desired meter config through Effect Schema", () => {
    const canonical = Effect.runSync(adapter.normalizeDesired(desiredMeter(), {}));

    expect(canonical).toMatchObject({
      kind: "meter",
      address: "meter.requests",
      managed: {
        name: "Requests",
        unit: "custom",
        customLabel: "request",
        customMultiplier: 1,
        isArchived: false,
      },
    });
  });

  it("normalizes remote meter archive state", () => {
    const canonical = Effect.runSync(
      adapter.normalizeRemote(
        remoteMeter({ archivedAt: new Date("2026-01-01T00:00:00.000Z") }),
        {},
      ),
    );

    expect(canonical).toMatchObject({
      providerId: "polar-meter-id",
      managed: {
        name: "Requests",
        isArchived: true,
      },
    });
  });

  it("reports malformed paac metadata instead of treating it as unmanaged", () => {
    expect(
      adapter.getRemoteIdentity(remoteMeter({ metadata: { paac: "not-json" } })),
    ).toMatchObject({
      _tag: "malformed",
      diagnostic: { severity: "error", code: "PAAC_MALFORMED_METADATA" },
    });
  });

  it("plans create payloads with PAAC metadata", () => {
    const canonical = Effect.runSync(adapter.normalizeDesired(desiredMeter(), {}));
    const operations = Effect.runSync(adapter.planCreate(canonical, {}));

    expect(operations).toMatchObject([
      {
        call: "meters.create",
        input: {
          name: "Requests",
          unit: "custom",
          metadata: encodePaacMetadata(meterIdentity),
        },
      },
    ]);
  });

  it("plans archive as a meter update", () => {
    const canonical = Effect.runSync(adapter.normalizeRemote(remoteMeter(), {}));
    const operations = Effect.runSync(adapter.planDelete(canonical, {}));

    expect(operations).toMatchObject([
      {
        call: "meters.update",
        input: { id: "polar-meter-id", meterUpdate: { isArchived: true } },
      },
    ]);
  });
});
