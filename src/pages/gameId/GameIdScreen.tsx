import { useEffect, useMemo, useState } from "react";
import { Shuffle, X, Monitor, UserPlus, RotateCcw, Trash2 } from "lucide-react";
import Select from "../../components/common/Select";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import FilterItem from "../../components/common/FilterItem";
import { Spinner } from "../../components/common/Feedback";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { isAdminRole } from "../../constants/roles";
import { activeMemberSearchTerms, splitSearchTerms } from "../../utils/memberSearch";
import type { ReplayNameMappingEntry, ReplayNameMappingKind } from "../../types";

// 유저 검색과 같은 다중 단어(OR) 매칭 — 게임아이디(rawName) 자체나 연결된 회원의
// 닉네임/배틀태그 중 하나라도 걸리면 통과시킨다.
function entryMatchesQuery(entry: ReplayNameMappingEntry, query: string): boolean {
  const terms = splitSearchTerms(query);
  if (terms.length === 0) return true;
  return terms.some((t) => (
    entry.rawName.toLowerCase().includes(t)
    || (entry.member?.nickname.toLowerCase().includes(t) ?? false)
    || (entry.member?.battletag.toLowerCase().includes(t) ?? false)
  ));
}

// 필터 체크박스는 회원/비회원/컴퓨터 셋만 — 아무 것도 안 켜면 미지정을 포함해 전부
// 보여준다(체크는 "이것만 좁혀 보기"이지, 미지정을 감추는 스위치가 아니다).
const FILTER_OPTS: { value: ReplayNameMappingKind; label: string }[] = [
  { value: "member", label: "회원" },
  { value: "unregistered", label: "비회원" },
  { value: "computer", label: "컴퓨터" },
];

interface MappingRowProps {
  entry: ReplayNameMappingEntry;
  memberOptions: { value: string; label: string }[];
  onSaved: (entry: ReplayNameMappingEntry) => void;
  // 휴지통(매핑 데이터 자체 삭제)이 성공하면 목록에서 이 행 자체를 없앤다 — X(미지정으로
  // 되돌리기)와 달리 이쪽은 "되돌아와 다시 보이는" 대상이 아니다.
  onDeleted: (rawName: string) => void;
  // 조회는 회원 누구나 가능하지만 수정/삭제는 운영자만 — false면 정보만 읽기전용으로
  // 보여주고 선택/삭제/되돌리기 버튼과 확인창을 전부 렌더링하지 않는다.
  isAdmin: boolean;
}

// 일반 회원(조회 전용) 행 — 편집/삭제 버튼 없이 지금 연결 상태만 보여준다.
function ReadonlyMappingRow({ entry }: { entry: ReplayNameMappingEntry }) {
  return (
    <div className="scr-usermap-row">
      <div className="scr-usermap-raw-name-wrap">
        <span className="scr-mono scr-usermap-raw-name">{entry.rawName}</span>
      </div>
      <div className="scr-usermap-row-mapping">
        <span className="scr-usermap-current scr-usermap-current-readonly">
          {entry.kind === "member" && entry.member ? (
            <span className="scr-usermap-member-name">{entry.member.nickname}</span>
          ) : entry.kind === "computer" ? (
            <><Monitor size={13} /> <span className="scr-usermap-member-name">컴퓨터</span></>
          ) : entry.kind === "unregistered" ? (
            <><UserPlus size={13} /> <span className="scr-usermap-member-name">비회원</span></>
          ) : (
            <span className="scr-usermap-unresolved-label">미지정</span>
          )}
        </span>
      </div>
    </div>
  );
}

// 매핑 칸(2번째 컬럼) — 2스텝 선택. 1스텝은 회원/비회원/컴퓨터 중 뭘로 연결할지 고르는
// 셀렉트 하나뿐이고(비회원/컴퓨터는 고르는 즉시 확정), 회원을 고르면 그 자리가 2스텝(실제
// 회원 검색 셀렉트)으로 넘어간다. 예전엔 버튼 3개를 나란히 펼쳐놨는데, 모바일 좁은 칸에서
// 줄바꿈되고 옆의 취소(X) 버튼까지 밀려나 삐져나오는 문제가 있었다 — 셀렉트 하나(2스텝의
// "회원 선택"과 같은 컴포넌트)로 통일해 폭 문제를 원천적으로 없앤다.
const KIND_PICK_OPTS = FILTER_OPTS;

