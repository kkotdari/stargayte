// 스타크래프트 브루드워 리플레이(.rep) 파일을 브라우저에서 직접 파싱한다.
// screp-js는 icza/screp(Go)을 GopherJS로 컴파일한 순수 JS 버전이라 서버 없이도 동작하고,
// 출력 형식이 screp CLI의 JSON 출력과 동일하다(Header.Players[], Header.StartTime,
// Header.Map, Header.Frames, Computed.WinnerTeam, Computed.PlayerDescs 등). 유지보수는
// 중단됐지만(→ screp-ts) 그건 Go 바이너리를 Node에서 실행하는 CLI 래퍼라 브라우저에서 못
// 쓴다 — 그래서 이 앱은 계속 screp-js를 쓴다.
import { fmt } from "./date";
import type { Race, MatchType } from "../types";

const RACE_NAME_MAP: Record<string, Race> = {
  Terran: "테란",
  Protoss: "프로토스",
  Zerg: "저그",
};

// 1 프레임 = 0.042초 (약 23.81fps) — screp/BW 리플레이의 표준 프레임 단위
const SECONDS_PER_FRAME = 0.042;

export interface ParsedReplayPlayer {
  // 리플레이에 기록된 원본 이름 — 배틀태그 전체("닉네임#1234")가 아니라 게임 내 표시 이름
  // (배틀태그의 "#" 앞부분)만 저장돼 있다. 회원 매칭은 replayMemberMatch.ts에서 처리한다.
  rawName: string;
  // ""는 screp이 종족을 인식하지 못한 드문 경우 — "랜덤"으로 채우지 않는다(경기결과에는
  // 실제 종족만 저장하기로 했으므로), 검토 화면에서 직접 선택하도록 비워둔다.
  race: Race | "";
  team: number;
  apm: number | null;
  eapm: number | null;
  cmdCount: number | null;
  effectiveCmdCount: number | null;
  // 리플레이 커맨드 스트림에서 센 '생산' 지표 — 유닛 훈련/건물 건설/변태(저그) 커맨드의
  // 총합이다(build order 규모의 거친 대용치). 커맨드 스트림을 못 읽은 리플레이면 null.
  // 정확한 유닛 수가 아님을 유의: 저그 라바 여러 마리를 한 번에 변태시키면 커맨드는 1개라
  // 실제 생산량보다 적게 세질 수 있다(어림 지표).
  buildCount: number | null;
  // 리플레이 슬롯 타입이 "Computer"(AI)인 참가자 — 배틀태그가 있을 리 없으니 회원 매칭을
  // 아예 시도하지 않고 컴퓨터 슬롯으로 바로 채운다.
  isComputer: boolean;
}

export interface ParsedReplay {
  fileName: string;
  date: string; // YYYY-MM-DD (리플레이 시작 시각의 로컬 날짜)
  mapName: string;
  gameStartedAt: string | null; // ISO 8601, 리플레이의 실제 시작 시각
  durationSeconds: number | null;
  // 확정 근거(Observer 플래그/슬롯 타입/3번째 이후 팀 번호)로 걸러낸 관전자만 뺀다 —
  // 조작량만으로 의심되는 사람(guessedObservers)은 확정 근거가 아니라서 그대로 남아있다.
  players: ParsedReplayPlayer[];
  // 팀 번호 오름차순으로 앞의 두 팀만 실제 대전 상대다 — 첫 팀 → team1, 두 번째 팀 → team2.
  // 세 번째 이후 팀 번호는 관전 슬롯이라 애초에 players에서 빠진다.
  team1: ParsedReplayPlayer[];
  team2: ParsedReplayPlayer[];
  // guessedObservers에 든 사람은 team1/team2 인원수 계산(1:1 vs 팀전)에서는 빠지지만,
  // 실제 team1/team2 배열에는 그대로 남아있다 — 검토 화면에서 노란 글로우로 표시된 채
  // 로스터에 보이고, 진짜 관전자면 사람이 직접 빼야 한다.
  matchType: MatchType;
  // screp이 "마지막까지 남은 가장 큰 팀"으로 추정한 승자. 리플레이엔 승자가 직접 저장되지
  // 않아 추정치일 뿐이라, null이면 자동 판별에 실패했다는 뜻 — 반드시 사용자 확인이 필요하다.
  winnerSide: "team1" | "team2" | null;
  // 조작량이 현저히 적다는 이유로(확정 근거가 아니라 추정으로) 관전자로 의심되는 사람들의
  // 이름 — team1/team2에서 빠지지 않고 그대로 남아있다(검토 화면이 노란 글로우로 표시).
  // 팀 번호로 걸러낸 확정 관전자는 애초에 team1/team2에 없으므로 여기 들어오지 않는다.
  guessedObservers: string[];
  // screp이 이 리플레이의 실제 참가자 전원에게 같은 팀 번호(대개 0)를 매겼다는 뜻 —
  // 특정 UMS 맵(예: "슈퍼빨무")은 관전 슬롯이 함께 있으면 screp 자체가 두 편을 구분
  // 못 하고 전원을 팀 번호 0으로 내려준다(리플레이 헤더 자체의 한계라 우리 쪽 코드로
  // 복구할 방법이 없다). true면 team1에 전원이, team2는 비어있다 — 검토 화면에서 반드시
  // 사람이 직접 편을 갈라야 한다.
  teamSplitUncertain: boolean;
}

