import { useEffect, useRef, useState } from "react";
import ModalHash from "../utils/modalHash";
import { createPortal } from "react-dom";
import {
  Eraser, Mountain, Paintbrush, RefreshCcw, RotateCcw, Save, Undo2, Wand2, Waves, X,
} from "lucide-react";
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
 * 쓰는 모든 맵의 연속 재생이 이 격자로 길을 찾는다.
 *
 * 크립 층(요청: 램프·다리는 크립이 못 퍼진다 — 직접 설정) — 물결 버튼으로 층을 바꾸면
 * 붓·지우개·요술봉이 '크립 못 퍼지는 칸'(주황)을 칠한다. 벽(라임)은 자동으로 크립을
 * 막으니, 걷긴 하지만 크립은 못 앉는 램프·다리만 주황으로 칠하면 된다.
 *
 * 언덕 층(요청) — 산 버튼으로 '높은 땅'(하늘색)을 칠한다. 원작은 **낮은 데서 높은 데를
 * 쏘면 46.9%가 빗나가는데**(missChanceRaw의 119 가지), 그 고도가 리플레이에도 미니맵
 * 그림에도 안 실려 있다. 여기 칠한 층이 곧 연속 재생의 고도이고, 안 칠하면 온 지도가
 * 같은 높이라 아무도 안 빗나간다(예전과 같다). 세 층은 서로 독립이라 겹쳐 칠해도 된다. */

/** 한 획의 스냅샷 — 두 층을 함께 되돌려야 층을 오가며 칠해도 어긋나지 않는다. */
type Snap = { walk: Uint8Array; creep: Uint8Array | null; high: Uint8Array | null };

