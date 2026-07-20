// Grid rank tracker — pure geometry, stats, and business-matching logic.

import { describe, it, expect } from "vitest";
import {
  buildBattleMap,
  buildGrid,
  buildLocalLeaderboard,
  computeGridStats,
  matchesBusiness,
} from "./gmbGridRank.service";

describe("buildGrid", () => {
  it("produces an N×N lattice centered on the location", () => {
    const grid = buildGrid(12.97, 77.64, 5, 2);
    expect(grid).toHaveLength(25);
    // Center point is the location itself.
    const center = grid[12];
    expect(center.lat).toBeCloseTo(12.97, 6);
    expect(center.lng).toBeCloseTo(77.64, 6);
    // Corners are offset in both axes.
    expect(grid[0].lat).toBeLessThan(12.97);
    expect(grid[0].lng).toBeLessThan(77.64);
    expect(grid[24].lat).toBeGreaterThan(12.97);
    expect(grid[24].lng).toBeGreaterThan(77.64);
  });

  it("spans roughly the requested radius", () => {
    const grid = buildGrid(12.97, 77.64, 5, 2);
    // Edge row is ~2km from center: 2km latitude ≈ 0.0181°.
    const latSpan = Math.abs(grid[0].lat - 12.97);
    expect(latSpan).toBeGreaterThan(0.015);
    expect(latSpan).toBeLessThan(0.022);
  });
});

describe("computeGridStats", () => {
  it("computes avg rank, top-3 share and found share", () => {
    const stats = computeGridStats([
      { lat: 0, lng: 0, rank: 1 },
      { lat: 0, lng: 0, rank: 3 },
      { lat: 0, lng: 0, rank: 8 },
      { lat: 0, lng: 0, rank: null },
    ]);
    expect(stats.avgRank).toBe(4); // (1+3+8)/3
    expect(stats.top3Share).toBe(0.5); // 2 of 4 points
    expect(stats.foundShare).toBe(0.75); // 3 of 4 points
  });

  it("handles a fully not-found grid", () => {
    const stats = computeGridStats([
      { lat: 0, lng: 0, rank: null },
      { lat: 0, lng: 0, rank: null },
    ]);
    expect(stats.avgRank).toBeNull();
    expect(stats.top3Share).toBe(0);
    expect(stats.foundShare).toBe(0);
  });
});

describe("matchesBusiness", () => {
  const business = { name: "Glow Salon & Spa", addressLine: "142, 100 Feet Rd" };

  it("matches on normalized name + address fragment", () => {
    expect(
      matchesBusiness(
        {
          displayName: { text: "Glow Salon and Spa" },
          formattedAddress: "142, 100 Feet Rd, Indiranagar, Bengaluru",
        },
        business,
      ),
    ).toBe(false); // "and" vs "&" breaks strict inclusion — realistic miss
    expect(
      matchesBusiness(
        {
          displayName: { text: "Glow Salon & Spa Indiranagar" },
          formattedAddress: "142, 100 Feet Road, Bengaluru",
        },
        business,
      ),
    ).toBe(true);
  });

  it("rejects a same-name business at a different address", () => {
    expect(
      matchesBusiness(
        {
          displayName: { text: "Glow Salon & Spa" },
          formattedAddress: "7 MG Road, Pune",
        },
        business,
      ),
    ).toBe(false);
  });

  it("matches on name alone when no address is stored", () => {
    expect(
      matchesBusiness(
        { displayName: { text: "Glow Salon & Spa" }, formattedAddress: "anywhere" },
        { name: "Glow Salon & Spa", addressLine: null },
      ),
    ).toBe(true);
  });
});