function PickerButtons({
  memberOptions, memberId, onPickComputer, onPickUnregistered, onPickMemberOpen, onPickMember, showMemberSelect, busy,
  restoreLabel, onRestore,
}: {
  memberOptions: { value: string; label: string }[];
  memberId: string;
  onPickComputer: () => void;
  onPickUnregistered: () => void;
  onPickMemberOpen: () => void;
  onPickMember: (id: string) => void;
  showMemberSelect: boolean;
  busy: boolean;
  restoreLabel: string | null;
  onRestore: () => void;
}) {
  if (showMemberSelect) {
    return (
      <Select
        size="sm" className="scr-usermap-member-select"
        value={memberId} options={memberOptions} onChange={onPickMember}
        placeholder="회원 선택" disabled={busy}
        minDropWidth={280}
      />
    );
  }
  return (
    <div className="scr-usermap-picker-icons">
      <Select
        size="sm" className="scr-usermap-kind-select"
        value="" options={KIND_PICK_OPTS}
        placeholder="선택"
        onChange={(v) => {
          if (v === "member") onPickMemberOpen();
          else if (v === "unregistered") onPickUnregistered();
          else if (v === "computer") onPickComputer();
        }}
        disabled={busy}
      />
      {/* 방금 삭제(미지정으로 되돌리기)한 걸 실수로 눌렀을 때, 다시 처음부터 고르지
          않고 바로 원래대로 되돌릴 수 있게 한다. */}
      {restoreLabel && (
        <button
          type="button" className="scr-icon-btn scr-usermap-restore-btn" onClick={onRestore} disabled={busy}
          title={`복구: ${restoreLabel}`} aria-label={`복구: ${restoreLabel}`}
        >
          <RotateCcw size={13} />
        </button>
      )}
    </div>
  );
}

const KIND_LABEL: Record<ReplayNameMappingKind, string> = {
  member: "회원", computer: "컴퓨터", unregistered: "비회원", unresolved: "미지정",
};

