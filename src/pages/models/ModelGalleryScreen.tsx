import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn } from "lucide-react";
import {
  SHAPE_BUILDERS, SHAPE_GALLERY, ShapeIcon, shapeMapTiles, autoTier,
} from "../../components/replay/ReplayMotionPlayer";
import { withYaw, VIEW, lodFilter, bake, type ShapeFace } from "../../utils/shapeOblique";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import PillTabs from "../../components/common/PillTabs";

/* 자료실 > 모델링(요청) — 재생 화면의 3D 도형들을 큰 화면으로 살펴본다. 모두에게 열려
 * 있다(운영 아님). 전부 3D 빌더라 요잉(수평 시점)을 돌려 볼 수 있고, 전투 갈래
 * 기호(2D)는 회전 없이 기호 그대로다. */
/* 요잉 한 칸 15도(요청: "드래그 회전도 15도 단위 자동회전도 15도 단위") — 자동·드래그·
   키보드가 모두 이 한 값을 쓴다. 24방이라 16방(22.5도)보다 촘촘하고, 45도·90도 같은
   모델 요잉 보정값이 정확히 칸에 떨어져 검수할 때 각도를 맞추기 쉽다. */
const YAW_STEP = 15;
const snapYaw = (deg: number): number => Math.round(deg / YAW_STEP) * YAW_STEP;
/* 확대 배율 한계(요청: "휠이나 두손가락으로 줌") — 위로 8배까지 키운다.
   아래로도 같은 폭만큼 연다(요청: "갤러리에서 기본보다 줌아웃도 되게해줘 확대
   배율만큼") — 여태 1배가 바닥이라 기본보다 작게는 못 봤는데, 애드온을 단 건물이나
   울트라처럼 큰 모델은 무대를 꽉 채워 실루엣 전체를 한눈에 보기 어려웠다.
   1/8배까지 열어 두면 확대·축소가 기본배율을 가운데 두고 대칭이 된다. */
const SCALE_MAX = 8;
const SCALE_MIN = 1 / SCALE_MAX;
const clampScale = (k: number): number => Math.min(SCALE_MAX, Math.max(SCALE_MIN, k));
/* 무대 색 고르기(요청) — 연두를 맨 위로 올려 두 테마 공통 기본색으로 쓴다(재재요청:
   스타 게임 컨셉과 맞음). 도록(시트)도 이 기본 연두로 찍는다. */
const STAGE_COLORS = ["#7ed491", "#f2f5f9", "#5ea2ff", "#ff6a5e", "#ffce54"];
/* (걷어냄) WHITE — 무대에서 흰 모델일 때만 어두운 배경을 깔던 판정의 열쇠였다.
   무대를 걷으면서(요청) 쓸 데가 없어졌다. 확대창은 늘 어두운 라이트박스다. */
/* 지도상 크기의 기준 자(타일, 요청: "지도상 크기 토글") — 도록에서 가장 큰 상자가 무대를
   꽉 채우도록 그 값을 1로 삼는다. 기준을 도록 전체의 최대로 잡는 것이 핵심이다: 모델마다
   제각각 기준을 두면 '상대 크기'가 안 되고, 고정 상수로 두면 나중에 큰 모델이 하나
   들어올 때 무대 밖으로 나간다. */
const MAP_REF_TILES = Math.max(...SHAPE_GALLERY.map(({ kind }) => shapeMapTiles(kind)));
/* 썸네일은 형체(저)만 그린다(수리: 모델 페이지가 느리다) — 실측으로 도록 목록의
   <path>가 30,537개였다(99종 × 평균 309면). 44px 썸네일에 3티어 장식까지 얹는 것은
   지도에서도 안 하는 일이다(크기가 정하는 자동 강등에 걸린다). 형체만 남기면 11,367개로
   63% 줄고, 그림은 그 크기에서 사실상 같다. 모듈에서 한 번만 굽고 모두가 나눠 쓴다. */
const THUMB_FACES: Record<string, ShapeFace[]> = Object.fromEntries(
  SHAPE_GALLERY
    .filter(({ kind }) => Object.prototype.hasOwnProperty.call(SHAPE_BUILDERS, kind))
    .map(({ kind }) => [kind, lodFilter(autoTier(kind, `thumb|${kind}`, bake(SHAPE_BUILDERS[kind])), 1)]),
);


