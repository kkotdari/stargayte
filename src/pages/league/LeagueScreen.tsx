import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
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

  // 선택한 리그가 바뀔 때마다 상세(팀+경기 포함)를 새로 불러온다.
  useEffect(() => {
    if (selectedId === null) { setLeague(null); return; }
    setLoadingDetail(true);
    api.getLeague(selectedId)
      .then(setLeague)
      .catch((e) => setError(e instanceof Error ? e.message : "리그 정보를 불러오지 못했어요."))
      .finally(() => setLoadingDetail(false));
  }, [selectedId]);

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
            <Plus size={14} /> 개최
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
            <span className="scr-league-summary-name">
              {league.name}
              {/* 수정 모드로 "들어가는" 버튼일 뿐, 다시 눌러서 나가는 토글이 아니다
                  (요청: "수정모드에서 수정버튼 다시 누르면 바로 닫히는거 방지") — 수정
                  모드에 들어간 뒤에는 이 버튼 자체를 감춰서 다시 눌러도 아무 일이
                  안 생기는 상태를 아예 없앤다. */}
              {isAdmin && !editMode && (
                <button
                  type="button"
                  className="scr-icon-btn scr-league-edit-toggle"
                  onClick={() => setEditMode(true)}
                  aria-label="수정 모드로 전환"
                  title="수정 모드로 전환"
                >
                  <Pencil size={13} />
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="scr-icon-btn scr-icon-btn-danger"
                  onClick={() => setDeleteTarget(leagues.find((l) => l.id === league.id) ?? null)}
                  aria-label="리그 삭제"
                  title="리그 삭제"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </span>
            <span className={cx("scr-league-status-pill", `scr-league-status-${league.status}`)}>
              {STATUS_LABEL[league.status]}
            </span>
          </div>
          <div className="scr-league-summary-meta">
            <span>{MODE_LABEL[league.mode]}</span>
            <span>{league.bestOf}전 {Math.floor(league.bestOf / 2) + 1}선승</span>
            <span>
              {league.teams.length}{league.mode === "individual" ? "명" : "팀"}
              {league.drawSize ? ` · 대진표 ${league.drawSize}강` : ""}
            </span>
          </div>
          {canEdit && <LeagueTeamsPanel league={league} onUpdated={handleLeagueUpdated} />}
          <LeagueBracket league={league} canEdit={canEdit} onUpdated={handleLeagueUpdated} />

          {canEdit && (
            <p className="scr-hint scr-hint-left">
              결과 입력/대타는 다음 업데이트에서 이어서 열려요.
            </p>
          )}
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
