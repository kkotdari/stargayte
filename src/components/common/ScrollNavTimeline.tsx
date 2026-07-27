import { useEffect, useRef, useState } from "react";
import { cx } from "../../utils/format";
import { getScrollRoot, getScrollMetrics, addRafScrollListener, scrollRootTo } from "../../utils/scrollRoot";

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
  const hideTimerRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  // 무한스크롤로 문서가 길어진 직후인지 — 그때만 thumb/날짜 알약을 애니메이션으로 옮긴다.
  // 피드는 바닥에 닿을 때마다 한 페이지(100건)를 이어붙이는데, thumb 위치는
  // scrollTop/(문서높이-뷰포트)라 그 순간 분모가 확 커지며 위치가 뚝 떨어진다 —
  // 스크롤은 그대로인데 thumb만 위로 도약했다가 계속 스크롤하면 되돌아오는 게 "튐"의
  // 정체다(측정 방식 문제가 아니라 무한스크롤 구조 자체의 성질이라, 계산부를 아무리
  // 고쳐도 남아 있었다). 도약 자체는 의미상 맞으므로 없애지 않고, 그 순간에만 짧게
  // 미끄러지게 해서 눈에 튀지 않게 한다. 평상시 스크롤엔 트랜지션이 없어 지연이 없다.
  const [settling, setSettling] = useState(false);
  // 임시 계측 — URL에 ?tldebug=1 을 붙였을 때만 화면 좌상단에 실측값을 띄운다. 튐이
  // 일어나는 순간을 스크린샷으로 잡아 어떤 값이 뛰는지 확정하기 위한 것(실기기에서만
  // 재현되는 문제라 추측 대신 값을 본다). 원인 확정 후 이 블록은 통째로 지운다.
  const debugOn = typeof location !== "undefined" && location.search.includes("tldebug");
  // 프로그램 스크롤 추적 — window.scrollTo를 감싸 마지막 호출의 목표값/시각/호출 위치를
  // 남긴다. 튀는 순간 이 값이 최근이면 앱 코드가 옮긴 것이고, 비어 있으면 브라우저가
  // 옮긴 것이다(둘을 가르는 게 핵심).
  const traceRef = useRef<{ top: number; at: number; from: string } | null>(null);
  const [dbg, setDbg] = useState<
    { y: number; sh: number; ch: number; ih: number; f: number; se: number; bp: string; vv: number; n: number } | null
  >(null);
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
    if (debugOn) {
      const vvp = (window as unknown as { visualViewport?: { pageTop?: number } }).visualViewport;
      setDbg({
        y: Math.round(scrollTop), sh: Math.round(scrollHeight), ch: Math.round(clientHeight),
        ih: Math.round(window.innerHeight || 0), f: max > 0 ? Math.min(1, Math.max(0, scrollTop / max)) : 0,
        // scrollY와 다른 값들 — 어느 게 진짜 스크롤러인지, body가 잠겼는지(position:fixed)
        // 가려낸다. sy(=y)만 튀고 se/vv는 멀쩡하면 body 잠금·다른 스크롤러가 범인이다.
        se: Math.round(document.scrollingElement?.scrollTop ?? -1),
        bp: getComputedStyle(document.body).position,
        vv: Math.round(vvp?.pageTop ?? -1),
        // 헤드 셀렉터로 잡히는 요소 수 — 피드는 카드마다 있어 수백 개가 될 수 있다.
        n: document.querySelectorAll(headSelector).length,
      });
    }
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
    if (!debugOn) return;
    const w = window as unknown as { scrollTo: typeof window.scrollTo; __tlPatched?: boolean };
    if (w.__tlPatched) return;
    w.__tlPatched = true;
    const orig = w.scrollTo.bind(window);
    w.scrollTo = ((...args: unknown[]) => {
      const top = typeof args[0] === "object" && args[0] !== null
        ? Number((args[0] as ScrollToOptions).top ?? -1)
        : Number(args[1] ?? -1);
      const line = (new Error().stack ?? "").split("\n").slice(2, 4)
        .map((l) => (l.trim().replace(/^at\s+/, "").split("/").pop() ?? ""))
        .join(" < ");
      traceRef.current = { top: Math.round(top), at: performance.now(), from: line.slice(0, 46) };
      return orig(...(args as Parameters<typeof window.scrollTo>));
    }) as typeof window.scrollTo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugOn]);

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

  // 트랙 위 포인터 위치 → 스크롤 위치로 즉시 이동(스크럽).
  const scrubTo = (clientY: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    const { clientHeight, scrollHeight } = getScrollMetrics();
    const vh = Math.max(clientHeight, window.innerHeight || 0);
    scrollRootTo({ top: f * Math.max(0, scrollHeight - vh), behavior: "instant" as ScrollBehavior });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    setVisible(true);
    // 손잡이를 잡은 순간엔 위치를 바꾸지 않는다 — 끌어야 움직인다(잡자마자 튀면
    // 손가락 중심으로 점프해 버린다). 캡처는 손잡이 밖으로 끌어도 추적되게.
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (draggingRef.current) scrubTo(e.clientY);
  };
  const endDrag = () => {
    draggingRef.current = false;
    showThenScheduleHide();
  };

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
            <div key={m.key} className={m.className} style={{ top: `${(markerFractions[m.key] as number) * 100}%` }} />
          )
        ))}
        {dateLabel && (
          <div className="scr-scroll-timeline-date" style={{ top: `${fraction * 100}%` }}>
            {dateLabel}
          </div>
        )}
        <div
          className="scr-scroll-timeline-thumb"
          style={{ top: `${fraction * 100}%` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </div>
      <span className="scr-scroll-timeline-end">{bottomLabel}</span>
      {debugOn && dbg && (
        <div className="scr-scroll-timeline-debug">
          y {dbg.y}<br />se {dbg.se}<br />vv {dbg.vv}<br />body {dbg.bp}<br />
          sh {dbg.sh}<br />ch {dbg.ch} ih {dbg.ih}<br />
          max {dbg.sh - Math.max(dbg.ch, dbg.ih)}<br />f {dbg.f.toFixed(3)}<br />heads {dbg.n}
          {traceRef.current && (
            <>
              <br />&rarr;to {traceRef.current.top} ({Math.round(performance.now() - traceRef.current.at)}ms)
              <br />{traceRef.current.from}
            </>
          )}
        </div>
      )}
    </div>
  );
}