describe("buildLocalLeaderboard", () => {
  const you = { name: "Glow Salon", addressLine: "100 Feet Rd" };
  const place = (name: string, addr = "somewhere") => ({
    displayName: { text: name },
    formattedAddress: addr,
  });

  it("ranks the ordered results and flags the tenant's own business", () => {
    const board = buildLocalLeaderboard(
      [place("Cutz & Bangs"), place("Glow Salon", "100 Feet Rd, Indiranagar"), place("Style Studio")],
      you,
    );
    expect(board).toEqual([
      { rank: 1, name: "Cutz & Bangs", isYou: false },
      { rank: 2, name: "Glow Salon", isYou: true },
      { rank: 3, name: "Style Studio", isYou: false },
    ]);
  });

  it("truncates to the limit", () => {
    const board = buildLocalLeaderboard(
      Array.from({ length: 15 }, (_, i) => place(`Biz ${i + 1}`)),
      you,
      10,
    );
    expect(board).toHaveLength(10);
    expect(board[9]).toEqual({ rank: 10, name: "Biz 10", isYou: false });
  });

  it("handles an empty result set", () => {
    expect(buildLocalLeaderboard([], you)).toEqual([]);
  });

  it("falls back to a label when a place has no display name", () => {
    const board = buildLocalLeaderboard([{ formattedAddress: "x" }], you);
    expect(board[0].name).toBe("Unnamed business");
  });
});

describe("buildBattleMap", () => {
  const you = { name: "Glow Salon", addressLine: "100 Feet Rd" };
  const p = (name: string, id?: string) => ({
    displayName: { text: name },
    formattedAddress: "somewhere",
    ...(id ? { id } : {}),
  });
  const me = { displayName: { text: "Glow Salon" }, formattedAddress: "100 Feet Rd, Indiranagar" };

  it("builds a per-rival heat-map index-aligned with the grid points", () => {
    // 3 points. Cutz is 1st,2nd,1st. Style only appears at point 2 (3rd).
    const { rivals } = buildBattleMap(
      [
        [p("Cutz & Bangs"), me],
        [p("Cutz & Bangs"), me, p("Style Studio")],
        [p("Cutz & Bangs")],
      ],
      you,
    );
    const cutz = rivals.find((r) => r.name === "Cutz & Bangs")!;
    expect(cutz.ranks).toEqual([1, 1, 1]);
    expect(cutz.foundShare).toBe(1);
    expect(cutz.avgRank).toBe(1);

    const style = rivals.find((r) => r.name === "Style Studio")!;
    // null at points where they didn't appear — alignment preserved.
    expect(style.ranks).toEqual([null, 3, null]);
    expect(style.foundShare).toBeCloseTo(0.33, 2);
    expect(style.avgRank).toBe(3);
  });

  it("excludes our own listing — the primary grid already covers it", () => {
    const { rivals } = buildBattleMap([[me, p("Cutz & Bangs")]], you);
    expect(rivals.map((r) => r.name)).toEqual(["Cutz & Bangs"]);
  });

  it("orders by coverage first, then mean rank", () => {
    // Everywhere ranks 4th; Sometimes ranks 1st but only at one point.
    const { rivals } = buildBattleMap(
      [
        [p("A"), p("B"), p("C"), p("Everywhere")],
        [p("Sometimes"), p("X"), p("Y"), p("Everywhere")],
      ],
      you,
      2,
    );
    // Coverage (1.0) beats a better mean rank at lower coverage (0.5).
    expect(rivals[0].name).toBe("Everywhere");
  });

  it("caps the rival list to the limit", () => {
    const places = Array.from({ length: 12 }, (_, i) => p(`Rival ${i + 1}`));
    const { rivals } = buildBattleMap([places], you, 5);
    expect(rivals).toHaveLength(5);
  });

  it("keys by Places id so a renamed listing isn't double-counted", () => {
    // Same id, different display text across points → one rival, both points.
    const { rivals } = buildBattleMap(
      [[p("Cutz and Bangs", "place-1")], [p("Cutz & Bangs", "place-1")]],
      you,
    );
    expect(rivals).toHaveLength(1);
    expect(rivals[0].ranks).toEqual([1, 1]);
    expect(rivals[0].foundShare).toBe(1);
  });

  it("ignores a duplicate listing at the same point (first occurrence wins)", () => {
    const { rivals } = buildBattleMap([[p("Cutz", "x"), p("Cutz", "x")]], you);
    expect(rivals[0].ranks).toEqual([1]);
    expect(rivals[0].avgRank).toBe(1);
  });

  it("tolerates failed points (empty result lists) without breaking alignment", () => {
    const { rivals } = buildBattleMap([[p("Cutz")], [], [p("Cutz")]], you);
    expect(rivals[0].ranks).toEqual([1, null, 1]);
    expect(rivals[0].foundShare).toBeCloseTo(0.67, 2);
  });

  it("returns no rivals for an empty grid", () => {
    expect(buildBattleMap([], you).rivals).toEqual([]);
  });
});
