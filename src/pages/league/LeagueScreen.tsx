import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import Select from "../../components/common/Select";
import { Spinner } from "../../components/common/Feedback";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import LeagueCreateModal from "../../modals/LeagueCreateModal";
import LeagueTeamsPanel from "./LeagueTeamsPanel";
import LeagueBracket from "./LeagueBracket";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import type { League, LeagueListItem, LeagueMode, LeagueStatus } from "../../types";

const MODE_LABEL: Record<LeagueMode, string> = { team: "팀리그", individual: "개인리그" };
const STATUS_LABEL: Record<LeagueStatus, string> = { setup: "준비중", active: "진행중", completed: "완료" };

// 공식 리그 대진/결과 관리 — 1단계(요청: "기능을 나눠서 조금씩 배포") — 리그 목록/생성/삭제와
// 선택한 리그의 기본 정보만 보여준다. 팀 구성/로스터/대진표/결과 입력은 다음 단계에서 이어
// 붙인다. App.tsx가 이미 운영자만 이 화면으로 들어오게 게이팅한다.
export default function LeagueScreen() {
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
          className="scr-league-select"
        />
        <button
          type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm"
          onClick={() => setCreating(true)}
        >
          <Plus size={14} /> 새 리그
        </button>
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
            <span className={cx("scr-league-status-pill", `scr-league-status-${league.status}`)}>
              {STATUS_LABEL[league.status]}
            </span>
          </div>
          <div className="scr-league-summary-meta">
            <span>{MODE_LABEL[league.mode]}</span>
            <span>{league.bestOf}전 {Math.floor(league.bestOf / 2) + 1}선승</span>
            <span>{league.teams.length}팀{league.drawSize ? ` · 대진표 ${league.drawSize}강` : ""}</span>
          </div>
          <div className="scr-league-summary-actions">
            <button
              type="button" className="scr-btn scr-btn-ghost scr-btn-danger scr-btn-sm"
              onClick={() => setDeleteTarget(leagues.find((l) => l.id === league.id) ?? null)}
            >
              <Trash2 size={14} /> 리그 삭제
            </button>
          </div>

          <LeagueTeamsPanel league={league} onUpdated={handleLeagueUpdated} />
          <LeagueBracket league={league} onUpdated={handleLeagueUpdated} />

          <p className="scr-hint scr-hint-left">
            결과 입력/대타/슬롯 조정은 다음 업데이트에서 이어서 열려요.
          </p>
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
