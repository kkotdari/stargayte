// 스타크래프트 브루드워 리플레이(.rep) 파일을 브라우저에서 직접 파싱한다.
// screp-js는 icza/screp(Go)을 GopherJS로 컴파일한 순수 JS 버전이라 서버 없이도 동작하고,
// 출력 형식이 screp CLI의 JSON 출력과 동일하다(Header.Players[], Header.StartTime,
// Header.Map, Header.Frames, Computed.WinnerTeam, Computed.PlayerDescs 등). 유지보수는
// 중단됐지만(→ screp-ts) 그건 Go 바이너리를 Node에서 실행하는 CLI 래퍼라 브라우저에서 못
// 쓴다 — 그래서 이 앱은 계속 screp-js를 쓴다.
import { fmt } from "./date";
import type { Race, GameType } from "../types";

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
  // 경기 요약 문장(replaySummary.ts)을 만들기 위한 원재료. 커맨드 스트림을 못 읽었으면 null.
  signals: ReplayPlayerSignals | null;
}

/** 건물 한 채를 어디에 언제 지었나. 좌표 단위는 screp이 주는 그대로(맵마다 다름) — 우리는
 *  절대값이 아니라 "내 본진에서 얼마나 멀리"라는 상대 거리로만 쓰므로 단위를 몰라도 된다. */
export interface BuildPos {
  unit: string;
  frame: number | null;
  x: number;
  y: number;
}

