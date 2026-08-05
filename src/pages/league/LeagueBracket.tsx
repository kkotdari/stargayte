import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import Select from "../../components/common/Select";
import Avatar from "../../components/common/Avatar";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import { api } from "../../api/client";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import { cx } from "../../utils/format";
import { formatWhen } from "../../utils/date";
import type { League, LeagueMatch, LeagueMatchSide, LeagueTeam } from "../../types";

// 라운드 번호를 결승 기준 상대 이름으로.
function roundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "결승";
  if (fromEnd === 1) return "준결승";
  return `${round}라운드`;
}

// 대진표 칸 하나(팀/선수 카드) — 항상 하얀 배경에 검정 글씨 + 아바타로, 다크/라이트
// 테마와 무관하게 또렷하게 보이도록 고정한다(요청: "팀카드는 하얀색 배경에 검은글씨와
// 아바타"). 팀리그는 로스터 전원을 세로로(요청: "팀이름이 아니라 구성원이름 보이게
// (세로로)"), 개인리그는 그 팀(=선수 1명)의 이름만 보여준다. 팀전은 라운드가 진행될수록
// 대진표가 옆으로 넓어지는데, 모바일에서는 2라운드부터 로스터 대신 팀명(라벨)만 보여
// 폭을 아낀다(요청: "팀전, 모바일인 경우 2라운드부터는 팀명만 노출") — 데스크톱은
// 라운드와 무관하게 항상 로스터 전원을 보여준다. editSelect가 있으면(수정 모드) 팀명
// 자리(개인전은 로스터 자리)에 드롭다운을 항상 그대로 끼워 넣는다 — 클릭한다고
// 카드/로스터가 다른 걸로 바뀌지 않고, 그 드롭다운 자체가 열릴 뿐이다(요청: "드롭다운
// 열때 아무것도 바뀔필요 없이 드롭다운만 열려야돼"). team이 없어도(빈 슬롯) 하얀 카드에
// "미지정"이 선택된 드롭다운만 있고 로스터 자리는 그냥 비어 있다(요청: "빈슬롯을 하얀
// 배경에 팀 드롭다운만 미지정 선택돼 있으면 돼 팀원 목록만 없는 거나 똑같아"). 카드
// 높이는 바깥(포지셔너)이 고정폭으로 맞춰준다 — 좌표 기반 배치가 라운드/로스터 인원수와
// 무관하게 항상 통일된 높이를 전제로 하기 때문이다.
function TeamSlotCard({
  team, isWinner, mode, compact, editSelect,
}: {
  team: LeagueTeam | null; isWinner: boolean; mode: League["mode"]; compact: boolean;
  editSelect?: React.ReactNode;
}) {
  const cardClass = cx(
    "scr-league-bracket-team-card",
    // 개인전은 슬롯을 팀 카드 패널로 한 번 더 감싸지 않는다(요청: 유저칩 자체가 패널) —
    // 안의 드롭다운(수정)/멤버 칩(읽기)이 곧 패널이 되도록 카드 배경/테두리를 없앤다.
    mode === "individual" && "scr-league-bracket-team-card-individual",
    isWinner && "scr-league-bracket-team-card-win",
    compact && "scr-league-bracket-team-card-compact",
  );
  const roster = !team ? null : team.roster.length === 0 ? (
    <span className="scr-league-bracket-team-card-empty-roster">{team.label}팀(로스터 없음)</span>
  ) : (
    <div className="scr-league-bracket-team-card-roster">
      {team.roster.map((r) => (
        <span key={r.memberId} className="scr-league-bracket-team-card-member">
          <Avatar member={{ id: r.memberId, nickname: r.nickname, avatar: r.avatar }} size={18} />
          {r.nickname}
        </span>
      ))}
    </div>
  );
  return (
    <div className={cardClass}>
      {mode === "team" && (editSelect ?? (team && <span className="scr-league-bracket-team-card-label">{team.label}</span>))}
      {mode === "individual" && editSelect ? editSelect : roster}
    </div>
  );
}

