import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn } from "lucide-react";
import { SHAPE_BUILDERS, SHAPE_GALLERY, ShapeIcon } from "../../components/replay/ReplayMotionPlayer";
import { withYaw, VIEW } from "../../utils/shapeOblique";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";

/* 자료실 > 모델링(요청) — 재생 화면의 3D 도형들을 큰 화면으로 살펴본다. 모두에게 열려
 * 있다(운영 아님). 전부 3D 빌더라 요잉(수평 시점)을 돌려 볼 수 있고, 전투 갈래
 * 기호(2D)는 회전 없이 기호 그대로다. */
/* 요잉 한 칸 15도(요청: "드래그 회전도 15도 단위 자동회전도 15도 단위") — 자동·드래그·
   키보드가 모두 이 한 값을 쓴다. 24방이라 16방(22.5도)보다 촘촘하고, 45도·90도 같은
   모델 요잉 보정값이 정확히 칸에 떨어져 검수할 때 각도를 맞추기 쉽다. */
const YAW_STEP = 15;
const snapYaw = (deg: number): number => Math.round(deg / YAW_STEP) * YAW_STEP;
/* 확대 배율 한계(요청: "휠이나 두손가락으로 줌") — 1배 아래로는 안 내려간다(무대가
   이미 모델 하나에 딱 맞는 크기다). 위로는 8배까지. */
const SCALE_MIN = 1;
const SCALE_MAX = 8;
const clampScale = (k: number): number => Math.min(SCALE_MAX, Math.max(SCALE_MIN, k));
/* 무대 색 고르기(요청) — 연두를 맨 위로 올려 두 테마 공통 기본색으로 쓴다(재재요청:
   스타 게임 컨셉과 맞음). 도록(시트)도 이 기본 연두로 찍는다. */
const STAGE_COLORS = ["#7ed491", "#f2f5f9", "#5ea2ff", "#ff6a5e", "#ffce54"];
const WHITE = "#f2f5f9";

