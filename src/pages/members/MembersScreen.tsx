import { useEffect, useMemo, useState } from "react";
import { UserPlus, X, Monitor, CircleHelp, RotateCcw, Settings2, ChevronDown } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import Pagination from "../../components/common/Pagination";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import PillTabs from "../../components/common/PillTabs";
import FilterItem from "../../components/common/FilterItem";
import Select from "../../components/common/Select";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import { LoadingMark } from "../../components/common/Feedback";
import MemberDetailModal from "../../modals/MemberDetailModal";
import CreateMemberModal from "../../modals/CreateMemberModal";
import { cx } from "../../utils/format";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { ROLE_INFO, isAdminRole } from "../../constants/roles";
import { activeMemberSearchTerms, memberMatchesQuery, splitSearchTerms } from "../../utils/memberSearch";
import type { Member, MemberRole, MemberStatus, ReplayNameMappingEntry, ReplayNameMappingKind } from "../../types";

const PAGE_SIZE = 20;

// 목록 배지 — 그냥 "회원(0203)"만인 경우는 굳이 배지를 보여줄 필요가 없어 운영자(0202)만
// 배지로 보여준다.
const ROLE_BADGE_ORDER: MemberRole[] = ["0202"];
const ROLE_BADGE_CLASS: Partial<Record<MemberRole, string>> = {
  "0202": "scr-status-admin",
};

function memberRoleBadges(roles: MemberRole[]): { role: MemberRole; label: string; className: string }[] {
  return ROLE_BADGE_ORDER
    .filter((r) => roles.includes(r))
    .map((r) => ({ role: r, label: ROLE_INFO[r], className: ROLE_BADGE_CLASS[r]! }));
}

type StatusFilter = "all" | MemberStatus;
const FILTER_OPTS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "pending", label: "승인대기" },
  { value: "active", label: "활성" },
  { value: "suspended", label: "정지" },
  { value: "withdrawn", label: "탈퇴" },
];

const STATUS_LABEL: Record<MemberStatus, string> = {
  pending: "승인대기",
  active: "활성",
  suspended: "정지",
  withdrawn: "탈퇴",
};

// 비회원(하단 목록) 행에서 고를 수 있는 연결 대상 — 회원을 고르면 2스텝(회원 검색
// 셀렉트)으로 넘어간다.
const KIND_PICK_OPTS: { value: ReplayNameMappingKind; label: string }[] = [
  { value: "member", label: "회원" },
  { value: "unregistered", label: "비회원" },
  { value: "computer", label: "컴퓨터" },
];

// 저장 전 확인창 하나로 공유하는 보류 동작.
interface PendingAction {
  title: string;
  message: string;
  confirmLabel: string;
  run: () => void;
}