// 칸 하나(팀 슬롯) — 수정 모드면 팀명(개인전은 로스터 자리)이 항상 드롭다운으로 나온다
// (요청: "팀슬롯에서 팀이름을 드롭다운으로 바꿔서 미지정, 팀목록으로", "수정모드에서
// 대진표는 읽기전용일때랑 모양은 똑같아야돼"). 어떤 팀도 목록에서 빼지 않는다 — 지금 이
// 자리에 배정된 팀은 드롭다운 자체의 체크 표시로 활성 상태를 보여준다(요청: "그냥 아무팀도
// 제거하지말고 대신 지금처럼 자신은 액티브 표시"). 골라서 다시 배정하면 그 팀이 있던
// 자리는 자동으로 비워진다. 가지가 달린 자리는 아래 경기 승자가 올라올 자리라 드롭다운이
// 없고, 대진을 확정하면 모든 자리가 잠긴다(요청: "대진 확정 버튼을 누르면 그때부터 시드는
// 변경 못하게... 그전엔 부전승팀도 수정 가능해야해"). 드래그앤드랍 편집은 폐기 — 이
// 드롭다운 방식으로 대체한다.
function SlotCell({
  league, match, team, teamRef, editable, busy, mode, compact, onAssign, onClear,
}: {
  league: League; match: LeagueMatch | null;
  team: LeagueTeam | null; teamRef: { id: number } | null; editable: boolean; busy: boolean;
  mode: League["mode"]; compact: boolean;
  onAssign: (teamId: number) => void; onClear: () => void;
}) {
  const decided = match !== null && match.winnerTeamId !== null;

  if (!editable) {
    if (!team) {
      if (decided) return <div className="scr-league-bracket-team-empty">부전</div>;
      return <div className="scr-league-bracket-team-empty">{match?.isDead ? "공백" : "미정"}</div>;
    }
    return <TeamSlotCard team={team} isWinner={decided && match?.winnerTeamId === teamRef?.id} mode={mode} compact={compact} />;
  }

  const handleChange = (v: string) => (v === "" ? onClear() : onAssign(Number(v)));
  const select = mode === "individual" ? (
    <Select
      value={team ? String(team.id) : ""}
      options={[
        { value: "", label: "미지정" },
        // 읽기전용 카드(아바타 18px + 이름)와 같은 모양이 되도록 옵션마다 프사를 넘긴다
        // (요청: 편집 중인 대진표에도 아바타 표시) — Select가 선택된 값(트리거)에도
        // 이 아바타를 그대로 보여준다.
        ...league.teams.map((t) => ({
          value: String(t.id),
          label: t.roster[0]?.nickname ?? `${t.label}(로스터 없음)`,
          avatar: t.roster[0]
            ? <Avatar member={{ id: t.roster[0].memberId, nickname: t.roster[0].nickname, avatar: t.roster[0].avatar }} size={18} />
            : undefined,
        })),
      ]}
      onChange={handleChange}
      placeholder="미지정"
      size="sm" className="scr-league-bracket-slot-select scr-cselect-plain"
      disabled={busy}
    />
  ) : (
    <Select
      value={team ? String(team.id) : ""}
      options={[
        { value: "", label: "미지정", shortLabel: "-" },
        ...league.teams.map((t) => ({
          value: String(t.id), label: `${t.label}팀 ${t.roster.map((r) => r.nickname).join(", ") || "로스터 없음"}`,
          shortLabel: t.label,
        })),
      ]}
      onChange={handleChange}
      size="sm" className="scr-league-bracket-label-select scr-cselect-plain" minDropWidth={280}
      disabled={busy}
    />
  );
  return (
    <TeamSlotCard
      team={team} isWinner={decided && match?.winnerTeamId === teamRef?.id} mode={mode} compact={compact}
      editSelect={select}
    />
  );
}

// 커넥터 모서리 처리(요청): "두 가지가 만나는 부분은 직각, 한 선이 그냥 꺾이는 부분은
// 둥글게". (x1,y1)에서 가로로 나와 bendX에서 세로로 꺾여 (x2,y2=두 가지가 만나는 mergeY)로
// 이어진다. 첫 꺾임(카드에서 나온 가로선→세로선)만 반지름 r로 둥글게 하고, 두 가지가
// 합쳐지는 지점(bendX, y2)은 직각 그대로 둔다.
function elbowPath(x1: number, y1: number, bendX: number, x2: number, y2: number, r: number): string {
  if (Math.abs(y1 - y2) < 0.5) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const dir = y2 > y1 ? 1 : -1;
  // r을 실제 가용 구간(가로 여백 / 세로 거리) 안으로 눌러 담아, 작은 브라켓에서도 안 깨지게.
  const rr = Math.max(0, Math.min(r, bendX - x1, Math.abs(y2 - y1)));
  if (rr <= 0) return `M ${x1} ${y1} L ${bendX} ${y1} L ${bendX} ${y2} L ${x2} ${y2}`;
  return [
    `M ${x1} ${y1}`,
    `L ${bendX - rr} ${y1}`,
    `Q ${bendX} ${y1} ${bendX} ${y1 + rr * dir}`, // 첫 꺾임만 둥글게
    `L ${bendX} ${y2}`,                            // 두 가지가 만나는 지점은 직각
    `L ${x2} ${y2}`,
  ].join(" ");
}

/* 자리를 가리키는 법 — 뿌리(결승)에서 내려온 길. 빈 문자열이 결승이고, "ab"면 결승의
   a쪽으로 올라가는 경기의 b쪽 자리다. 화면이 가지를 치고 지우는 동안 새 칸에는 아직
   id가 없고 라운드 번호는 판이 깊어질 때마다 통째로 밀리므로, 저장 전까지 판을 다루는
   말은 좌표도 id도 아닌 이 길이다 — 저장도 이 길 목록 그대로 보낸다.

   (round, slot) ↔ path 는 서로 되돌릴 수 있다: 길이만큼의 이진 자릿수로 슬롯을 펴면
   그대로 길이 되고(a=0, b=1), 라운드는 결승까지의 거리다. */