function MappingRow({ entry, memberOptions, onSaved, onDeleted, isAdmin }: MappingRowProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // 휴지통 전용 확인창 — X(미지정으로 되돌리기)와 달리 매핑 데이터(replay_aliases 행)
  // 자체를 지우는 동작이라 별도 상태로 구분한다(같은 상태를 공유하면 둘 중 어느
  // 버튼을 눌렀는지 구별할 수 없다).
  const [confirmHardDeleteOpen, setConfirmHardDeleteOpen] = useState(false);
  // 편집 중(연결 상태를 고치려고 선택 UI를 연 상태) 취소 전용 확인창 — 아직 저장 전이라
  // 서버에 아무 영향이 없고, 단순히 편집 UI를 닫고 원래 보여주던 정보로 되돌아간다.
  const [confirmCancelEditOpen, setConfirmCancelEditOpen] = useState(false);
  // 회원뿐 아니라 컴퓨터/비회원으로도 잘못 바뀔 수 있으니(실수하기 쉬운 화면이라는
  // 피드백), 셋 중 뭘 고르든 저장 전에 한 번 더 확인한다.
  const [pendingPick, setPendingPick] = useState<{ kind: ReplayNameMappingKind; memberId?: string } | null>(null);
  // 매핑돼 있는 행은 평소엔 정보 칩만 조용히 보여주다가, 눌렀을 때만 선택 버튼
  // 세트로 바뀐다(정보가 틀렸을 때 고치는 용도). 미지정 행은 처음부터 버튼 세트다.
  const [editing, setEditing] = useState(false);
  const [showMemberSelect, setShowMemberSelect] = useState(false);
  const [memberId, setMemberId] = useState("");
  // 방금 이 화면에서 삭제(미지정으로 되돌리기)한 매핑을 기억해뒀다가 "복구" 버튼으로
  // 되살릴 수 있게 한다 — 실수로 X를 눌렀을 때 처음부터 다시 고르지 않아도 되게.
  const [restoreTarget, setRestoreTarget] = useState<{ kind: ReplayNameMappingKind; memberId?: string } | null>(null);

  // 일반 회원은 조회만 — 이 아래 상태/핸들러는 전부 운영자 전용 편집 UI를 위한 것이라
  // 안 쓰이지만, 위 useState 호출들은 Hooks 규칙상 항상 실행돼야 하므로 그 뒤에서만 갈린다.
  if (!isAdmin) return <ReadonlyMappingRow entry={entry} />;

  // 바뀌기 직전 값을 항상 기억해뒀다가 "되돌리기"로 되살릴 수 있게 한다 — 삭제뿐 아니라
  // 다른 값으로 잘못 재지정했을 때도 마찬가지로 실수를 되돌릴 수 있어야 하므로, 미지정이
  // 아니었던 값이 바뀔 때마다(삭제든 재지정이든) 그 직전 값을 남긴다.
  const apply = async (kind: ReplayNameMappingKind, nextMemberId?: string) => {
    const prevKind = entry.kind;
    const prevMemberId = entry.member?.id;
    setErr("");
    setBusy(true);
    try {
      const saved = await api.setReplayNameMapping(entry.rawName, kind, nextMemberId);
      onSaved(saved);
      setEditing(false);
      setShowMemberSelect(false);
      setMemberId("");
      setRestoreTarget(prevKind !== "unresolved" ? { kind: prevKind, memberId: prevMemberId } : null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    setConfirmDeleteOpen(false);
    void apply("unresolved");
  };
  // 하드 삭제 — 이 raw_name으로 등록된 경기가 하나라도 있으면 서버가 막는다(그럼
  // 미지정으로 남아있어야 정상이므로). 성공하면 목록에서 이 행 자체가 사라진다.
  const confirmHardDelete = async () => {
    setConfirmHardDeleteOpen(false);
    setErr("");
    setBusy(true);
    try {
      await api.deleteReplayNameMapping(entry.rawName);
      onDeleted(entry.rawName);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "삭제에 실패했어요.");
      setBusy(false);
    }
  };
  const confirmPick = () => {
    if (!pendingPick) return;
    const { kind, memberId: pickedMemberId } = pendingPick;
    setPendingPick(null);
    void apply(kind, pickedMemberId);
  };
  const cancelPick = () => { setPendingPick(null); setMemberId(""); };
  const cancelEdit = () => {
    setConfirmCancelEditOpen(false);
    setEditing(false);
    setShowMemberSelect(false);
    setMemberId("");
  };
  const restore = () => { if (restoreTarget) void apply(restoreTarget.kind, restoreTarget.memberId); };
  const restoreLabel = restoreTarget
    ? (restoreTarget.kind === "member" ? memberOptions.find((o) => o.value === restoreTarget.memberId)?.label ?? "회원" : KIND_LABEL[restoreTarget.kind])
    : null;

  const pickerVisible = entry.kind === "unresolved" || editing;

  return (
    <div className="scr-usermap-row">
      <div className="scr-usermap-raw-name-wrap">
        <span className="scr-mono scr-usermap-raw-name">{entry.rawName}</span>
        {/* 게임아이디 바로 옆에 휴지통(완전삭제)을 둔다 — 이 이름 자체를 지우는
            동작이라 이름과 같은 칸에 있는 게 더 직관적이다. */}
        {entry.kind !== "unresolved" && !editing && (
          <button
            type="button" className="scr-icon-btn scr-usermap-delete-btn" onClick={() => setConfirmHardDeleteOpen(true)}
            disabled={busy} aria-label="매핑 완전 삭제" title="매핑 완전 삭제"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="scr-usermap-row-mapping">
        {pickerVisible ? (
          <PickerButtons
            memberOptions={memberOptions}
            memberId={memberId}
            busy={busy}
            showMemberSelect={showMemberSelect}
            onPickComputer={() => setPendingPick({ kind: "computer" })}
            onPickUnregistered={() => setPendingPick({ kind: "unregistered" })}
            onPickMemberOpen={() => setShowMemberSelect(true)}
            onPickMember={(id) => { setMemberId(id); setPendingPick({ kind: "member", memberId: id }); }}
            restoreLabel={entry.kind === "unresolved" ? restoreLabel : null}
            onRestore={restore}
          />
        ) : (
          <button type="button" className="scr-usermap-current" onClick={() => setEditing(true)} disabled={busy}>
            {entry.kind === "member" && entry.member ? (
              <span className="scr-usermap-member-name">{entry.member.nickname}</span>
            ) : entry.kind === "computer" ? (
              <><Monitor size={13} /> <span className="scr-usermap-member-name">컴퓨터</span></>
            ) : (
              <><UserPlus size={13} /> <span className="scr-usermap-member-name">비회원</span></>
            )}
          </button>
        )}
        {/* 매핑 정보(회원/컴퓨터/비회원)가 있으면 편집 중이 아닐 때 항상 보여준다 —
            누르면 그 매핑을 지우고 미지정으로 되돌린다(소프트 되돌리기 — 매핑 데이터
            자체는 남아있고, 목록에도 계속 "미지정"으로 보인다). 게임아이디 옆 휴지통은
            매핑 데이터 자체를 지우는 별개 동작이다. 처음부터 미지정이라 되돌릴 매핑
            자체가 없는 상태(unresolved)에는 보여주지 않는다. 편집 중(아래)일 때는
            대신 편집 취소 버튼을 보여준다 — 저장 전 상태에서 굳이 "미지정으로
            되돌리기"(서버 저장)를 할 이유가 없고 오히려 실수하기 쉽다. */}
        {entry.kind !== "unresolved" && !editing && (
          <button
            type="button" className="scr-icon-btn scr-usermap-cancel-btn" onClick={() => setConfirmDeleteOpen(true)}
            disabled={busy} aria-label="매핑 되돌리기" title="매핑 되돌리기 (미지정 상태로)"
          >
            <X size={14} />
          </button>
        )}
        {/* 편집 중 취소 — 아직 아무것도 저장하지 않은 상태라 서버에 영향 없이 그냥
            편집 UI를 닫고 원래 보여주던 정보로 되돌아간다. */}
        {editing && (
          <button
            type="button" className="scr-icon-btn scr-usermap-cancel-btn" onClick={() => setConfirmCancelEditOpen(true)}
            disabled={busy} aria-label="편집 취소" title="편집 취소 (되돌리기)"
          >
            <RotateCcw size={14} />
          </button>
        )}
        {/* 방금 이 자리에서 바뀐(삭제든 재지정이든) 값이 있으면, 편집 중이 아닐 때 바로
            되돌리기 버튼을 둔다 — 실수로 잘못 연결/삭제했을 때 처음부터 다시 고르지
            않아도 된다. */}
        {restoreTarget && !pickerVisible && (
          <button
            type="button" className="scr-icon-btn scr-usermap-restore-btn" onClick={restore}
            disabled={busy} title={`복구: ${restoreLabel}`} aria-label={`복구: ${restoreLabel}`}
          >
            <RotateCcw size={13} />
          </button>
        )}
      </div>

      {/* 이 화면의 행은 모달과 달리 계속 화면에 남아있어서(닫으면 사라지는 모달 속
          에러와 달리) 실패 메시지가 다음 시도 전까지 계속 떠 있었다(실제로 지적받은
          문제) — 직접 닫을 수 있는 X 버튼을 둔다. */}
      {err && (
        <div className="scr-err scr-usermap-row-err">
          <span>{err}</span>
          <button type="button" className="scr-usermap-err-dismiss" onClick={() => setErr("")} aria-label="오류 메시지 닫기">
            <X size={12} />
          </button>
        </div>
      )}

      {confirmDeleteOpen && (
        <ConfirmDialog
          title="매핑 되돌리기"
          message={`"${entry.rawName}" 연결을 지우고 미지정으로 되돌릴까요?`}
          confirmLabel="되돌리기"
          onConfirm={confirmDelete}
          onCancel={() => { setConfirmDeleteOpen(false); setEditing(false); }}
        />
      )}

      {confirmCancelEditOpen && (
        <ConfirmDialog
          title="편집 취소"
          message="편집 중이던 내용을 취소하고 원래 상태로 되돌릴까요?"
          confirmLabel="취소"
          cancelLabel="계속 편집"
          onConfirm={cancelEdit}
          onCancel={() => setConfirmCancelEditOpen(false)}
        />
      )}

      {confirmHardDeleteOpen && (
        <ConfirmDialog
          title="매핑 완전 삭제"
          message={`"${entry.rawName}" 매핑을 완전히 삭제해요. 삭제하면 되돌릴 수 없어요. (이 이름으로 등록된 경기 기록이 있으면 삭제할 수 없어요)`}
          confirmLabel="완전 삭제"
          onConfirm={confirmHardDelete}
          onCancel={() => setConfirmHardDeleteOpen(false)}
        />
      )}

      {pendingPick && (
        <ConfirmDialog
          title="연결 확인"
          message={`"${entry.rawName}"을(를) "${
            pendingPick.kind === "member"
              ? memberOptions.find((o) => o.value === pendingPick.memberId)?.label ?? ""
              : KIND_LABEL[pendingPick.kind]
          }"(으)로 연결할까요? 잘못 연결하기 쉬우니 한 번 더 확인해 주세요.`}
          confirmLabel="연결"
          onConfirm={confirmPick}
          onCancel={cancelPick}
        />
      )}
    </div>
  );
}

// 조회는 회원 누구나, 수정은 운영자만 — 리플레이 원본 이름(rawName, 게임 아이디)
// 하나를 기준으로, 그게 지금 회원/컴퓨터/비회원 중 무엇으로 연결돼 있는지(또는 아직
// 미지정인지) 표로 보여주고, 운영자는 그 자리에서 바로 바꿀 수 있다. 회원으로 연결하면
// 그 이름으로 남아있던 기존 경기 참가 기록도 소급으로 그 회원에게 연결된다(서버가
// 처리) — 경기 자체를 하나하나 찾아 고칠 필요가 없다.
export default function GameIdScreen() {
  const user = useAppStore((s) => s.user);
  const isAdmin = !!user && isAdminRole(user.roles);
  const members = useAppStore((s) => s.members);
  const memberOptions = useMemo(
    () => members
      .filter((m) => m.status === "active")
      .map((m) => ({ value: m.id, label: `${m.nickname} (${m.battletag})` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [members],
  );

  const [entries, setEntries] = useState<ReplayNameMappingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<Set<ReplayNameMappingKind>>(new Set());
  const suggestions = useMemo(() => activeMemberSearchTerms(members), [members]);

  const load = () => {
    setLoading(true);
    setError("");
    api.listReplayNameMappings()
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : "목록을 불러오지 못했어요."))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const toggleFilter = (kind: ReplayNameMappingKind) => {
    setKindFilter((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind); else next.add(kind);
      return next;
    });
  };

  const rows = useMemo(() => {
    const filtered = entries
      .filter((e) => kindFilter.size === 0 || kindFilter.has(e.kind))
      .filter((e) => entryMatchesQuery(e, search));
    // 아직 매핑 안 된(미지정) 항목을 맨 위에 — 지금 당장 처리해야 할 것부터 보이게
    // 한다. 그 안에서도, 그리고 나머지(이미 연결된 것들)도 전부 최근에 등장한 순으로.
    const byRecency = (a: ReplayNameMappingEntry, b: ReplayNameMappingEntry) =>
      (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "");
    const unresolved = filtered.filter((e) => e.kind === "unresolved").sort(byRecency);
    const resolved = filtered.filter((e) => e.kind !== "unresolved").sort(byRecency);
    return [...unresolved, ...resolved];
  }, [entries, search, kindFilter]);

  return (
    <div className="scr-screen">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">게임아이디</h1>
      </div>

      {/* 경기/랭킹/통계/회원과 똑같은 SearchFilterBar를 그대로 쓴다 — 게임아이디 화면만의
          필터/검색 UI를 따로 두지 않는다(요청: "회원/게임아이디만의 요소가 없도록"). */}
      <SearchFilterBar
        count={rows.length}
        countLabel="건"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="유저"
        suggestions={suggestions}
        filterPanel={
          <FilterItem label="유형">
            <div className="scr-checkbox-group scr-checkbox-group-row scr-usermap-kind-filter">
              {FILTER_OPTS.map((o) => (
                <label key={o.value} className="scr-checkbox-field">
                  <input type="checkbox" checked={kindFilter.has(o.value)} onChange={() => toggleFilter(o.value)} />
                  {o.label}
                </label>
              ))}
            </div>
          </FilterItem>
        }
      />

      <div className="scr-hint scr-hint-left scr-usermap-desc">
        {isAdmin ? (
          <>
            게임아이디의 주인을 찾아주세요.
            <br />
            정보는 결과 등록시 리플레이의 유저를 연결하는데 사용돼요.
          </>
        ) : (
          "게임아이디가 회원과 어떻게 연결돼 있는지 볼 수 있어요. 연결 수정은 운영자만 할 수 있어요."
        )}
      </div>

      {error && <div className="scr-err">{error}</div>}

      <div className="scr-usermap-table-v2">
        <div className="scr-usermap-row scr-usermap-row-head">
          <span>게임아이디</span>
          <span>연결 상태</span>
        </div>
        {loading ? (
          <div className="scr-empty"><Spinner size={18} /></div>
        ) : rows.length === 0 ? (
          <div className="scr-empty">
            <Shuffle size={12} style={{ marginRight: 6 }} /> 조건에 맞는 항목이 없어요.
          </div>
        ) : (
          rows.map((e) => (
            <MappingRow
              key={e.rawName}
              entry={e}
              memberOptions={memberOptions}
              onSaved={(saved) => setEntries((prev) => prev.map((p) => (p.rawName === saved.rawName ? saved : p)))}
              onDeleted={(rawName) => setEntries((prev) => prev.filter((p) => p.rawName !== rawName))}
              isAdmin={isAdmin}
            />
          ))
        )}
      </div>
    </div>
  );
}
