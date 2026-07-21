import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import MemberPickBlock from "../../components/common/MemberPickBlock";
import Avatar from "../../components/common/Avatar";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import { Spinner } from "../../components/common/Feedback";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import type { League, LeagueTeam } from "../../types";

// 이미 결과가 정해진(부전승 포함) 경기에 참가했던 팀은 이력이 깨지므로 로스터/삭제를
// 막는다(서버 규칙과 동일 — _team_has_decided_match) — 그 외에는 대진표 생성 여부나
// 리그 상태(setup/active)와 무관하게 항상 편집 가능하다(요청: "팀원도 당연히
// 수정가능해야해... 팀자체도 삭제 가능해야하고" — 예전엔 "대진표 생성 전(setup)에만"
// 으로 전부 잠갔는데, 서버는 이미 팀별로 따로 풀어놨었다).
function teamHasDecidedMatch(league: League, teamId: number): boolean {
  return league.matches.some(
    (m) => (m.teamA?.id === teamId || m.teamB?.id === teamId) && m.winnerTeamId !== null,
  );
}

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
    .map((m) => ({ value: m.id, label: `${m.nickname} (${m.battletag})`, avatar: <Avatar member={m} size={20} /> }));

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

// 리그의 팀 구성 — 팀/선수 수는 상한이 없다(요청: "팀수 무제한 개인전 선수 무제한").
// 대진표 생성 여부/리그 상태와 무관하게 언제든 팀을 추가할 수 있고(단, 대진표가 이미
// 있으면 그때 예약해둔 자리(plannedTeams)만큼만 — 서버 규칙과 동일), 팀별 편집 가능
// 여부는 LeagueTeamCard가 그 팀이 이미 결과가 정해진 경기에 참가했는지로 따로 판단한다.
export default function LeagueTeamsPanel({ league, onUpdated }: { league: League; onUpdated: (l: League) => void }) {
  const [addBusy, setAddBusy] = useState(false);
  const [err, setErr] = useState("");
  const canAddTeam = league.drawSize === null || league.teams.length < (league.plannedTeams ?? 0);

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
        <h2 className="scr-league-section-title">
          팀 ({league.teams.length}{league.drawSize !== null ? `/${league.plannedTeams}` : ""})
        </h2>
        {canAddTeam && (
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
            <LeagueTeamCard
              key={team.id} league={league} team={team} editable={!teamHasDecidedMatch(league, team.id)}
              onUpdated={onUpdated}
            />
          ))}
        </div>
      )}
    </div>
  );
}
