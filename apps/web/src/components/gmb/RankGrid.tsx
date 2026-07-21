"use client";

// Illustrative 7x7 rank grid used on the marketing page.
//
// These ranks are the design file's sample data, not a real scan — the page
// only ever shows it as a picture of the product, never labelled with a
// visitor's business. The real grid lives on /gmb-ranking and is driven by
// GmbRankGridSnapshot.

const SAMPLE = [
  7, 5, 4, 3, 4, 6, 0,
  5, 3, 2, 2, 2, 5, 7,
  4, 2, 1, 1, 1, 4, 6,
  3, 2, 1, 1, 1, 3, 5,
  4, 2, 1, 1, 2, 4, 7,
  6, 4, 3, 2, 3, 5, 0,
  0, 7, 5, 4, 6, 0, 0,
];

/** Green top-3, amber 4-7, red beyond, grey not found — same scale as the app. */
export function rankColor(rank: number, muted = false): string {
  if (rank === 0) return muted ? "#4a4660" : "#c9c7d4";
  if (rank <= 3) return "#22c55e";
  if (rank <= 7) return "#f59e0b";
  return "#f04438";
}

export function RankGrid({
  ranks = SAMPLE,
  columns = 7,
  className = "",
}: {
  ranks?: number[];
  columns?: number;
  className?: string;
}) {
  return (
    <div
      className={`grid gap-[5px] ${className}`}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      aria-hidden
    >
      {ranks.map((r, i) => (
        <div
          key={i}
          className="flex aspect-square items-center justify-center rounded-full font-geist-mono text-[10px] font-medium text-white"
          style={{ background: rankColor(r) }}
        >
          {r === 0 ? "–" : r}
        </div>
      ))}
    </div>
  );
}