export class ReplayParseError extends Error {}

// screp의 Observer 플래그로도, 슬롯 타입으로도 안 걸리는 관전자가 실제로 있다 — 팀 슬롯에
// 그대로 앉아 있어서 1:1 경기가 2:1로 잡히고 "팀전"으로 오분류됐다(실제로 겪은 문제).
// 그래서 근거를 두 겹 더 쌓는다.
//
// (1) 팀 번호: 이 클럽 경기는 언제나 두 팀이 붙는다(FFA는 하지 않는다). 팀 번호가 세 개
//     이상 나오면 세 번째부터는 실제로 붙은 편이 아니라 관전 슬롯이다.
// (2) 조작량: 자리가 모자라 아예 팀 슬롯에 들어가 앉은 채로 관전만 한 경우가 있다 — 팀
//     번호로는 절대 못 가린다. 관전자도 화면 이동·유닛 선택·채팅은 하므로 커맨드 총합
//     (cmdCount)은 0이 아니고, 클릭이 많은 사람은 꽤 높기까지 하다. 하지만 유효커맨드
//     (effectiveCmdCount)는 실제 게임 조작만 세므로 관전자는 여기서 사실상 0에 가깝게 남는다.
//     절대값이 아니라 "그 경기에서 가장 많이 조작한 사람 대비 현저히 낮은가"로 본다.
const OBSERVER_ECMD_RATIO = 0.05;

function isObserverByActivity(p: ParsedReplayPlayer, all: ParsedReplayPlayer[]): boolean {
  // 컴퓨터(AI)는 명령이 기록되지 않는 경우가 있고, 애초에 관전자로 앉을 수도 없다.
  if (p.isComputer) return false;
  const maxEcmd = Math.max(...all.map((x) => x.effectiveCmdCount ?? 0));
  // 유효커맨드를 아예 못 읽은 리플레이(전원 0/null)에서는 이 기준을 쓸 수 없다 — 다 걸러버리면
  // 참가자가 한 명도 안 남는다.
  if (maxEcmd <= 0) return false;
  return (p.effectiveCmdCount ?? 0) <= maxEcmd * OBSERVER_ECMD_RATIO;
}

interface ScrepPlayer {
  ID: number;
  Name: string;
  Race?: { Name?: string };
  Team: number;
  Observer?: boolean;
  // "Computer"(AI, 옵저버가 아닌 실제 참가 슬롯) / "Human" 등 — icza/screp의 PlayerType.
  Type?: { Name?: string };
}

interface ScrepPlayerDesc {
  PlayerID: number;
  APM: number;
  EAPM: number;
  CmdCount: number;
  EffectiveCmdCount: number;
}

// screp 커맨드 스트림의 한 항목 — 우리는 생산 지표 집계에 PlayerID와 커맨드 종류(Type.Name)만
// 쓴다(프레임/좌표/유닛태그 등 나머지 필드는 무시).
interface ScrepCmd {
  PlayerID: number;
  Type?: { Name?: string };
}

interface ScrepResult {
  Header: {
    StartTime: string;
    Map: string;
    Frames: number;
    Players: ScrepPlayer[];
  };
  Computed: {
    WinnerTeam: number;
    PlayerDescs: ScrepPlayerDesc[] | null;
  };
  // cmds:true 옵션을 줘야 채워진다. 옵션이 없거나 파싱 실패면 null.
  Commands?: { Cmds?: ScrepCmd[] | null } | null;
}