/** 도록의 칸 하나(요청: 칸마다 끌어 돌리고 돋보기로 크게) — 면·선택·색·배수가 그대로면
 *  다시 안 그린다. 손잡이는 부모가 안정된 참조로 넘긴다. */
const GalleryCell = memo(function GalleryCell({
  kind, label, faces, on, color, mapK, onSelect, onZoom, onDown, onMove, onUp, onHover,
}: {
  kind: string; label: string; faces: ShapeFace[] | undefined; on: boolean;
  color: string; mapK: number;
  onSelect: (k: string) => void;
  onZoom: (k: string) => void;
  onDown: (k: string, e: React.PointerEvent<HTMLDivElement>) => void;
  onMove: (k: string, e: React.PointerEvent<HTMLDivElement>) => void;
  onUp: () => void;
  onHover: (k: string) => void;
}) {
  return (
    <div
      className={on ? "scr-model-item scr-model-item-on" : "scr-model-item"}
      style={{ color }}
      onPointerDown={(e) => onDown(kind, e)}
      onPointerMove={(e) => onMove(kind, e)}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerEnter={() => onHover(kind)}
      onClick={() => onSelect(kind)}
      role="presentation"
    >
      <span className="scr-model-thumb">
        {/* 인게임이면 공통 창 + 배수(서로 얼마나 큰지), 최대면 잉크에 창을 맞춘다
            (요청: "최대는 진짜 최대야 — 패딩만 빼고 최대로 채우기"). */}
        {mapK !== 1 ? (
          <span className="scr-model-thumb-scaler" style={{ transform: `scale(${mapK.toFixed(4)})` }}>
            <ShapeIcon kind={kind} faces={faces} wide />
          </span>
        ) : <ShapeIcon kind={kind} faces={faces} fit />}
      </span>
      <span className="scr-model-cellbtns">
        <button
          type="button" className="scr-model-cellbtn" aria-label={`${label} 크게 보기`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onZoom(kind); }}
        >
          <ZoomIn size={12} />
        </button>
      </span>
      <span className="scr-model-label">{label}</span>
    </div>
  );
});

