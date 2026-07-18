import { useState } from "react";
import { Pencil, Download, Trash2 } from "lucide-react";
import MatchTeams from "../../components/common/MatchTeams";
import { Spinner } from "../../components/common/Feedback";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { isAdminRole } from "../../constants/roles";
import { cx } from "../../utils/format";
import { dateWithDow } from "../../utils/date";
import type { Match, Member, MatchSlot, MatchResult } from "../../types";

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
  // 랭킹 상세 모달의 경기 이력처럼 "가볍게 훑어보는" 용도 — 카드 머리글(N경기·경기번호·
  // 삭제/메모/다운로드 버튼)을 통째로 빼고 날짜 글자도 줄인다(요청: "경기번호 몇경기 라벨
  // 삭제 / 날짜 글자 축소 / 삭제 수정버튼 삭제"). 남는 건 날짜 + 대진(승/패)뿐.
  compact?: boolean;
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
  rows, memberOf, onMemo, onDeleted, loading, highlightMemberIds, matchNoQuery, compact = false,
}: MatchListProps) {
  const groups = groupByDate(rows);
  const user = useAppStore((s) => s.user);
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
            <div className={cx("scr-match-date-head", compact && "scr-match-date-head-compact")}>{dateWithDow(g.date)}</div>
            {g.items.map(({ row: r, gameNo }) => (
              <div key={r.id} className="scr-match-card">
                {/* compact(랭킹 상세 이력)에선 머리글(N경기·경기번호·액션 버튼)을 통째로 뺀다. */}
                {!compact && (
                  <div className="scr-match-card-head">
                    <span className="scr-match-seq">
                      {gameNo}경기 <span className="scr-match-id">#{highlightMatchNo(r.raw.matchNo, matchNoQuery ?? "")}</span>
                    </span>
                    <div className="scr-match-card-actions">
                      {canDelete && (
                        <button
                          type="button"
                          className="scr-match-memo-btn scr-match-delete-btn"
                          onClick={() => setDeleteTarget(r.raw)}
                          aria-label="경기 삭제"
                          title="경기 삭제"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="scr-match-memo-btn"
                        onClick={() => onMemo(r.raw)}
                        aria-label="메모 남기기"
                        title={r.raw.note || "메모 남기기"}
                      >
                        <Pencil size={15} />
                      </button>
                      {r.raw.replay && (
                        <button
                          type="button"
                          className="scr-match-memo-btn"
                          onClick={() => downloadReplay(r.raw)}
                          aria-label="리플레이 저장"
                          title={r.raw.replay.displayName}
                        >
                          <Download size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <MatchTeams
                  team1={r.team1} team2={r.team2} memberOf={memberOf} result={r.result}
                  disableProfileLink stackedOutcome compact
                  highlightMemberIds={highlightMemberIds}
                />
              </div>
            ))}
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
