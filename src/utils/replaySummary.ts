import type { ParsedReplay, ParsedReplayPlayer, ReplayPlayerSignals } from "./replayParser";
import { scanTactics } from "./replayTactics";
import {
  eliminatedFrame, fellFrame, productionDips, revivalFrame, surgeSpanMin,
} from "./replayFell";
import { REPLAY_SUMMARY_VERSION, type ReplaySummaryBeat, type ReplaySummaryData } from "./replaySummaryData";
import {
  DEFENSE_KO, EXPANSION_KO, PRODUCTION_KO, SPECTACLE_UNITS, SUPPORT_UNITS, UNIT_KO, UNIT_ROLE,
  renderReplaySummary,
} from "./replaySummaryText";

// 리플레이에서 뽑은 재료로 경기 요약을 만든다(요청).
//
// 만드는 건 완성된 문장이 아니라 '무슨 일이 있었나'의 목록이다(ReplaySummaryData) — 문구와
// 이름은 볼 때 replaySummaryText.ts가 붙인다. 그래야 닉네임이 바뀌거나 표현을 고쳐도 이미
// 등록된 경기가 옛말을 계속 보여주지 않는다(요청). 여기가 하는 일은 "무엇을 말할지"를
// 고르는 것까지고, "어떻게 말할지"는 전부 저쪽 몫이다.
//
// 아래 원칙은 그대로다.
//
// "APM 210 vs 150" 같은 지표 나열이 아니라 전황을 말하는 문장이어야 하고(요청), 경기마다
// 다른 이야기가 나오도록 최대한 다양하고 풍부해야 한다(요청):
//   "미친마법사가 하이템플러 캐리어 조합으로 승리"
//   "브래드가 초반 열세이다가 후반에 탱크와 발키리 조합으로 역전"
//   "34분 혈투 끝에 조조가 울트라 디파일러로 승리, 유비가 일찍 무너짐"
//
// 구조: 재료에서 '사실(Fact)'을 여러 개 뽑아 두고, 희소한 것부터 골라 두세 개를 이어 붙인다.
// 한 가지 규칙으로 문장 하나만 찍어내면 모든 경기가 똑같이 읽히기 때문이다 — 핵·캐리어·
// 40분 혈투 같은 드문 사건이 있으면 그게 먼저 말해진다.
//
// 재료는 전부 커맨드 스트림의 '명령' 기록이라 '완성'이 아니다 — 취소한 생산도 세지고,
// 저그 라바 다중 변태는 커맨드 1개로 잡힌다(replayParser의 buildCount 주석과 같은 한계).
// 그래서 문장은 단정("압도했다")을 피하고 관찰한 사실만 말한다. 알맹이가 없으면 null을
// 돌려주고 요약을 안 붙인다 — 틀린 문장보다 없는 편이 낫다.

// 1 프레임 = 0.042초(replayParser와 같은 상수).
const SECONDS_PER_FRAME = 0.042;

// 조합 이야기에서 뺄 유닛 — 일꾼·보급·알처럼 "무엇으로 싸웠나"와 무관한 것들.
const WORKER_UNITS = new Set(["SCV", "Probe", "Drone"]);
const NON_COMBAT_UNITS = new Set([
  ...WORKER_UNITS, "Larva", "Egg", "Overlord", "Mutalisk Cocoon", "Cocoon", "Lurker Egg",
  // 인터셉터/스캐럽은 캐리어·리버가 자동으로 뽑는 소모품이라 조합 이름이 될 수 없다.
  "Interceptor", "Scarab", "Spider Mine", "Scanner Sweep",
]);



// 후반 테크로 볼 유닛 / 초반 러시로 볼 유닛.
const LATE_TECH_UNITS = new Set([
  "Carrier", "Arbiter", "Battlecruiser", "Science Vessel", "Valkyrie",
  "Ultralisk", "Defiler", "Guardian", "Devourer", "Archon", "Dark Archon", "Reaver",
]);
const EARLY_RUSH_UNITS = new Set(["Zergling", "Marine", "Zealot", "Hydralisk", "Vulture"]);

// 확장(멀티) 건물 — 이걸 몇 개 지었나로 운영/올인을 가른다.
const EXPANSION_BUILDINGS = new Set(["Nexus", "Hatchery", "Command Center"]);
// 방어 건물·드랍 수송선 이야기는 이제 각각 "질럿과 성큰으로 막아섰지만 실패"(아래
// DEFENSE_KO)와 전술 층(replayTactics의 드랍십/셔틀)이 맡는다 — 여기 목록은 없앴다.

// 유닛이 경기에서 하는 '역할' — 같은 승리라도 무엇으로 이겼는지에 따라 다르게 읽히도록
// (요청: 팀전이라도 잘한 사람이 있으면 그 사람 얘기를 많이 — "하이템플러 견제로 승기를 잡음").
// 활약을 고를 때 역할에 매기는 가중치. 질럿 40기와 하이템플러 25기 중 이야깃거리는 뒤쪽인데
// (요청 예시: "하이템플러 견제로 승기를 잡음") 개수만 보면 앞쪽이 이긴다 — 기본 병력은 낮추고
// 판을 가르는 역할은 올려서, '많이 뽑은 유닛'이 아니라 '그 사람다운 유닛'이 뽑히게 한다.
const ROLE_WEIGHT: Record<string, number> = {
  견제: 2, 마법: 2, 매복: 1.8, 저격: 1.8, "공중 견제": 1.8, 드랍: 1.6, 자폭: 1.6,
  "공중 장악": 1.5, 제공권: 1.3, 돌파: 1, "자리 잡기": 0.7, 물량: 0.5,
};
// 역할별 맺음말 — 뜻에 맞춰 갈라 두면 같은 문장이 반복되지 않는다.


// 국면 경계(초). 클럽 경기 길이 분포에 맞춘 어림값이다.
const EARLY_GAME_SEC = 7 * 60;
const LATE_GAME_SEC = 18 * 60;
const EPIC_GAME_SEC = 30 * 60;

// 한쪽이 이 배율 넘게 일꾼을 더 뽑았으면 경제가 벌어진 것으로 본다.
const WORKER_GAP_RATIO = 1.6;
// 건물을 이만큼 띄웠으면 한두 채 옮긴 게 아니라 자리를 내주고 도망다닌 것이다.
const LIFT_OFF_MIN = 3;
// 방어 건물을 한 종류라도 이만큼 지었으면 '막을 준비'로 본다.
const DEFENSE_MIN = 3;
// 여기부터는 준비가 아니라 아예 '도배'다 — 그 자체가 전황이라 더 무겁게 친다(요청).
// 여섯 채로는 도배라고 하기 민망해서 기준을 올렸다(지적).
const TURTLE_MIN = 10;

// 마지막 커맨드가 경기 끝보다 이만큼(비율) 앞서면 "일찍 무너졌다"로 본다.
const EARLY_OUT_RATIO = 0.7;
// 맺음말의 '몰아붙여 이긴 사람들'에 들려면 최소한 이만큼은 판에 남아 있어야 한다
// (지적: 6분에 무너진 사람이 끝까지 살아 싸운 것처럼 읽힘). EARLY_OUT_RATIO보다 훨씬
// 이르게 잡는 이유는 ENDING_ALIVE_RATIO를 쓰는 자리의 주석 참고.
const ENDING_ALIVE_RATIO = 0.5;

// 합공으로 볼 시간 창 — 이보다 늦게 끊긴 건 초반 러시가 아니라 그냥 진 것이다.
const GANG_RUSH_SEC = 9 * 60;
// 그 시점까지 이만큼은 뽑았어야 '달려든 사람'으로 센다 — 뒤에서 확장만 하고 있던 사람까지
// 합공에 넣으면 숫자가 거짓말이 된다.
const GANG_MIN_UNITS = 8;

// '째기'는 시계로 재는 것이 아니라 무엇을 먼저 뽑았느냐로 갈린다(지적: 일꾼 뽑는 속도
// 대비 병력 뽑는 속도를 비교). 초반 구간에서 일꾼이 병력보다 이만큼 앞서면 째기로 본다.
const GREEDY_RATIO = 3;
// 견줄 만큼은 뽑았어야 한다 — 서너 기 차이는 아무 뜻도 아니다.
const GREEDY_MIN_WORKERS = 12;
// 어디까지를 '초반'으로 볼 것인가 — 경기 길이에 대비해 잡는다.
const GREEDY_WINDOW_RATIO = 0.3;
// 그래도 경기 앞쪽 이야기여야 한다 — 후반 이야기를 째기라 부르면 말이 안 된다.
const GREEDY_MAX_SEC = 8 * 60;
// 경기 전체로 이만큼은 뽑아야 견줄 거리가 된다(관전 슬롯·즉시 탈락 제외).
const GREEDY_MIN_UNITS = 6;
// 째기 구간 뒤 이 안에 생산이 꺾였으면 째다가 얻어맞은 것이다.
const GREEDY_PUNISH_SEC = 4 * 60;
// 째고 나서 이만큼 뽑아냈으면 '물량이 폭발했다'고 말할 만하다.
const GREEDY_PAYOFF_UNITS = 30;

// 이만큼 길어진 경기는 문장을 두 줄 더 쓴다(요청) — 국면 자체가 더 많다.
const LONG_GAME_SEC = 30 * 60;

// 손이 빨랐다고 말하려면 그 경기 평균 자체가 이 정도는 돼야 한다 — 다 같이 느린 경기에서
// 제일 빠른 사람을 두고 '특출나다'고 할 수는 없다.
const HANDS_MIN_AVG = 90;
// 그리고 평균의 이만큼을 넘어야 '특출나게'다.
const HANDS_RATIO = 1.5;
// 이만큼 나오면 남과 견줄 것도 없이 그 자체가 이야깃거리다(요청: 300 이상이면 컨트롤
// 이야기를 넣자) — 다른 사람들이 다 같이 빨랐더라도 이건 따로 말해 준다.
const HANDS_ELITE = 300;
// 소모전 — 이만큼은 길어야 하고,
const ATTRITION_MIN_SEC = 12 * 60;
// 양쪽이 분당 이만큼씩 병력을 쏟아부었으면 한 방 싸움이 아니라 소모전이다(요청).
const ATTRITION_PER_MIN = 14;

// 팽팽한 대치로 볼 최소 길이 — 이보다 짧으면 그냥 한쪽이 밀어붙인 경기다.
const STANDOFF_MIN_SEC = 15 * 60;
// 서로 병력을 거의 안 보탠 채 오래 버틴 구간(late-hold) 기준.
// 이 정도는 긴 경기여야 '한참 버텼다'는 말이 성립한다.
const HOLD_MIN_SEC = 20 * 60;
// 그렇게 멎은 뒤 이만큼은 이어져야, 그리고 경기의 이 비율은 돼야 한 줄 쓸 만하다.
const HOLD_QUIET_SEC = 8 * 60;
const HOLD_QUIET_SHARE = 0.25;
// 양쪽이 낸 것의 비율이 이 안이면 '비등비등했다'로 본다.
const STANDOFF_RATIO = 1.25;

// ── 중반부터 끝까지 끌고 간 유닛(long-run) ──
// 한 유닛을 오래도록 계속 뽑았다는 건 그걸로 경기를 끌고 갔다는 뜻이다(요청: 중반부터
// 후반까지 운용한 걸로 보이면 그 유닛이 요약에 두 번 나와도 된다). 살아남았는지는
// 리플레이에 없으니 '언제부터 언제까지 계속 뽑았나'까지만 말한다.
//
// 첫 기와 마지막 기가 이만큼은 벌어져야 '끌고 갔다'가 성립한다.
const LONG_RUN_MIN_SEC = 15 * 60;
// 그 사람 전투 인구의 이만큼은 돼야 주력이다 — 곁들여 뽑은 것까지 세면 아무 경기에나 붙는다.
const LONG_RUN_SHARE = 0.25;
// 몇 기는 뽑았어야 한다. 오래 뽑았어도 다섯 기면 '끌고 갔다'가 아니다.
const LONG_RUN_MIN_N = 12;
// 무너지기 이 안쪽에서야 방어 건물 첫 채를 올렸으면 '부랴부랴 지은 것'이다(요청).
// 진작부터 지어 둔 사람은 첫 채가 한참 앞이라 여기 안 걸린다.
const PANIC_DEF_SEC = 2 * 60;
// '뒤늦게 방어를 올렸다'를 판정하는 값들(요청: 초반 러시에 생산이 끊길 만큼 맞고 나서야
// 포토를 여러 개 올린 대목이 안 나온다). 한두 개는 원래 짓는 수라 근거가 못 된다는
// 지적에 따라, 몇 개가 있느냐가 아니라 '한꺼번에 늘린 시점'을 본다.
// 이 창 안에 이만큼이 몰려 올라갔으면 그게 '증설'이다.
const DEF_SURGE_MIN = 3;
const DEF_SURGE_WINDOW_SEC = 2 * 60;
// 얻어맞은 지 이 안쪽에서 증설이 시작돼야 '그 공격에 대한 반응'이라 말할 수 있다.
// 한참 뒤의 증설은 그냥 그 사람의 운영이지 뒤늦은 대응이 아니다.
const DEF_SURGE_REACT_SEC = 5 * 60;
// 반대로 '온다!' 하고 먼저 짓는 경우도 있다(지적) — 오히려 그쪽이 흔하다. 그래서 증설이
// 먼저고 생산이 꺾인 게 뒤인 경우도 같은 사건으로 본다. 다만 이쪽 창은 좁게 잡는다:
// 한참 뒤에 맞은 것까지 끌어오면 아무 증설이나 '공격을 예감했다'가 되고, productionDips는
// 1분 단위라 실제로는 동시에 벌어진 일이 앞뒤로 갈리기도 한다.
const DEF_SURGE_WARN_SEC = 2 * 60;
// 들이친 수에 당한 사람의 방어가 '얇았다'고 말할 수 있는 상한 — 이보다 많이 갖췄으면
// 그건 뚫린 것이지 없어서 당한 게 아니다(그 얘기는 돌파 문장이 한다).
const DEF_THIN_MAX = 2;
// 그리고 이 시각은 지나야 한다 — 2분짜리 러시에 "벙커 하나 없었다"고 하면 사실이긴 해도
// 정보가 아니다. 그 시점엔 아무도 없다. 방어 건물 하나가 자리를 잡을 만한 때부터 센다.
const DEF_THIN_MIN_SEC = 3 * 60;
// 시작이 초반을 지나야 '중반부터'다 — 1분부터 뽑은 기본 유닛은 여기 해당하지 않는다.
const LONG_RUN_START = 0.3;
// 그리고 끝까지 이어져야 한다.
const LONG_RUN_END = 0.85;

