import { useState } from "react";
import { MoreHorizontal, Trophy } from "lucide-react";
import KakaoShareButton from "../../components/common/KakaoShareButton";
import { cx } from "../../utils/format";
import { normalizeSearchText } from "../../utils/memberSearch";
import { shareThumb, type KakaoShareContent } from "../../utils/kakaoShare";
import type { RankingShiftEntry, RankingShift } from "../../types";
import { ActivityCard } from "./ActivityCard";

// 랭크 변동 카드 — 활동와 카카오톡 공유 페이지(?sv=rankingShift)가 같은 마크업을 쓰도록
// 분리했다(요청: "순위변동 발생도 카톡공유 가능, 활동는 다 가능하게"). 헤더 오른쪽
// 케밥(actions)과 하단(댓글, footer)은 쓰는 쪽이 끼워 넣는다.

// 순위가 어디서 어디로 갔나 — "1 → 3위".
//
// 예전에는 이 자리에 ▲2 / ▼1 같은 배지를 뒀는데 걷어냈다(요청) — 통계표의 순위 변동
// 배지와 생김새가 같아, 같은 화면을 오가며 볼 때 어느 쪽 이야기인지 헷갈린다.
// 여기서는 몇 계단이 아니라 몇 위에서 몇 위로 갔는지를 그대로 읽히게 둔다.
//
// 그 달에 처음 순위가 잡힌 사람은 "3위 진입"이다(요청: 괄호 없이) — 예전엔 "신규 → 3위"
// 라고 적었는데, 화살표는 '어디서 왔다'는 말이라 오기 전 자리가 있는 것처럼 읽힌다. 그런
// 자리는 없다. 괄호도 뗐다: 괄호는 곁다리라는 뜻인데 이 사람에게는 그게 본 이야기다.
export function shiftLabel(e: RankingShiftEntry): { text: string; cls: string } {
  if (e.from == null) return { text: `${e.to}위 진입`, cls: "scr-activity-shift-new" };
  const d = e.from - e.to;
  return {
    text: `${e.from} → ${e.to}위`,
    cls: d > 0 ? "scr-activity-shift-up" : "scr-activity-shift-down",
  };
}

/* (삭제) 포인트 증감 표기("+100p") — 순위가 몇 위에서 몇 위로 갔는지가 이 카드의 이야기
   전부라, 그 옆의 수치는 읽는 데 보태는 것 없이 줄만 길게 했다(요청: 포인트 변동은 제거).
   포인트 자체는 통계 화면이 자리를 갖고 보여준다. */

/** 카드·공유에 쓰는 제목 — "일일 랭크 변동"에서 "일일"을 뗐다(요청). 하루치를 모아
 *  한 번 남기는 카드라는 건 카드가 하루에 하나뿐인 것으로 이미 드러나고, 제목은 짧을수록
 *  목록에서 잘리지 않는다. 유형은 제목이 아니라 카드 안의 좌우 두 칸이 말한다(요청:
 *  개인전·팀전을 한 카드에 반씩). */
export const RANK_SHIFT_TITLE = "랭크 변동";

/** 카드가 좌우로 나눠 그리는 순서와 이름 — 서버가 sections에 담아 주는 유형들이다.
 *  유형이 늘면 여기 한 줄만 더하면 된다(저장 형식은 안 바뀐다). */
const SECTION_LABELS: { matchType: string; label: string }[] = [
  { matchType: "0101", label: "개인전" },
  { matchType: "0102", label: "팀전" },
];

const sectionOf = (shift: RankingShift, matchType: string): RankingShiftEntry[] =>
  shift.sections.find((s) => s.matchType === matchType)?.shifts ?? [];

