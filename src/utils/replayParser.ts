// 스타크래프트 브루드워 리플레이(.rep) 파일을 브라우저에서 직접 파싱한다.
// screp-js는 icza/screp(Go)을 GopherJS로 컴파일한 순수 JS 버전이라 서버 없이도 동작하고,
// 출력 형식이 screp CLI의 JSON 출력과 동일하다(Header.Players[], Header.StartTime,
// Header.Map, Header.Frames, Computed.WinnerTeam, Computed.PlayerDescs 등). 유지보수는
// 중단됐지만(→ screp-ts) 그건 Go 바이너리를 Node에서 실행하는 CLI 래퍼라 브라우저에서 못
// 쓴다 — 그래서 이 앱은 계속 screp-js를 쓴다.
import { fmt } from "./date";
import { battleCountsOf } from "./replayBattles";
import { buildMixOf, type BuildMix } from "./replayBuildMix";
import {
  normalizeUpgradeName, CAST_ORDER_TO_TECH, USE_CMD_TO_TECH, PLACE_MINE_ORDER,
  CAST_ORDER_TO_UNIT, USE_CMD_TO_UNIT,
} from "./replayTechNames";
import { buildUnitTracks } from "./replayUnits";
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
  /** 게임 내 색(#rrggbb) — screp의 Player.Color.RGB(요청: 유저 컬러 추출). 없으면 null. */
  color: string | null;
  apm: number | null;
  eapm: number | null;
  cmdCount: number | null;
  effectiveCmdCount: number | null;
  // 리플레이 커맨드 스트림에서 센 '생산' 지표 — 유닛 훈련/건물 건설/변태(저그) 커맨드의
  // 총합이다(build order 규모의 거친 대용치). 커맨드 스트림을 못 읽은 리플레이면 null.
  // 정확한 유닛 수가 아님을 유의: 저그 라바 여러 마리를 한 번에 변태시키면 커맨드는 1개라
  // 실제 생산량보다 적게 세질 수 있다(어림 지표).
  buildCount: number | null;
  /** 그 '생산'을 갈래별로 나눈 값(replayBuildMix.ts) — 건물 생산/방어, 병력 기본/고급/마법,
   *  지상/공중, 초반 일꾼 수. 커맨드 스트림을 못 읽은 리플레이면 null. */
  buildMix: BuildMix | null;
  // 리플레이 슬롯 타입이 "Computer"(AI)인 참가자 — 배틀태그가 있을 리 없으니 회원 매칭을
  // 아예 시도하지 않고 컴퓨터 슬롯으로 바로 채운다.
  isComputer: boolean;
  /** 시작 지점의 타일 좌표 — 미니맵에 그 사람의 본진 표시(아바타+닉네임)를 놓는 자리다.
   *  단위를 타일로 맞춰 두면 이동·공격 명령 좌표(orderPositions)와 같은 자로 잴 수 있다. */
  startX: number | null;
  startY: number | null;
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
  /** 테란 건물 착륙(Land) — 좌표는 건설과 같은 빌드 타일이다. 어느 건물이 내렸는지는 안
   *  남아, 재생이 가장 가까운 띄울 수 있는 건물로 어림한다(요청: 건물 띄우기 판단). */
  lands: { frame: number; x: number; y: number }[];
  /** 이륙(Lift Off) 프레임들 — 좌표도 어느 건물인지도 안 남는다. 재생이 다음 착륙(Land)과
   *  짝지어 "떠 있는 구간"을 어림한다(지적: 건물 떠 있는 게 표현이 안 된다). */
  lifts?: number[];
  /** 뜬 건물이 골라진 채의 이동 클릭(요청: 엔베 띄워 정찰이 안 나온다) — 떠 있는 건물
   *  마커가 이 자취를 따라 난다. 좌표는 타일. 옛 분석본에는 없다. */
  flyPositions?: { frame: number; x: number; y: number }[];
  /** 수송선 내리기(Unload) 커맨드의 좌표(타일) — 드랍 지점 표시의 재료(요청). */
  unloadPositions?: { frame: number; x: number; y: number }[];
  /** 제 수송선을 찍은 우클릭(태우기)의 좌표(타일) — 태움 표시의 재료(요청). */
  loadPositions?: { frame: number; x: number; y: number }[];
  /** 건설 취소 커맨드의 프레임 — 짓다 만 건물 판정의 재료(요청). 어느 건물인지는 안 남아,
   *  재생이 가장 최근 착공된 건물로 어림한다. */
  cancelBuilds: number[];
  /** 저그 건물 변태 — [프레임, 무엇으로]. 명령에 자리가 안 실려(고른 건물이 변한다),
   *  재생이 재료 건물(해처리·크립 콜로니…)을 되짚는다(요청: 건물 변태 추적). */
  buildingMorphs: { frame: number; to: string }[];
  /** 생산 건물의 랠리 포인트(지적: 갓 나온 유닛이 건물 옆에 있다가 갑자기 사라진다 —
   *  실제로는 랠리로 걸어간다). 건물을 골라 둔 채 찍은 우클릭이 곧 랠리라, 그 좌표와
   *  그때 골라져 있던 건물 번호(태그)를 남긴다. 재생은 갓 나온 유닛을 이 자리로 걷게 한다. */
  rallies: { frame: number; x: number; y: number; tag: number }[];
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
  /** unitFrames와 나란한 '그때 골라져 있던 유닛 번호(태그)' — 생산 커맨드는 지금 선택된
   *  건물에게 가고, 브루드워는 건물을 한 채만 고를 수 있어 첫 태그가 곧 그 건물이다(요청:
   *  어느 건물에서 생산 중인지). 태그↔건물 자리 대응은 리플레이에 없어서, 쓰는 쪽이
   *  "먼저 보인 태그 = 먼저 지은 건물" 어림으로 잇는다. 선택 기록이 없으면 0. */
  trainTags: Record<string, number[]>;
  buildingFrames: Record<string, number[]>;
  /** 건물을 지은 좌표 — 몰래 배럭/센터 포토처럼 '어디에' 지었는지가 곧 전술인 것들을
   *  판정한다. screp이 Pos를 안 내려주는 버전이면 빈 배열로 남고, 그 전술들은 그냥 안 나온다. */
  buildPositions: BuildPos[];
  /** 유닛에게 내린 이동·공격 명령의 좌표(우클릭 / 표적 명령). "누가 누구 진영으로 밀고
   *  들어갔나"를 알 수 있는 유일한 근거다 — 리플레이에는 전투도 죽음도 없지만, 병력을
   *  어디로 보냈는지는 명령에 그대로 남는다(요청: 여러 명이 함께 덮친 걸 알 수 있나).
   *  선택·핫키는 화면 조작이라 좌표가 없고, 미니맵 핑은 의사표시지 병력이 아니라 뺀다.
   *  한계는 늘 같다 — '명령'이지 '도달'이 아니다. 그래서 한두 번 찍힌 건 정찰로 보고
   *  여러 번 몰린 경우만 근거로 쓴다(replayTactics의 pushersOn).
   *
   *  kind는 그 우클릭·표적 명령이 실제로 어떤 명령이었나다(요청: 어택 지정·무브한 곳의
   *  좌표를 정확히 알 수 있나). 근거가 둘이다.
   *   · 표적 명령(어택땅·패트롤 …)에는 Order 이름이 실린다 — "Attack"으로 시작하면 공격,
   *     "Move"면 이동이고, 채집·수리·랠리 같은 나머지는 비워 둔다.
   *   · 우클릭에는 Order가 아예 없다. 대신 '무엇을 찍었나'가 남는다 — 자원을 찍었으면
   *     채집이라 비우고, 다른 편 유닛을 찍었으면 공격, 빈 땅이면 이동이다.
   *  스타에서 병력을 움직이는 건 대부분 그냥 우클릭이라 이 둘째 갈래가 훨씬 크다(실측한
   *  4:4에서 우클릭 9885개 대 표적 명령 1466개). 옛 screp 버전이 Order도 Unit도 안 주면
   *  비워지고, 그 좌표는 여느 때처럼 '근처에 몰렸나'로만 쓰인다. */
  orderPositions: {
    frame: number; x: number; y: number; kind?: "attack" | "move";
    /** 선택 묶음 번호(지적: 단축키 부대지정 뒤 이동이 순간이동으로 보임) — 같은 유닛
     *  번호 집합(부대지정·같은 드래그 선택)으로 내린 명령끼리 같은 번호다. 재생이 이
     *  번호로 "같은 부대의 자취"를 잇는다. 옛 분석본에는 없다. */
    g?: number;
    /** 그 명령을 받은 유닛이 무엇이었나 — 알아낸 경우에만 붙는다("Siege Tank",
     *  "High Templar", "Arbiter", "Defiler", "Bionic", "Transport" …).
     *
     *  리플레이에는 '어떤 유닛에게 내린 명령'인지가 직접 안 적힌다. 대신 두 가지가 남는다:
     *  선택(Select)에 실린 유닛 번호(UnitTags)와, 그 유닛만 할 수 있는 커맨드다. 시즈는
     *  시즈탱크만, 스톰은 하이템플러만, 리콜은 아비터만 한다 — 그런 커맨드가 나온 순간
     *  골라져 있던 번호는 곧 그 유닛의 번호다(replayTechNames의 CAST_ORDER_TO_UNIT /
     *  USE_CMD_TO_UNIT). 그렇게 알아낸 번호를 고른 채 내린 이동·공격 명령에 이름을 붙인다. */
    by?: string;
    /** 그 명령 때 골라져 있던 유닛 수(요청: 리플레이 정보를 최대한 활용) — 이름을 못
     *  알아낸 명령이라도 '한 기짜리 클릭'인 것은 안다. 초반 정찰(일꾼·오버로드)은 죄다
     *  한 기라, 재생의 부대 자취가 이 수로 정찰을 걷어낸다. 선택 기록이 없으면 안 붙는다. */
    n?: number;
  }[];
  /** 상대의 유닛·건물을 직접 찍은 순간 — '누구를 쳤나'를 어림이 아니라 사실로 아는
   *  유일한 자리다(요청: 공격 타겟팅을 정확히).
   *
   *  근거는 우클릭·표적 명령에 실려 오는 '찍은 대상의 번호(UnitTag)'다. 번호만으로는
   *  누구 것인지 모르지만, 사람은 저마다 제 유닛만 고르므로 선택(Select) 기록을 다 모으면
   *  번호마다 임자가 드러난다. 그 임자가 다른 편이면 그 클릭은 곧 그 사람을 친 것이고,
   *  좌표·시각까지 그대로 남는다.
   *
   *  주의한 것 둘. ① 관전자는 남의 유닛도 고를 수 있어 임자를 흐리므로 선택 기록에서
   *  아예 뺀다(실측: 관전자 둘이 낀 1:1에서 '피격자'로 관전자 이름이 72번 나왔다).
   *  ② 유닛이 죽으면 그 번호를 새 유닛이 물려받는다 — 그래서 한 번이라도 고른 사람이
   *  아니라 '압도적으로 많이 고른 사람'만 임자로 인정한다(TAG_OWNER_SHARE).
   *
   *  한계: 아군을 찍은 것(따라가기·수리·힐)은 제외했고, 어택땅처럼 대상 없이 땅을 찍은
   *  공격은 여기 안 남는다(그건 orderPositions가 맡는다). */
  hits: { frame: number; x: number; y: number; whom: string }[];
  /** 연구한 테크(스톰/럴커 등)와 업그레이드 이름 — 순서대로.
   *
   *  이름은 replayTechNames.ts의 TECH_NAMES / UPGRADE_NAMES 그대로다. 업그레이드는 screp이
   *  "Ion Thrusters (Vulture Speed)"처럼 괄호 설명을 붙여 주는데, 여기 담을 때 떼어
   *  ("Ion Thrusters") 통일한다 — 안 그러면 코드에서 이름을 비교할 때마다 긴 이름을 정확히
   *  적어야 하고, 실제로 그걸 틀려서 조건이 늘 false이던 자리가 여럿 있었다(지적).
   *
   *  공/방 업그레이드는 한 단계 올릴 때마다 같은 이름이 한 번씩 더 들어온다 — 그래서 나온
   *  횟수가 곧 단계(최대 3)다. upgradeLevel()로 센다. */
  techNames: string[];
  upgradeNames: string[];
  /** 테크·업그레이드별 첫 연구 프레임 — 요약을 시간순으로 늘어놓을 때 이 시점을 쓴다. */
  firstTechFrame: Record<string, number>;
  firstUpgradeFrame: Record<string, number>;
  /** 기술을 실제로 '쓴' 횟수와 처음 쓴 시점 — 연구만 하고 안 쓴 것과 가르는 유일한 근거다
   *  (지적: "연구한 것만으로는 아무것도 아니야"). 무엇이 사용 증거인지는 기술마다 달라서
   *  replayTechNames의 CAST_ORDER_TO_TECH / USE_CMD_TO_TECH / PLACE_MINE_ORDER가 정한다. */
  techUses: Record<string, number>;
  /** 기술을 쓴 프레임 목록 — 지표를 '주요시간대'로 좁혀 세는 데 쓴다(요청). 유닛·건물은
   *  unitFrames/buildingFrames가 이미 그 일을 하고 있었는데 기술만 총합뿐이었다. */
  techFrames: Record<string, number[]>;
  /** 마법을 실제로 '어디에' 썼나 — 리콜·스톰·다크스웜·이레디에이트처럼 좌표를 갖는 마법은
   *  그 좌표가 곧 그 장면의 자리다(요청: 유닛 특정 로직을 다른 기술로도 넓히기). 이동
   *  명령 뭉치의 중심을 어림하는 것과 달리 이건 게임이 실제로 받은 지점이라 정확하다.
   *  좌표 단위는 타일(orderPositions와 같은 자). */
  castPositions: { tech: string; frame: number; x: number; y: number }[];
  firstTechUseFrame: Record<string, number>;
  /** 이 사람이 친 채팅(앞쪽 일부). GG 선언처럼 승부를 말해주는 게 여기 있다.
   *
   *  팀챗/전체챗 구분은 여기 없다 — 리플레이가 안 담는다(Chat 커맨드 필드가 Frame·
   *  PlayerID·Type·SenderSlotID·Message 다섯뿐). 말주머니 쪽은 말의 내용으로만 전체챗을
   *  짚는다(replaySummary의 saidToAll). */
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

