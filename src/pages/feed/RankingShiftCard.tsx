import { useState } from "react";
import { MoreHorizontal, Trophy } from "lucide-react";
import KakaoShareButton from "../../components/common/KakaoShareButton";
import { cx } from "../../utils/format";
import { normalizeSearchText } from "../../utils/memberSearch";
import { shareThumb, type KakaoShareContent } from "../../utils/kakaoShare";
import type { RankingShiftEntry, RankingShift } from "../../types";

// 변동이 이보다 많으면 위에서 이 개수만 보이고 나머지는 "…더보기"로 접는다(요청).
const SHIFT_COLLAPSE_AT = 4;

// 랭크 변동 카드 — 피드와 카카오톡 공유 페이지(?sv=rankingShift)가 같은 마크업을 쓰도록
// 분리했다(요청: "순위변동 발생도 카톡공유 가능, 피드는 다 가능하게"). 헤더 오른쪽
// 케밥(actions)과 하단(상세 버튼·댓글, footer)은 쓰는 쪽이 끼워 넣는다.

// 순위가 어디서 어디로 갔나 — "1 → 3위"(신규 진입은 "신규 → 3위").
//
// 예전에는 이 자리에 ▲2 / ▼1 같은 배지를 뒀는데 걷어냈다(요청) — 통계표의 순위 변동
// 배지와 생김새가 같아, 같은 화면을 오가며 볼 때 어느 쪽 이야기인지 헷갈린다.
// 여기서는 몇 계단이 아니라 몇 위에서 몇 위로 갔는지를 그대로 읽히게 둔다.
export function shiftLabel(e: RankingShiftEntry): { text: string; cls: string } {
  if (e.from == null) return { text: `신규 → ${e.to}위`, cls: "scr-feed-shift-new" };
  const d = e.from - e.to;
  return {
    text: `${e.from} → ${e.to}위`,
    cls: d > 0 ? "scr-feed-shift-up" : "scr-feed-shift-down",
  };
}

// 포인트 증감 표기(요청: "+100p" 이렇게) — 몇 계단 올랐는지만으로는 그게 한 판 차이인지
// 몰아친 결과인지 알 수가 없다. 이 필드가 생기기 전 스냅샷에는 포인트가 없으므로,
// 둘 다 있고 실제로 달라졌을 때만 내놓는다.
export function pointLabel(e: RankingShiftEntry): { text: string; cls: string } | null {
  if (e.fromPoints == null || e.toPoints == null) return null;
  const d = Math.round(e.toPoints) - Math.round(e.fromPoints);
  if (d === 0) return null;
  return {
    text: `${d > 0 ? "+" : "−"}${Math.abs(d)}p`,
    cls: d > 0 ? "scr-feed-shift-up" : "scr-feed-shift-down",
  };
}

export function rankShiftTypeLabel(shift: RankingShift): string {
  return shift.matchType === "0101" ? "개인전" : "팀전";
}

export function rankShiftShareContent(shift: RankingShift): KakaoShareContent {
  const summary = shift.shifts
    .slice(0, 3)
    .map((e) => `${e.nickname} ${shiftLabel(e).text}`)
    .join(" · ");
  return {
    title: `${rankShiftTypeLabel(shift)} 랭크 변동 발생`,
    description: summary,
    ...shareThumb("rankShift"),
    link: `${window.location.origin}/?sv=rankingShift&sid=${shift.id}`,
    fallbackText: `[스타게이트] ${rankShiftTypeLabel(shift)} 랭크 변동 발생\n${summary}`,
  };
}

