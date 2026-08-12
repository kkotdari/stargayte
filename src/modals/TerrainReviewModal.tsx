import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Spinner } from "../components/common/Feedback";
import { api } from "../api/client";
import {
  analyzeMinimap, decodeWalk, encodeWalk, type TerrainGrid,
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 끌기 한 번은 한 값으로만 칠한다 — 지나는 칸마다 뒤집으면 갈지자 자국이 남는다. */
  const paintRef = useRef<0 | 1 | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = decodeWalk(image.walk);
      const g = stored ?? (await analyzeMinimap(image.image));
      if (!cancelled) {
        setGrid(g);
        setLoading(false);
        if (!g) setErr("그림을 분석하지 못했어요.");
      }
    })();
    return () => { cancelled = true; };
  }, [image]);

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

  const paint = (e: React.PointerEvent, begin: boolean) => {
    if (!grid) return;
    const cell = cellAt(e);
    if (!cell) return;
    const idx = cell[1] * grid.w + cell[0];
    if (begin) paintRef.current = grid.walk[idx] ? 0 : 1;
    const v = paintRef.current;
    if (v === null || grid.walk[idx] === v) return;
    const walk = new Uint8Array(grid.walk);
    walk[idx] = v;
    setGrid({ ...grid, walk });
  };

  const save = async () => {
    if (!grid) return;
    setBusy(true);
    setErr("");
    try {
      const updated = await api.updateMinimapImage(image.id, {
        name: image.name, walk: encodeWalk(grid),
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="scr-modal-overlay" onClick={onClose}>
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
            <button
              type="button" className="scr-btn"
              disabled={busy || loading}
              onClick={async () => {
                setLoading(true);
                const g = await analyzeMinimap(image.image);
                setGrid(g);
                setLoading(false);
                if (!g) setErr("그림을 분석하지 못했어요.");
              }}
            >
              다시 분석
            </button>
            <button type="button" className="scr-btn scr-btn-primary" onClick={save} disabled={busy || !grid}>
              {busy ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