export default function ModelGalleryScreen() {
  const [kind, setKind] = useState(SHAPE_GALLERY[0]?.kind ?? "");
  const [yaw, setYaw] = useState<number>(VIEW.yawDeg);
  const [color, setColor] = useState(STAGE_COLORS[0]);
  /* 돋보기 팝업(요청) — 무대의 돋보기를 누르면 최대 크기로 띄워 본다. 같은 faces를
     그대로 그려서 팝업 안에서도 자동 회전이 이어진다. */
  const [zoomed, setZoomed] = useState(false);
  // 실드 밖 탭(사이드바 등)도 닫기로 — 팝업 밖 어디를 눌러도 닫힌다.
  useLockBodyScroll(zoomed, () => setZoomed(false));
  useEffect(() => {
    if (!zoomed) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setZoomed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);
  /* 팝업 세로 가운데(지적: 그림이 너무 아래) — 모델은 뷰박스 바닥(y 16)에 서 있어
     팝업처럼 큰 판에선 위가 텅 빈다. 열릴 때 내용 bbox를 재서 그림 가운데가 판
     가운데에 오도록 svg를 올린다(모델이 바뀌면 다시 잰다). */
  const zoomBoxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!zoomed) return;
    const svg = zoomBoxRef.current?.querySelector("svg");
    if (!svg) return;
    try {
      const bb = (svg as SVGSVGElement).getBBox();
      const cy = bb.y + bb.height / 2;
      (svg as SVGSVGElement).style.transform = `translateY(${(((8 - cy) / 16) * 100).toFixed(1)}%)`;
    } catch { /* getBBox는 미부착 svg에서 던질 수 있다 — 그냥 바닥 정렬로 둔다. */ }
  }, [zoomed, kind]);
  /* 자동 회전도 15도 한 칸씩(요청) — 24방을 돌며 각 방향에서 잠깐 머문다. 칸이
     촘촘해진 만큼 머무는 시간도 줄여(650 → 460ms) 한 바퀴 도는 시간을 맞췄다. */
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return undefined;
    const id = window.setInterval(() => {
      setYaw((y) => (snapYaw(y) + YAW_STEP) % 360);
    }, 460);
    return () => window.clearInterval(id);
  }, [auto]);
  /* 수동 요잉은 키보드로(개편: 요잉 버튼 줄 제거) — ←/→가 한 칸(15도)씩 돌리고
     자동을 멈춘다. 화면 검증 스크립트도 이 키를 쓴다. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      setAuto(false);
      setYaw((y) => snapYaw(y) + (e.key === "ArrowRight" ? YAW_STEP : -YAW_STEP));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  /* 확대(요청: "휠이나 두손가락으로 줌 가능하게") — 무대와 돋보기 팝업 둘 다에서 먹는다.
     휠은 네이티브 리스너로 단다: 리액트의 onWheel은 루트에 패시브로 붙어 있어
     preventDefault가 먹지 않고, 그러면 확대할 때마다 페이지가 같이 스크롤된다. */
  const [scale, setScale] = useState(1);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // 모델을 바꾸면 배율을 되돌린다 — 8배로 본 채 다음 모델로 넘어가면 화면이 빈다.
  useEffect(() => { setScale(1); }, [kind]);
  useEffect(() => {
    const els = [stageRef.current, zoomBoxRef.current].filter(Boolean) as HTMLElement[];
    if (!els.length) return undefined;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      // deltaMode 1(줄 단위)·2(쪽 단위) 휠도 픽셀로 환산해 기기별 감도를 맞춘다.
      const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      setScale((k) => clampScale(k * Math.exp(-px * 0.0016)));
    };
    els.forEach((el) => el.addEventListener("wheel", onWheel, { passive: false }));
    return () => els.forEach((el) => el.removeEventListener("wheel", onWheel));
  }, [zoomed]);
  /* 좌우 드래그로 돌리기(요청) — 무대(와 돋보기 팝업)를 손가락·마우스로 끌면 끈
     거리만큼 요잉이 돈다. 끄는 순간 자동 회전은 멈춘다. 1픽셀당 0.5도로 끌되 화면에
     내보내는 각도는 15도 칸에 붙인다(요청: "드래그 회전도 15도 단위") — 끈 거리는
     rawRef에 실수로 쌓아 두어야 칸을 넘길 때 튀지 않고 이어진다.
     손가락 둘이면 회전 대신 확대다(요청: 두 손가락 줌) — 두 점 사이 거리 비를 배율에
     그대로 곱한다. 눌린 포인터를 Map에 모아 두는 이유가 이것이다. */
  const ptsRef = useRef(new Map<number, number>());
  const dragRef = useRef<{ id: number; x: number } | null>(null);
  const rawYawRef = useRef(yaw);
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);
  const twoFingerDist = (): number => {
    const xs = Array.from(ptsRef.current.values());
    return xs.length >= 2 ? Math.abs(xs[0] - xs[1]) : 0;
  };
  const dragProps = {
    style: { touchAction: "none" as const, cursor: "ew-resize" as const },
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>): void => {
      /* 무대 안 버튼은 건드리지 않는다(지적: 돋보기 버튼이 안 먹힘) — 무대가
         setPointerCapture로 포인터를 가져가면 그 뒤 click이 버튼에 안 닿는다.
         버튼 위에서 시작한 누름은 끌기로 안 잡는다. */
      if ((e.target as HTMLElement).closest("button")) return;
      ptsRef.current.set(e.pointerId, e.clientX);
      setAuto(false);
      e.currentTarget.setPointerCapture(e.pointerId);
      if (ptsRef.current.size >= 2) {
        dragRef.current = null;
        pinchRef.current = { dist: Math.max(1, twoFingerDist()), scale };
        return;
      }
      rawYawRef.current = yaw;
      dragRef.current = { id: e.pointerId, x: e.clientX };
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>): void => {
      if (!ptsRef.current.has(e.pointerId)) return;
      ptsRef.current.set(e.pointerId, e.clientX);
      const pin = pinchRef.current;
      if (pin && ptsRef.current.size >= 2) {
        const d = twoFingerDist();
        if (d > 0) setScale(clampScale((pin.scale * d) / pin.dist));
        return;
      }
      const d = dragRef.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      if (dx === 0) return;
      d.x = e.clientX;
      rawYawRef.current += dx * 0.5;
      setYaw(snapYaw(rawYawRef.current));
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>): void => {
      ptsRef.current.delete(e.pointerId);
      if (ptsRef.current.size < 2) pinchRef.current = null;
      if (dragRef.current?.id === e.pointerId) dragRef.current = null;
    },
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>): void => {
      ptsRef.current.delete(e.pointerId);
      pinchRef.current = null;
      dragRef.current = null;
    },
  };
  /* 배율을 입히는 겉옷 — svg에 직접 걸지 않는다. 팝업의 세로 가운데 맞춤이 svg의
     transform을 이미 쓰고 있어 서로 덮어쓴다. */
  const scaleStyle = scale === 1 ? undefined : { transform: `scale(${scale.toFixed(3)})` };
  const builder: (() => ReturnType<(typeof SHAPE_BUILDERS)[string]>) | undefined =
    Object.prototype.hasOwnProperty.call(SHAPE_BUILDERS, kind) ? SHAPE_BUILDERS[kind] : undefined;
  const faces = useMemo(
    () => (builder ? withYaw(yaw, () => builder()) : undefined),
    [builder, yaw],
  );
  return (
    <div className="scr-screen scr-model-screen">
      {/* 이름은 짧게 '모델'(요청) — 제목 아래 갭도 화면 전용 CSS로 줄였다. */}
      <div className="scr-v2-toolbar scr-model-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">모델</h1>
      </div>
      <div className="scr-minimap-panel">
        <div className="scr-model-viewer">
          {/* 조작부 개편(요청: 버튼 줄 제거) — 각도는 무대 우상단, 멈춤·재생은 무대
              우하단 오버레이. 수동 회전은 ←/→ 키. */}
          {/* 라이트 테마 대비(요청) — 흰 모델일 땐 무대에 어두운 배경을 깔아 형태가
              밝은 판에 묻히지 않게 한다(다크 테마에선 어차피 어두워 표시 없음). */}
          <div
            ref={stageRef}
            className={color === WHITE ? "scr-model-stage scr-model-stage-dark" : "scr-model-stage"}
            {...dragProps}
            /* 확대했을 때만 무대가 자른다 — 평소엔 키 큰 모델이 위로 삐져도 보여야 한다. */
            style={{ color, ...dragProps.style, ...(scale === 1 ? null : { overflow: "hidden" }) }}
          >
            <span className="scr-model-scaler" style={scaleStyle}>
              <ShapeIcon kind={kind} faces={faces} />
            </span>
            {builder && (
              <>
                <span className="scr-model-yaw">
                  {Math.round(((yaw % 360) + 360) % 360)}°{scale === 1 ? "" : ` · ×${scale.toFixed(1)}`}
                </span>
                {/* 돋보기(요청) — 무대 좌상단, 누르면 최대 크기 팝업. */}
                <button
                  type="button" className="scr-model-zoom-btn" aria-label="크게 보기"
                  onClick={() => setZoomed(true)}
                >
                  <ZoomIn size={15} />
                </button>
              </>
            )}
          </div>
          {/* 버튼 좌우 정렬(요청: 공간이 넓으니) — 무대 밖 뷰어 양 끝에 앉힌다. 색
              견본은 왼 끝 세로줄, 멈춤은 오른 끝. 무대가 좁은 화면에선 그대로 곁이다. */}
          {builder && (
            <>
              <span className="scr-model-colors">
                {STAGE_COLORS.map((c) => (
                  <button
                    key={c} type="button" aria-label={`색 ${c}`}
                    className={c === color ? "scr-model-swatch scr-model-swatch-on" : "scr-model-swatch"}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </span>
              <button
                type="button" className="scr-model-pause"
                aria-label={auto ? "멈춤" : "자동 회전"}
                onClick={() => setAuto((a) => !a)}
              >
                {auto ? "❚❚" : "▶"}
              </button>
            </>
          )}
        </div>
        <div className="scr-model-list">
          {(["유닛", "건물"] as const).map((grp) => (
            <div key={grp}>
              <div className="scr-model-group-title">{grp}</div>
              <div className="scr-model-gallery">
                {SHAPE_GALLERY.filter((g) => g.group === grp).map(({ kind: k, label }) => (
                  <button
                    key={k} type="button"
                    className={k === kind ? "scr-model-item scr-model-item-on" : "scr-model-item"}
                    onClick={() => {
                      setKind(k); setYaw(snapYaw(VIEW.yawDeg)); rawYawRef.current = VIEW.yawDeg;
                      setAuto(true);
                    }}
                  >
                    <span className="scr-model-thumb"><ShapeIcon kind={k} /></span>
                    <span className="scr-model-label">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* 최대 크기 팝업(요청) — 어두운 라이트박스 위에 같은 faces로 그려 회전이 이어진다.
          배경을 항상 어둡게 두어 어느 테마·어느 색이든 모델이 산다. body 포털(수리:
          조상 transform이 fixed를 가둬 사이드바를 못 덮었고, 실드가 클릭을 삼켰다). */}
      {zoomed && builder && createPortal(
        <div className="scr-model-zoom-pop" onClick={() => setZoomed(false)}>
          <div
            ref={zoomBoxRef} className="scr-model-zoom-box"
            {...dragProps}
            style={{ color, ...dragProps.style }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="scr-model-scaler" style={scaleStyle}>
              <ShapeIcon kind={kind} faces={faces} />
            </span>
            <span className="scr-model-yaw">
              {Math.round(((yaw % 360) + 360) % 360)}°{scale === 1 ? "" : ` · ×${scale.toFixed(1)}`}
            </span>
            <button
              type="button" className="scr-model-zoom-close" aria-label="닫기"
              onClick={() => setZoomed(false)}
            >
              <X size={18} />
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