// 운영자 전용 — 회원 목록 + 게임아이디 연결을 한 화면으로 통합(요청: "회원페이지와
// 게임아이디 페이지 통합"). 회원 행을 누르면 아래로 펼쳐지며 그 회원에게 매핑된
// 게임아이디 목록이 나오고(연결 해제/추가 가능), 회원이 아닌 이름들(비회원/미지정)과
// 컴퓨터 이름들은 하단에 같은 양식의 별도 목록으로 나온다.
export default function MembersScreen() {
  const members = useAppStore((s) => s.members);
  const currentUser = useAppStore((s) => s.user);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [detailFor, setDetailFor] = useState<Member | null>(null);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  // 여러 회원을 동시에 펼쳐둘 수 있다(요청: "다른 유저의 상세가 닫히지 않게") — 그래서
  // 단일 id 대신 Set. 열고 닫는 트랜지션은 CSS(grid-template-rows 0fr↔1fr)가 맡는다.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) => setExpandedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const isAdmin = !!currentUser && isAdminRole(currentUser.roles);
  const suggestions = useMemo(() => activeMemberSearchTerms(members), [members]);

  // 게임아이디(리플레이 이름) 매핑 전체 — 회원 행 펼침(그 회원의 아이디들)과 하단
  // 비회원/컴퓨터 목록이 함께 쓴다.
  const [entries, setEntries] = useState<ReplayNameMappingEntry[]>([]);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listReplayNameMappings()
      .then(setEntries)
      .catch((e) => setMapError(e instanceof Error ? e.message : "게임아이디 목록을 불러오지 못했어요."))
      .finally(() => setMapLoading(false));
  }, []);

  const rows = useMemo(() => {
    const list = members.filter((m) =>
      (filter === "all" || m.status === filter) &&
      memberMatchesQuery(m, query));
    // 기본(전체) 목록은 최신 가입순. 특정 상태로 좁혀서 볼 때는 그 상태가 된 시점(승인대기는
    // 사실상 가입 시점과 같고, 활성/정지/탈퇴는 마지막으로 상태가 바뀐 시점) 기준 최신순으로 본다.
    return [...list].sort((a, b) => {
      const aTime = filter === "all" ? a.createdAt : a.updatedAt;
      const bTime = filter === "all" ? b.createdAt : b.updatedAt;
      return bTime.localeCompare(aTime);
    });
  }, [members, filter, query]);

  // 필터가 바뀌면 결과 목록도 바뀌니 1페이지로 되돌린다
  useEffect(() => { setPage(1); setExpandedIds(new Set()); }, [filter, query]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 회원 id → 그 회원으로 매핑된 게임아이디들(최근 등장 순).
  const idsByMember = useMemo(() => {
    const map = new Map<string, ReplayNameMappingEntry[]>();
    for (const e of entries) {
      if (e.kind !== "member" || !e.member) continue;
      const list = map.get(e.member.id) ?? [];
      list.push(e);
      map.set(e.member.id, list);
    }
    for (const list of map.values()) list.sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""));
    return map;
  }, [entries]);

  const byRecency = (a: ReplayNameMappingEntry, b: ReplayNameMappingEntry) =>
    (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "");

  // 하단 목록 검색 — 회원 검색어와 같은 인풋을 그대로 쓴다(이름 자체에 다중 단어 OR 매칭).
  const rawNameMatches = (rawName: string) => {
    const terms = splitSearchTerms(query);
    if (terms.length === 0) return true;
    return terms.some((t) => rawName.toLowerCase().includes(t));
  };
  // 비회원 플레이어 = 아직 회원이 아닌 이름들 — 미지정(unresolved, 확인 안 됨)을 위에,
  // 비회원 확정(unregistered)을 아래에, 각각 최근 등장 순.
  const nonMemberRows = useMemo(() => {
    const filtered = entries.filter((e) => (e.kind === "unresolved" || e.kind === "unregistered") && rawNameMatches(e.rawName));
    const unresolved = filtered.filter((e) => e.kind === "unresolved").sort(byRecency);
    const unregistered = filtered.filter((e) => e.kind === "unregistered").sort(byRecency);
    return [...unresolved, ...unregistered];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, query]);
  const computerRows = useMemo(
    () => entries.filter((e) => e.kind === "computer" && rawNameMatches(e.rawName)).sort(byRecency),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, query],
  );

  const memberOptions = useMemo(
    () => members
      .filter((m) => m.status === "active")
      .map((m) => ({ value: m.id, label: `${m.nickname} (${m.battletag})` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [members],
  );

  // 매핑 저장 공통 — 성공하면 목록의 해당 행을 교체한다.
  const applyMapping = async (rawName: string, kind: ReplayNameMappingKind, memberId?: string) => {
    setMapError("");
    setBusy(true);
    try {
      const saved = await api.setReplayNameMapping(rawName, kind, memberId);
      setEntries((prev) => prev.map((p) => (p.rawName === saved.rawName ? saved : p)));
    } catch (e) {
      setMapError(e instanceof Error ? e.message : "저장에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  const memberLabel = (id: string) => memberOptions.find((o) => o.value === id)?.label ?? "회원";

  return (
    <div className="scr-screen scr-members-screen-v2">
      <div className="scr-v2-toolbar scr-members-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">회원</h1>
      </div>

      {/* "생성" 버튼 — 타이틀 줄 아래 별도 줄에 가운데 정렬, 1.2배 확대(요청: "경기 화면의
          등록 버튼, 회원 화면의 생성 버튼과 동일한 CSS"). */}
      {isAdmin && (
        <div className="scr-v2-primary-row">
          <button type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm" onClick={() => setCreating(true)}>
            <UserPlus size={14} /> 생성
          </button>
        </div>
      )}

      {/* 경기/랭킹/통계와 똑같은 SearchFilterBar를 그대로 쓴다 — 회원 화면만의 필터/검색
          UI를 따로 두지 않는다(요청: "회원/게임아이디만의 요소가 없도록"). */}
      <SearchFilterBar
        count={rows.length}
        countLabel="명"
        searchValue={query}
        onSearchChange={setQuery}
        searchPlaceholder="유저 입력 또는 @로 목록 띄우기"
        suggestions={suggestions}
        showSearch={false}
        filterPanel={
          <FilterItem label="상태">
            <PillTabs options={FILTER_OPTS} value={filter} onChange={setFilter} aria-label="회원 상태" />
          </FilterItem>
        }
      />

      <div className="scr-members-list-v2">
        {rows.length === 0 && <div className="scr-empty">표시할 회원이 없어요.</div>}

        <div className="scr-member-rows">
          {pageRows.map((m) => {
            const ids = idsByMember.get(m.id) ?? [];
            const expanded = expandedIds.has(m.id);
            return (
              <div key={m.id} className={cx("scr-member-row-wrap", expanded && "scr-member-row-wrap-open")}>
                {/* 행 클릭 = 아래로 펼쳐 그 회원의 게임아이디 목록을 보여준다(요청) —
                    상세(승인/정지 등 관리)는 펼친 안의 "관리" 버튼으로. */}
                <button type="button" className="scr-member-row" onClick={() => toggleExpanded(m.id)}>
                  <span className="scr-member-row-cluster">
                    <Avatar member={m} size={36} />
                    <div className="scr-member-row-main">
                      <span className="scr-member-row-name">{m.nickname}</span>
                      <span className="scr-member-row-tag scr-mono">{m.battletag}</span>
                    </div>
                    {memberRoleBadges(m.roles).map((badge) => (
                      <span key={badge.role} className={cx("scr-status-badge", badge.className)}>{badge.label}</span>
                    ))}
                    <span className={cx("scr-status-badge", `scr-status-${m.status}`)}>{STATUS_LABEL[m.status]}</span>
                    <ChevronDown size={14} className={cx("scr-member-row-chevron", expanded && "scr-member-row-chevron-open")} />
                  </span>
                </button>

                {/* 펼침 패널 — 항상 렌더링해 두고 CSS grid-rows 0fr↔1fr로 높이를
                    애니메이션한다(요청: 열고 닫을 때 트랜지션). */}
                <div className={cx("scr-member-gameids-clip", expanded && "scr-member-gameids-clip-open")} aria-hidden={!expanded}>
                  <div className="scr-member-gameids-clip-inner">
                  <div className="scr-member-gameids">
                    <div className="scr-member-gameids-head">
                      <span>게임아이디 {ids.length > 0 && <b>{ids.length}</b>}</span>
                      {isAdmin && (
                        <button type="button" className="scr-btn scr-btn-sm scr-member-manage-btn" onClick={() => setDetailFor(m)}>
                          <Settings2 size={13} /> 관리
                        </button>
                      )}
                    </div>
                    {mapLoading ? (
                      <LoadingMark />
                    ) : ids.length === 0 ? (
                      <div className="scr-member-gameids-empty">연결된 게임아이디가 없어요.</div>
                    ) : (
                      ids.map((e) => (
                        <div key={e.rawName} className="scr-member-gameid-item">
                          <span className="scr-mono scr-member-gameid-name">{e.rawName}</span>
                          {isAdmin && (
                            <button
                              type="button" className="scr-icon-btn scr-member-gameid-unlink"
                              disabled={busy}
                              onClick={() => setPending({
                                title: "연결 해제",
                                message: `"${e.rawName}"을(를) ${m.nickname}에게서 떼어 미지정으로 되돌릴까요?`,
                                confirmLabel: "해제",
                                run: () => void applyMapping(e.rawName, "unresolved"),
                              })}
                              aria-label="연결 해제" title="연결 해제 (미지정으로)"
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      ))
                    )}
                    {/* 이 회원에게 새 게임아이디를 연결 — 하단 비회원(미지정 포함) 목록의
                        이름 중에서 고른다(편집 가능 요청). */}
                    {isAdmin && nonMemberRows.length > 0 && (
                      <div className="scr-member-gameid-add">
                        <Select
                          size="sm" className="scr-member-gameid-add-select"
                          value="" placeholder="+ 아이디 연결"
                          options={nonMemberRows.map((e) => ({ value: e.rawName, label: e.rawName }))}
                          onChange={(rawName) => setPending({
                            title: "연결 확인",
                            message: `"${rawName}"을(를) "${m.nickname}"에게 연결할까요?`,
                            confirmLabel: "연결",
                            run: () => void applyMapping(rawName, "member", m.id),
                          })}
                          disabled={busy}
                          minDropWidth={220}
                        />
                      </div>
                    )}
                  </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>

      {mapError && <div className="scr-err">{mapError}</div>}

      {/* ── 비회원 플레이어 — 회원이 아닌 리플레이 이름들(미지정 포함). 회원 목록과 같은
          행 양식(요청: "목록 양식 통일 유지")로, 운영자는 그 자리에서 회원/비회원/컴퓨터로
          연결을 고칠 수 있다. */}
      {!mapLoading && nonMemberRows.length > 0 && (
        <div className="scr-members-sublist">
          <div className="scr-members-sublist-head">
            <CircleHelp size={13} /> 비회원 플레이어 <span className="scr-members-sublist-count">{nonMemberRows.length}</span>
          </div>
          <div className="scr-member-rows">
            {nonMemberRows.map((e) => (
              <NonMemberRow
                key={e.rawName}
                entry={e}
                isAdmin={isAdmin}
                busy={busy}
                memberOptions={memberOptions}
                memberLabel={memberLabel}
                onPick={(kind, memberId) => setPending({
                  title: "연결 확인",
                  message: `"${e.rawName}"을(를) "${kind === "member" && memberId ? memberLabel(memberId) : kind === "computer" ? "컴퓨터" : "비회원"}"(으)로 연결할까요?`,
                  confirmLabel: "연결",
                  run: () => void applyMapping(e.rawName, kind, memberId),
                })}
                onRevert={() => setPending({
                  title: "매핑 되돌리기",
                  message: `"${e.rawName}" 연결을 지우고 미지정으로 되돌릴까요?`,
                  confirmLabel: "되돌리기",
                  run: () => void applyMapping(e.rawName, "unresolved"),
                })}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── 컴퓨터 플레이어 — 배틀태그가 없어 회원 매핑 대상이 아니라 별도 목록(같은 양식). */}
      {!mapLoading && computerRows.length > 0 && (
        <div className="scr-members-sublist">
          <div className="scr-members-sublist-head">
            <Monitor size={13} /> 컴퓨터 플레이어 <span className="scr-members-sublist-count">{computerRows.length}</span>
          </div>
          <div className="scr-member-rows">
            {computerRows.map((e) => (
              <div key={e.rawName} className="scr-member-row scr-member-row-static">
                <span className="scr-member-row-cluster">
                  <span className="scr-mono scr-member-gameid-name">{e.rawName}</span>
                  {isAdmin && (
                    <button
                      type="button" className="scr-icon-btn scr-member-gameid-unlink"
                      disabled={busy}
                      onClick={() => setPending({
                        title: "미지정으로 되돌리기",
                        message: `"${e.rawName}"은(는) 컴퓨터가 아닌가요? 미지정으로 되돌릴까요?`,
                        confirmLabel: "되돌리기",
                        run: () => void applyMapping(e.rawName, "unresolved"),
                      })}
                      title="컴퓨터 아님 — 미지정으로 되돌리기" aria-label="미지정으로 되돌리기"
                    >
                      <RotateCcw size={13} />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {pending && (
        <ConfirmDialog
          title={pending.title}
          message={pending.message}
          confirmLabel={pending.confirmLabel}
          onConfirm={() => { const { run } = pending; setPending(null); run(); }}
          onCancel={() => setPending(null)}
        />
      )}

      {detailFor && (
        <MemberDetailModal
          member={rows.find((m) => m.id === detailFor.id) ?? detailFor}
          onClose={() => setDetailFor(null)}
        />
      )}

      {creating && <CreateMemberModal onClose={() => setCreating(false)} />}
    </div>
  );
}

// 비회원(미지정 포함) 한 행 — 이름 + 상태 배지 + (운영자) 연결 고치기 셀렉트.
// 회원을 고르면 그 자리가 회원 검색 셀렉트로 바뀐다(게임아이디 화면에서 쓰던 2스텝).
function NonMemberRow({ entry, isAdmin, busy, memberOptions, onPick, onRevert }: {
  entry: ReplayNameMappingEntry;
  isAdmin: boolean;
  busy: boolean;
  memberOptions: { value: string; label: string }[];
  memberLabel: (id: string) => string;
  onPick: (kind: ReplayNameMappingKind, memberId?: string) => void;
  onRevert: () => void;
}) {
  const [showMemberSelect, setShowMemberSelect] = useState(false);
  return (
    <div className="scr-member-row scr-member-row-static">
      <span className="scr-member-row-cluster">
        <span className="scr-mono scr-member-gameid-name">{entry.rawName}</span>
        <span className={cx("scr-status-badge", entry.kind === "unresolved" ? "scr-status-pending" : "scr-status-suspended")}>
          {entry.kind === "unresolved" ? "미지정" : "비회원"}
        </span>
        {isAdmin && (
          showMemberSelect ? (
            <span className="scr-member-row-mapctl">
              <Select
                size="sm" className="scr-member-gameid-add-select"
                value="" options={memberOptions} placeholder="회원 선택"
                onChange={(id) => { setShowMemberSelect(false); onPick("member", id); }}
                disabled={busy} minDropWidth={280}
              />
              <button
                type="button" className="scr-icon-btn scr-member-gameid-unlink" disabled={busy}
                onClick={() => setShowMemberSelect(false)} aria-label="취소" title="취소"
              >
                <X size={13} />
              </button>
            </span>
          ) : (
            <span className="scr-member-row-mapctl">
              <Select
                size="sm" className="scr-member-gameid-kind-select"
                value="" options={KIND_PICK_OPTS} placeholder="연결"
                onChange={(v) => {
                  if (v === "member") setShowMemberSelect(true);
                  else onPick(v as ReplayNameMappingKind);
                }}
                disabled={busy}
              />
              {entry.kind !== "unresolved" && (
                <button
                  type="button" className="scr-icon-btn scr-member-gameid-unlink" disabled={busy}
                  onClick={onRevert} aria-label="미지정으로 되돌리기" title="미지정으로 되돌리기"
                >
                  <RotateCcw size={13} />
                </button>
              )}
            </span>
          )
        )}
      </span>
    </div>
  );
}