// 발키리가 뜬 뒤 오버로드를 이만큼은 다시 뽑았어야 '잡히고 있었다'고 말할 수 있다.
const OVERLORD_REBUILD_MIN = 4;
// 그리고 뽑는 속도가 그 전보다 이 배수는 빨라져야 한다 — 인구수 때문에 느는 것과 가른다.
const OVERLORD_SURGE_RATIO = 1.6;
// 일꾼도 같은 원리다 — 잡히지 않으면 한창때 지나 새로 뽑을 일이 별로 없다.
// 다만 일꾼은 오버로드보다 여유 있게 본다(지적) — 얻어맞은 직후에는 돈이 없어 바로
// 못 채우는 일이 흔하다. 그래서 수도 속도도 문턱을 낮춘다(아래 rebuiltAfter에서 '다시
// 뽑기 시작한 시점'부터 속도를 재는 것과 한 벌이다).
const WORKER_REBUILD_MIN = 4;
const WORKER_SURGE_RATIO = 1.25;
// 일꾼을 몰아 뽑은 구간이 이만큼(분) 넘게 이어졌으면 '내내 시달렸다'로 본다.
const HARASS_LONG_MIN = 6;
// 견제로 읽을 수 있는 수들 — 드랍과 뮤탈. 일꾼을 노리는 그림이 뚜렷한 것만 본다.
// 하이템플러 드랍(templar-drop)과 이레디에이트는 뺐다(지적) — 스톰도 이레디도 한복판
// 전투에서 훨씬 자주 쓰이는데 커맨드 스트림에는 그 마법을 '무엇에' 썼는지가 안 남는다.
// 일꾼을 노렸다고 단정할 수 없으니 일꾼 견제 문장으로는 안 쓴다.
const HARASS_KEYS = new Set([
  "shuttle-reaver", "zerg-drop", "dropship", "shuttle", "muta",
  // 클로킹 레이스는 일꾼을 지우는 대표적인 수다(요청).
  "cloak-wraith",
]);

// 러시·드랍을 간 뒤 이 안에 상대 생산이 끊기면 그 수의 결과로 본다.
const DAMAGE_WINDOW_SEC = 3 * 60;
// 탈락을 그 수의 결과로 묶는 창 — 이보다 벌어지면 인과가 아니라 우연에 가깝다(지적).
const ELIM_WINDOW_SEC = 90;
// 초반 올인이 막히고 역으로 무너졌는지 볼 시간 창.
const BACKFIRE_SEC = 5 * 60;
// 역풍으로 읽을 수들 — 실패하면 그대로 손해가 되는 초반 올인만.
// 질럿 러시는 정석이라 실패해도 '도박이 어긋난 것'이 아니다(지적) — 여기서 뺀다.
const BACKFIRE_KEYS = new Set([
  "zling-rush", "cannon-rush", "sunken-rush", "sneak-rax",
]);
// '들이친 수'만 피해와 이어 붙인다 — 센터 장악·시야·방어처럼 때리는 수가 아닌 것은 뺀다.
const RAID_KEYS = new Set([
  "zling-rush", "zealot-rush", "cannon-rush", "sunken-rush", "sneak-rax",
  "shuttle-reaver", "templar-drop", "zerg-drop", "dropship", "shuttle",
  "nydus", "recall", "bionic", "mech", "moka",
  // 빠른 테크·클로킹 레이스도 들이치는 수다 — 그 타이밍에 상대가 꺾였으면 그게 결과다(요청).
  "fast-tech", "cloak-wraith",
]);

interface Side {
  players: ParsedReplayPlayer[];
  /** 이 편이 뽑은 전투 유닛 합계(유닛명 → 커맨드 수). */
  combat: Map<string, number>;
  /** 이 편이 지은 건물 합계. */
  buildings: Map<string, number>;
  /** 일꾼 생산 커맨드 수. */
  workers: number;
  /** 구간별 커맨드 수 합계(초반/중반/후반). */
  thirds: [number, number, number];
  /** 연구한 테크 이름(중복 제거). */
  techs: Set<string>;
}

function buildSide(players: ParsedReplayPlayer[]): Side {
  const combat = new Map<string, number>();
  const buildings = new Map<string, number>();
  const techs = new Set<string>();
  const thirds: [number, number, number] = [0, 0, 0];
  let workers = 0;
  for (const p of players) {
    const s: ReplayPlayerSignals | null = p.signals;
    if (!s) continue;
    for (const [unit, n] of Object.entries(s.unitCounts)) {
      if (WORKER_UNITS.has(unit)) { workers += n; continue; }
      if (NON_COMBAT_UNITS.has(unit)) continue;
      if (!UNIT_KO[unit]) continue; // 이름을 모르는 유닛은 문장에 못 쓴다
      combat.set(unit, (combat.get(unit) ?? 0) + n);
    }
    for (const [b, n] of Object.entries(s.buildingCounts)) {
      buildings.set(b, (buildings.get(b) ?? 0) + n);
    }
    for (const t of s.techNames) if (DECISIVE_TECHS.has(t)) techs.add(t);
    s.cmdCountByThird.forEach((n, i) => { thirds[i] += n; });
  }
  return { players, combat, buildings, workers, thirds, techs };
}

// 중후반의 주력은 '몇 기 뽑았나'가 아니라 '얼마나 오래 그걸로 굴렸나'다(요청).
//
// 캐리어·골리앗처럼 잘 안 죽는 유닛은 한 번 갖춰 놓고 경기 끝까지 쓴다 — 그래서 뽑은
// 수가 적다. 반대로 질럿·저글링은 계속 죽으니까 계속 뽑는다. 수로 재는 한(뒷구간만
// 세든, 비율을 따지든) 잘 안 죽는 유닛은 언제나 진다. 실제로 두 번 지적받았다:
// "캐리어 골리앗 싸움이 메인인데 그걸 못잡네(안 죽고 오래 유지해서 그런듯)",
// "오랜 시간을 유지한(다른 걸 안 뽑은) 유닛들에 대한 기록이 안 남는 게 이상하다".
//
// 한때 '특정 유닛은 한 번 뽑으면 끝까지 남는다'로 풀어 봤지만 폐기했다(지적: 너무 위험한
// 가정). 우리가 읽는 건 커맨드 스트림뿐이고 거기엔 유닛의 생사가 아예 안 적혀 있다 —
// 어떤 병력이 살아남아 굴러다녔는지는 알 수 없다. 알 수 있는 건 '언제 무엇을 얼마나
// 뽑았나'뿐이므로, 거기서 벗어나는 말은 하지 않는다.
//
// 주력 조합은 '몇 기'가 아니라 '병력을 어디에 얼마나 부었나'로 정한다 — 인구수 합이다.
//
// 캐리어 한 기와 저글링 한 기를 같은 1로 세면 잘 안 죽어 적게 뽑는 유닛이 늘 밀린다.
// 인구수로 환산하면 그 왜곡이 가정 없이 사라진다(캐리어 1기 = 6, 질럿 1기 = 2).
//
// 구간(뒷부분만 세기)은 폐기했다. 실제 리플레이로 확인한 결과 그게 오히려 원인이었다 —
// 45분 경기에서 캐리어 32기를 12:56~15:27에 몰아 뽑고 그 뒤로는 질럿만 계속 뽑은 경기가
// 있었는데, 어떤 창을 잡아도 캐리어는 창 밖이라 통째로 사라졌다(지적: 캐리어 이야기가
// 계속 안 나온다). 경기 전체로 세면 질럿 125기(250) 대 캐리어 32기(192)라 둘 다 조합에
// 남는다 — "질럿과 캐리어 조합". 상대도 벌처 89기(178) 대 골리앗 77기(154)로 둘 다 남는다.
// 창을 두면 '언제 뽑았나'가 '무엇으로 싸웠나'를 이기는데, 우리가 말하려는 건 후자다.

/** 커맨드 한 번이 만드는 인구수 — 저글링·스커지는 한 번에 두 기라 합쳐서 센다.
 *  여기 없는 유닛은 2로 본다(대부분의 일반 전투 유닛). */
const UNIT_SUPPLY: Record<string, number> = {
  Marine: 1, Firebat: 1, Medic: 1, Ghost: 1,
  Vulture: 2, Goliath: 2, "Siege Tank (Tank Mode)": 2, "Siege Tank (Siege Mode)": 2,
  Wraith: 2, "Science Vessel": 2, Valkyrie: 3, Battlecruiser: 6,
  Zealot: 2, Dragoon: 2, "High Templar": 2, "Dark Templar": 2,
  Archon: 4, "Dark Archon": 4, Reaver: 4, Scout: 3, Corsair: 2, Carrier: 6, Arbiter: 4,
  Zergling: 1, Scourge: 1, Hydralisk: 1, Lurker: 2, Mutalisk: 2,
  Guardian: 2, Devourer: 2, Ultralisk: 4, Queen: 2, Defiler: 2, "Infested Terran": 2,
};
const supplyOf = (unit: string): number => UNIT_SUPPLY[unit] ?? 2;

/** 그 편이 병력에 부은 인구수 — 유닛명 → 인구수 합. 주력 조합의 순위 기준이다. */
function armyBySupply(players: ParsedReplayPlayer[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of players) {
    const s = p.signals;
    if (!s) continue;
    for (const [unit, n] of Object.entries(s.unitCounts)) {
      if (NON_COMBAT_UNITS.has(unit) || WORKER_UNITS.has(unit)) continue;
      if (!UNIT_KO[unit]) continue;
      out.set(unit, (out.get(unit) ?? 0) + n * supplyOf(unit));
    }
  }
  return out;
}

/** 그 편이 총 병력 규모(인구수)의 이만큼을 채운 프레임 — '조합을 다 갖춘 시점'.
 *  late-hold(양쪽 다 더는 병력을 안 보탠 구간)에서만 쓴다. */
const SETTLED_SHARE = 0.85;

function settledFrame(players: ParsedReplayPlayer[]): number | null {
  const made: { at: number; w: number }[] = [];
  for (const p of players) {
    const s = p.signals;
    if (!s) continue;
    for (const [unit, fs] of Object.entries(s.unitFrames)) {
      if (NON_COMBAT_UNITS.has(unit) || WORKER_UNITS.has(unit)) continue;
      if (!UNIT_KO[unit]) continue;
      for (const f of fs) made.push({ at: f, w: supplyOf(unit) });
    }
  }
  if (made.length === 0) return null;
  made.sort((a, b) => a.at - b.at);
  const total = made.reduce((n, m) => n + m.w, 0);
  if (total <= 0) return null;
  let acc = 0;
  for (const m of made) {
    acc += m.w;
    if (acc >= total * SETTLED_SHARE) return m.at;
  }
  return made[made.length - 1].at;
}

function countIn(map: Map<string, number>, names: Set<string>): number {
  let n = 0;
  for (const [k, v] of map) if (names.has(k)) n += v;
  return n;
}

/** 그 편의 주력 — 가장 많이 뽑은 전투 유닛 최대 두 종류(2위가 1위에 한참 못 미치면 하나만).
 *  앞자리는 스스로 싸움을 끝낼 수 있는 유닛에 준다 — 메딕·퀸 같은 보조 유닛이 수만 많다고
 *  "메딕으로 이김"이 되면 곤란하다(지적). 그런 유닛은 뒷자리로 밀려 조합으로 읽힌다. */
