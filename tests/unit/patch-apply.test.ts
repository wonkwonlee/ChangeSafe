import { describe, expect, it } from "vitest";

import { DomainError } from "@/lib/domain/errors";
import { affectedDeviceIds, applyOperations } from "@/lib/patch/apply";
import { looksExecutable, parsePatchPath } from "@/lib/patch/paths";
import { canonicalize } from "@/lib/receipt/canonical";
import { buildIncidentBundle, buildOperation } from "@/tests/helpers/fixtures";

const state = () => buildIncidentBundle().currentState;

function expectDomainError(fn: () => unknown, code: DomainError["code"]) {
  try {
    fn();
    expect.fail("expected a DomainError");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}

describe("parsePatchPath allowlist", () => {
  it("accepts exactly the four allowlisted families", () => {
    expect(parsePatchPath("/devices/edge-rtr-01/interfaces/mgmt0/enabled")?.family).toBe(
      "interface-enabled",
    );
    expect(parsePatchPath("/devices/edge-rtr-01/routes/rt-mgmt")?.family).toBe("route");
    expect(parsePatchPath("/devices/edge-rtr-01/routes/rt-mgmt/metric")?.family).toBe(
      "route-metric",
    );
    expect(
      parsePatchPath("/devices/edge-rtr-01/routing/preferences/active-uplink")?.family,
    ).toBe("routing-preference");
  });

  it("rejects everything else", () => {
    for (const path of [
      "/",
      "/devices",
      "/devices/edge-rtr-01",
      "/devices/edge-rtr-01/name",
      "/devices/edge-rtr-01/routes",
      "/devices/edge-rtr-01/routes/rt-mgmt/destination",
      "/devices/edge-rtr-01/interfaces/mgmt0/status",
      "/management/originNodeId",
      "/devices/edge-rtr-01//routes/rt-mgmt",
      "/devices/__proto__/routes/rt-mgmt",
      "/devices/EDGE/routes/rt-mgmt",
      "devices/edge-rtr-01/routes/rt-mgmt",
    ]) {
      expect(parsePatchPath(path), path).toBeNull();
    }
  });
});

describe("looksExecutable", () => {
  it("flags shell metacharacters and CLI verbs", () => {
    for (const text of ["a;b", "x && y", "conf t", "ip route 0.0.0.0", "curl http://x", "rm -rf /"]) {
      expect(looksExecutable(text), text).toBe(true);
    }
  });

  it("passes plain identifiers", () => {
    for (const text of ["wan-backup", "prefer-backup-uplink", "edge-rtr-01"]) {
      expect(looksExecutable(text), text).toBe(false);
    }
  });
});

describe("applyOperations", () => {
  it("replaces a route metric and reports the diff", () => {
    const { nextState, diff } = applyOperations(state(), [buildOperation()]);
    expect(nextState.devices["edge-rtr-01"]?.routes["rt-default-backup"]?.metric).toBe(5);
    expect(diff).toEqual([
      {
        op: "replace",
        path: "/devices/edge-rtr-01/routes/rt-default-backup/metric",
        before: 200,
        after: 5,
      },
    ]);
  });

  it("adds and removes routes, capturing full prior values on remove", () => {
    const removal = buildOperation({
      op: "remove",
      path: "/devices/edge-rtr-01/routes/rt-default-backup",
      value: null,
    });
    const { nextState, diff } = applyOperations(state(), [removal]);
    expect(nextState.devices["edge-rtr-01"]?.routes["rt-default-backup"]).toBeUndefined();
    const entry = diff[0];
    expect(entry?.before).toMatchObject({ id: "rt-default-backup", metric: 200 });
    expect(entry?.after).toBeNull();
  });

  it("toggles interface enabled and sets routing preferences", () => {
    const { nextState } = applyOperations(state(), [
      buildOperation({
        op: "replace",
        path: "/devices/edge-rtr-01/interfaces/wan-primary/enabled",
        value: false,
      }),
      buildOperation({
        op: "replace",
        path: "/devices/edge-rtr-01/routing/preferences/active-uplink",
        value: "wan-backup",
      }),
    ]);
    const device = nextState.devices["edge-rtr-01"];
    expect(device?.interfaces["wan-primary"]?.enabled).toBe(false);
    expect(device?.routing.preferences["active-uplink"]).toBe("wan-backup");
  });

  it("never mutates the input state, even on success", () => {
    const original = state();
    const fingerprint = canonicalize(original);
    applyOperations(original, [buildOperation()]);
    expect(canonicalize(original)).toBe(fingerprint);
  });

  it("aborts transactionally: a failing op leaves the input untouched", () => {
    const original = state();
    const fingerprint = canonicalize(original);
    expect(() =>
      applyOperations(original, [
        buildOperation(), // valid
        buildOperation({ path: "/devices/edge-rtr-01/routes/rt-ghost/metric" }), // missing target
      ]),
    ).toThrow(DomainError);
    expect(canonicalize(original)).toBe(fingerprint);
  });

  it("rejects forbidden paths with PATCH_PATH_FORBIDDEN", () => {
    expectDomainError(
      () => applyOperations(state(), [buildOperation({ path: "/devices/edge-rtr-01/name" })]),
      "PATCH_PATH_FORBIDDEN",
    );
    expectDomainError(
      () =>
        applyOperations(state(), [
          buildOperation({ op: "remove", path: "/devices/edge-rtr-01/routes/rt-mgmt/metric", value: null }),
        ]),
      "PATCH_PATH_FORBIDDEN",
    );
  });

  it("rejects missing targets and unknown devices", () => {
    expectDomainError(
      () => applyOperations(state(), [buildOperation({ path: "/devices/ghost-rtr/routes/rt-x/metric" })]),
      "PATCH_TARGET_MISSING",
    );
    expectDomainError(
      () => applyOperations(state(), [buildOperation({ path: "/devices/edge-rtr-01/routes/rt-ghost/metric" })]),
      "PATCH_TARGET_MISSING",
    );
  });

  it("rejects adding a route that already exists", () => {
    expectDomainError(
      () =>
        applyOperations(state(), [
          buildOperation({
            op: "add",
            path: "/devices/edge-rtr-01/routes/rt-mgmt",
            value: {
              id: "rt-mgmt",
              destination: "192.0.2.0/24",
              nextHop: "direct",
              metric: 0,
              kind: "connected",
              protected: true,
              description: null,
            },
          }),
        ]),
      "PATCH_CONFLICT",
    );
  });

  it("rejects wrong value shapes", () => {
    expectDomainError(
      () =>
        applyOperations(state(), [
          buildOperation({ path: "/devices/edge-rtr-01/interfaces/mgmt0/enabled", value: "yes" }),
        ]),
      "PATCH_VALUE_INVALID",
    );
    expectDomainError(
      () => applyOperations(state(), [buildOperation({ value: 3.5 })]),
      "PATCH_VALUE_INVALID",
    );
    expectDomainError(
      () =>
        applyOperations(state(), [
          buildOperation({
            op: "remove",
            path: "/devices/edge-rtr-01/routes/rt-default-backup",
            value: 42,
          }),
        ]),
      "PATCH_VALUE_INVALID",
    );
  });

  it("rejects executable strings in preference values", () => {
    expectDomainError(
      () =>
        applyOperations(state(), [
          buildOperation({
            op: "replace",
            path: "/devices/edge-rtr-01/routing/preferences/active-uplink",
            value: "wan-backup; rm -rf /",
          }),
        ]),
      "PATCH_VALUE_INVALID",
    );
  });

  it("rejects a route add whose embedded id mismatches the path", () => {
    expectDomainError(
      () =>
        applyOperations(state(), [
          buildOperation({
            op: "add",
            path: "/devices/edge-rtr-01/routes/rt-new",
            value: {
              id: "rt-other",
              destination: "198.51.100.0/24",
              nextHop: "203.0.113.1",
              metric: 10,
              kind: "static",
              protected: false,
              description: null,
            },
          }),
        ]),
      "PATCH_VALUE_INVALID",
    );
  });
});

describe("affectedDeviceIds", () => {
  it("counts distinct devices from parseable paths", () => {
    const ids = affectedDeviceIds([
      buildOperation(),
      buildOperation({ path: "/devices/edge-rtr-01/interfaces/mgmt0/enabled", value: true }),
      buildOperation({ path: "/devices/mgmt-01/interfaces/eth0/enabled", value: true }),
      buildOperation({ path: "/not/a/valid/path" }),
    ]);
    expect(ids).toEqual(["edge-rtr-01", "mgmt-01"]);
  });
});
