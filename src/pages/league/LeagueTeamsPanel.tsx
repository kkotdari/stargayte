import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, UserPlus, X } from "lucide-react";
import Select from "../../components/common/Select";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import type { League } from "../../types";

const TEAM_ROSTER_MAX = 4;

// 이미 "실제로 치른" 경기 결과가 난 팀만 편집을 막는다 — 부전승으로만 이긴 건 세지
// 않는다(요청: "A팀이 수정 불가능한 문제가 있음" — 상대가 구조적으로 없었을 뿐 실제로
// 아무도 안 붙어봤는데 로스터가 잠기는 건 과했다). 실제 결과만 setsWonA가 채워진다
// (부전승 자동 처리는 세트 스코어를 안 남긴다) — 서버의 _team_has_decided_match와
// 같은 기준.
function teamHasDecidedMatch(league: League, teamId: number | null): boolean {
  if (teamId === null) return false;
  return league.matches.some(
    (m) => m.setsWonA !== null && (m.teamA?.id === teamId || m.teamB?.id === teamId),
  );
}

// 팀 라벨(A, B, ... Z, AA, ...)을 인덱스로 계산한다 — 새 팀은 저장 전까진 서버 라벨이
// 없고, 로컬에서 순서를 바꾸면 서버 라벨이 어긋나므로, 항상 현재 로컬 순서로 라벨을
// 만들어 보여준다(서버의 _team_label과 동일 규칙).
function labelForIndex(index: number): string {
  const A = "A".charCodeAt(0);
  let n = index;
  let label = "";
  for (;;) {
    label = String.fromCharCode(A + (n % 26)) + label;
    n = Math.floor(n / 26);
    if (n === 0) break;
    n -= 1;
  }
  return label;
}

// 로컬 편집용 팀 — id가 null이면 아직 저장 안 된 새 팀. key는 리액트 렌더 키(새 팀도
// 안정적으로 유지되도록 별도 부여). roster는 화면 표시에 필요한 최소 정보만.
interface LocalRoster {
  memberId: string;
  nickname: string;
  avatar: string | null;
}
interface LocalTeam {
  key: string;
  id: number | null;
  roster: LocalRoster[];
}

function toLocalTeams(league: League): LocalTeam[] {
  return league.teams.map((t) => ({
    key: `t${t.id}`,
    id: t.id,
    roster: t.roster.map((r) => ({ memberId: r.memberId, nickname: r.nickname, avatar: r.avatar })),
  }));
}

