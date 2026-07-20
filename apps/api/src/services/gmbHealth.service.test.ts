import { describe, expect, it } from "vitest";
import { summarizeGmbHealth } from "./gmbHealth.service";

describe("summarizeGmbHealth", () => {
  it("is ok only when every probe passed", () => {
    expect(summarizeGmbHealth([
      { table: "A", ok: true },
      { table: "B", ok: true },
    ])).toEqual({ ok: true, healthy: 2, total: 2 });
  });

  it("is not ok when any probe failed, and counts the healthy ones", () => {
    expect(summarizeGmbHealth([
      { table: "A", ok: true },
      { table: "B", ok: false, error: "relation does not exist" },
      { table: "C", ok: true },
    ])).toEqual({ ok: false, healthy: 2, total: 3 });
  });

  it("is not ok for an empty probe list (nothing verified)", () => {
    expect(summarizeGmbHealth([])).toEqual({ ok: false, healthy: 0, total: 0 });
  });
});
