import { useState } from "react";
import { MoreHorizontal, Trophy } from "lucide-react";
import KakaoShareButton from "../../components/common/KakaoShareButton";
import type { KakaoShareContent } from "../../utils/kakaoShare";
import type { RankShiftEntry, RankSnapshot } from "../../types";

// 랭크 변동 카드 — 피드와 카카오톡 공유 페이지(?sv=rankshift)가 같은 마크업을 쓰도록
// 분리했다(요청: "순위변동 발생도 카톡공유 가능, 피드는 다 가능하게"). 헤더 오른쪽
// 케밥(actions)과 하단(상세 버튼·댓글, footer)은 쓰는 쪽이 끼워 넣는다.

// 변동 표기 — 신규 진입 / 상승(▲n) / 하락(▼n).
export function shiftLabel(e: RankShiftEntry): { text: string; cls: string } {
  if (e.from == null) return { text: "신규", cls: "scr-feed-shift-new" };
  const d = e.from - e.to;
  if (d > 0) return { text: `▲${d}`, cls: "scr-feed-shift-up" };
  return { text: `▼${-d}`, cls: "scr-feed-shift-down" };
}

export function rankShiftTypeLabel(shift: RankSnapshot): string {
  return shift.matchType === "0101" ? "개인전" : "팀전";
}

export function rankShiftShareContent(shift: RankSnapshot): KakaoShareContent {
  const summary = shift.shifts
    .slice(0, 3)
    .map((e) => `${e.to}위 ${e.nickname} ${shiftLabel(e).text}`)
    .join(" · ");
  return {
    title: `랭크 변동 발생 · ${rankShiftTypeLabel(shift)}`,
    description: summary,
    link: `${window.location.origin}/?sv=rankshift&sid=${shift.id}`,
    fallbackText: `[스타게이트] 랭크 변동 발생 · ${rankShiftTypeLabel(shift)}\n${summary}`,
  };
}

// 카드 우상단 케밥 — 카카오 공유만 담는다(스냅샷은 삭제 개념이 없다). 너 나와 케밥과
// 같은 CSS(scr-feed-chal-menu) 재사용.
export function RankShiftMenu({ shift }: { shift: RankSnapshot }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="scr-feed-chal-menu">
      <button
        type="button" className="scr-match-memo-btn scr-match-kebab-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="더보기" aria-haspopup="menu" aria-expanded={open}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <div className="scr-feed-add-backdrop" onClick={() => setOpen(false)} aria-hidden />
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

export default function RankShiftCard({ shift, timeText, dateLabel, actions, footer }: {
  shift: RankSnapshot;
  timeText?: string;
  dateLabel?: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="scr-feed-card">
      <div className="scr-feed-card-head" {...(dateLabel ? { "data-date-label": dateLabel } : {})}>
        <Trophy size={13} aria-hidden />
        <span className="scr-feed-card-label">랭크 변동 발생 · {rankShiftTypeLabel(shift)}</span>
        {timeText && <span className="scr-feed-card-time">{timeText}</span>}
      </div>
      {actions}
      <ul className="scr-feed-shift-list">
        {shift.shifts.map((e) => {
          const label = shiftLabel(e);
          return (
            <li key={`${e.memberId}-${e.to}`} className="scr-feed-shift-row">
              <span className="scr-feed-shift-rank">{e.to}위</span>
              <span className="scr-feed-shift-name">{e.nickname}</span>
              <span className={label.cls}>{label.text}</span>
              {e.from != null && <span className="scr-feed-shift-from">({e.from}위 → {e.to}위)</span>}
            </li>
          );
        })}
      </ul>
      {footer}
    </div>
  );
}
