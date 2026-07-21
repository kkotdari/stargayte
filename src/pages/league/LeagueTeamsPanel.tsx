import { useRef, useState } from "react";
import { Plus, Trash2, UserPlus, X } from "lucide-react";
import Select from "../../components/common/Select";
import Avatar from "../../components/common/Avatar";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import { Spinner } from "../../components/common/Feedback";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import type { League, LeagueTeam } from "../../types";

const TEAM_ROSTER_MAX = 4;

// 이미 "실제로 치른" 경기 결과가 난 팀만 편집을 막는다 — 부전승으로만 이긴 건 세지
// 않는다(요청: "A팀이 수정 불가능한 문제가 있음" — 상대가 구조적으로 없었을 뿐 실제로
// 아무도 안 붙어봤는데 로스터가 잠기는 건 과했다). 실제 결과만 setsWonA가 채워진다
// (부전승 자동 처리는 세트 스코어를 안 남긴다) — 서버의 _team_has_decided_match와
// 같은 기준.
function teamHasDecidedMatch(league: League, teamId: number): boolean {
  return league.matches.some(
    (m) => m.setsWonA !== null && (m.teamA?.id === teamId || m.teamB?.id === teamId),
  );
}

// 팀전 팀 카드 — 헤더 한 줄에 팀명 + 선수 추가(아이콘) + 삭제(아이콘)를 모두 놓고
// (요청: "팀카드 선수추가 아이콘으로 대체하고 팀명 옆으로 이동, 로스터라는 라벨
// 제거해서 한줄 없앰"), 그 아래 로스터를 세로로 나열한다. 선수 추가를 누르면 그
// 자리가 바로 유저 선택 드롭다운으로 바뀌고, 고르면 자리가 남아있는 한(최대 4명)
// 곧바로 다음 드롭다운이 열려 이어서 고를 수 있다(요청: "하나 추가하면 바로 다음
// 드롭다운이 자동으로 열려서 편하게 추가할수 있게").
function TeamModeCard({
  league, team, editable, autoOpenAdd, onUpdated,
}: {
  league: League; team: LeagueTeam; editable: boolean; autoOpenAdd: boolean; onUpdated: (l: League) => void;
}) {
  const members = useAppStore((s) => s.members);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [picking, setPicking] = useState(autoOpenAdd);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const rosterIds = team.roster.map((r) => r.memberId);
  // 이 리그의 다른 팀에 이미 등록된 회원은 후보에서 뺀다(요청 6 — 같은 리그 안에서 한
  // 선수가 두 팀에 동시에 속할 수 없음).
  const takenElsewhere = new Set(
    league.teams.filter((t) => t.id !== team.id).flatMap((t) => t.roster.map((r) => r.memberId)),
  );
  const options = members
    .filter((m) => !takenElsewhere.has(m.id) && !rosterIds.includes(m.id))
    .map((m) => ({ value: m.id, label: `${m.nickname} (${m.battletag})`, avatar: <Avatar member={m} size={20} /> }));

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
  const pick = (id: string) => {
    const next = [...rosterIds, id];
    saveRoster(next);
    setPicking(next.length < TEAM_ROSTER_MAX);
  };
  const removeMember = (id: string) => saveRoster(rosterIds.filter((v) => v !== id));

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

  const canAddMore = editable && rosterIds.length < TEAM_ROSTER_MAX;

  return (
    <div className="scr-league-team-card">
      <div className="scr-league-team-card-head">
        <span className="scr-league-team-label">{team.label}팀</span>
        {canAddMore && !picking && (
          <button
            type="button" className="scr-icon-btn"
            onClick={() => setPicking(true)} aria-label={`${team.label}팀 선수 추가`}
          >
            <UserPlus size={13} />
          </button>
        )}
        {editable && (
          <button
            type="button" className="scr-icon-btn scr-icon-btn-danger"
            onClick={() => setConfirmingDelete(true)} aria-label={`${team.label}팀 삭제`}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {(team.roster.length > 0 || picking) && (
        <div className="scr-league-roster-list">
          {team.roster.map((r) => (
            <div key={r.memberId} className="scr-league-roster-row">
              <Avatar member={{ id: r.memberId, nickname: r.nickname, avatar: r.avatar }} size={16} />
              <span className="scr-league-roster-row-name">{r.nickname}</span>
              {editable && (
                <button
                  type="button" className="scr-icon-btn scr-league-roster-row-remove"
                  onClick={() => removeMember(r.memberId)} disabled={busy} aria-label="제외"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          ))}
          {picking && (
            <Select
              value="" options={options} onChange={pick}
              placeholder="유저 선택" defaultOpen
              onOpenChange={(open) => { if (!open) setPicking(false); }}
              className="scr-cselect-plain scr-league-roster-select" size="sm"
              disabled={busy}
            />
          )}
        </div>
      )}
      {team.roster.length === 0 && !picking && <span className="scr-hint">로스터 없음</span>}

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

// 개인전 선수 칩 — 개인전은 "팀"이 곧 선수 1명이라 팀 카드로 묶지 않고 유저칩 하나로
// 바로 보여준다(요청: "개인전은 팀 추가가 아니라 선수추가 버튼이고 추가하면 팀
// 카드가 아닌 유저칩이 바로 추가됨"). 빈 자리(방금 만든 팀)는 곧바로 열린 선택
// 드롭다운으로 나오고, 고르면 칩으로 접힌다 — 골랐는지 여부를 pickedRef로 구분해야
// 드롭다운이 닫힐 때(고른 직후에도 자동으로 닫힘) 방금 채운 자리를 다시 지워버리는
// 걸 막을 수 있다. 고르지 않고 취소하면(바깥 클릭 등) 빈 자리 자체가 의미 없으니
// 팀을 통째로 지운다.
function IndividualPlayerChip({
  league, team, editable, autoOpen, onUpdated, onSettled,
}: {
  league: League; team: LeagueTeam; editable: boolean; autoOpen: boolean;
  onUpdated: (l: League) => void; onSettled: (teamId: number, filled: boolean) => void;
}) {
  const members = useAppStore((s) => s.members);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [picking, setPicking] = useState(autoOpen);
  const pickedRef = useRef(false);

  const takenElsewhere = new Set(
    league.teams.filter((t) => t.id !== team.id).flatMap((t) => t.roster.map((r) => r.memberId)),
  );
  const options = members
    .filter((m) => !takenElsewhere.has(m.id))
    .map((m) => ({ value: m.id, label: `${m.nickname} (${m.battletag})`, avatar: <Avatar member={m} size={20} /> }));

  const pickPlayer = async (memberId: string) => {
    pickedRef.current = true;
    setErr("");
    setBusy(true);
    try {
      await api.setLeagueTeamRoster(league.id, team.id, [memberId]);
      onUpdated(await api.getLeague(league.id));
      onSettled(team.id, true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "선수를 등록하지 못했어요.");
      pickedRef.current = false;
    } finally {
      setBusy(false);
      setPicking(false);
    }
  };
  const cancelPick = async () => {
    setPicking(false);
    onSettled(team.id, false);
    try {
      onUpdated(await api.deleteLeagueTeam(league.id, team.id));
    } catch {
      // 빈 자리 정리 실패는 조용히 무시 — 다음에 관리자가 직접 지울 수 있다.
    }
  };
  const removeChip = async () => {
    setErr("");
    setBusy(true);
    try {
      onUpdated(await api.deleteLeagueTeam(league.id, team.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "삭제하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  if (team.roster.length === 0) {
    if (!picking) return null;
    return (
      <div className="scr-league-player-chip scr-league-player-chip-pick">
        <Select
          value="" options={options} onChange={pickPlayer}
          placeholder="선수 선택" defaultOpen
          onOpenChange={(open) => { if (!open && !pickedRef.current) cancelPick(); }}
          className="scr-cselect-plain scr-league-roster-select" size="sm"
          disabled={busy}
        />
      </div>
    );
  }
  const r = team.roster[0];
  return (
    <div className="scr-league-player-chip">
      <Avatar member={{ id: r.memberId, nickname: r.nickname, avatar: r.avatar }} size={16} />
      <span className="scr-league-player-chip-name">{r.nickname}</span>
      {editable && (
        <button
          type="button" className="scr-icon-btn scr-league-player-chip-remove"
          onClick={removeChip} disabled={busy} aria-label={`${r.nickname} 제외`}
        >
          <X size={11} />
        </button>
      )}
      {err && <div className="scr-err">{err}</div>}
    </div>
  );
}

// 리그의 팀/선수 구성 — 상한이 없다(요청: "팀수 무제한 개인전 선수 무제한"). 대진표
// 생성 여부/리그 상태와 무관하게 언제든 추가할 수 있고(단, 대진표가 이미 있으면 그때
// 예약해둔 자리(plannedTeams)만큼만 — 서버 규칙과 동일), 편집 가능 여부는 그 팀이
// 이미 실제 결과가 정해진 경기에 참가했는지로 개별 판단한다.
export default function LeagueTeamsPanel({ league, onUpdated }: { league: League; onUpdated: (l: League) => void }) {
  const [addBusy, setAddBusy] = useState(false);
  const [err, setErr] = useState("");
  const [chainTeamId, setChainTeamId] = useState<number | null>(null);
  const isIndividual = league.mode === "individual";
  const canAddTeam = league.drawSize === null || league.teams.length < (league.plannedTeams ?? 0);

  const addTeam = async () => {
    setErr("");
    setAddBusy(true);
    try {
      const created = await api.addLeagueTeam(league.id);
      onUpdated(await api.getLeague(league.id));
      setChainTeamId(created.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "추가하지 못했어요.");
    } finally {
      setAddBusy(false);
    }
  };

  const handleChainSettled = (teamId: number, filled: boolean) => {
    if (chainTeamId !== teamId) return;
    setChainTeamId(null);
    // 개인전만 "선수 하나 고르면 바로 다음 자리"로 이어간다(요청: "하나 추가하면
    // 바로 다음 드롭다운이 자동으로 열려서") — 취소했으면 체인을 멈춘다.
    if (filled && isIndividual) addTeam();
  };

  return (
    <div className="scr-league-teams-panel">
      <div className="scr-league-teams-panel-head">
        <h2 className="scr-league-section-title">
          {isIndividual ? "선수" : "팀"} ({league.teams.length}{league.drawSize !== null ? `/${league.plannedTeams}` : ""})
        </h2>
        {canAddTeam && (
          <button
            type="button" className="scr-btn scr-btn-ghost scr-btn-sm"
            onClick={addTeam} disabled={addBusy}
          >
            {addBusy ? <Spinner size={14} /> : <Plus size={14} />} {isIndividual ? "선수 추가" : "팀 추가"}
          </button>
        )}
      </div>

      {err && <div className="scr-err">{err}</div>}

      {league.teams.length === 0 ? (
        <div className="scr-empty">아직 {isIndividual ? "선수가" : "팀이"} 없어요</div>
      ) : isIndividual ? (
        <div className="scr-league-players-wrap">
          {league.teams.map((team) => (
            <IndividualPlayerChip
              key={team.id} league={league} team={team}
              editable={!teamHasDecidedMatch(league, team.id)}
              autoOpen={team.id === chainTeamId}
              onUpdated={onUpdated} onSettled={handleChainSettled}
            />
          ))}
        </div>
      ) : (
        <div className="scr-league-teams-grid">
          {league.teams.map((team) => (
            <TeamModeCard
              key={team.id} league={league} team={team}
              editable={!teamHasDecidedMatch(league, team.id)}
              autoOpenAdd={team.id === chainTeamId}
              onUpdated={onUpdated}
            />
          ))}
        </div>
      )}
    </div>
  );
}