// 한 사람의 커맨드 스트림에서 뽑은 '전황' 재료. 숫자 지표(APM 등)와 달리 여기 값들은
// 문장을 만들기 위한 것이라, 정확한 수치보다 "무엇을 주로 뽑았고 언제까지 살아있었나"가
// 중요하다. 커맨드는 '명령'이지 '완성'이 아니라는 한계는 buildCount와 같다(위 주석 참고).
export interface ReplayPlayerSignals {
  /** 훈련·변태 커맨드로 센 유닛별 생산 커맨드 수(screp 영문명 그대로, 일꾼·보급 포함). */
  unitCounts: Record<string, number>;
  /** 유닛별 첫 생산 프레임 — "9분에 첫 캐리어" 같은 타이밍 이야기를 만들 때 쓴다. */
  firstUnitFrame: Record<string, number>;
  /** 건설·건물변태 커맨드로 센 건물별 수(확장 수, 테크 건물, 방어 건물 판정). */
  buildingCounts: Record<string, number>;
  /** 건물별 첫 건설 프레임 — 확장 타이밍/테크 타이밍용. */
  firstBuildingFrame: Record<string, number>;
  /** 유닛/건물별 생산 프레임 목록(경기 전체, 자르지 않는다). 첫 프레임만으로는 "스포닝풀
   *  전에 드론을 몇 기 뽑았나"(9드론/12드론) 같은 순서 이야기를 만들 수 없어서 따로 두는데,
   *  지금은 그보다 훨씬 넓게 쓰인다 — 이 목록이 곧 그 사람의 '생산 타임라인'이라,
   *  무너진 시점(fellFrame)·생산 급감(productionDips)·후반 주력(lateCombat)이 전부
   *  여기서 나온다. 앞쪽만 남기면 그 셋이 통째로 오판한다(pushFrame 위 주석 참고). */
  unitFrames: Record<string, number[]>;
  buildingFrames: Record<string, number[]>;
  /** 건물을 지은 좌표 — 몰래 배럭/센터 포토처럼 '어디에' 지었는지가 곧 전술인 것들을
   *  판정한다. screp이 Pos를 안 내려주는 버전이면 빈 배열로 남고, 그 전술들은 그냥 안 나온다. */
  buildPositions: BuildPos[];
  /** 유닛에게 내린 이동·공격 명령의 좌표(우클릭 / 표적 명령). "누가 누구 진영으로 밀고
   *  들어갔나"를 알 수 있는 유일한 근거다 — 리플레이에는 전투도 죽음도 없지만, 병력을
   *  어디로 보냈는지는 명령에 그대로 남는다(요청: 여러 명이 함께 덮친 걸 알 수 있나).
   *  선택·핫키는 화면 조작이라 좌표가 없고, 미니맵 핑은 의사표시지 병력이 아니라 뺀다.
   *  한계는 늘 같다 — '명령'이지 '도달'이 아니다. 그래서 한두 번 찍힌 건 정찰로 보고
   *  여러 번 몰린 경우만 근거로 쓴다(replayTactics의 pushersOn). */
  orderPositions: { frame: number; x: number; y: number }[];
  /** 연구한 테크(스톰/럴커 등)와 업그레이드 이름 — 순서대로. */
  techNames: string[];
  upgradeNames: string[];
  /** 테크별 첫 연구 프레임 — 요약을 시간순으로 늘어놓을 때 이 시점을 쓴다. */
  firstTechFrame: Record<string, number>;
  /** 이 사람이 친 채팅(앞쪽 일부). GG 선언처럼 승부를 말해주는 게 여기 있다. */
  chats: { frame: number | null; text: string }[];
  /** 수송선에서 유닛을 내린 커맨드 수와 첫 시점 — 드랍이 '실제로 있었나'의 유일한 증거다.
   *  셔틀·드랍십을 뽑았다는 것만으로는 드랍을 갔는지 알 수 없다(정찰·병력 수송일 수도 있다). */
  unloadCount: number;
  firstUnloadFrame: number | null;
  /** 건물을 띄운 커맨드 수(테란) — 여러 채를 띄웠다면 자리를 다 내주고 도망다녔다는 뜻이라,
   *  커맨드만으로 확인되는 몇 안 되는 '불리했다'는 증거다. */
  liftOffCount: number;
  firstLiftOffFrame: number | null;
  /** 판을 떠난 프레임과 그 사유(screp "Leave Game" 커맨드). 리플레이에서 '탈락'을 추측이
   *  아니라 사실로 알 수 있는 유일한 기록이다 — 생산이 끊긴 걸 보고 짐작할 필요가 없다. */
  leaveFrame: number | null;
  /** screp의 Reason 이름: Quit / Defeat / Victory / Finished / Draw / Dropped 등. */
  leaveReason: string | null;
  /** 첫 커맨드 프레임 — 없으면 null(커맨드를 하나도 안 낸 사람). */
  firstCmdFrame: number | null;
  /** 마지막 커맨드 프레임. 경기 끝보다 한참 이르면 그 시점에 졌거나 나간 것으로 읽는다. */
  lastCmdFrame: number | null;
  /** 경기를 3등분한 구간별 커맨드 수 — "초반 열세였다가 후반에 역전" 같은 흐름 판정용. */
  cmdCountByThird: [number, number, number];
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
  matchType: GameType;
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
  /** 커맨드가 난 프레임 — 타이밍(러시/역전/탈락 시점) 판정에 쓴다. */
  Frame?: number;
  /** 훈련·건설 커맨드의 대상 유닛/건물. screp은 종족 접두어 없는 영문명을 준다
   *  ("Zergling", "High Templar", "Siege Tank (Tank Mode)" 등). */
  Unit?: { Name?: string } | string;
  /** 연구 커맨드의 대상 — Tech는 "Psionic Storm" 같은 이름, Upgrade는 업그레이드 이름. */
  Tech?: { Name?: string } | string;
  Upgrade?: { Name?: string } | string;
  /** 건설 커맨드의 좌표. screp 버전에 따라 대문자/소문자 키라 둘 다 받는다. */
  Pos?: { X?: number; Y?: number; x?: number; y?: number } | null;
  /** 채팅 커맨드의 본문(Type.Name === "Chat"). */
  Message?: string;
  /** "Leave Game" 커맨드의 사유(Quit / Defeat / Dropped …). 버전에 따라 열거형 객체다. */
  Reason?: { Name?: string } | string;
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

// 유닛을 '뽑는' 커맨드 / 건물을 '짓는' 커맨드 — 둘을 갈라 세야 조합 이야기(유닛)와
// 운영 이야기(확장·테크·방어건물)를 따로 할 수 있다.
const UNIT_TRAIN_CMD_NAMES = new Set<string>(["Train", "Train Fighter", "Unit Morph"]);
const BUILD_CMD_NAMES = new Set<string>(["Build", "Building Morph", "Hatch"]);

// (삭제) 예전엔 유닛/건물 생산 프레임을 종류별 앞쪽 24개까지만 남겼다 — "9드론이냐
// 12드론이냐" 같은 초반 순서만 보던 시절의 최적화였다. 그 뒤로 요약 엔진이 이 목록을
// '경기 내내의 생산 타임라인'으로 쓰기 시작하면서(무너진 시점 fellFrame, 생산 급감
// productionDips, 후반 주력 lateCombat) 이 상한이 곧 오판의 원인이 됐다: 마린을 6분 만에
// 24기 뽑고 그 뒤로도 계속 뽑은 사람은, 기록상 7분부터 생산이 0이라 "7분에 무너졌다"
// "그때 크게 맞았다"로 읽혔다. 실제로 지적받은 두 증상이 모두 여기서 나왔다 —
// 파이어뱃 러시가 성공했는데 "실패함"으로 뒤집히던 것(러시 직후 상한에 걸린 제 생산이
// 급감으로 보여 rush-backfire 판정), 후반 캐리어·골리앗이 주력에서 빠지던 것.
// 이제 전부 담는다 — 커맨드 스트림은 어차피 한 번 훑고 버리는 값이라(요약만 저장된다)
// 긴 경기라도 숫자 수천 개 수준이다.
// (삭제) 건물 좌표도 앞쪽 80개까지만 담고 있었다 — 유닛 프레임 상한과 똑같은 함정이다.
// 빠른무한처럼 건물을 수백 채 짓는 경기는 80개면 초반 본진 언저리밖에 안 남아서, '맵
// 곳곳에 퍼져 지으며 버텼다' 같은 이야기가 통째로 안 보인다(실제 리플레이에서 확인:
// 펄론 77 + 게이트 27 + 캐논 26 …인데 좌표는 80개에서 끊겨 있었다).
// 채팅은 요약 재료로만 쓰므로 앞부분만 있으면 된다(GG는 대개 끝에 나오지만, 한 사람이
// 수십 줄을 치는 경우까지 전부 들고 있을 이유는 없다).
const CHAT_CAP = 40;
// 이동·공격 명령 좌표의 상한 — 병적으로 큰 파일에 대한 안전장치일 뿐, 보통 경기는 여기
// 한참 못 미친다(실측: 22분 4:4에서 여덟 명 합계 9367개 = 1인당 1200 남짓).
// 앞쪽만 남기고 자르면 후반의 공격이 통째로 안 보이므로, 자를 일이 없을 만큼 넉넉히 둔다.
const ORDER_POS_CAP = 20000;
// 브루드워 좌표: 빌드 타일 한 칸 = 32픽셀.
const PIXELS_PER_TILE = 32;

function emptySignals(): ReplayPlayerSignals {
  return {
    unitCounts: {}, firstUnitFrame: {},
    buildingCounts: {}, firstBuildingFrame: {},
    unitFrames: {}, buildingFrames: {}, buildPositions: [], orderPositions: [],
    techNames: [], upgradeNames: [], firstTechFrame: {}, chats: [],
    unloadCount: 0, firstUnloadFrame: null, liftOffCount: 0, firstLiftOffFrame: null,
    leaveFrame: null, leaveReason: null,
    firstCmdFrame: null, lastCmdFrame: null, cmdCountByThird: [0, 0, 0],
  };
}

// screp은 Unit/Tech/Upgrade를 {Name} 객체로 주지만, 버전에 따라 문자열일 수도 있어 둘 다 받는다.
function nameOf(v: { Name?: string } | string | undefined): string | null {
  if (!v) return null;
  return (typeof v === "string" ? v : v.Name) ?? null;
}

function posOf(v: ScrepCmd["Pos"]): { x: number; y: number } | null {
  if (!v) return null;
  const x = typeof v.X === "number" ? v.X : v.x;
  const y = typeof v.Y === "number" ? v.Y : v.y;
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

function pushFrame(bag: Record<string, number[]>, key: string, frame: number): void {
  (bag[key] ?? (bag[key] = [])).push(frame);
}

// 커맨드 스트림 한 번 훑기로 사람별 요약 재료를 모은다.
function collectSignals(cmds: ScrepCmd[], totalFrames: number | null): Map<number, ReplayPlayerSignals> {
  const out = new Map<number, ReplayPlayerSignals>();
  const at = (id: number) => {
    let s = out.get(id);
    if (!s) { s = emptySignals(); out.set(id, s); }
    return s;
  };
  for (const c of cmds) {
    const s = at(c.PlayerID);
    const frame = typeof c.Frame === "number" ? c.Frame : null;
    if (frame !== null) {
      if (s.firstCmdFrame === null || frame < s.firstCmdFrame) s.firstCmdFrame = frame;
      if (s.lastCmdFrame === null || frame > s.lastCmdFrame) s.lastCmdFrame = frame;
      if (totalFrames) {
        // 0/1/2 = 초반/중반/후반. 마지막 프레임이 정확히 총 프레임이면 인덱스가 3이 되므로 자른다.
        const third = Math.min(2, Math.floor((frame / totalFrames) * 3));
        s.cmdCountByThird[third] += 1;
      }
    }
    const cmdName = c.Type?.Name;
    if (cmdName && UNIT_TRAIN_CMD_NAMES.has(cmdName)) {
      const unit = nameOf(c.Unit);
      if (unit) {
        s.unitCounts[unit] = (s.unitCounts[unit] ?? 0) + 1;
        if (frame !== null) {
          if (s.firstUnitFrame[unit] === undefined) s.firstUnitFrame[unit] = frame;
          pushFrame(s.unitFrames, unit, frame);
        }
      }
    } else if (cmdName && BUILD_CMD_NAMES.has(cmdName)) {
      const b = nameOf(c.Unit);
      if (b) {
        s.buildingCounts[b] = (s.buildingCounts[b] ?? 0) + 1;
        if (frame !== null) {
          if (s.firstBuildingFrame[b] === undefined) s.firstBuildingFrame[b] = frame;
          pushFrame(s.buildingFrames, b, frame);
        }
        const pos = posOf(c.Pos);
        if (pos) {
          s.buildPositions.push({ unit: b, frame, x: pos.x, y: pos.y });
        }
      }
    }
    // 이동·공격 명령의 좌표(위 orderPositions 주석). 우클릭이 이동·공격·수리를 다 겸하고,
    // 표적 명령은 어택땅·패트롤 같은 것들이다. 둘 다 좌표를 갖고 있다.
    if (cmdName === "Right Click" || cmdName === "Targeted Order") {
      const pos = s.orderPositions.length < ORDER_POS_CAP ? posOf(c.Pos) : null;
      // 좌표계를 건물 쪽에 맞춘다: 건설 커맨드는 빌드 타일(128칸 맵이면 0~128), 이동·공격
      // 커맨드는 픽셀(0~4096)로 온다. 한 타일이 32픽셀이라 나눠 주면 같은 자로 잴 수 있다.
      // 실측으로 확인했다(같은 리플레이에서 build x[0~33] / order x[0~3797]).
      if (pos && frame !== null) {
        s.orderPositions.push({ frame, x: pos.x / PIXELS_PER_TILE, y: pos.y / PIXELS_PER_TILE });
      }
    }
    if (cmdName === "Unload" || cmdName === "Unload All") {
      s.unloadCount += 1;
      if (frame !== null && s.firstUnloadFrame === null) s.firstUnloadFrame = frame;
    }
    if (cmdName === "Lift Off") {
      s.liftOffCount += 1;
      if (frame !== null && s.firstLiftOffFrame === null) s.firstLiftOffFrame = frame;
    } else if (cmdName === "Leave Game") {
      // 여러 번 찍히면 마지막 것이 실제로 떠난 시점이다.
      s.leaveFrame = frame;
      s.leaveReason = nameOf(c.Reason);
    }
    if (cmdName === "Chat" && typeof c.Message === "string" && c.Message.trim()) {
      if (s.chats.length < CHAT_CAP) s.chats.push({ frame, text: c.Message.trim() });
    }
    const tech = nameOf(c.Tech);
    if (tech) {
      s.techNames.push(tech);
      if (frame !== null && s.firstTechFrame[tech] === undefined) s.firstTechFrame[tech] = frame;
    }
    const upgrade = nameOf(c.Upgrade);
    if (upgrade) s.upgradeNames.push(upgrade);
  }
  return out;
}

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

  // 요약 문장 재료 — 위 생산 커맨드 집계와 같은 스트림을 한 번 더 훑지 않도록 여기서 함께
  // 모은다. 구간(3등분) 기준은 헤더의 총 프레임이다.
  const totalFrames = typeof res.Header.Frames === "number" && res.Header.Frames > 0
    ? res.Header.Frames
    : null;
  const signalsByPlayerId = cmds ? collectSignals(cmds, totalFrames) : null;
  const signalsOf = (playerId: number): ReplayPlayerSignals | null =>
    signalsByPlayerId ? signalsByPlayerId.get(playerId) ?? emptySignals() : null;

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
        signals: signalsOf(p.ID),
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
  const matchType: GameType = confirmedTeam1.length === 1 && confirmedTeam2.length === 1 ? "0101" : "0102";

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