/** 미니맵을 그리는 데 쓰는 맵의 지형 격자.
 *
 *  리플레이 파일 안에는 맵의 시나리오 데이터가 함께 들어 있어서 타일 격자를 그대로 읽을 수
 *  있다(screp의 mapTiles). 다만 그 타일 번호를 실제 픽셀로 바꾸는 그래픽(tileset의
 *  cv5/vx4/vr4와 팔레트)은 게임 설치본에 있는 저작물이라 여기 없다 — 그래서 우리가 그리는
 *  건 게임과 같은 색의 미니맵이 아니라 '타일 종류를 색으로 구분한 개략도'다. 실제로 확인해
 *  보면 그것만으로도 본진 여덟 자리·램프·중앙 광장이 또렷하게 나온다.
 *
 *  담는 형태가 팔레트+바이트인 이유는 크기다: 한 맵에 나오는 타일 그룹은 서른 몇 종류뿐이라
 *  1바이트 첨자로 접힌다(실측 128×128 맵: 숫자 배열 JSON 63KB → base64 22KB → gzip 1.1KB). */
export interface ReplayMapGrid {
  /** 격자 내용의 해시 — 서버에서 같은 맵을 두 번 저장하지 않게 하는 열쇠다(요청: 같은
   *  맵이면 미니맵 하나를 함께 쓰자). 이름이 아니라 내용이 기준이다. */
  hash: string;
  /** 그 리플레이에 적혀 있던 맵 이름(사람이 DB를 볼 때의 단서). */
  name: string;
  width: number;
  height: number;
  /** 이 맵에 나오는 타일 그룹 번호들 — tiles의 각 바이트가 이 배열의 첨자다. */
  palette: number[];
  /** width*height개의 팔레트 첨자를 바이트로 늘어놓고 base64로 옮긴 것. */
  tiles: string;
  /** 자원 자리(앞마당·멀티) — 미네랄 밭과 가스를 가까운 것끼리 묶어 '한 자원 지대'로 만든
   *  것이다(요청: 자원 위치 파악). 낱개 미네랄 400개를 다 그리면 노이즈라, 묶어서 지대
   *  중심만 남긴다. [타일x, 타일y, 가스있음(0/1)]. 못 읽었으면 빈 배열. */
  resources: [number, number, 0 | 1][];
  /** 사람이 올려 둔 실제 미니맵 그림(data URL) — 있으면 격자 대신 이걸 그린다(요청: 물·풀·
   *  땅·벽을 실제와 비슷하게). 서버에서 내려오는 값이라 리플레이를 읽어 만들 때는 없다. */
  image?: string | null;
  /** 그 그림의 지형(이동 가능/불가) 격자 — 운영자가 검수·수정한 값(요청). JSON 문자열. */
  walk?: string | null;
  /** 그 그림의 번호 — 재생 화면의 지형 수정 버튼이 저장할 곳(요청: 아무나 업데이트). */
  imageId?: number | null;
  /** 그 그림의 이름 — 지형 검수 창 제목이 리플레이 원본 이름(제어문자 섞임) 대신 쓰는
   *  대표맵 이름(요청). */
  imageName?: string | null;
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
  /** 맵의 지형 격자 — 못 읽었으면 null이고, 그때는 그 경기에 미니맵이 안 붙는다. */
  mapGrid: ReplayMapGrid | null;
  /** 맵에 있는 '모든' 시작 지점(타일) — 이번 판에 아무도 안 앉은 자리까지 포함한다. 맵의
   *  가운데를 재는 데 쓴다(요청: 센터는 실제로 안 나왔더라도 모든 스타팅 포인트의 중심으로
   *  잡아야 한다). 못 읽었으면 빈 배열. */
  startSpots: [number, number][];
  /** 개체 트랙 v2(JSON 문자열) — 태그(유닛 번호) 단위의 생애·정체·증거 스트림(요청: 유닛
   *  위치를 저마다 기억하고 브루드워 엔진처럼 분석 + 건물 파괴 파악). 기존 부대 추적과
   *  비교할 수 있게 별도 테이블(game_result_unit_tracks)에 저장된다. 분석이 실패해도
   *  등록은 막지 않는다 — 그때는 null. */
  unitTracks: string | null;
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
  /** 맵의 시작 지점(MapData.StartLocations)과 짝지을 슬롯 번호 — 그 사람이 몇 시에서
   *  시작했는지를 알아내는 유일한 연결고리다(ID는 커맨드 스트림용 번호로 다르다). */
  SlotID?: number;
  Race?: { Name?: string };
  Team: number;
  Observer?: boolean;
  // "Computer"(AI, 옵저버가 아닌 실제 참가 슬롯) / "Human" 등 — icza/screp의 PlayerType.
  Type?: { Name?: string };
  /** 게임 내 색 — RGB는 0xRRGGBB 수다(요청: 유저 컬러 추출). */
  Color?: { Name?: string; RGB?: number };
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
  /** 표적 명령(Targeted Order)·우클릭이 실어 보내는 '무슨 명령인가' — 마법을 쓴 기록이
   *  여기 CastPsionicStorm 같은 이름으로 남는다(사용 판정의 근거). */
  Order?: { Name?: string } | string;
  /** 선택 커맨드가 실어 보내는 유닛 번호들 — 시즈탱크를 가려내는 데 쓴다
   *  (위 orderPositions.tank 주석). */
  UnitTags?: number[];
  /** 우클릭·표적 명령이 '무엇을 찍었나' — 찍은 대상의 유닛 번호(UnitTag)와, 그 대상이
   *  건물·자원처럼 종류가 확실할 때만 채워지는 이름(Unit). 병력을 찍은 우클릭은 이름 없이
   *  번호만 온다(그 번호의 임자는 선택 기록으로 따로 푼다). */
  UnitTag?: number;
  /** 핫키 커맨드의 그룹 번호와 종류(Assign/Select). */
  Group?: number | { Name?: string };
  HotkeyType?: { Name?: string } | string;
  /** 채팅 커맨드의 본문(Type.Name === "Chat"). */
  Message?: string;
  /** 채팅을 친 사람의 '슬롯' 번호 — Header.Players[].SlotID와 짝지어야 화자를 안다.
   *  이 커맨드의 PlayerID는 화자가 아니다(collectSignals의 Chat 주석). 팀챗인지
   *  전체챗인지는 리플레이에 안 담긴다 — 필드가 이것과 Message뿐이다(실측). */
  SenderSlotID?: number;
  /** "Leave Game" 커맨드의 사유(Quit / Defeat / Dropped …). 버전에 따라 열거형 객체다. */
  Reason?: { Name?: string } | string;
  /** screp이 매긴 '헛친 커맨드' 종류 — 실제로 아무 일도 안 일어난 커맨드에만 붙는다.
   *  0(유효)일 때는 아예 필드가 없다(screp-js가 지워서 내려준다). 값은 unit queue overflow /
   *  too fast cancel / too fast repetition / too fast selection change / repetition /
   *  repetition of the same hotkey 중 하나다. */
  IneffKind?: number | string;
}

