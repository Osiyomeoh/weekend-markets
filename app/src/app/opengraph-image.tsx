import { ImageResponse } from "next/og";

export const alt = "Weekend Markets: hedge the hours Wall Street is closed";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Share card: the product line over the week strip (Nasdaq's 32.5 open hours in gold).
export default function Image() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0c0f",
          color: "#e8eaed",
          padding: "64px 72px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, color: "#f2b441" }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
            <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" stroke="#f2b441" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M10 20.5a2 2 0 0 0 4 0" stroke="#f2b441" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          Weekend Markets
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>
            Hedge the hours Wall Street is closed.
          </div>
          <div style={{ fontSize: 30, color: "#8b94a3" }}>
            Gap cover for tokenized stocks, settled on Solana by the first Pyth price after the bell.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {days.map((d, i) => (
            <div key={d} style={{ display: "flex", flexDirection: "column", flex: 1, gap: 8 }}>
              <div style={{ display: "flex", height: 34, borderRadius: 6, background: "rgba(47,191,113,0.16)", position: "relative" }}>
                {i < 5 && (
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: `${(9.5 / 24) * 100}%`,
                      width: `${(6.5 / 24) * 100}%`,
                      borderRadius: 6,
                      background: "#f2b441",
                    }}
                  />
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "center", fontSize: 20, color: "#8b94a3" }}>{d}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
