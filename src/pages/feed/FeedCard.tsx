import type { ReactNode, Ref } from "react";
import { cx } from "../../utils/format";

// 피드 포스트 4종(게임결과/너 나와/랭크변동/게임요약)이 공유하는 뼈대 — 머리(떠 있음) +
// 유리 본문(.scr-feed-card-body, 글래스는 오직 여기) + 댓글(있을 때만). 각 타입이 저마다
// 따로 흉내 내던 이 구조를 하나로 뽑아, 타입마다 다른 건 본문 안 내용물뿐이게 한다(요청:
// "모든 포스트의 구조를 공통화").
export function FeedCard({
  className, dateLabel, icon, label, timeText, headMeta, actions, bodyClassName, children, comment,
  rootRef, ariaHidden,
}: {
  className?: string;
  dateLabel?: string;
  icon?: ReactNode;
  label?: ReactNode;
  timeText: ReactNode;
  headMeta?: ReactNode;
  // 케밥 등 절대배치 메뉴 — 머리/본문의 형제로 둔다(요청 아님, 기존 StackMenu·
  // ChallengeActionsMenu 주석 참고: 카드의 backdrop-filter, 머리의 isolation이
  // 그 안에 있는 fixed 팝오버를 가로막는다).
  actions?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
  // 생략하면 .scr-feed-card-comment 자체가 렌더되지 않는다(게임요약 접힘 카드처럼
  // 댓글 없는 타입을 위함).
  comment?: ReactNode;
  // 게임결과 묶음의 요약 카드처럼, 카드 자신이 곧 스왑 트랙이어야 할 때 쓴다(요청: 요약↔
  // 목록 전환에 불필요한 중간 래퍼 div를 두지 않기) — 카드 바깥에 별도 래퍼를 씌우는 대신
  // 이 카드의 뿌리 요소에 직접 ref/aria-hidden을 건다.
  rootRef?: Ref<HTMLDivElement>;
  ariaHidden?: boolean;
}) {
  return (
    <div className={cx("scr-feed-card", className)} ref={rootRef} aria-hidden={ariaHidden}>
      <div className="scr-feed-card-head" {...(dateLabel ? { "data-date-label": dateLabel } : {})}>
        <div className="scr-feed-card-head-title">
          {icon}
          {label && <span className="scr-feed-card-label">{label}</span>}
        </div>
        <div className="scr-feed-card-head-meta">
          {timeText && <span className="scr-feed-card-time">{timeText}</span>}
          {headMeta}
        </div>
      </div>
      {actions}
      <div className={cx("scr-feed-card-body", bodyClassName)}>
        {children}
      </div>
      {/* 댓글 영역의 클릭은 바깥으로 안 올린다 — 카드 본문의 role="button" 영역(요약
          카드의 펼치기 등)까지 클릭이 새는 걸 막는다. */}
      {comment && (
        <div className="scr-feed-card-comment" onClick={(e) => e.stopPropagation()}>
          {comment}
        </div>
      )}
    </div>
  );
}
