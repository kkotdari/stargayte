import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { MoreVertical, Monitor, CircleHelp } from "lucide-react";
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
import KakaoShareButton from "../../components/common/KakaoShareButton";
import type { KakaoShareContent } from "../../utils/kakaoShare";
import type { Match, Member, MatchSlot, MatchResult } from "../../types";

type Outcome = "win" | "loss" | "draw" | "notHeld";
function outcomeFor(side: "team1" | "team2", result: MatchResult): Outcome {
  if (result === "draw") return "draw";
  if (result === "not_held") return "notHeld";
  return side === result ? "win" : "loss";
}
const OUTCOME_LABEL: Record<Outcome, string> = { win: "승", loss: "패", draw: "무", notHeld: "미실시" };
const OUTCOME_CLASS: Record<Outcome, string> = { win: "scr-win", loss: "scr-loss", draw: "scr-draw", notHeld: "scr-draw" };

// 컴퓨터/비회원 여부에 따라 표시 이름을 정한다 — PlayerCell(펼친 로스터)과 접힌 상태의
// 팀 요약("누구 외 N명")이 같은 이름 규칙을 쓰도록 공용으로 뺐다.
function resolveSlotName(slot: MatchSlot, players: MatchSlot[], memberOf: (id: string) => Member | undefined): string {
  const isComputer = isComputerSlot(slot.memberId);
  const isUnreg = isUnregisteredSlot(slot.memberId);
  const m = isComputer || isUnreg ? undefined : memberOf(slot.memberId);
  return isComputer
    ? (slot.rawName || computerSlotLabel(players, slot.memberId))
    : isUnreg
      ? (slot.rawName || unregisteredSlotLabel(players, slot.memberId))
      : (m?.nickname ?? slot.memberId);
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
  const mapPart = match.mapName ? ` · ${match.mapName}` : "";
  return {
    title: `${t1} vs ${t2}`,
    description: `${resultLabel}${mapPart} · ${match.date}`,
    link: `${window.location.origin}/?sv=match&sid=${match.id}`,
    fallbackText: `[스타게이트 경기결과]\n${t1} vs ${t2}\n결과: ${resultLabel}${mapPart}\n${match.date}`,
  };
}

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
  const name = resolveSlotName(slot, players, memberOf);
  const clickable = !isComputer && !isUnreg;
  return (
    <button
      type="button"
      className={cx("scr-mt-player", highlighted && "scr-mt-player-hl", !clickable && "scr-mt-player-static")}
      onClick={clickable ? (e) => { e.stopPropagation(); openProfile(slot.memberId); } : undefined}
      disabled={!clickable}
    >
      <span className="scr-team-name-wrap">
        <span className="scr-mt-name">{name}</span>
        <RaceBadge race={slot.race} size={13} circleLetter className="scr-team-name-race" />
      </span>
      {/* 아바타 제거(요청) — 컴퓨터/비회원만 작은 아이콘으로 구분을 남긴다. 닉네임
          왼쪽이 아니라 오른쪽에(요청). */}
      {isComputer
        ? <Monitor size={12} className="scr-chip-computer-icon" />
        : isUnreg
          ? <CircleHelp size={12} className="scr-chip-computer-icon" />
          : null}
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
  match, canDelete, memberOf, onMemo, onDelete,
}: {
  match: Match; canDelete: boolean; memberOf: (id: string) => Member | undefined;
  onMemo: (m: Match) => void; onDelete: (m: Match) => void;
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
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
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
        </div>,
        document.body,
      )}
    </div>
  );
}