interface ScrepResult {
  Header: {
    StartTime: string;
    Map: string;
    Frames: number;
    Players: ScrepPlayer[];
    /** 맵 크기(타일). 시작 지점 좌표는 타일×32이라, 가운데를 잴 때 32를 곱해 쓴다. */
    MapWidth?: number;
    MapHeight?: number;
  };
  /** mapData:true로 파싱했을 때만 채워진다 — 시작 지점 좌표를 여기서 얻는다. */
  MapData?: {
    StartLocations?: { X: number; Y: number; SlotID: number }[] | null;
    /** mapTiles:true까지 줘야 채워진다 — 타일 하나당 숫자 하나(왼쪽 위부터 가로 순).
     *  값은 16비트 타일 번호로, 위 12비트가 '그룹'(지형 종류)이고 아래 4비트가 그 안의
     *  무늬 변형이다. 미니맵은 그룹만 쓴다. */
    Tiles?: number[] | null;
    /** mapResLoc:true로 파싱했을 때만 채워진다 — 미네랄 밭/가스의 좌표(단위는 타일×32).
     *  자원 위치는 앞마당·멀티가 어디인지를 보여줘 동선·전략을 읽는 근거가 된다(요청). */
    MineralFields?: { X: number; Y: number }[] | null;
    Geysers?: { Point?: { X: number; Y: number } }[] | null;
  } | null;
  Computed: {
    WinnerTeam: number;
    PlayerDescs: ScrepPlayerDesc[] | null;
    /** 나간 기록 — screp이 승패를 못 가렸을 때 우리가 직접 가리는 근거다(아래 winnerSide). */
    LeaveGameCmds?: { Frame: number; PlayerID: number }[] | null;
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
/** 일꾼만 낼 수 있는 커맨드 — 고른 것이 일꾼이라는 뜻이다(위 byRole 주석). */
const WORKER_CMD_NAMES = new Set<string>(["Build", "Hatch"]);
/** 우클릭으로 찍었을 때 '고른 것이 일꾼'임을 말해 주는 대상들 — 미네랄은 종류가 여럿이라
 *  이름 앞부분으로 가른다(Mineral Field (Type 1~3)). */
const RESOURCE_TARGETS = new Set<string>([
  "Vespene Geyser", "Assimilator", "Refinery", "Extractor",
  "Mineral Field (Type 1)", "Mineral Field (Type 2)", "Mineral Field (Type 3)",
]);
/** 건물만 낼 수 있는 커맨드 — 고른 것이 건물이고, 그 뒤의 우클릭은 랠리 찍기다. */
const BUILDING_ONLY_CMD_NAMES = new Set<string>([
  "Train", "Cancel Train", "Building Morph", "Lift Off", "Land",
]);
/* "Build Addon" — 커샛·머신샵 같은 테란 부속건물의 건설 커맨드(지적: 애드온이 표시가
   안 된다 — 이 이름이 목록에 없어 buildPositions에 아예 안 실렸다). */
const BUILD_CMD_NAMES = new Set<string>(["Build", "Build Addon", "Building Morph", "Hatch"]);

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
/** 시작 직후 '통째 선택' 판정 창(프레임, 약 30초) — 이 안의 4기 이상 선택이 찍은 자원
 *  클릭에는 일꾼 낙인을 안 찍는다(스타팅 오버로드 오염 방지, 아래 byClick 주석). */
const EARLY_ALL_SELECT_FRAMES = 720;

function emptySignals(): ReplayPlayerSignals {
  return {
    unitCounts: {}, firstUnitFrame: {}, lands: [], cancelBuilds: [], buildingMorphs: [], rallies: [],
    buildingCounts: {}, firstBuildingFrame: {},
    unitFrames: {}, trainTags: {}, buildingFrames: {}, buildPositions: [], orderPositions: [], hits: [],
    techNames: [], upgradeNames: [], firstTechFrame: {}, firstUpgradeFrame: {},
    techUses: {}, techFrames: {}, firstTechUseFrame: {}, castPositions: [], chats: [],
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
// 같은 연구를 이 프레임 안에 또 눌렀으면 '연타'로 보고 한 번만 센다.
//
// 실제 리플레이에서 확인한 값이다(4:4 빠른무한): 진짜 다음 단계는 4000~10000프레임
// (170~420초) 뒤에 오고, 연타는 2~12프레임(1초 이내)에 몰려 있다. 한 사람은 시즈모드를
// 5825~5863프레임 사이에 아홉 번 눌렀다 — 한 번만 연구되는 기술인데 아홉 번으로 기록된다.
// screp의 무효 표시(IneffKind)만으로는 안 된다: 저 아홉 번은 전부 '유효'로 왔고, 반대로
// 진짜 단계와 연타가 섞인 자리에서는 앞엣것에 무효 표시가 붙기도 했다.
// 브루드워에서 가장 빠른 업그레이드도 100초(약 2400프레임)는 걸리므로, 2초(48프레임)로
// 끊으면 진짜 단계를 잘라먹을 위험은 없다.
const RESEARCH_DEDUPE_FRAMES = 48;

/** 연구(테크/업그레이드) 하나를 기록한다 — 직전 같은 연구와 너무 붙어 있으면 버린다.
 *  실제로 담았으면 true(그때만 '첫 시점'을 갱신한다). */
function pushResearch(
  into: string[], last: Map<string, number>, key: string, name: string, frame: number | null,
): boolean {
  if (frame !== null) {
    const prev = last.get(key);
    if (prev !== undefined && frame - prev < RESEARCH_DEDUPE_FRAMES) {
      last.set(key, frame); // 연타가 이어지는 동안 기준점을 민다
      return false;
    }
    last.set(key, frame);
  }
  into.push(name);
  return true;
}

/** 유닛 번호의 임자로 인정하려면 그 번호를 고른 횟수의 이만큼을 혼자 차지해야 한다 —
 *  유닛이 죽으면 번호가 재사용되므로, 스쳐 지나간 한두 번으로 임자를 정하면 안 된다. */
const TAG_OWNER_SHARE = 0.7;

/** 유닛 번호 → 임자(PlayerID). 사람은 저마다 제 유닛만 고르므로 선택 기록만 모으면
 *  임자가 드러난다(위 hits 주석). 관전자의 선택은 남의 유닛도 섞이므로 아예 뺀다. */
function ownerOfTags(cmds: ScrepCmd[], observers: Set<number>): Map<number, number> {
  const tally = new Map<number, Map<number, number>>();
  for (const c of cmds) {
    const n = nameOf(c.Type);
    if ((n !== "Select" && n !== "Select Add") || observers.has(c.PlayerID)) continue;
    for (const t of c.UnitTags ?? []) {
      if (typeof t !== "number") continue;
      let m = tally.get(t);
      if (!m) { m = new Map(); tally.set(t, m); }
      m.set(c.PlayerID, (m.get(c.PlayerID) ?? 0) + 1);
    }
  }
  const out = new Map<number, number>();
  for (const [tag, m] of tally) {
    let total = 0;
    let best: [number, number] | null = null;
    for (const e of m) { total += e[1]; if (!best || e[1] > best[1]) best = e; }
    if (best && best[1] / total >= TAG_OWNER_SHARE) out.set(tag, best[0]);
  }
  return out;
}

function collectSignals(
  cmds: ScrepCmd[],
  totalFrames: number | null,
  /** 누가 어느 편이고 누가 관전자인가 — '상대의 유닛을 찍었다'를 가리는 데만 쓴다.
   *  없으면 hits는 빈 배열로 남는다(옛 리플레이·헤더를 못 읽은 경우).
   *  slot은 채팅의 화자를 찾는 데 쓴다(아래 Chat 주석). */
  roster?: { id: number; slot: number | undefined; team: number; obs: boolean; raw: string }[],
): Map<number, ReplayPlayerSignals> {
  const observers = new Set((roster ?? []).filter((p) => p.obs).map((p) => p.id));
  const teamOf = new Map((roster ?? []).map((p) => [p.id, p.team]));
  const rawOf = new Map((roster ?? []).map((p) => [p.id, p.raw]));
  /* 채팅을 친 사람은 커맨드의 PlayerID가 아니라 SenderSlotID로 찾는다 — 슬롯 번호는
     ID와 다른 체계라(ScrepPlayer.SlotID 주석) 여기서 되짚어야 한다. */
  const idOfSlot = new Map(
    (roster ?? []).filter((p) => p.slot !== undefined).map((p) => [p.slot as number, p.id]),
  );
  const tagOwner = roster ? ownerOfTags(cmds, observers) : new Map<number, number>();
  const out = new Map<number, ReplayPlayerSignals>();
  const at = (id: number) => {
    let s = out.get(id);
    if (!s) { s = emptySignals(); out.set(id, s); }
    return s;
  };
  // 플레이어+연구 이름 → 마지막으로 기록한 프레임(연타 판정용).
  const lastResearchFrame = new Map<string, number>();
  /* 명령을 받은 유닛이 무엇인지 알아내기 위한 장치(위 orderPositions.by 주석).
     · sel: 지금 그 사람이 골라 둔 유닛 번호들. 선택/추가/해제와 핫키로 갱신된다.
     · groups: 핫키 그룹에 넣어 둔 번호들 — 핫키로 부르면 그게 곧 선택이 된다.
     · unitOfTag: 그 유닛만 할 수 있는 커맨드가 나온 순간 골라져 있던 번호 → 그 유닛 이름.
     · pending: 명령 하나하나가 '그때의 선택'을 기억해 둔다 — 유닛 이름은 그 커맨드가
       나온 뒤에야 알 수 있어서, 다 훑은 뒤에 되돌아가 붙여야 그 앞의 이동도 놓치지 않는다. */
  const sel = new Map<number, number[]>();
  /* 같은 드론에게 연달아 내린 건설(지적: 스포닝풀이 두 채 — 실제로는 첫 명령을 무르고
     옆에 다시 지은 것) — 저그의 Build(DroneStartBuild)는 '드론아 가서 변해라'는 예약이라,
     선택을 안 바꾼 채(같은 드론인 채) 곧 또 Build를 내리면 앞 예약은 없던 일이 된다.
     드론이 이미 변태를 시작했다면 두 번째 명령을 받을 몸이 없으므로, 두 번째가 헛치지
     않았다는 것 자체가 첫째가 착공도 못 했다는 증거다. screp은 이걸 IneffKind로 안
     잡아 줘서(실측: mineral10 4:4에서 1초 간격 스포닝풀 두 번이 둘 다 유효로 남음)
     여기서 직접 무른다. 창(20초)은 옛 선택이 그대로 남은 채 한참 뒤에 딴 드론 무리로
     짓는 드문 경우를 막는 보험이다. */
  const lastDroneBuild = new Map<number, { unit: string; frame: number; x: number | null; y: number | null; drone: boolean }>();
  const DRONE_REBUILD_WINDOW_FRAMES = Math.round(20 / SECONDS_PER_FRAME);
  /* 테란·프로토스도 도달 전 재명령이면 앞 건설이 취소되는 건 같지만(지적), 일꾼이
     소모되지 않아 "두 번째가 유효했다 = 첫째 미착공" 증명이 없다 — 실측으로 확인:
     빠른무한 1:1에서 프로브가 선택 변경 없이 1.7초 간격으로 게이트웨이 둘을 놓았는데
     훈련 태그 추적 결과 둘 다 실존했다(자리에 서 있으면 즉시 짓고 바로 다음을 짓는다).
     그래서 SCV·프로브는 물리적으로 확실한 경우만 무른다: 같은 종류를 발자국이 겹치는
     자리에 다시 놓으면 두 채가 같이 설 수 없으므로 앞 명령은 재배치다. 시프트 예약
     걱정은 없다 — 브루드워의 Build 커맨드에는 Queued 필드 자체가 없어(Right Click
     등에만 있다) 건설은 예약이 안 되고, 새 건설 명령이 늘 앞 것을 대체한다. */
  const WORKER_FOOTPRINT: Record<string, [number, number]> = {
    "Command Center": [4, 3], Barracks: [4, 3], Factory: [4, 3], Starport: [4, 3],
    "Science Facility": [4, 3], "Engineering Bay": [4, 3], Refinery: [4, 2],
    "Supply Depot": [3, 2], Academy: [3, 2], Armory: [3, 2], Bunker: [3, 2],
    "Missile Turret": [2, 2],
    Nexus: [4, 3], Gateway: [4, 3], Stargate: [4, 3], Assimilator: [4, 2],
    Forge: [3, 2], "Cybernetics Core": [3, 2], "Shield Battery": [3, 2],
    "Robotics Facility": [3, 2], Observatory: [3, 2], "Robotics Support Bay": [3, 2],
    "Citadel of Adun": [3, 2], "Templar Archives": [3, 2], "Fleet Beacon": [3, 2],
    "Arbiter Tribunal": [3, 2], Pylon: [2, 2], "Photon Cannon": [2, 2],
  };
  const groups = new Map<string, number[]>();
  const unitOfTag = new Map<string, { from: number; name: string; last: number }[]>();
  const nameTag = (key: string, frame: number, named: string) => {
    const list = unitOfTag.get(key);
    if (!list) { unitOfTag.set(key, [{ from: frame, name: named, last: frame }]); return; }
    const tail = list[list.length - 1];
    // 같은 이름의 되풀이는 갱신이다 — 그 정체가 그 시각까지 살아 있었다는 증거.
    if (tail.name === named) tail.last = Math.max(tail.last, frame);
    else list.push({ from: frame, name: named, last: frame });
  };
  /* 정체의 유효기간(지적: 아직도 일꾼 마커와 유닛 마커가 뒤바뀐다 — 번호는 유닛이 죽으면
     새 유닛이 물려받는데, 새 임자가 저만의 커맨드를 안 내리면 옛 정체가 앞으로 무한정
     뻗었다. 일꾼 번호를 물려받은 탱크는 시즈할 때까지 일꾼이었고, 그 클릭이 일꾼 자취에
     섞여 순간이동으로도 보였다). 갱신(같은 정체의 재확인)이 끊긴 지 이만큼 지나면 모른다고
     답한다 — 일꾼은 건설·채집 클릭으로 수시로 갱신되니 짧게, 나머지는 넉넉히. */
  const ID_TTL_SEC: Record<string, number> = { Worker: 180 };
  const ID_TTL_DEFAULT_SEC = 300;
  /** 그 시각의 임자 이름 — 첫 정체는 뒤(과거)로도 뻗는다: 그 유닛은 제 정체가 드러나기
   *  전에도 그 유닛이었다. 앞(미래)으로는 유효기간까지만 뻗는다(위 ID_TTL 주석). */
  const nameAt = (key: string, frame: number): string | undefined => {
    const list = unitOfTag.get(key);
    if (!list) return undefined;
    let span = list[0];
    for (const sp of list) {
      if (sp.from > frame) break;
      span = sp;
    }
    if (frame < span.from) return span.name;
    const ttl = (ID_TTL_SEC[span.name] ?? ID_TTL_DEFAULT_SEC) / SECONDS_PER_FRAME;
    if (frame - span.last > ttl) return undefined;
    return span.name;
  };
  const pending: { pid: number; idx: number; tags: number[] }[] = [];
  /* 태우기 후보(위 태움 주석) — 정체 표가 다 찬 뒤에 수송선을 찍은 것만 남긴다. */
  const pendingLoads: { pid: number; frame: number; x: number; y: number; tag: number }[] = [];
  /* 지금 떠 있는 건물 번호들(요청: 엔베 띄워 정찰 표현) — 이륙(Lift Off) 때 골라져 있던
     번호가 뜬 건물이고, 그 번호가 골라진 채의 우클릭은 랠리가 아니라 '비행 이동'이다.
     착륙(Land)하면 걷는다. */
  const flying = new Map<number, Set<number>>();
  /* 선택 묶음 → 작은 번호(위 orderPositions.g 주석) — 같은 번호 집합이면 같은 묶음이다.
     같기만 해서는 모자라다(지적: 순간이동이 여전함) — 부대에서 몇 기가 죽거나, 드래그로
     같은 부대의 대부분을 다시 집으면 집합이 달라져 묶음이 끊기고, 재생은 자리 어림으로
     되돌아갔다. 그래서 승계를 본다: 새 집합이 최근 쓰인 옛 집합의 과반(큰 쪽 기준)과
     겹치면 같은 부대의 이어짐이라 옛 번호를 물려받는다. 과반이 못 되는 겹침(한두 기만
     떼어 낸 것)은 갈라져 나간 딴 무리라 새 번호다. 죽은 유닛의 번호가 새 유닛에게
     재사용되는 오염은 시간 창(3분)으로 막는다 — 그 안의 재사용은 드물다. */
  const selIds = new Map<string, number>();
  let selIdSeq = 1;
  const SEL_LINK_FRAMES = Math.round(180 / SECONDS_PER_FRAME);
  const selSets = new Map<number, { tags: Set<number>; gid: number; frame: number }[]>();
  const tagsOf = (c: ScrepCmd): number[] => (
    Array.isArray(c.UnitTags) ? c.UnitTags.filter((t) => typeof t === "number") : []
  );
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
    // 헛친 커맨드인가 — screp이 표시해 준다(IneffKind). 아무 일도 안 일으킨 커맨드라
    // '무엇을 했나'를 셀 때는 빼야 한다. 다만 채팅·퇴장처럼 세는 것이 아니라 기록인
    // 항목은 그대로 둔다(애초에 이 표시가 붙지도 않는다).
    //
    // 실제 리플레이에서 확인한 크기가 사람마다 너무 달라 그냥 둘 수 없었다: 같은 판에서
    // 프로브 231번 중 158번(68%)이 헛친 사람이 있는가 하면, 69번 중 3번(4%)만 헛친 사람도
    // 있었다. 그대로 세면 "일꾼 231기 대 69기로 경제에서 앞섰다"가 나가는데, 실제로 나온
    // 일꾼은 73기 대 66기로 거의 같았다 — 재고 있던 건 경제가 아니라 연타 습관이었다.
    // (큐가 꽉 찬 채로 또 누른 것, 같은 명령을 순식간에 되풀이한 것 등이다.)
    const wasted = Boolean(c.IneffKind);
    if (!wasted && cmdName && UNIT_TRAIN_CMD_NAMES.has(cmdName)) {
      const unit = nameOf(c.Unit);
      if (unit) {
        s.unitCounts[unit] = (s.unitCounts[unit] ?? 0) + 1;
        if (frame !== null) {
          if (s.firstUnitFrame[unit] === undefined) s.firstUnitFrame[unit] = frame;
          pushFrame(s.unitFrames, unit, frame);
          // 그때 골라져 있던 번호(태그) — unitFrames와 짝을 맞춰 쌓는다(인터페이스 주석).
          pushFrame(s.trainTags, unit, (sel.get(c.PlayerID) ?? [])[0] ?? 0);
        }
      }
    } else if (!wasted && cmdName && BUILD_CMD_NAMES.has(cmdName)) {
      const b = nameOf(c.Unit);
      if (b) {
        // 같은 일꾼 재명령 무르기(위 lastDroneBuild 주석) — 앞 예약의 기록을 걷어낸다.
        // 드론(소모형)은 무조건, SCV·프로브는 같은 종류가 발자국 겹치게 다시 놓일 때만.
        const ordName = nameOf(c.Order);
        const workerBuild = ordName === "DroneStartBuild"
          || ordName === "PlaceBuilding" || ordName === "PlaceProtossBuilding";
        if (workerBuild && frame !== null) {
          const drone = ordName === "DroneStartBuild";
          const posNow = posOf(c.Pos);
          const prev = lastDroneBuild.get(c.PlayerID);
          const overlaps = !drone && prev && prev.unit === b
            && prev.x !== null && prev.y !== null && posNow
            ? Math.abs(posNow.x - prev.x) < (WORKER_FOOTPRINT[b] ?? [3, 2])[0]
              && Math.abs(posNow.y - prev.y) < (WORKER_FOOTPRINT[b] ?? [3, 2])[1]
            : false;
          if (prev && frame - prev.frame <= DRONE_REBUILD_WINDOW_FRAMES
            && (prev.drone ? drone : overlaps)) {
            s.buildingCounts[prev.unit] = Math.max(0, (s.buildingCounts[prev.unit] ?? 1) - 1);
            const bf = s.buildingFrames[prev.unit];
            if (bf) {
              const bi = bf.lastIndexOf(prev.frame);
              if (bi >= 0) bf.splice(bi, 1);
            }
            if (s.firstBuildingFrame[prev.unit] === prev.frame) delete s.firstBuildingFrame[prev.unit];
            for (let pi = s.buildPositions.length - 1; pi >= 0; pi -= 1) {
              const bp = s.buildPositions[pi];
              if (bp.unit === prev.unit && bp.frame === prev.frame) { s.buildPositions.splice(pi, 1); break; }
            }
          }
          lastDroneBuild.set(c.PlayerID, {
            unit: b, frame, x: posNow?.x ?? null, y: posNow?.y ?? null, drone,
          });
        }
        s.buildingCounts[b] = (s.buildingCounts[b] ?? 0) + 1;
        if (frame !== null) {
          if (s.firstBuildingFrame[b] === undefined) s.firstBuildingFrame[b] = frame;
          pushFrame(s.buildingFrames, b, frame);
        }
        const pos = posOf(c.Pos);
        if (pos) {
          s.buildPositions.push({ unit: b, frame, x: pos.x, y: pos.y });
        }
        // 건물 변태는 자리가 안 실린다 — 무엇이 됐는지와 시각만 남긴다(요청: 변태 추적).
        if (cmdName === "Building Morph" && frame !== null) {
          s.buildingMorphs.push({ frame, to: b });
        }
      }
    } else if (cmdName === "Land") {
      // 착륙 — 좌표가 실린다(요청: 띄우기 판단). 이륙(Lift Off)은 자리가 안 남아 착륙만 쓴다.
      const pos = posOf(c.Pos);
      if (pos && frame !== null) s.lands.push({ frame, x: pos.x, y: pos.y });
    } else if (cmdName === "Cancel Build" && frame !== null) {
      // 짓다 물린 것(요청) — 어느 건물인지는 재생이 어림한다.
      // screp의 실제 이름은 "Cancel Build"다 — 예전의 startsWith("Cancel Construct")는
      // 한 번도 맞은 적이 없어 취소 신호가 통째로 죽어 있었다(이번에 발견).
      s.cancelBuilds.push(frame);
    } else if (!wasted && (cmdName === "Cancel Train" || cmdName === "Cancel Morph")
      && frame !== null) {
      /* 생산 큐 취소(요청: 라바 포함 취소를 체크해 정확한 유닛 수 추적) — 취소 커맨드에는
         무엇을 물렀는지가 안 실린다. 대신 그때 골라져 있던 것이 그 건물(Cancel Train)
         이거나 그 알(Cancel Morph — 라바가 알이 돼도 번호는 그대로다)이므로, 같은 태그로
         큐된 생산 중 가장 최근 것을 물린 것으로 본다. 태그를 모르면 직전 생산이다 —
         취소는 보통 방금 누른 것을 무르는 손이다. */
      const selTags = sel.get(c.PlayerID) ?? [];
      let bestUnit: string | null = null;
      let bestIdx = -1;
      let bestFrame = -1;
      let bestByTag = false;
      /* 너무 옛 생산은 못 무른다 — 이미 나와서 싸운 유닛을 지우면 수가 거꾸로 틀린다.
         큐가 길어도 취소 대상은 대개 방금 것이라 100초쯤이면 넉넉하다. */
      const CANCEL_LOOKBACK_FRAMES = 2400;
      for (const [unit, frames] of Object.entries(s.unitFrames)) {
        const tags = s.trainTags[unit] ?? [];
        for (let i = frames.length - 1; i >= 0; i -= 1) {
          if (frames[i] > frame || frames[i] < frame - CANCEL_LOOKBACK_FRAMES) continue;
          const byTag = tags[i] > 0 && selTags.includes(tags[i]);
          // 태그 일치가 우선, 그 안에서는 최근 것 — 둘 다 아니면 그냥 최근 것.
          if ((byTag && (!bestByTag || frames[i] > bestFrame))
            || (!byTag && !bestByTag && frames[i] > bestFrame)) {
            bestUnit = unit;
            bestIdx = i;
            bestFrame = frames[i];
            bestByTag = byTag;
          }
        }
      }
      if (bestUnit !== null && bestIdx >= 0) {
        s.unitFrames[bestUnit].splice(bestIdx, 1);
        (s.trainTags[bestUnit] ?? []).splice(bestIdx, 1);
        s.unitCounts[bestUnit] = Math.max(0, (s.unitCounts[bestUnit] ?? 1) - 1);
      }
    }
    // ── 무엇을 골라 두고 있나 — 탱크 번호를 알아내는 데 쓴다(위 pending 주석) ──
    // 선택이 바뀌면 드론 건설 예약 무르기도 끝(위 lastDroneBuild 주석) — 다음 Build는
    // 딴 드론의 것일 수 있다.
    if (cmdName === "Select" || cmdName === "Select Add" || cmdName === "Select Remove"
      || cmdName === "Hotkey") lastDroneBuild.delete(c.PlayerID);
    if (cmdName === "Select") sel.set(c.PlayerID, tagsOf(c));
    else if (cmdName === "Select Add") sel.set(c.PlayerID, [...(sel.get(c.PlayerID) ?? []), ...tagsOf(c)]);
    else if (cmdName === "Select Remove") {
      const drop = new Set(tagsOf(c));
      sel.set(c.PlayerID, (sel.get(c.PlayerID) ?? []).filter((t) => !drop.has(t)));
    } else if (cmdName === "Hotkey") {
      const key = `${c.PlayerID}:${typeof c.Group === "number" ? c.Group : nameOf(c.Group)}`;
      const how = nameOf(c.HotkeyType);
      if (how === "Assign") groups.set(key, [...(sel.get(c.PlayerID) ?? [])]);
      else if (how === "Select") sel.set(c.PlayerID, [...(groups.get(key) ?? [])]);
    }
    // 그 유닛만 할 수 있는 커맨드가 나오면, 그때 골라져 있던 번호가 곧 그 유닛이다.
    {
      const orderName = nameOf(c.Order);
      /* 마법·전용 커맨드 말고도, '무엇을 고르고 눌렀나'만으로 정체가 드러나는 것들이 있다
         (요청: 어택·무브도 유닛과 목표가 특정되는 것 아니냐).
          · 건설 커맨드는 일꾼만 낸다 → 고른 것은 일꾼이다.
          · 생산 커맨드(훈련·취소·이륙)는 건물만 낸다 → 고른 것은 건물이고, 그 뒤의
            우클릭은 병력 이동이 아니라 '랠리 찍기'다. 공격 자리를 어림할 때 이 둘을
            빼는 것만으로도 좌표 뭉치가 훨씬 깨끗해진다.
          · 변태는 대상이 곧 정체다 — 럴커면 히드라, 가디언·디바우러면 뮤탈, 저그 건물이면
            드론(일꾼)이 고른 것이다. */
      const morphTo = cmdName === "Unit Morph" ? nameOf(c.Unit) : undefined;
      /* 변태 커맨드는 '고른 것이 무엇이 되는가'를 그대로 말해 준다 — 번호(태그)는 변태
         뒤에도 그대로라, 결과 유닛을 그 번호의 이름으로 삼으면 그 뒤 명령의 주인이 전부
         드러난다.

         예전엔 러커·가디언·디바우러만 앞 유닛을 짚고 나머지는 전부 "Worker"로 적었다(저그
         건물은 드론이 변태시킨다고 봤다). 그런데 저그 건물은 Build 커맨드로 오고, Unit
         Morph는 죄다 라바→유닛이다 — 그래서 저글링·히드라·뮤탈이 통째로 일꾼으로 적히고,
         그 부대의 공격 명령이 '일꾼이 자원 찍은 것'으로 몰려 통째로 버려졌다. 실측한
         리플레이에서 저그의 공격 명령 가운데 일꾼 표기가 11/11, 96/99, 202/229, 375/515
         였다 — 저그의 진출·공격 자리가 요약에서 거의 사라진 원인이 이것이다. */
      const byMorph = morphTo === "Lurker" ? "Lurker"
        : morphTo === "Guardian" || morphTo === "Devourer" ? morphTo
          : morphTo === "Drone" ? "Worker"
            : morphTo === "Overlord" ? "Transport"
              : morphTo;
      /* 자원을 찍은 우클릭은 일꾼만 낸다 — 미네랄·가스에 병력을 보낼 일은 없다. 찍은
         대상이 건물·자원일 때는 screp이 그 이름(Unit)까지 실어 주므로 확실하다. 일꾼
         번호가 일찍 드러날수록, 뒤에 그 번호로 찍힌 자원 클릭 뭉치를 공격 자리에서
         걷어내기가 쉬워진다. */
      const clicked = (cmdName === "Right Click" || cmdName === "Targeted Order")
        ? nameOf(c.Unit) : undefined;
      /* 자원 클릭의 일꾼 낙인은 초반의 '통째 선택'에는 안 찍는다(지적: 첫 오버로드 정찰이
         아예 안 잡히고 일꾼과 헷갈림) — 시작하자마자 본진 근처를 상자로 긁어 미네랄을
         찍으면 드론들 틈의 스타팅 오버로드까지 일꾼으로 낙인찍혀, 그 뒤 오버로드 정찰이
         전부 일꾼 자취로 흘렀다. 드론들은 다음 개별 채집 클릭들이 금방 다시 이름 붙인다. */
      const mixedStart = frame !== null && frame < EARLY_ALL_SELECT_FRAMES
        && (sel.get(c.PlayerID)?.length ?? 0) >= 4;
      const byClick = clicked && RESOURCE_TARGETS.has(clicked) && !mixedStart ? "Worker" : undefined;
      const byRole = cmdName && WORKER_CMD_NAMES.has(cmdName) ? "Worker"
        : cmdName && BUILDING_ONLY_CMD_NAMES.has(cmdName) ? "Building" : byClick;
      const named = (cmdName ? USE_CMD_TO_UNIT[cmdName] : undefined)
        ?? (orderName ? CAST_ORDER_TO_UNIT[orderName] : undefined)
        ?? (orderName === PLACE_MINE_ORDER ? "Vulture" : undefined)
        ?? byMorph ?? byRole;
      if (named) {
        for (const t of sel.get(c.PlayerID) ?? []) nameTag(`${c.PlayerID}:${t}`, frame ?? 0, named);
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
        // 이 명령이 실제로 어떤 것이었나(위 orderPositions의 kind 주석) — Order 이름이
        // "Attack"으로 시작하면(AttackMove/AttackUnit/AttackFixedRange …) 공격, 정확히
        // "Move"면 이동이다. 나머지(채집·수리·따라가기 등)는 kind를 안 붙인다.
        const orderName = nameOf(c.Order);
        /* 우클릭에는 Order가 아예 안 실린다 — 실측한 4:4에서 우클릭 9885개가 전부
           Order 없음이었고, 이름이 붙은 것은 표적 명령 1466개뿐이었다(그중 어택땅 776).
           그래서 예전 규칙으로는 명령 좌표의 93%가 kind 없이 버려졌고, 병력을 어디로
           몰고 갔는지를 자리로 읽는 곳(struckZone·beatPositions)이 표적 명령만 보게 됐다.
           스타에서 병력을 움직이는 건 대부분 그냥 우클릭이라, 이게 "타겟을 못 잡는다"의
           가장 큰 원인이었다.

           우클릭도 무엇을 찍었는지는 알 수 있다: screp이 찍힌 대상(Unit)과 그 번호를
           함께 준다. 자원을 찍은 것은 채집이라 그대로 비워 두고, 다른 편 유닛을 찍은
           것은 공격이며(그 번호의 임자를 아래 hits와 같은 방법으로 안다), 나머지 — 빈
           땅을 찍은 것 — 는 이동이다. 어림이 아니라 커맨드에 적힌 그대로다. */
        const clickedName = cmdName === "Right Click" ? nameOf(c.Unit) : undefined;
        const clickedOwner = typeof c.UnitTag === "number" && c.UnitTag > 0
          ? tagOwner.get(c.UnitTag) : undefined;
        const clickedFoe = clickedOwner !== undefined && clickedOwner !== c.PlayerID
          && teamOf.get(clickedOwner) !== undefined
          && teamOf.get(clickedOwner) !== teamOf.get(c.PlayerID);
        /* 맨 가스 게이저를 찍은 것은 채집이 아니다(지적: 가스기지 없는 가스에 일꾼을
           찍어 지으러 보내는 경우까지 가스 캐는 걸로 버려졌다) — 건물 없는 게이저는
           캘 수가 없으니 그 클릭은 이동(대개 정제소 지으러 가는 길)이다. 채집으로
           비우는 것은 미네랄·정제소류(선 가스 건물) 클릭만이다. */
        const byClick = cmdName !== "Right Click" ? undefined
          : clickedName && RESOURCE_TARGETS.has(clickedName) && clickedName !== "Vespene Geyser"
            ? undefined
            : clickedFoe ? "attack" as const : "move" as const;
        const kind = orderName === "Move" ? "move" as const
          : orderName?.startsWith("Attack") ? "attack" as const
            : byClick;
        const picked = sel.get(c.PlayerID) ?? [];
        /* 뜬 건물이 골라진 채의 클릭은 비행 이동이다(요청: 엔베 띄워 정찰이 안 나온다) —
           재생이 떠 있는 건물 마커를 이 자취로 움직인다. */
        const fly = flying.get(c.PlayerID);
        if (fly && picked.length > 0 && picked.every((tg) => fly.has(tg))) {
          (s.flyPositions ??= []).push({
            frame, x: pos.x / PIXELS_PER_TILE, y: pos.y / PIXELS_PER_TILE,
          });
        }
        /* 제 유닛을 찍은 우클릭은 태우기 후보다(지적: 태우기 판정이 아쉽다) — 예전에는
           '이미 수송선으로 드러난 번호'만 태움으로 봤는데, 정체는 대개 내리기에서야
           드러나고 태우기는 내리기보다 먼저라 첫 드랍 전의 태움을 죄다 놓쳤다. 여기서는
           후보만 모으고, 정체 표(unitOfTag)가 경기 전체로 다 찬 뒤에 수송선만 남긴다. */
        if (typeof c.UnitTag === "number" && clickedOwner === c.PlayerID && frame !== null) {
          pendingLoads.push({
            pid: c.PlayerID, frame, x: pos.x / PIXELS_PER_TILE, y: pos.y / PIXELS_PER_TILE,
            tag: c.UnitTag,
          });
        }
        // 선택 묶음 번호(위 selIds 주석) — 부대지정으로 오간 명령을 재생이 한 자취로 잇는다.
        let gid: number | undefined;
        if (picked.length > 0) {
          const gkey = `${c.PlayerID}:${[...picked].sort((a, b) => a - b).join(",")}`;
          gid = selIds.get(gkey);
          if (gid === undefined) {
            // 겹침 승계(위 selIds 주석) — 최근 집합의 과반과 겹치면 같은 부대의 이어짐.
            const list = selSets.get(c.PlayerID) ?? [];
            let bestInter = 0;
            for (const e of list) {
              if (frame - e.frame > SEL_LINK_FRAMES) continue;
              let inter = 0;
              for (const tg of picked) if (e.tags.has(tg)) inter += 1;
              if (inter >= Math.ceil(Math.max(picked.length, e.tags.size) / 2)
                && inter > bestInter) { bestInter = inter; gid = e.gid; }
            }
            if (gid === undefined) { gid = selIdSeq; selIdSeq += 1; }
            selIds.set(gkey, gid);
          }
          // 이 집합의 최근 사용 시각을 남긴다 — 다음 승계 판정의 재료다.
          let list = selSets.get(c.PlayerID);
          if (!list) { list = []; selSets.set(c.PlayerID, list); }
          const hit = list.find((e) => e.gid === gid);
          if (hit) { hit.tags = new Set(picked); hit.frame = frame; }
          else list.push({ tags: new Set(picked), gid, frame });
        }
        s.orderPositions.push({
          frame, x: pos.x / PIXELS_PER_TILE, y: pos.y / PIXELS_PER_TILE, ...(kind ? { kind } : {}),
          ...(picked.length > 0 ? { n: picked.length } : {}),
          ...(gid !== undefined ? { g: gid } : {}),
        });
        if (picked.length > 0) {
          pending.push({ pid: c.PlayerID, idx: s.orderPositions.length - 1, tags: [...picked] });
        }
        // 찍은 대상이 다른 편의 유닛이면 그건 어림이 아니라 '그 사람을 쳤다'는 사실이다.
        const whom = clickedFoe && clickedOwner !== undefined
          ? rawOf.get(clickedOwner) : undefined;
        if (whom && s.hits.length < ORDER_POS_CAP) {
          s.hits.push({
            frame, x: pos.x / PIXELS_PER_TILE, y: pos.y / PIXELS_PER_TILE, whom,
          });
        }
      }
    }
    if (cmdName === "Unload" || cmdName === "Unload All") {
      s.unloadCount += 1;
      if (frame !== null && s.firstUnloadFrame === null) s.firstUnloadFrame = frame;
      /* 어디에 내렸나(요청: 드랍 표현) — 내리기 커맨드에 좌표가 실리면(땅에 내리기)
         그 자리가 곧 드랍 지점이다. 좌표 단위는 이동 명령과 같은 픽셀이라 타일로 나눈다. */
      const pos = posOf(c.Pos);
      if (pos && frame !== null) {
        (s.unloadPositions ??= []).push({
          frame, x: pos.x / PIXELS_PER_TILE, y: pos.y / PIXELS_PER_TILE,
        });
      } else if (frame !== null) {
        /* 좌표 없는 내리기(제자리 언로드, 지적: 내리기 판정이 아쉽다) — 수송선의 자리는
           안 남지만, 직전 30초 안의 마지막 이동 클릭이 대개 그 수송선을 몰고 간 자리다. */
        const last = s.orderPositions[s.orderPositions.length - 1];
        if (last && frame - last.frame <= 30 / SECONDS_PER_FRAME) {
          (s.unloadPositions ??= []).push({ frame, x: last.x, y: last.y });
        }
      }
    }
    if (cmdName === "Lift Off") {
      s.liftOffCount += 1;
      if (frame !== null && s.firstLiftOffFrame === null) s.firstLiftOffFrame = frame;
      // 전부 남긴다(지적: 건물 떠 있는 게 표현이 안 된다) — 재생이 다음 착륙과 짝짓는다.
      if (frame !== null) (s.lifts ??= []).push(frame);
      // 이륙 때 골라져 있던 번호가 곧 뜬 건물이다(요청: 엔베 띄워 정찰).
      const f = flying.get(c.PlayerID) ?? new Set<number>();
      for (const tg of sel.get(c.PlayerID) ?? []) f.add(tg);
      flying.set(c.PlayerID, f);
    } else if (cmdName === "Land") {
      // 내려앉으면 비행 목록에서 걷는다(위 flying 주석).
      for (const tg of sel.get(c.PlayerID) ?? []) flying.get(c.PlayerID)?.delete(tg);
    } else if (cmdName === "Leave Game") {
      // 여러 번 찍히면 마지막 것이 실제로 떠난 시점이다.
      s.leaveFrame = frame;
      s.leaveReason = nameOf(c.Reason);
    }
    /* 채팅은 커맨드 스트림의 임자(PlayerID)가 아니라 SenderSlotID가 말한 사람이다.
       PlayerID는 그 커맨드 묶음을 들고 있는 사람 — 채팅에서는 대개 '리플레이를 저장한
       사람'이거나, 아예 로스터에 없는 값(128 같은 관전/시스템 번호)이다. 그걸 그대로
       임자로 쓰면 한 판의 모든 대사가 저장자 한 명에게 몰린다.
       실측(리플레이 22판·채팅 355건): 화자가 맞은 건 62건뿐이고, 108건은 남의 입에
       붙었고, 185건은 임자가 로스터에 없어 통째로 사라졌다. 그래서 이 채팅을 근거로
       삼는 GG·노엘 판정도 엉뚱한 사람에게 붙거나 아예 안 잡히고 있었다.
       슬롯이 로스터에 없으면(관전자 채팅, 실측 92건) 버린다 — 경기한 사람의 말이 아니다. */
    if (cmdName === "Chat" && typeof c.Message === "string" && c.Message.trim()) {
      const speaker = typeof c.SenderSlotID === "number" ? idOfSlot.get(c.SenderSlotID) : undefined;
      if (speaker !== undefined) {
        const cs = at(speaker);
        if (cs.chats.length < CHAT_CAP) cs.chats.push({ frame, text: c.Message.trim() });
      }
    }
    // ── 기술을 실제로 썼나 ──
    // 마법은 표적 명령의 Order로, 시즈/버로우/클로킹/스팀은 전용 커맨드로 온다.
    const order = wasted ? undefined : nameOf(c.Order);
    const usedTech = order
      ? (CAST_ORDER_TO_TECH[order] ?? (order === PLACE_MINE_ORDER ? "Spider Mines" : null))
      : (!wasted && cmdName ? USE_CMD_TO_TECH[cmdName] ?? null : null);
    if (usedTech) {
      s.techUses[usedTech] = (s.techUses[usedTech] ?? 0) + 1;
      if (frame !== null) (s.techFrames[usedTech] ??= []).push(frame);
      // 좌표를 갖는 마법은 그 지점을 그대로 남긴다(위 castPositions 주석).
      const castAt = posOf(c.Pos);
      if (castAt && frame !== null && s.castPositions.length < ORDER_POS_CAP) {
        s.castPositions.push({
          tech: usedTech, frame,
          x: castAt.x / PIXELS_PER_TILE, y: castAt.y / PIXELS_PER_TILE,
        });
      }
      if (frame !== null && s.firstTechUseFrame[usedTech] === undefined) {
        s.firstTechUseFrame[usedTech] = frame;
      }
    }
    const tech = nameOf(c.Tech);
    if (tech && pushResearch(s.techNames, lastResearchFrame, `${c.PlayerID}:T:${tech}`, tech, frame)) {
      if (frame !== null && s.firstTechFrame[tech] === undefined) s.firstTechFrame[tech] = frame;
    }
    const upgradeRaw = nameOf(c.Upgrade);
    if (upgradeRaw) {
      const upgrade = normalizeUpgradeName(upgradeRaw);
      if (pushResearch(s.upgradeNames, lastResearchFrame, `${c.PlayerID}:U:${upgrade}`, upgrade, frame)
        && frame !== null && s.firstUpgradeFrame[upgrade] === undefined) {
        s.firstUpgradeFrame[upgrade] = frame;
      }
    }
  }
  // 다 훑은 뒤에 탱크 명령을 표시한다 — 탱크 번호는 첫 시즈에서야 드러나므로, 그 앞에
  // 내린 이동 명령까지 함께 짚으려면 되돌아와야 한다. 고른 것의 절반 이상이 탱크일 때만
  // '탱크를 옮겼다'로 본다(탱크 한 기가 딸려 든 부대 이동은 탱크의 자리가 아니다).
  for (const { pid, idx, tags } of pending) {
    // 고른 것 가운데 가장 많은 이름을 그 명령의 주인으로 본다 — 절반은 넘어야 한다
    // (부대에 한 기 딸려 든 유닛의 자리로 읽으면 안 된다).
    const atFrame = out.get(pid)?.orderPositions[idx]?.frame ?? 0;
    const tally = new Map<string, number>();
    for (const t of tags) {
      const name = nameAt(`${pid}:${t}`, atFrame);
      if (name) tally.set(name, (tally.get(name) ?? 0) + 1);
    }
    const top = [...tally].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] * 2 >= tags.length) {
      const o = out.get(pid)?.orderPositions[idx];
      if (o) {
        o.by = top[0];
        /* 건물을 골라 둔 채 찍은 우클릭 = 랠리(지적: 랠리 포인트 생각을 못 함) — 그
           좌표가 곧 갓 나온 유닛이 걸어갈 자리다. 태그는 건물로 판명된 것 하나를 남긴다
           (생산 귀속의 ptag와 같은 번호라, 재생이 유닛→건물→랠리를 이을 수 있다). */
        if (top[0] === "Building") {
          /* 건물로 판명된 번호만 랠리의 임자다(지적: 랠리 뒤바뀜) — 예전의 tags[0] 폴백은
             아무 번호나 집어, 유닛 번호가 건물 랠리의 임자가 되곤 했다. 못 찾으면 0으로
             비워 두면 재생이 '마지막 랠리' 어림으로 물러난다. */
          const bTag = tags.find((tg) => nameAt(`${pid}:${tg}`, o.frame) === "Building") ?? 0;
          const sig = out.get(pid);
          if (sig && sig.rallies.length < 400) {
            sig.rallies.push({ frame: o.frame, x: o.x, y: o.y, tag: bTag });
          }
        }
      }
    }
  }
  /* 태우기 확정(위 pendingLoads 주석) — 정체 표(unitOfTag)가 경기 전체로 다 찬 지금,
     수송선을 찍은 클릭만 남긴다. 태우기가 내리기보다 먼저라도 이제 안 놓친다. */
  for (const l of pendingLoads) {
    if (nameAt(`${l.pid}:${l.tag}`, l.frame) !== "Transport") continue;
    const sig = out.get(l.pid);
    if (!sig) continue;
    (sig.loadPositions ??= []).push({ frame: l.frame, x: l.x, y: l.y });
  }
  for (const sig of out.values()) {
    sig.loadPositions?.sort((a, b) => a.frame - b.frame);
  }
  return out;
}

/** 바이트 묶음을 base64로 — String.fromCharCode에 16384개를 한 번에 펼치면 인수 개수
 *  한계에 걸려 스택이 넘친다(브라우저마다 다르지만 6만 안팎). 나눠서 넘긴다. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 4096;
  let s = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

// 팔레트 첨자를 1바이트에 담으므로 팔레트는 256칸까지다. 빠른무한류는 그룹이 서른 몇
// 종류뿐이라 그냥 들어가지만, 실제 래더맵은 훨씬 많다 — 투혼(Jungle)은 642종류라 예전에는
// 여기서 포기해 미니맵이 아예 안 나왔다(사용자 지적: "투혼은 맵이 안나옴").
// 그래서 넘칠 때는 포기하는 대신 순위를 256칸으로 눌러 담는다(아래). 색은 어차피 '팔레트
// 안에서의 순위 → 색 램프'라(ReplayMinimap의 rampOf) 순위를 뭉치는 것은 색 단계 몇 개를
// 잃는 것뿐이고, 지형이 면으로 뭉쳐 보이는 성질은 그대로 남는다.
const MAP_PALETTE_MAX = 256;

/** 맵 격자를 뽑는다 — 못 읽으면 null(그 경기엔 미니맵이 안 붙는다).
 *
 *  해시는 SHA-256의 앞 40글자(160비트)를 쓴다. 내용이 같으면 같은 값이어야 하고, 서로
 *  다른 맵이 같은 값이 되면 엉뚱한 미니맵이 뜨므로 짧은 해시로 대충 접을 자리가 아니다.
 *  crypto.subtle을 쓸 수 없는 환경(보안 컨텍스트가 아닌 곳)에서는 격자를 아예 안 만든다. */
async function readMapGrid(res: ScrepResult): Promise<ReplayMapGrid | null> {
  const w = res.Header.MapWidth;
  const h = res.Header.MapHeight;
  const raw = res.MapData?.Tiles ?? null;
  if (!w || !h || !raw || raw.length !== w * h) return null;
  if (!globalThis.crypto?.subtle) return null;

  const groups = new Uint16Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) groups[i] = raw[i] >> 4;
  const uniq = [...new Set(groups)].sort((a, b) => a - b);
  // 팔레트가 256칸을 넘으면 순위를 고르게 눌러 담는다 — 첨자 i를 가진 그룹은 i번째 순위이고,
  // 팔레트에는 그 칸을 대표하는 그룹 번호를 넣는다(그림에는 순위만 쓰이므로 대표값이면 된다).
  const bucket = uniq.length / MAP_PALETTE_MAX;
  const palette = uniq.length <= MAP_PALETTE_MAX
    ? uniq
    : Array.from({ length: MAP_PALETTE_MAX }, (_, i) => uniq[Math.floor(i * bucket)]);
  const at = new Map(uniq.map((g, i) => [
    g,
    uniq.length <= MAP_PALETTE_MAX ? i : Math.min(MAP_PALETTE_MAX - 1, Math.floor(i / bucket)),
  ]));
  const bytes = new Uint8Array(groups.length);
  for (let i = 0; i < groups.length; i += 1) bytes[i] = at.get(groups[i]) ?? 0;

