import { useEffect, useRef, useState } from "react";
import { cx } from "../../utils/format";
import { getScrollRoot, getScrollMetrics, addRafScrollListener, scrollRootTo } from "../../utils/scrollRoot";
import { isBodyScrollLocked } from "../../utils/bodyScrollLock";

// 트랙에 찍는 눈금 하나 — 특정 날짜 그룹(groupSelector)의 스크롤 위치에 짧은 가로선/라벨을
// 얹는다. className이 그 모양(오늘/미정 등)을 CSS로 정한다.
export interface TimelineMarker {
  key: string;
  className: string;
  groupSelector: string;
}

interface ScrollNavTimelineProps {
  // 현재 위치 라벨(알약)을 뽑을 스티키 날짜 헤더들의 셀렉터. 각 헤더는 data-date-label을 가진다.
  headSelector: string;
  // 트랙 위/아래 끝 라벨(예: 너나와=과거/미래, 경기=최근/과거).
  topLabel: string;
  bottomLabel: string;
  // 선택: 오늘/미정 같은 특별 눈금(너나와 전용). 없으면 안 그린다.
  markers?: TimelineMarker[];
}

// 목록 우측의 네비게이션 타임라인 — 스크롤 위치(0~1)를 세로 축에 매핑해 현재 위치를 보여주고,
// 트랙을 드래그/탭하면 그 지점으로 바로 이동한다(스크럽). 스크롤하는 동안에만 떴다 사라진다.
// 너 나와(과거→미래)와 경기 목록(최근→과거) 양쪽에서 라벨/눈금만 바꿔 함께 쓴다.
export default function ScrollNavTimeline({ headSelector, topLabel, bottomLabel, markers }: ScrollNavTimelineProps) {
  const [visible, setVisible] = useState(false);
  const [scrollable, setScrollable] = useState(false);
  const [fraction, setFraction] = useState(0);
  const [markerFractions, setMarkerFractions] = useState<Record<string, number | null>>({});
  const [dateLabel, setDateLabel] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  // 지금 스크럽 중인 손가락의 식별자 — 드래그 도중 다른 손가락이 닿아도 안 흔들리게.
  const touchIdRef = useRef<number | null>(null);
  // 무한스크롤로 문서가 길어진 직후인지 — 그때만 thumb/날짜 알약을 애니메이션으로 옮긴다.
  // 피드는 바닥에 닿을 때마다 한 페이지(100건)를 이어붙이는데, thumb 위치는
  // scrollTop/(문서높이-뷰포트)라 그 순간 분모가 확 커지며 위치가 뚝 떨어진다 —
  // 스크롤은 그대로인데 thumb만 위로 도약했다가 계속 스크롤하면 되돌아오는 게 "튐"의
  // 정체다(측정 방식 문제가 아니라 무한스크롤 구조 자체의 성질이라, 계산부를 아무리
  // 고쳐도 남아 있었다). 도약 자체는 의미상 맞으므로 없애지 않고, 그 순간에만 짧게
  // 미끄러지게 해서 눈에 튀지 않게 한다. 평상시 스크롤엔 트랜지션이 없어 지연이 없다.
  const [settling, setSettling] = useState(false);
  const lastScrollHeightRef = useRef(0);
  const settleTimerRef = useRef<number | null>(null);

  // 지금 상단에 스티키로 핀된 날짜 헤더의 라벨 — 현재 위치를 "며칠"인지로 보여준다.
  // atBottom이면(더 스크롤할 여지가 없는 맨 끝) 마지막 헤더를 그냥 그대로 쓴다 — 마지막
  // 그룹의 카드 수가 적어 그 헤더가 화면 맨 위(top<=6)까지 밀려 올라올 만큼 스크롤할 거리
  // 자체가 없으면(뒤에 남는 여백뿐이면), 아래 top<=6 조건이 그 헤더를 영영 못 만나 한 칸
  // 전 날짜에 멈춰 있었다(실제로 지적받은 문제 — "타임라인에 마지막 경기 날짜는 안 나와").
  const currentDateLabel = (atBottom: boolean): string | null => {
    const heads = Array.from(document.querySelectorAll<HTMLElement>(headSelector));
    if (heads.length === 0) return null;
    if (atBottom) return heads[heads.length - 1].dataset.dateLabel ?? null;
    const root = getScrollRoot();
    const topY = root instanceof Window ? 0 : root.getBoundingClientRect().top;
    let current: string | null = heads[0].dataset.dateLabel ?? null;
    for (const h of heads) {
      if (h.getBoundingClientRect().top - topY <= 6) current = h.dataset.dateLabel ?? current;
      else break;
    }
    return current;
  };

  // 특정 날짜 그룹(selector)의 스크롤 위치를 0~1로 — 트랙에 눈금을 찍는 데 쓴다. thumb
  // (현재 위치 점)와 같은 척도(scrollTop/max, "실제로 스크롤 가능한 이동 거리" 기준)를
  // 써야, 스크롤이 실제로 이 그룹에 멈췄을 때 thumb과 눈금이 같은 위치를 가리킨다(요청:
  // "thumb과 오늘 눈금이 같은 %를 안 가리킴" — 한때 분모를 scrollHeight로 바꿔봤지만
  // 그러면 thumb과 척도가 달라져 실제로 멈춘 자리와 눈금 위치가 어긋나 보였다).
  const groupFraction = (selector: string, scrollTop: number, max: number): number | null => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el || max <= 0) return null;
    const root = getScrollRoot();
    const rootTop = root instanceof Window ? 0 : root.getBoundingClientRect().top;
    const offset = scrollTop + (el.getBoundingClientRect().top - rootTop);
    return Math.min(1, Math.max(0, offset / max));
  };

  const update = () => {
    const { scrollTop, clientHeight, scrollHeight } = getScrollMetrics();
    // 문서 길이가 바뀌었으면(=페이지가 이어붙었으면) 잠깐 애니메이션 모드로 둔다.
    if (lastScrollHeightRef.current && scrollHeight !== lastScrollHeightRef.current) {
      setSettling(true);
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => setSettling(false), 340);
    }
    lastScrollHeightRef.current = scrollHeight;
    // iOS 사파리는 아래로 스크롤하면 주소창/툴바가 접히며 실제 보이는 뷰포트가 커지는데
    // documentElement.clientHeight는 접히기 전(작은) 레이아웃 뷰포트를 반환할 때가 있어
    // max = scrollHeight - clientHeight가 실제보다 커진다 → 페이지 끝까지 내려도
    // scrollTop/max < 1이라 thumb이 바닥에 못 닿고 살짝 위에 머문다(지적된 문제).
    // 접힌 상태를 반영하는 innerHeight와 더 큰 값을 써서 max를 실제 바닥에 맞춘다.
    const vh = Math.max(clientHeight, window.innerHeight || 0);
    const max = scrollHeight - vh;
    setScrollable(max > 40);
    setFraction(max > 0 ? Math.min(1, Math.max(0, scrollTop / max)) : 0);
    setDateLabel(currentDateLabel(max <= 0 || scrollTop >= max - 2));
    if (markers && markers.length > 0) {
      const next: Record<string, number | null> = {};
      for (const m of markers) next[m.key] = groupFraction(m.groupSelector, scrollTop, max);
      setMarkerFractions(next);
    }
  };

  const showThenScheduleHide = () => {
    setVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (!draggingRef.current) setVisible(false);
    }, 1100);
  };

  useEffect(() => {
    const onScroll = () => { update(); showThenScheduleHide(); };
    const off = addRafScrollListener(onScroll);
    update();
    return () => {
      off();
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headSelector]);

  // 지금 스크롤 위치를 0~1로 — update()와 같은 척도를 쓴다(드래그 시작점 기준값).
  const currentFraction = (): number => {
    const { scrollTop, clientHeight, scrollHeight } = getScrollMetrics();
    const vh = Math.max(clientHeight, window.innerHeight || 0);
    const max = scrollHeight - vh;
    return max > 0 ? Math.min(1, Math.max(0, scrollTop / max)) : 0;
  };

  // 스크럽은 손가락의 '절대 위치'가 아니라 '잡은 뒤 움직인 거리'로 계산한다.
  //
  // 예전엔 f = (clientY - 트랙top) / 트랙높이로 손가락이 닿은 지점 자체를 위치로 삼았다.
  // 너 나와/경기 목록에선 문서가 몇 화면 높이라 손가락이 손잡이 중심에서 몇 px 어긋나도
  // 스크롤은 수십 px만 움직여 티가 안 났다. 피드는 한 번에 100건씩 이어붙여 문서가 수만
  // px이라, 같은 몇 px 오차가 트랙 높이(≈600px) 대비 비율로 증폭돼 수백~수천 px 점프가
  // 된다 — 이게 "피드로 도입하면서 안 되기 시작한" 튐의 정체다(마우스는 12px 점을 정확히
  // 겨냥해 눌러 오차가 1px 수준이라 늘 멀쩡해 보였고, 손가락은 접촉면 중심이 보고돼
  // 잡자마자 어긋난다). 시작 지점을 기준으로 삼으면 어디를 잡든 첫 프레임에 안 튄다.
  const dragRef = useRef<{ startY: number; startFraction: number; active: boolean } | null>(null);
  // 스크롤하려던 손가락이 손잡이를 스치고 지나간 것과 진짜 드래그를 가른다 — 이만큼
  // 움직이기 전엔 스크롤을 건드리지 않고, 넘어서는 순간 그 지점을 새 기준으로 삼아
  // (문턱만큼의 점프 없이) 이어서 따라간다.
  const DRAG_DEADZONE = 4;
  // 손가락으로 잡을 수 있는 여유 — 손잡이 점(12px) 주위로 이만큼 넓힌 사각형이 잡는 영역.
  // 12+20*2 = 52px 폭, 12+44*2 = 100px 높이(요청: 터치 영역을 좀 크게). 세로를 더 크게
  // 벌린 건 세로 드래그가 이 조작의 전부이기 때문이고, 가로는 화면 오른쪽 끝의 다른
  // 버튼(포스트 우상단 케밥)까지 삼키지 않을 만큼만 늘렸다.
  const TOUCH_PAD_X = 20;
  const TOUCH_PAD_Y = 44;

  const scrubBy = (clientY: number) => {
    const track = trackRef.current;
    const d = dragRef.current;
    if (!track || !d) return;
    if (!d.active) {
      if (Math.abs(clientY - d.startY) < DRAG_DEADZONE) return;
      d.active = true;
      d.startY = clientY;
    }
    const rect = track.getBoundingClientRect();
    if (rect.height <= 0) return;
    const f = Math.min(1, Math.max(0, d.startFraction + (clientY - d.startY) / rect.height));
    const { clientHeight, scrollHeight } = getScrollMetrics();
    const vh = Math.max(clientHeight, window.innerHeight || 0);
    scrollRootTo({ top: f * Math.max(0, scrollHeight - vh), behavior: "instant" as ScrollBehavior });
  };

  // 마우스 전용 — 터치는 아래 useEffect의 문서 레벨 리스너가 맡는다(pointerType으로 갈라
  // 두 경로가 같은 터치를 두 번 처리하지 않게 한다).
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    e.preventDefault();
    draggingRef.current = true;
    dragRef.current = { startY: e.clientY, startFraction: currentFraction(), active: false };
    setVisible(true);
    // 손잡이를 잡은 순간엔 위치를 바꾸지 않는다 — 끌어야 움직인다. 캡처는 손잡이 밖으로
    // 끌어도 추적되게.
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (draggingRef.current) scrubBy(e.clientY);
  };
  const endDrag = () => {
    draggingRef.current = false;
    dragRef.current = null;
    showThenScheduleHide();
  };

  // 터치 드래그는 CSS 히트테스트에 기대지 않고 문서 레벨에서 좌표로 직접 판정한다.
  //
  // 그동안 이 조작을 pointer-events / touch-action / setPointerCapture 조합으로 짰는데,
  // 크로미움 터치 에뮬레이션에선 (가려진 상태로도, 18px 옆을 눌러도) 멀쩡히 잡히는 게
  // 실기기 사파리에서만 계속 안 먹었다. 그 세 가지는 브라우저마다 히트테스트 규칙이
  // 갈리는 지점이라 값을 아무리 맞춰도 확인할 방법이 없다 — 반면 non-passive
  // touchstart/touchmove의 preventDefault로 페이지 패닝을 막는 건 사파리가 확실히
  // 지키는 동작이다(모달 리바운드 차단 등 이 앱의 다른 곳에서도 같은 방식을 쓴다).
  // 그래서 "이 좌표가 손잡이 근처인가"만 우리가 직접 판정하고, 나머지는 전부 뺐다.
  useEffect(() => {
    const inGrabZone = (x: number, y: number): boolean => {
      const thumb = thumbRef.current;
      if (!thumb) return false;
      const r = thumb.getBoundingClientRect();
      return x >= r.left - TOUCH_PAD_X && x <= r.right + TOUCH_PAD_X
        && y >= r.top - TOUCH_PAD_Y && y <= r.bottom + TOUCH_PAD_Y;
    };
    const onTouchStart = (e: TouchEvent) => {
      // 모달/서랍이 떠 있으면 손대지 않는다 — 그 위에서 오른쪽 가장자리를 만졌을 때 뒤의
      // 목록이 스크럽되면 안 된다(모달 잠금은 touchstart를 막기만 하고 전파는 안 끊는다).
      if (isBodyScrollLocked()) return;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (!inGrabZone(t.clientX, t.clientY)) return;
      touchIdRef.current = t.identifier;
      draggingRef.current = true;
      dragRef.current = { startY: t.clientY, startFraction: currentFraction(), active: false };
      setVisible(true);
      // 이 손가락은 스크럽 전용 — 페이지가 같이 밀리면 네이티브 스크롤과 스크럽이 서로
      // 밀어 요동친다. 여기서 막아야 관성까지 확실히 안 붙는다.
      if (e.cancelable) e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!draggingRef.current || touchIdRef.current === null) return;
      const t = Array.from(e.touches).find((x) => x.identifier === touchIdRef.current);
      if (!t) return;
      if (e.cancelable) e.preventDefault();
      scrubBy(t.clientY);
    };
    const onTouchEnd = () => {
      if (touchIdRef.current === null) return;
      touchIdRef.current = null;
      endDrag();
    };
    document.addEventListener("touchstart", onTouchStart, { passive: false });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", onTouchEnd);
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!scrollable) return null;

  return (
    <div className={cx(
      "scr-scroll-timeline",
      visible && "scr-scroll-timeline-visible",
      settling && "scr-scroll-timeline-settling",
    )}>
      <span className="scr-scroll-timeline-end">{topLabel}</span>
      {/* 트랙은 지시용(pointer-events:none) — 조작은 아래 thumb에서만 받는다. 화면
          가장자리에 붙은 이 띠가 터치를 가로채는 바람에 한 손 스크롤 중 엄지가 닿으면
          페이지가 손가락 높이로 순간이동했다(계측으로 확인, global.css 주석 참고). */}
      <div ref={trackRef} className="scr-scroll-timeline-track">
        {markers?.map((m) => (
          markerFractions[m.key] !== null && markerFractions[m.key] !== undefined && (
            <button
              key={m.key} type="button" className={m.className}
              style={{ top: `${(markerFractions[m.key] as number) * 100}%` }}
              // 눈금을 누르면 그 지점으로 이동한다(요청). 목적지는 눈금이 이미 알고 있는
              // 값(markerFractions)을 그대로 쓴다 — scrollIntoView로 옮겼더니 화면 '가운데'에
              // 두려고 반 화면만큼 더 위로 갔고, 위쪽 여유가 없으면 0으로 잘려 맨 위로
              // 튀었다(지적: 눌러도 현재가 아니라 맨 위로 감). 눈금 위치는 "그 요소가 화면
              // 맨 위에 오는 스크롤 값"이라, 같은 척도로 옮겨야 다이얼이 눈금에 정확히 앉는다.
              onClick={() => {
                const f = markerFractions[m.key];
                if (f === null || f === undefined) return;
                const { clientHeight, scrollHeight } = getScrollMetrics();
                const vh = Math.max(clientHeight, window.innerHeight || 0);
                scrollRootTo({ top: f * Math.max(0, scrollHeight - vh), behavior: "smooth" });
                setVisible(true);
              }}
              aria-label={`${m.key} 위치로 이동`}
            />
          )
        ))}
        {dateLabel && (
          // 알약은 다이얼 '위'에 얹힌다(요청). 트랙 맨 위에서는 화면 밖으로 나가므로
          // 최소 높이를 잡아 잘리지 않게 한다 — CSS max()는 %와 px을 섞을 수 있다.
          <div className="scr-scroll-timeline-date" style={{ top: `max(30px, ${fraction * 100}%)` }}>
            {dateLabel}
          </div>
        )}
        <div
          ref={thumbRef}
          className="scr-scroll-timeline-thumb"
          style={{ top: `${fraction * 100}%` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </div>
      <span className="scr-scroll-timeline-end">{bottomLabel}</span>
    </div>
  );
}
