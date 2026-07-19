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

  // 특정 날짜 그룹(selector)의 스크롤 위치를 0~1로 — 트랙에 눈금을 찍는 데 쓴다.
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
    const max = scrollHeight - clientHeight;
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
    scrollRootTo({ top: f * Math.max(0, scrollHeight - clientHeight), behavior: "instant" as ScrollBehavior });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    setVisible(true);
    trackRef.current?.setPointerCapture?.(e.pointerId);
    scrubTo(e.clientY);
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
    <div className={cx("scr-scroll-timeline", visible && "scr-scroll-timeline-visible")}>
      <span className="scr-scroll-timeline-end">{topLabel}</span>
      <div
        ref={trackRef}
        className="scr-scroll-timeline-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
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
        <div className="scr-scroll-timeline-thumb" style={{ top: `${fraction * 100}%` }} />
      </div>
      <span className="scr-scroll-timeline-end">{bottomLabel}</span>
    </div>
  );
}