function pathOf(match: LeagueMatch, totalRounds: number): string {
  const depth = totalRounds - match.round;
  if (depth <= 0) return "";
  return match.slotInRound.toString(2).padStart(depth, "0")
    .split("").map((bit) => (bit === "0" ? "a" : "b")).join("");
}

// 서버가 내려준 판을 길로 훑어 놓은 것 — 로컬 편집의 시작점이자, 그린 칸에 붙일 결과·
// 일시를 찾아오는 색인이다. 길은 판이 자라도 안 흔들리므로(뿌리 기준이라) 로컬에서 가지를
// 더 쳐도 기존 칸과 서버 경기의 짝은 그대로다.
function indexByPath(league: League): Map<string, LeagueMatch> {
  const totalRounds = league.matches.reduce((n, m) => Math.max(n, m.round), 0);
  const by = new Map<string, LeagueMatch>();
  league.matches.forEach((m) => by.set(pathOf(m, totalRounds), m));
  return by;
}

/* 로컬 배정 상태 — `${path}:${side}` → teamId(미지정 null). 가지가 달리지 않은 자리,
   즉 팀을 직접 앉히는 자리만 담는다(가지가 달린 자리는 아래 경기 승자가 올라온다). */
type SeatMap = Record<string, number | null>;

const seatKey = (path: string, side: LeagueMatchSide) => `${path}:${side}`;
const pathOfSeat = (key: string) => key.slice(0, key.lastIndexOf(":"));
// 깊은 것부터가 아니라 얕은 것부터 — 서버가 이 순서로 (라운드, 슬롯)을 매긴다.
const byDepth = (a: string, b: string) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0);

function serverShape(league: League): string[] {
  return [...indexByPath(league).keys()].sort(byDepth);
}

function serverSeats(league: League): SeatMap {
  const by = indexByPath(league);
  const out: SeatMap = {};
  by.forEach((m, path) => {
    (["a", "b"] as const).forEach((side) => {
      if (by.has(path + side)) return;   // 올라오는 자리 — 앉히는 자리가 아니다
      out[seatKey(path, side)] = (side === "a" ? m.teamA : m.teamB)?.id ?? null;
    });
  });
  return out;
}

function sameShape(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(b);
  return a.every((p) => s.has(p));
}

function sameSeats(a: SeatMap, b: SeatMap): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? null) !== (b[k] ?? null)) return false;
  return true;
}

// 로컬 datetime 입력칸(YYYY-MM-DDTHH:mm) ↔ ISO. 서버는 UTC로 주고받고 사람은 제 시간대로
// 적으므로 여기서만 갈아 끼운다.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* 경기 하나의 일시와 결과를 적는 팝업(요청: "리그에 일시 추가하는거랑 결과입력도 필요한데
   / 결과는 몇 대 몇 입력"). 이긴 쪽은 스코어가 말해 주므로 따로 고르게 하지 않는다.

   일시는 대진 확정 전에도 적을 수 있고(언제 붙을지는 판이 굳기 전에도 정해진다), 결과는
   확정 뒤 두 자리가 다 찬 경기에만 적는다 — 확정 전에는 시드가 아직 움직여서 그때 적은
   결과는 모양이 바뀌는 순간 뜻을 잃는다. */