export default function ModelGalleryScreen() {
  const [kind, setKind] = useState(SHAPE_GALLERY[0]?.kind ?? "");
  const [yaw, setYaw] = useState<number>(VIEW.yawDeg);
  const [color, setColor] = useState(STAGE_COLORS[0]);
  /* 지도상 크기(요청: 토글) — 끄면 여태처럼 모델마다 무대를 꽉 채워(디자인 검수: "모든
     모델이 제 상자를 같은 몫으로 채우는가"), 켜면 지도에서 서로 얼마나 큰지 그대로다.
     이 둘은 서로 다른 물음이라 한 화면에서 갈아 끼울 수 있어야 한다 — 여태 도록은 앞의
     물음밖에 못 물었다. */
  const [mapSize, setMapSize] = useState(false);
  /* 사양별 보기(요청: 저/중/고 라디오) — 값이 곧 부품 등급(LOD) 상한이라 재생기의 성능
     라디오와 같은 눈금이다: 1 저=형체만 · 2 중=+포인트 · 3 고=+장식.
     여기서 보는 것은 "사양을 내리면 이 모델이 무엇을 잃는가"다 — 개인색 면은 어느 등급
     에서도 하나는 남게 되어 있어(lodFilter 주석) 저에서도 임자를 알아볼 수 있어야 한다. */
  const [quality, setQuality] = useState(3);
  /* 돋보기 팝업(요청) — 칸의 돋보기를 누르면 최대 크기로 띄워 본다. 자동 회전도
     이 창에서만 돈다(요청: "자동재생은 확대창 열었을때만"). */
  const [zoomed, setZoomed] = useState(false);
  /* 칸마다 제 요잉(요청: "회전과 확대 버튼을 모든 칸에 넣고") — 무대를 걷어냈으므로
     돌려 보는 자리는 칸 자신이다. 손대지 않은 칸은 기본 각의 미리 구운 면(THUMB_FACES)을
     그대로 쓰고, 돌린 칸만 그때그때 굽는다 — 목록 전체를 다시 굽지 않는다. */
  const [thumbYaw, setThumbYaw] = useState<Record<string, number>>({});
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
    // 자동 회전은 확대창에서만 돈다(요청) — 목록만 있는 화면에서 460ms마다 다시 그릴 이유가 없다.
    if (!auto || !zoomed) return undefined;
    const id = window.setInterval(() => {
      setYaw((y) => (snapYaw(y) + YAW_STEP) % 360);
    }, 460);
    return () => window.clearInterval(id);
  }, [auto, zoomed]);
  /* 수동 요잉은 키보드로(개편: 요잉 버튼 줄 제거) — ←/→가 한 칸(15도)씩 돌리고
     자동을 멈춘다. 화면 검증 스크립트도 이 키를 쓴다. */
  /* ←/→ 키가 PC의 회전이다(지적: "피시에서는 전의 좌우 커서가 더 좋았어 손보다") —
     무대를 걷으면서 이 키가 갈 곳이 없어졌었다. 이제 **고른 칸**을 돌리고, 확대창이
     열려 있으면 그 창의 모델을 돌린다(끌기는 손가락용으로 그대로 둔다). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      setAuto(false);
      const d9 = e.key === "ArrowRight" ? YAW_STEP : -YAW_STEP;
      if (zoomedRef.current) {
        setYaw((y) => snapYaw(y) + d9);
        rawYawRef.current = snapYaw(rawYawRef.current) + d9;
        return;
      }
      const k9 = hoverRef.current || kindRef.current;
      if (!k9) return;
      setThumbYaw((m) => ({ ...m, [k9]: snapYaw((m[k9] ?? VIEW.yawDeg) + d9) }));
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
  /* 지도상 크기 배수 — **균일**이다(수리: 켜면 납작해 보임). 지도가 유닛도 건물도
     정사각 상자에 균일 배율로 굽기 때문이다(shapeMapTiles 주석). 사용자의 휠 확대
     (scale)와는 곱해진다: 지도 비율을 켠 채로도 들여다볼 수 있어야 한다. */
  const mapK = useMemo(
    () => (mapSize ? shapeMapTiles(kind) / MAP_REF_TILES : 1),
    [mapSize, kind],
  );
  /* 배율을 입히는 겉옷 — svg에 직접 걸지 않는다. 팝업의 세로 가운데 맞춤이 svg의
     transform을 이미 쓰고 있어 서로 덮어쓴다. */
  const scaleStyle = scale === 1 && !mapSize ? undefined
    : { transform: `scale(${(scale * mapK).toFixed(4)})` };
  /* 배율 표시 — 1배 미만은 소수 한 자리로는 0.1로 뭉개져 1/8과 1/4이 구분되지 않는다. */
  const scaleLabel = scale === 1 ? "" : ` · ×${scale < 1 ? scale.toFixed(2) : scale.toFixed(1)}`;
  const builder: (() => ReturnType<(typeof SHAPE_BUILDERS)[string]>) | undefined =
    Object.prototype.hasOwnProperty.call(SHAPE_BUILDERS, kind) ? SHAPE_BUILDERS[kind] : undefined;
  /* 지도와 **같은 순서**로 거른다(요청: 사양별 보기) — autoTier가 부품 크기로 등급을
     먼저 매기고, 그다음 lodFilter가 상한까지 남긴다. 갈무리 열쇠는 종류+요잉이면 족하다:
     도록은 늘 사선 시점 한 가지이고, 등급 상한은 거르는 쪽이라 열쇠에 안 든다. */
  const faces = useMemo(
    () => (builder
      ? lodFilter(autoTier(kind, `g|${kind}|${snapYaw(yaw)}`, bake(() => withYaw(yaw, () => builder()))), quality)
      : undefined),
    [builder, kind, yaw, quality],
  );
  /* 손잡이 두 개를 한 벌로 만들어 두 자리가 나눠 쓴다(요청: 확대창에도 똑같이) —
     무대 아래 줄과 확대창 우하단이 같은 값을 만지므로, 둘로 베껴 두면 반드시 갈라진다. */
  const optsNode = (
    <>
          <span className="scr-model-opt">
            {/* 라벨 "크기" · 값 최대/인게임(요청) — "지도상 크기 끔"은 무엇이 켜지는지를
                안 말한다. 두 값에 각자 이름을 주면 토글이 곧 물음의 두 답이 된다:
                최대=제 상자를 꽉 채운 그림 · 인게임=지도에서 서로 얼마나 큰지. */}
            <span className="scr-model-opt-label">크기</span>
            <PillTabs
              options={[{ value: "max", label: "최대" }, { value: "map", label: "인게임" }]}
              toggle
              value={mapSize ? "map" : "max"}
              onChange={(v) => setMapSize(v === "map")}
              aria-label="크기"
            />
          </span>
          <span className="scr-model-opt">
            <span className="scr-model-opt-label">사양</span>
            <PillTabs
              options={[
                { value: "1", label: "저" }, { value: "2", label: "중" }, { value: "3", label: "고" },
              ]}
              value={String(quality)}
              onChange={(v) => setQuality(Number(v))}
              aria-label="사양"
              fit
            />
          </span>
    </>
  );
  /* 목록은 고른 종류가 바뀔 때만 다시 만든다(수리: 반응이 느리다) — 자동 회전이
     460ms마다 yaw를 갈아 화면 전체가 다시 그려지는데, 그때마다 썸네일 수만 개 노드를
     React가 통째로 맞추고 있었다. 목록은 요잉·배율·사양과 아무 상관이 없다. */
  /* 칸 끌기(요청) — 칸마다 제 요잉을 끌어 돌린다. 끌던 중이면 클릭은 선택으로 안 센다.
     손잡이는 전부 **안정된 참조**여야 한다(위 GalleryCell의 memo가 그것으로 갈린다) —
     그래서 지금 요잉은 상태가 아니라 ref로 읽는다. */
  const cellDragRef = useRef<{ k: string; x: number; base: number } | null>(null);
  const cellMovedRef = useRef(false);
  const thumbYawRef = useRef<Record<string, number>>({});
  thumbYawRef.current = thumbYaw;
  // 키 손잡이가 최신 값을 읽는 창구 — 이벤트는 한 번만 달고 안 다시 단다.
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const zoomedRef = useRef(zoomed);
  zoomedRef.current = zoomed;
  /* ←/→ 는 **마우스가 얹힌 칸**을 먼저 돌린다(요청: "목록에서도 좌우 커서") — 안 그러면
     칸마다 한 번씩 눌러 고른 뒤에야 돌릴 수 있어, 끌기보다 손이 더 간다. 얹힌 칸이
     없으면 고른 칸으로 떨어진다. 다시 그릴 일이 없으니 상태가 아니라 ref다. */
  const hoverRef = useRef("");
  const onCellHover = useCallback((k: string) => { hoverRef.current = k; }, []);
  const onCellDown = useCallback((k: string, e: React.PointerEvent<HTMLDivElement>) => {
    /* 칸 안의 버튼 위에서는 끌기를 아예 안 잡는다(지적: "확대창 안뜸") — 여기서
       setPointerCapture를 걸면 그 뒤의 pointerup·click이 칸으로 가로채여 돋보기
       버튼의 click이 영영 안 뜬다. */
    if ((e.target as HTMLElement).closest("button")) return;
    cellDragRef.current = { k, x: e.clientX, base: thumbYawRef.current[k] ?? VIEW.yawDeg };
    cellMovedRef.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);
  const onCellMove = useCallback((k: string, e: React.PointerEvent<HTMLDivElement>) => {
    const d9 = cellDragRef.current;
    if (!d9 || d9.k !== k) return;
    const dx9 = e.clientX - d9.x;
    /* 감도 0.8 → 3도/픽셀(지적: "감도가 너무 약한거 같아 공간이 좁은데") — 칸이 100px
       남짓이라 0.8도로는 한 칸을 다 끌어도 80도밖에 안 돌았다. 3도면 5픽셀에 한 칸
       (15도)이 돈다. 문턱도 3 → 2픽셀. */
    if (Math.abs(dx9) < 2) return;
    cellMovedRef.current = true;
    setThumbYaw((m) => ({ ...m, [k]: snapYaw(d9.base + dx9 * 3) }));
  }, []);
  const onCellUp = useCallback(() => { cellDragRef.current = null; }, []);
  const onCellSelect = useCallback((k: string) => {
    if (!cellMovedRef.current) setKind(k);
  }, []);
  const onCellZoom = useCallback((k: string) => {
    setKind(k);
    const y9 = thumbYawRef.current[k] ?? VIEW.yawDeg;
    setYaw(snapYaw(y9));
    rawYawRef.current = y9;
    setScale(1);
    setAuto(true);
    setZoomed(true);
  }, []);
  /** 그 칸의 면 — 돌린 칸만 새로 굽고, 한 번 구운 각은 갈무리해 둔다(끌 때 같은 각을
   *  오가도 다시 안 굽는다: 24방뿐이라 몇 번 끌면 그 종류는 전부 캐시에 든다). */
  const thumbBakeRef = useRef(new Map<string, ShapeFace[]>());
  const thumbFacesOf = (k: string): ShapeFace[] | undefined => {
    const y9 = thumbYaw[k];
    if (y9 === undefined) return THUMB_FACES[k];
    const key9 = `${k}|${snapYaw(y9)}`;
    const hit9 = thumbBakeRef.current.get(key9);
    if (hit9) return hit9;
    const b9 = Object.prototype.hasOwnProperty.call(SHAPE_BUILDERS, k) ? SHAPE_BUILDERS[k] : undefined;
    if (!b9) return THUMB_FACES[k];
    const f9 = lodFilter(autoTier(k, `thumb|${key9}`, bake(() => withYaw(y9, b9))), 1);
    if (thumbBakeRef.current.size > 400) thumbBakeRef.current.clear();
    thumbBakeRef.current.set(key9, f9);
    return f9;
  };
  /* 칸 하나만 다시 그린다(지적: "드래그 회전이 뭔가 반응이 느리고") — 목록이 통째로
     memo돼 있어 요잉 하나가 바뀔 때마다 99칸(각 200~300 <path>)을 React가 전부 맞췄다.
     칸을 memo 부품으로 떼면 면(faces)이 그대로인 칸은 건너뛴다 — 끄는 칸만 새로 그린다.
     그래서 손잡이(콜백)들은 전부 안정된 참조여야 한다(아래 useCallback). */
  const listNode = useMemo(() => (
        <div className="scr-model-list">
            {(["유닛", "건물"] as const).map((grp) => (
              <div key={grp}>
                <div className="scr-model-group-title">{grp}</div>
                <div className="scr-model-gallery" onPointerLeave={() => { hoverRef.current = ""; }}>
                  {SHAPE_GALLERY.filter((g) => g.group === grp).map(({ kind: k, label }) => (
                    <GalleryCell
                      key={k} kind={k} label={label}
                      faces={thumbFacesOf(k)}
                      on={k === kind}
                      color={color}
                      mapK={mapSize ? shapeMapTiles(k) / MAP_REF_TILES : 1}
                      onSelect={onCellSelect}
                      onZoom={onCellZoom}
                      onDown={onCellDown}
                      onMove={onCellMove}
                      onUp={onCellUp}
                      onHover={onCellHover}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
  ), [kind, mapSize, thumbYaw, color]);
  return (
    <div className="scr-screen scr-model-screen">
      {/* 이름은 짧게 '모델'(요청) — 제목 아래 갭도 화면 전용 CSS로 줄였다. */}
      <div className="scr-v2-toolbar scr-model-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">모델</h1>
      </div>
      <div className="scr-minimap-panel">
        {/* 무대는 걷었다(요청: "갤러리 무대 제거하고 색이랑 옵션 탭만 윗줄에 남김") —
            칸마다 끌어 돌리고 돋보기로 크게 보므로, 한 종류만 크게 걸어 두는 무대가
            목록의 자리를 먹고 있었다. 윗줄에는 색 견본과 손잡이 둘만 남는다. */}
        <div className="scr-model-opts scr-model-opts-top">
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
          {optsNode}
        </div>
        {listNode}
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
              <ShapeIcon kind={kind} faces={faces} wide={mapSize} fit={!mapSize} />
            </span>
            <span className="scr-model-yaw">
              {Math.round(((yaw % 360) + 360) % 360)}°{scaleLabel}
            </span>
            <button
              type="button" className="scr-model-zoom-close" aria-label="닫기"
              onClick={() => setZoomed(false)}
            >
              <X size={18} />
            </button>
            {/* 자동 회전은 이 창의 것이다(요청) — 멈춤·재생도 여기 둔다. */}
            <button
              type="button" className="scr-model-pause"
              aria-label={auto ? "멈춤" : "자동 회전"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setAuto((a) => !a); }}
            >
              {auto ? "❚❚" : "▶"}
            </button>
            {/* 같은 손잡이 두 개(요청) — 확대창 우하단. 팝업 안에서도 지도 크기와 사양을
                바꿔 가며 볼 수 있어야 한다. 손짓(끌기·줌)이 무대에 잡혀 있으므로 눌림은
                여기서 끊는다 — 안 끊으면 라디오를 누르는 순간 모델이 같이 돈다. */}
            <div
              className="scr-model-opts scr-model-opts-zoom"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {optsNode}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