// '생산'으로 셀 커맨드 종류(screp Type.Name). 유닛 훈련·건물 건설·저그 변태만 센다 —
// 테크/업그레이드는 '생산량'이 아니라 별개라 제외한다. 이 이름들은 icza/screp가 내려주는
// 커맨드 타입 이름과 정확히 일치해야 한다(node_modules/screp-js 확인).
const PRODUCTION_CMD_NAMES = new Set<string>([
  "Build",          // 건물 건설(저그 드론 건물 변태 시작 포함)
  "Train",          // 유닛 훈련(배럭/게이트웨이 등)
  "Train Fighter",  // 인터셉터/스캐럽
  "Unit Morph",     // 저그 유닛 변태(라바→유닛, 히드라→러커 등)
  "Building Morph", // 저그 건물 변태(해처리→레어, 크립콜로니→성큰 등)
  "Hatch",          // 저그 부화 관련 커맨드
]);

export async function parseReplayFile(file: File): Promise<ParsedReplay> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let res: ScrepResult;
  try {
    // screp-js는 GopherJS로 컴파일된 무거운 라이브러리(~1.3MB)라, 리플레이 등록 화면을
    // 실제로 열 때만 불러오도록 동적 import로 별도 청크로 분리한다.
    const { default: Screp } = await import("screp-js");
    // cmds:true를 줘야 커맨드 스트림(Commands.Cmds)이 채워진다 — 생산 지표 집계에 필요하다.
    // 기본값은 false라 예전엔 헤더/집계치만 받았다. 커맨드 배열이 커져 파싱이 조금 무거워지지만
    // 등록 시 한 번뿐이라 감수한다.
    res = (await Screp.parseBuffer(buf, { cmds: true })) as ScrepResult;
  } catch {
    throw new ReplayParseError(`"${file.name}" 파일을 리플레이로 읽지 못했어요.`);
  }

  const descByPlayerId = new Map<number, ScrepPlayerDesc>();
  (res.Computed?.PlayerDescs ?? []).forEach((d) => descByPlayerId.set(d.PlayerID, d));

  // 커맨드 스트림에서 플레이어별 '생산' 커맨드 수를 센다. 스트림을 아예 못 읽었으면(cmds가
  // null) 지표 자체를 알 수 없다는 뜻이라 전원 null로 남긴다 — 스트림이 있으면 생산 커맨드가
  // 없던 사람도 0으로 확정된다.
  const cmds = res.Commands?.Cmds ?? null;
  const buildCountByPlayerId = cmds
    ? cmds.reduce((acc, c) => {
        if (c.Type?.Name && PRODUCTION_CMD_NAMES.has(c.Type.Name)) {
          acc.set(c.PlayerID, (acc.get(c.PlayerID) ?? 0) + 1);
        }
        return acc;
      }, new Map<number, number>())
    : null;
  const buildCountOf = (playerId: number): number | null =>
    buildCountByPlayerId ? buildCountByPlayerId.get(playerId) ?? 0 : null;

  // 확실한 관전자(Observer 플래그/슬롯 타입)는 여기서 걸러낸다. 조작량만으로 의심되는
  // 사람(guessedObservers)은 확정 근거가 아니므로 걸러내지 않고 로스터에 그대로 남겨
  // 검토 화면에서 사람이 눈으로 확인하게 한다(아래 참고).
  const declared: ParsedReplayPlayer[] = (res.Header.Players ?? [])
    .filter((p) => !p.Observer && p.Type?.Name !== "Observer")
    .map((p) => {
      const desc = descByPlayerId.get(p.ID);
      return {
        rawName: p.Name,
        race: RACE_NAME_MAP[p.Race?.Name ?? ""] ?? "",
        team: p.Team,
        apm: desc?.APM ?? null,
        eapm: desc?.EAPM ?? null,
        cmdCount: desc?.CmdCount ?? null,
        effectiveCmdCount: desc?.EffectiveCmdCount ?? null,
        buildCount: buildCountOf(p.ID),
        isComputer: p.Type?.Name === "Computer",
      };
    });

  // (1) 팀 번호가 세 개 이상이면 앞의 두 팀만 실제로 붙은 편이다 — 옵저버 맵에서 관전자는
  // 그다음 팀 번호로 밀려난다(screp의 computeUMSTeams도 관전자에게 Team=3을 준다). 예전엔
  // "첫 팀 = team1, 나머지 전부 = team2"로 뭉뚱그려서 관전자가 team2에 그대로 딸려 들어갔다.
  const declaredTeamIds = [...new Set(declared.map((p) => p.team))].sort((a, b) => a - b);
  const playingTeamIds = declaredTeamIds.slice(0, 2);
  const onPlayingTeam = declared.filter((p) => playingTeamIds.includes(p.team));

  // 일부 UMS 맵("슈퍼빨무" 등)은 관전 슬롯이 함께 있으면 screp이 실제 참가자 전원에게도
  // 같은 팀 번호(0)를 매겨 내려보낸다 — 위 (1)번 로직이 기대하는 "팀 번호 최소 2종류"
  // 전제가 깨진다. 이땐 team1/team2로 갈라봤자 한쪽에 전원이 몰리고 반대쪽은 비어
  // 의미가 없으니, 아예 "자동으로 못 나눴다"는 신호를 남겨 검토 화면이 사람에게 직접
  // 편을 가르게 한다(실제로 지적받은 문제 — 관전자 섞인 슈퍼빨무 리플레이에서 팀이
  // 하나로 뭉쳐 나왔다).
  const teamSplitUncertain = declaredTeamIds.length < 2 && declared.length >= 2;

  // (2) 그러고도 실제 팀 슬롯에 앉은 관전자가 의심되면 조작량으로 짚어낸다 — 이건 확정
  // 근거가 아니라 추정이라, 예전엔 로스터에서 아예 빼고 이름만 텍스트로 알렸는데, 초반에
  // 나간 실제 참가자를 잘못 빼는 경우가 있어(실제로 지적받은 문제 — 그 사람이 낀 1:1
  // 경기가 조용히 "팀전"으로도 잘못 잡혔다) 이제는 로스터에 그대로 남기고 검토 화면에서
  // 눈에 띄게 표시만 한다(노란 글로우) — 진짜 관전자면 사람이 직접 빼면 된다.
  const players = onPlayingTeam;
  const guessedObservers = onPlayingTeam
    .filter((p, _i, all) => isObserverByActivity(p, all))
    .map((p) => p.rawName);
  const guessedObserverSet = new Set(guessedObservers);

  const [firstTeam] = playingTeamIds;
  const team1 = players.filter((p) => p.team === firstTeam);
  const team2 = players.filter((p) => p.team !== firstTeam);

  // 경기 유형(1:1 vs 팀전)은 의심스러운 사람을 뺀 "확실한 참가자" 수만으로 판단한다 —
  // 안 그러면 1:1 경기에 의심스러운 관전자 한 명이 팀 슬롯에 앉아있었다는 이유만으로
  // 다시 "팀전"으로 잘못 분류된다(이 로직 전체가 원래 막으려던 문제).
  const confirmedTeam1 = team1.filter((p) => !guessedObserverSet.has(p.rawName));
  const confirmedTeam2 = team2.filter((p) => !guessedObserverSet.has(p.rawName));
  const matchType: MatchType = confirmedTeam1.length === 1 && confirmedTeam2.length === 1 ? "0101" : "0102";

  const winnerTeamRaw = res.Computed?.WinnerTeam ?? 0;
  const winnerSide: "team1" | "team2" | null =
    winnerTeamRaw === 0 ? null : winnerTeamRaw === firstTeam ? "team1" : "team2";

  const startTime = new Date(res.Header.StartTime);
  const validStart = !Number.isNaN(startTime.getTime());
  const date = validStart ? fmt(startTime) : fmt(new Date());
  const gameStartedAt = validStart ? startTime.toISOString() : null;

  const frames = res.Header.Frames;
  const durationSeconds = typeof frames === "number" && frames > 0
    ? Math.round(frames * SECONDS_PER_FRAME)
    : null;

  return {
    fileName: file.name,
    date,
    mapName: res.Header.Map ?? "",
    gameStartedAt,
    durationSeconds,
    players,
    team1,
    team2,
    matchType,
    winnerSide,
    guessedObservers,
    teamSplitUncertain,
  };
}
