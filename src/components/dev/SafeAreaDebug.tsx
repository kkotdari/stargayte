import { useEffect, useState } from "react";

// DEV 전용 안전영역 진단 오버레이 — 아이폰 PWA에서 env(safe-area-inset-*)가 실제로 어떤
// 값으로 잡히는지, standalone 모드인지, 뷰포트 높이가 화면 높이와 같은지(=full-bleed인지)를
// 화면에 직접 찍어 준다. import.meta.env.DEV일 때만 App에서 마운트하므로 프로덕션 빌드엔
// 포함되지 않는다. 우상단 [x]로 닫는다.
function readInset(side: "top" | "right" | "bottom" | "left"): number {
  const probe = document.createElement("div");
  probe.style.cssText =
    `position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-${side}:env(safe-area-inset-${side},0px);`;
  document.body.appendChild(probe);
  const v = side === "top" || side === "bottom" ? probe.offsetHeight : probe.offsetWidth;
  probe.remove();
  return v;
}

export default function SafeAreaDebug() {
  const [open, setOpen] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  if (!open) return null;

  const standaloneMedia = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  // iOS 사파리 전용 플래그(홈화면 웹앱일 때만 true).
  const navStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone ?? false;
  const vv = window.visualViewport;
  const cssVarTop = getComputedStyle(document.documentElement).getPropertyValue("--safe-area-top").trim();

  const rows: [string, string][] = [
    ["standalone(media)", String(standaloneMedia)],
    ["navigator.standalone", String(navStandalone)],
    ["inset top", `${readInset("top")}px`],
    ["inset bottom", `${readInset("bottom")}px`],
    ["--safe-area-top", cssVarTop || "(unset)"],
    ["innerHeight", `${window.innerHeight}`],
    ["screen.height", `${window.screen.height}`],
    ["visualViewport h", vv ? `${Math.round(vv.height)}` : "n/a"],
    ["vv offsetTop", vv ? `${Math.round(vv.offsetTop)}` : "n/a"],
    ["dpr", `${window.devicePixelRatio}`],
  ];

  return (
    <div
      data-tick={tick}
      style={{
        position: "fixed",
        top: "38%",
        left: 8,
        right: 8,
        zIndex: 999999,
        background: "rgba(0,0,0,0.86)",
        border: "1px solid #34d399",
        borderRadius: 10,
        padding: "10px 12px",
        font: "12px/1.5 ui-monospace, Menlo, monospace",
        color: "#a3e635",
        pointerEvents: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <strong style={{ color: "#fff" }}>SAFE-AREA DEBUG</strong>
        <button
          onClick={() => setOpen(false)}
          style={{ background: "transparent", border: "1px solid #666", color: "#fff", borderRadius: 6, padding: "0 8px" }}
        >
          x
        </button>
      </div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ color: "#9aa" }}>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}
