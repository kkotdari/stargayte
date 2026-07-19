import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { MoreVertical, Monitor, UserPlus } from "lucide-react";
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
import { attachPopover } from "../../utils/popover";
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

// 카드 오른쪽 세로점세개(⋮) — 누르면 메모/리플레이 저장/삭제를 드롭다운 메뉴로 연다(요청).
// 위치/뒤집기는 다른 드롭다운과 같은 attachPopover, 바깥 클릭/포커스 이동으로 닫는다.
function MatchActionsMenu({
  match, canDelete, onMemo, onDelete,
}: {
  match: Match; canDelete: boolean; onMemo: (m: Match) => void; onDelete: (m: Match) => void;
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
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || dropRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  const items: { key: string; label: string; danger?: boolean; onSelect: () => void }[] = [
    { key: "memo", label: match.note ? "메모 수정" : "메모", onSelect: () => onMemo(match) },
    ...(match.replay ? [{ key: "download", label: "리플레이 저장", onSelect: () => void downloadReplay(match) }] : []),
    ...(canDelete ? [{ key: "delete", label: "삭제", danger: true, onSelect: () => onDelete(match) }] : []),
  ];

  return (
    <div className="scr-match-menu">
      <button
        type="button" ref={anchorRef}
        className="scr-match-memo-btn scr-match-kebab-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="더보기" aria-haspopup="menu" aria-expanded={open}
      >
        <MoreVertical size={16} />
      </button>
      {open && createPortal(
        <div className="scr-menu-pop-drop scr-match-menu-drop scr-scroll" ref={dropRef} role="menu">
          {items.map((it) => (
            <button
              key={it.key} type="button" role="menuitem"
              className={cx("scr-menu-pop-opt", it.danger && "scr-match-menu-opt-danger")}
              onClick={() => { it.onSelect(); setOpen(false); }}
            >
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
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
            <div className="scr-match-date-head" data-date-label={dateWithDow(g.date)}>{dateWithDow(g.date)}</div>
            {g.items.map(({ row: r }) => {
              const o1 = outcomeFor("team1", r.result);
              const o2 = outcomeFor("team2", r.result);
              return (
              <div key={r.id} className="scr-match-trow">
                {/* 머리줄 — N경기는 빼고(요청) 경기번호 · 맵 · 등록자, 오른쪽에 액션. */}
                <div className="scr-match-trow-head">
                  <span className="scr-match-id">#{highlightMatchNo(r.raw.matchNo, matchNoQuery ?? "")}</span>
                  {r.raw.createdBy && <span className="scr-match-trow-by">등록: {r.raw.createdBy.nickname}</span>}
                  <MatchActionsMenu
                    match={r.raw} canDelete={canDelete}
                    onMemo={onMemo} onDelete={setDeleteTarget}
                  />
                </div>
                {/* 맵 이름은 길어서 머리줄이 아니라 그 아래 별도 줄에(요청). 플레이시간도 그 옆에. */}
                {(r.raw.mapName || r.raw.durationSeconds != null) && (
                  <div className="scr-match-trow-map-line">
                    {r.raw.mapName && <span className="scr-match-trow-map">{r.raw.mapName}</span>}
                    {r.raw.durationSeconds != null && (
                      <span className="scr-match-trow-dur">{Math.round(r.raw.durationSeconds / 60)}분</span>
                    )}
                  </div>
                )}
                {/* 팀 2열 + 그 아래 각 팀 승/패(요청). 헤더·컬럼 구분선 없이 로우만. */}
                <div className="scr-match-trow-grid">
                  <div className="scr-match-trow-team">
                    <div className="scr-match-trow-roster">
                      {r.team1.map((s) => (
                        <PlayerCell
                          key={s.memberId} slot={s} players={r.team1} memberOf={memberOf}
                          highlighted={!!highlightMemberIds?.has(s.memberId)} openProfile={openMemberProfile}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="scr-match-trow-team">
                    <div className="scr-match-trow-roster">
                      {r.team2.map((s) => (
                        <PlayerCell
                          key={s.memberId} slot={s} players={r.team2} memberOf={memberOf}
                          highlighted={!!highlightMemberIds?.has(s.memberId)} openProfile={openMemberProfile}
                        />
                      ))}
                    </div>
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