  const resources = clusterResources(res.MapData);

  // 크기·자원까지 해시에 넣는다 — 같은 격자 바이트가 128×64와 64×128 두 모양일 수 있고,
  // 자원이 함께 바뀌면 다시 저장돼 옛 맵에도 자원이 채워진다.
  const tiles = toBase64(bytes);
  const resKey = resources.map((r) => r.join(",")).join(";");
  const src = new TextEncoder().encode(`${w}x${h}|${palette.join(",")}|${tiles}|${resKey}`);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", src));
  const hash = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
  return { hash, name: res.Header.Map ?? "", width: w, height: h, palette, tiles, resources };
}

// 같은 자원 지대로 볼 반경(타일) / 지대 수 상한. 빠른무한처럼 미네랄이 온 맵에 깔린 맵은
// 지대가 수십 개 나올 수 있어 상한을 둔다(큰 것부터 남긴다).
/* 반경 7 → 4.5 → 1.2(재지적: 겹치더라도 정확한 좌표에) — 낱밭(2×1)이 거의 그대로
   남고, 빠른무한처럼 한 자리에 겹쳐 쌓은 스택만 하나로 접힌다. 상한도 340으로 키워
   (서버 384 − 간헐천 몫) 밭 많은 맵도 뒷차례가 안 떨어진다. 큰 것부터 남긴다. */
