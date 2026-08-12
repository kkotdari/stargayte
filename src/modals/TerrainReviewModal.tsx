import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Spinner } from "../components/common/Feedback";
import { api } from "../api/client";
import {
  analyzeMinimap, decodeWalk, encodeWalk, sampleMinimapColors, type TerrainGrid,
} from "../utils/minimapTerrain";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import type { MinimapImage } from "../types";

/* 지형 검수(요청) — 미니맵 그림을 크게 띄우고, 자동 분석이 만든 이동 가능/불가 격자를
 * 겹쳐 보여준다. 어두운 칸이 '이동 불가'다. 칸을 누르거나 끌면 뒤집힌다 — 자동 분석은
 * 색 어림이라(램프·다리를 못 가른다) 마지막 손질은 사람 몫이다. 저장하면 이 그림을
 * 쓰는 모든 맵의 연속 재생이 이 격자로 길을 찾는다. */

export default function TerrainReviewModal({
  image, onClose, onSaved,
}: {
  image: MinimapImage;
  onClose: () => void;
  /** 저장된 뒤의 그림 한 벌 — 부모 목록을 제자리에서 갈아 끼운다. */
  onSaved: (updated: MinimapImage) => void;
}) {
  useLockBodyScroll();
  const [grid, setGrid] = useState<TerrainGrid | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  /* 붓 모드(요청: 비슷한 유형의 타일을 동시에) — "한 칸"은 끌어서 칠하고, "비슷한 색"은
     누른 칸과 색이 비슷한 칸 전부를 한 번에 같은 값으로 뒤집는다. */
  const [brush, setBrush] = useState<"one" | "similar">("one");
  const [colors, setColors] = useState<Uint8ClampedArray | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 끌기 한 번은 한 값으로만 칠한다 — 지나는 칸마다 뒤집으면 갈지자 자국이 남는다. */
  const paintRef = useRef<0 | 1 | null>(null);
  /* 되돌리기(요청) — 한 획(클릭·끌기 한 번, 일괄 붓 한 번)마다 이전 판을 쌓아 두고
     한 스텝씩 되돌린다. 전부 되돌리기는 처음 불러온 판(저장값 또는 자동 분석)으로. */
  const historyRef = useRef<Uint8Array[]>([]);
  const initialRef = useRef<Uint8Array | null>(null);
  const [histN, setHistN] = useState(0);
  const snapshot = (walk: Uint8Array) => {
    historyRef.current.push(new Uint8Array(walk));
    if (historyRef.current.length > 60) historyRef.current.shift();
    setHistN(historyRef.current.length);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = decodeWalk(image.walk);
      const g = stored ?? (await analyzeMinimap(image.image));
      if (!cancelled) {
        setGrid(g);
        initialRef.current = g ? new Uint8Array(g.walk) : null;
        historyRef.current = [];
        setHistN(0);
        setLoading(false);
        if (!g) setErr("그림을 분석하지 못했어요.");
      }
    })();
    return () => { cancelled = true; };
  }, [image]);

  // 칸 색 표본 — 격자 크기가 정해진 뒤 그 크기로 읽는다(비슷한 유형 붓의 재료).
  useEffect(() => {
    let cancelled = false;
    if (!grid) return undefined;
    sampleMinimapColors(image.image, grid.w, grid.h)
      .then((c) => { if (!cancelled) setColors(c); });
    return () => { cancelled = true; };
  }, [image, grid?.w, grid?.h]);

  // 격자를 그림 위에 겹쳐 그린다 — 캔버스 픽셀 하나가 칸 하나다(CSS가 늘린다).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grid) return;
    canvas.width = grid.w;
    canvas.height = grid.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, grid.w, grid.h);
    ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
    for (let y = 0; y < grid.h; y += 1) {
      for (let x = 0; x < grid.w; x += 1) {
        if (!grid.walk[y * grid.w + x]) ctx.fillRect(x, y, 1, 1);
      }
    }
  }, [grid]);

  const cellAt = (e: React.PointerEvent): [number, number] | null => {
    const canvas = canvasRef.current;
    if (!canvas || !grid) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * grid.w);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * grid.h);
    if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) return null;
    return [x, y];
  };

  /** 비슷한 색으로 치는 거리 — RGB 유클리드. 미니맵 팔레트가 단순해 이 정도면 같은
   *  타일 유형(같은 물·같은 벽)이 묶인다. */
  const SIMILAR_DIST = 30;

  const paint = (e: React.PointerEvent, begin: boolean) => {
    if (!grid) return;
    const cell = cellAt(e);
    if (!cell) return;
    const idx = cell[1] * grid.w + cell[0];
    if (begin) {
      paintRef.current = grid.walk[idx] ? 0 : 1;
      snapshot(grid.walk);
    }
    const v = paintRef.current;
    if (v === null) return;
    if (brush === "similar" && begin && colors) {
      // 비슷한 유형 한꺼번에(요청) — 누른 칸과 색이 가까운 칸 전부를 같은 값으로.
      const r0 = colors[idx * 4];
      const g0 = colors[idx * 4 + 1];
      const b0 = colors[idx * 4 + 2];
      const walk = new Uint8Array(grid.walk);
      for (let i = 0; i < walk.length; i += 1) {
        const dr = colors[i * 4] - r0;
        const dg = colors[i * 4 + 1] - g0;
        const db = colors[i * 4 + 2] - b0;
        if (Math.sqrt(dr * dr + dg * dg + db * db) <= SIMILAR_DIST) walk[i] = v;
      }
      setGrid({ ...grid, walk });
      return;
    }
    if (brush === "similar") return; // 유형 붓은 클릭 한 번이 한 획이다 — 끌기는 없다.
    if (grid.walk[idx] === v) return;
    const walk = new Uint8Array(grid.walk);
    walk[idx] = v;
    setGrid({ ...grid, walk });
  };

  const save = async () => {
    if (!grid) return;
    setBusy(true);
    setErr("");
    try {
      // walk 전용 길(요청: 아무나 지형 업데이트) — 이름·그림·매핑은 안 건드린다.
      const updated = await api.updateMinimapWalk(image.id, encodeWalk(grid));
      onSaved(updated);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    // 상세 팝업(z-index 130) 위에도 떠야 한다(지적: 산을 누르면 뒤에 떠서 안 보인다).
    <div className="scr-modal-overlay scr-terrain-overlay" onClick={onClose}>
      <div className="scr-modal scr-terrain-modal" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span>지형 검수 — {image.name}</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body">
          <p className="scr-terrain-hint">
            어두운 칸이 <b>이동 불가</b>예요. 칸을 누르거나 끌면 뒤집혀요 — 자동 분석이 놓친
            램프·다리를 열어 주세요.
          </p>
          {err && <div className="scr-err">{err}</div>}
          {loading ? (
            <div className="scr-empty"><Spinner size={18} /></div>
          ) : grid && (
            <div className="scr-terrain-stage">
              <img className="scr-terrain-img" src={image.image} alt={image.name} draggable={false} />
              <canvas
                ref={canvasRef}
                className="scr-terrain-canvas"
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); paint(e, true); }}
                onPointerMove={(e) => { if (paintRef.current !== null && e.buttons > 0) paint(e, false); }}
                onPointerUp={() => { paintRef.current = null; }}
              />
            </div>
          )}
          <div className="scr-terrain-actions">
            {/* 붓 고르기(요청: 비슷한 유형 동시 적용) — 왼쪽에 붙인다. */}
            <div className="scr-terrain-brushes">
              <button
                type="button"
                className={busy ? "scr-btn scr-btn-sm" : brush === "one" ? "scr-btn scr-btn-sm scr-btn-primary" : "scr-btn scr-btn-sm"}
                onClick={() => setBrush("one")}
              >
                한 칸
              </button>
              <button
                type="button"
                className={busy ? "scr-btn scr-btn-sm" : brush === "similar" ? "scr-btn scr-btn-sm scr-btn-primary" : "scr-btn scr-btn-sm"}
                onClick={() => setBrush("similar")}
                disabled={!colors}
                title="누른 칸과 색이 비슷한 칸 전부를 한 번에 뒤집어요"
              >
                비슷한 색 한꺼번에
              </button>
              <button
                type="button" className="scr-btn scr-btn-sm"
                disabled={busy || histN === 0}
                onClick={() => {
                  const prev = historyRef.current.pop();
                  setHistN(historyRef.current.length);
                  if (prev && grid) setGrid({ ...grid, walk: prev });
                }}
                title="마지막 획을 되돌려요"
              >
                한 스텝 되돌리기
              </button>
              <button
                type="button" className="scr-btn scr-btn-sm"
                disabled={busy || histN === 0}
                onClick={() => {
                  if (initialRef.current && grid) {
                    setGrid({ ...grid, walk: new Uint8Array(initialRef.current) });
                  }
                  historyRef.current = [];
                  setHistN(0);
                }}
                title="처음 불러온 상태로 전부 되돌려요"
              >
                전부 되돌리기
              </button>
            </div>
            <button
              type="button" className="scr-btn scr-btn-sm"
              disabled={busy || loading}
              onClick={async () => {
                setLoading(true);
                const g = await analyzeMinimap(image.image);
                setGrid(g);
                initialRef.current = g ? new Uint8Array(g.walk) : null;
                historyRef.current = [];
                setHistN(0);
                setLoading(false);
                if (!g) setErr("그림을 분석하지 못했어요.");
              }}
            >
              다시 분석
            </button>
            <button type="button" className="scr-btn scr-btn-sm scr-btn-primary" onClick={save} disabled={busy || !grid}>
              {busy ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
