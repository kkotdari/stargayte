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
  // thumb/날짜 알약의 세로 위치(트랙 기준 정수 px). fraction과 따로 두는 이유: 값이 같은
  // 프레임엔 setState가 리렌더를 건너뛰어(React가 동일 값이면 bail out) 알약 글자가 매
  // 프레임 다시 그려지지 않는다.
  const [posPx, setPosPx] = useState(0);
  const [markerFractions, setMarkerFractions] = useState<Record<string, number | null>>({});
  const [dateLabel, setDateLabel] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  // 트랙 높이 — 스크롤 중엔 안 변하므로 리사이즈 때만 갱신한다(매 프레임 실측하면
  // 레이아웃을 강제로 계산하게 되고 값도 미세하게 흔들린다).
  const trackHRef = useRef(0);
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

  // 뷰포트 높이 — iOS 사파리는 아래로 스크롤하면 주소창/툴바가 접히며 실제 보이는
  // 뷰포트가 커지는데 documentElement.clientHeight는 접히기 전(작은) 레이아웃 뷰포트를
  // 반환할 때가 있어 max = scrollHeight - clientHeight가 실제보다 커진다 → 페이지 끝까지
  // 내려도 scrollTop/max < 1이라 thumb이 바닥에 못 닿는다(지적된 문제). 접힌 상태를
  // 반영하는 innerHeight와 더 큰 값을 쓴다.
  // 한때 이 값을 캐시했다가(분모가 흔들리는 걸 막으려고) 캐시가 낡으면 max가 어긋나
  // scrollable이 잠깐 false로 뒤집히며 트랙이 언마운트→재측정됐고, 그 틈에 위치가 0으로
  // 계산돼 thumb이 맨 위로 튀었다 돌아왔다(지적). 캐시 대신 매번 재되, 아래 update()와
  // scrubTo()가 '같은 함수'를 써서 척도가 절대 어긋나지 않게 한다.
  const currentVh = (): number => {
    const { clientHeight } = getScrollMetrics();
    return Math.max(clientHeight, window.innerHeight || 0);
  };

  const update = () => {
    const { scrollTop, scrollHeight } = getScrollMetrics();
    const max = scrollHeight - currentVh();
    setScrollable(max > 40);
    const f = max > 0 ? Math.min(1, Math.max(0, scrollTop / max)) : 0;
    // 드래그(스크럽) 중에는 thumb 위치를 스크롤 읽기값으로 되돌리지 않는다 — 손가락이
    // 위치의 주인이다. iOS는 루트 스크롤을 브라우저 프로세스가 비동기로 들고 있어, 방금
    // 옮긴 스크롤을 곧바로 다시 읽으면 아직 예전 값이 온다. 그 값으로 thumb을 되돌리면
    // 손가락 위치와 서로 밀치며 위아래로 요동쳤다(지적).
    // 정수 px로 반올림해 담는다 — 같은 픽셀이면 setState가 리렌더 자체를 건너뛴다.
    // 트랙을 아직 못 쟀으면(마운트 직후 등) 위치를 건드리지 않는다 — 0으로 써버리면
    // thumb이 맨 위로 튄다.
    if (!draggingRef.current && trackHRef.current > 0) setPosPx(Math.round(f * trackHRef.current));
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

  // 트랙 높이 추적 — 스크롤 중엔 안 변하므로 리사이즈/레이아웃 변화 때만 재고, 잰 직후
  // 한 번 위치를 다시 계산한다.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const remeasure = () => {
      trackHRef.current = track.clientHeight;
      update();
    };
    const ro = new ResizeObserver(remeasure);
    ro.observe(track);
    remeasure();
    window.addEventListener("resize", remeasure);
    window.addEventListener("orientationchange", remeasure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("orientationchange", remeasure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollable]);

  // 트랙 위 포인터 위치 → 스크롤 위치로 이동(스크럽).
  // thumb은 스크롤 읽기값이 아니라 '손가락 위치'로 바로 옮긴다(update()의 드래그 가드와
  // 한 쌍) — 옮긴 스크롤을 되읽어 위치를 정하면 iOS의 비동기 스크롤 지연 때문에 서로
  // 밀치며 요동친다. 분모(vh)는 update()와 같은 currentVh()를 써야 손가락 위치와 thumb이
  // 같은 척도 위에 놓인다(한때 한쪽만 캐시를 써서 둘이 어긋났다).
  // 실제 스크롤은 프레임당 한 번으로 합친다 — pointermove마다 즉시 스크롤하면 화면
  // 전체를 그 횟수만큼 다시 그리느라 깜빡였다(지적).
  const pendingScrollRef = useRef<number | null>(null);
  const scrubRafRef = useRef(0);
  const scrubTo = (clientY: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    if (trackHRef.current > 0) setPosPx(Math.round(f * trackHRef.current));
    const { scrollHeight } = getScrollMetrics();
    pendingScrollRef.current = f * Math.max(0, scrollHeight - currentVh());
    if (!scrubRafRef.current) {
      scrubRafRef.current = requestAnimationFrame(() => {
        scrubRafRef.current = 0;
        const top = pendingScrollRef.current;
        pendingScrollRef.current = null;
        if (top !== null) scrollRootTo({ top, behavior: "instant" as ScrollBehavior });
      });
    }
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
    // 예약해 둔 마지막 스크롤을 흘리지 않고 즉시 반영한 뒤, 그때부터 thumb을 다시
    // 스크롤 기준으로 되돌린다(드래그 가드 해제 후 update()가 이어받는다).
    if (scrubRafRef.current) {
      cancelAnimationFrame(scrubRafRef.current);
      scrubRafRef.current = 0;
    }
    const top = pendingScrollRef.current;
    pendingScrollRef.current = null;
    if (top !== null) scrollRootTo({ top, behavior: "instant" as ScrollBehavior });
    update();
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
        {/* thumb·날짜 알약은 top:%(레이아웃) 대신 정수 px transform(합성)으로 앉힌다 —
            %는 매 프레임 소수점 위치가 되어 알약 글자가 서브픽셀로 다시 래스터되며
            덜덜 떨렸다(지적). 위치값은 update()에서 이미 정수로 반올림해 두므로 같은
            픽셀이면 리렌더 자체가 없다. (한때 흔들림을 더 뭉개려고 짧은 transition을
            걸었다가 iOS에서 잔상이 남아 thumb이 두 개로 보였다 — 트랜지션·will-change는
            쓰지 않는다.)
            가로 정렬(-50%)은 인라인 transform이 CSS transform을 통째로 덮으므로 같이 준다. */}
        {dateLabel && (
          <div
            className="scr-scroll-timeline-date"
            style={{ transform: `translate3d(0, ${posPx}px, 0) translateY(-50%)` }}
          >
            {dateLabel}
          </div>
        )}
        <div
          className="scr-scroll-timeline-thumb"
          style={{ transform: `translate3d(-50%, ${posPx}px, 0) translateY(-50%)` }}
        />
      </div>
      <span className="scr-scroll-timeline-end">{bottomLabel}</span>
    </div>
  );
}
