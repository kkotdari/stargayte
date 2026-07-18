import { useState } from "react";
import { Pencil, Download, Trash2, Monitor, UserPlus } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import RaceBadge from "../../components/common/RaceBadge";
import { Spinner } from "../../components/common/Feedback";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { isAdminRole } from "../../constants/roles";
import { isComputerSlot, computerSlotLabel } from "../../constants/computerSlot";
import { isUnregisteredSlot, unregisteredSlotLabel } from "../../constants/unregisteredSlot";
import { cx } from "../../utils/format";
import { dateWithDow } from "../../utils/date";
import type { Match, Member, MatchSlot, MatchResult } from "../../types";

type Outcome = "win" | "loss" | "draw" | "notHeld";
function outcomeFor(side: "team1" | "team2", result: MatchResult): Outcome {
  if (result === "draw") return "draw";
  if (result === "not_held") return "notHeld";
  return side === result ? "win" : "loss";
}
const OUTCOME_LABEL: Record<Outcome, string> = { win: "승", loss: "패", draw: "무", notHeld: "미실시" };
const OUTCOME_CLASS: Record<Outcome, string> = { win: "scr-win", loss: "scr-loss", draw: "scr-draw", notHeld: "scr-draw" };

// 테이블 카드 한 칸 — [프사][닉네임][종족 영문 한 글자 배지]. 컴퓨터/비회원은 아이콘 프사에
// 원본 이름(없으면 순번 라벨)으로. 종족 배지는 요청대로 영문(circleLetter, 한글 아님).
function PlayerCell({
  slot, players, memberOf, highlighted, openProfile,
}: {
  slot: MatchSlot; players: MatchSlot[]; memberOf: (id: string) => Member | undefined;
  highlighted: boolean; openProfile: (id: string) => void;
}) {
  const isComputer = isComputerSlot(slot.memberId);
  const isUnreg = isUnregisteredSlot(slot.memberId);
  const m = isComputer || isUnreg ? undefined : memberOf(slot.memberId);
  const name = isComputer
    ? (slot.rawName || computerSlotLabel(players, slot.memberId))
    : isUnreg
      ? (slot.rawName || unregisteredSlotLabel(players, slot.memberId))
      : (m?.nickname ?? slot.memberId);
  const avatar = isComputer
    ? <Avatar icon={<Monitor size={14} className="scr-chip-computer-icon" />} size={22} />
    : isUnreg
      ? <Avatar icon={<UserPlus size={14} className="scr-chip-computer-icon" />} size={22} />
      : <Avatar member={m} size={22} />;
  const clickable = !isComputer && !isUnreg;
  return (
    <button
      type="button"
      className={cx("scr-mt-player", highlighted && "scr-mt-player-hl", !clickable && "scr-mt-player-static")}
      onClick={clickable ? (e) => { e.stopPropagation(); openProfile(slot.memberId); } : undefined}
      disabled={!clickable}
    >
      {avatar}
      <span className="scr-mt-name">{name}</span>
      <RaceBadge race={slot.race} circleLetter />
    </button>
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
  // 경기 결과 자체(팀/승패 등)를 바꾸는 정식 수정은 더 이상 카드 클릭으로 열지 않는다 —
  // 대신 회원 누구나 남길 수 있는 가벼운 메모(연필 아이콘)만 이 목록에서 연다.
  onMemo: (match: Match) => void;
  // 삭제 성공 후 목록을 새로고침하기 위한 콜백(호출부가 이미 쓰는 reload를 그대로 넘겨준다).
  onDeleted: () => void;
  loading: boolean;
  // 유저 검색 중이면 그 회원(들)을 로스터에서 하이라이트 표시한다
  highlightMemberIds?: Set<string>;
  // 경기번호 검색 중이면(부분 일치) 실제로 일치한 부분만 잘라 하이라이트 표시한다.
  matchNoQuery?: string;
}

// 경기번호(#YYMMDDHHMMSS+2자리)에서 검색어와 일치하는 부분만 강조한다 — 서버가 이제
// 정확히 일치가 아니라 부분 일치(LIKE)로 찾아주므로, 어디가 일치했는지 눈으로 바로
// 확인할 수 있어야 한다. 일치 지점이 여럿이어도 첫 번째 지점 하나만 강조한다(검색어
// 자체가 짧은 숫자 몇 자리뿐이라 여러 번 강조하면 오히려 산만하다).
function highlightMatchNo(matchNo: string, query: string) {
  if (!query) return matchNo;
  const idx = matchNo.indexOf(query);
  if (idx === -1) return matchNo;
  return (
    <>
      {matchNo.slice(0, idx)}
      <mark className="scr-match-id-highlight">{matchNo.slice(idx, idx + query.length)}</mark>
      {matchNo.slice(idx + query.length)}
    </>
  );
}

interface DateGroup {
  date: string;
  items: { row: SearchListRow; gameNo: number }[];
}

// 원래 MatchList와 카드 렌더링 로직은 동일하고, 목록 상단만 공용 ListTopHead로 바꿨다
// (경기결과/전적통계/랭킹 세 화면이 같은 상단 모듈을 쓴다).
function compareByPlayOrder(a: SearchListRow, b: SearchListRow): number {
  const at = a.raw.gameStartedAt ? new Date(a.raw.gameStartedAt).getTime() : null;
  const bt = b.raw.gameStartedAt ? new Date(b.raw.gameStartedAt).getTime() : null;
  if (at !== null && bt !== null) return at - bt;
  return a.id - b.id;
}

function groupByDate(rows: SearchListRow[]): DateGroup[] {
  const raw: { date: string; items: SearchListRow[] }[] = [];
  rows.forEach((row) => {
    const last = raw[raw.length - 1];
    if (last && last.date === row.date) last.items.push(row);
    else raw.push({ date: row.date, items: [row] });
  });
  return raw.map((g) => {
    const gameNoOf = new Map(
      [...g.items].sort(compareByPlayOrder).map((r, idx) => [r.id, idx + 1]),
    );
    return { date: g.date, items: g.items.map((row) => ({ row, gameNo: gameNoOf.get(row.id)! })) };
  });
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

export default function MatchList({
  rows, memberOf, onMemo, onDeleted, loading, highlightMemberIds, matchNoQuery,
}: MatchListProps) {
  const groups = groupByDate(rows);
  const user = useAppStore((s) => s.user);
  const openMemberProfile = useAppStore((s) => s.openMemberProfile);
  const deleteMatchAction = useAppStore((s) => s.deleteMatch);
  // 삭제는 운영자만 — 카드의 메모(연필)와 달리 실제 경기 기록 자체를 지우는 동작이라
  // 작성자 본인이어도 허용하지 않는다(오삭제 방지, MatchDetailModal의 canDelete와 동일 기준).
  const canDelete = !!user && isAdminRole(user.roles);
  const [deleteTarget, setDeleteTarget] = useState<Match | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      {rows.length === 0 && (
        <div className="scr-empty">{loading ? <Spinner size={18} /> : "표시할 경기가 없어요."}</div>
      )}

      <div className="scr-match-cards">
        {groups.map((g) => (
          <div key={g.date} className="scr-match-date-group">
            <div className="scr-match-date-head">{dateWithDow(g.date)}</div>
            {g.items.map(({ row: r }) => {
              const o1 = outcomeFor("team1", r.result);
              const o2 = outcomeFor("team2", r.result);
              return (
              <div key={r.id} className="scr-match-trow">
                {/* 머리줄 — N경기는 빼고(요청) 경기번호 · 맵 · 등록자, 오른쪽에 액션. */}
                <div className="scr-match-trow-head">
                  <span className="scr-match-id">#{highlightMatchNo(r.raw.matchNo, matchNoQuery ?? "")}</span>
                  {r.raw.mapName && <span className="scr-match-trow-map">{r.raw.mapName}</span>}
                  {r.raw.createdBy && <span className="scr-match-trow-by">등록: {r.raw.createdBy.nickname}</span>}
                  <div className="scr-match-card-actions">
                    {canDelete && (
                      <button
                        type="button"
                        className="scr-match-memo-btn scr-match-delete-btn"
                        onClick={() => setDeleteTarget(r.raw)}
                        aria-label="경기 삭제" title="경기 삭제"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                    <button
                      type="button" className="scr-match-memo-btn"
                      onClick={() => onMemo(r.raw)}
                      aria-label="메모 남기기" title={r.raw.note || "메모 남기기"}
                    >
                      <Pencil size={15} />
                    </button>
                    {r.raw.replay && (
                      <button
                        type="button" className="scr-match-memo-btn"
                        onClick={() => downloadReplay(r.raw)}
                        aria-label="리플레이 저장" title={r.raw.replay.displayName}
                      >
                        <Download size={15} />
                      </button>
                    )}
                  </div>
                </div>
                {/* 팀 2열 + 그 아래 각 팀 승/패(요청). 헤더·컬럼 구분선 없이 로우만. */}
                <div className="scr-match-trow-grid">
                  <div className="scr-match-trow-team">
                    {r.team1.map((s) => (
                      <PlayerCell
                        key={s.memberId} slot={s} players={r.team1} memberOf={memberOf}
                        highlighted={!!highlightMemberIds?.has(s.memberId)} openProfile={openMemberProfile}
                      />
                    ))}
                  </div>
                  <div className="scr-match-trow-team">
                    {r.team2.map((s) => (
                      <PlayerCell
                        key={s.memberId} slot={s} players={r.team2} memberOf={memberOf}
                        highlighted={!!highlightMemberIds?.has(s.memberId)} openProfile={openMemberProfile}
                      />
                    ))}
                  </div>
                  <div className={cx("scr-match-trow-outcome", OUTCOME_CLASS[o1])}>{OUTCOME_LABEL[o1]}</div>
                  <div className={cx("scr-match-trow-outcome", OUTCOME_CLASS[o2])}>{OUTCOME_LABEL[o2]}</div>
                </div>
              </div>
              );
            })}
          </div>
        ))}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="경기결과를 삭제할까요?"
          message="삭제하면 되돌릴 수 없어요."
          confirmLabel={deleting ? "삭제 중..." : "삭제"}
          cancelLabel="취소"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