// 펼쳤을 때 카드 하단에 붙는 상세 스탯 표(요청) — 양 팀 전원을 한 표에 모아 유효커맨드
// 높은 순으로 정렬한다. 리플레이 파싱값(apm/eapm/커맨드/유효커맨드)은 수기등록이면 없어서 '–'.
function MatchStatsTable({
  team1, team2, memberOf,
}: {
  team1: MatchSlot[]; team2: MatchSlot[]; memberOf: (id: string) => Member | undefined;
}) {
  const rows = [
    ...team1.map((s) => ({ s, players: team1 })),
    ...team2.map((s) => ({ s, players: team2 })),
  ]
    .map(({ s, players }) => ({
      nickname: resolveSlotName(s, players, memberOf),
      rawName: s.rawName ?? "",
      race: s.race,
      apm: s.apm, cmd: s.cmdCount, eapm: s.eapm, ecmd: s.effectiveCmdCount,
    }))
    // 유효커맨드(effectiveCmdCount) 높은 순 — 값이 없으면(수기등록) 맨 아래로.
    .sort((a, b) => (b.ecmd ?? -1) - (a.ecmd ?? -1));
  const n = (v: number | null) => (v == null ? "–" : v.toLocaleString());
  return (
    <div className="scr-match-stats-table-wrap scr-scroll" onClick={(e) => e.stopPropagation()}>
      <table className="scr-match-stats-table">
        <thead>
          <tr>
            <th className="scr-mst-left">닉네임</th>
            <th className="scr-mst-left">플레이어</th>
            <th>종족</th><th>APM</th><th>커맨드</th><th>유효APM</th><th>유효커맨드</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="scr-mst-left">{r.nickname}</td>
              <td className="scr-mst-left scr-mst-raw">{r.rawName || "–"}</td>
              <td className="scr-mst-race"><RaceBadge race={r.race} size={14} circleLetter /></td>
              <td>{n(r.apm)}</td>
              <td>{n(r.cmd)}</td>
              <td>{n(r.eapm)}</td>
              <td className="scr-mst-ecmd">{n(r.ecmd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MatchList({
  rows, memberOf, onMemo, onDeleted, loading, highlightMemberIds,
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
  // 경기 목록은 기본 접힌 상태(맵/시간 + 팀 요약 + 승패만)로 시작하고, 행을 누르면
  // 그 경기만 펼쳐져 케밥메뉴·등록자·전체 로스터가 드러난다(요청).
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const toggleExpanded = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

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
              const expanded = expandedIds.has(r.id);
              const outcomes = (
                <div className="scr-match-trow-outcomes">
                  <span className={cx("scr-match-trow-outcome", OUTCOME_CLASS[o1])}>{OUTCOME_LABEL[o1]}</span>
                  <span className={cx("scr-match-trow-outcome", OUTCOME_CLASS[o2])}>{OUTCOME_LABEL[o2]}</span>
                </div>
              );
              return (
              <div
                key={r.id} className="scr-match-trow scr-match-trow-clickable"
                onClick={() => toggleExpanded(r.id)} role="button" tabIndex={0}
                aria-expanded={expanded}
              >
                {/* 윗줄 — 맵·플레이시간과 함께 등록자·케밥메뉴도 여기 표시(요청). 내용이 없어도
                    줄 높이를 예약해 카드마다 로스터 시작 위치가 흔들리지 않게 한다. */}
                <div className="scr-match-trow-topline">
                  <div className="scr-match-trow-map-line">
                    {r.raw.mapName && <span className="scr-match-trow-map">{r.raw.mapName}</span>}
                    {r.raw.durationSeconds != null && (
                      <span className="scr-match-trow-dur">({Math.round(r.raw.durationSeconds / 60)}분)</span>
                    )}
                  </div>
                  <div className="scr-match-trow-topmeta">
                    {r.raw.createdBy && <span className="scr-match-trow-by">등록: {r.raw.createdBy.nickname}</span>}
                    <MatchActionsMenu
                      match={r.raw} canDelete={canDelete} memberOf={memberOf}
                      onMemo={onMemo} onDelete={setDeleteTarget}
                    />
                  </div>
                </div>
                {/* 팀1(2열) · 승/패 · 팀2(2열) — 접힘/펼침 공통으로 전원 표시(요청). */}
                <div className="scr-match-trow-grid">
                  <div className="scr-match-trow-team">
                    <div className="scr-match-trow-roster scr-match-trow-roster-grid">
                      {r.team1.map((s) => (
                        <PlayerCell
                          key={s.memberId} slot={s} players={r.team1} memberOf={memberOf}
                          highlighted={!!highlightMemberIds?.has(s.memberId)} openProfile={openMemberProfile}
                        />
                      ))}
                    </div>
                  </div>
                  {outcomes}
                  <div className="scr-match-trow-team">
                    <div className="scr-match-trow-roster scr-match-trow-roster-grid">
                      {r.team2.map((s) => (
                        <PlayerCell
                          key={s.memberId} slot={s} players={r.team2} memberOf={memberOf}
                          highlighted={!!highlightMemberIds?.has(s.memberId)} openProfile={openMemberProfile}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                {/* 펼치면 접힘 내용 아래에 상세 스탯 표(양 팀 전원, 유효커맨드 높은 순). */}
                {expanded && <MatchStatsTable team1={r.team1} team2={r.team2} memberOf={memberOf} />}
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
