import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Monitor, User } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import RaceBadge from "../../components/common/RaceBadge";
import { cleanMapName } from "../../utils/mapName";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { isAdminRole } from "../../constants/roles";
import { isComputerSlot, computerSlotLabel } from "../../constants/computerSlot";
import { isUnregisteredSlot, unregisteredSlotLabel } from "../../constants/unregisteredSlot";
import { cx } from "../../utils/format";
import { attachPopover } from "../../utils/popover";
import { normalizeSearchText } from "../../utils/memberSearch";
import { renderReplaySummaryParts, type SummaryPart } from "../../utils/replaySummaryText";
import KakaoShareButton from "../../components/common/KakaoShareButton";
import type { KakaoShareContent } from "../../utils/kakaoShare";
import type { Match, Member, MatchSlot, MatchResult } from "../../types";

type Outcome = "win" | "loss" | "draw" | "notHeld";
function outcomeFor(side: "team1" | "team2", result: MatchResult): Outcome {
  if (result === "draw") return "draw";
  if (result === "not_held") return "notHeld";
  return side === result ? "win" : "loss";
}

// 컴퓨터/비회원 여부에 따라 표시 이름을 정한다 — PlayerCell(펼친 로스터)과 접힌 상태의
// 팀 요약("누구 외 N명")이 같은 이름 규칙을 쓰도록 공용으로 뺐다.
export function resolveSlotName(slot: MatchSlot, players: MatchSlot[], memberOf: (id: string) => Member | undefined): string {
  const isComputer = isComputerSlot(slot.memberId);
  const isUnreg = isUnregisteredSlot(slot.memberId);
  const m = isComputer || isUnreg ? undefined : memberOf(slot.memberId);
  return isComputer
    ? (slot.rawName || computerSlotLabel(players, slot.memberId))
    : isUnreg
      ? (slot.rawName || unregisteredSlotLabel(players, slot.memberId))
      : (m?.nickname ?? slot.memberId);
}

// 리플레이 전황 요약 — 저장된 건 문장이 아니라 '무슨 일이 있었나'라서, 볼 때마다 지금의
// 회원 연결로 이름을 다시 풀어 문장을 만든다(요청). 그래서 누가 닉네임을 바꾸거나 비회원
// 게임 아이디가 회원으로 연결되면 이미 등록된 경기의 요약도 바로 따라온다.
function summaryPartsOf(
  r: SearchListRow, memberOf: (id: string) => Member | undefined,
): SummaryPart[] | null {
  const slots = [...r.team1, ...r.team2];
  const nameByRaw = new Map<string, string>();
  // 이름 → 팀 번호. 문장 안의 이름에 팀 색을 입히기 위한 것이다(요청).
  const teamByName = new Map<string, 1 | 2>();
  const add = (list: typeof r.team1, team: 1 | 2) => {
    list.forEach((slot) => {
      const name = resolveSlotName(slot, slots, memberOf);
      if (slot.rawName) nameByRaw.set(slot.rawName, name);
      if (name) teamByName.set(name, team);
    });
  };
  add(r.team1, 1);
  add(r.team2, 2);
  return renderReplaySummaryParts(
    r.raw.summaryData,
    (raw) => nameByRaw.get(raw) ?? raw,
    (name) => teamByName.get(name),
  );
}

/** 요약 조각을 팀 색이 입혀진 문장으로 — 이름만 span으로 감싸고 나머지는 그대로 흐른다. */
export function SummaryText({ parts }: { parts: SummaryPart[] }) {
  return (
    <>
      {parts.map((p, i) => (p.team
        ? <span key={i} className={p.team === 1 ? "scr-sum-team1" : "scr-sum-team2"}>{p.text}</span>
        : <span key={i}>{p.text}</span>))}
    </>
  );
}

// 접힌 상태 요약 줄에 쓰는 "누구 외 N명" — 팀원이 하나뿐이면 그 이름만.
function teamSummaryName(team: MatchSlot[], memberOf: (id: string) => Member | undefined): string {
  if (team.length === 0) return "";
  const first = resolveSlotName(team[0], team, memberOf);
  return team.length > 1 ? `${first} 외 ${team.length - 1}명` : first;
}

