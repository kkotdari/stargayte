import { useEffect, useRef, useState } from "react";
import { cx } from "../../utils/format";
import { getScrollRoot, getScrollMetrics, addRafScrollListener, scrollRootTo } from "../../utils/scrollRoot";

// 너 나와 목록 우측의 네비게이션 타임라인(요청: "화면 우측에 네비게이션 타임라인 — 위가
// 과거 아래가 미래라는 걸 알게, 현재 위치 표시, 스크롤 시에만 보임"). 목록은 과거(위)→
// 미래(아래) 오름차순이라, 스크롤 위치(0~1)를 그대로 세로 축에 매핑한다. 스크롤하는 동안만
// 떴다가 잠시 후 사라지고, 트랙을 드래그/탭하면 그 지점으로 바로 이동한다(스크럽).
export default function ChallengeScrollTimeline() {
  const [visible, setVisible] = useState(false);
  const [scrollable, setScrollable] = useState(false);
  const [fraction, setFraction] = useState(0); // 0=맨 위(과거) … 1=맨 아래(미래)
  const [todayFraction, setTodayFraction] = useState<number | null>(null); // "오늘" 눈금 위치
  const [undecidedFraction, setUndecidedFraction] = useState<number | null>(null); // "일정 미정" 눈금 위치
  const [dateLabel, setDateLabel] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const draggingRef = useRef(false);

  // 지금 상단에 스티키로 핀된 날짜 헤더의 라벨 — 현재 위치를 "며칠"인지로 보여준다.
  const currentDateLabel = (): string | null => {
    const heads = Array.from(document.querySelectorAll<HTMLElement>(".scr-challenge-date-head"));
    if (heads.length === 0) return null;
    const root = getScrollRoot();
    const topY = root instanceof Window ? 0 : root.getBoundingClientRect().top;
    let current: string | null = heads[0].dataset.dateLabel ?? null;
    for (const h of heads) {
      if (h.getBoundingClientRect().top - topY <= 6) current = h.dataset.dateLabel ?? current;
      else break;
    }
    return current;
  };

  // 특정 날짜 그룹(selector로 지목)의 스크롤 위치를 0~1로 — 트랙에 눈금을 찍는 데 쓴다.
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
    setDateLabel(currentDateLabel());
    // "오늘"/"일정 미정" 그룹의 스크롤 위치에 각각 눈금을 찍는다.
    setTodayFraction(groupFraction('.scr-challenge-date-group[data-today="1"]', scrollTop, max));
    setUndecidedFraction(groupFraction('.scr-challenge-date-group[data-undecided="1"]', scrollTop, max));
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
  }, []);

  // 트랙 위 포인터 위치 → 스크롤 위치로 즉시 이동(스크럽). #scroll-root엔 CSS
  // scroll-behavior:smooth가 걸려 있어 매 프레임 재시작으로 버벅이므로 instant로 넘긴다.
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
    <div className={cx("scr-challenge-timeline", visible && "scr-challenge-timeline-visible")}>
      <span className="scr-challenge-timeline-end">과거</span>
      <div
        ref={trackRef}
        className="scr-challenge-timeline-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {undecidedFraction !== null && (
          <div className="scr-challenge-timeline-undecided" style={{ top: `${undecidedFraction * 100}%` }} />
        )}
        {todayFraction !== null && (
          <div className="scr-challenge-timeline-today" style={{ top: `${todayFraction * 100}%` }} />
        )}
        {dateLabel && (
          <div className="scr-challenge-timeline-date" style={{ top: `${fraction * 100}%` }}>
            {dateLabel}
          </div>
        )}
        <div className="scr-challenge-timeline-thumb" style={{ top: `${fraction * 100}%` }} />
      </div>
      <span className="scr-challenge-timeline-end">미래</span>
    </div>
  );
}