function MatchEditModal({
  league, match, teamA, teamB, onSaved, onClose,
}: {
  league: League; match: LeagueMatch;
  teamA: LeagueTeam | null; teamB: LeagueTeam | null;
  onSaved: (l: League) => void; onClose: () => void;
}) {
  useLockBodyScroll();
  const [when, setWhen] = useState(() => toLocalInput(match.scheduledAt));
  const [a, setA] = useState(() => (match.setsWonA === null ? "" : String(match.setsWonA)));
  const [b, setB] = useState(() => (match.setsWonB === null ? "" : String(match.setsWonB)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const nameOf = (t: LeagueTeam | null, fallback: string) => {
    if (!t) return fallback;
    if (league.mode === "individual") return t.roster[0]?.nickname ?? `${t.label}팀`;
    return `${t.label}팀`;
  };
  const canScore = league.bracketLocked && teamA !== null && teamB !== null;
  const scoreNote = league.bracketLocked
    ? (canScore ? null : "두 자리가 다 차야 결과를 넣을 수 있어요.")
    : "대진을 확정해야 결과를 넣을 수 있어요.";

  const save = async () => {
    setErr("");
    setBusy(true);
    try {
      let next = league;
      const nextWhen = when ? new Date(when).toISOString() : null;
      if (nextWhen !== (match.scheduledAt ? new Date(match.scheduledAt).toISOString() : null)) {
        next = await api.setLeagueMatchSchedule(league.id, match.id, nextWhen);
      }
      if (canScore) {
        const filled = a !== "" && b !== "";
        const na = filled ? Number(a) : null;
        const nb = filled ? Number(b) : null;
        if (a !== "" && b === "") throw new Error("두 팀의 세트 수를 다 적어 주세요.");
        if (b !== "" && a === "") throw new Error("두 팀의 세트 수를 다 적어 주세요.");
        if (na !== match.setsWonA || nb !== match.setsWonB) {
          next = await api.setLeagueMatchResult(league.id, match.id, na, nb);
        }
      }
      onSaved(next);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm scr-league-match-modal">
        <div className="scr-modal-head">
          <span>경기 정보</span>
          <button type="button" className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-league-match-vs">
          <span>{nameOf(teamA, "미정")}</span>
          <span className="scr-league-match-vs-sep">vs</span>
          <span>{nameOf(teamB, "미정")}</span>
        </div>
        <label className="scr-field">
          <span className="scr-label">일시 <span className="scr-label-optional">(선택)</span></span>
          <input
            type="datetime-local" className="scr-input" value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </label>
        <div className="scr-field">
          <span className="scr-label">결과 <span className="scr-label-optional">(몇 대 몇)</span></span>
          <div className="scr-league-match-score">
            <input
              type="number" inputMode="numeric" min={0} max={league.bestOf} className="scr-input"
              value={a} onChange={(e) => setA(e.target.value)} disabled={!canScore} aria-label="A 세트 수"
            />
            <span className="scr-league-match-score-sep">:</span>
            <input
              type="number" inputMode="numeric" min={0} max={league.bestOf} className="scr-input"
              value={b} onChange={(e) => setB(e.target.value)} disabled={!canScore} aria-label="B 세트 수"
            />
            {canScore && (a !== "" || b !== "") && (
              <button
                type="button" className="scr-btn scr-btn-ghost scr-btn-sm"
                onClick={() => { setA(""); setB(""); }}
              >
                지우기
              </button>
            )}
          </div>
          {scoreNote && <p className="scr-league-match-note">{scoreNote}</p>}
        </div>
        {err && <div className="scr-err" role="alert">{err}</div>}
        <div className="scr-form-actions">
          <button type="button" className="scr-btn scr-btn-ghost" onClick={onClose} disabled={busy}>취소</button>
          <button type="button" className="scr-btn scr-btn-primary" onClick={save} disabled={busy}>
            {busy && <Spinner size={14} />} 저장
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// 리그 대진표. canEdit이면 우승 자리에서 시작해 왼쪽으로 가지를 쳐 판을 짜고, 각 자리에
// 팀을 직접 배정할 수 있다(요청: "최종 승리자 한 칸에서 역으로 시작해서 대진을 만드는
// 거야... 그러면 내가 필요한 데만 가지를 늘릴 수 있어"). 아닌 경우(일반 회원/보기 모드)는
// 순수 읽기 전용.
//
// 모양도 배정도 저장 버튼을 누를 때까지는 화면 안에서만 바뀐다(요청: "바로바로 저장이 아닌
// 마지막 저장 버튼 누를때 저장"). 그래서 이 화면이 그리는 것은 서버가 준 경기 목록이 아니라
// 로컬 나무(shape: 길 목록)다 — 서버 경기는 그 길로 찾아 붙여 결과·일시·승자를 보여줄 때만
// 쓴다.
//
// 좌표 기반 배치 — CSS flexbox 중첩으로 "짝(pair) 커넥터 중심"을 근사하던 이전 방식은
// 라운드마다 매치 수/카드 높이가 달라질 때마다 계속 어긋났다(요청: "브라켓 수정...
// 이긴팀이 연결된 하나의 선에 안 이어짐", "1,2번 시드 가운데 있어야 하는데 1~4번
// 시드 가운데 있음" 등 반복 보고). React에서 각 팀 슬롯의 px 좌표를 직접 계산해
// position:absolute로 배치하고, 연결선은 SVG로 그 좌표를 그대로 잇는다 — 로스터
// 인원수와 무관하게 카드 높이를 통일해서(CARD_H) 쓰므로, 아래 두 칸의 정중앙에 위 칸이
// 오도록 수학적으로 보장된다.
export default function LeagueBracket({
  league, canEdit, onUpdated,
}: { league: League; canEdit: boolean; onUpdated: (l: League) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmingBracket, setConfirmingBracket] = useState(false);
  /* 가지 지우기 확인 — path가 null이면 우승 자리, 즉 판 전체를 지운다. 되돌리기 수준의
     작은 삭제(빈 경기 하나)는 묻지 않고 바로 지운다. */
  const [cut, setCut] = useState<
    { path: string | null; side: LeagueMatchSide; matches: number; teams: number } | null
  >(null);
  const [editingPath, setEditingPath] = useState<string | null>(null);

  /* 로컬 판 — 모양(길 목록)과 배정. league prop이 실제로 바뀔 때(저장/확정/팀편집으로 새
     리그를 받았을 때)만 서버 값으로 되돌린다. 편집 중에는 API를 안 부르니 league 참조가
     그대로라 편집이 유지된다. canEdit도 함께 본다 — 편집 모드를 켜고 끄는 순간 기준이
     달라진다. */
  const [shape, setShape] = useState<string[]>(() => serverShape(league));
  const [seats, setSeats] = useState<SeatMap>(() => serverSeats(league));
  useEffect(() => {
    setShape(serverShape(league));
    setSeats(serverSeats(league));
  }, [league, canEdit]);

  const dirty = useMemo(
    () => !sameShape(shape, serverShape(league)) || !sameSeats(seats, serverSeats(league)),
    [shape, seats, league],
  );

  const byPath = useMemo(() => indexByPath(league), [league]);
  const inShape = useMemo(() => new Set(shape), [shape]);
  const canShape = canEdit && !league.bracketLocked;

  // 대진 확정 — 배정을 잠그는 동시에 대진 모양을 굳힌다(요청: 확정을 누르면 필요 없는
  // 칸이 사라진다). 아무도 안 앉은 가지가 이때 죽고, 혼자 남은 팀이 다음 라운드로
  // 올라간다. 되돌릴 수 없는 조작이라 확인창을 거친다.
  const confirmBracket = async () => {
    setErr("");
    setBusy(true);
    try {
      onUpdated(await api.confirmLeagueBracket(league.id));
      setConfirmingBracket(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "대진을 확정하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  /* '대진표 저장' — 지금 화면의 모양과 배정을 통째로 한 번에 보낸다(요청). 서버가 그
     목록대로 판을 다시 맞춘다: 그대로인 칸은 행을 그대로 두고, 없어진 칸은 지우고, 새
     칸만 만든다. 비운 자리(null)는 서버가 어차피 전부 비우고 시작하므로 안 보낸다. */
  const saveBracket = async () => {
    setErr("");
    setBusy(true);
    try {
      const assignments = Object.entries(seats)
        .filter(([key, teamId]) => teamId !== null && inShape.has(pathOfSeat(key)))
        .map(([key, teamId]) => ({
          path: pathOfSeat(key), side: key.slice(-1) as LeagueMatchSide, teamId,
        }));
      onUpdated(await api.setLeagueBracket(league.id, shape, assignments));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "대진표를 저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  /* 가지 치기/지우기 — 서버를 안 부르고 로컬 나무만 고친다. 가지를 치면 그 자리는 이제
     아래 경기 승자가 올라올 자리라 앉아 있던 팀이 풀리고, 지우면 반대로 다시 앉힐 수 있는
     자리가 된다. */
  const branchSeat = (path: string, side: LeagueMatchSide) => {
    const child = path + side;
    setShape((prev) => [...prev, child].sort(byDepth));
    setSeats((prev) => {
      const next = { ...prev };
      delete next[seatKey(path, side)];
      next[seatKey(child, "a")] = null;
      next[seatKey(child, "b")] = null;
      return next;
    });
  };
  const cutSeat = (path: string | null, side: LeagueMatchSide) => {
    setCut(null);
    if (path === null) {   // 우승 자리 — 판 전체가 날아간다
      setShape([]);
      setSeats({});
      return;
    }
    const root = path + side;
    const gone = (p: string) => p === root || p.startsWith(root);
    setShape((prev) => prev.filter((p) => !gone(p)));
    setSeats((prev) => {
      const next: SeatMap = {};
      Object.entries(prev).forEach(([k, v]) => {
        if (!gone(pathOfSeat(k))) next[k] = v;
      });
      next[seatKey(path, side)] = null;
      return next;
    });
  };
  const startBracket = () => {
    setShape([""]);
    setSeats({ [seatKey("", "a")]: null, [seatKey("", "b")]: null });
  };

  const totalRounds = shape.reduce((n, p) => Math.max(n, p.length + 1), 1);
  const compact = league.mode === "team";
  const roundOf = (path: string) => totalRounds - path.length;

  // 로컬 배정 — 같은 팀을 다른 자리에 골라 넣으면 원래 있던 자리를 비워, 한 팀이 두
  // 자리에 동시에 보이지 않게 한다(서버도 같은 팀의 중복 배정을 거부한다).
  const handleAssign = (path: string, side: LeagueMatchSide, teamId: number) => {
    setSeats((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) if (next[k] === teamId) next[k] = null;
      next[seatKey(path, side)] = teamId;
      return next;
    });
  };
  const handleClear = (path: string, side: LeagueMatchSide) => {
    setSeats((prev) => ({ ...prev, [seatKey(path, side)]: null }));
  };

  // 카드 높이는 로스터 인원수와 무관하게 고정한다 — 좌표 계산이 이 고정값을 전제로
  // 한다. 개인전은 로스터가 항상 1명이라 훨씬 짧게 잡는다.
  const CARD_H = league.mode === "individual" ? 46 : 96;
  const ROW_GAP = 10;
  const COL_W = 180;
  const COL_GAP = 44;
  // 왼쪽 여백 — 가지 버튼이 카드 왼쪽 모서리에 반쯤 걸쳐 앉으므로 그 절반만 있으면 된다.
  const PAD_L = 16;
  // 첫 꺾임(카드에서 나온 선이 꺾이는 곳)만 살짝 둥글게(요청). 두 가지가 만나는 지점은
  // elbowPath에서 직각으로 유지한다.
  const CORNER_R = 8;

  const colX = (r: number) => PAD_L + (r - 1) * (COL_W + COL_GAP);

  /* 세로 배치 — 판이 꽉 찬 나무가 아니라서 "N라운드엔 칸이 2^k개"라는 계산을 못 쓴다.
     대신 나무를 결승부터 훑어 내려가며, 아래 경기가 달린 자리는 그 경기의 한가운데에
     맞추고 그렇지 않은 자리(=팀을 앉히는 자리)만 한 줄씩 차지하게 한다. 꽉 찬 판에서는
     예전과 똑같은 결과가 나오고, 한쪽만 깊은 판에서도 선이 정확히 이어진다. */
  const rowH = CARD_H + ROW_GAP;
  const seatY = new Map<string, number>();   // `${path}:${side}` → 카드 중심 y
  const mergeY = new Map<string, number>();  // path → 두 카드가 합쳐지는 y
  let rows = 0;
  const place = (path: string): number => {
    const ys = (["a", "b"] as const).map((side) => {
      const child = path + side;
      const y = inShape.has(child) ? place(child) : rows++ * rowH + CARD_H / 2;
      seatY.set(seatKey(path, side), y);
      return y;
    });
    const mid = (ys[0] + ys[1]) / 2;
    mergeY.set(path, mid);
    return mid;
  };
  if (inShape.has("")) place("");
  const totalHeight = Math.max(1, rows) * CARD_H + Math.max(0, rows - 1) * ROW_GAP;
  // 우승 자리가 맨 오른쪽 한 칸을 더 차지한다 — 판을 짤 때의 출발점이자, 다 끝나면
  // 우승 팀이 앉는 자리다.
  const champX = colX(totalRounds + 1);
  const canvasWidth = champX + COL_W;

  const teamOf = (id: number | null | undefined) => (id == null ? null : league.teams.find((t) => t.id === id) ?? null);
  const isEditableSeat = (path: string, side: LeagueMatchSide) => canShape && !inShape.has(path + side);
  // 화면에 보이는 배정 — 앉히는 자리는 아직 저장 안 된 로컬 값, 올라오는 자리는 서버 값.
  const seatTeamId = (path: string, side: LeagueMatchSide): number | null => {
    if (!inShape.has(path + side)) return seats[seatKey(path, side)] ?? null;
    const m = byPath.get(path);
    return (side === "a" ? m?.teamA : m?.teamB)?.id ?? null;
  };
  // 이 자리에 매달린 가지의 규모 — 지우기 전에 얼마나 날아가는지 알려주려고 센다.
  const subtreeStats = (path: string, side: LeagueMatchSide) => {
    const stack = inShape.has(path + side) ? [path + side] : [];
    let matches = 0;
    let teams = 0;
    while (stack.length) {
      const p = stack.pop() as string;
      matches += 1;
      (["a", "b"] as const).forEach((s) => {
        if (seatTeamId(p, s) !== null) teams += 1;
        if (inShape.has(p + s)) stack.push(p + s);
      });
    }
    return { matches, teams };
  };
  const askCut = (path: string | null, side: LeagueMatchSide) => {
    if (path === null) {   // 우승 자리 — 판 전체가 날아간다
      const teams = shape.reduce(
        (n, p) => n + (["a", "b"] as const).filter((s) => seatTeamId(p, s) !== null).length, 0,
      );
      setCut({ path: null, side, matches: shape.length, teams });
      return;
    }
    const st = subtreeStats(path, side);
    // 방금 친 가지를 무르는 정도(빈 경기 하나)면 묻지 않는다 — 확인창이 더 성가시다.
    if (st.matches <= 1 && st.teams === 0) {
      cutSeat(path, side);
      return;
    }
    setCut({ path, side, ...st });
  };

  const connectors: { path: string; won: boolean }[] = [];
  shape.forEach((p) => {
    const mid = mergeY.get(p);
    if (mid === undefined) return;
    const match = byPath.get(p) ?? null;
    const x1 = colX(roundOf(p)) + COL_W;
    const bendX = x1 + COL_GAP / 2;
    const x2 = colX(roundOf(p) + 1);
    const winnerSide = !match || match.winnerTeamId == null
      ? null
      : match.winnerTeamId === match.teamA?.id ? "a" : match.winnerTeamId === match.teamB?.id ? "b" : null;
    (["a", "b"] as const).forEach((side) => {
      const y = seatY.get(seatKey(p, side));
      if (y === undefined) return;
      connectors.push({ path: elbowPath(x1, y, bendX, x2, mid, CORNER_R), won: winnerSide === side });
    });
  });

  const slots: { key: string; x: number; y: number; node: React.ReactNode }[] = [];
  const branchButtons: { key: string; x: number; y: number; node: React.ReactNode }[] = [];
  const badges: { key: string; x: number; y: number; node: React.ReactNode }[] = [];
  /* 자리 왼쪽의 +/− — 가지가 없으면 치고(+), 있으면 그 가지를 통째로 지운다(−, 요청).
     카드 왼쪽 모서리에 반쯤 걸쳐 앉는다(요청: "버튼 왼쪽에 반 겹쳐지게 보여주고
     불투명처리") — 버튼 지름이 22px이라 중심을 모서리에 두면 절반이 카드 위로 온다. */
  const BRANCH_D = 22;
  const pushBranchButton = (
    key: string, x: number, y: number, hasChild: boolean,
    onClick: () => void, what: string,
  ) => {
    if (!canShape) return;
    branchButtons.push({
      key, x: x - BRANCH_D / 2, y: y - BRANCH_D / 2,
      node: (
        <button
          type="button" className="scr-league-bracket-branch" onClick={onClick} disabled={busy}
          title={hasChild ? `${what}에 달린 가지를 지웁니다` : `${what} 왼쪽에 가지를 칩니다`}
          aria-label={hasChild ? "가지 지우기" : "가지 치기"}
        >
          {hasChild ? "−" : "+"}
        </button>
      ),
    });
  };

  shape.forEach((p) => {
    const round = roundOf(p);
    const match = byPath.get(p) ?? null;
    const isCompact = compact && round > 1;
    const x = colX(round);
    (["a", "b"] as const).forEach((side) => {
      const y = seatY.get(seatKey(p, side));
      if (y === undefined) return;
      const hasChild = inShape.has(p + side);
      slots.push({
        key: `${p}-${side}`, x, y: y - CARD_H / 2,
        node: (
          <SlotCell
            league={league} match={match} team={teamOf(seatTeamId(p, side))}
            teamRef={side === "a" ? match?.teamA ?? null : match?.teamB ?? null}
            editable={isEditableSeat(p, side)} busy={busy} mode={league.mode} compact={isCompact}
            onAssign={(id) => handleAssign(p, side, id)} onClear={() => handleClear(p, side)}
          />
        ),
      });
      pushBranchButton(
        `${p}-${side}-branch`, x, y, hasChild,
        () => (hasChild ? askCut(p, side) : branchSeat(p, side)),
        `${roundLabel(round, totalRounds)} ${side === "a" ? "위" : "아래"} 자리`,
      );
    });
    /* 일시·결과 배지 — 두 카드 사이 세로 간격(ROW_GAP)이 배지 내용보다 좁을 수 있어,
       카드 사이가 아니라 커넥터가 꺾이는 지점(라운드 오른쪽 여백)에 둔다. 운영자에겐
       이게 곧 입력 버튼이다(요청: 일시 추가 + 결과 입력) — 아직 저장 안 한 새 칸에는
       달 게 없으므로 서버에 있는 경기에만 붙는다. */
    const hasBadge = match !== null && (match.setsWonA !== null || match.scheduledAt !== null);
    if (!hasBadge && !(canEdit && match !== null && !match.isDead)) return;
    const content = (
      <>
        {match?.setsWonA !== null && match?.setsWonB !== null && (
          <div className="scr-league-bracket-score">{match?.setsWonA} : {match?.setsWonB}</div>
        )}
        {match?.scheduledAt && (
          <div className="scr-league-bracket-when">{formatWhen(match.scheduledAt, { clock: true })}</div>
        )}
        {!hasBadge && <div className="scr-league-bracket-badge-add">일시·결과</div>}
      </>
    );
    badges.push({
      key: `${p}-badge`, x: x + COL_W + COL_GAP / 2, y: mergeY.get(p) as number,
      node: canEdit && match !== null && !match.isDead ? (
        <button
          type="button" className="scr-league-bracket-badge-btn" onClick={() => setEditingPath(p)}
          title="일시와 결과를 적습니다"
        >
          {content}
        </button>
      ) : content,
    });
  });

  /* 우승 자리 — 판을 짤 때의 출발점이고, 결승 승자가 여기 앉는다. 왼쪽 버튼은 늘 −다:
     여기 달린 가지가 곧 판 전체라 지우면 대진표가 사라진다. */
  const rootMatch = byPath.get("") ?? null;
  const champY = inShape.has("") ? mergeY.get("") as number : CARD_H / 2;
  const champion = inShape.has("") && rootMatch ? teamOf(rootMatch.winnerTeamId) : null;
  if (inShape.has("")) pushBranchButton("champ-branch", champX, champY, true, () => askCut(null, "a"), "우승 자리");

  const heads = Array.from({ length: totalRounds }, (_, i) => i + 1);
  const editingMatch = editingPath === null ? null : byPath.get(editingPath) ?? null;

  // 아직 판이 없고 고칠 수도 없으면 보여줄 게 없다.
  if (shape.length === 0 && !canEdit) {
    return (
      <div className="scr-league-bracket-panel">
        <h2 className="scr-league-section-title">대진표</h2>
        <div className="scr-empty">아직 대진표가 만들어지지 않았어요</div>
      </div>
    );
  }

  return (
    <div className="scr-league-bracket-panel">
      {/* "대진표" 타이틀 생략(요청: "대진표 타이틀은 없어도 다 아니까 삭제") — 위 요약
          줄에 이미 "대진표 N강"이 있어 중복이었다. */}
      <div className="scr-league-bracket-toolbar">
        <div className="scr-league-bracket-seed-actions">
          {canShape && (
            <span className="scr-league-bracket-rounds-hint">
              {shape.length}경기 · 앉힐 자리 {Object.keys(seats).filter((k) => inShape.has(pathOfSeat(k))).length}
            </span>
          )}
          {/* 모양도 배정도 로컬로만 고치고 이 버튼으로 한 번에 저장한다(요청). */}
          {canShape && (
            <button
              type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm"
              onClick={saveBracket} disabled={busy || !dirty}
            >
              {busy && <Spinner size={14} />} 대진표 저장
            </button>
          )}
        </div>
        {canShape && shape.length > 0 && (
          <button
            type="button" className="scr-btn scr-btn-sm"
            onClick={() => setConfirmingBracket(true)} disabled={busy || dirty}
            title={dirty ? "먼저 대진표를 저장하세요" : undefined}
          >
            대진 확정
          </button>
        )}
      </div>
      {err && <div className="scr-err">{err}</div>}
      {shape.length === 0 ? (
        /* 아직 아무것도 없을 때 — 우승 자리 한 칸만 놓고, 그 왼쪽 +로 시작한다(요청: "최종
           승리자 한 칸에서 역으로 시작해서 대진을 만드는 거야"). */
        <>
          <div className="scr-league-bracket-start">
            <button
              type="button" className="scr-league-bracket-branch" onClick={startBracket}
              disabled={busy} title="여기서 갈라 대진표를 시작합니다" aria-label="대진표 시작"
            >
              +
            </button>
            <div className="scr-league-bracket-champ">우승</div>
          </div>
          <p className="scr-league-bracket-hint">
            우승 자리 왼쪽의 +를 눌러 가지를 칩니다. 필요한 가지에서만 다시 +를 누르면
            한쪽만 깊은 대진도 만들 수 있어요. 다 짠 다음 '대진표 저장'을 누르세요.
          </p>
        </>
      ) : (
        <div className="scr-league-bracket-scroll scr-scroll">
          <div className="scr-league-bracket-heads" style={{ width: canvasWidth, paddingLeft: PAD_L }}>
            {heads.map((r) => (
              <div key={r} className="scr-league-bracket-col-head" style={{ width: COL_W, marginRight: COL_GAP }}>
                {roundLabel(r, totalRounds)}
              </div>
            ))}
            <div className="scr-league-bracket-col-head" style={{ width: COL_W }}>우승</div>
          </div>
          <div className="scr-league-bracket-canvas" style={{ width: canvasWidth, height: totalHeight }}>
            <svg
              className="scr-league-bracket-svg" width={canvasWidth} height={totalHeight}
              viewBox={`0 0 ${canvasWidth} ${totalHeight}`}
            >
              {connectors.map((c, i) => (
                <path key={i} d={c.path} className={cx("scr-league-bracket-line", c.won && "scr-league-bracket-line-won")} />
              ))}
            </svg>
            {slots.map((s) => (
              <div key={s.key} className="scr-league-bracket-slot" style={{ left: s.x, top: s.y, width: COL_W, height: CARD_H }}>
                {s.node}
              </div>
            ))}
            <div
              className="scr-league-bracket-slot"
              style={{ left: champX, top: champY - CARD_H / 2, width: COL_W, height: CARD_H }}
            >
              {champion
                ? <TeamSlotCard team={champion} isWinner mode={league.mode} compact={compact} />
                : <div className="scr-league-bracket-champ">우승</div>}
            </div>
            {badges.map((b) => (
              <div key={b.key} className="scr-league-bracket-badge" style={{ left: b.x, top: b.y }}>
                {b.node}
              </div>
            ))}
            {/* 가지 버튼은 카드 위에 반쯤 올라타므로 맨 뒤에 그린다 — 앞선 카드/배지에
                가리면 못 누른다. */}
            {branchButtons.map((b) => (
              <div key={b.key} className="scr-league-bracket-branch-slot" style={{ left: b.x, top: b.y }}>
                {b.node}
              </div>
            ))}
          </div>
        </div>
      )}
      {editingMatch && (
        <MatchEditModal
          league={league} match={editingMatch}
          teamA={teamOf(editingMatch.teamA?.id)} teamB={teamOf(editingMatch.teamB?.id)}
          onSaved={onUpdated} onClose={() => setEditingPath(null)}
        />
      )}
      {cut && (
        <ConfirmDialog
          title={cut.path === null ? "대진표 지우기" : "가지 지우기"}
          message={(cut.path === null
            ? `대진표를 통째로 지웁니다. 경기 ${cut.matches}개가 사라져요.`
            : `이 자리에 매달린 경기 ${cut.matches}개가 통째로 사라져요.`)
            + (cut.teams > 0 ? `\n앉혀 둔 팀 ${cut.teams}팀의 배정도 함께 풀립니다(팀은 남아요).` : "")
            + "\n계속할까요?"}
          confirmLabel="지우기"
          onConfirm={() => cutSeat(cut.path, cut.side)}
          onCancel={() => setCut(null)}
        />
      )}
      {confirmingBracket && (
        <ConfirmDialog
          title="대진 확정"
          message={"대진을 확정하면 팀 배정을 더 이상 바꿀 수 없어요.\n"
            + "아무도 안 앉은 가지는 이때 사라지고, 혼자 남은 팀은 다음 라운드로 올라갑니다. 계속할까요?"}
          confirmLabel={busy ? "확정 중..." : "확정"}
          onConfirm={confirmBracket}
          onCancel={() => setConfirmingBracket(false)}
        />
      )}
    </div>
  );
}