const RESOURCE_CLUSTER_RADIUS = 1.2;
const RESOURCE_CLUSTER_MAX = 340;

/** 미네랄 밭·가스를 가까운 것끼리 묶어 자원 지대로 만든다 — 낱개를 다 그리면 노이즈라
 *  '어디에 자원이 있나'만 남긴다. 좌표 단위는 타일(screp은 타일×32라 32로 나눈다). */
function clusterResources(md: ScrepResult["MapData"]): [number, number, 0 | 1][] {
  /* 가스는 군집에 안 삼킨다(지적: 가스가 10개면 10개 다 붙어야 — 미네랄 밭과 한
     지대로 묶여 지대당 모델 하나만 남아 간헐천 두엇만 그려졌다). 미네랄만 밭으로
     묶고, 간헐천은 제 자리마다 낱개 항목으로 내보낸다. */
  type P = { x: number; y: number };
  const pts: P[] = [];
  for (const m of md?.MineralFields ?? []) pts.push({ x: m.X / 32, y: m.Y / 32 });
  const r2 = RESOURCE_CLUSTER_RADIUS * RESOURCE_CLUSTER_RADIUS;
  const clusters: { xs: number; ys: number; n: number }[] = [];
  for (const p of pts) {
    // 이미 있는 지대 중 가까운 곳에 넣고, 없으면 새 지대를 연다. 지대 중심은 넣을 때마다
    // 갱신하지만 이미 넣은 점을 다시 옮기진 않는다(어림 군집이면 충분하다).
    let hit = null as (typeof clusters)[number] | null;
    for (const c of clusters) {
      const dx = c.xs / c.n - p.x;
      const dy = c.ys / c.n - p.y;
      if (dx * dx + dy * dy <= r2) { hit = c; break; }
    }
    if (hit) { hit.xs += p.x; hit.ys += p.y; hit.n += 1; }
    else clusters.push({ xs: p.x, ys: p.y, n: 1 });
  }
  const zones: [number, number, 0 | 1][] = clusters
    .sort((a, b) => b.n - a.n)
    .slice(0, RESOURCE_CLUSTER_MAX)
    .map((c) => [
      Math.round((c.xs / c.n) * 10) / 10,
      Math.round((c.ys / c.n) * 10) / 10,
      0,
    ]);
  for (const g of md?.Geysers ?? []) {
    if (!g.Point) continue;
    zones.push([
      Math.round((g.Point.X / 32) * 10) / 10,
      Math.round((g.Point.Y / 32) * 10) / 10,
      1,
    ]);
  }
  // 서버 상한(384)에 맞춰 자른다 — 지대 120 + 가스 낱개가 넘칠 일은 드물지만 422는 막는다.
  return zones.slice(0, 384);
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
    // mapData는 시작 지점(몇 시에서 시작했나)을 얻으려고 함께 받는다 — 요약에서 닉네임이
    // 처음 나올 때 "(1시)"를 붙이는 데 쓴다(요청).
    // mapTiles는 미니맵을 그릴 지형 격자를 얻으려고 함께 받는다(요청) — 숫자 16384개가
    // 늘지만 파싱 시간은 측정 노이즈 수준이었다(실측 873ms vs 1019ms).
    res = (await Screp.parseBuffer(buf, { cmds: true, mapData: true, mapTiles: true, mapResLoc: true })) as ScrepResult;
  } catch {
    throw new ReplayParseError(`"${file.name}" 파일을 리플레이로 읽지 못했어요.`);
  }

  const descByPlayerId = new Map<number, ScrepPlayerDesc>();
  (res.Computed?.PlayerDescs ?? []).forEach((d) => descByPlayerId.set(d.PlayerID, d));

  // 커맨드 스트림에서 플레이어별 '생산' 커맨드 수를 센다. 스트림을 아예 못 읽었으면(cmds가
  // null) 지표 자체를 알 수 없다는 뜻이라 전원 null로 남긴다 — 스트림이 있으면 생산 커맨드가
  // 없던 사람도 0으로 확정된다.
  const cmds = res.Commands?.Cmds ?? null;
  //
  // 헛친 커맨드(IneffKind)는 빼고 센다 — 위 collectSignals와 같은 이유다. 안 그러면 이
  // 숫자가 '얼마나 뽑았나'가 아니라 '얼마나 연타했나'에 가까워진다(실측: 같은 판에서
  // 일꾼 생산 커맨드의 헛친 비율이 0%인 사람과 68%인 사람이 함께 있었다).
  const buildCountByPlayerId = cmds
    ? cmds.reduce((acc, c) => {
        if (!c.IneffKind && c.Type?.Name && PRODUCTION_CMD_NAMES.has(c.Type.Name)) {
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
  const signalsByPlayerId = cmds
    ? collectSignals(cmds, totalFrames, res.Header.Players.map((p) => ({
      id: p.ID, slot: p.SlotID, team: p.Team, obs: p.Observer === true, raw: p.Name,
    })))
    : null;
  const signalsOf = (playerId: number): ReplayPlayerSignals | null =>
    signalsByPlayerId ? signalsByPlayerId.get(playerId) ?? emptySignals() : null;

  /* 시작 지점의 타일 좌표 — 미니맵에 본진 표시(아바타+닉네임)를 놓는 자리다(요청).
     screp이 주는 좌표는 타일×32라 32로 나눠 타일 자로 맞춘다. 그래야 이동·공격 명령
     좌표(orderPositions)와 한 자로 재진다.

     (삭제) 예전엔 이 좌표를 맵 가운데 기준 각도로 바꿔 "몇 시"로 불렀고, 요약에서 닉네임이
     처음 나올 때 "(1시)"를 붙였다 — 미니맵이 생기면서 그 표기는 걷어냈다(요청: 팀 언급과
     몇시는 빼도 되겠다). 어디서 시작했는지는 이제 그림이 직접 보여준다. */
  const startTileOf = (() => {
    const spots = res.MapData?.StartLocations ?? null;
    if (!spots || spots.length === 0) return () => null;
    const bySlot = new Map(spots.map((s) => [s.SlotID, s]));
    return (slotId: number | undefined): { x: number; y: number } | null => {
      if (slotId === undefined) return null;
      const s = bySlot.get(slotId);
      return s ? { x: s.X / 32, y: s.Y / 32 } : null;
    };
  })();

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
        // 게임 내 색(요청) — 연속 재생이 팀 2색 대신 이 색으로 각자를 칠한다.
        color: typeof p.Color?.RGB === "number"
          ? `#${p.Color.RGB.toString(16).padStart(6, "0")}` : null,
        team: p.Team,
        apm: desc?.APM ?? null,
        eapm: desc?.EAPM ?? null,
        cmdCount: desc?.CmdCount ?? null,
        effectiveCmdCount: desc?.EffectiveCmdCount ?? null,
        buildCount: buildCountOf(p.ID),
        // 그 총량을 갈래별로 나눈 값(요청: 통계 생산 칸의 도넛 셋 + 초반 일꾼 수).
        buildMix: buildMixOf(signalsOf(p.ID), totalFrames, RACE_NAME_MAP[p.Race?.Name ?? ""] ?? ""),
        isComputer: p.Type?.Name === "Computer",
        startX: startTileOf(p.SlotID)?.x ?? null,
        startY: startTileOf(p.SlotID)?.y ?? null,
        signals: signalsOf(p.ID),
      };
    });

  /* 전투 하나하나의 승패(요청) — 사람 혼자의 신호로는 못 가른다(상대가 같은 자리를 찍고
     있었어야 전투다). 전원이 모인 여기서 게임 단위로 가려, 각자의 buildMix에 실어 준다 —
     저장·집계 길은 buildMix가 이미 낸 길 그대로다. */
  const battleCounts = battleCountsOf(declared);
  declared.forEach((p) => {
    const c = battleCounts.get(p.rawName);
    if (c && p.buildMix) p.buildMix = { ...p.buildMix, ...c };
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

  /* screp이 승패를 못 가렸을 때(WinnerTeam=0)의 마지막 근거 — 나간 기록(Leave Game)이다.
     screp의 판정은 "끝까지 남은 편"을 보는데, 이긴 편에서도 한 명이 (대개 마지막 프레임에)
     같이 나가 버리면 그 판단이 통째로 비어 버린다. 실측한 3:3 두 판이 정확히 그 모양이었다:
     진 편 셋이 21051·21093·21267 프레임에 차례로 나갔는데, 이긴 편의 한 사람이 마지막
     프레임(21329, 총 21330)에 같이 나갔다는 이유로 WinnerTeam이 0이 됐다. 그러면
     buildReplaySummary가 첫 줄에서 되돌아가 요약이 통째로 안 만들어진다(지적).

     그때는 직접 본다: 실제로 플레이한 사람(사람 슬롯이면서 명령이 있는 사람)만 놓고,
     한 편이 전원 나갔는데 다른 편엔 아직 누군가 남아 있으면 남아 있는 편이 이긴 편이다.
     컴퓨터·관전 슬롯은 애초에 나갈 일이 없으니 이 셈에서 뺀다 — 넣으면 그 편은 영영
     '전원 나감'이 안 된다. 양쪽 다 전원 나갔거나 양쪽 다 남아 있으면 손대지 않는다:
     그건 정말 못 가리는 판이라 사람이 검토 화면에서 직접 골라야 한다(아래 winnerSide=null).
     screp이 이미 가린 판은 절대 건드리지 않는다 — 이건 빈자리를 채우는 값이다. */
  const leaveWinnerTeam = ((): number | null => {
    const [t1Id, t2Id] = playingTeamIds;
    if (t1Id === undefined || t2Id === undefined) return null;
    const leftIds = new Set(
      (res.Computed?.LeaveGameCmds ?? []).map((c) => c.PlayerID),
    );
    const played = (res.Header.Players ?? []).filter((p) => (
      !p.Observer && p.Type?.Name !== "Observer" && p.Type?.Name !== "Computer"
      && playingTeamIds.includes(p.Team)
      && (descByPlayerId.get(p.ID)?.CmdCount ?? 0) > 0
    ));
    const allLeft = (team: number): boolean => {
      const ids = played.filter((p) => p.Team === team).map((p) => p.ID);
      return ids.length > 0 && ids.every((id) => leftIds.has(id));
    };
    const out1 = allLeft(t1Id);
    const out2 = allLeft(t2Id);
    if (out1 === out2) return null;
    return out1 ? t2Id : t1Id;
  })();
  const screpWinner = res.Computed?.WinnerTeam ?? 0;
  const winnerTeamRaw = screpWinner !== 0 ? screpWinner : leaveWinnerTeam ?? 0;
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

  /* 개체 트랙 v2 — 커맨드 스트림을 태그 단위로 다시 읽는다(요청). 관전 의심자까지 포함해
     실제 슬롯 전원을 준다(명령이 거의 없는 사람은 개체도 거의 안 만든다). 실측 77ms(4:4
     22분)라 등록 흐름을 눈에 띄게 늦추지 않고, 어떤 실패도 등록을 막으면 안 되므로 통째로
     감싼다. */
  const unitTracks = ((): string | null => {
    if (!cmds) return null;
    try {
      const trackPlayers = (res.Header.Players ?? [])
        .filter((p) => !p.Observer && p.Type?.Name !== "Observer")
        .map((p) => ({
          id: p.ID, name: p.Name, race: RACE_NAME_MAP[p.Race?.Name ?? ""] ?? "" as const,
          // 게임 내 개인색 — v1을 걷어낸 뒤에도 이 테이블만으로 칠할 수 있게(요청).
          color: typeof p.Color?.RGB === "number"
            ? `#${p.Color.RGB.toString(16).padStart(6, "0")}` : null,
          // 시작 지점 — 시작 홀(첫 커맨드센터·해처리)을 개체로 심는 재료.
          startX: startTileOf(p.SlotID)?.x ?? null,
          startY: startTileOf(p.SlotID)?.y ?? null,
        }));
      return JSON.stringify(buildUnitTracks(cmds, trackPlayers));
    } catch {
      return null;
    }
  })();

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
    mapGrid: await readMapGrid(res),
    startSpots: (res.MapData?.StartLocations ?? []).map((sp) => [sp.X / 32, sp.Y / 32] as [number, number]),
    unitTracks,
  };
}
