import React, { useEffect, useRef } from "react";

/* 전체화면 미니맵(요청: "pc에만 왼쪽사이드의 아래부분 빈공간에 미니맵을 넣음.
   스타 미니맵처럼 맵축소위에 활동상태가 색깔네모들로 찍히고 어디를 볼지 프레임을
   드래그나 터치로 선택 가능함") ────────────────────────────────────────────────
   원작 미니맵이 하는 일은 셋이다: ① 지도를 줄여 깔고 ② 그 위에 유닛·건물을 임자 색
   네모로 찍고 ③ 지금 보고 있는 자리를 흰 테두리로 알리며 그걸 끌어 시점을 옮긴다.

   ★ 왜 캔버스 하나로 그리나 — 유닛이 수백이라 DOM 조각으로 찍으면 프레임마다 그만큼
     노드를 만들었다 지운다. 캔버스는 한 장을 덧그리기만 하므로 재생 중에도 값이 없다.
   ★ 왜 ops를 ref로 받나 — 재생기가 매 프레임 만드는 배열이라, prop으로 넘기면 그때마다
     이 컴포넌트가 리렌더된다. ref로 붙들고 시각(t)이 바뀔 때만 다시 그린다.

   보이는 창(view)은 재생기가 셈해 넘긴다 — 지도 좌표계(0~1 분수)의 네모다. */

/** 미니맵에 찍는 한 점 — 재생기가 그리는 op에서 필요한 넷만 본다. `wFrac`이 있으면
 *  건물이라 한 단 크게 찍는다(원작 미니맵도 건물이 더 크다). */
export type MiniDot = { fx: number; fy: number; color: string; wFrac?: number };

export default function ReplayFullscreenMinimap({
  image, ratio, dotsRef, tick, view, onSeek,
}: {
  /** 지도 그림(없으면 어두운 바탕만). */
  image?: string;
  /** 지도 가로/세로 비 — 미니맵 상자의 비율이 된다. */
  ratio: number;
  /** 지금 프레임의 점들 — 재생기가 렌더마다 채운다(그리는 op 배열을 그대로 받는다). */
  dotsRef: { current: readonly MiniDot[] };
  /** 다시 그릴 신호(재생 시각) — 이 값이 바뀔 때만 덧그린다. */
  tick: number;
  /** 지금 보이는 창 — 지도 분수 좌표 [중심x, 중심y, 폭, 높이]. */
  view: { cx: number; cy: number; w: number; h: number };
  /** 프레임을 끌었다 — 그 자리를 화면 한가운데로 (지도 분수 좌표). */
  onSeek: (fx: number, fy: number) => void;
}): React.ReactElement {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  /* 지도 그림은 한 번만 읽어 붙들어 둔다 — 프레임마다 새로 만들면 그때마다 디코딩한다. */
  useEffect(() => {
    if (!image) { imgRef.current = null; return; }
    const im = new Image();
    im.src = image;
    im.onload = () => { imgRef.current = im; };
  }, [image]);

  useEffect(() => {
    const cv = cvRef.current;
    const box = boxRef.current;
    if (!cv || !box) return;
    const w = box.clientWidth;
    const h = box.clientHeight;
    if (w <= 0 || h <= 0) return;
    const B = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * B) || cv.height !== Math.round(h * B)) {
      cv.width = Math.round(w * B);
      cv.height = Math.round(h * B);
    }
    const c = cv.getContext("2d");
    if (!c) return;
    c.setTransform(B, 0, 0, B, 0, 0);
    c.clearRect(0, 0, w, h);
    // ① 지도 — 그림이 있으면 깔고, 없으면 어두운 바탕.
    c.fillStyle = "#12161c";
    c.fillRect(0, 0, w, h);
    const im = imgRef.current;
    if (im) {
      c.globalAlpha = 0.85;
      c.drawImage(im, 0, 0, w, h);
      c.globalAlpha = 1;
    }
    /* ② 활동 네모 — 원작처럼 임자 색 점이다. 건물은 한 단 크게 찍어 무리와 갈린다.
       크기는 미니맵 폭에 비례해, 작은 미니맵에서도 뭉치지 않고 큰 데서도 안 성글다. */
    const uS = Math.max(1.5, w * 0.013);
    const bS = Math.max(2.5, w * 0.022);
    for (const d of dotsRef.current) {
      const s = d.wFrac !== undefined ? bS : uS;
      c.fillStyle = d.color;
      c.fillRect(d.fx * w - s / 2, d.fy * h - s / 2, s, s);
    }
    /* ③ 보고 있는 자리 — 흰 테두리 네모. 지도 밖으로는 안 나가게 죈다(창이 지도보다
       넓을 수 있다: 크롭이 한 축만 걸리는 비율에서 그렇다). */
    const vw = Math.min(1, view.w) * w;
    const vh = Math.min(1, view.h) * h;
    const vx = Math.max(0, Math.min(w - vw, view.cx * w - vw / 2));
    const vy = Math.max(0, Math.min(h - vh, view.cy * h - vh / 2));
    c.strokeStyle = "rgba(255,255,255,.92)";
    c.lineWidth = 1.5;
    c.strokeRect(vx + 0.75, vy + 0.75, Math.max(2, vw - 1.5), Math.max(2, vh - 1.5));
  }, [tick, view.cx, view.cy, view.w, view.h, dotsRef]);

  /* 끌어서 시점 옮기기 — 누른 자리가 곧 화면 한가운데다(원작과 같다). 포인터를
     잡아 두므로 미니맵 밖으로 손이 나가도 계속 따라온다. */
  const seekAt = (clientX: number, clientY: number): void => {
    const box = boxRef.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    onSeek(
      Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))),
      Math.max(0, Math.min(1, (clientY - r.top) / Math.max(1, r.height))),
    );
  };
  const dragRef = useRef(false);

  return (
    <div
      ref={boxRef}
      className="scr-fs-minimap"
      style={{ aspectRatio: `${ratio}` }}
      onPointerDown={(e) => {
        e.stopPropagation();
        dragRef.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        seekAt(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => { if (dragRef.current) seekAt(e.clientX, e.clientY); }}
      onPointerUp={() => { dragRef.current = false; }}
      onPointerCancel={() => { dragRef.current = false; }}
      role="presentation"
    >
      <canvas ref={cvRef} aria-hidden />
    </div>
  );
}