export default function TerrainReviewModal({
  image, anchors, reanalyzable = false, onClose, onSaved,
}: {
  image: MinimapImage;
  /** 확실한 땅(자원 지대, 0~1 분수) — 자동 분석의 앵커 보정(지적: 빠른무한 반전). */
  anchors?: [number, number][];
  /** 재분석 버튼을 보일까 — 관리자(미니맵 관리) 모달에서만(요청). */
  reanalyzable?: boolean;
  onClose: () => void;
  /** 저장된 뒤의 그림 한 벌 — 부모 목록을 제자리에서 갈아 끼운다. */
  onSaved: (updated: MinimapImage) => void;
}) {
  useLockBodyScroll();
  const [grid, setGrid] = useState<TerrainGrid | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  /* 도구 셋(요청: 아이콘 배타 선택) — 붓은 끌어서 막고(이동 불가), 지우개는 끌어서 열고
     (이동 가능), 요술봉은 누른 칸과 색이 비슷한 칸 전부를 한 번에 뒤집고, 램프(물결)는
     크립 불가 칸(주황)을 칠한다 — 이미 칠한 칸에서 시작하면 그 획은 지우기다. 산은
     언덕(하늘색)을 같은 식으로 칠한다. 층 토글로 두다가 도구와 중복 선택되던 것을 하나의
     배타 도구로 바꿨다(지적). */
  const [tool, setTool] = useState<"paint" | "erase" | "wand" | "creep" | "high">("paint");
  const [colors, setColors] = useState<Uint8ClampedArray | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 끌기 한 번은 한 값으로만 칠한다 — 지나는 칸마다 뒤집으면 갈지자 자국이 남는다. */
  const paintRef = useRef<0 | 1 | null>(null);
  /* 되돌리기(요청) — 한 획(클릭·끌기 한 번, 일괄 붓 한 번)마다 이전 판을 쌓아 두고
     한 스텝씩 되돌린다. 전부 되돌리기는 처음 불러온 판(저장값 또는 자동 분석)으로. */
  const historyRef = useRef<Snap[]>([]);
  const initialRef = useRef<Snap | null>(null);
  const [histN, setHistN] = useState(0);
  const snapOf = (g: TerrainGrid): Snap => ({
    walk: new Uint8Array(g.walk),
    creep: g.creep ? new Uint8Array(g.creep) : null,
    high: g.high ? new Uint8Array(g.high) : null,
  });
  const snapshot = (g: TerrainGrid) => {
    historyRef.current.push(snapOf(g));
    if (historyRef.current.length > 60) historyRef.current.shift();
    setHistN(historyRef.current.length);
  };
  const applySnap = (g: TerrainGrid, s: Snap): TerrainGrid => ({
    ...g,
    walk: new Uint8Array(s.walk),
    ...(s.creep ? { creep: new Uint8Array(s.creep) } : { creep: undefined }),
    ...(s.high ? { high: new Uint8Array(s.high) } : { high: undefined }),
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = decodeWalk(image.walk);
      const g = stored ?? (await analyzeMinimap(image.image, anchors));
      if (!cancelled) {
        setGrid(g);
        initialRef.current = g ? snapOf(g) : null;
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
    // 형광 라임(지적: 검정은 어두운 지형과 구분이 안 된다) — 미니맵에 없는 색이라 또렷하다.
    ctx.fillStyle = "rgba(198, 255, 0, 0.55)";
    for (let y = 0; y < grid.h; y += 1) {
      for (let x = 0; x < grid.w; x += 1) {
        if (!grid.walk[y * grid.w + x]) ctx.fillRect(x, y, 1, 1);
      }
    }
    // 크립 불가(요청: 램프·다리) — 주황. 벽 위에 겹쳐 칠해도 주황이 이긴다(따로 보여야
    // 지웠는지 안다).
    if (grid.creep) {
      ctx.fillStyle = "rgba(255, 140, 40, 0.65)";
      for (let y = 0; y < grid.h; y += 1) {
        for (let x = 0; x < grid.w; x += 1) {
          if (grid.creep[y * grid.w + x]) ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    /* 언덕(요청) — 하늘색. 벽(라임)·램프(주황)와 한눈에 갈리는 색이라야 세 층을 겹쳐
       칠하고도 무엇이 칠해졌는지 읽힌다. */
    if (grid.high) {
      ctx.fillStyle = "rgba(90, 190, 255, 0.6)";
      for (let y = 0; y < grid.h; y += 1) {
        for (let x = 0; x < grid.w; x += 1) {
          if (grid.high[y * grid.w + x]) ctx.fillRect(x, y, 1, 1);
        }
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
    /* 램프 도구(지적: 층 토글이 다른 도구와 중복 선택됨 — 배타 도구로) — 크립 불가 층을
       칠한다. 첫 칸이 이미 칠해져 있으면 그 획은 지우기가 되어 버튼 하나로 오간다. */
    /* 층 고르기 — 램프(크립 불가)·언덕은 제 층을 칠하고 나머지 도구는 걷기 층을 칠한다.
       첫 칸이 이미 칠해져 있으면 그 획은 지우기가 되어 버튼 하나로 오간다. */
    const layer = tool === "creep" ? grid.creep : tool === "high" ? grid.high : null;
    const arr = tool === "creep" || tool === "high"
      ? (layer ?? new Uint8Array(grid.w * grid.h)) : grid.walk;
    const put = (next: Uint8Array): TerrainGrid =>
      (tool === "creep" ? { ...grid, creep: next }
        : tool === "high" ? { ...grid, high: next } : { ...grid, walk: next });
    if (tool === "wand") {
      // 요술봉(요청) — 클릭 한 번이 한 획: 누른 칸과 색이 가까운 칸 전부를 뒤집는다.
      if (!begin || !colors) return;
      snapshot(grid);
      const v = arr[idx] ? 0 : 1;
      const r0 = colors[idx * 4];
      const g0 = colors[idx * 4 + 1];
      const b0 = colors[idx * 4 + 2];
      const next = new Uint8Array(arr);
      for (let i = 0; i < next.length; i += 1) {
        const dr = colors[i * 4] - r0;
        const dg = colors[i * 4 + 1] - g0;
        const db = colors[i * 4 + 2] - b0;
        if (Math.sqrt(dr * dr + dg * dg + db * db) <= SIMILAR_DIST) next[i] = v;
      }
      setGrid(put(next));
      return;
    }
    // 붓=막기(0), 지우개=열기(1), 램프=첫 칸의 반대값 — 한 획 안에서 값이 안 변한다.
    const v: 0 | 1 = tool === "creep" || tool === "high"
      ? (arr[idx] ? 0 : 1)
      : (tool === "paint" ? 0 : 1);
    if (begin) {
      paintRef.current = v;
      snapshot(grid);
    }
    if (paintRef.current === null) return;
    if (arr[idx] === paintRef.current) return;
    const next = new Uint8Array(arr);
    next[idx] = paintRef.current;
    setGrid(put(next));
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
      <ModalHash hash={`terrain-${image.id}`} onClose={onClose} />
      <div className="scr-modal scr-terrain-modal" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span>지형 검수 — {image.name}</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body">
          {/* (제거·요청) 맨 위 설명 — 도구 툴팁이 대신 말한다. */}
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
            {/* 아이콘들(요청: 배타 선택) — 붓 · 지우개 · 요술봉 · 램프 | 되돌리기 · 완전
                취소 · 저장. */}
            <div className="scr-terrain-brushes">
              <button
                type="button"
                className={tool === "paint" && !busy ? "scr-btn scr-btn-sm scr-btn-primary" : "scr-btn scr-btn-sm"}
                onClick={() => setTool("paint")}
                aria-label="붓"
                title="붓 — 끌어서 이동 불가(라임)로 막아요"
              >
                <Paintbrush size={14} />
              </button>
              <button
                type="button"
                className={tool === "erase" && !busy ? "scr-btn scr-btn-sm scr-btn-primary" : "scr-btn scr-btn-sm"}
                onClick={() => setTool("erase")}
                aria-label="지우개"
                title="지우개 — 끌어서 이동 가능으로 열어요"
              >
                <Eraser size={14} />
              </button>
              <button
                type="button"
                className={tool === "wand" && !busy ? "scr-btn scr-btn-sm scr-btn-primary" : "scr-btn scr-btn-sm"}
                onClick={() => setTool("wand")}
                disabled={!colors}
                aria-label="요술봉" title="요술봉 — 누른 칸과 색이 비슷한 칸 전부를 한 번에 뒤집어요"
              >
                <Wand2 size={14} />
              </button>
              <button
                type="button"
                className={tool === "creep" && !busy ? "scr-btn scr-btn-sm scr-btn-primary" : "scr-btn scr-btn-sm"}
                onClick={() => setTool("creep")}
                aria-label="램프·다리"
                title="램프·다리 — 크립이 못 퍼지는 곳(주황)을 칠해요. 칠한 칸에서 시작하면 지워져요"
              >
                <Waves size={14} />
              </button>
              {/* 언덕(요청) — 원작은 낮은 데서 높은 데를 쏘면 46.9%가 빗나간다. 그 높이가
                  리플레이에도 미니맵에도 안 실려 있어 여기서 사람이 칠한다. */}
              <button
                type="button"
                className={tool === "high" && !busy ? "scr-btn scr-btn-sm scr-btn-primary" : "scr-btn scr-btn-sm"}
                onClick={() => setTool("high")}
                aria-label="언덕"
                title="언덕 — 높은 땅(하늘색)을 칠해요. 낮은 곳에서 이 위를 쏘면 46.9%가 빗나가요. 칠한 칸에서 시작하면 지워져요"
              >
                <Mountain size={14} />
              </button>
            </div>
            <button
              type="button" className="scr-btn scr-btn-sm"
              disabled={busy || histN === 0}
              onClick={() => {
                const prev = historyRef.current.pop();
                setHistN(historyRef.current.length);
                if (prev && grid) setGrid(applySnap(grid, prev));
              }}
              aria-label="한 스텝 되돌리기" title="한 스텝 되돌리기 — 마지막 획을 되돌려요"
            >
              <Undo2 size={14} />
            </button>
            <button
              type="button" className="scr-btn scr-btn-sm"
              disabled={busy || histN === 0}
              onClick={() => {
                if (initialRef.current && grid) {
                  setGrid(applySnap(grid, initialRef.current));
                }
                historyRef.current = [];
                setHistN(0);
              }}
              aria-label="완전 취소" title="완전 취소 — 처음 불러온 상태로 전부 되돌려요"
            >
              <RotateCcw size={14} />
            </button>
            {reanalyzable && (
              <button
                type="button" className="scr-btn scr-btn-sm"
                disabled={busy || loading}
                onClick={async () => {
                  // 재분석(요청: 관리자 모달 안에서만) — 앵커 보정판으로 다시 만든다.
                  setLoading(true);
                  setErr("");
                  const g = await analyzeMinimap(image.image, anchors);
                  setGrid(g);
                  initialRef.current = g ? snapOf(g) : null;
                  historyRef.current = [];
                  setHistN(0);
                  setLoading(false);
                  if (!g) setErr("그림을 분석하지 못했어요.");
                }}
                aria-label="재분석" title="재분석 — 자동 분석(앵커 보정)으로 다시 만들어요"
              >
                <RefreshCcw size={14} />
              </button>
            )}
            <button
              type="button" className="scr-btn scr-btn-sm scr-btn-primary"
              onClick={save} disabled={busy || !grid}
              aria-label="저장" title="저장"
            >
              {busy ? <Spinner size={14} /> : <Save size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
