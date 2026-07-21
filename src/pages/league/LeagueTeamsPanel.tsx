import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import MemberPickBlock from "../../components/common/MemberPickBlock";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import { Spinner } from "../../components/common/Feedback";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import type { League, LeagueTeam } from "../../types";

const MAX_TEAMS = 6;

function LeagueTeamCard({
  league, team, editable, onUpdated,
}: {
  league: League; team: LeagueTeam; editable: boolean; onUpdated: (l: League) => void;
}) {
  const members = useAppStore((s) => s.members);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const rosterIds = team.roster.map((r) => r.memberId);
  // 이 리그의 다른 팀에 이미 등록된 회원은 후보에서 뺀다(요청 6 — 같은 리그 안에서 한
  // 선수가 두 팀에 동시에 속할 수 없음). ChallengeFormModal의 "다른 편에 이미 있으면
  // 후보에서 제외"와 같은 패턴 — 서버도 동일 규칙을 최종 검증한다.
  const takenElsewhere = new Set(
    league.teams.filter((t) => t.id !== team.id).flatMap((t) => t.roster.map((r) => r.memberId)),
  );
  const memberById = new Map(members.map((m) => [m.id, m]));
  const options = members
    .filter((m) => !takenElsewhere.has(m.id) && !rosterIds.includes(m.id))
    .map((m) => ({ value: m.id, label: `${m.nickname} (${m.battletag})` }));

  // MemberPickBlock은 ids를 즉시 자기 state로 들고 있지 않고 매번 props(team.roster)를
  // 그대로 보여주는 완전 제어 컴포넌트라, 여기서 실제 저장(API)까지 하고 성공하면 리그
  // 전체를 다시 불러와 위로 올려보낸다 — 실패하면 team.roster가 그대로라 화면도
  // 자동으로 되돌아간다(별도 롤백 코드가 필요 없다).
  const saveRoster = async (nextIds: string[]) => {
    setErr("");
    setBusy(true);
    try {
      await api.setLeagueTeamRoster(league.id, team.id, nextIds);
      onUpdated(await api.getLeague(league.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "로스터를 저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const deleteTeam = async () => {
    setDeleting(true);
    setErr("");
    try {
      onUpdated(await api.deleteLeagueTeam(league.id, team.id));
      setConfirmingDelete(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "팀을 삭제하지 못했어요.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="scr-league-team-card">
      <div className="scr-league-team-card-head">
        <span className="scr-league-team-label">{team.label}팀</span>
        {editable && (
          <button
            type="button" className="scr-icon-btn scr-icon-btn-danger"
            onClick={() => setConfirmingDelete(true)} aria-label={`${team.label}팀 삭제`}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {editable ? (
        <MemberPickBlock
          label="로스터" ids={rosterIds} setIds={saveRoster}
          max={league.mode === "individual" ? 1 : 4}
          options={options} memberById={memberById}
          addLabel="선수 추가" addAriaLabel={`${team.label}팀 선수 추가`}
        />
      ) : (
        <div className="scr-league-team-roster-readonly">
          {team.roster.length === 0
            ? <span className="scr-hint">로스터 없음</span>
            : team.roster.map((r) => <span key={r.memberId} className="scr-league-roster-chip">{r.nickname}</span>)}
        </div>
      )}

      {busy && <div className="scr-league-team-card-busy"><Spinner size={14} /></div>}
      {err && <div className="scr-err">{err}</div>}

      {confirmingDelete && (
        <ConfirmDialog
          title={`${team.label}팀 삭제`}
          message="팀을 삭제하면 로스터도 함께 사라지고, 남은 팀의 라벨이 다시 A부터 채워져요."
          confirmLabel={deleting ? "삭제 중..." : "삭제"}
          onConfirm={deleteTeam}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}

// 리그의 팀 구성 — 대진표 생성 전(setup)에만 팀 추가/삭제/로스터 편집이 가능하다(서버
// 규칙과 동일). 생성 후에는 읽기 전용으로 로스터만 보여준다.
export default function LeagueTeamsPanel({ league, onUpdated }: { league: League; onUpdated: (l: League) => void }) {
  const [addBusy, setAddBusy] = useState(false);
  const [err, setErr] = useState("");
  const editable = league.status === "setup";

  const addTeam = async () => {
    setErr("");
    setAddBusy(true);
    try {
      await api.addLeagueTeam(league.id);
      onUpdated(await api.getLeague(league.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "팀을 추가하지 못했어요.");
    } finally {
      setAddBusy(false);
    }
  };

  return (
    <div className="scr-league-teams-panel">
      <div className="scr-league-teams-panel-head">
        <h2 className="scr-league-section-title">팀 ({league.teams.length}/{MAX_TEAMS})</h2>
        {editable && league.teams.length < MAX_TEAMS && (
          <button
            type="button" className="scr-btn scr-btn-ghost scr-btn-sm"
            onClick={addTeam} disabled={addBusy}
          >
            {addBusy ? <Spinner size={14} /> : <Plus size={14} />} 팀 추가
          </button>
        )}
      </div>

      {err && <div className="scr-err">{err}</div>}

      {league.teams.length === 0 ? (
        <div className="scr-empty">아직 팀이 없어요</div>
      ) : (
        <div className="scr-league-teams-grid">
          {league.teams.map((team) => (
            <LeagueTeamCard key={team.id} league={league} team={team} editable={editable} onUpdated={onUpdated} />
          ))}
        </div>
      )}
    </div>
  );
}
