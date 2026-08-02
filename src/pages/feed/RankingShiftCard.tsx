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
// 케밥(actions)과 하단(댓글, footer)은 쓰는 쪽이 끼워 넣는다.

// 순위가 어디서 어디로 갔나 — "1 → 3위".
//
// 예전에는 이 자리에 ▲2 / ▼1 같은 배지를 뒀는데 걷어냈다(요청) — 통계표의 순위 변동
// 배지와 생김새가 같아, 같은 화면을 오가며 볼 때 어느 쪽 이야기인지 헷갈린다.
// 여기서는 몇 계단이 아니라 몇 위에서 몇 위로 갔는지를 그대로 읽히게 둔다.
//
// 그 달에 처음 순위가 잡힌 사람은 "3위(신규)"다(요청) — 예전엔 "신규 → 3위"라고 적었는데,
// 화살표는 '어디서 왔다'는 말이라 오기 전 자리가 있는 것처럼 읽힌다. 그런 자리는 없다.
export function shiftLabel(e: RankingShiftEntry): { text: string; cls: string } {
  if (e.from == null) return { text: `${e.to}위(신규)`, cls: "scr-feed-shift-new" };
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

/** 카드·공유에 쓰는 제목(요청: "일일 랭크 변동 알림") — 하루치를 모아 아침에 한 번만
 *  남기는 카드라 '발생'보다 '일일 알림'이 실제 동작에 맞다. 유형은 이제 제목이 아니라
 *  카드 안의 좌우 두 칸이 말한다(요청: 개인전·팀전을 한 카드에 반씩). */
export const RANK_SHIFT_TITLE = "일일 랭크 변동 알림";

/** 같은 날 남은 개인전·팀전 스냅샷 한 쌍 — 카드 한 장이 그리는 단위다(요청). */
export interface RankingShiftPair {
  /** 카드 키·댓글 앵커로 쓸 대표 id. 개인전이 있으면 그쪽, 없으면 팀전 것. */
  id: number;
  /** 카드에 적을 시각 — 둘 중 먼저 남은 쪽. */
  createdAt: string;
  solo: RankingShift | null;
  team: RankingShift | null;
}

/** 하루치 스냅샷들을 날짜별로 묶어 카드 단위(개인전+팀전)로 만든다.
 *
 *  서버는 두 유형을 한 번의 집계(recompute_daily)에서 각각 한 행으로 남기므로, 같은 날에
 *  남은 것끼리가 곧 한 쌍이다. 한쪽만 변동이 있었던 날은 그쪽만 채워지고 나머지 칸은
 *  "변동 없음"으로 그려진다. */
export function pairRankingShifts(shifts: RankingShift[]): RankingShiftPair[] {
  const byDay = new Map<string, RankingShiftPair>();
  // 최신이 앞이라고 가정하지 않는다 — 오래된 것부터 넣어야 createdAt이 '먼저 남은 쪽'이 된다.
  for (const s of [...shifts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const day = new Date(s.createdAt).toDateString();
    const cur = byDay.get(day) ?? { id: s.id, createdAt: s.createdAt, solo: null, team: null };
    if (s.matchType === "0101") cur.solo = s; else cur.team = s;
    // 대표 id는 개인전 우선 — 댓글이 이 값에 달리므로 같은 카드가 늘 같은 실을 본다.
    cur.id = cur.solo?.id ?? cur.team?.id ?? cur.id;
    byDay.set(day, cur);
  }
  return [...byDay.values()];
}

export function rankShiftShareContent(pair: RankingShiftPair): KakaoShareContent {
  const side = (s: RankingShift | null, label: string): string | null => {
    if (!s || s.shifts.length === 0) return null;
    return `${label} ${s.shifts.slice(0, 2).map((e) => `${e.nickname} ${shiftLabel(e).text}`).join(" · ")}`;
  };
  const summary = [side(pair.solo, "개인전"), side(pair.team, "팀전")].filter(Boolean).join(" / ");
  return {
    title: RANK_SHIFT_TITLE,
    description: summary,
    ...shareThumb("rankShift"),
    link: `${window.location.origin}/?sv=rankingShift&sid=${pair.id}`,
    fallbackText: `[스타게이트] ${RANK_SHIFT_TITLE}\n${summary}`,
  };
}

// 카드 우상단 케밥 — 카카오 공유만 담는다(스냅샷은 삭제 개념이 없다). 너 나와 케밥과
// 같은 CSS(scr-feed-chal-menu) 재사용.
export function RankingShiftMenu({ pair }: { pair: RankingShiftPair }) {
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
              content={() => rankShiftShareContent(pair)}
              onDone={() => setOpen(false)}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default function RankingShiftCard({
  pair, timeText, dateLabel, actions, footer, highlightMemberIds, highlightTerms,
}: {
  pair: RankingShiftPair;
  timeText?: string;
  dateLabel?: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  // 피드 검색어에 걸린 사람 — 순위변동 줄에도 로스터와 같은 하이라이트를 준다(지적).
  highlightMemberIds?: Set<string>;
  highlightTerms?: string[];
}) {
  /* 변동이 4개 넘으면 위에서 4개만 보이고 나머지는 "…더보기"로 접힌다. 카드를 누르면
     펼쳐지고 다시 누르면 접힌다(요청). 펼침 상태는 좌우 두 칸이 함께 쓴다 — 칸마다 따로
     접히면 같은 카드 안에서 높이가 제각각 흔들려 무엇을 눌러야 하는지가 흐려진다. */
  const [expanded, setExpanded] = useState(false);
  const sides: { label: string; shift: RankingShift | null }[] = [
    { label: "개인전", shift: pair.solo },
    { label: "팀전", shift: pair.team },
  ];
  const overflow = sides.some((s) => (s.shift?.shifts.length ?? 0) > SHIFT_COLLAPSE_AT);
  const toggle = () => setExpanded((v) => !v);
  return (
    <div className="scr-feed-card scr-post">
      <div className="scr-feed-card-head" {...(dateLabel ? { "data-date-label": dateLabel } : {})}>
        <div className="scr-feed-card-head-title">
          <Trophy size={16} aria-hidden />
          <span className="scr-feed-card-label">{RANK_SHIFT_TITLE}</span>
        </div>
        <div className="scr-feed-card-head-meta">
          {timeText && <span className="scr-feed-card-time">{timeText}</span>}
        </div>
      </div>
      {actions}
      {/* 유리 패널(반투명·블러·위아래 림)은 머리를 빼고 여기만 덮는다(요청: 머리는 떠 있는
          느낌) — FeedScreen의 같은 래퍼와 한 규칙이다. actions(케밥)는 절대배치라 밖에 둔다. */}
      <div className="scr-post-panel">
        {/* 개인전·팀전을 한 카드에 반씩 나눠 담는다(요청) — 예전엔 유형마다 카드가 따로
            떠서 같은 날 아침에 두 장이 나란히 붙었다. 가운데 구분선은 위아래를 조금 띄워
            (요청: 살짝 위아래 패딩) 카드 테두리까지 닿지 않게 한다. */}
        <div
          className={cx("scr-feed-shift-split", overflow && "scr-feed-shift-list-toggle")}
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
          {sides.map(({ label, shift }) => {
            const all = shift?.shifts ?? [];
            const rows = expanded ? all : all.slice(0, SHIFT_COLLAPSE_AT);
            return (
              <section className="scr-feed-shift-col" key={label}>
                <h4 className="scr-feed-shift-col-head">{label}</h4>
                {all.length === 0 ? (
                  <p className="scr-feed-shift-none">변동 없음</p>
                ) : (
                  <ul className="scr-feed-shift-list">
                    {rows.map((e) => {
                      const label2 = shiftLabel(e);
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
                          {/* "조조 1 → 3위 -100p"(요청) — 몇 계단인지를 배지로 말하는 대신
                              어디서 어디로 갔는지를 그대로 적고, 그 근거인 포인트 변동을 옆에. */}
                          <span className={label2.cls}>{label2.text}</span>
                          {pts && <span className={cx("scr-feed-shift-pts", pts.cls)}>{pts.text}</span>}
                        </li>
                      );
                    })}
                    {!expanded && all.length > SHIFT_COLLAPSE_AT && (
                      <li className="scr-feed-shift-more" aria-hidden>
                        ⋯ 외 {all.length - SHIFT_COLLAPSE_AT}건
                      </li>
                    )}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
        {footer}
      </div>
    </div>
  );
}