// 팀전 팀 카드 — 헤더 한 줄에 팀명 + 선수 추가(아이콘) + 삭제(아이콘)를 놓고, 그 아래
// 로스터를 세로로 나열한다. 편집은 모두 로컬 상태만 바꾸고(저장은 패널의 '팀구성 저장'
// 버튼), 선수 추가를 누르면 그 자리가 유저 선택 드롭다운으로 바뀌며 자리가 남은 한(최대
// 4명) 고르면 곧바로 다음 드롭다운이 열려 이어서 고를 수 있다.
function TeamModeCard({
  label, team, editable, autoOpenAdd, options, onPick, onRemove, onDelete,
}: {
  label: string;
  team: LocalTeam;
  editable: boolean;
  autoOpenAdd: boolean;
  options: { value: string; label: string; avatar: React.ReactNode }[];
  onPick: (memberId: string) => void;
  onRemove: (memberId: string) => void;
  onDelete: () => void;
}) {
  const [picking, setPicking] = useState(autoOpenAdd);
  const canAddMore = editable && team.roster.length < TEAM_ROSTER_MAX;

  const pick = (id: string) => {
    onPick(id);
    setPicking(team.roster.length + 1 < TEAM_ROSTER_MAX);
  };

  return (
    <div className="scr-league-team-card">
      <div className="scr-league-team-card-head">
        <span className="scr-league-team-label">{label}팀</span>
        {canAddMore && !picking && (
          <button
            type="button" className="scr-icon-btn"
            onClick={() => setPicking(true)} aria-label={`${label}팀 선수 추가`}
          >
            <UserPlus size={13} />
          </button>
        )}
        {editable && (
          <button
            type="button" className="scr-icon-btn scr-icon-btn-danger"
            onClick={onDelete} aria-label={`${label}팀 삭제`}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {(team.roster.length > 0 || picking) && (
        <div className="scr-league-roster-list">
          {team.roster.map((r) => (
            <div key={r.memberId} className="scr-league-roster-row">
              <Avatar member={{ id: r.memberId, nickname: r.nickname, avatar: r.avatar }} size={18} />
              <span className="scr-league-roster-row-name">{r.nickname}</span>
              {editable && (
                <button
                  type="button" className="scr-icon-btn scr-league-roster-row-remove"
                  onClick={() => onRemove(r.memberId)} aria-label="제외"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
          {picking && (
            <Select
              value="" options={options} onChange={pick}
              placeholder="유저 선택" defaultOpen
              onOpenChange={(open) => { if (!open) setPicking(false); }}
              className="scr-cselect-plain" size="sm"
            />
          )}
        </div>
      )}
      {team.roster.length === 0 && !picking && <span className="scr-hint">로스터 없음</span>}
    </div>
  );
}

// 개인전 선수 칩 — 개인전은 "팀"이 곧 선수 1명이라 팀 카드로 묶지 않고 유저칩 하나로
// 바로 보여준다. 빈 자리(방금 만든 팀)는 곧바로 열린 선택 드롭다운으로 나오고, 고르면
// 칩으로 접힌다 — 골랐는지 여부를 pickedRef로 구분해야 드롭다운이 닫힐 때(고른 직후에도
// 자동으로 닫힘) 방금 채운 자리를 다시 지워버리는 걸 막을 수 있다. 고르지 않고 취소하면
// (바깥 클릭 등) 빈 자리 자체가 의미 없으니 그 팀을 통째로 지운다.
function IndividualPlayerChip({
  team, editable, autoOpen, options, onPick, onRemove, onCancelEmpty,
}: {
  team: LocalTeam;
  editable: boolean;
  autoOpen: boolean;
  options: { value: string; label: string; avatar: React.ReactNode }[];
  onPick: (memberId: string) => void;
  onRemove: () => void;
  onCancelEmpty: () => void;
}) {
  const [picking, setPicking] = useState(autoOpen);
  const pickedRef = useRef(false);

  if (team.roster.length === 0) {
    if (!picking) return null;
    return (
      <div className="scr-league-player-chip scr-league-player-chip-pick">
        <Select
          value="" options={options}
          onChange={(id) => { pickedRef.current = true; setPicking(false); onPick(id); }}
          placeholder="선수 선택" defaultOpen
          onOpenChange={(open) => { if (!open && !pickedRef.current) { setPicking(false); onCancelEmpty(); } }}
          className="scr-cselect-plain" size="sm"
        />
      </div>
    );
  }
  const r = team.roster[0];
  return (
    <div className="scr-league-player-chip">
      <Avatar member={{ id: r.memberId, nickname: r.nickname, avatar: r.avatar }} size={18} />
      <span className="scr-league-player-chip-name">{r.nickname}</span>
      {editable && (
        <button
          type="button" className="scr-icon-btn scr-league-player-chip-remove"
          onClick={onRemove} aria-label={`${r.nickname} 제외`}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

// 리그의 팀/선수 구성 — 편집은 전부 로컬 상태로만 하고 '팀구성 저장' 버튼을 눌러야 서버로
// 한 번에 보낸다(요청: "팀구성 따로 배치 저장"). 저장하면 서버가 원자적으로 반영한 리그를
// 돌려주고, 상위(LeagueScreen)가 그걸 반영하면서 대진표도 새 팀 구성으로 다시 로드된다
// (요청: "팀구성 변경되면 대진표 다시로드"). 상한은 없다(요청: "팀수 무제한 개인전 선수
// 무제한") — 단 대진표가 이미 있으면 예약된 자리(plannedTeams)만큼만.
export default function LeagueTeamsPanel({ league, onUpdated }: { league: League; onUpdated: (l: League) => void }) {
  const members = useAppStore((s) => s.members);
  const isIndividual = league.mode === "individual";

  const [localTeams, setLocalTeams] = useState<LocalTeam[]>(() => toLocalTeams(league));
  // league prop이 실제로 바뀔 때(저장/대진표 생성/외부 갱신)만 로컬을 서버 값으로 리셋한다 —
  // 로컬 편집 중에는 API를 안 부르니 league 참조가 그대로라 편집이 유지된다.
  useEffect(() => {
    setLocalTeams(toLocalTeams(league));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [chainKey, setChainKey] = useState<string | null>(null);
  const keyCounter = useRef(0);
  const newKey = () => `new${keyCounter.current++}`;

  const canAddTeam = league.drawSize === null || localTeams.length < (league.plannedTeams ?? 0);

  const dirty = useMemo(() => {
    const srv = toLocalTeams(league);
    if (srv.length !== localTeams.length) return true;
    for (let i = 0; i < srv.length; i++) {
      if (srv[i].id !== localTeams[i].id) return true;
      const a = srv[i].roster.map((r) => r.memberId);
      const b = localTeams[i].roster.map((r) => r.memberId);
      if (a.length !== b.length || a.some((v, j) => v !== b[j])) return true;
    }
    return false;
  }, [localTeams, league]);

  // 이 리그의 다른 로컬 팀에 이미 든 회원은 후보에서 뺀다(같은 리그 안에서 한 선수가 두
  // 팀에 동시에 속할 수 없음) — 서버가 아니라 로컬 편집 상태 기준으로 계산해야 방금 옮긴
  // 것도 즉시 반영된다.
  const optionsFor = (teamKey: string) => {
    const taken = new Set(
      localTeams.filter((t) => t.key !== teamKey).flatMap((t) => t.roster.map((r) => r.memberId)),
    );
    const self = localTeams.find((t) => t.key === teamKey);
    const selfIds = new Set(self?.roster.map((r) => r.memberId) ?? []);
    return members
      .filter((m) => !taken.has(m.id) && !selfIds.has(m.id))
      .map((m) => ({ value: m.id, label: `${m.nickname} (${m.battletag})`, avatar: <Avatar member={m} size={20} /> }));
  };

  const addTeam = () => {
    const key = newKey();
    setLocalTeams((prev) => [...prev, { key, id: null, roster: [] }]);
    setChainKey(key);
  };

  const deleteTeam = (key: string) => {
    setLocalTeams((prev) => prev.filter((t) => t.key !== key));
  };

  const addMember = (key: string, memberId: string) => {
    const m = members.find((x) => x.id === memberId);
    if (!m) return;
    setLocalTeams((prev) => prev.map((t) => (
      t.key === key ? { ...t, roster: [...t.roster, { memberId: m.id, nickname: m.nickname, avatar: m.avatar }] } : t
    )));
  };

  const removeMember = (key: string, memberId: string) => {
    setLocalTeams((prev) => prev.map((t) => (
      t.key === key ? { ...t, roster: t.roster.filter((r) => r.memberId !== memberId) } : t
    )));
  };

  // 개인전: 선수 하나를 고르면 곧바로 다음 빈 자리를 열어 이어서 추가한다(요청: "하나
  // 추가하면 바로 다음 드롭다운이 자동으로 열려서"). 취소하면 체인을 멈춘다.
  const pickIndividual = (key: string, memberId: string) => {
    addMember(key, memberId);
    if (chainKey === key) {
      const nk = newKey();
      setLocalTeams((prev) => [...prev, { key: nk, id: null, roster: [] }]);
      setChainKey(nk);
    }
  };
  const cancelIndividualEmpty = (key: string) => {
    setChainKey(null);
    deleteTeam(key);
  };

  const save = async () => {
    setErr("");
    setBusy(true);
    try {
      const payload = localTeams.map((t) => ({ id: t.id, roster: t.roster.map((r) => r.memberId) }));
      onUpdated(await api.setLeagueTeamComposition(league.id, payload));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "팀구성을 저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scr-league-teams-panel">
      <div className="scr-league-teams-panel-head">
        <h2 className="scr-league-section-title">
          {isIndividual ? "선수" : "팀"} ({localTeams.length}{league.drawSize !== null ? `/${league.plannedTeams}` : ""})
        </h2>
        <div className="scr-league-teams-panel-actions">
          {canAddTeam && (
            <button
              type="button" className="scr-btn scr-btn-sm"
              onClick={addTeam} disabled={busy}
            >
              <Plus size={14} /> {isIndividual ? "선수 추가" : "팀 추가"}
            </button>
          )}
          <button
            type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm"
            onClick={save} disabled={busy || !dirty}
          >
            {busy && <Spinner size={14} />} 팀구성 저장
          </button>
        </div>
      </div>

      {err && <div className="scr-err">{err}</div>}

      {localTeams.length === 0 ? (
        <div className="scr-empty">아직 {isIndividual ? "선수가" : "팀이"} 없어요</div>
      ) : isIndividual ? (
        <div className="scr-league-players-wrap">
          {localTeams.map((team) => (
            <IndividualPlayerChip
              key={team.key} team={team}
              editable={!teamHasDecidedMatch(league, team.id)}
              autoOpen={team.key === chainKey}
              options={optionsFor(team.key)}
              onPick={(id) => pickIndividual(team.key, id)}
              onRemove={() => deleteTeam(team.key)}
              onCancelEmpty={() => cancelIndividualEmpty(team.key)}
            />
          ))}
        </div>
      ) : (
        <div className="scr-league-teams-grid">
          {localTeams.map((team, i) => (
            <TeamModeCard
              key={team.key} label={labelForIndex(i)} team={team}
              editable={!teamHasDecidedMatch(league, team.id)}
              autoOpenAdd={team.key === chainKey}
              options={optionsFor(team.key)}
              onPick={(id) => addMember(team.key, id)}
              onRemove={(id) => removeMember(team.key, id)}
              onDelete={() => deleteTeam(team.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