// 카드 우상단 케밥 — 카카오 공유만 담는다(스냅샷은 삭제 개념이 없다). 너 나와 케밥과
// 같은 CSS(scr-feed-chal-menu) 재사용.
export function RankingShiftMenu({ shift }: { shift: RankingShift }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="scr-feed-chal-menu">
      <button
        type="button" className="scr-feed-post-menu-btn scr-feed-kebab-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="더보기" aria-haspopup="menu" aria-expanded={open}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          {/* 백드롭 클릭은 '메뉴 닫기'에서 끝나야 한다(지적) — 안 끊으면 그 클릭이 카드
              본체까지 올라가 순위변동 목록의 펼침/접힘까지 같이 눌린다. */}
          <div
            className="scr-feed-add-backdrop"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            aria-hidden
          />
          <div className="scr-menu-pop-drop scr-feed-chal-menu-drop" role="menu">
            <KakaoShareButton
              variant="menu"
              content={() => rankShiftShareContent(shift)}
              onDone={() => setOpen(false)}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default function RankingShiftCard({
  shift, timeText, dateLabel, actions, footer, highlightMemberIds, highlightTerms,
}: {
  shift: RankingShift;
  timeText?: string;
  dateLabel?: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  // 피드 검색어에 걸린 사람 — 순위변동 줄에도 로스터와 같은 하이라이트를 준다(지적).
  highlightMemberIds?: Set<string>;
  highlightTerms?: string[];
}) {
  // 변동이 4개 넘으면 위에서 4개만 보이고 나머지는 "…더보기"로 접는다. 리스트를 누르면
  // 펼쳐지고 다시 누르면 접힌다(요청). 공유 페이지의 카드에도 그대로 적용된다.
  const [expanded, setExpanded] = useState(false);
  const total = shift.shifts.length;
  const overflow = total > SHIFT_COLLAPSE_AT;
  const rows = expanded || !overflow ? shift.shifts : shift.shifts.slice(0, SHIFT_COLLAPSE_AT);
  const toggle = () => setExpanded((v) => !v);
  return (
    <div className="scr-feed-card scr-post">
      <div className="scr-feed-card-head" {...(dateLabel ? { "data-date-label": dateLabel } : {})}>
        <div className="scr-feed-card-head-title">
          <Trophy size={16} aria-hidden />
          <span className="scr-feed-card-label">{rankShiftTypeLabel(shift)} 랭크 변동 발생</span>
        </div>
        <div className="scr-feed-card-head-meta">
          {timeText && <span className="scr-feed-card-time">{timeText}</span>}
        </div>
      </div>
      {actions}
      {/* 유리 패널(반투명·블러·위아래 림)은 머리를 빼고 여기만 덮는다(요청: 머리는 떠 있는
          느낌) — FeedScreen의 같은 래퍼와 한 규칙이다. actions(케밥)는 절대배치라 밖에 둔다. */}
      <div className="scr-post-panel">
      <ul
        className={cx("scr-feed-shift-list", overflow && "scr-feed-shift-list-toggle")}
        {...(overflow
          ? {
              onClick: toggle,
              role: "button" as const,
              tabIndex: 0,
              "aria-expanded": expanded,
              onKeyDown: (ev: React.KeyboardEvent) => {
                if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); }
              },
            }
          : {})}
      >
        {rows.map((e) => {
          const label = shiftLabel(e);
          const pts = pointLabel(e);
          return (
            <li
              key={`${e.memberId}-${e.to}`}
              className={cx("scr-feed-shift-row",
                (highlightMemberIds?.has(e.memberId)
                  || highlightTerms?.some((t) => normalizeSearchText(e.nickname).includes(t)))
                  && "scr-feed-shift-row-hl")}
            >
              <span className="scr-feed-shift-name">{e.nickname}</span>
              {/* "조조 1 → 3위 -100p"(요청) — 몇 계단인지를 배지로 말하는 대신 어디서
                  어디로 갔는지를 그대로 적고, 그 근거인 포인트 변동을 옆에 붙인다. */}
              <span className={label.cls}>{label.text}</span>
              {pts && <span className={cx("scr-feed-shift-pts", pts.cls)}>{pts.text}</span>}
            </li>
          );
        })}
        {overflow && !expanded && (
          <li className="scr-feed-shift-more" aria-hidden>
            ⋯ 외 {total - SHIFT_COLLAPSE_AT}건
          </li>
        )}
      </ul>
      {footer}
      </div>
    </div>
  );
}