function mainUnits(combat: Map<string, number>, late?: Map<string, number>): string[] {
  // 순위는 '그 유닛에 부은 인구수'로 매긴다(위 armyBySupply 참고) — 못 구했으면 전체 수로.
  const rank = late && late.size > 0 ? late : combat;
  const ranked = [...rank.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return [];
  const lead = ranked.find(([u]) => !SUPPORT_UNITS.has(u)) ?? ranked[0];
  const second = ranked.find((x) => x !== lead);
  const out = [lead[0]];
  if (second && second[1] >= lead[1] * 0.35) out.push(second[0]);
  return out;
}

function sumCombat(p: ParsedReplayPlayer): number {
  const s = p.signals;
  if (!s) return 0;
  let n = 0;
  for (const [unit, c] of Object.entries(s.unitCounts)) {
    if (NON_COMBAT_UNITS.has(unit)) continue;
    n += c;
  }
  return n;
}

/** 그 사람이 뽑은 병력의 규모(인구수 합) — '몇 기'가 아니라 '얼마나 큰 병력'이다.
 *  팀전에서 '이 편의 주인공'을 고를 때 수로 세면, 질럿 60기를 뽑은 사람이 캐리어 12기 +
 *  드라군을 뽑은 사람을 언제나 이긴다. 그러면 주인공의 조합만 문장에 나가므로 캐리어는
 *  아예 언급될 기회가 없다(지적: 캐리어 이야기가 계속 안 나온다). */
function sumSupply(p: ParsedReplayPlayer): number {
  const s = p.signals;
  if (!s) return 0;
  let n = 0;
  for (const [unit, c] of Object.entries(s.unitCounts)) {
    if (NON_COMBAT_UNITS.has(unit) || WORKER_UNITS.has(unit)) continue;
    n += c * supplyOf(unit);
  }
  return n;
}

/** 그 편에서 눈에 띄게 많이 뽑은 사람 — 팀전이라도 이 사람 얘기를 많이 하기 위한 기준
 *  (요청). 2등보다 1.4배 넘게 앞서면 인정한다(예전엔 "혼자 절반 넘게"라 3인 이상 팀에서는
 *  거의 안 잡혔다). 1:1은 당연히 그 사람이다. */
function standout(side: Side): ParsedReplayPlayer | null {
  const ranked = side.players
    .map((p) => ({ p, n: sumSupply(p) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  if (ranked.length === 0) return null;
  if (ranked.length === 1) return ranked[0].p;
  return ranked[0].n >= ranked[1].n * 1.4 ? ranked[0].p : null;
}

/** 한 사람이 뽑은 전투 유닛만 골라 많은 순으로 — 팀 합계가 아니라 '이 사람의 조합'이다. */
function ownCombat(p: ParsedReplayPlayer): Map<string, number> {
  const out = new Map<string, number>();
  const s = p.signals;
  if (!s) return out;
  for (const [unit, n] of Object.entries(s.unitCounts)) {
    if (NON_COMBAT_UNITS.has(unit)) continue;
    if (!UNIT_KO[unit]) continue;
    out.set(unit, n);
  }
  return out;
}

/** "○○의 하이템플러 견제로 승기를 잡음"에 쓸 유닛 하나 — 그 사람을 특징짓는 카드를 고른다.
 *  팀 동료가 거의 안 뽑은 유닛일수록 그 사람의 몫이 뚜렷하므로 우선한다.
 *  avoid는 본문이 이미 말한 유닛 — "저글링으로 역전, 저글링 물량으로 밀어붙임"처럼 같은
 *  단어를 두 번 쓰지 않기 위해 뺀다. 다 빼서 남는 게 없으면 그냥 원래대로 고른다. */
function heroUnitOf(
  side: Side,
  hero: ParsedReplayPlayer,
  avoid: string[] = []
): string | null {
  const own = ownCombat(hero);
  if (own.size === 0) return null;
  const mates = side.players.filter((p) => p !== hero);
  // 보조 유닛은 그 사람의 '한 방'이 될 수 없다(지적) — 남는 게 없으면 이 문장은 통째로 뺀다.
  const pool = [...own.entries()].filter(([u]) => UNIT_ROLE[u] && !SUPPORT_UNITS.has(u));
  const fresh = pool.filter(([u]) => !avoid.includes(u));
  const scored = (fresh.length > 0 ? fresh : pool)
    .map(([unit, n]) => {
      const byMates = mates.reduce((acc, m) => acc + (ownCombat(m).get(unit) ?? 0), 0);
      // 혼자 뽑은 유닛에 가중치 — 팀에서 이 사람만 낸 카드가 곧 그 사람의 이야기다.
      return { unit, score: n * (byMates === 0 ? 2 : 1) * (ROLE_WEIGHT[UNIT_ROLE[unit]] ?? 1) };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.unit ?? null;
}

/** 경기가 끝나기 한참 전에 커맨드가 끊긴 사람 — 그 시점에 졌거나 나간 것으로 읽는다. */
function earlyOuts(players: ParsedReplayPlayer[], totalFrames: number | null): ParsedReplayPlayer[] {
  if (!totalFrames) return [];
  return players.filter((p) => {
    if (sumCombat(p) === 0) return false; // 아무것도 안 한 슬롯은 "무너진" 게 아니다
    const fell = fellFrame(p, totalFrames);
    return fell !== null && fell < totalFrames * EARLY_OUT_RATIO;
  });
}

/** 그 프레임까지 뽑은 전투 유닛 수 — 훈련 커맨드의 시각으로 센다. */
function combatBefore(p: ParsedReplayPlayer, frame: number): number {
  const s = p.signals;
  if (!s) return 0;
  let n = 0;
  for (const [unit, frames] of Object.entries(s.unitFrames)) {
    if (NON_COMBAT_UNITS.has(unit)) continue;
    n += frames.filter((f) => f < frame).length;
  }
  return n;
}

/** "몇 명이 몰아쳤나"(요청) — 리플레이에 인구수가 없어 '죽었다'를 직접 볼 수는 없다.
 *  대신 커맨드가 끊긴 시점이 그 사람이 판에서 사라진 시점이고, 그때까지 병력을 낸 상대가
 *  몇 명인지는 셀 수 있다. 초반에 한 사람이 먼저 정리됐고 달려든 상대가 둘 이상일 때만
 *  말한다 — 한 명이면 그건 이미 전술 문장이 하고 있는 얘기다. */
function gangRush(
  victims: ParsedReplayPlayer[],
  attackers: ParsedReplayPlayer[],
  totalFrames: number | null
): { victim: ParsedReplayPlayer; by: ParsedReplayPlayer[] }[] {
  const out: { victim: ParsedReplayPlayer; by: ParsedReplayPlayer[] }[] = [];
  for (const v of victims) {
    const fell = fellFrame(v, totalFrames);
    if (fell === null || fell * SECONDS_PER_FRAME > GANG_RUSH_SEC) continue;
    const by = attackers.filter((a) => combatBefore(a, fell) >= GANG_MIN_UNITS);
    if (by.length >= 2) out.push({ victim: v, by });
  }
  return out;
}

// 이 안에 친 gg는 같은 순간의 것으로 본다.
const GG_MERGE_SEC = 90;

/** 비슷한 때에 친 gg는 한 문장으로 묶는다(요청) — 팀원이 잇달아 치면 같은 말이 여러 줄이
 *  된다. 편이 다르면 묶지 않는다(그건 서로 다른 순간이다). */
function mergeGg(list: Beat[], sideSize: (won: boolean) => number): Beat[] {
  const gg = list.filter((b) => b.k === "gg");
  if (gg.length <= 1) return list;
  const groups: Beat[][] = [];
  for (const b of [...gg].sort((x, y) => (x.at ?? 0) - (y.at ?? 0))) {
    const g = groups.find((x) =>
      x[0].won === b.won
      && Math.abs((x[0].at ?? 0) - (b.at ?? 0)) * SECONDS_PER_FRAME <= GG_MERGE_SEC);
    if (g) g.push(b); else groups.push([b]);
  }
  const merged = groups.map((g) => {
    const who = [...new Set(g.flatMap((b) => b.who))];
    const ats = g.map((b) => b.at).filter((x): x is number => x !== null && x !== undefined);
    return {
      ...g[0], who, at: ats.length > 0 ? Math.min(...ats) : null,
      // 그 편 전원이 쳤으면 "○○ 팀이 결국 GG 선언"으로 말한다.
      p: {
        ...(g[0].p ?? {}),
        ...(who.length >= 2 && who.length === sideSize(g[0].won) ? { all: true } : {}),
      },
    } as Beat;
  });
  return [...list.filter((b) => b.k !== "gg"), ...merged];
}

/** 문장에서 전술 이름을 만들 때 필요한 값 하나 — 여러 사람의 수를 한 문장에 묶을 때
 *  각자의 드론 수·게이트 수를 잃지 않기 위해 나란히 실어 보낸다. */
function tacticParam(key: string, p: Record<string, unknown> | undefined): string {
  if (!p) return "";
  if (key === "zling-rush") return String(p.drones ?? "");
  if (key === "zealot-rush") return String(p.gates ?? "");
  if (key === "sneak-rax") return p.firebat ? "firebat" : "";
  if (key === "zerg-drop") return p.lurker ? "lurker" : "";
  // 패스트 OO는 무슨 유닛이었나가 곧 이름이다 — 묶어 말할 때도 그 값을 함께 넘긴다.
  if (key === "fast-tech") return String(p.unit ?? "");
  return "";
}

// 같은 사람이 이 안에서 여러 번 얻어맞았으면 한 순간으로 본다.
// 스타는 호흡이 빠른 게임이라 창을 넉넉히 잡으면 서로 먼 일이 한 순간으로 묶인다(지적).
const RAID_MERGE_SEC = 90;

// 같은 편 이야기를 붙여 읽어도 될 만큼 '거의 같은 때'로 보는 간격. 이걸 넘으면 시간이 먼저다(지적).
// 더 촘촘히 나눠 달라는 지적에 따라 40초까지 좁혔다 — 이 안의 일만 '같은 때'로 본다.
const CLUSTER_SEC = 40;

/** 한 사람이 여러 수에 잇달아 무너진 걸 두 문장으로 말하지 않는다(지적) — "Rex의 9드론
 *  저글링 러시와 제롬의 4게이트 질럿 러시에 군범이 2분 만에 무너짐"으로 묶는다. */
function mergeRaids(list: Beat[]): Beat[] {
  const raids = list.filter((b) => b.k === "raid-damage" && (b.whom?.length ?? 0) > 0);
  if (raids.length <= 1) return list;
  const groups: Beat[][] = [];
  for (const b of [...raids].sort((x, y) => (x.at ?? 0) - (y.at ?? 0))) {
    const g = groups.find((x) =>
      x[0].whom?.[0] === b.whom?.[0]
      && Math.abs((x[0].at ?? 0) - (b.at ?? 0)) * SECONDS_PER_FRAME <= RAID_MERGE_SEC);
    if (g) g.push(b); else groups.push([b]);
  }
  const merged = groups.map((g) => {
    if (g.length === 1) return g[0];
    const ats = g.map((b) => b.at).filter((x): x is number => x !== null && x !== undefined);
    return {
      ...g[0],
      who: g.flatMap((b) => b.who),
      at: ats.length > 0 ? Math.min(...ats) : null,
      weight: Math.max(...g.map((b) => b.weight)) + 2,
      p: {
        ...(g[0].p ?? {}),
        ks: g.map((b) => String(b.p?.k ?? "")),
        vs: g.map((b) => tacticParam(String(b.p?.k ?? ""), b.p)),
      },
    } as Beat;
  });
  return [...list.filter((b) => !raids.includes(b)), ...merged];
}

/** 같은 수를 비슷한 때에 서로 갔는데 한쪽만 통했다면, 그건 두 문장이 아니라 한 문장이다
 *  (지적: 파괴됐는데 그 다음에 러시를 갔다니 이상하다) — "제롬과 군범이 3게이트 질럿
 *  러시를 갔는데 제롬은 막히고 군범은 제롬의 기지를 반파함". */
function mergeDuelRush(list: Beat[]): Beat[] {
  const raids = list.filter(
    (b) => b.k === "raid-damage" && b.p?.k && (b.whom?.length ?? 0) > 0 && !b.p?.ks,
  );
  const backs = list.filter((b) => b.k === "rush-backfire");
  if (raids.length === 0 || backs.length === 0) return list;
  const used = new Set<Beat>();
  const merged: Beat[] = [];
  for (const r of raids) {
    const victim = r.whom?.[0];
    const key = String(r.p?.k ?? "");
    const bk = backs.find(
      (x) =>
        !used.has(x) && x.who[0] === victim && String(x.p?.k ?? "") === key
        // 같은 이름의 수여야 한 문장으로 묶을 수 있다 — 3게이트와 4게이트는 다른 수다.
        && tacticParam(key, x.p) === tacticParam(key, r.p)
        && Math.abs((x.at ?? 0) - (r.at ?? 0)) * SECONDS_PER_FRAME <= RAID_MERGE_SEC,
    );
    if (!bk) continue;
    used.add(bk);
    used.add(r);
    merged.push({
      ...r, k: "duel-rush",
      weight: Math.max(r.weight, bk.weight) + 2,
      at: Math.min(r.at ?? 0, bk.at ?? 0),
    });
  }
  if (merged.length === 0) return list;
  return [...list.filter((b) => !used.has(b)), ...merged];
}

/** 양쪽이 같은 짓을 했으면 한 문장으로 묶는다(요청: "누구와 누구가 서로 ~함").
 *  재료가 다르면 묶지 않는다 — 9드론과 12드론을 한 숫자로 말하면 한쪽이 거짓이 된다. */
/** 양쪽이 똑같이 '맵 곳곳에 흩어 지었다'면 한 문장으로 묶는다. mergeMutual은 p가 완전히
 *  같을 때만 묶는데 흩어진 군데 수는 사람마다 달라서 안 묶였고, 그 바람에 후반 비트 두 개가
 *  자리를 둘이나 먹었다(지적: "후반이 너무 강해져서 초중반 내용이 사라졌다"). 애초에
 *  서로 도망 다닌 한 장면이라 한 문장이 맞다. */
function mergeScatter(list: Beat[]): Beat[] {
  const scatters = list.filter((b) => b.k === "scatter");
  if (scatters.length < 2) return list;
  const w = scatters.find((b) => b.won);
  const l = scatters.find((b) => !b.won);
  if (!w || !l) return list;
  const ats = [w.at, l.at].filter((x): x is number => x !== null && x !== undefined);
  const merged: Beat = {
    ...w,
    who: [...w.who, ...l.who],
    at: ats.length > 0 ? Math.min(...ats) : null,
    weight: Math.max(w.weight, l.weight),
    p: {
      ...(w.p ?? {}),
      // 한 문장으로 말할 땐 '몇 군데'가 사람마다 다르니 적은 쪽을 기준으로 말한다.
      spots: Math.min(Number(w.p?.spots ?? 0), Number(l.p?.spots ?? 0)),
      // 'mutual'은 렌더러가 문장 앞에 "서로 "를 붙이는 신호로 이미 쓰고 있다 — 여기서
      // 쓰면 "둘 다 서로 …"가 된다. 다른 이름으로 둔다.
      bothSides: true,
    },
  };
  return [...list.filter((b) => b.k !== "scatter"), merged];
}

function mergeMutual(list: Beat[]): Beat[] {
  const byKey = new Map<string, Beat[]>();
  for (const b of list) {
    const g = byKey.get(b.k);
    if (g) g.push(b); else byKey.set(b.k, [b]);
  }
  const out: Beat[] = [];
  for (const group of byKey.values()) {
    // gg는 양쪽이 쳤다고 '서로 한 일'이 아니다 — 각자의 순간이라 따로 둔다.
    if (group[0]?.k === "gg") { out.push(...group); continue; }
    const w = group.find((b) => b.won);
    const l = group.find((b) => !b.won);
    if (!w || !l || JSON.stringify(w.p ?? {}) !== JSON.stringify(l.p ?? {})) {
      out.push(...group);
      continue;
    }
    const ats = [w.at, l.at].filter((x): x is number => x !== null && x !== undefined);
    const { whom: _whom, who2: _who2, ...rest } = w;
    // '서로'는 정말 서로에게 한 것일 때만 쓴다(지적) — 자리로 상대를 짚어 낸 전술(포토러시·
    // 성큰러시·몰래 배럭)은 양쪽 다 대상이 확실하므로 '서로'가 맞지만, 질럿 러시처럼
    // 유닛 수로만 잡은 건 누구를 향했는지 모른다. 그런 건 '양 팀' 쪽으로 말한다.
    const eachOther = (w.whom?.length ?? 0) > 0 && (l.whom?.length ?? 0) > 0;
    out.push({
      ...rest,
      who: [...w.who, ...l.who],
      at: ats.length > 0 ? Math.min(...ats) : null,
      // 양쪽이 같은 수를 뒀다는 것 자체가 이야깃거리라 조금 무겁게 친다.
      weight: Math.max(w.weight, l.weight) + 2,
      p: { ...(w.p ?? {}), ...(eachOther ? { mutual: true } : { both: true }) },
    });
  }
  return out;
}

/** 이름을 아는 유닛만 남긴다 — 하나도 없으면 조합을 말할 수 없다. */
function nameableUnits(units: string[]): string[] {
  return units.filter((u) => UNIT_KO[u]);
}

function minutes(sec: number): number {
  return Math.round(sec / 60);
}

/** 고르는 동안의 후보 한 줄 = 저장될 beat + 고를 때만 쓰는 무게.
 *  고를 때는 무게순(재미있는 것부터), 이야기로 늘어놓을 때는 시간순이다. */
interface Beat extends ReplaySummaryBeat {
  weight: number;
  /** 이 말이 이미 다른 줄에 나왔으면 이 줄은 버린다 — "7해처리까지 늘려" 옆에 "해처리를
   *  7개까지 늘려"가 또 붙는 걸 막는다. 고를 때만 쓰고 저장하지는 않는다. */
  dedupeOn?: string;
}

// 승부를 가르는 테크만 이야기에 넣는다(요청: 중요한 이벤트만) — 버로우·환상처럼 있어도
// 그만인 연구는 자리만 차지한다. 이름은 TECH_KO에 있는 것 중에서 고른다.
const DECISIVE_TECHS = new Set([
  "Psionic Storm", "Lurker Aspect", "Dark Swarm", "Recall", "Yamato Gun", "Irradiate",
  "Lockdown", "Stasis Field", "Plague", "Mind Control", "Spider Mines", "Stim Packs",
  "Cloaking", "Personnel Cloaking",
]);

/** 확장 건물의 한국어 이름 — "멀티를 5개까지"가 아니라 "5해처리까지"로 말한다(요청). */

/** 고를 때만 쓰는 것들(무게·중복 판정)을 떼고 저장할 형태만 남긴다. */
function strip({ weight: _w, dedupeOn: _d, ...b }: Beat): ReplaySummaryBeat {
  return b;
}

/** 방어 건물의 한국어 이름 — "질럿과 성큰으로 막아섰지만 실패"처럼 유닛과 함께 말한다(요청). */

/** 한 사람이 그 종류 건물을 몇 채 지었나. */
function buildingsOf(p: ParsedReplayPlayer, names: Set<string>): number {
  const s = p.signals;
  if (!s) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(s.buildingCounts)) if (names.has(k)) n += v;
  return n;
}

/** 그 종류 건물들의 건설 프레임을 시간순으로(기록된 앞부분만). */
function buildFramesOf(p: ParsedReplayPlayer, names: Set<string>): number[] {
  const s = p.signals;
  if (!s) return [];
  const out: number[] = [];
  for (const [k, arr] of Object.entries(s.buildingFrames)) if (names.has(k)) out.push(...arr);
  return out.sort((a, b) => a - b);
}

/** 포지를 게이트보다 먼저 올린 프로토스 — 그 포토는 방어가 아니라 캐논러시라는 신호다.
 *  이걸 "포토로 막아냄"이라고 하면 정반대로 읽힌다. */
function cannonIsRush(p: ParsedReplayPlayer): boolean {
  const s = p.signals;
  if (!s) return false;
  const forge = s.firstBuildingFrame["Forge"];
  const gate = s.firstBuildingFrame["Gateway"];
  return forge !== undefined && (gate === undefined || forge < gate);
}

/** 하늘로 다니는 전투 유닛 — 무엇이 쳐들어왔느냐에 따라 맞는 방어 건물이 갈린다.
 *  수송선(드랍십·셔틀·오버로드)은 싸우러 오는 게 아니라 빼 둔다. */
const AIR_UNITS = new Set([
  "Wraith", "Battlecruiser", "Valkyrie", "Science Vessel",
  "Mutalisk", "Guardian", "Devourer", "Scourge", "Queen",
  "Scout", "Corsair", "Carrier", "Arbiter",
]);
/** 종족별로 지상을 막는 건물 / 공중을 막는 건물. 터렛·스포어는 공중 전용이라 질럿이
 *  들이칠 때 "터렛 2개뿐이었다"고 말하면 틀린 말이 된다(지적) — 그럴 땐 벙커를 봐야 한다.
 *  포토는 지상·공중을 다 때리므로 양쪽에 들어간다. */
const GROUND_DEF: Record<string, string> = {
  테란: "Bunker", 저그: "Sunken Colony", 프로토스: "Photon Cannon",
};
const AIR_DEF: Record<string, string> = {
  테란: "Missile Turret", 저그: "Spore Colony", 프로토스: "Photon Cannon",
};

/** 상대 병력이 주로 하늘에 있었나 — 방어 건물 이야기를 지상 기준으로 할지 공중 기준으로
 *  할지 가른다. 어중간하면 지상으로 본다(대부분의 경기가 그렇다). */
function airThreat(foes: ParsedReplayPlayer[]): boolean {
  let air = 0;
  let ground = 0;
  for (const f of foes) {
    for (const [unit, n] of Object.entries(f.signals?.unitCounts ?? {})) {
      if (NON_COMBAT_UNITS.has(unit) || WORKER_UNITS.has(unit)) continue;
      const s = n * supplyOf(unit);
      if (AIR_UNITS.has(unit)) air += s; else ground += s;
    }
  }
  return air > ground;
}

/** 그 사람이 그 시점까지 지어 둔 방어 건물 — 무엇을 몇 개(요청: 무너질 때 방어 타워가
 *  모자랐는지도 봐서 특징이 있으면 넣기).
 *
 *  '무엇을'은 그 사람 종족이 쳐들어온 것을 막는 건물이다 — 질럿이 들이쳤는데 터렛 개수를
 *  세면 아무 뜻이 없다(지적). 그래서 상대 병력이 지상이면 벙커·성큰·포토를, 공중이면
 *  터렛·스포어·포토를 센다. 하나도 안 지었으면 n=0으로 돌려 "벙커 하나 없이"까지 말할 수
 *  있게 한다(요청).
 *
 *  리플레이에는 그게 그때까지 남아 있었는지도, 막아냈는지도 없다 — 지었다는 사실뿐이다.
 *  그래서 '충분했나'를 판정하지 않고 '몇 개를 지어 뒀나'까지만 돌려주고, 모자랐다는
 *  느낌은 그 수 자체가 말하게 둔다. 포토 러시로 간 캐논은 방어가 아니므로 세지 않는다. */
function defenseBefore(
  p: ParsedReplayPlayer, frame: number | null, foes: ParsedReplayPlayer[],
): { def: string; n: number; from: number | null } {
  const sg = p.signals;
  const key = (airThreat(foes) ? AIR_DEF : GROUND_DEF)[p.race ?? ""] ?? "";
  if (!sg || !key) return { def: "", n: 0, from: null };
  if (key === "Photon Cannon" && cannonIsRush(p)) return { def: key, n: 0, from: null };
  const cut = frame ?? Infinity;
  const frames = (sg.buildingFrames[key] ?? []).filter((f) => f <= cut);
  return {
    def: key,
    n: frames.length,
    // 첫 채를 올린 때 — 무너지기 직전에야 손을 댔는지 가리는 근거다(아래 PANIC_DEF_SEC).
    from: frames.length > 0 ? Math.min(...frames) : null,
  };
}

/** 방어 건물을 한꺼번에 여러 채 올린 첫 시점(요청) — "포토가 한두 개 있다"는 근거가 못
 *  되고, 여러 개를 늘린 그 시점을 봐야 한다는 지적에 따른다.
 *
 *  DEF_SURGE_WINDOW_SEC 안에 DEF_SURGE_MIN 채가 몰려 올라간 첫 구간을 찾아, 그 구간이
 *  시작된 프레임과 그 구간에 지은 수를 돌려준다. 창을 슬라이딩하는 이유는 '누적 3채'로
 *  세면 경기 내내 하나씩 늘린 사람까지 '증설'이 되기 때문이다.
 *
 *  포토 러시로 나간 캐논은 방어가 아니므로 제외한다(defenseBefore와 같은 기준). */
function defenseSurge(
  p: ParsedReplayPlayer, foes: ParsedReplayPlayer[],
): { def: string; at: number; n: number } | null {
  const sg = p.signals;
  const key = (airThreat(foes) ? AIR_DEF : GROUND_DEF)[p.race ?? ""] ?? "";
  if (!sg || !key) return null;
  if (key === "Photon Cannon" && cannonIsRush(p)) return null;
  const frames = [...(sg.buildingFrames[key] ?? [])].sort((a, b) => a - b);
  if (frames.length < DEF_SURGE_MIN) return null;
  const window = DEF_SURGE_WINDOW_SEC / SECONDS_PER_FRAME;
  for (let i = 0; i + DEF_SURGE_MIN - 1 < frames.length; i += 1) {
    const start = frames[i];
    if (frames[i + DEF_SURGE_MIN - 1] - start > window) continue;
    // 같은 창 안에 더 있으면 그것까지 한 묶음으로 센다 — "세 개"보다 실제 수가 낫다.
    let n = DEF_SURGE_MIN;
    while (i + n < frames.length && frames[i + n] - start <= window) n += 1;
    return { def: key, at: start, n };
  }
  return null;
}

/** 그 편에서 가장 많이 뽑은 '한 방' 유닛(없으면 undefined). */
function spectacleOf(side: Side): string | undefined {
  return [...side.combat.entries()]
    .filter(([u, n]) => SPECTACLE_UNITS[u] && n > 0)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** 한 편의 전황을 '줄'들로 만든다. 이긴 편/진 편 모두 같은 재료(주력 조합·확장·방어·테크·
 *  테크 전환 시점·먼저 끊긴 사람)를 쓰고, 진 편만 결말이 정해져 있어 "…했지만 …" 꼴로 맺는다.
 *
 *  모든 줄은 반드시 누가 한 일인지 이름을 달고 나온다(요청) — 예전엔 편 단위 사실을 주어
 *  없이 말해서("5멀티까지 늘린 운영") 여러 줄이 붙으면 누구 얘기인지 알 수 없었다. 편 전체의
 *  사실도 그 편에서 그걸 가장 많이 한 사람에게 붙여 이름을 만든다. */
// 잘한 사람의 그림을 2000년대 초반 프로게이머에 빗대 한 마디 붙인다(요청: 여자 선수를
// 우선으로). 확실히 확인할 수 있는 여자 선수는 서지수뿐이라 나머지 자리는 그 시절 그
// 스타일의 대명사였던 선수로 채웠다 — 이름을 바꾸고 싶으면 이 표만 고치면 된다.
//
// 고르는 기준은 '그 사람이 실제로 많이 뽑은 유닛'이다. 위에서부터 먼저 맞는 것을 쓴다.
// 그 유닛들을 이만큼(두 부대)은 뽑았어야 '그 선수의 그림'이라 부를 수 있다.
const PRO_LIKE_MIN = 24;
const PRO_LIKE: Record<string, { pro: string; style: string; units: string[] }[]> = {
  테란: [
    { pro: "서지수", style: "바이오닉 운영", units: ["Marine", "Medic", "Firebat"] },
    { pro: "임요환", style: "드랍십 견제", units: ["Dropship", "Wraith"] },
    { pro: "이윤열", style: "메카닉 물량", units: ["Siege Tank (Tank Mode)", "Vulture", "Goliath"] },
  ],
  저그: [
    { pro: "홍진호", style: "폭풍 저글링", units: ["Zergling"] },
    { pro: "박성준", style: "공격적인 저그", units: ["Hydralisk", "Mutalisk"] },
    { pro: "조용호", style: "운영형 목동 저그", units: ["Ultralisk", "Defiler", "Lurker"] },
  ],
  프로토스: [
    { pro: "강민", style: "아비터 운영", units: ["Arbiter", "High Templar", "Corsair"] },
    { pro: "김동수", style: "다크템플러 전략", units: ["Dark Templar", "Reaver"] },
    { pro: "박정석", style: "물량 프로토스", units: ["Zealot", "Dragoon"] },
  ],
};

function sideBeats(args: {
  side: Side;
  other: Side;
  players: ParsedReplayPlayer[];
  /** 이 편이 이겼나 — 같은 사실도 이긴 쪽이면 "굳힘", 진 쪽이면 "역부족"으로 맺는다. */
  won: boolean;
  sec: number;
  totalFrames: number | null;
  /** (진 편만) 초반 주도권을 잡았었나 — 커맨드 점유율 기준. */
  pressedEarly: boolean;
}): Beat[] {
  const { side, other, players, won, sec, totalFrames, pressedEarly } = args;
  const beats: Beat[] = [];
  if (players.length === 0) return beats;
  const who = (p: ParsedReplayPlayer) => [p.rawName];

  // ── 부활(요청) ── 크게 무너졌다가 다시 살림을 세운 사람. 무너진 것만 말하고 끝내면
  // 이야기의 절반만 말한 셈이라, 이건 따로 무겁게 친다.
  for (const p of players) {
    if (!p.signals) continue;
    // 끝내 못 일어선 사람은 부활이 아니다 — fellFrame이 그 사람의 마지막을 이미 말한다.
    if (eliminatedFrame(p) !== null) continue;
    const back = revivalFrame(p, totalFrames);
    if (back === null) continue;
    beats.push({ k: "revival", won, who: who(p), at: back, weight: 13 });
  }

  // ── 시야(요청) ── 오버로드·옵저버를 여기저기 뿌려 두면 그 자체가 전황을 읽는 플레이다.
  // 다만 오버로드는 인구수 때문에도 뽑히므로 수만으로는 근거가 못 된다 — 속업(뿌리려고
  // 하는 투자)까지 있어야 인정한다. 옵저버는 보통 한둘이라 수가 곧 의도다.
  for (const p of players) {
    const sg = p.signals;
    if (!sg) continue;
    const obs = sg.unitCounts["Observer"] ?? 0;
    const ovl = sg.unitCounts["Overlord"] ?? 0;
    const spread = sg.upgradeNames.includes("Pneumatized Carapace");
    const unit = obs >= 4 ? "Observer" : spread && ovl >= 8 ? "Overlord" : null;
    if (!unit) continue;
    beats.push({
      k: "vision", won, who: who(p), weight: 6,
      at: sg.firstUnitFrame[unit] ?? null,
      p: { unit },
    });
  }

  // ── 안 보이는 유닛에 대한 대비(요청) ── 상대가 러커·다크를 뽑았는데 이쪽에 탐지 수단이
  // 하나도 없었다면, 그건 왜 밀렸는지의 큰 부분이다. 저그는 오버로드가 곧 탐지기라 뺀다.
  // 탐지 여부는 '탐지기를 만들었나'가 아니라 '만들 건물조차 없었나'로 본다 — 스캔은
  // 커맨드에 남지 않아서, 아카데미·옵저버토리가 없으면 확실히 없었다고 말할 수 있다.
  if (!won) {
    const lurker = other.combat.get("Lurker") ?? 0;
    const dt = other.combat.get("Dark Templar") ?? 0;
    if (lurker + dt >= 2) {
      for (const p of players) {
        const sg = p.signals;
        if (!sg || p.race === "저그") continue;
        const has = p.race === "테란"
          ? (sg.buildingCounts["Academy"] ?? 0) + (sg.unitCounts["Science Vessel"] ?? 0)
            + (sg.buildingCounts["Missile Turret"] ?? 0)
          : (sg.unitCounts["Observer"] ?? 0) + (sg.buildingCounts["Observatory"] ?? 0)
            + (sg.buildingCounts["Photon Cannon"] ?? 0);
        if (has > 0) continue;
        beats.push({
          k: "no-detect", won, who: who(p), at: null, weight: 9,
          p: { unit: lurker >= dt ? "Lurker" : "Dark Templar", race: p.race },
        });
        break; // 한 명만 말한다
      }
    }
  }

  // ── 잘한 사람의 그림을 옛 프로게이머에 빗대기(요청) ──
  // 진 편까지 빗대면 한 요약에 비유가 두 번 나와 겉돈다 — 이긴 편의 잘한 사람만 말한다.
  if (won) {
    const star = standout(side);
    if (star && star.race) {
      const own = ownCombat(star);
      const units = nameableUnits(mainUnits(own, armyBySupply([star])));
      const table = PRO_LIKE[star.race] ?? [];
      // 그 그림이라 부를 만큼 실제로 뽑았을 때만 빗댄다 — 두어 기 나온 유닛까지 세면
      // 거의 모든 경기에 비유가 붙어 특별할 게 없어진다.
      const hit = table.find((row) =>
        units.some((u) => row.units.includes(u))
        && row.units.reduce((n, u) => n + (own.get(u) ?? 0), 0) >= PRO_LIKE_MIN);
      if (hit) {
        // 1:1이면 누구를 상대로 그랬는지까지 말할 수 있다(요청 예시) — 팀전은 상대가
        // 여럿이라 지목하지 않는다.
        const foe = other.players.length === 1 ? other.players[0].rawName : null;
        beats.push({
          k: "pro-like", won, at: null, weight: 7,
          who: [star.rawName], ...(foe ? { whom: [foe] } : {}),
          p: { pro: hit.pro, style: hit.style },
        });
      }
    }
  }

  // ── 진 편의 맺음 문장: 무엇으로 맞섰고 왜 안 됐나 ──
  // 이건 한 순간에 벌어진 사건이 아니라 그 편 이야기의 결말이다. 그래서 시점을 두지 않고
  // (at: null) 늘 맨 뒤, 맺음말 바로 앞에 놓는다 — 아래 고르기에서 따로 챙긴다.
  //
  // 한때는 '대표 유닛을 가장 크게 몰아 뽑은 때'를 시점으로 삼았는데, 그 대표 유닛이 질럿·
  // 마린 같은 초반 물량이면 몰아 뽑은 구간도 앞쪽이라 "역부족" 같은 결론이 요약 맨 앞으로
  // 튀어 올랐다(지적: "패배팀의 결론이 맨 처음에 나온다"). 결말은 시간축 위의 점이 아니다.
  if (!won) {
    const star = standout(side);
    const units = nameableUnits(
      star
        ? mainUnits(ownCombat(star), armyBySupply([star]))
        : mainUnits(side.combat, armyBySupply(players))
    );
    const spectacle = spectacleOf(side);
    let p: Record<string, string | number | boolean | string[]> | null = null;
    // 고급 유닛 이야기는 그걸 실제로 뽑은 사람의 몫이다 — 팀 전체를 주어로 세우면
    // "A·B·C·D는 배틀크루저까지 꺼냈지만"처럼 주어가 흐릿해진다(지적).
    let owner: ParsedReplayPlayer | null = star;
    // 몇 기까지 뽑았는지도 함께 — "캐리어를 한 부대 뽑았으나 망함"처럼 규모가 곧 그림이다(요청).
    if (spectacle) {
      p = { mode: "spectacle", unit: spectacle, n: side.combat.get(spectacle) ?? 0 };
      owner = players
        .map((x) => ({ x, n: x.signals?.unitCounts[spectacle] ?? 0 }))
        .sort((a, b) => b.n - a.n)[0]?.x ?? star;
    } else if (pressedEarly && units.length > 0) p = { mode: "pressed", units };
    else if (units.length > 0) {
      p = { mode: units.some((u) => LATE_TECH_UNITS.has(u)) ? "late" : "plain", units };
    } else if (sec > 0 && sec < EARLY_GAME_SEC) {
      p = { mode: "nothing" };
    }
    if (p) {
      beats.push({
        // 팀전이면 혼자 버틴 게 아니다 — 문장도 "팀원이 도와줬으나"로 갈린다(요청).
        // 진 편이 무엇으로 맞섰나는 결과 문장의 짝이다 — 자리가 모자랄 때 부수적인
        // 사실(센터 건물 등)에 밀려 통째로 빠지면, 이긴 쪽 조합만 남아 경기가 한쪽
        // 이야기가 된다(실제로 골리앗 77기를 뽑은 편의 조합이 계속 안 나왔다).
        k: "stand", won, at: null, weight: 16,
        p: { ...p, team: players.length > 1 },
        who: owner ? who(owner) : players.map((x) => x.rawName),
      });
    }
  }

  // ── 유닛 + 방어 건물로 막아선 그림(요청: "질럿과 성큰으로 방어했지만 실패") ──
  for (const p of players) {
    const sg = p.signals;
    if (!sg) continue;
    const usable = Object.entries(sg.buildingCounts)
      .filter(([k]) => DEFENSE_KO[k])
      .filter(([k]) => !(k === "Photon Cannon" && cannonIsRush(p)));
    const def = usable.filter(([, n]) => n >= DEFENSE_MIN).sort((a, b) => b[1] - a[1])[0];
    if (!def) continue;
    const unit = [...ownCombat(p).entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!unit) continue;
    // 방어 건물 총합이 일정 수준을 넘으면 '막을 준비'가 아니라 웅크린 것이라, 그 자체가
    // 이야깃거리다(요청) — 문장에 개수를 싣고 무게도 올린다.
    const total = usable.reduce((acc, [, n]) => acc + n, 0);
    beats.push({
      k: "defense", won, who: who(p), weight: total >= TURTLE_MIN ? 10 : 7,
      at: sg.firstBuildingFrame[def[0]] ?? null,
      p: { unit, def: def[0], n: def[1], total },
      // 입구 방어(front-defense)가 이미 같은 건물을 말했으면 두 번 말하지 않는다.
      dedupeOn: DEFENSE_KO[def[0]],
    });
  }

  // ── 확장 운영 — 두 편 차이가 뚜렷할 때, 그 편에서 제일 많이 늘린 사람 이름으로 ──
  const sideExp = countIn(side.buildings, EXPANSION_BUILDINGS);
  const otherExp = countIn(other.buildings, EXPANSION_BUILDINGS);
  if (sideExp >= otherExp + 2 && sideExp >= 3) {
    const top = players
      .map((p) => ({ p, n: buildingsOf(p, EXPANSION_BUILDINGS) }))
      .sort((a, b) => b.n - a.n)[0];
    if (top && top.n >= 2) {
      // 그 사람이 실제로 올린 확장 건물 이름을 그대로 쓴다 — 저그면 해처리, 프로면 넥서스.
      const kind = Object.entries(top.p.signals?.buildingCounts ?? {})
        .filter(([k]) => EXPANSION_KO[k])
        .sort((a, b) => b[1] - a[1])[0]?.[0];
      if (kind) {
        const frames = buildFramesOf(top.p, EXPANSION_BUILDINGS);
        // 확장을 몇 개까지 늘렸나에 더해 그걸로 무엇을 뽑았나까지 말한다(요청) —
        // 확장은 그 자체가 목적이 아니라 생산량으로 이어지는 수다.
        const unit = [...ownCombat(top.p).entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        beats.push({
          k: "expand", won, who: who(top.p), weight: 8,
          at: frames[2] ?? frames[frames.length - 1] ?? null,
          p: { n: top.n, kind, ...(unit ? { unit } : {}) },
        });
      }
    }
  }

  // ── 테크 — 싸움을 뒤집는 것만. 사람마다 하나씩. ──
  for (const p of players) {
    const sg = p.signals;
    if (!sg) continue;
    const t = sg.techNames.find((x) => DECISIVE_TECHS.has(x));
    if (!t) continue;
    beats.push({
      k: "tech", won, who: who(p), weight: 6,
      at: sg.firstTechFrame[t] ?? null,
      p: { tech: t },
    });
  }

  // ── 일꾼을 거의 안 뽑고 병력만 짜낸 올인 — 그 편에서 가장 극단적인 사람 이름으로 ──
  const combatTotal = [...side.combat.values()].reduce((a, b) => a + b, 0);
  if (side.workers > 0 && combatTotal > side.workers * 4 && sec < LATE_GAME_SEC) {
    const top = players
      .map((p) => {
        const sg = p.signals;
        const w = sg ? Object.entries(sg.unitCounts).filter(([k]) => WORKER_UNITS.has(k))
          .reduce((acc, [, n]) => acc + n, 0) : 0;
        return { p, ratio: w > 0 ? sumCombat(p) / w : sumCombat(p) };
      })
      .sort((a, b) => b.ratio - a.ratio)[0];
    if (top) {
      beats.push({ k: "allin", won, who: who(top.p), at: null, weight: 6 });
    }
  }

  // ── 중반부터 끝까지 끌고 간 유닛 ──
  // 한 유닛을 오래도록 계속 뽑았다는 건 그걸로 경기를 끌고 갔다는 뜻이다(요청). 그 유닛이
  // 맺음말이나 진 편 문장에 또 나와도 괜찮다 — 중반부터 후반까지 운용한 그림이면 두 번
  // 나오는 게 맞다. 다만 말하는 건 '언제부터 언제까지 계속 뽑았나'까지다: 살아남았는지는
  // 리플레이에 없다.
  for (const p of players) {
    const sg = p.signals;
    if (!sg || !totalFrames) continue;
    const supply = sumSupply(p);
    if (supply <= 0) continue;
    let best: { unit: string; from: number; to: number; n: number } | null = null;
    for (const [unit, n] of ownCombat(p)) {
      if (n < LONG_RUN_MIN_N || !UNIT_KO[unit]) continue;
      if ((n * supplyOf(unit)) / supply < LONG_RUN_SHARE) continue;
      const fs = sg.unitFrames[unit] ?? [];
      if (fs.length < 2) continue;
      const from = Math.min(...fs);
      const to = Math.max(...fs);
      if ((to - from) * SECONDS_PER_FRAME < LONG_RUN_MIN_SEC) continue;
      if (from / totalFrames < LONG_RUN_START) continue;
      if (to / totalFrames < LONG_RUN_END) continue;
      if (!best || to - from > best.to - best.from) best = { unit, from, to, n };
    }
    if (best) {
      beats.push({
        // 전술 비트들이 tacticBeats에서 +10을 받으므로 그 사이에서 겨룰 만한 무게로 둔다 —
        // 13으로 뒀더니 45분짜리 경기에서 늘 밀려 한 번도 안 나왔다.
        k: "long-run", won, who: who(p), at: best.from, weight: 20,
        p: {
          unit: best.unit, n: best.n,
          from: minutes(best.from * SECONDS_PER_FRAME),
          to: minutes(best.to * SECONDS_PER_FRAME),
        },
      });
    }
  }

  // ── 경제·규모 격차 — 승부의 밑바탕을 말해준다(요청). 편 단위 사실이라 그 편 전원의
  // 이름으로 말한다. 커맨드로 센 '뽑은 수'지 '살아남은 수'가 아니라는 한계는 그대로다.
  const everyone = players.map((p) => p.rawName);
  // 밀린 쪽에서만 말한다 — 양쪽이 다 말하면 같은 사실이 두 문장으로 나온다.
  if (side.workers >= 12 && other.workers >= side.workers * WORKER_GAP_RATIO) {
    beats.push({
      k: "worker-gap", won, who: everyone, at: null, weight: 8,
      p: { n: side.workers, foe: other.workers },
    });
  }
  // 생산 건물 규모 — 그 편이 가장 많이 늘린 종류 하나로 견준다.
  const prodTop = [...side.buildings.entries()]
    .filter(([k]) => PRODUCTION_KO[k])
    .sort((a, b) => b[1] - a[1])[0];
  // 생산 건물은 서너 채로 "생산량 자체가 달랐다"고 하기엔 약하다(지적) — 규모도 격차도 올렸다.
  if (prodTop && prodTop[1] >= 5) {
    const foeSame = other.buildings.get(prodTop[0]) ?? 0;
    const foeTop = Math.max(
      foeSame,
      ...[...other.buildings.entries()].filter(([k]) => PRODUCTION_KO[k]).map(([, n]) => n),
      0,
    );
    // 상대도 생산 건물을 세고 있어야 견줄 수 있다 — 종족이 달라 종류가 아예 없으면
    // "0개에 머문 상대"가 되어 사실과 다르게 읽힌다.
    if (foeTop >= 2 && (prodTop[1] >= foeTop + 4 || foeTop >= prodTop[1] + 4)) {
      beats.push({
        k: "prod-gap", won, who: everyone, at: null, weight: 6,
        dedupeOn: PRODUCTION_KO[prodTop[0]],
        p: { kind: prodTop[0], n: prodTop[1], foe: foeTop },
      });
    }
  }
  // 건물을 띄운 사람(테란) — 자리를 다 내줬다는 뜻이라 그 자체가 전황이다(요청).
  for (const p of players) {
    const n = p.signals?.liftOffCount ?? 0;
    if (n < LIFT_OFF_MIN) continue;
    beats.push({
      k: "lift-off", won, who: [p.rawName], weight: 9,
      at: p.signals?.firstLiftOffFrame ?? null,
      p: { n },
    });
  }

  // ── 한 대 맞은 무렵의 방어 증설(요청) ── 러시에 생산이 끊길 만큼 맞았는데 포토·성큰·
  // 벙커를 한꺼번에 올린 대목이 요약에 아예 안 나온다는 지적.
  //
  // 증설과 '생산이 꺾인 순간'이 어느 쪽이 먼저냐는 둘 다 있다(지적): 맞고 나서야 올리기도
  // 하지만, 오는 걸 보고 먼저 짓는 쪽이 오히려 흔하다. 그래서 앞뒤를 가리지 않고 증설에
  // 가장 가까운 타격을 짝지어, 어느 쪽이 먼저였는지만 문장에 남긴다(warned).
  // 창을 앞뒤로 다르게 잡는 이유는 위 상수 주석 참고.
  for (const p of players) {
    const surge = defenseSurge(p, other.players);
    if (!surge) continue;
    const react = DEF_SURGE_REACT_SEC / SECONDS_PER_FRAME;
    const warn = DEF_SURGE_WARN_SEC / SECONDS_PER_FRAME;
    const near = productionDips(p, totalFrames)
      // 음수 = 맞고 나서 지었다, 양수 = 짓기 시작한 뒤에 생산이 끊겼다.
      .map((d) => ({ at: d, gap: d - surge.at }))
      .filter((x) => x.gap >= -react && x.gap <= warn)
      .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))[0];
    if (!near) continue;
    beats.push({
      k: "late-defense", won, who: who(p), at: surge.at, weight: 15,
      p: {
        def: surge.def, n: surge.n,
        min: minutes(surge.at * SECONDS_PER_FRAME),
        hitMin: minutes(near.at * SECONDS_PER_FRAME),
        ...(near.gap >= 0 ? { warned: true } : {}),
      },
    });
  }

  // ── 먼저 끊긴 사람(요청: 일찍 죽은 사람) — 끊긴 시점이 곧 그 줄의 시각이다 ──
  for (const p of earlyOuts(players, totalFrames)) {
    // 이긴 편에는 짐작으로 붙이지 않는다 — earlyOuts의 근거는 '생산이 꺾였다'인데,
    // 이긴 쪽이 생산을 멈추는 건 무너져서가 아니라 이미 갖춘 병력으로 끝냈기 때문이다
    // (캐리어를 모아 놓고 더 안 뽑는 경기가 정확히 이렇다). 그래서 "일찍 무너졌다"가
    // 승자에게 붙는 우스운 문장이 나왔다. 리플레이에 탈락이 그대로 적혀 있으면(팀전에서
    // 팀원 하나가 실제로 지워진 경우) 그건 사실이므로 이긴 편이라도 말한다.
    if (won && eliminatedFrame(p) === null) continue;
    const fell = fellFrame(p, totalFrames);
    // 무너질 때 방어 건물이 어땠는지도 함께(요청) — "포토 2개뿐인 채로 지워짐"처럼
    // 그 수 자체가 그림이 된다. 막아냈는지는 리플레이에 없으니 지어 둔 데까지만 싣는다.
    const guard = defenseBefore(p, fell, other.players);
    // 방어 건물에 손을 댄 게 무너지기 직전이었나(요청: 멸망·큰 타격 직전에 지었으면
    // "부랴부랴 지었지만 늦었다"). 첫 채가 언제였는지로 본다 — 진작부터 지어 둔 사람은
    // 첫 채가 한참 앞이라 여기 안 걸린다.
    const panic = guard.n > 0 && fell !== null && guard.from !== null
      && (fell - guard.from) * SECONDS_PER_FRAME <= PANIC_DEF_SEC;
    beats.push({
      k: "fallen", won, who: who(p), weight: 9,
      at: fell,
      // 리플레이에 탈락이 그대로 적혀 있으면 짐작이 아니라 사실로 말한다(요청).
      p: {
        team: players.length > 1, def: guard.def, defN: guard.n,
        ...(panic ? { panic: true } : {}),
        ...(eliminatedFrame(p) !== null ? { out: true } : {}),
      },
    });
  }

  return beats;
}

/**
 * 경기 요약. 재료가 모자라면(커맨드 스트림 없음/승자 미확정/유닛 이름 못 읽음) null.
 * 돌려주는 건 문장이 아니라 저장할 데이터다 — 문장은 renderReplaySummary가 만든다.
 */
export function buildReplaySummary(replay: ParsedReplay): ReplaySummaryData | null {
  if (!replay.winnerSide) return null;
  const sec = replay.durationSeconds ?? 0;
  const totalFrames = sec > 0 ? Math.round(sec / SECONDS_PER_FRAME) : null;

  const winnerPlayers = replay.winnerSide === "team1" ? replay.team1 : replay.team2;
  const loserPlayers = replay.winnerSide === "team1" ? replay.team2 : replay.team1;
  if (winnerPlayers.length === 0) return null;
  /** 일대일인가 — '상대'가 한 사람뿐일 때만 쓸 수 있는 표현들이 있다(지적). */
  const duel = winnerPlayers.length === 1 && loserPlayers.length === 1;

  const winner = buildSide(winnerPlayers);
  const loser = buildSide(loserPlayers);

  // 눈에 띄는 사람이 있으면 그 사람을 주어로 세우고 조합도 '그 사람의 것'으로 말한다
  // (요청: 팀전이라도 잘한 사람 얘기를 많이). 없으면 편 전체로 말한다.
  const star = standout(winner);
  const units = nameableUnits(
    star
      ? mainUnits(ownCombat(star), armyBySupply([star]))
      : mainUnits(winner.combat, armyBySupply(winnerPlayers))
  );
  if (units.length === 0) return null; // 조합을 못 읽으면 이야기의 알맹이가 없다
  const subject = star ? [star.rawName] : winnerPlayers.map((p) => p.rawName);

  // ── 국면과 흐름 ──
  const wentLate = units.some((u) => LATE_TECH_UNITS.has(u)) || sec >= LATE_GAME_SEC;
  const wasRush = sec > 0 && sec < EARLY_GAME_SEC && units.every((u) => EARLY_RUSH_UNITS.has(u));
  const earlyTotal = winner.thirds[0] + loser.thirds[0];
  const lateTotal = winner.thirds[2] + loser.thirds[2];
  const earlyShare = earlyTotal > 0 ? winner.thirds[0] / earlyTotal : null;
  const lateShare = lateTotal > 0 ? winner.thirds[2] / lateTotal : null;
  const pressedEarly = earlyShare !== null && earlyTotal >= 40 && earlyShare < 0.42;
  const comeback = pressedEarly && lateShare !== null && lateTotal >= 40 && lateShare > 0.55;
  // 전반과 후반의 전황이 아예 뒤바뀐 경기는 그 자체가 이야기다(요청: 역전승을 강조).
  const bigSwing =
    comeback && earlyShare !== null && lateShare !== null
    && earlyShare < 0.35 && lateShare > 0.62;
  // 처음부터 끝까지 한쪽이 판을 쥐고 있던 경기(요청: 경기력 차이가 심하면 요약은 짧게,
  // 결론에서 일방적이었다고 말하기). 전·후반 손놀림 점유가 둘 다 확실히 기울었을 때만
  // 그렇게 부른다 — 한 구간만 보면 그냥 한 번 몰아친 경기와 구별이 안 된다.
  const oneSided =
    earlyShare !== null && lateShare !== null && earlyTotal >= 40 && lateTotal >= 40
    && earlyShare > 0.62 && lateShare > 0.62;

  // ── 맺음말 머리 — 드문 사건이 있으면 그걸 앞세운다(경기마다 다른 문장이 나오도록).
  // 주력으로 이미 말할 유닛은 여기서 뺀다 — 안 그러면 "캐리어가 뜬 …캐리어로 승리"가 된다.
  const spectacle = [...winner.combat.keys()].find(
    (u) => SPECTACLE_UNITS[u] && (winner.combat.get(u) ?? 0) > 0 && !units.includes(u)
  );
  const lead =
    sec >= EPIC_GAME_SEC ? "epic" : spectacle ? "spectacle" : wasRush && sec > 0 ? "rush" : "";
  const mode = wasRush ? "rush" : comeback ? "comeback" : wentLate && !lead ? "late" : "plain";

  // 팀전이면 그 사람의 활약을 맺음말에 한 마디 덧붙인다(요청) — 1:1은 이미 맺음말이 그 사람
  // 얘기라 뺀다.
  const heroUnit =
    star && winnerPlayers.length > 1 ? heroUnitOf(winner, star, units) : null;

  // 팀 전체로 말하더라도, 한 사람의 생산이 압도적이었다면 그 공은 따로 적는다(요청).
  // standout(1.4배)보다 훨씬 엄하게 본다 — '조금 더 뽑았다'와 '혼자 다 뽑았다'는 다르다.
  const dominant = (() => {
    if (winnerPlayers.length < 2) return null;
    const ranked = winnerPlayers
      .map((p) => ({ p, n: sumSupply(p) }))
      .sort((a, b) => b.n - a.n);
    if (ranked.length < 2 || ranked[0].n <= 0) return null;
    return ranked[0].n >= ranked[1].n * 2 ? ranked[0].p : null;
  })();
  const domUnit = dominant ? heroUnitOf(winner, dominant, units) : null;

  // ── 문장 수 ──
  // 한 문단짜리 이야기라 길면 읽히지 않는다. 짧은 경기는 두어 문장, 길이에 따라 다섯까지
  // 3분→2문장에서 5분마다 하나씩 늘린다(요청). 다만 할 얘기가 많은 경기는 더 써도 된다
  // (요청) — 아래에서 무거운 사실 수를 보고 일곱까지 늘린다.
  const baseBudget = Math.max(2, Math.min(sec >= LONG_GAME_SEC ? 7 : 5, 2 + Math.floor((sec - 3 * 60) / (5 * 60))));
  // 자리가 남아도 아무거나 채우지 않는다(요청: 승부에 중요한 이벤트만) — 이 무게 아래는
  // "그래서 뭐" 소리가 나오는 사실들이라, 문단을 짧게 끝내는 편이 낫다.
  const MIN_WEIGHT = 6;

  // 전술(9드론 저글링 러시·몰래 배럭·목동 저그…)은 그 경기에서만 있었던 일이라 가장 무겁게
  // 친다 — 자리가 모자라면 일반적인 이야기부터 버려진다.
  // 러시·드랍을 간 그 타이밍에 상대 쪽 누군가의 생산이 뚝 끊겼다면, 그건 그 수가 통했다는
  // 뜻이다(요청) — "3게이트 질럿 러시로 조조의 본진을 파괴함"처럼 한 문장으로 잇는다.
  // 대상이 이미 확실한 전술(자리로 짚은 것)은 그 사람만 보고, 아니면 상대 전원을 훑는다.
  const damageFrom = (t: { key: string; at: number | null; whom?: string }, foes: ParsedReplayPlayer[]) => {
    if (t.at === null || !RAID_KEYS.has(t.key)) return null;
    const window = t.at + DAMAGE_WINDOW_SEC / SECONDS_PER_FRAME;
    // 탈락은 창을 더 좁게 본다(지적: 상관도가 높은 것만 인과로 묶기) — 어떤 수를 간 지
    // 3분 뒤의 탈락까지 그 수의 결과라 부르면, 사실은 상관없는 일을 엮게 된다. 곧바로
    // 이어진 탈락만 그 수 때문이라고 말한다.
    const outWindow = t.at + ELIM_WINDOW_SEC / SECONDS_PER_FRAME;
    const targets = t.whom ? foes.filter((p) => p.rawName === t.whom) : foes;
    let best: { raw: string; at: number; out: boolean } | null = null;
    for (const p of targets) {
      // 그 창 안에 실제로 탈락했으면 그게 가장 확실한 결과다 — 생산 급감보다 앞세운다.
      const gone = eliminatedFrame(p);
      if (gone !== null && gone >= t.at && gone <= outWindow) {
        if (!best || !best.out || gone < best.at) best = { raw: p.rawName, at: gone, out: true };
        continue;
      }
      for (const d of productionDips(p, totalFrames)) {
        if (d < t.at || d > window) continue;
        if (!best || (!best.out && d < best.at)) best = { raw: p.rawName, at: d, out: false };
      }
    }
    return best;
  };

  // 발키리를 띄운 뒤 상대 오버로드 생산이 치솟았다면 그건 오버로드가 잡히고 있었다는
  // 뜻이다(요청) — 죽지 않으면 다시 뽑을 일이 없다. 뽑은 '수'가 아니라 '속도'로 견준다.
  const rebuiltAfter = (
    from: number, foes: ParsedReplayPlayer[], units: string[], minCount: number, ratio: number,
  ): string | null => {
    if (!totalFrames || from >= totalFrames) return null;
    for (const z of foes) {
      const frames = units.flatMap((u) => z.signals?.unitFrames[u] ?? []);
      if (frames.length === 0) continue;
      const afterFrames = frames.filter((x) => x >= from);
      const after = afterFrames.length;
      if (after < minCount) continue;
      const before = frames.filter((x) => x < from).length;
      const beforeRate = before / Math.max(1, from);
      // 맞자마자 바로 못 뽑는 일이 흔하다 — 돈이 없어서다(지적). 그 죽은 시간까지 분모에
      // 넣으면, 실제로는 허겁지겁 채워 넣은 경기도 '안 뽑았다'로 읽힌다. 다시 뽑기
      // 시작한 시점부터 속도를 잰다.
      const resume = Math.min(...afterFrames);
      const afterRate = after / Math.max(1, totalFrames - resume);
      if (afterRate >= beforeRate * ratio) return z.rawName;
    }
    return null;
  };
  const overlordHunted = (from: number, foes: ParsedReplayPlayer[]) =>
    rebuiltAfter(from, foes, ["Overlord"], OVERLORD_REBUILD_MIN, OVERLORD_SURGE_RATIO);
  // 드랍·뮤탈 뒤에 상대가 일꾼을 다시 잔뜩 뽑았다면 그 일꾼들이 잡히고 있었다는 뜻이다(요청).
  const workersHunted = (from: number, foes: ParsedReplayPlayer[]) =>
    rebuiltAfter(from, foes, [...WORKER_UNITS], WORKER_REBUILD_MIN, WORKER_SURGE_RATIO);

  // 초반 올인을 갔는데 정작 제 생산이 무너졌다면, 그건 막히고 역으로 당한 것이다(요청).
  // 진 경기에서만 본다 — 이긴 쪽의 등락까지 '역풍'이라 부르면 말이 안 된다.
  const backfired = (t: { key: string; at: number | null }, self: ParsedReplayPlayer | undefined) => {
    if (!self || t.at === null || !BACKFIRE_KEYS.has(t.key)) return false;
    const window = t.at + BACKFIRE_SEC / SECONDS_PER_FRAME;
    const gone = eliminatedFrame(self);
    if (gone !== null && gone >= t.at && gone <= window) return true;
    return productionDips(self, totalFrames).some((d) => d >= t.at! && d <= window);
  };

  const tacticBeats = (won: boolean): Beat[] => {
    const foes = won ? loserPlayers : winnerPlayers;
    const mine = won ? winnerPlayers : loserPlayers;
    return scanTactics({ sidePlayers: mine, foePlayers: foes })
      // GG는 진 편이 쳤을 때만 항복이다. 이긴 쪽도 마무리로 같이 치는 게 관례라, 채팅만
      // 보고 붙이면 "Sohee_Min이 GG 치고 나갔지만 결국 Sohee_Min이 이겼다"가 나온다
      // (실제 리플레이에서 이긴 사람이 끝나기 2초 전에 'ㅈㅈ'를 쳤다).
      .filter((t) => !(won && t.key === "gg"))
      .map((t) => {
        // 그 수가 실제로 상대에게 통했는지를 먼저 본다(지적: "파뱃 러시도 성공했는데
        // 실패했다고 나오고"). 예전엔 역풍 판정이 앞서 있어서, 러시가 상대 생산을 끊었어도
        // 러시를 간 쪽이 진 경기면 제 생산 등락만 보고 "실패함"으로 뒤집혔다. 상대가 실제로
        // 맞았다면 그건 성공한 수이고, 그 뒤에 졌다는 건 결과 문장이 따로 말한다.
        const hit = damageFrom(t, foes);
        if (!won && !hit && backfired(t, mine.find((p) => p.rawName === t.who))) {
          return {
            k: "rush-backfire", won, who: [t.who], at: t.at,
            // "그 사이 상대만 테크를 탐" 같은 말은 상대가 하나뿐일 때만 성립한다(지적) —
            // 팀전에서는 누구를 가리키는지가 흐려지므로 일대일에서만 쓰게 표시해 둔다.
            weight: t.weight + 12, p: { ...(t.p ?? {}), k: t.key, ...(duel ? { duel: true } : {}) },
          } as Beat;
        }
        if (t.at !== null && HARASS_KEYS.has(t.key)) {
          const prey = workersHunted(t.at, foes);
          if (prey) {
            // 한 번 크게 맞은 것과 내내 시달린 것은 다른 이야기다(요청) — 일꾼을 몰아 뽑은
            // 구간이 길게 이어졌으면 '끈질긴 견제'로 말한다.
            const victim = foes.find((f) => f.rawName === prey);
            const span = victim ? surgeSpanMin(victim, [...WORKER_UNITS], totalFrames) : null;
            const long = !!span && span.to - span.from >= HARASS_LONG_MIN;
            return {
              k: long ? "harass-long" : "harass-workers", won, who: [t.who], whom: [prey],
              at: t.at, weight: t.weight + (long ? 16 : 14),
              p: { k: t.key, ...(long && span ? { min: span.to - span.from } : {}) },
            } as Beat;
          }
        }
        if (t.key === "valkyrie" && t.at !== null) {
          const prey = overlordHunted(t.at, foes);
          if (prey) {
            return {
              k: "valk-hunt", won, who: [t.who], whom: [prey], at: t.at, weight: t.weight + 14,
            } as Beat;
          }
        }
        if (hit) {
          // 당한 사람이 그때 방어 건물을 몇 채나 갖고 있었나(지적: 포토를 안 지었다가
          // 당했는데 그 내용이 안 나온다). 기준 시점은 '수가 시작된 때'다 — 얻어맞고
          // 부랴부랴 올린 것까지 세면 "포토 10개를 두고도 당했다"가 되어 사실과 반대로
          // 읽힌다(실제 리플레이에서 그랬다: 5분 40초에 11채를 몰아 짓고 6분에 끊김).
          // 얇았을 때만 싣는다 — 갖출 만큼 갖췄는데 뚫린 건 돌파 문장이 할 얘기다.
          const victim = foes.find((x) => x.rawName === hit.raw);
          const guard = victim && t.at !== null && t.at * SECONDS_PER_FRAME >= DEF_THIN_MIN_SEC
            ? defenseBefore(victim, t.at, mine)
            : null;
          // 지은 채수는 있는데 언제 지었는지가 없는 데이터(건물 프레임을 못 읽은 파싱)에서는
          // "하나 없었다"고 단정하지 않는다 — 없는 게 아니라 모르는 것이다.
          const known = !guard || !guard.def
            || (victim?.signals?.buildingCounts[guard.def] ?? 0) === 0
            || (victim?.signals?.buildingFrames[guard.def]?.length ?? 0) > 0;
          const thin = known && guard && guard.def && guard.n <= DEF_THIN_MAX ? guard : null;
          return {
            k: "raid-damage", won, who: [t.who], at: t.at,
            weight: t.weight + (hit.out ? 16 : 14),
            whom: [hit.raw],
            p: {
              ...(t.p ?? {}), k: t.key,
              ...(thin ? { vdef: thin.def, vdefN: thin.n } : {}),
              // 탈락은 몇 분경이었는지까지 말한다(요청) — 서사의 시점이 되는 순간이다.
              ...(hit.out ? { out: true, outMin: minutes(hit.at * SECONDS_PER_FRAME) } : {}),
              // 초반 올인에 초반부터 무너진 건 그 자체로 다른 그림이다(요청).
              ...(BACKFIRE_KEYS.has(t.key) && hit.at * SECONDS_PER_FRAME < GANG_RUSH_SEC
                ? { early: true, hitMin: minutes(hit.at * SECONDS_PER_FRAME) }
                : {}),
            },
          } as Beat;
        }
        return {
          k: t.key, won, who: [t.who], at: t.at, p: t.p, weight: t.weight + 10,
          ...(t.whom ? { whom: [t.whom] } : {}),
          ...(t.who2 ? { who2: [t.who2] } : {}),
        } as Beat;
      });
  };

  // "유비의 바이오닉 한 방으로 관우의 저글링 성큰을 뚫음" — 이긴 편의 주력이 진 편의 누구를
  // 어떻게 뚫었는지 한 문장에 담는다(요청). 양쪽을 따로 말하는 것보다 훨씬 경기처럼 읽힌다.
  const breached = (() => {
    for (const p of loserPlayers) {
      const sg = p.signals;
      if (!sg) continue;
      // "질럿으로 터렛을 뚫었다"는 말이 안 된다(지적) — 터렛·스포어는 공중 전용이다.
      // 들이친 병력이 지상이면 벙커·성큰·포토만, 공중이면 터렛·스포어·포토만 본다.
      const wallKey = (airThreat(winnerPlayers) ? AIR_DEF : GROUND_DEF)[p.race ?? ""] ?? "";
      const def = Object.entries(sg.buildingCounts)
        .filter(([k, n]) => k === wallKey && n >= DEFENSE_MIN)
        .filter(([k]) => !(k === "Photon Cannon" && cannonIsRush(p)))[0];
      if (!def) continue;
      const unit = [...ownCombat(p).entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!unit) continue;
      return {
        k: "breakthrough", won: true, who: subject, whom: [p.rawName], weight: 14,
        at: sg.firstBuildingFrame[def[0]] ?? null,
        p: { units, unit, def: def[0], n: def[1] },
      } as Beat;
    }
    return null;
  })();

  const tactics = mergeDuelRush(mergeRaids(mergeGg(
    [...tacticBeats(true), ...tacticBeats(false)],
    (won) => (won ? winnerPlayers.length : loserPlayers.length),
  )));
  // 탱크 방어 문장이 "조조를 밀어냄"까지 말했으면 "조조가 먼저 정리됨"을 또 붙이지 않는다.
  // 여기서만 이름으로 거른다 — 렌더된 문장을 훑는 일반 dedupe는 이름이 우연히 겹치는
  // 다른 문장까지 지워버린다.
  const pickedOff = new Set(
    tactics
      // 탈락을 이미 이름으로 말한 문장이 있으면 "먼저 지워짐"을 또 붙이지 않는다.
      // 들이친 수가 이미 그 사람의 몰락을 말했으면 "먼저 정리됨"을 또 붙이지 않는다.
      .filter((b) => b.k === "side-tank" || b.k === "raid-damage")
      .flatMap((b) => b.whom ?? [])
      // 역풍 문장은 "그대로 주저앉음"까지 이미 말했다 — 그 사람의 몰락을 두 번 말하지 않는다.
      .concat(tactics.filter((b) => b.k === "rush-backfire").flatMap((b) => b.who))
  );

  const gangBeats: Beat[] = [
    ...gangRush(earlyOuts(loserPlayers, totalFrames), winnerPlayers, totalFrames)
      .map((g) => ({ g, won: true })),
    ...gangRush(earlyOuts(winnerPlayers, totalFrames), loserPlayers, totalFrames)
      .map((g) => ({ g, won: false })),
  ].map(({ g, won }) => {
    pickedOff.add(g.victim.rawName);
    return {
      k: "gang-rush", won, who: g.by.map((p) => p.rawName), whom: [g.victim.rawName],
      at: fellFrame(g.victim, totalFrames), weight: 13, p: { n: g.by.length },
    } as Beat;
  });

  // 손이 유난히 빨랐던 사람(요청) — APM/유효 APM이 그 경기 평균을 크게 웃돌면 그건
  // 컨트롤과 생산으로 나타난 것이다. 유효 APM을 앞세운다: 그냥 APM은 같은 명령을 여러 번
  // 눌러도 올라가서 '빠른 손'을 과장한다.
  const handsBeat: Beat | null = (() => {
    const all = [...winnerPlayers, ...loserPlayers];
    const rate = (x: ParsedReplayPlayer) => x.eapm ?? x.apm ?? 0;
    const vals = all.map(rate).filter((v) => v > 0);
    if (vals.length < 2) return null;
    const avg = vals.reduce((a, v) => a + v, 0) / vals.length;
    const best = all.slice().sort((a, b) => rate(b) - rate(a))[0];
    if (!best) return null;
    const elite = rate(best) >= HANDS_ELITE;
    if (!elite && (avg < HANDS_MIN_AVG || rate(best) < avg * HANDS_RATIO)) return null;
    return {
      k: "fast-hands", won: winnerPlayers.includes(best), who: [best.rawName],
      at: null, weight: elite ? 13 : 12,
      p: {
        apm: Math.round(rate(best)),
        eff: best.eapm !== null && best.eapm !== undefined,
        ...(elite ? { elite: true } : {}),
      },
    } as Beat;
  })();

  // 양쪽이 병력을 쉬지 않고 쏟아부은 경기 — 그건 한 방 싸움이 아니라 소모전이다(요청).
  const attritionBeat: Beat | null = (() => {
    if (sec < ATTRITION_MIN_SEC) return null;
    const troops = [...winnerPlayers, ...loserPlayers].reduce((acc, x) => acc + Object.entries(
      x.signals?.unitCounts ?? {},
    ).filter(([k]) => !NON_COMBAT_UNITS.has(k)).reduce((a, [, n]) => a + n, 0), 0);
    // 분당 몇 기를 뽑았나로 본다 — 총량만 보면 긴 경기는 전부 소모전이 된다.
    if (troops / (sec / 60) < ATTRITION_PER_MIN) return null;
    return {
      k: "attrition", won: true, who: winnerPlayers.map((x) => x.rawName),
      at: null, weight: 10, p: { n: troops, min: minutes(sec) },
    } as Beat;
  })();

  // 오래 갔는데 어느 쪽도 먼저 무너지지 않았고 낸 것도 비슷했다면, 그 자체가 전황이다
  // (요청: "몇 분 동안 팽팽하게 대치함"). 커맨드 총량과 병력 생산량 둘 다 비슷해야 한다 —
  // 하나만 보면 한쪽이 일꾼만 잔뜩 뽑은 경기도 팽팽한 것으로 읽힌다.
  const standoff = (() => {
    if (sec < STANDOFF_MIN_SEC || !totalFrames) return null;
    if (earlyOuts(winnerPlayers, totalFrames).length > 0) return null;
    if (earlyOuts(loserPlayers, totalFrames).length > 0) return null;
    const close = (a: number, b: number) =>
      a > 0 && b > 0 && Math.max(a, b) / Math.min(a, b) <= STANDOFF_RATIO;
    const cmds = (x: Side) => x.thirds[0] + x.thirds[1] + x.thirds[2];
    // 병력 '수'는 종족을 건너 견줄 수 없다(저글링은 두 마리씩, 마린은 싸다) — 손이 얼마나
    // 바빴나(커맨드 총량)로 견준다.
    if (!close(cmds(winner), cmds(loser))) return null;
    // 그리고 중간에 어느 쪽도 크게 무너지지 않아야 팽팽한 것이다 — 한쪽 생산이 뚝 끊긴
    // 경기는 길었을 뿐 팽팽하지 않았다. 처음과 끝의 등락은 원래 있는 것이라 뺀다.
    const mid = [totalFrames * 0.2, totalFrames * 0.85] as const;
    const broken = [...winnerPlayers, ...loserPlayers].some((p) =>
      productionDips(p, totalFrames).some((d) => d >= mid[0] && d <= mid[1]));
    if (broken) return null;
    return {
      k: "standoff", won: true, who: winnerPlayers.map((p) => p.rawName),
      at: Math.round(totalFrames / 2), weight: 11, p: { min: minutes(sec) },
    } as Beat;
  })();

  // "45분 중 절반을 캐리어와 골리앗이 서로 노려보며 버텼는데 그게 전혀 안 나온다"(지적).
  // 뽑은 수가 적어 주력 조합 싸움에서도 밀리니 어디에도 안 남았다 — 그 자체를 한 줄로
  // 말해 준다.
  //
  // 다만 "그 병력이 살아서 굴러다녔다"고는 말할 수 없다. 커맨드 스트림에는 유닛의 생사가
  // 안 적혀 있어서 무엇이 남아 있었는지는 알 방법이 없다(지적). 그래서 확인되는 사실만
  // 쓴다 — ① 양쪽 다 어느 시점 이후로 병력을 거의 안 보탰고, ② 그러고도 경기가 한참
  // 이어졌으며, ③ 그 직전에 각자 마지막으로 갖춘 게 무엇이었나.
  const lateHold = (() => {
    if (!totalFrames || sec < HOLD_MIN_SEC) return null;
    // '조합을 다 갖춘 시점' — lateArmy와 같은 기준을 쓴다.
    const a = settledFrame(winnerPlayers);
    const b = settledFrame(loserPlayers);
    if (a === null || b === null) return null;
    // 둘 다 멎은 뒤부터가 '서로 보태지 않고 버틴' 구간이다.
    const from = Math.max(a, b);
    const quietSec = (totalFrames - from) * SECONDS_PER_FRAME;
    if (quietSec < HOLD_QUIET_SEC || quietSec < sec * HOLD_QUIET_SHARE) return null;
    // 각자 마지막으로 갖춘 조합의 대표 유닛 하나씩.
    const mine = nameableUnits(mainUnits(winner.combat, armyBySupply(winnerPlayers)))[0];
    const theirs = nameableUnits(mainUnits(loser.combat, armyBySupply(loserPlayers)))[0];
    if (!mine || !theirs || mine === theirs) return null;
    return {
      k: "late-hold", won: true, at: from, weight: 15,
      who: winnerPlayers.map((p) => p.rawName),
      whom: loserPlayers.map((p) => p.rawName),
      p: { min: minutes(quietSec), mine, theirs, duel: duel === true },
    } as Beat;
  })();

  // 병력을 늦게까지 안 뽑고 자원만 먼저 챙긴 것 — '째기'(요청). 결과가 갈리는 만큼
  // 두 갈래로 말한다: 그 사이에 얻어맞았으면 "무리하게 째다가 …의 공격에 무너짐",
  // 무사히 넘겼으면 "성공적으로 째서 … 물량이 폭발함".
  // 같은 사람에게 같은 식으로 당한 사람이 여럿이면 한 문장으로 묶는다(지적: "태섭과 제롬이
  // 무리하게 째기를 시도하다가 정구의 공격에 노출됨") — 같은 말을 사람 수만큼 반복할 이유가 없다.
  const mergeSameFate = (list: Beat[], key: string): Beat[] => {
    const same = list.filter((b) => b.k === key && (b.whom?.length ?? 0) > 0);
    if (same.length <= 1) return list;
    const groups = new Map<string, Beat[]>();
    for (const b of same) {
      const k = `${b.won ? 1 : 0}|${(b.whom ?? []).join(",")}`;
      const g = groups.get(k);
      if (g) g.push(b); else groups.set(k, [b]);
    }
    const merged = [...groups.values()].map((g) => (g.length === 1 ? g[0] : {
      ...g[0],
      who: [...new Set(g.flatMap((b) => b.who))],
      at: Math.min(...g.map((b) => b.at ?? Infinity)),
      weight: Math.max(...g.map((b) => b.weight)) + 1,
    } as Beat));
    return [...list.filter((b) => !same.includes(b)), ...merged];
  };

  const greedyBeats: Beat[] = (() => {
    if (!totalFrames) return [];
    const out: Beat[] = [];
    for (const won of [true, false]) {
      const mine = won ? winnerPlayers : loserPlayers;
      const foes = won ? loserPlayers : winnerPlayers;
      for (const p of mine) {
        const sg = p.signals;
        if (!sg) continue;
        const combat = Object.entries(sg.unitFrames)
          .filter(([u]) => !NON_COMBAT_UNITS.has(u))
          .flatMap(([, f]) => f);
        if (combat.length < GREEDY_MIN_UNITS) continue;
        // 초반 구간에서 일꾼과 병력을 나란히 센다 — 절대 수가 아니라 둘의 비가 째기다(지적).
        const bar = Math.min(totalFrames * GREEDY_WINDOW_RATIO, GREEDY_MAX_SEC / SECONDS_PER_FRAME);
        const drones = [...WORKER_UNITS]
          .flatMap((u) => sg.unitFrames[u] ?? [])
          .filter((f) => f <= bar).length;
        if (drones < GREEDY_MIN_WORKERS) continue;
        const troops = combat.filter((f) => f <= bar).length;
        if (drones < Math.max(1, troops) * GREEDY_RATIO) continue;
        const first = bar;
        const hurtBy = (() => {
          const window = first + GREEDY_PUNISH_SEC / SECONDS_PER_FRAME;
          const hit = productionDips(p, totalFrames).some((d) => d >= first && d <= window)
            || (fellFrame(p, totalFrames) ?? Infinity) <= window;
          if (!hit) return null;
          // 때린 사람은 그 무렵 병력을 뽑고 있던 상대 중 가장 많이 뽑은 쪽으로 짚는다.
          let best: { raw: string; n: number } | null = null;
          for (const z of foes) {
            const n = Object.entries(z.signals?.unitFrames ?? {})
              .filter(([u]) => !NON_COMBAT_UNITS.has(u))
              .flatMap(([, f]) => f)
              .filter((x) => x <= window).length;
            if (n > 0 && (!best || n > best.n)) best = { raw: z.rawName, n };
          }
          return best?.raw ?? null;
        })();
        // 무엇이 폭발했나 — 째고 나서 가장 많이 뽑은 병력 한 종류.
        const top = Object.entries(sg.unitFrames)
          .filter(([u]) => !NON_COMBAT_UNITS.has(u))
          .map(([u, f]) => [u, f.length] as const)
          .sort((a, b) => b[1] - a[1])[0];
        if (hurtBy) {
          out.push({
            k: "greedy-punished", won, who: [p.rawName], whom: [hurtBy],
            at: first, weight: 15, p: { min: minutes(first * SECONDS_PER_FRAME) },
          } as Beat);
        } else if (top && top[1] >= GREEDY_PAYOFF_UNITS) {
          out.push({
            k: "greedy-paid", won, who: [p.rawName],
            at: first, weight: 13, p: { unit: top[0], min: minutes(first * SECONDS_PER_FRAME) },
          } as Beat);
        }
      }
    }
    return out;
  })();

  const sideAll: Beat[] = [
    ...sideBeats({
      side: winner, other: loser, players: winnerPlayers,
      won: true, sec, totalFrames, pressedEarly: false,
    }),
    ...sideBeats({
      side: loser, other: winner, players: loserPlayers,
      won: false, sec, totalFrames, pressedEarly,
    }),
  ];

  // 같은 방어 건물을 두 문장이 나눠 세지 않게 한 쪽으로 몰아준다. 누가 무엇을 몇 개
  // 지었나는 세 곳에서 말할 수 있다 — 뚫렸다(breakthrough)·지어서 막았다(defense)·
  // 얻어맞고 뒤늦게 올렸다(late-defense).
  //
  // 셋이 겹치면 late-defense를 남긴다(요청): 나머지 둘은 개수만 말하지만 이쪽은 '언제
  // 늘렸나'까지 말하고, 사용자가 빠졌다고 지적한 대목이 바로 그 시점이다.
  const lateDefended = new Map<string, unknown>(
    sideAll.filter((b) => b.k === "late-defense").flatMap((b) => b.who.map((w) => [w, b.p?.def])),
  );
  const coveredByLate = (whos: string[], def: unknown): boolean =>
    whos.some((w) => lateDefended.has(w) && lateDefended.get(w) === def);
  const wall = breached && !coveredByLate(breached.whom ?? [], breached.p?.def)
    ? breached
    : null;

  const pool: Beat[] = [
    ...(standoff ? [standoff] : []),
    ...(lateHold ? [lateHold] : []),
    ...(handsBeat ? [handsBeat] : []),
    ...(attritionBeat ? [attritionBeat] : []),
    ...(wall ? [wall] : []),
    ...mergeSameFate(greedyBeats, "greedy-punished"),
    ...gangBeats,
    ...mergeScatter(mergeMutual(tactics)),
    // 돌파 문장은 늘 '진 편의 벽'을 말하므로 그쪽 방어 문장만 덜어 낸다(이긴 편이 지어 둔
    // 방어는 다른 이야기다). 뒤늦은 증설과 겹치는 건 어느 편이든 덜어 낸다.
    ...sideAll.filter((b) => !(
      b.k === "defense" && ((breached && !b.won) || coveredByLate(b.who, b.p?.def))
    )),
  ]
    .filter((b) => !(b.k === "fallen" && b.who.some((w) => pickedOff.has(w))))
    // 돌파 문장이 이미 "조조의 저글링 성큰 5개를 밀어버렸다"고 말했으면, 같은 사람의
    // 무너짐에 "성큰 5개와 함께 버텼지만"을 또 붙이지 않는다 — 같은 방어 건물이 한
    // 요약에 두 번 나온다. 문장은 남기고 그 대목만 덜어 낸다.
    // 뒤늦은 증설 문장이 있을 때도 마찬가지다 — "부랴부랴 지었지만"과 "뒤늦게 N개를
    // 올렸다"는 같은 사실의 두 얼굴이다.
    .map((b) => {
      if (b.k !== "fallen") return b;
      const byWall = wall && wall.p?.def === b.p?.def
        && b.who.some((w) => (wall.whom ?? []).includes(w));
      if (!byWall && !coveredByLate(b.who, b.p?.def)) return b;
      const { def: _def, defN: _defN, panic: _panic, ...rest } = b.p ?? {};
      return { ...b, p: rest };
    });

  // 들이친 수가 이미 "○○의 생산에 큰 피해를 줬다"고 말했으면, 방어 증설 문장은 맞은
  // 얘기를 다시 하지 않는다(quiet) — 안 그러면 "포토를 세우고도 4분에 크게 흔들렸고
  // ○○는 질럿 러시로 생산에 큰 피해를 줬다"처럼 같은 순간이 두 번 나온다.
  const hitNarrated = new Set(
    pool.filter((b) => b.k === "raid-damage" || b.k === "gang-rush").flatMap((b) => b.whom ?? []),
  );
  for (let i = 0; i < pool.length; i += 1) {
    const b = pool[i];
    if (b.k !== "late-defense" || !b.who.some((w) => hitNarrated.has(w))) continue;
    pool[i] = { ...b, p: { ...(b.p ?? {}), quiet: true } };
  }

  // 전술·돌파·합공처럼 '그 경기에서만 있었던 일'이 자리보다 많으면 그만큼 더 쓴다
  // (요청: 할 얘기가 많은 경기는 좀 더 써도 됨). 일반적인 사실로 늘리지는 않는다.
  //
  // 한때 열 문장까지 열어 봤는데 오히려 읽기 어려웠다(지적) — 다섯으로 되돌린다.
  // 다만 30분을 넘긴 경기는 그만큼 국면이 많아 일곱까지 허용한다(요청 — 위 baseBudget).
  // 일방적인 경기는 늘어놓을 국면 자체가 없다(요청) — 자리를 줄여 짧게 끝낸다.
  const budget = oneSided ? Math.min(baseBudget, 3) : baseBudget;

  // 고를 때는 무게순(재미있는 것부터), 이야기로 늘어놓을 때는 시간순 — 순서를 이 둘로 나눠야
  // "자리가 모자라 재미없는 걸 남기는" 일도, "중요한 게 뜬금없는 자리에 오는" 일도 없다.
  // 시점을 못 잡은 문장(올인처럼 한 순간이 아닌 것)은 맺음말 바로 앞으로 밀린다.
  const chosen: Beat[] = [];
  const slots = budget - 1;
  // 진 편이 무엇으로 맞섰나(stand)는 자리를 미리 잡아 두지 않는다(지적: 패배팀 문장은
  // 필수가 아니다). 한때 예약을 뒀는데, 그러면 자리가 빠듯한 경기에서 그 문장이 자리를
  // 먹고 정작 승부를 낸 성큰러시·포토러시가 무게로는 훨씬 앞서는데도 빠져 버렸다.
  // 다른 문장들과 똑같이 무게로 겨루게 둔다.

  // 한 국면이 자리를 다 먹지 않게 초/중/후로 나눠 상한을 둔다(지적: "후반이 너무 강해져서
  // 초중반 내용은 사라져버렸어"). 후반 비트들이 대체로 무겁다 보니(주력 조합·물량·흩어
  // 짓기) 무게순으로만 고르면 뒷이야기만 남고 빌드·러시 같은 앞이야기가 통째로 빠졌다.
  // 시점을 못 잡은 문장은 맺음말 앞에 붙으므로 후반으로 친다.
  const phaseOf = (b: Beat): 0 | 1 | 2 => {
    if (!totalFrames || b.at === null || b.at === undefined) return 2;
    const r = b.at / totalFrames;
    return r < 1 / 3 ? 0 : r < 2 / 3 ? 1 : 2;
  };
  // 한 국면이 절반을 넘지 않게 — 자리가 여섯이면 국면당 셋까지다.
  const perPhaseMax = Math.max(1, Math.ceil(slots / 2));
  const taken: [number, number, number] = [0, 0, 0];

  const ranked = [...pool].sort((x, y) => y.weight - x.weight);
  const consider = (b: Beat, capped: boolean): boolean => {
    if (chosen.includes(b)) return false;
    if (chosen.length >= slots) return false;
    if (b.weight < MIN_WEIGHT) return false;
    if (capped && taken[phaseOf(b)] >= perPhaseMax) return false;
    if (b.dedupeOn && chosen.some((x) => renderReplaySummary(
      { v: REPLAY_SUMMARY_VERSION, beats: [strip(x)] }, (raw) => raw,
    )?.includes(b.dedupeOn!))) return false;
    chosen.push(b);
    taken[phaseOf(b)] += 1;
    return true;
  };
  // 1차: 국면 상한을 지키며 무게순으로 채운다.
  for (const b of ranked) consider(b, true);
  // 2차: 그래도 자리가 남으면(한쪽 국면에만 이야기가 몰린 경기) 상한을 풀고 마저 채운다 —
  // 균형을 맞추자고 쓸 수 있는 이야기를 버리지는 않는다.
  for (const b of ranked) consider(b, false);
  // 이야기의 뼈대는 시간이다(지적) — 편끼리 묶는다고 시간을 넘나들면 앞뒤가 뒤집혀 읽힌다.
  // 그래서 먼저 시간순으로 세우고, 같은 편 이야기를 붙이는 건 '거의 같은 때'에 벌어진
  // 일들 안에서만 한다. 시점을 못 잡은 문장(올인처럼 한 순간이 아닌 것)은 맺음말 앞으로 밀린다.
  // 진 편의 맺음(stand)은 그중에서도 맨 뒤다 — 결론을 다른 사건들 사이에 끼워 넣으면
  // "역부족", "판을 뒤집지 못함" 같은 말이 초반 이야기보다 먼저 나온다(지적).
  const tailRank = (b: Beat): number =>
    (b.k === "stand" && !b.won ? 2 : b.at === null || b.at === undefined ? 1 : 0);
  chosen.sort((a, b) => tailRank(a) - tailRank(b) || (a.at ?? Infinity) - (b.at ?? Infinity));
  // 같은 편 두 문장 사이에 다른 편 문장 하나가 끼었는데 셋이 다 비슷한 때라면, 그건
  // 시간이 아니라 편이 갈라 놓은 것이라 붙여 준다. 창을 넘어가면 손대지 않는다.
  for (let i = 1; i + 1 < chosen.length; i += 1) {
    const before = chosen[i - 1];
    const cut = chosen[i];
    const after = chosen[i + 1];
    if (before.won === cut.won || before.won !== after.won) continue;
    if (typeof before.at !== "number" || typeof after.at !== "number") continue;
    if (Math.abs(after.at - before.at) * SECONDS_PER_FRAME > CLUSTER_SEC) continue;
    chosen[i] = after;
    chosen[i + 1] = cut;
  }
  // 같은 편끼리 묶다 보면 "무너짐"이 그 사람의 "3게이트를 감"보다 앞에 오는 일이 생긴다 —
  // 무너진 사람이 그 뒤에 무언가를 갔다는 말은 될 수 없다(지적). 비슷한 때(3분 안)에
  // 벌어진 일들 사이에서만, 당한 문장을 그 사람의 제 문장 뒤로 민다. 시간이 멀면 건드리지
  // 않는다 — 그건 정말로 무너지고 한참 뒤의 이야기라 순서가 맞다.
  for (let pass = 0; pass < chosen.length; pass += 1) {
    let moved = false;
    for (let i = 0; i < chosen.length - 1; i += 1) {
      const hit = chosen[i];
      const act = chosen[i + 1];
      const victims = hit.whom ?? [];
      if (victims.length === 0) continue;
      if (!(act.who ?? []).some((w) => victims.includes(w))) continue;
      if ((act.whom ?? []).some((w) => (hit.who ?? []).includes(w))) continue; // 맞받아친 것
      if (typeof hit.at !== "number" || typeof act.at !== "number") continue;
      if (Math.abs(hit.at - act.at) * SECONDS_PER_FRAME > RAID_MERGE_SEC) continue;
      chosen[i] = act;
      chosen[i + 1] = hit;
      moved = true;
    }
    if (!moved) break;
  }

  // 결과는 이야기의 맺음말로 맨 뒤에 붙인다 — 앞에 먼저 요약을 놓으면 뒤의 이야기가
  // 이미 아는 결말의 부연이 되어버린다(요청: 맨 처음의 전체 요약은 빼기).
  // 앞선 문장들이 이미 그 조합을 말했으면 조합은 빼고 결과만 말한다. 판단은 실제로 만들어질
  // 문장을 보고 한다 — beat의 재료만 봐서는 "9드론 저글링 러시"가 저글링을 이미 말했다는 걸
  // 알 수 없고, 전술마다 어떤 유닛을 언급하는지 목록을 따로 들고 있으면 문구를 고칠 때마다
  // 같이 고쳐야 한다. 이름은 결과에 안 쓰이므로 아무 값이나 넘겨도 된다.
  const told = renderReplaySummary(
    { v: REPLAY_SUMMARY_VERSION, beats: chosen.map(strip) },
    (raw) => raw
  ) ?? "";
  const alreadySaid = units.every((u) => told.includes(UNIT_KO[u]));
  // 같은 사람이 같은 유닛으로 한 일을 앞에서 이미 말했다면, 맺음말은 그걸 이어받는다(요청)
  // — 따로 노는 두 문장 대신 "…로 공격 감행. 계속해서 마린을 뽑아 승리"로 읽히게.
  const cont = chosen.some((b) => {
    if (!b.who.some((w) => subject.includes(w))) return false;
    const one = renderReplaySummary(
      { v: REPLAY_SUMMARY_VERSION, beats: [strip(b)] }, (raw) => raw
    ) ?? "";
    return units.some((u) => UNIT_KO[u] && one.includes(UNIT_KO[u]));
  });
  // 팀전 승리를 한 사람의 공으로 돌리지 않는다(요청) — 이긴 편 각자가 무엇으로 싸웠는지를
  // 함께 적어, "유비의 마린, 관우의 저글링으로 승리"처럼 팀 전체로 읽히게 한다.
  // 다만 이긴 편이라도 일찍 끊긴 사람은 이 대열에서 뺀다(지적: 6분에 무너진 사람이 끝까지
  // 살아 질럿 드라군을 쓴 것처럼 읽힌다). 그 사람이 무엇을 뽑았는지는 앞 문장이 이미 말한다.
  // 기준을 earlyOuts(0.7)보다 훨씬 이르게 잡는 이유: 이긴 쪽이 생산을 멈추는 건 무너져서가
  // 아니라 이미 갖춘 병력으로 끝냈기 때문인 경우가 많은데, 그건 대개 경기 후반의 일이다.
  // 절반도 못 가서 끊겼다면 그건 '몰아붙여 이긴' 사람이 아니다.
  const stillIn = winnerPlayers.filter((p) => {
    if (!totalFrames) return true;
    const fell = fellFrame(p, totalFrames);
    return fell === null || fell >= totalFrames * ENDING_ALIVE_RATIO;
  });
  // 아무도 안 남으면 그건 무너진 게 아니라 커맨드가 성긴 것이다 — 그럴 땐 전원을 쓴다.
  const finishers = stillIn.length > 0 ? stillIn : winnerPlayers;
  const teamRanked = finishers.length > 1
    ? finishers
        .map((p) => {
          const own = [...ownCombat(p).entries()].sort((a, b) => b[1] - a[1]);
          // 대표 유닛은 스스로 싸움을 끝낼 수 있는 것으로, 조합에는 메딕·디파일러 같은
          // 보조 유닛도 넣는다 — "마린 메딕 조합"이 그 사람의 그림이다(요청).
          const unit = own.filter(([u]) => !SUPPORT_UNITS.has(u))[0]?.[0];
          const comp = own.slice(0, 3).map(([u]) => u);
          return { raw: p.rawName, n: sumCombat(p), unit, comp };
        })
        .filter((x): x is { raw: string; n: number; unit: string; comp: string[] } => !!x.unit)
        .sort((a, b) => b.n - a.n)
    : [];
  // 전원의 유닛을 늘어놓으면 문장이 길어지기만 한다(지적) — 대신 같은 주력을 쓴 사람끼리
  // 묶어 말한다(요청). 누구를 묶고 몇 무리까지 말할지는 문장 쪽이 정하므로, 여기서는
  // 이긴 편 전원의 대표 유닛과 조합을 그대로 넘긴다.
  const useTeam = teamRanked.length === finishers.length && teamRanked.length > 1;

  const ending: Beat = {
    k: "result", won: true, at: Number.POSITIVE_INFINITY, weight: 1000,
    // 이긴 편 전원을 담아 두고, 몇 명까지 말할지는 문장 쪽에서 정한다.
    // 사람별로 나눠 말하지 않는 꼴(useTeam=false)에서도 일찍 끊긴 사람은 뺀다 — 이름만
    // 나열하는 문장이라도 "몰아붙여 이겼다"의 주어이긴 마찬가지다. 다 빠지면 원래대로 둔다.
    who: useTeam
      ? teamRanked.map((x) => x.raw)
      : (subject.filter((w) => finishers.some((p) => p.rawName === w)).length > 0
        ? subject.filter((w) => finishers.some((p) => p.rawName === w))
        : subject),
    p: {
      mode, lead, wentLate, ...(bigSwing ? { swing: true } : {}),
      ...(oneSided ? { oneSided: true } : {}),
      leadMin: minutes(sec),
      ...(spectacle ? { leadUnit: spectacle } : {}),
      // 이어받는 문장은 유닛을 다시 말해야 말이 이어진다 — 그때는 중복이 아니라 연결이다.
      ...(cont ? { units, cont: true } : alreadySaid ? {} : { units }),
      // 주력을 몇 기나 뽑았나 — "질럿을 세 부대 뽑아 승리"처럼 규모로도 말한다(요청).
      ...(units[0] ? { unitN: winner.combat.get(units[0]) ?? 0 } : {}),
      ...(useTeam
        ? {
            teamUnits: teamRanked.map((x) => x.unit),
            // 같은 유닛을 주력으로 쓴 사람끼리 묶어 말할 때 쓰는 각자의 조합(요청).
            teamComp: teamRanked.map((x) => x.comp.join("|")),
          }
        : {}),
      // 팀 전체로 말할 땐 한 사람의 활약을 따로 덧붙이지 않는다 — 공이 두 번 갈린다.
      // 다만 생산이 압도적이었던 사람만은 예외다(요청).
      ...(useTeam
        ? (domUnit ? { heroUnit: domUnit, heroMode: "dominant" } : {})
        : (heroUnit ? { heroUnit } : {})),
    },
    ...(useTeam
      ? (domUnit && dominant ? { who2: [dominant.rawName] } : {})
      : (heroUnit && star ? { who2: [star.rawName] } : {})),
    // 역전패한 경기는 진 편 입장에서 맺어도 좋다(요청: "결국 2팀은 초반 승기를 잡았지만
    // 1팀의 …에 버티지 못하고 GG"). 그러려면 진 편이 누구인지 문장 쪽이 알아야 한다.
    ...(mode === "comeback" ? { whom: loserPlayers.map((p) => p.rawName) } : {}),
  };

  return {
    v: REPLAY_SUMMARY_VERSION,
    // '초반'을 재려면 경기가 얼마나 길었는지를 알아야 한다(지적).
    ...(totalFrames ? { end: totalFrames } : {}),
    // 개인전에서는 팀 용어를 쓰지 않는다(요청).
    ...(duel ? { duel: true } : {}),
    beats: [...chosen, ending].map(strip),
  };
}