// 케밥 메뉴의 카카오톡 공유에 쓸 경기 요약 — 양 팀 이름과 결과/맵/날짜.
function matchShareContent(match: Match, memberOf: (id: string) => Member | undefined): KakaoShareContent {
  const t1 = teamSummaryName(match.team1, memberOf) || "팀1";
  const t2 = teamSummaryName(match.team2, memberOf) || "팀2";
  const resultLabel =
    match.result === "draw" ? "무승부"
    : match.result === "not_held" ? "미실시"
    : `${outcomeFor("team1", match.result) === "win" ? t1 : t2} 승`;
  const cleanedMap = cleanMapName(match.mapName);
  const mapPart = cleanedMap ? ` · ${cleanedMap}` : "";
  return {
    title: `${t1} vs ${t2}`,
    description: `${resultLabel}${mapPart} · ${match.date}`,
    link: `${window.location.origin}/?sv=match&sid=${match.id}`,
    fallbackText: `[스타게이트 게임결과]\n${t1} vs ${t2}\n결과: ${resultLabel}${mapPart}\n${match.date}`,
  };
}

// 매치업 한 편(피드 전용) — 너 나와! 카드의 팀 로스터(scr-challenge-side)와 같은 CSS로
// 세로 나열한다(요청: "게임결과의 팀로스터와 너 나와의 팀로스터를 맞출거야"). 프사를
// 더하고, 종족 배지는 닉네임 오른쪽(기존 규칙 유지). 컴퓨터/비회원은 작은 아이콘으로 구분.
function MatchupSide({
  team, memberOf, highlightMemberIds, highlightTerms,
}: {
  team: MatchSlot[]; memberOf: (id: string) => Member | undefined;
  highlightMemberIds?: Set<string>; highlightTerms?: string[];
}) {
  return (
    <div className="scr-challenge-side">
      {team.map((s, i) => {
        const name = resolveSlotName(s, team, memberOf);
        const m = memberOf(s.memberId);
        const nameLc = normalizeSearchText(name);
        const hl = highlightMemberIds?.has(s.memberId) || !!highlightTerms?.some((t) => nameLc.includes(t));
        const isComputer = isComputerSlot(s.memberId);
        const isUnreg = isUnregisteredSlot(s.memberId);
        return (
          <div key={`${s.memberId}-${i}`} className="scr-challenge-side-block">
            <div className="scr-challenge-side-row">
              <span className={cx("scr-challenge-person", hl && "scr-challenge-person-hit")}>
                {/* 컴퓨터/비회원은 프사 자리에 아이콘 — 팀과 무관하게 항상 닉네임 왼쪽
                    (요청). 비회원은 사람 아이콘. */}
                {isComputer || isUnreg ? (
                  <span className="scr-matchup-slot-icon" aria-hidden>
                    {isComputer ? <Monitor size={14} /> : <User size={14} />}
                  </span>
                ) : (
                  <Avatar member={{ id: s.memberId, nickname: name, avatar: m?.avatar ?? null }} size={20} />
                )}
                <span className="scr-challenge-person-name">{name}</span>
                <RaceBadge race={s.race} size={13} circleLetter className="scr-team-name-race" />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface SearchListRow {
  id: number;
  date: string;
  team1: MatchSlot[];
  team2: MatchSlot[];
  result: MatchResult;
  raw: Match;
}

interface MatchListProps {
  rows: SearchListRow[];
  memberOf: (id: string) => Member | undefined;
  // 삭제 성공 후 목록을 새로고침하기 위한 콜백(호출부가 이미 쓰는 reload를 그대로 넘겨준다).
  onDeleted: () => void;
  // 유저 검색 중이면 그 회원(들)을 로스터에서 하이라이트 표시한다
  highlightMemberIds?: Set<string>;
  // memberId 매칭에 더해 표시 이름을 검색어로도 매칭해 하이라이트한다(별칭/비회원 보완).
  highlightTerms?: string[];
}

// 첨부된 리플레이 파일을 목록에서 바로 내려받는다 — 경기상세(MatchDetailModal)/수정
// (MatchModal)과 같은 방식(blob → 임시 a태그 클릭).
async function downloadReplay(match: Match) {
  if (!match.replay) return;
  try {
    const blob = await api.downloadReplay(match.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = match.replay.displayName;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    // 목록 카드의 짧은 액션이라 별도 에러 표시 영역을 두지 않는다(경기상세와 같은 원칙).
  }
}

// 카드 오른쪽 세로점세개(⋮) — 누르면 메모/리플레이 저장/삭제를 드롭다운 메뉴로 연다(요청).
// 위치/뒤집기는 다른 드롭다운과 같은 attachPopover, 바깥 클릭/포커스 이동으로 닫는다.
function MatchActionsMenu({
  match, canDelete, memberOf, onDelete,
}: {
  match: Match; canDelete: boolean; memberOf: (id: string) => Member | undefined;
  onDelete: (m: Match) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // useLayoutEffect(페인트 전) — 위치를 첫 페인트 전에 잡아, 엉뚱한 자리에서 한 프레임
  // 늦게 뜨거나 튀어 보이지 않고 즉시 제자리에 뜬다(요청: "즉시 뜨길 기대").
  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !dropRef.current) return;
    return attachPopover(anchorRef.current, dropRef.current, { growToContent: true, maxWidth: 200 });
  }, [open]);
  // 바깥을 눌러 닫는 일은 아래 백드롭(전체 화면 투명 판)이 맡는다 — 예전엔 document의
  // pointerdown으로 닫았는데, 그러면 '닫기'만 되고 그 뒤에 이어지는 click은 그대로
  // 포스트 본체까지 가서 묶음이 같이 펼쳐지거나 접혔다(지적: 케밥만 닫히고 끝나야 한다).
  // pointerdown이 메뉴를 닫아 버리니 백드롭은 click이 오기도 전에 사라져 막을 수가 없다.
  // 백드롭 하나로 통일하면 그 판이 클릭을 삼키므로 '닫기'에서 정확히 끝난다(피드의 다른
  // 메뉴들과 같은 방식).

  const items: { key: string; label: string; danger?: boolean; onSelect: () => void }[] = [
    ...(match.replay ? [{ key: "download", label: "리플레이 저장", onSelect: () => void downloadReplay(match) }] : []),
    ...(canDelete ? [{ key: "delete", label: "삭제", danger: true, onSelect: () => onDelete(match) }] : []),
  ];

  return (
    <div className="scr-match-menu">
      <button
        type="button" ref={anchorRef}
        className="scr-match-memo-btn scr-match-kebab-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label="더보기" aria-haspopup="menu" aria-expanded={open}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && createPortal(
        // 포털이라도 이벤트는 리액트 트리를 따라 올라간다 — 묶음 목록의 '접기'가 같이
        // 눌리지 않게 백드롭과 드롭 양쪽에서 끊는다(위 시트와 같은 이유).
        <>
          <div
            className="scr-feed-add-backdrop"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            aria-hidden
          />
        <div
          className="scr-menu-pop-drop scr-match-menu-drop scr-scroll" ref={dropRef} role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((it) => (
            <button
              key={it.key} type="button" role="menuitem"
              className={cx("scr-menu-pop-opt", it.danger && "scr-match-menu-opt-danger")}
              onClick={(e) => { e.stopPropagation(); it.onSelect(); setOpen(false); }}
            >
              {it.label}
            </button>
          ))}
          {/* 이 경기 결과를 카카오톡으로 공유(요청). 누르면 메뉴를 닫는다. */}
          <KakaoShareButton
            variant="menu"
            content={() => matchShareContent(match, memberOf)}
            onDone={() => setOpen(false)}
          />
        </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// 예전엔 여기 사람별 총합 스탯 표와, 그걸 띄우는 전체화면 시트(시간축 그래프 포함)가
// 있었다 — 통째로 걷어냈다(요청: 기능 삭제).

// 피드 카드(MatchCard)의 본문 — 경기 한 장의 로스터·요약·케밥을 그린다. 이름은 목록이지만
// 이제 '목록 화면'은 없다: 예전에 이걸 날것으로 쓰던 카톡 단일 경기 공유도 피드 카드를
// 그대로 쓰게 바뀌어(요청), 부르는 곳은 MatchCard 하나뿐이다. 그래서 날짜 그룹 머리글·
// 로딩 스피너·비-매치업 로스터처럼 '목록'이던 시절의 갈래는 다 걷어냈다(요청: 잘못
// 쓰이지 않게) — 다시 목록으로 쓰려면 그때 필요한 것만 되살리는 편이 낫다.
export default function MatchList({
  rows, memberOf, onDeleted, highlightMemberIds, highlightTerms,
}: MatchListProps) {
  const user = useAppStore((s) => s.user);
  const deleteMatchAction = useAppStore((s) => s.deleteMatch);
  // 삭제는 운영자만 — 카드의 메모(연필)와 달리 실제 경기 기록 자체를 지우는 동작이라
  // 작성자 본인이어도 허용하지 않는다(오삭제 방지, MatchDetailModal의 canDelete와 동일 기준).
  const canDelete = !!user && isAdminRole(user.roles);
  const [deleteTarget, setDeleteTarget] = useState<Match | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 카드 안에서 펼치던 상세(스탯 표)는 없앴다(요청) — 그래서 로우 자체의 펼침/접힘도
  // 통째로 사라졌다. 게임번호·등록자는 펼쳐야 보이던 걸 늘 보이는 자리로 올렸다(요청).

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteMatchAction(deleteTarget.id);
      setDeleteTarget(null);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="scr-match-list-panel-v2">
      <div className="scr-match-cards">
        {rows.map((r) => {
              const o1 = outcomeFor("team1", r.result);
              const o2 = outcomeFor("team2", r.result);
              return (
              <div key={r.id} className="scr-match-trow">
                {/* 윗줄 — 이제 오른쪽 위 케밥메뉴만 남는다. 게임번호는 감췄고(요청),
                    등록자는 카드 머리의 시각 옆으로 옮겼다(요청). */}
                <div className="scr-match-trow-topline">
                  <div className="scr-match-trow-topmeta">
                    <MatchActionsMenu
                      match={r.raw} canDelete={canDelete} memberOf={memberOf}
                      onDelete={setDeleteTarget}
                    />
                  </div>
                </div>
                {/* 로스터 — 너 나와! 매치업과 같은 구조(각 팀 세로 나열 + 가운데 vs +
                    이긴 편 쪽 승/무 배지, 요청). 예전엔 목록 화면용 그리드 로스터가 따로
                    있었는데, 그걸 쓰던 화면이 없어져 걷어냈다. */}
                <div className="scr-challenge-matchup scr-feed-match-matchup">
                  <MatchupSide
                    team={r.team1} memberOf={memberOf}
                    highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms}
                  />
                  {/* 승/무 배지 — 너 나와!와 동일하게 vs 양옆에 이긴 편 쪽만 보이고,
                      해당 없는 쪽은 자리만 예약(투명)해 vs가 좌우로 안 흔들린다. */}
                  <span className="scr-challenge-arrow-row">
                    <span className={cx("scr-challenge-inline-win", o1 === "draw" && "scr-challenge-inline-draw", o1 !== "win" && o1 !== "draw" && "scr-challenge-inline-win-hidden")}>
                      {o1 === "draw" ? "무" : "승"}
                    </span>
                    <span className="scr-challenge-arrow scr-challenge-arrow-vs" aria-hidden="true">vs</span>
                    <span className={cx("scr-challenge-inline-win", o2 === "draw" && "scr-challenge-inline-draw", o2 !== "win" && o2 !== "draw" && "scr-challenge-inline-win-hidden")}>
                      {o2 === "draw" ? "무" : "승"}
                    </span>
                  </span>
                  <MatchupSide
                    team={r.team2} memberOf={memberOf}
                    highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms}
                  />
                </div>
                {r.result === "not_held" && <div className="scr-feed-match-notheld">미실시</div>}
                {/* 맵·플레이시간 — 요약을 읽기 전에 먼저 보는 정보라 요약 바로 위에 두고,
                    접힌 상태에서도 보인다(요청). */}
                {(cleanMapName(r.raw.mapName) || r.raw.durationSeconds != null) && (
                  <div className="scr-match-trow-map-line scr-match-trow-map-meta">
                    {cleanMapName(r.raw.mapName) && <span className="scr-match-trow-map">{cleanMapName(r.raw.mapName)}</span>}
                    {r.raw.durationSeconds != null && (
                      <span className="scr-match-trow-dur">({Math.round(r.raw.durationSeconds / 60)}분)</span>
                    )}
                  </div>
                )}
                {/* 리플레이에서 규칙으로 뽑은 전황 요약(요청: 팀 로스터 아래에 배치) — 접힌
                    상태에서도 보인다. 이 줄이 카드의 '읽을거리'라 펼치기 전에 눈에
                    들어와야 한다. */}
                {(() => {
                  const parts = summaryPartsOf(r, memberOf);
                  return parts && parts.length > 0 ? (
                    <div className="scr-match-trow-summary"><SummaryText parts={parts} /></div>
                  ) : null;
                })()}
              </div>
              );
        })}
      </div>

      {/* 확인창도 이 컴포넌트 안(=묶음 목록 안)에서 그려진다 — 클릭이 목록으로 올라가면
          지울지 묻는 중에 목록이 접힌다. 감싸서 끊는다. */}
      {deleteTarget && (
        <div onClick={(e) => e.stopPropagation()}>
        <ConfirmDialog
          title="게임결과를 삭제할까요?"
          message="삭제하면 되돌릴 수 없어요."
          confirmLabel={deleting ? "삭제 중..." : "삭제"}
          cancelLabel="취소"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
        </div>
      )}
    </div>
  );
}
