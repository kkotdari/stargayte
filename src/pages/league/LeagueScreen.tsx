import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, Pencil, X, Save } from "lucide-react";
import Select from "../../components/common/Select";
import { Spinner } from "../../components/common/Feedback";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import LeagueCreateModal from "../../modals/LeagueCreateModal";
import LeagueTeamsPanel from "./LeagueTeamsPanel";
import LeagueBracket from "./LeagueBracket";
import { useAppStore } from "../../store/appStore";
import { isAdminRole } from "../../constants/roles";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import type { League, LeagueListItem, LeagueMode, LeagueStatus } from "../../types";

const MODE_LABEL: Record<LeagueMode, string> = { team: "팀리그", individual: "개인리그" };
const STATUS_LABEL: Record<LeagueStatus, string> = { setup: "준비중", active: "진행중", completed: "완료" };

// 공식 리그 대진/결과 관리 — 지금은 운영 메뉴에만 노출돼 사실상 운영자만 들어오지만,
// 화면 자체는 나중에 일반 회원에게도 공개할 걸 감안해 만들어둔다(요청: "수정하는
// 사람만 팀 목록과 대진표가 따로 보이고 일반 회원들은 대진표만 보기" — "같은 화면을
// 쓰는데 운영자는 수정권한이 있어서 수정버튼 누르면 다른 편집용 UI 노출"). 운영자만
// 보이는 "수정" 토글을 누르기 전까진 운영자도 일반 회원과 같은 읽기 전용 대진표만 본다.
export default function LeagueScreen() {
  const user = useAppStore((s) => s.user);
  const isAdmin = isAdminRole(user?.roles ?? []);
  const [editMode, setEditMode] = useState(false);
  const canEdit = isAdmin && editMode;
  const [leagues, setLeagues] = useState<LeagueListItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [league, setLeague] = useState<League | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LeagueListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadList = () => {
    setLoadingList(true);
    setError("");
    api.getLeagues()
      .then((items) => {
        setLeagues(items);
        setSelectedId((prev) => (prev !== null && items.some((it) => it.id === prev) ? prev : (items[0]?.id ?? null)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "리그 목록을 불러오지 못했어요."))
      .finally(() => setLoadingList(false));
  };
  useEffect(loadList, []);

  // 선택한 리그가 바뀔 때마다 상세(팀+경기 포함)를 새로 불러온다. 수정 모드는 리그별
  // 상태가 아니라서, 수정 중 다른 리그로 전환하면 수정 모드가 그대로 딸려 들어갔다
  // (지적된 버그) — 전환 시 항상 읽기 모드로 되돌린다.
  useEffect(() => {
    setEditMode(false);
    if (selectedId === null) { setLeague(null); return; }
    setLoadingDetail(true);
    api.getLeague(selectedId)
      .then(setLeague)
      .catch((e) => setError(e instanceof Error ? e.message : "리그 정보를 불러오지 못했어요."))
      .finally(() => setLoadingDetail(false));
  }, [selectedId]);

  /* 저장 버튼 하나로 모은다(요청: "리그 저장 버튼 누르면 같이 저장") — 팀 패널과 대진표가
     각자 "지금 고칠 게 있는지(dirty) + 실제로 보내는 함수(commit)"를 여기 등록해 두고,
     이 화면이 팀구성 → 대진표 순서로 이어 부른다.

     순서가 중요하다: 새 팀은 팀구성을 보내야 id가 생기고, 대진표 배정은 그 id를 가리킨다.
     중간 응답(팀구성 결과)은 일부러 화면에 반영하지 않는다 — 반영하면 대진표 패널이 그
     새 리그로 로컬 상태를 되돌리면서 아직 안 보낸 편집이 통째로 날아간다. 마지막 응답
     하나만 반영하면 두 저장이 서로를 덮지 않는다. */
  const saversRef = useRef<Record<string, { dirty: boolean; commit: () => Promise<League> }>>({});
  const [dirtyCount, setDirtyCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const recountDirty = () => setDirtyCount(
    Object.values(saversRef.current).filter((e) => e.dirty).length,
  );
  const registerTeamsSave = useCallback(
    (entry: { dirty: boolean; commit: () => Promise<League> } | null) => {
      if (entry) saversRef.current.teams = entry; else delete saversRef.current.teams;
      recountDirty();
    }, [],
  );
  const registerBracketSave = useCallback(
    (entry: { dirty: boolean; commit: () => Promise<League> } | null) => {
      if (entry) saversRef.current.bracket = entry; else delete saversRef.current.bracket;
      recountDirty();
    }, [],
  );
  const saveAll = async () => {
    setError("");
    setSaving(true);
    try {
      let latest: League | null = null;
      for (const key of ["teams", "bracket"] as const) {
        const entry = saversRef.current[key];
        if (entry?.dirty) latest = await entry.commit();
      }
      if (latest) handleLeagueUpdated(latest);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했어요.");
    } finally {
      setSaving(false);
    }
  };

  const handleCreated = (created: League) => {
    setLeagues((prev) => [
      { id: created.id, name: created.name, mode: created.mode, status: created.status, teamCount: created.teams.length },
      ...prev,
    ]);
    setSelectedId(created.id);
  };

  // 팀 추가/삭제/로스터 편집 등 하위 패널에서 리그를 다시 불러온 뒤 — 상세 화면과
  // 목록의 팀 수 표시를 같이 최신화한다.
  const handleLeagueUpdated = (updated: League) => {
    setLeague(updated);
    setLeagues((prev) => prev.map((l) => (
      l.id === updated.id
        ? { id: updated.id, name: updated.name, mode: updated.mode, status: updated.status, teamCount: updated.teams.length }
        : l
    )));
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError("");
    try {
      await api.deleteLeague(deleteTarget.id);
      setLeagues((prev) => prev.filter((l) => l.id !== deleteTarget.id));
      setSelectedId((prev) => (prev === deleteTarget.id ? null : prev));
      setDeleteTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "리그를 삭제하지 못했어요.");
    } finally {
      setDeleting(false);
    }
  };

  const options = leagues.map((l) => ({ value: String(l.id), label: `${l.name} · ${MODE_LABEL[l.mode]}` }));

  // 표시용 상태 — "진행중"은 대진 확정(bracketLocked) 이후에만, 그 전엔 "준비중"으로 본다
  // (요청). 완료는 백엔드 상태 그대로. 백엔드 status가 확정 전에 active여도 여기서 눌러 앉힌다.
  const shownStatus: LeagueStatus = league
    ? (league.status === "completed" ? "completed" : (league.bracketLocked ? "active" : "setup"))
    : "setup";

  return (
    <div className="scr-screen scr-league-screen">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">리그</h1>
      </div>

      {error && <div className="scr-err">{error}</div>}

      <div className="scr-league-toolbar">
        <Select
          value={selectedId !== null ? String(selectedId) : ""}
          options={options}
          onChange={(v) => setSelectedId(Number(v))}
          placeholder={leagues.length === 0 ? "리그 없음" : "리그 선택"}
          disabled={leagues.length === 0}
          className="scr-league-select scr-cselect-plain"
        />
        {isAdmin && (
          <button
            type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm"
            onClick={() => setCreating(true)}
          >
            <Plus size={14} /> 생성
          </button>
        )}
      </div>

      {loadingList ? (
        <div className="scr-empty"><Spinner size={18} /></div>
      ) : leagues.length === 0 ? (
        <div className="scr-empty">아직 만들어진 리그가 없어요</div>
      ) : loadingDetail || !league ? (
        <div className="scr-empty"><Spinner size={18} /></div>
      ) : (
        <div className="scr-league-summary-card">
          <div className="scr-league-summary-row">
            <span className="scr-league-summary-name">{league.name}</span>
            {/* 상태 배지 — "진행중"은 대진을 확정(bracketLocked)해야만 뜨고, 그 전에는
                항상 "준비중"으로 본다(요청). 완료는 그대로 유지한다. */}
            <span className={cx("scr-league-status-pill", `scr-league-status-${shownStatus}`)}>
              {STATUS_LABEL[shownStatus]}
            </span>
          </div>

          {/* 액션 버튼 줄 — 리그명 아랫줄에 아이콘 버튼으로 모은다(요청). 수정 모드로
             들어가는 연필은 다시 누르면 닫히는 걸 막으려(요청) 편집 중엔 감추고, 나가는
             문은 X 하나다(요청: "X 하나만 남기기(닫기)").

             한때 완료(체크)와 취소(X)가 나란히 있었는데 둘 다 편집 모드를 벗어나기만 할
             뿐 하는 일이 똑같았다(지적: "체크 버튼과 x 버튼 차이가 뭐야?"). 취소가
             '되돌리기'였던 적이 없고, 저장이 이 줄의 저장 버튼 하나로 모이면서 둘을
             가를 근거도 사라졌다. */}
          {isAdmin && (
            <div className="scr-league-btn-row">
              {!editMode ? (
                <button
                  type="button" className="scr-icon-btn"
                  onClick={() => setEditMode(true)}
                  aria-label="수정" title="수정"
                >
                  <Pencil size={15} />
                </button>
              ) : (
                <>
                  {/* 저장은 여기 하나뿐이다(요청) — 팀구성과 대진표를 한 번에 보낸다. */}
                  <button
                    type="button" className="scr-icon-btn scr-league-save-btn"
                    onClick={saveAll} disabled={saving || dirtyCount === 0}
                    aria-label="저장" title={dirtyCount === 0 ? "바뀐 게 없어요" : "저장"}
                  >
                    {saving ? <Spinner size={14} /> : <Save size={15} />}
                  </button>
                  <button
                    type="button" className="scr-icon-btn"
                    onClick={() => setEditMode(false)}
                    aria-label="수정 닫기" title="수정 닫기"
                  >
                    <X size={16} />
                  </button>
                  <button
                    type="button" className="scr-icon-btn scr-icon-btn-danger"
                    onClick={() => setDeleteTarget(leagues.find((l) => l.id === league.id) ?? null)}
                    aria-label="리그 삭제" title="리그 삭제"
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </div>
          )}

          <div className="scr-league-summary-meta">
            <span>{MODE_LABEL[league.mode]}</span>
            <span>{league.bestOf}전 {Math.floor(league.bestOf / 2) + 1}선승</span>
            <span>
              {league.teams.length}{league.mode === "individual" ? "명" : "팀"}
              {/* 판이 꽉 찬 나무가 아니라 "8강" 같은 이름이 안 맞는다(요청: 필요한 데만
                  가지치기) — 실제 경기 수로 적는다. */}
              {league.drawSize ? ` · 대진표 ${league.matches.length}경기` : ""}
            </span>
          </div>
          {canEdit && <LeagueTeamsPanel league={league} onRegisterSave={registerTeamsSave} />}
          <LeagueBracket
            league={league} canEdit={canEdit}
            onUpdated={handleLeagueUpdated} onRegisterSave={registerBracketSave}
          />
        </div>
      )}

      {creating && <LeagueCreateModal onClose={() => setCreating(false)} onCreated={handleCreated} />}
      {deleteTarget && (
        <ConfirmDialog
          title="리그 삭제"
          message={`"${deleteTarget.name}" 리그를 삭제할까요? 팀/대진표/결과가 모두 함께 삭제되고 되돌릴 수 없어요.`}
          confirmLabel={deleting ? "삭제 중..." : "삭제"}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