export function rankShiftShareContent(shift: RankingShift): KakaoShareContent {
  const summary = SECTION_LABELS
    .map(({ matchType, label }) => {
      const rows = sectionOf(shift, matchType);
      if (rows.length === 0) return null;
      return `${label} ${rows.slice(0, 2).map((e) => `${e.nickname} ${shiftLabel(e).text}`).join(" · ")}`;
    })
    .filter(Boolean)
    .join(" / ");
  return {
    title: RANK_SHIFT_TITLE,
    description: summary,
    ...shareThumb("rankShift"),
    link: `${window.location.origin}/?sv=rankingShift&sid=${shift.id}`,
    fallbackText: `[스타게이트] ${RANK_SHIFT_TITLE}\n${summary}`,
  };
}

// 카드 우상단 케밥 — 카카오 공유만 담는다(스냅샷은 삭제 개념이 없다). 너 나와 케밥과
// 같은 CSS(scr-activity-chal-menu) 재사용.
export function RankingShiftMenu({ shift }: { shift: RankingShift }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="scr-activity-chal-menu">
      <button
        type="button" className="scr-activity-post-menu-btn scr-activity-kebab-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="더보기" aria-haspopup="menu" aria-expanded={open}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          {/* 백드롭 클릭은 '메뉴 닫기'에서 끝나야 한다(지적) — 안 끊으면 그 클릭이 카드
              본체까지 올라간다. */}
          <div
            className="scr-activity-add-backdrop"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            aria-hidden
          />
          <div className="scr-menu-pop-drop scr-activity-chal-menu-drop" role="menu">
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
  /** 하루치 스냅샷 하나 — 개인전·팀전이 그 안의 sections에 함께 들어 있다(요청). */
  shift: RankingShift;
  timeText?: string;
  dateLabel?: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  // 활동 검색어에 걸린 사람 — 순위변동 줄에도 로스터와 같은 하이라이트를 준다(지적).
  highlightMemberIds?: Set<string>;
  highlightTerms?: string[];
}) {
  /* 접기/펴기는 없앴다(요청: 길어도 줄이지 않기) — 하루에 한 장뿐인 카드라 길어도
     목록을 밀어내지 않고, 접혀 있으면 정작 궁금한 아래쪽 순위가 늘 가려졌다. */
  const cols = SECTION_LABELS.map((s) => ({ ...s, rows: sectionOf(shift, s.matchType) }));
  return (
    <ActivityCard
      dateLabel={dateLabel}
      icon={<Trophy size={16} aria-hidden />}
      label={RANK_SHIFT_TITLE}
      timeText={timeText}
      actions={actions}
      // 개인전·팀전을 한 카드에 반씩 나눠 담는다(요청) — 예전엔 유형마다 카드가 따로
      // 떠서 같은 날 아침에 두 장이 나란히 붙었다. 가운데 구분선은 위아래를 조금 띄워
      // (요청: 살짝 위아래 패딩) 카드 테두리까지 닿지 않게 한다.
      bodyClassName="scr-activity-shift-split"
      comment={footer}
    >
      {cols.map(({ label, rows }) => (
        <section className="scr-activity-shift-col" key={label}>
          <h4 className="scr-activity-shift-col-head">{label}</h4>
          {rows.length === 0 ? (
            <p className="scr-activity-shift-none">변동 없음</p>
          ) : (
            <ul className="scr-activity-shift-list">
              {rows.map((e) => {
                const rank = shiftLabel(e);
                return (
                  <li
                    key={`${e.memberId}-${e.to}`}
                    className={cx("scr-activity-shift-row",
                      (highlightMemberIds?.has(e.memberId)
                        || highlightTerms?.some((t) => normalizeSearchText(e.nickname).includes(t)))
                        && "scr-activity-shift-row-hl")}
                  >
                    <span className="scr-activity-shift-name">{e.nickname}</span>
                    {/* "조조 1 → 3위" — 몇 계단인지를 배지로 말하는 대신 어디서 어디로
                        갔는지를 그대로 적는다. */}
                    <span className={rank.cls}>{rank.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </ActivityCard>
  );
}
