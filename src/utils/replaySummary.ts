import type { ParsedReplay, ParsedReplayPlayer, ReplayPlayerSignals } from "./replayParser";
import {
  pushersOn, scanTactics, producedFrames, windowPeak, fightersAt, midOf,
  FIGHT_TECHS, GG_RE, NO_ELIM_RE,
} from "./replayTactics";
import {
  hasUpgrade, topUsedTech, topUsedTechs, TECH_RANK, UPGRADE_RANK, UNIT_UPGRADE_TAG, techUseCount, upgradeFrame, upgradeLevel,
  ARMOR_WEAPON_PAIRS, SIGNATURE_UPGRADE_KO, UPGRADE_LINE_KO,
} from "./replayTechNames";
import {
  eliminatedFrame, fellFrame, productionCollapse, productionDips, revivalFrame, surgeSpanMin,
} from "./replayFell";
import {
  REPLAY_SUMMARY_VERSION, sceneWindowSec,
  type ReplaySummaryBeat, type ReplaySummaryData,
} from "./replaySummaryData";
import {
  DEFENSE_KO, EXPANSION_KO, PRODUCTION_KO, SPECTACLE_RANK, SPECTACLE_UNITS, SUPPORT_UNITS, UNIT_KO, UNIT_ROLE,
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
/* 테크 건물 — 병력 대신 자원을 부은 곳이다(요청: "테크를 탔다"는 말도 쓰자). 종족을 안
   가르고 한 뭉치로 두는 이유는 여기서 쓰는 재료(buildingFrames)의 열쇠가 영문 건물
   이름이라 종족이 이미 이름에 박혀 있기 때문이다 — 저그가 Forge를 지을 일은 없다.
   목록은 replayTactics의 TECH_BUILDINGS와 같은 갈래다(그쪽은 종족별로 나눠 쓴다).
   생산 건물(게이트·배럭·팩토리…)은 뺀다 — 그건 병력을 뽑는 곳이라, 안 들어가고 병력만
   쌓은 이야기에서 '그 사이 다른 걸 했다'는 뜻이 안 된다. */
const TECH_BUILDINGS = new Set([
  // 저그
  "Lair", "Hive", "Evolution Chamber", "Hydralisk Den", "Spire", "Greater Spire",
  "Queen's Nest", "Defiler Mound", "Ultralisk Cavern",
  // 프로토스
  "Forge", "Cybernetics Core", "Citadel of Adun", "Templar Archives",
  "Robotics Support Bay", "Observatory", "Fleet Beacon", "Arbiter Tribunal",
  // 테란
  "Engineering Bay", "Academy", "Armory", "Science Facility",
  "Machine Shop", "Control Tower", "Covert Ops", "Physics Lab",
]);
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
// 웅크렸다고 말하려면 같은 판의 다른 사람들보다 방어 건물이 이만큼 많아야 한다(지적) —
// 방어탑 열 채는 어떤 맵에서는 기본이고 어떤 맵에서는 이례적이다.
const TURTLE_RATIO = 1.8;
const TURTLE_FLOOR = 5;

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
// '떼로 몰려갔다'로 세려면 그 사람이 당한 쪽보다 병력이 앞서 있어야 한다 — 절대 8기가
// 아니라 상대 대비다(지적). 맵이 넉넉하면 8기는 시작 병력이고, 마르면 8기가 전군이다.
const GANG_ARMED_RATIO = 1.2;
const GANG_ARMED_FLOOR = 4;
/** 급습 하나에 '함께 덮친 사람'으로 셀 앞뒤 시간(초) — 이 밖의 공격은 같은 집을 쳤어도
 *  다른 이야기다(raid-damage의 gang 주석에 실측이 있다). 교전을 '같은 순간'으로 보는
 *  다른 창들과 같은 값이다(리콜을 한 수로 묶는 RECALL_SAME_SEC, 그 자리에서 누구와
 *  싸우고 있었나를 보는 FIGHT_WINDOW_SEC, 큰 교전을 찾는 CLASH_WINDOW_FRAMES).
 *
 *  실측(172판, 급습 238건 중 '여럿이 함께 덮쳤다'가 붙는 비율):
 *      경기 처음부터(예전) 59% · 앞뒤 90초 49% · 60초 41% · 45초 37% · 30초 24%
 *  지적받은 판은 90초로는 여전히 1분 반 전에 끝난 다른 사람의 공격이 딸려 들어왔고,
 *  60초에서 떨어졌다. 30초까지 좁히면 진짜 동시에 들어온 합공까지 놓치기 시작한다. */
const GANG_NEAR_SEC = 60;

// '째기'는 시계로 재는 것이 아니라 무엇을 먼저 뽑았느냐로 갈린다(지적: 일꾼 뽑는 속도
// 대비 병력 뽑는 속도를 비교). 초반 구간에서 일꾼이 병력보다 이만큼 앞서면 째기로 본다.
const GREEDY_RATIO = 3;
// 견줄 만큼은 뽑았어야 한다 — 서너 기 차이는 아무 뜻도 아니다. 다만 '얼마나'는 절대 수로
// 못 박지 않고 같은 판 사람들의 가운데치에 견준다(지적: "헌터/빅헌터도 다르고 맵마다 자원
// 상태가 달라서 상대적으로 해야 한다"). 자원이 넉넉한 판에서는 일꾼 12기가 아무것도 아니고,
// 마른 판에서는 12기가 째고도 남는 수다.
const GREEDY_WORKER_SHARE = 0.9;
// 그래도 아무도 아무것도 안 뽑은 판에서 헛말이 나오지 않게 바닥은 남긴다.
const GREEDY_WORKER_FLOOR = 6;
// 어디까지를 '초반'으로 볼 것인가 — 경기 길이에 대비해 잡는다.
const GREEDY_WINDOW_RATIO = 0.3;
// 그래도 경기 앞쪽 이야기여야 한다 — 후반 이야기를 째기라 부르면 말이 안 된다.
const GREEDY_MAX_SEC = 8 * 60;
// 경기 전체로 이만큼은 뽑아야 견줄 거리가 된다(관전 슬롯·즉시 탈락 제외) — 이것도 같은
// 판의 가운데치 대비다. 바닥은 '한 판이라고 부를 수 있는 최소'로만 남긴다.
const GREEDY_UNITS_SHARE = 0.35;
const GREEDY_UNITS_FLOOR = 3;
// 째기 구간 뒤 이 안에 생산이 꺾였으면 째다가 얻어맞은 것이다.
const GREEDY_PUNISH_SEC = 4 * 60;
// 째고 나서 '물량이 폭발했다'고 말하려면 같은 판의 다른 사람들이 한 종류로 뽑은 수보다
// 이만큼 앞서야 한다 — 30기라는 절대 수는 맵이 바뀌면 뜻이 달라진다(지적).
const GREEDY_PAYOFF_RATIO = 1.6;
const GREEDY_PAYOFF_FLOOR = 12;

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
// 사람 수로 나눈 뒤의 값이다 — 총량으로 재면 4:4가 1:1보다 늘 소모전이 된다.
const ATTRITION_PER_MIN = 7;

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
// 무너지기 이 안쪽에 그 집까지 병력을 몰고 온 사람을 '무너뜨린 사람'으로 본다(지적: 해골이
// 뜨기 전 히스토리가 없다). 이사(RELOCATE_HIT_WINDOW_MIN)보다 짧게 잡는 이유는, 이사는
// 한참 시달리다 결심하는 일이지만 무너지는 건 마지막 한 방에 가까워서다.
const FALLEN_PUSH_WINDOW_MIN = 5;
// 무너진 뒤 이만큼까지도 함께 본다 — fellFrame은 '생산이 끊긴 때'라, 그 집을 실제로 밟는
// 것은 대개 그 조금 뒤다.
const FALLEN_PUSH_TAIL_MIN = 3;
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
  // 하이템플러 드랍도 마찬가지다(요청: 하이템플러나 리버로 일꾼 견제한 내용이 더 나와야
  // 한다) — 스톰 한 방이면 일꾼 줄이 통째로 사라진다. 리버 드랍(shuttle-reaver)은 위에 있다.
  "templar-drop",
  /* (뺌) 이름 없는 급습(base-raid) — 여기 넣어 봤더니 같은 급습이 "타격을 줬다"와
     "일꾼을 계속 잡았다" 두 갈래로 갈려 같은 사람·같은 상대 이야기가 세 문장씩 나왔다
     (실측). 급습이 통했다는 것은 raid-damage가 이미 말한다. */
]);

// 공격이 실제로 어디에 떨어졌나를 잴 때 쓰는 값들(지적: 어택 지정 좌표를 구분해도 정작
// 요약 문장에는 그 내용이 안 늘어난 것 같다) — orderPositions의 kind==='attack'(실제
// 공격 명령)만 모아 중심을 내고, 그 자리가 당한 쪽의 본진에서 이만큼 안쪽이면 '본진',
// 아니면 자원 자리(mapGrid.resources) 중 하나에 이만큼 가까울 때만 '멀티'라 부른다 —
// 둘 다 아니면(빈 땅 근처 어딘가) 아예 말하지 않는다. 실측 없이 정한 값이라(리플레이
// 표본이 없다) 신중하게 넉넉히 잡았다: 128칸 맵에서 8타일은 본진 건물 몇 채 폭 정도다.
const ATTACK_ZONE_MIN_ORDERS = 5;
const ATTACK_ZONE_HOME_TILES = 8;
const ATTACK_ZONE_RES_TILES = 6;

/* 그 수의 '누구를·어디를'을 실제 타격 클릭으로 채울 때 보는 시간 창과 최소 횟수(파서의
   hits 주석). 창은 한 번의 공방이 이어지는 정도로 잡고, 스쳐 지나간 정찰끼리의 클릭을
   공격이라 부르지 않게 몇 번은 찍혔어야 한다고 둔다. */
const HIT_WINDOW_SEC = 60;
const HIT_MIN = 3;
/** 상대 진영으로 볼 반경 — 그 사람 시작 지점에서 가장 가까운 다른 시작 지점까지 거리의
 *  이만큼. 절대 타일 수로 두면 맵 크기마다 뜻이 달라진다. */
const STRIKE_ZONE_RATIO = 0.34;
/** 그 창 안의 명령을 본다 — 태그로 찍은 기록보다 근거가 옅은 대신, 러시가 붙었다 떨어지는
 *  한 호흡을 넉넉히 담는다. */
const STRIKE_ZONE_WINDOW_SEC = 90;
/* '무엇으로 싸웠나'를 말할 때 쓰는 값들 — 그 유닛에게 이만큼은 명령이 갔어야 그 싸움의
   주력이라 부를 수 있고(한두 번 딸려 든 유닛은 주력이 아니다), 이름은 둘까지만 부른다
   (셋을 넘기면 조합 나열이 되어 문장이 늘어진다). */
const FORCE_MIN_ORDERS = 4;
const FORCE_MAX_UNITS = 2;
/** 최대 교전 문장에 이름을 부를 병력 수 — 양쪽에서 모으므로 조금 넉넉히 둔다. */
const CLASH_FORCE_MAX = 3;
/** 편별로 나눠 부를 때의 수 — 양쪽을 나란히 놓으므로 한 편에 둘까지가 읽기 좋다
 *  ("질럿·드라군과 마린·탱크가"). 셋씩 늘어놓으면 문장이 조합 나열이 된다. */
const CLASH_FORCE_SIDE_MAX = 2;
/* 최대 교전에서 터진 마법을 셀 때의 최소 횟수 — 한두 번은 그 싸움의 그림이 아니다.
   세는 범위는 '그 싸움이 벌어진 동안(clash.at~clash.end), 그 싸움터(반경 CLASH_RADIUS)'다.
   예전에는 시각만 봤다(교전 시작 앞뒤 90초, 자리는 안 봄) — 그래서 판 전체에서 3분 사이에
   터진 마법이 전부 이 싸움 것으로 딸려 들어왔다(지적: 후반 전투가 너무 묶여 문장이 길어졌다).
   실측 169판: 그렇게 세던 마법 중 '그 싸움터 밖'의 것이 중앙 57%(1/4분위 13%, 3/4분위 94%)
   였고, "스톰이 40번 터지는 가운데"가 실제로 그 자리에서 터진 건 17번이었다. 문장이 길어진
   것보다 이쪽이 더 문제다 — 다른 데서 벌어진 싸움의 마법을 이 싸움 것이라고 말한 셈이다.
   범위를 좁히면 마법을 얹는 판이 49 → 31로 준다. 줄어든 18판은 그 싸움터에서 실제로 터진
   마법이 세 번이 안 되던 판이다. */
const CLASH_TECH_MIN = 3;
/** 한 판에서 찾아 볼 교전 수 — 이야기로 세우는 수(CLASH_BEATS_MAX)보다 넉넉히 찾아 두고
 *  그중 큰 것만 문장이 된다. 실측(174판)으로 여섯 번째까지도 늘 나온다. */
const CLASH_ROUNDS = 4;
/** 이야기에 세울 교전 수(요청: 큰 교전이 여러 번이면 여러 번 나오는 게 맞다). */
const CLASH_BEATS_MAX = 3;
/** 두 번째부터는 가장 큰 교전의 이만큼은 돼야 따로 문장을 세운다 — 큰 싸움 하나에 딸린
 *  잔불까지 문장이 되면 자리(판당 6~7문장)를 다 먹는다.
 *
 *  실측(174판, 가장 큰 교전 대비 크기별로 '따로 벌어진 교전'이 판당 몇 개나 잡히나):
 *      30% 이상 → 중앙 6개 · 50% 이상 → 중앙 3개 · 70% 이상 → 중앙 2개(75%가 3개)
 *  70%면 대개 한 판단이 더 붙고, 큰 싸움이 정말 여러 번이던 판만 셋이 된다. */
const CLASH_EXTRA_SHARE = 0.7;
/** 큰 싸움과 급습이 '같은 사건'으로 보이는 간격(초)과 거리(타일).
 *
 *  급습이 그대로 큰 싸움으로 번지는 일은 흔하다 — 몰려간 병력을 상대가 받아치면 그
 *  자리가 곧 그 판의 절정이 된다. 그런데 둘은 갈래가 달라(raid-damage / clash) 서로를
 *  안 보고, 결과가 한 요약에 같은 장면 두 번이다(지적한 스크린샷: 04:31 "…본진 급습에
 *  [Jeong9]가 적잖은 피해를 입었다" / 04:42 "[Jeong9]의 기지에서 양 팀 병력이 가장 큰
 *  싸움을 벌였다" — 11초 차이에 좌표는 1.3타일 차이라 미니맵 화살표까지 똑같았다).
 *
 *  같은 피해자가 그 싸움에 있었고, 때와 자리가 이만큼 가까우면 한 사건으로 보고 급습
 *  문장을 덜어 낸다. 남기는 쪽은 큰 싸움이다 — 그게 그 판의 절정이고, 급습 문장은 그
 *  절정으로 가는 길목을 한 번 더 말하는 것뿐이다.
 *
 *  값은 좁게 잡는다: 30초·20타일이면 "그 급습이 곧 그 싸움"인 경우만 걸리고, 한 사람을
 *  두 번 따로 친 이야기(급습하고 1분 뒤 중앙에서 붙은 것 같은)는 그대로 둘 다 남는다. */
const CLASH_RAID_SEC = 30;
const CLASH_RAID_TILES = 20;
/* 기술을 실제로 쓴 이야기의 무게 — 기본값에 그 기술의 이야깃거리 점수(TECH_RANK)를 얹는다.
   사람마다 몇 개까지 말할지도 여기서 정한다(요청: 다양한 세부 기술 사용 진술). */
/** 마법이 가장 많이 떨어진 자리(타일 좌표)와 그 무렵 — 없거나 한곳에 안 몰렸으면 null.
 *
 *  "정구가 스톰을 21번 뿌렸다"만으로는 그게 제 집을 지킨 것인지 남의 집을 지진 것인지,
 *  어디였는지가 통째로 빠진다(지적: 이런 경우가 진짜 많다). 마법은 상태가 아니라 액션이라
 *  아바타가 아니라 실제로 터진 자리에 그려져야 한다 — 리플레이에는 시전 좌표가 그대로
 *  적혀 있으므로(castPositions) 그중 가장 많이 몰린 자리를 그 이야기의 자리로 삼는다.
 *
 *  스물한 번을 맵 곳곳에 흩뿌린 경우까지 한 자리로 부르면 거짓말이 되므로, 그 뭉치가 전체의
 *  CAST_HOT_SHARE는 되어야 자리를 말한다. 아니면 예전처럼 자리 없이 횟수만 말한다. */
const CAST_HOT_RADIUS = 20;
const CAST_HOT_SHARE = 0.4;
function castHotspot(
  sg: ReplayPlayerSignals, tech: string,
): { xy: [number, number]; at: number; n: number; frames: number[] } | null {
  const pts = (sg.castPositions ?? []).filter((c) => c.tech === tech);
  if (pts.length === 0) return null;
  let best: typeof pts | null = null;
  for (const c of pts) {
    const near = pts.filter((o) => Math.hypot(o.x - c.x, o.y - c.y) <= CAST_HOT_RADIUS);
    if (!best || near.length > best.length) best = near;
  }
  if (!best || best.length < Math.ceil(pts.length * CAST_HOT_SHARE)) return null;
  const x = best.reduce((n, o) => n + o.x, 0) / best.length;
  const y = best.reduce((n, o) => n + o.y, 0) / best.length;
  return {
    xy: [round1(x), round1(y)], at: Math.min(...best.map((o) => o.frame)), n: best.length,
    // 그 뭉치가 터진 시각들 — '그 무렵 거기서 누구와 싸우고 있었나'를 묻는 창이다(fightersAt).
    frames: best.map((o) => o.frame),
  };
}

const TECH_BASE_WEIGHT = 9;
/** 그 마법이 실제 교전 한복판에서 터졌을 때 얹는 무게 — 상대 이름과 무엇과 맞붙었는지까지
 *  말할 수 있는 문장이라, 혼자 연습하듯 쓴 것보다 이야기가 한 단계 위다. */
const TECH_FIGHT_BONUS = 2;
const TECH_BEATS_PER_PLAYER = 2;
/** 이야깃거리가 되는 기술만 문장이 된다 — 시즈(1)·스팀(1)·마인(2)·버로우(2)처럼 늘 나오는
 *  능력은 "썼다"고 말해 봐야 아무 소식이 아니다. */
const TECH_MIN_RANK = 4;
/** 한 요약에 기술 문장은 이만큼까지 — 다채로우려고 넣은 것이 도배가 되면 안 된다. */
const TECH_BEATS_PER_SUMMARY = 2;
/** 마법 예약석(위 EXTRA_SLOTS.tech)을 받으려면 최소 이만큼은 썼어야 한다 — 열 번쯤부터가
 *  "그 판 내내 썼다"고 할 수 있는 선이고, 무게 보너스(floor(n/10))가 붙기 시작하는 선이기도
 *  하다. 이보다 적게 쓴 마법은 예약 없이 무게로만 겨룬다. */
const TECH_RESERVE_MIN_USES = 10;
/** 드물게 쓰지만 한 번으로 판이 갈리는 마법 — 그 등급과, 그때 자리를 줄 최소 횟수. */
const TECH_RARE_RANK = 6;
const TECH_RARE_MIN_USES = 3;
/** 상징 업그레이드 문장의 기본 무게 — 여기에 UPGRADE_RANK를 얹는다. 전술 문장은 저마다의
 *  무게에 10을 더해 들어오므로(tacticBeats), 재료 문장을 그 아래에 두면 아무리 늘려도
 *  자리를 못 얻는다 — 이야깃거리가 큰 업그레이드(랭크 4~6)가 전술과 겨룰 만한 자리에 오게
 *  base를 맞춘다. 흔한 속업·사업(랭크 2)은 여전히 자리가 남을 때만 나온다. */
const UPGRADE_BASE_WEIGHT = 11;
/** 이 점수 아래는 문장을 따로 세우지 않는다 — 그 유닛을 쓰면 으레 따라오는 업그레이드다. */
const UPGRADE_MIN_RANK = 2;
/** 한 요약에 같은 갈래 문장을 이만큼까지 — 곁가지가 도배되면 정작 승부 이야기가 밀린다. */
const PER_KEY_CAP: Record<string, number> = {
  tech: TECH_BEATS_PER_SUMMARY, "upgrade-signature": 2, upgrade: 2,
  /* 물량은 둘까지 — 여덟 명이 붙는 판에서 서넛이 한꺼번에 걸리면 같은 모양의 문장이
     줄줄이 서서, 정작 그 판의 사건들이 밀려난다. 둘이면 "양쪽 다 물량전이었다"가 읽힌다. */
  "mass-army": 2,
  /* 급습은 한 줄이면 된다 — 상대별로 살려 두지만(replayTactics의 scanTactics) 그건 '가장
     큰 급습이 사람에 따라 묻히지 않게' 하려는 것이지, 급습 이야기를 여럿 늘어놓자는 게
     아니다. 실제로 통한 급습은 raid-damage로 바뀌어 이 상한을 안 받는다. */
  "base-raid": 1,
  /* 큰 교전은 CLASH_BEATS_MAX까지(요청: 큰 교전이 여러 번이면 여러 번 나오는 게 맞다).
     그중 그 판의 절정 하나만 필수고(mustKeep), 나머지는 다른 이야기들과 무게로 겨룬다. */
  clash: CLASH_BEATS_MAX,
  /* 급습이 통한 이야기(raid-damage로 바뀐 것)는 둘까지 — 8인전에서는 서로가 서로의 집을
     헤집어서, 상대별로 살려 두면 같은 꼴의 문장이 넷씩 늘어선다(실측). 이름 있는 전술에서
     온 raid-damage는 이 상한을 안 받는다(그건 저마다 다른 이야기다). */
  "raid-damage:base": 2,
};

/** 갈래 상한을 잴 때 쓰는 키 — 대개 beat 키 그대로지만, 같은 raid-damage라도 이름 없는
 *  급습에서 온 것만 따로 센다(위 PER_KEY_CAP 참고). */
const capKeyOf = (b: { k: string; p?: Record<string, unknown> }): string => (
  b.k === "raid-damage" && b.p?.k === "base-raid" ? "raid-damage:base" : b.k
);

/** 목표를 못 짚으면 뜻이 옅어지는 수들(요청) — 드랍은 '어디에 내렸나'가 그 수의 전부이고,
 *  병력을 뽑아 나갔다는 이야기는 '누구에게 갔나'가 없으면 생산 이야기와 다르지 않다.
 *  러시·몰래건물은 여기 안 넣는다: 그건 목표를 몰라도 '언제 무엇을 갔나'가 곧 이야기다. */
/** 그 beat가 곧 '이 유닛 이야기'인 키들 — 위 unitSig가 같은 사람의 같은 유닛 이야기를
 *  한 번으로 줄이는 데 쓴다. 여기 없는 키는 p.unit이 있으면 그 값을 쓴다(패스트 OO,
 *  파워 OO, 끝까지 뽑은 유닛 …). */
/** 그 이야기가 어느 유닛의 이야기인가 — 수(p.k)의 이름에 유닛이 박혀 있는 것들이다.
 *  p.unit을 따로 싣지 않는 갈래라(러시는 '몇 게이트에서 몇 기'가 본론이다) 아래
 *  UNIT_STORY_KEYS·p.unit만 보던 중복 판정이 이 이야기들을 못 걸렀다(지적: 같은 내용이
 *  두 번 연속 — "브래드가 Rex에게 3게이트 질럿 러시를 했다" 바로 뒤에 "브래드가 질럿을
 *  118기나 뽑아내며 물량으로 몰아쳤다"가 같은 시각으로 붙었다). */
/** '들이친 이야기' — 같은 사람이 한 장면 안에서 같은 상대에게 이 갈래로 두 번 걸리면
 *  그건 한 번의 진격이다(위 sameEvent). 건물을 박은 수(포토러시·성큰러시·몰래 배럭)는
 *  넣지 않는다 — 병력을 몰고 간 것과 같은 때에 벌어져도 서로 다른 일이다. */
const PUSH_STORY_KEYS = new Set([
  "zealot-rush", "zling-rush", "duel-rush", "hydra-rush", "marine-rush", "vulture-rush",
  "gang-rush", "base-raid", "raid-damage",
  "shuttle-reaver", "templar-drop", "zerg-drop", "dropship", "shuttle",
  "harass-workers", "harass-long",
]);

const TACTIC_UNIT: Record<string, string> = {
  "zealot-rush": "Zealot", "zling-rush": "Zergling", "duel-rush": "Zealot",
  "hydra-rush": "Hydralisk", "marine-rush": "Marine", "vulture-rush": "Vulture",
};

const UNIT_STORY_KEYS: Record<string, string> = {
  carrier: "Carrier", bc: "Battlecruiser", guardian: "Guardian", devourer: "Devourer",
  valkyrie: "Valkyrie", muta: "Mutalisk", ultra: "Ultralisk", moka: "Ultralisk",
  arbiter: "Arbiter", lurker: "Lurker", "cloak-wraith": "Wraith",
  vessel: "Science Vessel", "zealot-templar": "High Templar", queen: "Queen",
};

const NEED_TARGET_KEYS = new Set([
  "shuttle", "shuttle-reaver", "templar-drop", "zerg-drop", "dropship",
  "bionic", "mech", "moka", "zealot-templar",
  // 패스트 OO도 마찬가지다(지적: "일찍 뽑아서 어딜 갔는지가 없네") — 어디로도 안 간 빠른
  // 테크는 '들이댄 수'가 아니라 그냥 빌드 순서라, 목표를 못 짚으면 무게를 내린다.
  "fast-tech",
]);
const NO_TARGET_PENALTY = 10;
/** 타겟이 없으면 아예 문장이 되지 않는 수들(요청: 타겟 없는 러시는 문장에 안 나오게).
 *  병력을 몰고 갔다는 이야기인데 어디로 갔는지도 누구에게 갔는지도 없으면 남는 뜻이 없다.
 *  건물을 박는 러시(포토·성큰·몰래배럭)는 그 건물 자리가 곧 타겟이라 여기 들어와도
 *  정상적으로는 안 걸린다 — 자리를 못 읽은 리플레이에서만 걸러진다. */
const RUSH_NEED_TARGET = new Set([
  "zling-rush", "zealot-rush", "duel-rush", "cannon-rush", "sunken-rush", "sneak-rax",
]);

/** 러시는 '뽑은 때'와 '닿은 때'가 다르다 — 그래서 목표를 앞뒤 창으로만 찾으면 늘 빈손이다
 *  (지적: 질럿 러시의 타겟이 없다). 이 beat들의 at은 첫 유닛이 나온 프레임이고, 그 병력이
 *  상대에게 닿는 것은 그 뒤다. 실측한 4:4에서 크리스의 3게이트 질럿 러시는 2분에 잡혔는데
 *  실제로 정구의 유닛을 찍기 시작한 것은 8분 36초였고, 그 무렵 정구 진영 안에 명령 142개가
 *  몰렸다 — 앞뒤 90초만 보는 창으로는 그 사실이 통째로 안 보인다.
 *
 *  그래서 러시 계열만 '앞으로' 길게 본다. 대신 두 가지로 좁힌다: ①그 사람이 그 경기에서
 *  처음으로 상대 유닛을 찍은 순간이어야 하고(중반 교전을 러시의 결과로 끌어오지 않는다)
 *  ②그 창을 넘기면 아무것도 안 붙인다. */
const RUSH_LAND_KEYS = new Set([
  "zling-rush", "zealot-rush", "cannon-rush", "sunken-rush", "sneak-rax", "duel-rush",
  // 패스트 OO도 같은 사정이다(지적) — at은 그 유닛이 처음 나온 프레임이라 앞뒤 창으로는
  // 늘 빈손이고, 정작 "일찍 뽑아서 어디로 갔나"는 그 병력이 처음 닿은 자리에 있다.
  "fast-tech",
]);
const RUSH_LAND_SEC = 8 * 60;

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
  "nydus", "recall", "bionic", "mech", "moka", "zealot-templar",
  // 빠른 테크·클로킹 레이스도 들이치는 수다 — 그 타이밍에 상대가 꺾였으면 그게 결과다(요청).
  "fast-tech", "cloak-wraith",
  // 이름 없는 급습(replayTactics의 raidOn) — 뮤탈 여섯 기로 본진을 헤집는 것처럼 어느
  // 전술 이름에도 안 걸리지만 상대가 실제로 꺾였으면 그게 이 판의 큰 사건이다(지적).
  "base-raid",
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
    const top = topUsedTech(s);
    if (top) techs.add(top);
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

/** 그 사람이 그 무렵 굴리던 주력 — 그때까지 뽑아 둔 전투 유닛을 인구수로 달아 상위부터.
 *
 *  화살표 이름표의 최후 보루다(요청: 모든 화살표에는 유닛이나 건물명이 꼭 들어가야 함).
 *  1순위는 '그 자리에 실제로 찍은 명령의 주인'(forceAt)이지만, 명령에 주인이 안 잡히는
 *  경우가 드물지 않아 — 화살표는 그려지는데 무엇으로 갔는지가 통째로 비었다(지적한
 *  스크린샷: 폭발 이모지만 있고 유닛명이 없다). 그때는 '그 사람이 그때 갖고 있던 병력'으로
 *  메운다. 그 자리에 간 것이 그중 무엇인지까지는 알 수 없지만, 적어도 그 사람 자신의
 *  병력이라 틀린 이름이 붙지는 않는다. */
function armyAtFrame(p: ParsedReplayPlayer, at: number | null): string[] {
  const s = p.signals;
  if (!s) return [];
  const pick = (workers: boolean): string[] => {
    const tally = new Map<string, number>();
    for (const [unit, frames] of Object.entries(s.unitFrames)) {
      if (NON_COMBAT_UNITS.has(unit)) continue;
      if (WORKER_UNITS.has(unit) !== workers) continue;
      if (!UNIT_KO[unit]) continue;
      const n = at === null ? frames.length : frames.filter((f) => f <= at).length;
      if (n > 0) tally.set(unit, n * supplyOf(unit));
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
  };
  const army = pick(false);
  /* 전투 유닛이 아직 하나도 없는 이른 장면(2분 안쪽의 정찰·일꾼 싸움)에서는 일꾼이 답이다 —
     그때 그 사람이 움직일 수 있는 것이 그것뿐이라, 억지로 끼워 맞춘 이름이 아니다. */
  return army.length > 0 ? army : pick(true);
}

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
/** 후반까지 살아 있었나 — 경기의 앞 2/3 안에 생산이 끊겨 끝내 회복하지 못한 사람은 뺀다.
 *  결론은 종반의 이야기라, 그때 이미 빈사였던 사람의 조합을 주어로 세우면 안 된다(지적). */
const LATE_ALIVE_RATIO = 2 / 3;
function lateAliveOf(totalFrames: number | null): (p: ParsedReplayPlayer) => boolean {
  return (p) => {
    if (!totalFrames) return true;
    const f = eliminatedFrame(p) ?? productionCollapse(p, totalFrames);
    return f === null || f >= totalFrames * LATE_ALIVE_RATIO;
  };
}

function standout(side: Side, alive?: (p: ParsedReplayPlayer) => boolean): ParsedReplayPlayer | null {
  // 맺음말에서는 '그때까지 살아 있던 사람'만 고른다(지적: 이미 빈사인 플레이어의 유닛이
  // 결론에 나온다) — 초반에 무너진 사람이 후반 이야기의 주어가 되면 앞뒤가 안 맞는다.
  const pool = alive ? side.players.filter(alive) : side.players;
  const ranked = (pool.length > 0 ? pool : side.players)
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

/** 그 사람이 '그 시점까지' 뽑아 둔 전투 유닛 — ownCombat의 시간 제한판.
 *
 *  시점이 박힌 장면의 문장은 그 시점의 것만 말해야 한다(지적: 초반 설명에 말도 안 되는 후반
 *  유닛이 나온다). 실측한 예: 2분 26초에 걸린 포토러시 돌파 문장이 "캐리어 포토 70개를
 *  걷어냈다"로 나갔다 — 캐리어는 20분 넘어 나왔고 포토도 그때까지 두어 개였다. 경기 전체
 *  누계(unitCounts)를 그대로 쓴 탓이다. 프레임이 안 잡히면(at===null) 원래대로 전체를 본다. */
function combatBetween(
  p: ParsedReplayPlayer,
  from: number | null,
  to: number | null
): Map<string, number> {
  if (from === null && (to === null || !Number.isFinite(to))) return ownCombat(p);
  const out = new Map<string, number>();
  const s = p.signals;
  if (!s) return out;
  const lo = from ?? Number.NEGATIVE_INFINITY;
  const hi = to === null || !Number.isFinite(to) ? Number.POSITIVE_INFINITY : to;
  for (const [unit, fs] of Object.entries(s.unitFrames)) {
    if (NON_COMBAT_UNITS.has(unit)) continue;
    if (!UNIT_KO[unit]) continue;
    const n = fs.reduce((acc, f) => (f >= lo && f <= hi ? acc + 1 : acc), 0);
    if (n > 0) out.set(unit, n);
  }
  return out;
}

/** 그 시점의 주력 한 종류 — 없으면(아직 아무것도 안 뽑은 이른 장면) null이다. */
function topCombatAt(p: ParsedReplayPlayer, at: number | null): string | null {
  return [...combatBetween(p, null, at).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** 그 뒤로 이만큼 동안 뽑은 것까지가 '그 수로 얻은 것'이다 — 확장 문장처럼 원인이 앞에,
 *  결과가 뒤에 오는 이야기에 쓴다. */
const PAYOFF_SEC = 360;

function topCombatAfter(p: ParsedReplayPlayer, at: number | null): string | null {
  if (at === null || !Number.isFinite(at)) return topCombatAt(p, null);
  const to = at + PAYOFF_SEC / SECONDS_PER_FRAME;
  /* 뒤 창에서 가장 많이 쏟아낸 것을 고르되, 그 시점에 이미 굴리던 것 중에서 고른다 —
     문장 앞에 시각이 붙어 있으므로 그때 없던 유닛을 말하면 그대로 어긋난다(지적). */
  const already = combatBetween(p, null, at);
  const win = [...combatBetween(p, at, to).entries()]
    .filter(([u]) => already.has(u))
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  // 뒤 창에 아무것도 없으면 그때까지 굴리던 것으로 말한다.
  return win ?? topCombatAt(p, at);
}

/** 그 건물을 n개까지 올린 시점 — "포토 70개로 막았다"는 70번째 포토가 선 뒤의 이야기다.
 *  프레임이 안 남은 건물이면 첫 건물 프레임으로 물러선다(예전 동작). */
function nthBuildingFrame(p: ParsedReplayPlayer, b: string, n: number): number | null {
  const fs = p.signals?.buildingFrames[b];
  if (!fs || fs.length === 0) return p.signals?.firstBuildingFrame[b] ?? null;
  const sorted = [...fs].sort((x, y) => x - y);
  return sorted[Math.min(n, sorted.length) - 1] ?? sorted[sorted.length - 1];
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
 *  대신 커맨드가 끊긴 시점이 그 사람이 판에서 사라진 시점이다.
 *
 *  누가 달려들었는지는 병력을 어디로 보냈는지로 본다(pushersOn) — 그 사람 진영 안쪽에
 *  이동·공격 명령이 몇 번이나 찍혔는가. 예전에는 '그때까지 병력을 낸 상대'를 세었는데,
 *  그건 뒤에서 자기 할 일 하던 사람까지 합공에 넣는 셈이라 넷이 붙은 판에서 늘 "넷이
 *  몰아쳤다"가 됐다(지적: 3컬러 러시였는데 그런 게 안 나온다 — 실제로는 셋이었다).
 *  좌표를 못 읽는 리플레이에서는 자리 근거가 통째로 없으므로 예전 기준으로 돌아간다.
 *
 *  창은 경기 시작부터 무너진 때까지다 — 어차피 초반(GANG_RUSH_SEC 안쪽)에 무너진 경우만
 *  보므로 그 구간 전체가 곧 '달려든 시간'이다. */
function gangRush(
  victims: ParsedReplayPlayer[],
  attackers: ParsedReplayPlayer[],
  totalFrames: number | null
): { victim: ParsedReplayPlayer; by: ParsedReplayPlayer[] }[] {
  const out: { victim: ParsedReplayPlayer; by: ParsedReplayPlayer[] }[] = [];
  for (const v of victims) {
    const fell = fellFrame(v, totalFrames);
    if (fell === null || fell * SECONDS_PER_FRAME > GANG_RUSH_SEC) continue;
    // '달려든 사람'의 잣대는 당한 쪽이다 — 그 시점까지 당한 사람보다 병력이 앞서 있어야
    // 몰려간 것이지, 절대 몇 기냐로는 맵마다 뜻이 달라진다(지적).
    const bar = Math.max(GANG_ARMED_FLOOR, combatBefore(v, fell) * GANG_ARMED_RATIO);
    const armed = attackers.filter((a) => combatBefore(a, fell) >= bar);
    const pushed = new Set(pushersOn(v, attackers, 0, fell));
    // 자리로 짚힌 사람이 둘 이상이면 그쪽이 답이다. 하나도 못 짚었으면(좌표 없음) 예전 기준.
    const by = pushed.size >= 2 ? armed.filter((a) => pushed.has(a.rawName)) : armed;
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
// 아래 두 값은 '중반(5~10분)' 기준이고, 실제로 쓸 때는 그 시각의 배율을 곱한다
// (sceneWindowSec — 초반엔 좁게, 후반엔 넓게. 요청).
const RAID_MERGE_SEC = 90;

// (삭제) CLUSTER_SEC — 같은 편 이야기를 붙여 읽으려고 시간순을 조금 어기던 창. 자막이
// 초까지 적게 되면서 그 규칙 자체를 걷어냈다(위 정렬 아래 주석).

/** 한 사람이 여러 수에 잇달아 무너진 걸 두 문장으로 말하지 않는다(지적) — "Rex의 9드론
 *  저글링 러시와 제롬의 4게이트 질럿 러시에 군범이 2분 만에 무너짐"으로 묶는다. */
function mergeRaids(list: Beat[]): Beat[] {
  const raids = list.filter((b) => b.k === "raid-damage" && (b.whom?.length ?? 0) > 0);
  if (raids.length <= 1) return list;
  const groups: Beat[][] = [];
  for (const b of [...raids].sort((x, y) => (x.at ?? 0) - (y.at ?? 0))) {
    const g = groups.find((x) =>
      x[0].whom?.[0] === b.whom?.[0]
      && Math.abs((x[0].at ?? 0) - (b.at ?? 0)) * SECONDS_PER_FRAME
        <= sceneWindowSec(RAID_MERGE_SEC, x[0].at));
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
        && Math.abs((x.at ?? 0) - (r.at ?? 0)) * SECONDS_PER_FRAME
          <= sceneWindowSec(RAID_MERGE_SEC, r.at),
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

/** '서로 주고받았다'고 말하려면 맞불을 놓은 쪽도 이만큼은 썼어야 한다. */
const SPELL_TRADE_MIN = 3;

/** 같은 마법을 서로 퍼부은 싸움은 한 문장이다 — 하이템플러 둘이 같은 자리에서 스톰을 27번,
 *  24번 뿌린 대목을 양쪽에서 한 문장씩 말하면 같은 장면이 두 번 나온다(실측한 8인전에서
 *  "[Jeong9]가 chris_sje의 하이템플러와 맞붙어 스톰을 27번", "chris_sje가 [Jeong9]의
 *  하이템플러와 맞붙어 스톰을 24번"이 나란히 섰다). 많이 쓴 쪽을 주어로 남기고 상대의
 *  횟수를 함께 실어, 문장이 "27번·24번 주고받았다"로 읽히게 한다. */
function mergeSpellDuels(list: Beat[]): Beat[] {
  /** 두 좌표가 같은 싸움터라 할 만큼 가까운가 — 둘 다 있어야 견줄 수 있다. */
  const near = (a: unknown, b: unknown, r: number): boolean => {
    const ok = (v: unknown): v is [number, number] =>
      Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number";
    return ok(a) && ok(b) && Math.hypot(a[0] - b[0], a[1] - b[1]) <= r;
  };
  const spells = list.filter((b) => b.k === "tech" && b.p?.fight === true);
  const drop = new Set<Beat>();
  const out = new Map<Beat, Beat>();
  for (const a of spells) {
    if (drop.has(a) || out.has(a)) continue;
    const foe = a.whom?.[0];
    /* 같은 싸움이었나는 자리로 본다 — 서로를 상대로 짚었다는 것 자체가 이미 시간이
       겹친다는 뜻이라(fightersAt이 그 창 안에서만 사람을 짚는다), 시각까지 다시 재면
       오래 이어진 스톰 싸움이 갈라진다(실측: 한 8인전에서 두 뭉치의 시작이 3분 40초
       벌어져 있었는데 자리는 7타일 차이였다). */
    const mate = spells.find((b) => b !== a && !drop.has(b) && !out.has(b)
      && b.who[0] === foe && b.whom?.[0] === a.who[0]
      && b.p?.tech === a.p?.tech
      && near(a.p?.xy, b.p?.xy, CAST_HOT_RADIUS));
    if (!mate) continue;
    const [keep, gone] = (a.p?.n as number ?? 0) >= (mate.p?.n as number ?? 0)
      ? [a, mate] : [mate, a];
    drop.add(gone);
    const goneN = typeof gone.p?.n === "number" ? gone.p.n : 0;
    // 한두 번 맞불을 놓은 것은 '주고받았다'가 아니다("15번·1번 퍼부으며 맞섰다"는 사실을
    // 부풀린 말이다) — 그런 쪽은 수를 말하지 않고 조용히 덜어 내기만 한다.
    if (goneN < SPELL_TRADE_MIN) continue;
    out.set(keep, {
      ...keep,
      // 이야기의 시점은 그 싸움이 시작된 때다 — 많이 쓴 쪽이 늦게 합류했을 수도 있다.
      at: [keep.at, gone.at].filter((v): v is number => typeof v === "number")
        .reduce<number | null>((m, v) => (m === null ? v : Math.min(m, v)), null),
      // 서로 퍼부은 싸움은 한쪽만 말할 때보다 더 그 판의 장면이다.
      weight: Math.max(keep.weight, gone.weight) + 2,
      p: { ...(keep.p ?? {}), vsN: goneN },
    });
  }
  if (drop.size === 0) return list;
  return list.filter((b) => !drop.has(b)).map((b) => out.get(b) ?? b);
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
  /** 자리를 다투기 전에 먼저 넣을 문장인가(아래 MUST_KEEP) — 같은 갈래라도 하나만
   *  그런 경우가 있다: 큰 교전은 여러 번 나오지만 '그 판의 절정' 하나만 필수다.
   *  고를 때만 쓰고 저장하지는 않는다. */
  keep?: boolean;
  /** 이 말이 이미 다른 줄에 나왔으면 이 줄은 버린다 — "7해처리까지 늘려" 옆에 "해처리를
   *  7개까지 늘려"가 또 붙는 걸 막는다. 고를 때만 쓰고 저장하지는 않는다. */
  dedupeOn?: string;
}

// 승부를 가르는 테크만 이야기에 넣는다(요청: 중요한 이벤트만) — 버로우·환상처럼 있어도
// 그만인 연구는 자리만 차지한다. 이름은 TECH_KO에 있는 것 중에서 고른다.
// (삭제) 예전엔 '결정적 테크' 집합 하나를 두고 그중 먼저 연구한 것을 골랐다. 두 가지가
// 문제였다 — 목록에 "Cloaking"처럼 screp에 없는 이름이 섞여 있어도 아무도 못 알아챘고
// (지적), 스팀팩처럼 안 하는 사람이 없는 기술이 늘 먼저 뽑혀 테란 경기 요약이 죄다
// "스팀팩까지 꺼내 씀"이 됐다. 이제 replayTechNames의 TECH_RANK로 '드물수록 높은 점수'를
// 매기고 그중 가장 높은 것 하나를 고른다(topTech).

/** 확장 건물의 한국어 이름 — "멀티를 5개까지"가 아니라 "5해처리까지"로 말한다(요청). */

/** 고를 때만 쓰는 것들(무게·중복 판정)을 떼고 저장할 형태만 남긴다.
 *
 *  시점(at)이 유한한 수가 아니면 null로 눌러 둔다. 맺음말은 '늘 마지막'이라는 뜻으로 at을
 *  Infinity로 두고 정렬에 쓰는데(아래 ending), 그 값이 그대로 남으면 방금 만든 요약과 저장된
 *  요약이 서로 다르게 읽힌다 — JSON은 Infinity를 표현할 수 없어 저장하면 null이 되기
 *  때문이다. 실제로 그 차이가 문장으로 새어 나왔다(실측: 같은 경기가 방금 만든 것은 "승리를
 *  결정지었다", 저장된 것은 "이겼다"). 사람이 보는 건 언제나 저장된 쪽이므로 그쪽에 맞춘다.
 *  묶기(mergeSameFate)에서 시점을 모르는 것끼리 합쳐질 때 생기는 Infinity도 여기서 걸린다. */
/* 무게는 버리지 않고 함께 저장한다(요청: 자막 중요도가 나중에 바뀔 수 있으니 고르는 일은
   보여줄 때 다시 한다) — 저장된 비트만으로 다시 고르려면 그때 쓴 잣대가 같이 있어야 한다.
   dedupeOn·keep은 고르는 동안에만 쓰는 살림이라 그대로 버린다. */
function strip({ weight, dedupeOn: _d, keep: _k, ...b }: Beat): ReplaySummaryBeat {
  const w = Number.isFinite(weight) ? { w: weight } : {};
  return typeof b.at === "number" && !Number.isFinite(b.at)
    ? { ...b, ...w, at: null }
    : { ...b, ...w };
}

/* 스냅에 붙일 대사(요청: "모든 채팅을 다 보여줄 필욘 없을거 같아 — 우리가 스냅으로 선정한
   부근의 채팅만 말주머니로") — 한 판의 채팅은 대부분 짧고 띄엄띄엄이라, 따로 채팅창을 두는
   것보다 그 장면 옆에 붙여 두는 편이 "그때 무슨 말이 오갔나"로 읽힌다.

   창은 ±30초다. 실측(리플레이 22판): 고른 스냅 사이 간격이 중앙 53초라 그 절반쯤이면 한
   대사가 앞뒤 두 스냅에 걸릴 일이 드물고, 그래도 걸리면 가장 가까운 스냅 하나가 가져간다 —
   같은 말이 두 장면에 나오면 두 번 한 말처럼 읽힌다.

   이어 친 말은 한 방울로 묶는다("포토" "지으세요" → "포토 지으세요"). 스타 채팅은 엔터를
   자주 눌러 한 문장이 서너 줄로 쪼개진다(실측: 한 사람이 12초 안에 "7시" "아래" "포 지으세요"
   를 따로 쳤다) — 그대로 두면 말주머니 세 개가 겹쳐 뜬다.

   양쪽이 다 본 말(전체챗)만 싣는다(요청: 팀챗 없애고 전체챗만). 팀끼리 주고받는 말은
   그 판의 이야기가 아니라 그 편의 작전 지시라("3시 너무쨈", "오버조심", "더블넥 포 갈까여?")
   옆에서 읽을 이야기가 못 된다.

   가르는 근거는 '말의 내용'뿐이다 — GG(gg·ㅈㅈ·ww·지지…)와 노엘. 둘 다 상대에게 하는
   말이라 정의상 전체챗이고, 누가 어느 편이든 똑같이 걸린다.

   한때는 여기에 리플레이 구조로 짚는 근거를 하나 더 뒀다: 리플레이는 저장한 사람이 '들은'
   말만 담고 팀챗은 같은 편에게만 들리니, 저장자와 다른 편의 말이 남아 있으면 그건
   전체챗이 확실하다 — 판정 자체는 맞다. 그런데 그 판정은 한쪽으로만 선다(지적): 저장자
   팀이 대고 한 말은 팀챗과 못 갈라 빠지고, 상대 팀 것만 실린다. 그러면 같은 성격의 말이
   한쪽만 화면에 뜨는 그림이 되어, 없느니만 못하다. 그래서 걷어냈다. */
const CHAT_MERGE_SEC = 12;
/** 한 스냅에 띄울 말주머니 수 — 지도 위에 뜨는 것이라 더 늘면 지도를 덮는다. */
const CHAT_BUBBLE_MAX = 3;
/** 말주머니 한 개의 글자 수 — 넘치면 잘라 …를 붙인다. */
const CHAT_TEXT_MAX = 40;

type ChatLine = { who: string; text: string; at: number; all?: boolean };

/** 그 말이 '양쪽이 다 본 말'인가 — 내용으로만 짚는다(위 주석). 어느 편이든 잣대가 같다. */
const saidToAll = (c: { text: string }): boolean =>
  GG_RE.test(c.text) || NO_ELIM_RE.test(c.text);

/** 사람마다의 채팅을 '이어 친 것끼리 묶어' 한 줄로 늘어놓는다(시간순). */
function chatLines(replay: ParsedReplay): ChatLine[] {
  const merge = CHAT_MERGE_SEC / SECONDS_PER_FRAME;
  const out: ChatLine[] = [];
  for (const p of replay.players) {
    let last: ChatLine | null = null;
    let lastAt = 0;
    for (const c of p.signals?.chats ?? []) {
      const text = c.text.trim();
      if (typeof c.frame !== "number" || !text) continue;
      if (last !== null && c.frame - lastAt <= merge) {
        last.text = `${last.text} ${text}`;
        // 묶은 말 중 하나라도 전체챗이면 그 방울은 전체챗이다(가장 흔한 꼴이 "고생하셨습니다 ㅈㅈ").
        if (saidToAll(c)) last.all = true;
      } else {
        last = { who: p.rawName, text, at: c.frame, ...(saidToAll(c) ? { all: true } : {}) };
        out.push(last);
      }
      lastAt = c.frame;
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** 각 대사를 가장 가까운 스냅 하나에 붙인다 — 그 스냅의 주인공 것을 먼저 태운다.
 *
 *  여기까지 오는 것은 GG와 노엘뿐이라(위 전체챗 거르기) 한 판에 많아야 서너 마디다.
 *  그래서 '얼마나 가까운가'는 안 따진다 — 예전엔 30초 안에 스냅이 없으면 버렸는데,
 *  버려지는 것이 하필 그 판의 GG였다(실측 22판: 스물여덟 중 셋이 그렇게 사라졌다). */
function withChat<T extends { k: string; at?: number | null; who?: string[]; whom?: string[] }>(
  replay: ParsedReplay, beats: T[],
): T[] {
  const lines = chatLines(replay);
  if (lines.length === 0) return beats;
  const picked = new Map<number, { who: string; text: string; at: number }[]>();
  for (const line of lines) {
    if (line.all !== true) continue;   // 전체챗만(위 주석)
    let best = -1;
    let gap = Infinity;
    beats.forEach((b, i) => {
      if (typeof b.at !== "number" || !Number.isFinite(b.at)) return;
      const d = Math.abs(b.at - line.at);
      if (d < gap) { gap = d; best = i; }
    });
    if (best < 0) continue;
    (picked.get(best) ?? picked.set(best, []).get(best)!).push({
      ...line,
      text: line.text.length > CHAT_TEXT_MAX ? `${line.text.slice(0, CHAT_TEXT_MAX)}…` : line.text,
    });
  }
  return beats.map((b, i) => {
    const mine = picked.get(i);
    if (mine === undefined) return b;
    /* 사람마다 한 방울까지 — 말주머니는 그 사람 아바타에 붙으므로 둘이면 같은 자리에
       겹친다. 이어 친 말은 이미 묶여 있고(chatLines), 그래도 두 방울이 남으면 그 장면에
       더 가까운 쪽을 남긴다. */
    const one = new Map<string, ChatLine>();
    for (const c of mine) {
      const kept = one.get(c.who);
      const at = b.at as number;
      if (kept === undefined || Math.abs(c.at - at) < Math.abs(kept.at - at)) one.set(c.who, c);
    }
    /* 그 장면의 주인공(who·whom)을 먼저 태운다 — 자리가 모자랄 때 남길 말을 고르는 순서일
       뿐이고, 스냅에 안 나오는 사람의 말도 그대로 붙는다(요청). */
    const cast = new Set([...(b.who ?? []), ...(b.whom ?? [])]);
    const lines = [...one.values()];
    const ordered = [...lines.filter((c) => cast.has(c.who)), ...lines.filter((c) => !cast.has(c.who))];
    return {
      ...b,
      chat: ordered.slice(0, CHAT_BUBBLE_MAX).sort((x, y) => x.at - y.at)
        // all은 여기까지 오는 모든 줄이 true라(위 전체챗 거르기) 저장할 것이 없다.
        .map(({ who, text, at }) => ({ who, text, at })),
    };
  });
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

/** 그 편의 '한 방' 유닛(없으면 undefined) — 많이 뽑은 순이 아니라 드문 순이다
 *  (SPECTACLE_RANK 주석 참고). 같은 순위면 많이 뽑은 쪽. */
function spectacleOf(side: Side): string | undefined {
  return [...side.combat.entries()]
    .filter(([u, n]) => SPECTACLE_UNITS[u] && n > 0)
    .sort((a, b) => (SPECTACLE_RANK[b[0]] ?? 0) - (SPECTACLE_RANK[a[0]] ?? 0) || b[1] - a[1])[0]?.[0];
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
    { pro: "박성준", style: "공격 저그", units: ["Hydralisk", "Mutalisk"] },
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
  const lateAlive = lateAliveOf(totalFrames);
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
    const spread = hasUpgrade(sg, "Pneumatized Carapace");
    const unit = obs >= 4 ? "Observer" : spread && ovl >= 8 ? "Overlord" : null;
    if (!unit) continue;
    /* 열쇠를 둘로 가른다(요청) — 오버로드를 퍼뜨린 것은 초반에 미리 깔아 두는 정찰이고,
       옵저버·스캔은 판이 굴러가는 동안 전장을 열어 보는 눈이다. 칭호가 그 둘을 다른
       이름으로 부르므로(부지런한 정찰 퀸 / 전장을 살피는 눈) 세는 자리부터 갈라야 한다 —
       서버는 beat의 열쇠만 세고 p.unit은 안 본다. */
    beats.push({
      k: unit === "Observer" ? "vision-eye" : "vision", won, who: who(p), weight: 6,
      at: sg.firstUnitFrame[unit] ?? null,
      p: { unit },
    });
  }

  /* 스캔도 정찰이다(요청: 스캔·오버로드·옵저버로 여기저기 정찰한 것도 묘사 포인트).
     테란은 옵저버처럼 띄워 두는 눈이 없어서 이 갈래가 통째로 빠져 있었는데, 스캔은
     오히려 근거가 더 좋다 — 쓴 시각과 좌표가 그대로 남는다(castPositions). '몇 번
     뿌렸나'와 '누구의 집을 열어 봤나'를 그 좌표에서 바로 센다.

     실측(테란 225명): 스캔 횟수는 중앙 2회·75% 6회·90% 11회이고 아예 안 쓴 사람이 86명
     이다. 여덟 번부터가 '판을 훑어봤다'고 할 만한 선이고(18%), 뿌린 폭은 중앙 74타일이라
     한 자리만 들여다본 것이 아니다. */
  const foeHomes = other.players
    .map((q) => (typeof q.startX === "number" && typeof q.startY === "number"
      ? { raw: q.rawName, x: q.startX, y: q.startY } : null))
    .filter((v): v is { raw: string; x: number; y: number } => v !== null);
  /* 일꾼 초반 정찰(요청: 일꾼으로 초반 정찰한 것도) — 첫 일꾼을 상대 진영까지 보내 살림을
     먼저 보고 오는 그 습관이다. 근거는 '일꾼에게 내린 이동·공격 명령의 좌표'다(파서의
     orderPositions.by === "Worker") — 그 좌표가 상대 시작 지점 언저리면 거기까지 몰고
     갔다는 뜻이고, 시각도 그대로 남는다.
     초반만 본다: 중반 이후의 일꾼 이동은 확장을 펴러 가거나 건물을 지으러 가는 길이라
     정찰이 아니다. 상대 집 반경도 스캔 정찰과 같은 자를 쓴다(SCAN_BASE_TILES) — 같은
     '남의 집을 열어 봤다'를 재는 자리라 잣대가 하나여야 한다. */
  for (const p of players) {
    const sg = p.signals;
    if (!sg || foeHomes.length === 0) continue;
    const early = (sg.orderPositions ?? []).filter(
      (o) => o.by === "Worker" && o.frame <= WORKER_SCOUT_SEC / SECONDS_PER_FRAME,
    );
    if (early.length === 0) continue;
    const peekedHomes = foeHomes.filter(
      (h) => early.some((o) => Math.hypot(o.x - h.x, o.y - h.y) <= SCAN_BASE_TILES),
    );
    if (peekedHomes.length === 0) continue;
    const at = early.find(
      (o) => peekedHomes.some((h) => Math.hypot(o.x - h.x, o.y - h.y) <= SCAN_BASE_TILES),
    )?.frame ?? null;
    beats.push({
      // 오버로드 정찰과 같은 열쇠다 — 둘 다 '미리 깔아 두고 먼저 보는' 초반 정찰이고,
      // 칭호도 한 이름으로 부른다(부지런한 정찰 퀸).
      k: "vision", won, who: who(p), weight: 6, at,
      p: { unit: "Worker", spots: peekedHomes.length },
    });
  }

  for (const p of players) {
    const sg = p.signals;
    if (!sg) continue;
    const scans = (sg.castPositions ?? []).filter((c) => c.tech === "Scanner Sweep");
    if (scans.length < SCAN_SCOUT_MIN) continue;
    // 상대 기지를 열어 본 수 — 시작 지점 SCAN_BASE_TILES 안이면 그 사람 집을 본 것이다.
    const peeked = foeHomes.filter(
      (h) => scans.some((c) => Math.hypot(c.x - h.x, c.y - h.y) <= SCAN_BASE_TILES),
    ).length;
    /* 어디를 열어 봤나 — 그 자리들을 그대로 실어 보낸다(지적: 스캔을 본진에 찍어 놓으면
       어쩌나, 스캔한 곳들을 표시해야지). 그림 쪽은 이 좌표가 없으면 '그 사람이 그 무렵
       명령을 낸 자리'로 대신 그리는데, 스캔은 커맨드센터가 제자리에서 쏘는 것이라 그
       자리가 늘 제 본진이었다.
       가까운 것끼리는 한 자리로 본다 — 한 곳을 두세 번 이어 찍은 것은 한 번 들여다본
       것이고, 화살표도 겹쳐 그려진다. 시간순으로 훑으며 이미 잡은 자리와 SCAN_SPOT_TILES
       안쪽이면 건너뛰고, 지도가 화살표로 덮이지 않게 SCAN_SPOT_MAX까지만 싣는다. */
    /* 좌표는 [x1,y1,x2,y2,…] 한 줄로 편다 — beat의 p에 담을 수 있는 것이 스칼라와
       그 배열뿐이라(ReplaySummaryBeat), 짝지어 담을 자리가 없다. 읽는 쪽이 둘씩 끊는다. */
    const spotsXY: number[] = [];
    const taken: [number, number][] = [];
    for (const c of scans) {
      if (taken.some((q) => Math.hypot(q[0] - c.x, q[1] - c.y) <= SCAN_SPOT_TILES)) continue;
      taken.push([c.x, c.y]);
      spotsXY.push(Math.round(c.x), Math.round(c.y));
      if (taken.length >= SCAN_SPOT_MAX) break;
    }
    beats.push({
      // 스캔은 옵저버와 같은 갈래다(위 주석) — 판 도중에 전장을 열어 보는 눈.
      k: "vision-eye", won, who: who(p), weight: peeked >= 2 ? 9 : 8,
      at: scans[0].frame,
      p: {
        unit: "Scanner Sweep", n: scans.length,
        ...(peeked >= 2 ? { spots: peeked } : {}),
        ...(spotsXY.length > 0 ? { spotsXY } : {}),
      },
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
    const star = standout(side, lateAlive);
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
    // 몇 기까지 뽑았는지도 함께 — "캐리어를 한 부대 뽑았으나 실패함"처럼 규모가 곧 그림이다
    // (요청). 다만 세는 값은 '한때 몇 기를 같이 띄웠나'여야 한다(지적: 총 몇 마리 뽑았는지는
    // 안 중요하고, 죽고 다시 뽑으니까 그 시간대의 수를 세거나 부정확하면 아예 표기하지
    // 않아야 한다) — side.combat의 누계를 그대로 쓰면 죽어서 다시 뽑은 몫까지 더해져 실제
    // 규모보다 훨씬 부풀려진다. windowPeak(replayTactics의 carrier·bc 전술과 같은 잣대)로
    // '한때 함께 떠 있던 수'만 센다. 그 사람이 없거나 값이 0이면 수는 아예 안 싣는다 —
    // 문장 쪽(spectacle 갈래)이 amount가 없으면 알아서 숫자 없는 말로 넘어간다.
    if (spectacle) {
      owner = players
        .map((x) => ({ x, n: x.signals?.unitCounts[spectacle] ?? 0 }))
        .sort((a, b) => b.n - a.n)[0]?.x ?? star;
      const peak = owner?.signals
        ? windowPeak(producedFrames(owner.signals, spectacle, totalFrames))
        : 0;
      p = { mode: "spectacle", unit: spectacle, ...(peak > 0 ? { n: peak } : {}) };
    } else if (pressedEarly && units.length > 0) p = { mode: "pressed", units };
    else if (units.length > 0) {
      p = { mode: units.some((u) => LATE_TECH_UNITS.has(u)) ? "late" : "plain", units };
    } else if (sec > 0 && sec < EARLY_GAME_SEC) {
      p = { mode: "nothing" };
    }
    /* 무엇을 막기에 늦었는지(지적: "뽑았지만 누구를 막기에 늦었는지가 없네") — "아비터까지
       갔지만 늦었다"는 무엇에 늦었다는 건지 알 수 없는 문장이었다. 상대 쪽에서 그 판을 끌고
       간 사람과 그 사람의 주력을 함께 실어, 문장이 "○○의 △△를 막기엔 늦었다"까지 가게 한다.
       상대가 하나뿐이면 그 사람이 곧 답이고, 팀전이면 그 편의 눈에 띈 사람을 쓴다. */
    const rival = other.players.length === 1
      ? other.players[0]
      : standout(other, lateAlive) ?? other.players[0] ?? null;
    const rivalUnits = rival
      ? nameableUnits(mainUnits(ownCombat(rival), armyBySupply([rival])))
      : [];
    if (p) {
      beats.push({
        // 팀전이면 혼자 버틴 게 아니다 — 문장도 "팀원이 도와줬으나"로 갈린다(요청).
        // 진 편이 무엇으로 맞섰나는 결과 문장의 짝이다 — 자리가 모자랄 때 부수적인
        // 사실(센터 건물 등)에 밀려 통째로 빠지면, 이긴 쪽 조합만 남아 경기가 한쪽
        // 이야기가 된다(실제로 골리앗 77기를 뽑은 편의 조합이 계속 안 나왔다).
        k: "stand", won, at: null, weight: 16,
        p: {
          ...p, team: players.length > 1,
          // 이긴 쪽 사람은 whom이 아니라 p.foe다 — whom으로 실으면 '이 사람이 당했다'는
          // 뜻이 되어 그림이 뒤집힌다(relocate·fallen의 by와 같은 이유).
          ...(rival ? { foe: rival.rawName } : {}),
          ...(rivalUnits.length > 0 ? { foeUnits: rivalUnits.slice(0, 2) } : {}),
        },
        who: owner ? who(owner) : players.map((x) => x.rawName),
      });
    }
  }

  // ── 유닛 + 방어 건물로 막아선 그림(요청: "질럿과 성큰으로 방어했지만 실패") ──
  /** 그 사람이 세운 방어 건물 목록 — '러시용 포토'는 방어가 아니라 공격이라 뺀다. */
  const defenseList = (p: ParsedReplayPlayer): [string, number][] =>
    Object.entries(p.signals?.buildingCounts ?? {})
      .filter(([k]) => DEFENSE_KO[k])
      .filter(([k]) => !(k === "Photon Cannon" && cannonIsRush(p)));
  /* 웅크렸다고 말하려면 같은 판 사람들보다 많이 지었어야 한다(지적) — 방어탑 열 채는
     어떤 맵에서는 기본이고 어떤 맵에서는 이례적이라 절대 수로는 가를 수 없다. */
  const turtleBar = Math.max(TURTLE_FLOOR, midOf(
    [...side.players, ...other.players].map((q) => defenseList(q).reduce((a, [, n]) => a + n, 0)),
  ) * TURTLE_RATIO);
  for (const p of players) {
    const sg = p.signals;
    if (!sg) continue;
    const usable = defenseList(p);
    const def = usable.filter(([, n]) => n >= DEFENSE_MIN).sort((a, b) => b[1] - a[1])[0];
    if (!def) continue;
    /* 시점은 '첫 건물'이 아니라 '말하려는 개수가 다 선 때'다 — 첫 포토에 시점을 걸고 개수는
       경기 전체 누계로 말하면, 2분짜리 장면에 40분치 숫자가 실린다(지적). */
    const at = nthBuildingFrame(p, def[0], def[1]);
    const unit = topCombatAt(p, at);
    if (!unit) continue;
    // 방어 건물 총합이 일정 수준을 넘으면 '막을 준비'가 아니라 웅크린 것이라, 그 자체가
    // 이야깃거리다(요청) — 문장에 개수를 싣고 무게도 올린다.
    const total = usable.reduce((acc, [, n]) => acc + n, 0);
    beats.push({
      k: "defense", won, who: who(p), weight: total >= turtleBar ? 10 : 7,
      at,
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
        const at = frames[2] ?? frames[frames.length - 1] ?? null;
        // 확장을 몇 개까지 늘렸나에 더해 그걸로 무엇을 뽑았나까지 말한다(요청) —
        // 확장은 그 자체가 목적이 아니라 생산량으로 이어지는 수다. 그래서 세는 구간은
        // 확장 '뒤'다: 경기 전체에서 고르면 10분짜리 장면에 40분에 나온 유닛이 실린다(지적).
        const unit = topCombatAfter(top.p, at);
        beats.push({
          k: "expand", won, who: who(top.p), weight: 8,
          at,
          p: { n: top.n, kind, ...(unit ? { unit } : {}) },
        });
      }
    }
  }

  // ── 업그레이드 ── 예전엔 업그레이드를 거의 안 봤다. 이름 비교가 늘 어긋나 있었던
  // 탓도 있지만(replayTechNames 주석), 애초에 '몇 단계까지 올렸나'를 세지 않았다.
  // 공/방은 한 단계 올릴 때마다 커맨드가 한 번씩 오므로 나온 횟수가 곧 단계다.
  for (const p of players) {
    const sg = p.signals;
    if (!sg) continue;
    // (1) 공/방 — 그 종족의 묶음 중 가장 많이 올린 줄 하나만 말한다. 3-3이면 "풀업"이다.
    const lines = ARMOR_WEAPON_PAIRS[p.race] ?? [];
    let best: { line: string; w: number; a: number; at: number | null } | null = null;
    for (const { weapon, armor } of lines) {
      const w = upgradeLevel(sg, weapon);
      const a = upgradeLevel(sg, armor);
      if (w + a === 0) continue;
      if (!best || w + a > best.w + best.a) {
        best = { line: UPGRADE_LINE_KO[weapon] ?? "", w, a, at: upgradeFrame(sg, weapon) };
      }
    }
    // 1-1은 거의 다 찍으니 이야깃거리가 아니다 — 합이 4단계(2-2)는 넘어야 말할 값이 된다.
    if (best && best.w + best.a >= 4 && best.line) {
      beats.push({
        // 3-3 풀업은 그 판을 굳힌 사실이라 전술과 겨룰 만하고, 2-2쯤은 자리가 남을 때만.
        // 3-3 풀업은 그 판을 굳힌 사실이라 넉넉히, 2-2쯤은 자리가 남을 때만 — 다만 예전
        // 값(8/6)은 자리를 다투는 최소 무게에 걸려 2-2가 아예 안 나왔다.
        k: "upgrade", won, who: who(p), weight: best.w >= 3 && best.a >= 3 ? 12 : 9,
        at: best.at,
        p: { line: best.line, w: best.w, a: best.a },
      });
    }
    /* (2) 상징 업그레이드 — 속업·사업처럼 이름만 대도 그림이 그려지는 것들(요청: 발업·
       사정거리 같은 유의미한 업그레이드 진술을 더해 달라).

       예전엔 사람마다 '가장 먼저 찍은 것' 하나를 무게 6으로 넣었는데, 자리를 다투는 최소
       무게가 8이라 단 한 번도 문장이 된 적이 없다(기술 문장과 똑같은 함정이었다). 이제
       그 업그레이드의 이야깃거리 점수(UPGRADE_RANK)를 무게에 얹고, 사람마다 둘까지 —
       '가장 이르게 찍은 것'과 '가장 이야깃거리인 것'을 함께 본다. 찍은 시각도 함께 실어
       "5분 만에 저글링 속업"처럼 말할 수 있게 한다: 속업·사업은 다들 하므로 언제 했는지가
       곧 그 판의 빌드다. */
    const sigs = Object.keys(SIGNATURE_UPGRADE_KO)
      .map((key) => ({ key, at: sg.firstUpgradeFrame[key], rank: UPGRADE_RANK[key as keyof typeof UPGRADE_RANK] ?? 0 }))
      .filter((x): x is { key: string; at: number; rank: number } => x.at !== undefined);
    const bySoon = [...sigs].sort((a, b) => a.at - b.at)[0];
    const byRank = [...sigs].sort((a, b) => b.rank - a.rank || a.at - b.at)[0];
    for (const sig of [bySoon, byRank]
      .filter((x, i, arr) => x && arr.indexOf(x) === i)
      // 0점짜리는 문장으로 세우지 않는다 — 그 유닛을 쓰면 으레 따라오는 것이라 소식이
      // 아니다(지적: 인터셉터 증설은 딱히 안 중요하다).
      .filter((x) => x.rank >= UPGRADE_MIN_RANK)) {
      beats.push({
        k: "upgrade-signature", won, who: who(p),
        weight: UPGRADE_BASE_WEIGHT + sig.rank,
        at: sig.at, p: { upgrade: sig.key, min: minutes(sig.at * SECONDS_PER_FRAME) },
      });
    }
  }

  // ── 테크 — 실제로 쓴 것만. 사람마다 하나씩. ──
  // 연구했다는 사실만으로는 아무 일도 안 일어난 것이다(지적: "연구한 것만으로는 아무것도
  // 아니야 실제 사용해야 돼"). 실제 리플레이에서 마인드컨트롤·스톰을 연구해 놓고 한 번도
  // 안 쓴 사람이 있었는데, 예전 코드는 그걸 "마인드컨트롤까지 꺼내 썼다"고 적었을 것이다.
  // 시점도 연구한 때가 아니라 처음 쓴 때다 — 이야기가 벌어진 자리는 그쪽이다.
  /* 무게는 그 기술이 얼마나 이야깃거리인가(TECH_RANK)에 얹는다. 예전엔 6으로 고정이었는데
     자리를 다투는 최소 무게가 8이라, 기술을 실제로 쓴 이야기가 단 한 번도 요약에 오르지
     못했다(실측한 리플레이 일곱 판 전부에서 빠져 있었다) — 마인드컨트롤도 시즈모드도 똑같이
     6이었으니 당연한 결과다. 이제 마인드컨트롤(10)·스톰(7)·스테이시스(7) 같은 것은 넉넉히
     자리를 얻고, 시즈(1)·스팀(1)처럼 뻔한 능력은 여전히 문턱을 못 넘는다. */
  for (const p of players) {
    const sg = p.signals;
    if (!sg) continue;
    for (const t of topUsedTechs(sg, TECH_BEATS_PER_PLAYER)) {
      if ((TECH_RANK[t] ?? 0) < TECH_MIN_RANK) continue;
      const n = techUseCount(sg, t);
      /* 가장 많이 떨어진 자리 — 있으면 그 자리가 이 이야기의 자리다(위 castHotspot).
         시점도 첫 시전이 아니라 그 뭉치가 시작된 때로 잡는다: 문장이 말하는 것도 그림이
         가리키는 것도 그 대목이라, 첫 시전 시각을 쓰면 자막과 그림이 서로 다른 때를 말한다. */
      const hot = castHotspot(sg, t);
      /* 마법은 혼자 쓰는 게 아니다(지적: 스톰을 지진 경우 거의 100% 적과 교전 중인데 혼자
         스톰을 쓴 것처럼 묘사돼서 아쉽다) — 그 자리에서 그 무렵 누구와 엉켜 있었는지를
         찾아 함께 말한다(replayTactics의 fightersAt). 이름이 붙으면 자막이 "누구의 무엇과
         맞붙어 스톰을 퍼부었다"가 되고, 그림도 두 사람의 화살표가 그 자리에서 부딪친다
         (GameResultStory의 p.fight). 근거가 없으면 예전처럼 혼자 쓴 대로만 말한다. */
      const met = hot
        ? fightersAt({ x: hot.xy[0], y: hot.xy[1] }, hot.frames, other.players)[0]
        : undefined;
      beats.push({
        // 많이 쓴 마법일수록 그 경기의 그림에 가깝다 — 스톰 스무 번은 그 판의 주인공이고
        // 다섯 번은 곁들인 수다. 고르는 점수(topUsedTechs)와 같은 자로 잰다.
        k: "tech", won, who: who(p),
        // 싸움터에서 터진 마법은 그 판의 장면이라 조금 무겁게 친다 — 아무도 없는 데서
        // 연습하듯 쓴 것과 교전 한복판에서 퍼부은 것은 이야기의 무게가 다르다.
        weight: TECH_BASE_WEIGHT + (TECH_RANK[t] ?? 0) + Math.min(3, Math.floor(n / 10))
          + (met ? TECH_FIGHT_BONUS : 0),
        at: hot?.at ?? sg.firstTechUseFrame[t] ?? null,
        ...(met ? { whom: [met.raw] } : {}),
        p: {
          tech: t, n, ...(hot ? { xy: hot.xy } : {}),
          ...(met ? { fight: true, ...(met.units.length > 0 ? { vs: met.units } : {}) } : {}),
        },
      });
    }
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
    // 누가 밀어붙여서 무너졌나(지적: 해골이 뜨기 전에 히스토리가 없는 경우가 너무 많다) —
    // 이사(relocate)와 똑같이 그 집까지 병력을 몰고 온 사람으로 짚는다. 이름이 잡히면
    // 문장이 "○○에게 밀려"로 시작해 원인이 생기고, 아래 attackerFor도 그 사람의 공격
    // 문장을 앞줄로 끌어올 수 있게 된다. 창은 무너지기 전 FALLEN_PUSH_WINDOW_MIN분.
    // 창은 무너진 시점 앞뒤로 잡는다. 뒤쪽도 봐야 하는 이유는 fellFrame이 '생산이 끊긴
    // 때'라, 실제로 그 집을 밟는 건 그 조금 뒤이기 때문이다(실측: 13분에 끊긴 판에서
    // 앞쪽만 보면 빈손이었고, 뒤까지 넓히자 실제로 밀고 들어온 사람이 잡혔다).
    // 그래도 못 짚으면 그 판 내내 그 집을 두들긴 사람으로 넓힌다.
    const min = 60 / SECONDS_PER_FRAME;
    const pushBy = fell === null ? null : (
      pushersOn(
        p, other.players,
        Math.max(0, fell - FALLEN_PUSH_WINDOW_MIN * min), fell + FALLEN_PUSH_TAIL_MIN * min,
      )[0] ?? pushersOn(p, other.players, 0, totalFrames ?? Infinity)[0] ?? null
    );
    beats.push({
      k: "fallen", won, who: who(p), weight: 9,
      at: fell,
      // 리플레이에 탈락이 그대로 적혀 있으면 짐작이 아니라 사실로 말한다(요청).
      p: {
        team: players.length > 1, def: guard.def, defN: guard.n,
        ...(panic ? { panic: true } : {}),
        ...(eliminatedFrame(p) !== null ? { out: true } : {}),
        // 때린 사람은 whom이 아니라 p.by다 — whom으로 실으면 '이 사람이 당했다'가 뒤집힌다
        // (relocate의 by 주석 참고).
        ...(pushBy ? { by: pushBy } : {}),
      },
    });
  }

  return beats;
}

/* ── BEST PLAYER ──────────────────────────────────────────────────────────────
   요청: 팀전 한 판마다 BEST PLAYER를 뽑는다(예전 이름은 MVP).

   근거는 '그 판의 이야기에 몇 번 주인공으로 섰나'다. 새 잣대(킬 수 같은 것)를 지어내지
   않는 이유는 리플레이에 그런 값이 아예 없기 때문이다 — 죽음이 안 남는다
   (replaySummaryData의 hp 주석). 반면 요약의 beats는 이미 그 판에서 무슨 일이 있었는지를
   가려낸 결과라, 러시를 갔고 교전을 이겼고 상대 본진을 헤집은 사람은 자연히 여러 번
   이름이 오른다 — 화면이 보여준 이야기와 뽑힌 사람이 어긋나지 않는다는 것도 이 방식의 몫이다.

   후보는 양편 전부다(요청: 진 팀까지 포함해 공평하게). 한동안 이긴 편에서만 뽑았는데,
   그러면 진 편에서 혼자 끝까지 밀어붙인 사람은 이야기에 다섯 번을 올라도 처음부터 후보가
   아니었다 — '그 판을 만든 사람'을 묻는 상에서 편은 물어야 할 것이 아니다. 이긴 편이
   유리한 것은 그대로 남지만(이야기가 그쪽으로 흐르니까) 그건 실제로 잘한 것의 그림자다.

   who(그 일을 한 사람) 2점 · who2(거들었거나 특히 활약한 사람) 1점.
   다만 한 편을 통째로 부르는 문장(승패·팀 전체의 맺음말)은 아무도 가려 주지 못하므로
   세지 않고, 자기가 당한 쪽(whom)으로 이름이 걸린 문장도 공으로 치지 않는다.

   동점이면 그 판에서 뽑은 전투 유닛 보급(sumSupply)으로, 그래도 같으면 유효 APM으로
   가른다 — 이야기에 안 걸린 사람들끼리도 아무나 뽑지 않게 하는 마지막 잣대다.
   그마저 같으면 이긴 편을 앞에 세운다: 여기까지 왔다는 건 두 사람이 남긴 것이 똑같다는
   뜻이라, 마지막 한 끗은 판을 가져간 쪽에 준다. */
const BEST_WHO = 2;
const BEST_WHO2 = 1;

/** 그 판의 BEST PLAYER(원본 게임 아이디) — 개인전이면 undefined.
 *
 *  컴퓨터는 후보가 아니다 — 사람들 사이의 상이라, 낄 자리가 아니다. 양편에 사람이 하나도
 *  없으면 아무도 안 뽑는다. 다만 '팀전인가'는 컴퓨터를 빼기 전 인원으로 본다(그 판은
 *  분명 팀전이었다). */
function bestOf(
  beats: ReplaySummaryBeat[], winners: ParsedReplayPlayer[], losers: ParsedReplayPlayer[],
): string | undefined {
  if (winners.length < 2) return undefined;
  const people = [...winners, ...losers].filter((p) => !p.isComputer);
  if (people.length === 0) return undefined;
  const names = people.map((p) => p.rawName);
  const score = new Map(names.map((n) => [n, 0]));
  const add = (raw: string, n: number) => {
    const cur = score.get(raw);
    if (cur !== undefined) score.set(raw, cur + n);
  };
  /* 한 편을 통째로 부르는 문장인가 — 이제 후보가 양편이므로 '이긴 편 전부'만 볼 수 없다.
     어느 한쪽 편의 사람 전부가 who에 들어 있으면 그 문장은 그 편의 맺음말이다. */
  const sides = [winners, losers].map((s) => s.filter((p) => !p.isComputer).map((p) => p.rawName))
    .filter((s) => s.length > 0);
  for (const b of beats) {
    const who = b.who ?? [];
    const whom = b.whom ?? [];
    if (!sides.some((side) => side.every((n) => who.includes(n)))) {
      for (const w of who) if (!whom.includes(w)) add(w, BEST_WHO);
    }
    for (const w of b.who2 ?? []) if (!whom.includes(w)) add(w, BEST_WHO2);
  }
  const supply = new Map(people.map((p) => [p.rawName, sumSupply(p)]));
  const eapm = new Map(people.map((p) => [p.rawName, p.eapm ?? 0]));
  const won = new Set(winners.map((p) => p.rawName));
  return [...names].sort((a, b) =>
    (score.get(b)! - score.get(a)!)
    || (supply.get(b)! - supply.get(a)!)
    || (eapm.get(b)! - eapm.get(a)!)
    || (Number(won.has(b)) - Number(won.has(a))))[0];
}

/**
 * 경기 요약. 재료가 모자라면(커맨드 스트림 없음/승자 미확정/유닛 이름 못 읽음) null.
 * 돌려주는 건 문장이 아니라 저장할 데이터다 — 문장은 renderReplaySummary가 만든다.
 */
export function buildReplaySummary(replay: ParsedReplay): ReplaySummaryData | null {
  if (!replay.winnerSide) return null;
  const sec = replay.durationSeconds ?? 0;
  const totalFrames = sec > 0 ? Math.round(sec / SECONDS_PER_FRAME) : null;
  // 자리(명령 좌표)를 읽을 수 있는 판인가 — screp 버전에 따라 Pos를 안 내려주면 통째로
  // 비어 있다. 그때는 자리 근거를 요구할 수 없으므로 대상 지목의 자리 검사를 건너뛴다
  // (아래 reachedBase 주석 참고). 하나라도 좌표가 있으면 그 판은 자리를 읽을 수 있다.
  const hasOrderPositions = replay.players.some(
    (p: ParsedReplayPlayer) => (p.signals?.orderPositions?.length ?? 0) > 0,
  );

  const winnerPlayers = replay.winnerSide === "team1" ? replay.team1 : replay.team2;
  const loserPlayers = replay.winnerSide === "team1" ? replay.team2 : replay.team1;
  if (winnerPlayers.length === 0) return null;
  /** 일대일인가 — '상대'가 한 사람뿐일 때만 쓸 수 있는 표현들이 있다(지적). */
  const duel = winnerPlayers.length === 1 && loserPlayers.length === 1;

  const winner = buildSide(winnerPlayers);
  const loser = buildSide(loserPlayers);
  const lateAlive = lateAliveOf(totalFrames);

  // 눈에 띄는 사람이 있으면 그 사람을 주어로 세우고 조합도 '그 사람의 것'으로 말한다
  // (요청: 팀전이라도 잘한 사람 얘기를 많이). 없으면 편 전체로 말한다.
  const star = standout(winner, lateAlive);
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
  /* Map의 삽입 순서(=파서가 유닛을 훑은 순서)를 그대로 따르던 자리다 — 무엇이 먼저
     나올지가 사실상 우연이라, 핵이 있어도 그 앞에 아무 유닛이나 걸리면 밀렸다. 위
     spectacleOf와 같은 잣대(드문 순)로 고른다. */
  const spectacle = [...winner.combat.entries()]
    .filter(([u, n]) => SPECTACLE_UNITS[u] && n > 0 && !units.includes(u))
    .sort((a, b) => (SPECTACLE_RANK[b[0]] ?? 0) - (SPECTACLE_RANK[a[0]] ?? 0) || b[1] - a[1])[0]?.[0];
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

  /* 마지막 국면에서 '전황이 이긴 편에 유리한' 문장을 가려내는 표(요청). 아래 tideOf(문장
     쪽 판정)와 같은 기준이다 — 어느 편에도 기울지 않는 이야기와, 한 사람의 일이지만 국면은
     상대 쪽으로 기우는 이야기(제 수가 역풍을 맞음·당함·무너짐)를 갈라 둔다. */
  const LATE_NEUTRAL = new Set([
    "standoff", "attrition", "fast-hands", "power-unit", "mass-army", "expand", "prod-gap",
    "worker-gap", "tech", "vision", "vision-eye", "no-detect", "revival", "greedy-build", "long-run", "wall-in",
  ]);
  const LATE_AGAINST_ACTOR = new Set([
    "rush-backfire", "greedy-punished", "fallen", "lodging", "relocate", "lift-off", "gg", "stand",
    "late-defense", "no-elim",
  ]);

  // ── 문장 수 ──
  // 예전에는 한 문단으로 한 번에 읽히는 글이라 짧게 끊었다(길이에 따라 두~다섯, 최대 일곱).
  // 이제는 자막으로 한 문장씩 넘겨 보는 이야기라 사정이 다르다(요청: 스토리라인 방식이니
  // 전체적으로 문장 수를 늘려 달라) — 문단이 길어져 부담스러워질 걱정이 없고, 오히려 장면이
  // 적으면 훑을 것이 없다. 3분마다 하나씩 늘려 열둘까지 쓴다.
  // 자리가 늘어도 아무거나 채우지는 않는다 — 아래 MIN_WEIGHT가 가벼운 사실을 막는다.
  // 자리를 더 열었다(요청: 문장 이어 붙이기를 최소화하고 최대한 나눠서 스냅을 만들 것 —
  // 그러려면 스냅 수 제한부터 완화해야 한다). 2분마다 하나씩, 긴 경기는 열여덟까지.
  // 경기 길이에 맞춘 자리 수(요청: 10분이면 서넛, 20분이면 일고여덟). 2분 30초에 한 문장
  // 꼴이다 — 10분 4, 20분 8, 30분 12. 아주 긴 경기도 열둘에서 멈춘다(그 이상은 읽는 사람이
  // 지친다). 아래 MIN_WEIGHT가 가벼운 사실을 막으므로 자리가 남아도 아무거나 채우지 않는다.
  /* 자리를 조금 더 연다(요청: 유의미한 업그레이드·기술 진술을 더해 달라). 재료가 늘어도
     자리가 그대로면 전부 제로섬이 되어, 새로 짚어낸 이야기(무슨 기술을 몇 번 썼나·발업을
     몇 분에 찍었나)가 러시·교전 문장에 밀려 하나도 못 나온다 — 실제로 그랬다. 2분에 한
     문장 꼴로 바꾸고 상한도 함께 올린다. 아래 MIN_WEIGHT와 갈래별 상한(PER_KEY_CAP)이
     가벼운 사실로 자리를 채우는 것은 그대로 막는다. */
  /* 자막을 문장이 아니라 한 마디 타이틀로 줄이면서(GameResultStory의 titleOf) 자리를 한 번
     더 연다(요청: 자막을 숨기는 스냅이 많으니 스냅 자체를 늘려도 되겠다 — 그래야 스토리
     라인이 더 잘 읽힌다). 문단으로 읽던 시절의 제약("길면 지친다")이 사라졌다: 이제
     스냅 하나는 그림 한 장이고, 장면이 촘촘할수록 이야기가 이어져 읽힌다. */
  const SEC_PER_LINE = 80;
  /* 상한을 올린다(요청: 경기시간에 비례해서 문장 최대개수 늘리기) — 2분에 한 문장 꼴로
     세어도 30분이 넘는 판은 상한(15)에 걸려 45분 경기와 35분 경기가 같은 길이였다.
     이제 긴 판은 스물까지 열린다. 자리가 늘어도 아래 MIN_WEIGHT와 갈래별 상한이 가벼운
     사실로 채우는 것은 그대로 막는다. */
  /* 상한을 한 번 더 10% 올린다(요청) — 20 → 22, 긴 판은 30 → 33. 2분에 한 문장 꼴로 세는
     기준(SEC_PER_LINE)은 그대로라, 짧은 판의 길이는 안 변하고 상한에 걸려 잘리던 긴 판만
     그만큼 더 길어진다. */
  /* 자리를 시간만으로 세면 안 된다(지적: 헌터 판의 "정구 15기도 들어가야 해"). 13분짜리
     4:4는 13분짜리 1:1과 같은 아홉 자리를 받고 있었는데, 사람이 넷 배면 그 판에서 벌어진
     일도 그만큼 많다 — 실측한 그 판에서 자리는 아홉인데 무게 8을 넘긴 이야기가 열넷이었고,
     뮤탈 열다섯 기(무게 21)가 "자리 없음"으로 잘렸다. 애초에 자리싸움에서 진 게 아니라
     자리를 세는 자에 사람 수가 빠져 있었다.

     1:1을 기준으로 사람이 둘 늘 때마다 한 자리씩 더 준다(아래 crowdBonus 주석). 자리가
     늘어도 아래 MIN_WEIGHT(8)와 갈래별 상한(PER_KEY_CAP)이 그대로라, 가벼운 사실로
     채워지지는 않는다 — 늘어난 자리는 채울 이야기가 실제로 있을 때만 쓰인다. */
  const headcount = replay.players.filter((p: ParsedReplayPlayer) => p.signals).length;
  /* 사람 하나에 한 자리씩 얹으니 8인 판이 여섯 자리나 늘어 "질럿 속업을 완료했다" 같은
     가벼운 줄까지 딸려 들어왔다(실측: 새로 붙은 41줄 중 아홉이 업그레이드 한 줄짜리).
     예전 지적("중요하지 않은 내용은 숫자 채우려고 넣지 말 것")을 되돌리는 셈이라 반 자리
     씩으로 줄인다 — 8인 판은 세 자리가 는다. */
  const crowdBonus = Math.ceil(Math.max(0, headcount - 2) / 2);
  const baseBudget = Math.max(3, Math.min(
    (sec >= LONG_GAME_SEC ? 33 : 22) + crowdBonus,
    Math.round(sec / SEC_PER_LINE) + crowdBonus,
  ));
  // 자리가 남아도 아무거나 채우지 않는다(요청: 승부에 중요한 이벤트만) — 이 무게 아래는
  // "그래서 뭐" 소리가 나오는 사실들이라, 문단을 짧게 끝내는 편이 낫다.
  // 6 → 8(요청: 중요하지 않은 내용은 숫자 채우려고 넣지 말 것). 자리가 남아도 "그래서 뭐"
  // 소리가 나오는 사실(업그레이드 한 줄, 건물 몇 채)로 채우지 않는다 — 스냅 수를 늘린 만큼
  // 이 문턱을 올려야 '늘어난 자리를 아무거나로 채우는' 일이 안 생긴다.
  const MIN_WEIGHT = 8;
  // 다만 이사·궤멸의 '왜'를 대는 앞이야기는 이 문턱을 따로 쓴다 — 그 자리는 재미로 뽑는
  // 자리가 아니라 인과를 잇는 자리라, 가벼운 사실이라도 있는 편이 훨씬 낫다(지적).
  const CAUSE_MIN_WEIGHT = 4;
  // 그 앞이야기가 이만큼 안쪽이어야 인과로 읽힌다 — 10분 전 일을 끌어오면 "그래서?"가 된다.
  const CAUSE_NEAR_SEC = 5 * 60;

  // 전술(9드론 저글링 러시·몰래 배럭·목동 저그…)은 그 경기에서만 있었던 일이라 가장 무겁게
  // 친다 — 자리가 모자라면 일반적인 이야기부터 버려진다.
  // 러시·드랍을 간 그 타이밍에 상대 쪽 누군가의 생산이 뚝 끊겼다면, 그건 그 수가 통했다는
  // 뜻이다(요청) — "3게이트 질럿 러시로 조조의 본진을 파괴함"처럼 한 문장으로 잇는다.
  // 대상이 이미 확실한 전술(자리로 짚은 것)은 그 사람만 보고, 아니면 상대 전원을 훑는다.
  /** 그 사람이 저 사람 진영까지 실제로 갔나 — 명령 좌표로만 판정한다(요청: "타겟 지칭시
   *  반드시 명령 위치에 기반해야함"). 예전엔 '그 뒤에 일꾼을 다시 몰아 뽑았나'처럼 생산
   *  등락만 보고 대상을 지목했는데, 그러면 팀전에서 마침 그때 일꾼을 채운 사람이 엉뚱하게
   *  피해자로 적힌다(실측한 리플레이에서는 세 상대 모두 조건을 만족해, 셋 중 누가 뽑혀도
   *  근거가 없었다). pushersOn이 그 사람 본진 반경에 찍힌 명령 수로 가른다. */
  /** 그 공격이 실제로 어디에 떨어졌나 — 본진인지, 어딘가의 자원 자리(멀티)인지(지적:
   *  어택 지정 좌표를 구분한다면 공격 장면이 더 자세해질 텐데 — 실제로는 위치 정확도만
   *  좋아졌지 문장에는 그 내용이 안 늘었다). 근거는 진짜 공격 명령(kind === "attack")만이다
   *  — 이동·수리·채집 클릭까지 섞으면 본진 언저리의 흔한 클릭에 묻혀 목표가 흐려진다.
   *  좌표가 몇 개 안 되거나(정찰 수준) 본진에서도 자원 자리에서도 멀면(빈 땅) 모른다고
   *  본다 — 확인 안 되는 자리를 멀티라고 우기지 않는다. */
  /** 그 자리의 임자 — 가장 가까운 시작 본진의 주인이다. 아래 placeFits와 attackZoneOf가
   *  "이건 저 사람 동네에서 벌어진 일인가"를 묻는 데 함께 쓴다. */
  const homeOwnerAt = (x: number, y: number): string | null => {
    let owner: string | null = null;
    let near = Infinity;
    for (const q of replay.players) {
      if (q.startX === null || q.startY === null) continue;
      const d = Math.hypot(q.startX - x, q.startY - y);
      if (d < near) { near = d; owner = q.rawName; }
    }
    return owner;
  };

  /* 본진(자원 받는 홀)이 날아갔나 — 빠른무한처럼 자원이 무한한 판에서는 이게 곧 자원
     수급이 끊긴다는 뜻이라 그 판에서 가장 큰 사건이다(요청: 본진 뚝배기 날림 판정 가능?).
     리플레이에는 건물이 죽는 기록이 없다. 대신 남는 게 하나 있다 — '제 시작 자리에 홀을
     다시 지었다'. 넥서스·커맨드는 시작할 때 이미 서 있으므로 그 자리에 또 짓는 일은
     날아갔을 때뿐이다. 저그는 본진에 해처리를 더 얹는 게 평범한 운영이라 이 판정에서 뺀다
     (거짓으로 "본진이 날아갔다"고 말하느니 그 종족만 조용한 편이 낫다). */
  const HALL_REBUILD_TILES = 12;
  const HALL_REBUILD_SEC = 4 * 60;
  /* 홀을 짓기 직전, 그 자리가 실제로 두들겨 맞고 있었나를 재는 창과 문턱. */
  const HALL_FIRE_SEC = 90;
  const HALL_FIRE_ORDERS = 10;
  /* 넥서스·커맨드가 다 지어지는 데 걸리는 시간 — 그 사이에 일꾼이 한 기도 못 나왔다면
     뽑을 홀이 없었다는 뜻이다(아래 두 번째 근거). */
  const HALL_BUILD_SEC = 75;
  const HALL_BUSY_MIN = 3;
  const HALL_BUSY_SEC = 2 * 60;
  const hallRebuilt = (
    victim: ParsedReplayPlayer, from: number, attackers: ParsedReplayPlayer[],
  ): number | null => {
    if (victim.race === "저그") return null;
    const hx = victim.startX;
    const hy = victim.startY;
    if (hx === null || hy === null) return null;
    const to = from + (HALL_REBUILD_SEC / SECONDS_PER_FRAME);
    const hit = (victim.signals?.buildPositions ?? []).find((b) => (
      (b.unit === "Nexus" || b.unit === "Command Center")
      && b.frame !== null && b.frame >= from && b.frame <= to
      && Math.hypot(b.x - hx, b.y - hy) <= HALL_REBUILD_TILES
    ));
    if (!hit || hit.frame === null) return null;
    const at = hit.frame;
    /* 정말 '날아가서 다시 지은' 것인가 — 제 자리에 홀을 또 짓는 일은 날아갔을 때뿐이라고
       봤는데, 실측하니 그렇지 않았다: 빠른무한 172판에서 테란·프로토스 678명 중 535명이
       제 시작 자리 12타일 안에 홀을 다시 지었다(967채). 자원이 무한한 판에서는 일꾼을 더
       뽑으려고 홀을 하나 더 얹는 게 평범한 운영이다.

       가르는 근거는 '그 홀을 올릴 때 그 자리가 두들겨 맞고 있었나'다. 평범하게 얹는 홀은
       조용할 때 짓는다 — 실측하면 짓기 직전 90초 동안 그 자리에 찍힌 상대 어택 지정이
       중앙 0개, 상위 10%에서야 4개다. 뚝배기가 깨져 다시 올리는 홀만 그 수가 확 뛴다
       (열 개 넘는 것이 967채 중 59채, 6%). 홀이 몇 채든 상관없는 근거라는 게 중요하다 —
       처음에는 '짓는 동안 일꾼이 나왔나'로 갈랐는데, 지적대로 뚝배기가 깨져도 다른 홀이
       남아 있으면 일꾼은 계속 나오므로 그건 진짜 재건을 놓친다.

       그 일꾼 근거는 버리지 않고 둘째 갈래로 남긴다 — 홀이 그것 하나뿐이었다면 새 홀이 다
       지어질 때까지 한 기도 못 뽑는다(일꾼은 홀에서만 나온다). 좌표가 성겨 상대의 어택
       지정이 안 남은 판을 이쪽이 건진다. 다만 후반에 일꾼을 더 안 뽑는 사람은 홀이 멀쩡해도
       0기라, 맞기 직전에 실제로 뽑고 있었을 때만 인정한다. */
    let fire = 0;
    for (const foe of attackers) {
      for (const o of foe.signals?.orderPositions ?? []) {
        if (o.kind !== "attack" || o.by === "Building") continue;
        if (o.frame < at - HALL_FIRE_SEC / SECONDS_PER_FRAME || o.frame > at) continue;
        if (Math.hypot(o.x - hx, o.y - hy) <= HALL_REBUILD_TILES) fire += 1;
      }
    }
    if (fire >= HALL_FIRE_ORDERS) return at;
    const w = [...WORKER_UNITS].flatMap((u) => victim.signals?.unitFrames[u] ?? []);
    const during = w.filter(
      (x) => x > at && x <= at + HALL_BUILD_SEC / SECONDS_PER_FRAME,
    ).length;
    if (during > 0) return null;
    const busy = w.filter((x) => x >= from - HALL_BUSY_SEC / SECONDS_PER_FRAME && x <= from).length;
    return busy >= HALL_BUSY_MIN ? at : null;
  };

  const attackZoneOf = (
    attacker: ParsedReplayPlayer, victim: ParsedReplayPlayer, from: number, to: number,
  ): "main" | "multi" | null => {
    if (victim.startX === null || victim.startY === null) return null;
    const orders = (attacker.signals?.orderPositions ?? [])
      .filter((o) => o.kind === "attack" && o.frame >= from && o.frame <= to)
      // 그 사람 동네에 떨어진 명령만 본다(지적: 자막이 부른 사람과 그림이 다른 곳을
      // 가리킨다) — 같은 시간에 맵 반대편을 두들기고 있으면 그 좌표들이 평균에 섞여
      // "○○의 멀티를 쳤다"가 엉뚱한 자리에서 나온다.
      .filter((o) => homeOwnerAt(o.x, o.y) === victim.rawName);
    if (orders.length < ATTACK_ZONE_MIN_ORDERS) return null;
    const cx = orders.reduce((s, o) => s + o.x, 0) / orders.length;
    const cy = orders.reduce((s, o) => s + o.y, 0) / orders.length;
    if (Math.hypot(cx - victim.startX, cy - victim.startY) <= ATTACK_ZONE_HOME_TILES) return "main";
    const resources = replay.mapGrid?.resources ?? [];
    const nearRes = resources.some(
      ([rx, ry]) => Math.hypot(cx - rx, cy - ry) <= ATTACK_ZONE_RES_TILES,
    );
    return nearRes ? "multi" : null;
  };

  const reachedBase = (
    attacker: string, victimName: string, from: number,
    side: ParsedReplayPlayer[], foes: ParsedReplayPlayer[],
  ): boolean => {
    const me = side.find((p) => p.rawName === attacker);
    const victim = foes.find((p) => p.rawName === victimName);
    if (!me || !victim) return false;
    return pushersOn(victim, [me], from, totalFrames || Infinity).length > 0;
  };

  /** 그 수가 남긴 좌표(p.xy)로 볼 때 '그 사람에게' 벌어진 일이 맞나 — 그 자리에서 가장
   *  가까운 시작 본진의 주인이 그 자리의 임자다. 임자가 다른 사람이면(또는 때린 사람
   *  자신이면) 그 수의 결과가 아니다. 좌표가 없는 수(대부분)는 아무것도 막지 않는다.
   *
   *  한계는 안다: 본진에서 멀리 떨어진 멀티를 친 것은 임자가 어긋나 걸러질 수 있다. 그래도
   *  자막과 화살표가 서로 다른 곳을 가리키는 것보다는 한 문장 덜 말하는 편이 낫다(지적). */
  const placeFits = (p: Record<string, unknown> | undefined, victim: string): boolean => {
    const xy = p?.xy;
    if (!Array.isArray(xy) || xy.length !== 2
      || typeof xy[0] !== "number" || typeof xy[1] !== "number") return true;
    const owner = homeOwnerAt(xy[0], xy[1]);
    return owner === null || owner === victim;
  };

  const damageFrom = (
    t: { key: string; at: number | null; whom?: string; who?: string; p?: Record<string, unknown> },
    foes: ParsedReplayPlayer[],
    side?: ParsedReplayPlayer[],
  ) => {
    if (t.at === null || !RAID_KEYS.has(t.key)) return null;
    // 커널은 그 자체로 때리는 수가 아니라 문이다 — 상대 진영에 뚫린 것이 자리로 확인될
    // 때만 피해의 원인으로 쓴다(replayTactics의 nydus 주석 참고).
    if (t.key === "nydus" && !t.p?.intoFoe) return null;
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
    // 대상을 짚어 말하려면 그 사람 진영까지 실제로 갔다는 자리 근거가 있어야 한다(요청).
    // 자리를 못 읽는 판(screp이 Pos를 안 주는 경우)에서는 이 검사가 늘 false가 되므로,
    // 좌표가 아예 없을 때만 예전처럼 생산 등락을 그대로 믿는다.
    if (best && side && t.who && hasOrderPositions) {
      if (!reachedBase(t.who, best.raw, t.at, side, foes)) return null;
    }
    // 그 수가 '어디서' 벌어졌는지가 좌표로 남아 있으면(리콜·드랍처럼 p.xy가 붙는 수), 그
    // 자리가 곧 대상을 말해 준다 — reachedBase는 그 뒤 경기 끝까지를 다 보므로 "언젠가
    // 그쪽으로 병력을 보냈다"만 확인할 뿐, 그 수가 거기서 벌어졌다는 뜻이 아니다(실측한
    // 4:4에서 수달이의 리콜 셋이 모두 제 쪽 빈 땅(97,31)이었는데 같은 무렵 생산이 꺾인
    // 타센을 두고 "리콜로 타센에게 큰 타격을 줬다"가 나왔다 — 타센 본진은 그 반대편
    // (9,64)이라 자막과 화살표가 서로 다른 곳을 가리켰다).
    if (best && !placeFits(t.p, best.raw)) return null;
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

  /** 그 사람이 그 무렵 실제로 누구의 유닛을 찍었나 — 이름과 자리를 함께 준다(파서의 hits
   *  주석 참고). 어림이 아니라 사실이다: 찍은 대상의 번호가 그 사람 것이었다는 기록이다.
   *
   *  한 번 스친 것은 정찰 유닛끼리 부딪친 것일 수 있어 HIT_MIN번은 찍혔어야 하고, 자리는
   *  그중 그 시점에 가장 가까운 클릭 하나를 그대로 쓴다(여러 곳의 평균을 내면 아무 일도
   *  없던 빈 땅이 나온다 — beatPositions에서 겪은 것과 같은 함정이다). */
  const struckAt = (
    who: string, at: number | null, side: ParsedReplayPlayer[], only?: string | null,
  ): { whom: string; xy: [number, number] } | null => {
    if (at === null) return null;
    const me = side.find((p) => p.rawName === who);
    const near = (me?.signals?.hits ?? [])
      .filter((h) => (!only || h.whom === only)
        && Math.abs(h.frame - at) * SECONDS_PER_FRAME <= HIT_WINDOW_SEC);
    if (near.length < HIT_MIN) return null;
    const tally = new Map<string, number>();
    for (const h of near) tally.set(h.whom, (tally.get(h.whom) ?? 0) + 1);
    const best = [...tally].sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < HIT_MIN) return null;
    const spot = near
      .filter((h) => h.whom === best[0])
      .sort((a, b) => Math.abs(a.frame - at) - Math.abs(b.frame - at))[0];
    return { whom: best[0], xy: [spot.x, spot.y] };
  };

  /** 러시가 닿은 자리 — 그 사람이 그 경기에서 처음으로 상대 유닛을 찍은 순간을 찾는다
   *  (위 RUSH_LAND_KEYS 주석). 그 첫 접촉이 러시가 도착한 때이고, 찍은 대상이 곧 목표다. */
  const landedOn = (
    who: string, at: number | null, side: ParsedReplayPlayer[],
  ): { whom: string; xy: [number, number]; at: number } | null => {
    if (at === null) return null;
    const hits = side.find((p) => p.rawName === who)?.signals?.hits ?? [];
    if (hits.length === 0) return null;
    const first = hits.reduce((a, b) => (b.frame < a.frame ? b : a));
    if (first.frame < at) return null;
    if ((first.frame - at) * SECONDS_PER_FRAME > RUSH_LAND_SEC) return null;
    // 한 번 스친 것은 정찰끼리 부딪친 것일 수 있다 — 그 접촉이 실제로 이어졌어야 한다.
    const run = hits.filter(
      (h) => h.whom === first.whom
        && (h.frame - first.frame) * SECONDS_PER_FRAME <= HIT_WINDOW_SEC,
    );
    if (run.length < HIT_MIN) return null;
    return { whom: first.whom, xy: [first.x, first.y], at: first.frame };
  };

  /* 상대의 유닛을 직접 찍은 기록이 없을 때 쓰는 두 번째 근거 — 그 무렵의 '공격 명령'이
     누구의 진영 안에 떨어졌나다. 어택 지정은 그 자리를 때리라는 뜻이고, 남의 진영 안에
     여러 번 몰렸다면 그건 그 사람을 친 것이다.

     태그 기록(hits)만큼 확실하지는 않다 — 빈 땅에 어택땅을 찍고 지나가기도 하니까. 그래서
     ①진짜 공격 명령만 보고 ②일꾼·건물이 낸 것은 빼고 ③한 진영에 여러 번 몰렸을 때만 쓴다.
     자리는 그 시점에 가장 가까운 명령 하나를 그대로 쓴다(여러 곳의 평균은 빈 땅이 된다). */
  const zoneRadius = (() => {
    const homes = replay.players
      .filter((p) => p.startX !== null && p.startY !== null)
      .map((p) => ({ raw: p.rawName, x: p.startX as number, y: p.startY as number }));
    return (raw: string): { x: number; y: number; r: number } | null => {
      const h = homes.find((x) => x.raw === raw);
      if (!h) return null;
      const others = homes.filter((x) => x.raw !== raw)
        .map((x) => Math.hypot(x.x - h.x, x.y - h.y));
      if (others.length === 0) return null;
      return { x: h.x, y: h.y, r: Math.min(...others) * STRIKE_ZONE_RATIO };
    };
  })();

  const struckZone = (
    who: string, at: number | null,
    side: ParsedReplayPlayer[], foes: ParsedReplayPlayer[],
  ): { whom: string; xy: [number, number] } | null => {
    if (at === null) return null;
    const me = side.find((p) => p.rawName === who);
    // 이동 명령도 함께 본다 — 남의 본진 안으로 병력을 '옮기는' 것과 '때리는' 것은 실제로
    // 같은 장면이다(들어가면서 무브로 끌고 가는 일이 흔하다). 반경 안이라는 조건이 이미
    // 세서, 지나가다 한 번 찍은 것은 HIT_MIN에 걸려 걸러진다.
    const near = (me?.signals?.orderPositions ?? []).filter(
      (o) => (o.kind === "attack" || o.kind === "move")
        && o.by !== "Worker" && o.by !== "Building"
        && Math.abs(o.frame - at) * SECONDS_PER_FRAME <= STRIKE_ZONE_WINDOW_SEC,
    );
    if (near.length < HIT_MIN) return null;
    let best: { whom: string; n: number; o: { frame: number; x: number; y: number } } | null = null;
    for (const f of foes) {
      const z = zoneRadius(f.rawName);
      if (!z || !(z.r > 0)) continue;
      const inside = near.filter((o) => Math.hypot(o.x - z.x, o.y - z.y) <= z.r);
      if (inside.length < HIT_MIN) continue;
      if (!best || inside.length > best.n) {
        const o = inside.sort((a, b) => Math.abs(a.frame - at) - Math.abs(b.frame - at))[0];
        best = { whom: f.rawName, n: inside.length, o };
      }
    }
    return best ? { whom: best.whom, xy: [best.o.x, best.o.y] } : null;
  };

  /** 그 무렵 실제로 움직인 병력이 무엇이었나 — 명령마다 짚어 둔 주인(orderPositions.by)을
   *  세어 가장 많이 나온 것들을 고른다(요청: 어떤 병력으로 누구에게 무엇을 했는지).
   *
   *  '뽑은 유닛'과는 다른 값이다. 유닛 수는 경기 내내 뽑은 총량이라 그 순간 무엇이 나갔는지를
   *  말해 주지 못한다 — 여기 세는 것은 그 창 안에서 실제로 명령을 받은 유닛들이라, "그때
   *  무엇으로 싸웠나"에 대한 유일한 근거다. 일꾼·건물·수송선은 병력 이름이 아니라 뺀다.
   *  정체를 모르는 명령이 많으면 그만큼 덜 나온다 — 없는 것을 지어내지는 않는다. */
  const FORCE_EXCLUDE = new Set(["Worker", "Building", "Transport"]);
  const forceAt = (who: string, at: number | null, side: ParsedReplayPlayer[]): string[] => {
    if (at === null) return [];
    const me = side.find((p) => p.rawName === who);
    /* 그 사람이 실제로 뽑은 유닛만 이름표가 될 수 있다(지적: 자꾸 상관없는 유닛 라벨이
       얹힌다 — 뽑지도 않은 것). 이름의 출처는 명령의 주인(orderPositions.by)인데 그 값은
       파서가 화면 선택 상태로 짚어 내는 것이라, 드물게 그 사람이 가진 적 없는 유닛이
       섞인다. 생산 기록(unitCounts)에 없는 이름은 그 자리에서 걸러 낸다 — 생산 기록이
       아예 없는 옛 리플레이에서는 예전처럼 다 통과시킨다(거를 근거가 없다). */
    const made = me?.signals?.unitCounts;
    const built = made && Object.keys(made).length > 0
      ? (u: string) => (made[u] ?? 0) > 0
      : () => true;
    const tally = new Map<string, number>();
    for (const o of me?.signals?.orderPositions ?? []) {
      if (o.kind !== "attack" && o.kind !== "move") continue;
      if (!o.by || FORCE_EXCLUDE.has(o.by)) continue;
      if (!built(o.by)) continue;
      if (Math.abs(o.frame - at) * SECONDS_PER_FRAME > STRIKE_ZONE_WINDOW_SEC) continue;
      tally.set(o.by, (tally.get(o.by) ?? 0) + 1);
    }
    return [...tally]
      .filter(([, n]) => n >= FORCE_MIN_ORDERS)
      .sort((a, b) => b[1] - a[1])
      .slice(0, FORCE_MAX_UNITS)
      .map(([u]) => u);
  };

  /** 들이친 이야기인데 '누구를' 또는 '어디를'이 비어 있으면 그 자리를 실제 타격으로 채운다.
   *  이미 들어 있는 값은 건드리지 않는다 — 건물 자리·마법 좌표가 더 정확하다.
   *
   *  그러고도 목표가 안 잡히는 수(NEED_TARGET_KEYS)는 무게를 크게 깎는다(요청: 타겟 없는
   *  드랍이나 병력 뽑아 진출한 이야기는 뜻이 옅다) — 어디에 내렸는지 모르는 드랍은 그냥
   *  셔틀을 띄운 것이고, 누구에게 갔는지 모르는 진출은 생산 이야기일 뿐이다. 지우지는
   *  않는다: 다른 할 이야기가 없는 조용한 경기에서는 그것도 그날의 장면이다. */
  const withStrike = (b: Beat, mine: ParsedReplayPlayer[], foes: ParsedReplayPlayer[]): Beat => {
    if (!ATTACK_BEAT_KEYS.has(b.k)) return b;
    const hasWhom = (b.whom?.length ?? 0) > 0;
    // 건물 자리로 이미 '어디였나'를 말한 beat(포토러시·성큰러시·몰래배럭)는 그대로 둔다 —
    // 그 자리가 곧 그 수 자체이고, 같은 무렵의 다른 교전 좌표를 얹으면 오히려 어긋난다.
    const hasXy = Array.isArray(b.p?.xy) || typeof b.p?.spot === "string";
    /* 자막이 부를 사람이 이미 정해져 있으면 자리도 '그 사람에게 벌어진 일'에서만 찾는다
       (지적: 내용과 화살표가 가리키는 곳이 다르다). 그러지 않으면 이런 일이 생긴다 —
       실측한 4:4에서 타센의 클로킹 레이스가 Rex의 생산을 꺾은 것으로 잡혔는데, 같은
       무렵 타센의 탱크가 다른 편 사람 진영을 두들기고 있어서 그 좌표가 얹혔다. 자막은
       Rex를 부르고 화살표는 맵 반대편을 가리켰다.

       그 사람 쪽에서 아무 자리도 안 나오면 좌표 없이 둔다 — 그러면 그림은 자막이 부른
       사람의 본진을 가리키므로 둘이 어긋나지 않는다. */
    const victim = hasWhom ? b.whom?.[0] ?? null : null;
    // 러시는 뽑은 때가 아니라 닿은 때에 목표가 드러난다(위 RUSH_LAND_KEYS 주석).
    const land = hasWhom || !RUSH_LAND_KEYS.has(b.k)
      ? null : landedOn(b.who[0], b.at ?? null, mine);
    const found = hasWhom && hasXy ? null
      : land
        ?? struckAt(b.who[0], b.at ?? null, mine, victim)
        ?? struckZone(b.who[0], b.at ?? null, mine,
          victim ? foes.filter((f) => f.rawName === victim) : foes);
    /* 그 자리가 정말 '그 사람 동네'인가 — 유닛을 직접 찍은 기록(struckAt·landedOn)은
       클릭한 자리를 그대로 주는데, 그 자리는 상대 유닛이 있던 곳이지 상대의 집이 아니다.
       실측한 3:3에서 군범의 2분 질럿 러시가 제롬을 꺾은 것으로 잡혔는데, 좌표는
       (119.9, 123.5) — 군범 자기 본진이었다(제롬의 정찰 유닛을 제 집에서 찍은 클릭).
       화살표가 제 집을 가리키니 "제롬이 큰 타격을 입었다"와 정반대로 읽혔다.

       자리가 안 맞으면 좌표는 버린다. 이름까지 그 클릭에서 나온 경우(hasWhom이 아닐 때)는
       이름도 함께 버린다 — 제 집에서 스친 것을 '내가 저 사람을 쳤다'고 부를 수는 없다. */
    const placed = !!found && homeOwnerAt(found.xy[0], found.xy[1]) === found.whom;
    const s = found && (placed || hasWhom) ? found : null;
    const out = s
      ? {
        ...b,
        ...(hasWhom ? {} : { whom: [s.whom] }),
        p: {
          ...(b.p ?? {}),
          ...(hasXy || !placed ? {} : { xy: s.xy }),
          // 뽑은 때와 닿은 때가 벌어져 있으면 닿은 때도 남긴다 — 왜 이 목표를 골랐는지의
          // 근거이자, 문장이 '언제 부딪쳤나'를 말해야 할 때 쓰는 값이다.
          ...(land && placed ? { landMin: minutes(land.at * SECONDS_PER_FRAME) } : {}),
        },
      }
      : b;
    const blind = NEED_TARGET_KEYS.has(out.k)
      && (out.whom?.length ?? 0) === 0
      && !Array.isArray(out.p?.xy) && typeof out.p?.spot !== "string";
    return blind ? { ...out, weight: out.weight - NO_TARGET_PENALTY } : out;
  };

  const tacticBeats = (won: boolean): Beat[] => {
    const foes = won ? loserPlayers : winnerPlayers;
    const mine = won ? winnerPlayers : loserPlayers;
    const list = scanTactics({ sidePlayers: mine, foePlayers: foes, startSpots: replay.startSpots })
      // GG는 진 편이 쳤을 때만 항복이다. 이긴 쪽도 마무리로 같이 치는 게 관례라, 채팅만
      // 보고 붙이면 "Sohee_Min이 GG 치고 나갔지만 결국 Sohee_Min이 이겼다"가 나온다
      // (실제 리플레이에서 이긴 사람이 끝나기 2초 전에 'ㅈㅈ'를 쳤다).
      .filter((t) => !(won && t.key === "gg"))
      .map((t) => {
        // 그 수가 실제로 상대에게 통했는지를 먼저 본다(지적: "파뱃 러시도 성공했는데
        // 실패했다고 나오고"). 예전엔 역풍 판정이 앞서 있어서, 러시가 상대 생산을 끊었어도
        // 러시를 간 쪽이 진 경기면 제 생산 등락만 보고 "실패함"으로 뒤집혔다. 상대가 실제로
        // 맞았다면 그건 성공한 수이고, 그 뒤에 졌다는 건 결과 문장이 따로 말한다.
        const hit = damageFrom(t, foes, mine);
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
          // 일꾼을 다시 몰아 뽑았다는 것만으로는 '누가 당했나'를 못 정한다 — 그 사람
          // 진영까지 실제로 갔다는 자리 근거를 함께 요구한다(요청).
          if (prey && (!hasOrderPositions || reachedBase(t.who, prey, t.at, mine, foes))) {
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
              // 무엇으로 잡았나를 함께 넘긴다(요청: 커세어·스카우트·레이스도) — 문장이
              // '발키리'를 못 박고 있으면 커세어로 잡은 판이 거짓말이 된다.
              k: "valk-hunt", won, who: [t.who], whom: [prey], at: t.at, weight: t.weight + 14,
              p: { unit: t.p?.unit ?? "Valkyrie" },
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
          // 혼자 들이친 게 아니라 여럿이 함께 덮친 것일 수 있다(지적: 한 사람한테만 당한 게
          // 아니라 3컬러 러시였다). 병력을 그 사람 진영으로 몰고 간 사람을 자리로 세어,
          // 이 수를 낸 사람 말고도 있었으면 그 이름들을 함께 싣는다.
          /* 창은 그 급습 언저리만 본다 — 예전에는 경기 시작(0)부터 피해가 잡힌 순간까지를
             통째로 봤다. 그러면 "그 전에 한 번이라도 저 집에 병력을 보낸 사람"이 전부 이
             급습에 함께 달려든 것으로 딸려 들어온다(지적: 시간적으로 뚜렷이 앞선 공격인데
             다른 공격들과 한 문장으로 묶였다).
             실측(그 리플레이, 피해자 본진 반경 안에 찍힌 명령을 2분 단위로):
               팍규 14~16분 83개·16~18분 30개 ← 이 급습
               정구  2~6분 26개·12~14분 16개 ← 이미 끝난 다른 공격
               수달이 18~24분 71개        ← 한참 뒤에 따로 온 공격
             그런데 셋이 한 문장에 묶였다. 앞뒤 GANG_NEAR_SEC 안에 그 집으로 병력을 몰고 온
             사람만 '함께 덮친' 것으로 센다 — 3컬러 러시처럼 진짜 동시에 들어온 것은 그대로
             잡히고(초반 러시는 애초에 같은 순간이다), 시차가 뚜렷한 것은 각자 제 문장이 된다. */
          const gangAt = t.at ?? hit.at;
          const gang = victim
            ? pushersOn(
              victim, mine,
              gangAt - GANG_NEAR_SEC / SECONDS_PER_FRAME,
              gangAt + GANG_NEAR_SEC / SECONDS_PER_FRAME,
            )
            : [];
          const mates = gang.includes(t.who) ? gang.filter((n) => n !== t.who) : [];
          // 탈락시켰으면 '어디를 쳤나'는 이미 안 중요하다(문장이 그 자체로 충분하다) —
          // 그 앞 단계, 큰 타격만 준 경우에만 어디를 쳤는지를 더해 장면을 자세히 만든다
          // (지적: 어택 지정 좌표를 구분해도 문장이 안 자세해진 것 같다).
          const attacker = mine.find((p) => p.rawName === t.who);
          const zone = !hit.out && attacker && victim && t.at !== null
            ? attackZoneOf(attacker, victim, t.at, hit.at)
            : null;
          // 본진 홀이 날아갔나(위 hallRebuilt) — 자원이 무한한 판에서도 이건 치명타다.
          const hall = victim && t.at !== null ? hallRebuilt(victim, t.at, mine) : null;
          return {
            k: "raid-damage", won, who: [t.who], at: t.at,
            weight: t.weight + (hit.out ? 16 : 14),
            whom: [hit.raw],
            ...(mates.length > 0 ? { who2: mates } : {}),
            p: {
              ...(t.p ?? {}), k: t.key,
              ...(thin ? { vdef: thin.def, vdefN: thin.n } : {}),
              ...(mates.length > 0 ? { gang: gang.length } : {}),
              ...(zone ? { zone } : {}),
              ...(hall !== null ? { hall: true } : {}),
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
      })
      .map((b) => withStrike(b, mine, foes))
      /* 타겟을 못 짚은 러시는 아예 말하지 않는다(요청) — "누구에게 갔는지도, 어디로 갔는지도
         모르는 러시"는 병력을 좀 뽑았다는 말과 다를 바 없고, 그림에도 화살표가 안 그려져
         본진에 이모지만 덩그러니 남는다. 무게만 깎아 두던 자리인데(NO_TARGET_PENALTY),
         할 얘기가 적은 경기에서는 그래도 문장이 되어 나왔다. withStrike가 이미 닿은
         자리·찍은 상대를 다 뒤진 뒤라, 여기서도 비어 있으면 정말 근거가 없는 것이다. */
      .filter((b) => !(RUSH_NEED_TARGET.has(b.k)
        && (b.whom?.length ?? 0) === 0
        && !Array.isArray(b.p?.xy) && typeof b.p?.spot !== "string"));
    /* 같은 사람이 같은 상대를 헤집은 이야기는 한 번이면 된다 — 수가 여럿이면 그만큼
       문장이 겹친다(실측: "패스트 다크템플러에 많은 타격을 입었다" 바로 뒤에 "질럿 급습에
       많은 타격을 입었다"가 붙어 같은 말이 두 번 나갔다). 무거운 쪽만 남긴다. */
    const seenHit = new Set<string>();
    return list
      .sort((a, b) => b.weight - a.weight)
      .filter((b) => {
        // 때린 이야기든 괴롭힌 이야기든, 같은 사람이 같은 상대에게 한 일은 한 문장이면 된다.
        if (b.k !== "raid-damage" && b.k !== "harass-workers" && b.k !== "harass-long") return true;
        const key = `${b.who.join(",")}|${(b.whom ?? []).join(",")}`;
        return seenHit.has(key) ? false : (seenHit.add(key), true);
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
      /* defense와 같은 이유로 시점은 '그 개수가 다 선 때'다 — 첫 포토(2분)에 걸어 두고
         "캐리어 포토 70개를 걷어냈다"가 나갔다(지적: 초반 설명에 후반 유닛·유닛수). */
      const at = nthBuildingFrame(p, def[0], def[1]);
      const unit = topCombatAt(p, at);
      if (!unit) continue;
      return {
        k: "breakthrough", won: true, who: subject, whom: [p.rawName], weight: 14,
        at,
        p: { units, unit, def: def[0], n: def[1] },
      } as Beat;
    }
    return null;
  })();

  const tactics = mergeDuelRush(mergeRaids(mergeGg(
    [...tacticBeats(true), ...tacticBeats(false)],
    (won) => (won ? winnerPlayers.length : loserPlayers.length),
  )));
  /* 아군이 얻어맞는 동안 그 진영으로 병력을 보낸 사람 — '도우러 갔다'(요청: 아군 헬프도
     나오면 좋겠다, 내용 파싱 때부터). 팀전에서만 나온다.

     근거는 자리뿐이다: 그 사람의 이동·공격 명령이 아군 본진 반경에 몰렸는가(pushersOn — 정찰
     한두 번으로는 안 걸리는 최소 개수를 요구한다). 그래서 '도착해서 막아 줬는가'까지는 말하지
     않는다. 창은 그 수가 시작된 즈음부터 몇 분 — 한참 뒤에 그 자리를 지나간 것을 지원이라
     부르지 않기 위해서다. */
  const allyHelpBeats: Beat[] = (() => {
    if (!hasOrderPositions || duel) return [];
    const HELP_BEFORE_SEC = 30;
    const HELP_AFTER_SEC = 150;
    const out: Beat[] = [];
    const seen = new Set<string>();
    for (const t of tactics) {
      const victimName = (t.whom ?? [])[0];
      const at = t.at;
      if (!victimName || at === null || at === undefined || !Number.isFinite(at)) continue;
      const side = winnerPlayers.some((p) => p.rawName === victimName)
        ? winnerPlayers : loserPlayers;
      const victim = side.find((p) => p.rawName === victimName);
      if (!victim) continue;
      const mates = side.filter((p) => p.rawName !== victimName);
      if (mates.length === 0) continue;
      const from = Math.max(0, at - HELP_BEFORE_SEC / SECONDS_PER_FRAME);
      const to = at + HELP_AFTER_SEC / SECONDS_PER_FRAME;
      // 자는 '그 아군에서 가장 가까운 상대까지'로 잡는다 — 동료 본진 사이 거리로 재면
      // 반경이 거의 0이 된다(pushersOn의 scaleWith 주석).
      const foesOfVictim = side === winnerPlayers ? loserPlayers : winnerPlayers;
      for (const name of pushersOn(victim, mates, from, to, foesOfVictim)) {
        const key = `${name}>${victimName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          k: "ally-help", won: side === winnerPlayers, who: [name], whom: [victimName],
          at, weight: 13, p: { k: t.k },
        } as Beat);
      }
    }
    return out;
  })();

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
  ]
    // 들이친 수 문장이 이미 "…에 A·B까지 달려들어"라고 여럿을 말했으면 합공 문장은 뺀다 —
    // 같은 순간을 두 문장이 나눠 말하는 셈이고, 저쪽은 무슨 수였는지까지 담고 있다.
    .filter(({ g }) => !tactics.some(
      (b) => b.k === "raid-damage" && typeof b.p?.gang === "number" && b.p.gang >= 2
        && (b.whom ?? []).includes(g.victim.rawName),
    ))
    .map(({ g, won }) => {
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
    const all = [...winnerPlayers, ...loserPlayers];
    const troops = all.reduce((acc, x) => acc + Object.entries(
      x.signals?.unitCounts ?? {},
    ).filter(([k]) => !NON_COMBAT_UNITS.has(k)).reduce((a, [, n]) => a + n, 0), 0);
    // 한 사람이 분당 몇 기를 뽑았나로 본다 — 총량만 보면 긴 경기는 전부 소모전이 되고,
    // 사람 수로 안 나누면 4:4는 늘 1:1보다 소모전으로 읽힌다.
    if (all.length === 0) return null;
    if (troops / all.length / (sec / 60) < ATTRITION_PER_MIN) return null;
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
    // 어디까지가 '초반'인가 — 사람마다 다를 이유가 없어 판 하나에 하나로 잡는다.
    const bar = Math.min(totalFrames * GREEDY_WINDOW_RATIO, GREEDY_MAX_SEC / SECONDS_PER_FRAME);
    const combatFramesOf = (q: ParsedReplayPlayer): number[] =>
      Object.entries(q.signals?.unitFrames ?? {})
        .filter(([u]) => !NON_COMBAT_UNITS.has(u))
        .flatMap(([, f]) => f);
    const dronesOf = (q: ParsedReplayPlayer): number => [...WORKER_UNITS]
      .flatMap((u) => q.signals?.unitFrames[u] ?? [])
      .filter((f) => f <= bar).length;
    /** 그 사람이 제일 많이 뽑은 병력 한 종류 — [이름, 수]. */
    const topUnitOf = (q: ParsedReplayPlayer): readonly [string, number] | undefined =>
      Object.entries(q.signals?.unitFrames ?? {})
        .filter(([u]) => !NON_COMBAT_UNITS.has(u))
        .map(([u, f]) => [u, f.length] as const)
        .sort((a, b) => b[1] - a[1])[0];
    /* '많다/적다'는 모두 같은 판 사람들의 가운데치에 견준다(지적: "맵마다 자원상태가
       달라서 유닛수 많고 적음도, 째기 판단도 상대적으로 해야 한다"). 바닥값은 아무도
       아무것도 안 뽑은 판에서 헛말이 나오지 않게 하는 안전선일 뿐이다. */
    const everyone = [...winnerPlayers, ...loserPlayers];
    const unitsBar = Math.max(
      GREEDY_UNITS_FLOOR,
      midOf(everyone.map((q) => combatFramesOf(q).length)) * GREEDY_UNITS_SHARE,
    );
    const workerBar = Math.max(
      GREEDY_WORKER_FLOOR,
      midOf(everyone.map(dronesOf)) * GREEDY_WORKER_SHARE,
    );
    const payoffBar = Math.max(
      GREEDY_PAYOFF_FLOOR,
      midOf(everyone.map((q) => topUnitOf(q)?.[1] ?? 0)) * GREEDY_PAYOFF_RATIO,
    );
    for (const won of [true, false]) {
      const mine = won ? winnerPlayers : loserPlayers;
      const foes = won ? loserPlayers : winnerPlayers;
      for (const p of mine) {
        const sg = p.signals;
        if (!sg) continue;
        const combat = combatFramesOf(p);
        if (combat.length < unitsBar) continue;
        // 초반 구간에서 일꾼과 병력을 나란히 센다 — 절대 수가 아니라 둘의 비가 째기다(지적).
        const drones = dronesOf(p);
        if (drones < workerBar) continue;
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
        const top = topUnitOf(p);
        if (hurtBy) {
          out.push({
            /* 때린 사람은 whom이 아니라 p.by다(지적: 태섭이 공격한 건데 화살표가 없고
               태섭 얼굴이 왜 저거냐) — 이 문장은 주어(who)가 당한 쪽이라 whom 자리에
               공격자를 넣으면 그림이 통째로 뒤집힌다: 그림은 whom을 '당한 사람'으로 읽어
               공격자에게 당황한 얼굴을 붙이고, 화살표는 당한 사람에게서 나가야 하는 줄
               알고 아무것도 못 그린다. relocate·fallen의 by와 같은 자리다. */
            k: "greedy-punished", won, who: [p.rawName],
            at: first, weight: 15,
            p: { min: minutes(first * SECONDS_PER_FRAME), by: hurtBy },
          } as Beat);
        } else if (top && top[1] >= payoffBar) {
          out.push({
            k: "greedy-paid", won, who: [p.rawName],
            at: first, weight: 13, p: { unit: top[0], min: minutes(first * SECONDS_PER_FRAME) },
          } as Beat);
        }
      }
    }
    return out;
  })();

  const sideAll: Beat[] = mergeSpellDuels([
    ...sideBeats({
      side: winner, other: loser, players: winnerPlayers,
      won: true, sec, totalFrames, pressedEarly: false,
    }),
    ...sideBeats({
      side: loser, other: winner, players: loserPlayers,
      won: false, sec, totalFrames, pressedEarly,
    }),
  ]);

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

  // 크게 망한 시점 — 건물·유닛 생산이 현저히 떨어져 끝까지 회복하지 못한 지점(요청).
  // 실제로 판을 떠난 기록이 있으면 그게 먼저다. 되살아난 경우는 productionCollapse가
  // 애초에 잡지 않는다('끝까지 회복하지 못한' 구간만 본다).
  const downs: Record<string, number> = {};
  /* 그중에서도 '완전히 끝난' 사람만 따로 센다(요청: 해골은 완전 엘리나 GG, 생산 0일
     때만. 큰 타격·빈사는 해골까지 붙이지 말 것) — downs는 실제 탈락과 '생산이 무너져
     끝내 못 일어섬'을 한 자루에 담고 있어서, 그림 쪽에서 둘을 가릴 수가 없었다.
     프레임만으로는 어느 쪽인지 알 수 없으므로 끝난 쪽을 따로 실어 보낸다.

     '끝났다'는 두 가지다.
      ① 판을 떠난 기록(Leave Game)이 있다.
      ② 엘리는 안 됐지만 생산이 0이 됐다 — 가스 같은 건물만 남기고 그 뒤로 유닛도 건물도
         하나 안 냈다(지적: 노엘리로 가스 같은 것만 남기고 생산이 끊긴 경우도 해골이다).
     ①은 실전에서 거의 안 잡힌다: 퇴장 기록은 남지만 전원이 경기가 끝난 뒤에 나가므로
     아래 꼬리 조건에서 통째로 걸러진다(실측: 리플레이 21개 중 20개에 퇴장 기록이 있는데
     ①로 잡힌 사람은 0명). 그래서 ②가 사실상 이 판정의 본체다. */
  const elims: Record<string, number> = {};
  /** 마지막으로 무언가를 낸 프레임 — 유닛이든 건물이든. 이 뒤로는 아무것도 안 냈다. */
  const lastProductionFrame = (p: ParsedReplayPlayer): number | null => {
    const s = p.signals;
    if (!s) return null;
    let last = -1;
    for (const fs of Object.values(s.unitFrames)) for (const f of fs) if (f > last) last = f;
    for (const fs of Object.values(s.buildingFrames)) for (const f of fs) if (f > last) last = f;
    return last < 0 ? null : last;
  };
  for (const p of replay.players) {
    const gone = eliminatedFrame(p);
    const f = gone ?? productionCollapse(p, totalFrames);
    // 끝나기 직전에 멈춘 것은 '망한' 것이 아니라 경기가 끝난 것이다 — 마지막 몇 분은
    // 누구나 손을 놓으므로, 그 상태로 이만큼은 더 끌려가야 망한 것으로 본다.
    if (f === null || (totalFrames !== null && totalFrames - f < DOWN_MIN_TAIL_FRAMES)) continue;
    downs[p.rawName] = f;
    if (gone !== null) { elims[p.rawName] = gone; continue; }
    // ② 생산 0 — 꼬리 조건은 위와 같다. 마지막으로 낸 것이 끝보다 이만큼 앞서야 '끊긴'
    //    것이고, 그렇지 않으면 그냥 경기가 끝나서 손을 놓은 것이다.
    const last = lastProductionFrame(p);
    if (last !== null && totalFrames !== null && totalFrames - last >= DOWN_MIN_TAIL_FRAMES) {
      elims[p.rawName] = Math.max(f, last);
    }
  }

  // 이사 — 짓는 구역(시작 지점 기준)이 바뀌면 살림을 옮긴 것이다(요청). 본진을 잃고
  // 멀티에서 다시 시작하는 그림이라 그 자체로 큰 사건이고, 요약 문장에도 넣는다(요청).
  const mapSpots = replay.startSpots ?? [];
  const spotRadiiAll = spotRadii(mapSpots);
  const spotOfPlayer = (q: ParsedReplayPlayer): number => (
    q.startX !== null && q.startY !== null
      ? spotAt({ x: q.startX, y: q.startY }, mapSpots, spotRadiiAll)
      : -1
  );
  const foesOf = (q: ParsedReplayPlayer): ParsedReplayPlayer[] => (
    winnerPlayers.includes(q) ? loserPlayers : loserPlayers.includes(q) ? winnerPlayers : []
  );
  // 1차: 누가 언제 어디로 옮겼는지 시간표를 먼저 만든다 — 상대가 지금 어느 자리에 사는지
  // 알아야 '남의 집'을 가릴 수 있고, 그러려면 상대의 이사도 알아야 한다(닭과 달걀이라
  // 1차에서는 자리 제한 없이 잡는다).
  const draft = new Map<string, { spot: number; at: number }[]>();
  for (const p of replay.players) draft.set(p.rawName, relocations(p, mapSpots, () => false, totalFrames));
  /** 그 사람이 그 시각에 사는 구역 — 그때까지의 이사를 따라간다. */
  const livesAt = (q: ParsedReplayPlayer, frame: number): number => {
    let h = spotOfPlayer(q);
    for (const m of draft.get(q.rawName) ?? []) if (m.at <= frame) h = m.spot;
    return h;
  };
  /* 2차: 그 순간 '상대'가 살고 있는 자리는 뺀다 — 그건 이사가 아니라 남의 집을 차지한
     것이다. 이미 버리고 떠난 자리에 들어가는 것은 이사가 맞다(요청: 그 땅의 지금 주인을
     정확히 파악).

     한때는 아군 자리도 똑같이 막았다(팀원 시작점 언저리에 지은 것을 이사로 읽은 오판이
     있었다). 그런데 팀전에서는 제 편 구석 쪽으로 살림을 펴는 게 아주 흔해서, 그 규칙이
     진짜 이사까지 통째로 삼켰다(지적: 7시가 두들겨 맞고 본진을 버리고 옮겼는데 그 내용이
     없다 — 옮겨 간 자리가 팀원의 시작 구역이라 걸렸다). 옛 오판은 그 뒤에 들어온 두 관문
     (본진 생산 급감 + 실제로 그 집까지 밀고 들어온 상대)이 이미 막고 있으므로, 여기서는
     상대 자리만 본다. */
  /** 옮겨 앉은 자리 — 그 구역의 '시작 지점'이 아니라 그 사람이 실제로 건물을 세운 자리다.
   *
   *  지적: 이사 간 자리는 저긴데 아바타가 엉뚱한 곳에 나온다. 이사 판정은 구역 단위로
   *  하므로(relocations가 돌려주는 것도 구역 번호다) 지금까지 그 구역의 시작 지점을 그대로
   *  아바타 자리로 썼는데, 빠른무한처럼 시작 지점에 바로 못 짓는 맵에서는 실제 살림이 그
   *  자리에서 여러 타일 떨어져 앉는다(실측: 시작 지점 ↔ 그 자리에 지은 홀이 중앙 6.9타일).
   *  그래서 옮겨 간 뒤 그 구역에 세운 건물들의 한가운데를 쓴다 — 그림에서 트럭이 멈추는
   *  자리도, 아바타가 서는 자리도 그곳이라야 자막과 맞는다. 건물을 못 읽었으면 예전처럼
   *  시작 지점으로 물러선다. */
  const movedHome = (
    p: ParsedReplayPlayer, spot: number, at: number,
  ): [number, number] => {
    const there = (p.signals?.buildPositions ?? []).filter(
      (b) => b.frame !== null && b.frame >= at
        && spotAt(b, mapSpots, spotRadiiAll) === spot,
    );
    if (there.length === 0) return [round1(mapSpots[spot][0]), round1(mapSpots[spot][1])];
    const cx = there.reduce((n, b) => n + b.x, 0) / there.length;
    const cy = there.reduce((n, b) => n + b.y, 0) / there.length;
    return [round1(cx), round1(cy)];
  };

  const moveList = new Map<string, [number, number, number][]>();
  /** 그 이사를 누가 만들었나 — 문장에서 "누구에게 내주고 옮겼는지"를 말하는 데 쓴다. */
  const moveBy = new Map<string, string>();
  const pushWindow = (RELOCATE_HIT_WINDOW_MIN * 60) / SECONDS_PER_FRAME;
  for (const p of replay.players) {
    const foes = foesOf(p);
    const m = relocations(p, mapSpots, (spot, frame) => (
      foes.some((f) => livesAt(f, frame) === spot)
    ), totalFrames, hasOrderPositions
      // 이사 직전 그 창 안에 그 집까지 병력을 몰고 온 사람 — 없으면 이사가 아니다.
      ? (frame) => pushersOn(p, foes, Math.max(0, frame - pushWindow), frame)[0] ?? null
      : undefined);
    if (m.length > 0) {
      moveList.set(p.rawName, m.map((x) => {
        const at = movedHome(p, x.spot, x.at);
        return [at[0], at[1], x.at] as [number, number, number];
      }));
      if (m[0].by) moveBy.set(p.rawName, m[0].by);
    }
  }
  // 문장으로 말하는 것은 첫 이사 하나뿐이다(요청: 여러 곳 전전한 것은 부정확하니 빼기) —
  // 두 번째·세 번째 자리는 그림에서 아바타를 옮기는 데만 쓴다.
  const moveBeats: Beat[] = [...moveList].map(([raw, list]) => ({
    k: "relocate", who: [raw],
    won: winnerPlayers.some((p) => p.rawName === raw),
    at: list[0][2], weight: RELOCATE_WEIGHT,
    // 쫓아낸 사람은 p.by로 싣는다 — whom으로 실으면 '이 사람이 당했다'는 뜻이 되어 그림이
    // 뒤집힌다(맞은 자리 폭발 표시가 때린 쪽에 붙고, 화살표도 거꾸로 그려진다).
    ...(moveBy.get(raw) ? { p: { by: moveBy.get(raw) as string } } : {}),
  }));

  // 본진 자리(타일 좌표) — 미니맵에 아바타+닉네임을 계속 띄우는 자리다(요청). 맵 정보를
  // 못 읽은 리플레이는 좌표가 null이라 그 사람만 빠진다.
  const bases: Record<string, [number, number]> = {};
  for (const p of replay.players) {
    if (p.startX !== null && p.startY !== null) {
      bases[p.rawName] = [round1(p.startX), round1(p.startY)];
    }
  }

  /* 본진 살림의 한가운데(요청: 본진 이모지는 아바타가 아니라 본진 건물 자리에) — 아바타는
     '시작 지점'에 서 있는 사람 표시이고, 그 사람이 실제로 살림을 편 자리는 그 언저리에
     퍼져 있다. 그 무게중심을 따로 실어 두면 액션 이모지를 아바타에 겹치지 않고 진짜
     본진 위에 세울 수 있다.

     멀리 나간 멀티·센터 포토까지 끌어오면 무게중심이 지도 한가운데로 끌려가므로, 시작
     지점 언저리(HUB_RADIUS 타일)에 있는 건물만 센다. 그 안에 아무것도 없으면(좌표를 못
     읽은 리플레이) 값을 안 남기고, 보는 쪽은 예전처럼 시작 지점을 그대로 쓴다. */
  const hubs: Record<string, [number, number]> = {};
  for (const p of replay.players) {
    const home = bases[p.rawName];
    const all = p.signals?.buildPositions ?? [];
    let pts = all.filter((b) => home && Math.hypot(b.x - home[0], b.y - home[1]) <= HUB_RADIUS);
    /* 시작 지점 언저리에 살림이 없으면 실제로 건물이 모인 자리를 쓴다(요청: 셋방살이 위치를
       고정으로 하지 말고 건물 지은 위치로 파악해서 미니맵에 아바타 표시) — 아군 기지에
       얹혀 사는 사람은 제 시작 지점이 텅 비어 있어서, 그 자리를 고집하면 아바타가 아무것도
       없는 구석에 홀로 서 있게 된다. 가장 붐비는 건물 하나를 중심으로 그 언저리만 센다. */
    if (pts.length < HUB_MIN_BUILDINGS && all.length >= HUB_MIN_BUILDINGS) {
      let best: typeof all = [];
      for (const c of all) {
        const near = all.filter((b) => Math.hypot(b.x - c.x, b.y - c.y) <= HUB_RADIUS);
        if (near.length > best.length) best = near;
      }
      if (best.length >= HUB_MIN_BUILDINGS) pts = best;
    }
    if (!home || pts.length < HUB_MIN_BUILDINGS) continue;
    const cx = pts.reduce((n, b) => n + b.x, 0) / pts.length;
    const cy = pts.reduce((n, b) => n + b.y, 0) / pts.length;
    /* 잰 자리를 그대로 쓴다. 한때 시작 지점에서 최소 몇 타일은 떨어뜨렸는데(아바타에
       안 겹치게), 그러면 자리가 '살림의 한가운데'가 아니라 아바타에서 일정 거리 떨어진
       고정 슬롯이 돼 버렸다(지적: 아바타 슬롯이 아니라 본진 한가운데에 나와야 한다).
       아바타와 겹치는 판이 있더라도 그게 그 사람 본진의 진짜 한가운데다. */
    hubs[p.rawName] = [round1(cx), round1(cy)];
  }

  /* 병력이 앞선 채로 흘려보낸 대목(요청) — 그 사이 상대가 확장을 늘렸으면 그것까지 말한다.
     이름은 그 편에서 병력을 가장 많이 부은 사람으로 부른다(팀전에서는 문구 쪽이 팀으로
     뭉뚱그린다 — replaySummaryText의 idle-lead 참고). */
  const idle = idleLead(winnerPlayers, loserPlayers, totalFrames);
  const idleBeat: Beat | null = idle && (() => {
    const rep = (side: ParsedReplayPlayer[]): string[] => [...side]
      .sort((x, y) => sumSupply(y) - sumSupply(x)).slice(0, 2).map((x) => x.rawName);
    return {
      k: "idle-lead",
      won: idle.lead === winnerPlayers,
      who: rep(idle.lead), whom: rep(idle.behind),
      at: idle.at, weight: IDLE_LEAD_WEIGHT,
      /* 문장에는 인구수 차이를 그대로 싣지 않는다 — 이 값은 '그때까지 뽑은 총량'의 차라
         경기가 길수록 부풀고(실측 265), 읽는 사람에게 265가 무엇인지 뜻이 안 선다. 몇 배로
         앞섰나만 말한다. */
      p: {
        ratio: Math.round(idle.ratio * 10) / 10, exp: idle.exp, tech: idle.tech,
        min: minutes(idle.at * SECONDS_PER_FRAME),
      },
    } as Beat;
  })();

  /** 마법이 떨어진 자리를 사람이 부르는 말로 바꿔 문장에 실어 준다(지적: 어디에 뿌렸는지,
   *  방어인지 공격인지가 표시되지 않는다). 이름을 붙이려면 시작 본진 목록(bases)과 편 정보가
   *  있어야 해서 beat를 만들 때가 아니라 여기서 한다.
   *   · place  — 그 자리의 임자(원본 게임 아이디). 맵 한가운데면 ""(센터), 못 짚으면 안 싣는다.
   *   · def    — 그게 제 편(자기 또는 팀원) 자리인가. 즉 지킨 것인가 퍼부은 것인가. */
  const teamOfRaw = new Map<string, 1 | 2>([
    ...winnerPlayers.map((p) => [p.rawName, 1] as [string, 1]),
    ...loserPlayers.map((p) => [p.rawName, 2] as [string, 2]),
  ]);
  const withCastPlace = (b: ReplaySummaryBeat): ReplaySummaryBeat => {
    const xy = b.p?.xy;
    if (b.k !== "tech" || !Array.isArray(xy) || xy.length !== 2
      || typeof xy[0] !== "number" || typeof xy[1] !== "number") return b;
    const place = clashPlace([xy[0], xy[1]], bases);
    if (place === null) return b;
    const mine = teamOfRaw.get(b.who[0] ?? "");
    const def = place !== "" && teamOfRaw.get(place) === mine;
    return { ...b, p: { ...(b.p ?? {}), place, def } };
  };

  // 크게 부딪친 대목들 — 마법과 공격 명령이 한때 한곳에 몰린 자리다(요청: 마법 좌표로
  // 그 경기의 최대 교전 지점을 짚을 수 있겠다). 큰 순으로, 서로 다른 싸움만 온다.
  // 가장 큰 것은 그 판의 절정이라 이야기에서 빠지면 안 되고, 나머지는 아래에서 크기를
  // 보고 문장이 된다(요청: 큰 교전이 여러 번이면 여러 번 나오는 게 맞다).
  const clashes = findClashes(winnerPlayers, loserPlayers, CLASH_ROUNDS);
  /* 그 싸움에 나간 병력을 편별로 나눠 센다(지적: 난전에서 엉켜 싸운 유닛을 뭉뚱그려
     말하니 어느 편 것인지 구분이 안 된다). 예전에는 양쪽 것을 한 자루에 담아
     "아비터·다크아콘·디파일러가 맞부딪쳤다"로만 말했는데, 그러면 누가 무엇으로 싸웠는지가
     통째로 사라진다.

     그 편의 대표(clash.who[0]/[1]) 한 사람 것만 센다. 예전에는 그 자리에서 싸운 그 편
     사람들 것을 한데 모았는데, 문장은 그 목록을 대표 이름에 붙여 "○○ 쪽의 …"로 말한다 —
     그래서 저그인 사람 쪽에 팀 동료(테란)의 사이언스베슬이 붙었다(지적: "사이언스 베슬은
     군범이 아니라 브래드 거였는데"). 종족이 아예 다른 유닛이 남의 이름으로 불리는 것은
     색을 더하는 게 아니라 그냥 틀린 말이다. 한 사람 것만 세면 이름과 병력이 늘 같은
     사람에게서 나오므로 이런 어긋남 자체가 생기지 않는다.

     팀 전체가 무엇으로 싸웠는지는 아래 합친 목록(force)이 그대로 들고 있고, 문장은
     편별 목록이 없을 때 그걸 이름 없이 쓴다 — 그 자리에서는 누구 것이라고 말하지 않으니
     같은 문제가 안 생긴다. */
  const forceOfSide = (c: Clash, side: ParsedReplayPlayer[], rep: string | undefined): string[] => {
    if (!rep || !side.some((p) => p.rawName === rep)) return [];
    return forceAt(rep, c.at, side).slice(0, CLASH_FORCE_SIDE_MAX);
  };
  /** 이름을 부를 만큼 싸운 사람들 — 그 자리 전체 명령의 CLASH_NAME_SHARE는 넘어야 한다.
   *  많이 싸운 순 그대로라 문장이 앞에서부터 부르면 곧 비중순이 된다. */
  /** 화살표 굵기의 근거 — 그 사람이 그 무렵 굴린 병력의 크기(요청). 문장 시각 직전
   *  ARROW_SIZE_SEC 동안 뽑은 전투 유닛 수다. 화살표에 이름표(units)가 붙는 사람만 센다 —
   *  굵기는 그 화살표의 성질이라 화살표가 없으면 쓸 데가 없다. */
  /* 그 시각 그 사람이 갖춘 규모 — 미니맵 아바타 밑 기세 눈금이 쓴다(요청: "길이는
     계산된 현재 건물/병력 규모를 뜻하며 … 길이와 색으로 플레이어의 현재 전투력 상태를
     표시"). 병력은 커맨드가 아니라 실제로 나올 수 있었던 수로 세고(producedFrames), 건물은
     방어탑·생산건물·본진에 저마다 몫을 준다 — 본진은 첫 채가 buildingFrames에 없으므로
     하나를 더한다.
     리플레이에는 죽음이 없다 — 그래서 처음부터 다 더하면 그 값은 한 번도 안 줄어드는
     '누적'이 된다(지적: "죽었는지 살았는지 파괴됐는지 모르니까 그 시점만 계산해야 할 듯").
     전멸한 사람의 막대가 그대로 길게 남아 있으면 그건 전투력이 아니라 지금까지 뽑은 총량이다.

     병력은 창(POWER_WINDOW_SEC)으로 자른다 — 그 시각 직전 얼마 동안 나온 것만 센다.
     여전히 죽음을 아는 건 아니지만, 창이 짧으면 '그 무렵 손에 있던 수'에 훨씬 가깝다
     (replayTactics의 CONCURRENT_WINDOW_SEC이 같은 이유로 쓰는 방법이다). 오래전에 뽑아
     이미 사라졌을 것들이 빠지므로, 크게 진 싸움 뒤에는 막대가 실제로 짧아진다. */
  const powerAt = (raw: string, at: number): number => {
    const pl = replay.players.find((x: ParsedReplayPlayer) => x.rawName === raw);
    const sg = pl?.signals;
    if (!sg) return 0;
    const from = at - POWER_WINDOW_SEC / SECONDS_PER_FRAME;
    let troops = 0;
    for (const unit of Object.keys(sg.unitFrames)) {
      if (POWER_PEACE.has(unit)) continue;
      troops += producedFrames(sg, unit, totalFrames).filter((f) => f < at && f >= from).length;
    }
    /* 건물만은 창을 안 씌우고 그때까지 세운 것을 다 센다. 건물도 부서지는 줄은 알지만,
       창을 씌우면 값의 뜻이 '서 있는 기반'에서 '최근에 지은 속도'로 바뀐다 — 3분 전에 편
       멀티와 지어 둔 게이트가 통째로 0이 되어, 자리를 다 잡고 병력만 뽑는 사람이 아무것도
       없는 사람으로 읽힌다. 병력과 달리 건물은 한 판에 몇 채 안 부서지므로, 누적이 실제와
       더 가깝다. */
    const built = (names: readonly string[]) => names.reduce(
      (n, b) => n + (sg.buildingFrames[b] ?? []).filter((f) => f < at).length, 0,
    );
    return troops
      + built(POWER_DEF) * POWER_DEF_WORTH
      + built(POWER_PROD) * POWER_PROD_WORTH
      + (built(POWER_BASE) + 1) * POWER_BASE_WORTH;
  };
  /** 그 스냅 시각의 전 참가자 전투력 — 아바타는 스냅에 안 나오는 사람도 늘 떠 있으므로
   *  전원 몫을 담는다. 시각이 없는 문장(맺음말 앞의 총평 등)에는 붙이지 않는다. */
  const powersAt = (at: number | null | undefined): Record<string, number> | null => {
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    const out: Record<string, number> = {};
    for (const pl of replay.players) out[pl.rawName] = powerAt(pl.rawName, at);
    return Object.keys(out).length > 0 ? out : null;
  };

  const arrowSizes = (b: Omit<Beat, "weight">, units: Record<string, string[]> | null): Record<string, number> | null => {
    if (!units || typeof b.at !== "number") return null;
    const out: Record<string, number> = {};
    for (const raw of Object.keys(units)) {
      const p = replay.players.find((x: ParsedReplayPlayer) => x.rawName === raw);
      const uf = p?.signals?.unitFrames;
      if (!uf) continue;
      let n = 0;
      for (const [unit, frames] of Object.entries(uf)) {
        if (FORCE_EXCLUDE.has(unit) || WORKER_UNITS.has(unit)) continue;
        n += frames.filter((f) => f <= b.at! && f >= b.at! - ARROW_SIZE_SEC / SECONDS_PER_FRAME).length;
      }
      if (n > 0) out[raw] = n;
    }
    return Object.keys(out).length > 0 ? out : null;
  };
  const clashPartsOf = (c: Clash, side: ParsedReplayPlayer[]): string[] => {
    const bar = Math.max(CLASH_PART_MIN, c.n * CLASH_NAME_SHARE);
    return c.ranked
      .filter(([raw, n]) => n >= bar && side.some((p) => p.rawName === raw))
      .map(([raw]) => raw);
  };
  /* 화살표 기둥에 붙일 이름표 — 그 사람이 '무엇으로' 거기 갔나(요청: 모든 공격·포토러시·
     성큰러시·몰래 배럭·방어타워·옆탱 등에 다 적용). 자막에서 유닛을 빼고 이름을 부르게
     되면서, "무엇으로 싸웠나"는 그림이 맡는 편이 낫다 — 화살표를 보는 것만으로 파악된다.

     두 갈래다. 건물을 박은 이야기는 그 건물 이름이 곧 답이고(이미 beat에 실려 있다),
     병력을 몰고 간 이야기는 그 무렵 실제로 명령을 받은 유닛이다(forceAt) — 뽑은 총량이
     아니라 그때 움직인 것이라야 "무엇으로 갔나"의 답이 된다. */
  const BEAT_BUILDING: Record<string, string[]> = {
    "cannon-rush": ["Photon Cannon"], "sunken-rush": ["Sunken Colony"],
    "sneak-rax": ["Barracks"], "center-photon": ["Photon Cannon"],
    "side-tank": ["Siege Tank"], "center-tank": ["Siege Tank"], "ally-cannon": ["Photon Cannon"],
  };
  /* 그 문장의 주인공이 유닛 자체인 갈래 — 이름표는 그 유닛으로 못박는다(지적: "정구 뮤탈
     인데 웬 저글링"). 아래 forceAt은 '그 무렵 명령을 받은 유닛'이라 문장이 말하는 것과
     얼마든지 다를 수 있다: 뮤탈을 다 모아 놓고 그 순간에는 저글링을 움직이고 있었으면
     뮤탈 문장에 저글링 이름표가 붙는다. 문장이 이미 무엇인지 말하고 있는데 그림이 다른
     것을 가리키면 둘 중 하나는 거짓말이 된다.
     건물 표(위)와 같은 자리이고, p.unit(파워 OO·빠른 테크처럼 유닛을 값으로 실은 갈래)이
     있으면 그쪽이 먼저다. */
  const BEAT_UNIT: Record<string, string[]> = {
    muta: ["Mutalisk"], guardian: ["Guardian"], carrier: ["Carrier"],
    "cloak-wraith": ["Wraith"], bc: ["Battlecruiser"], valkyrie: ["Valkyrie"],
    devourer: ["Devourer"], lurker: ["Lurker"], infested: ["Infested Terran"],
    "shuttle-reaver": ["Shuttle", "Reaver"], "templar-drop": ["Shuttle", "High Templar"],
    shuttle: ["Shuttle"], dropship: ["Dropship"], "zerg-drop": ["Overlord"],
  };
  const sideOf = (raw: string): ParsedReplayPlayer[] | null =>
    (winnerPlayers.some((p) => p.rawName === raw) ? winnerPlayers
      : loserPlayers.some((p) => p.rawName === raw) ? loserPlayers : null);
  const arrowUnits = (b: Omit<Beat, "weight">): Record<string, string[]> | null => {
    // 그 화살표를 그리는 사람들 — 주어(who)와, 주어가 아닌 채로 화살표를 받는 이들
    // (같이 덮친 사람 who2, 민 사람 p.by). 자리를 모르는 문장에도 붙지만 그림 쪽에서
    // 화살표가 안 그려지면 그냥 안 쓰인다.
    const who2 = Array.isArray(b.who2) ? b.who2 : typeof b.who2 === "string" ? [b.who2] : [];
    const by = typeof b.p?.by === "string" ? [b.p.by] : [];
    /* 큰 싸움은 대표 둘이 아니라 참여자 전원이 화살표를 받는다(GameResultStory) — 이름표도
       그 사람들 것을 다 실어야 화살표마다 제 병력이 붙는다. */
    const parts = b.k === "clash"
      ? [...(Array.isArray(b.p?.partsA) ? b.p.partsA : []),
        ...(Array.isArray(b.p?.partsB) ? b.p.partsB : [])].filter((v): v is string => typeof v === "string")
      : [];
    const people = [...new Set([...(b.who ?? []), ...who2, ...by, ...parts])];
    if (people.length === 0) return null;
    /** 건물 이야기인가 — 그러면 모두에게 같은 이름을 준다(그 건물이 곧 그 수다). */
    const bs = typeof b.p?.bs === "string" ? b.p.bs.split(",").filter(Boolean)
      : typeof b.p?.b === "string" ? [b.p.b]
        : BEAT_BUILDING[b.k] ?? null;
    /* 이 문장이 말하는 유닛 — 있으면 주인공(who)의 이름표는 이것으로 못박는다. who2·p.by
       처럼 곁들이로 화살표를 받는 사람은 제 병력이 따로 있으므로 아래 forceAt로 간다. */
    const mine = new Set(b.who ?? []);
    const us0 = typeof b.p?.unit === "string" ? [b.p.unit]
      : Array.isArray(b.p?.units) && b.p.units.every((v) => typeof v === "string")
        ? (b.p.units as string[])
        : BEAT_UNIT[b.k] ?? null;
    const out: Record<string, string[]> = {};
    for (const raw of people) {
      if (bs) { out[raw] = bs.slice(0, ARROW_LABEL_MAX); continue; }
      if (us0 && mine.has(raw)) { out[raw] = us0.slice(0, ARROW_LABEL_MAX); continue; }
      const side = sideOf(raw);
      if (!side) continue;
      const us = forceAt(raw, b.at ?? null, side).slice(0, ARROW_LABEL_MAX);
      if (us.length > 0) { out[raw] = us; continue; }
      /* 명령의 주인이 안 잡히면 그 사람이 그때 갖고 있던 병력으로 메운다(요청: 모든
         화살표에는 유닛이나 건물명이 꼭 들어가야 함) — 이름표가 통째로 비면 그림만 보고는
         무엇으로 갔는지를 알 길이 없다. armyAtFrame 주석 참고. */
      const me = side.find((p) => p.rawName === raw);
      const army = me ? armyAtFrame(me, b.at ?? null).slice(0, ARROW_LABEL_MAX) : [];
      if (army.length > 0) out[raw] = army;
    }
    /* 맺음말은 이제 자막에서 유닛을 아예 뺐다(요청) — "무엇으로 끝냈나"의 답이 오로지 이
       이름표뿐이다. 그런데 그 무렵 명령이 안 잡힌 사람은 forceAt이 비어 이름표가 통째로
       없고(실측: 넷이 한 점에 덮친 판에서 둘만 붙었다), 그러면 그 사람 몫의 답이 사라진다.
       문장이 쓰던 것과 같은 재료(teamComp — 그 사람이 그 판에서 굴린 조합)로 메운다. 그
       사람 자신의 것이라 남의 병력이 남의 이름으로 불리는 문제도 없다. */
    if (b.k === "result") {
      const comps = Array.isArray(b.p?.teamComp) ? b.p.teamComp : [];
      (b.who ?? []).forEach((raw, i) => {
        const comp = comps[i];
        if (out[raw] || typeof comp !== "string") return;
        const us = comp.split("|").filter(Boolean).slice(0, ARROW_LABEL_MAX);
        if (us.length > 0) out[raw] = us;
      });
    }
    return Object.keys(out).length > 0 ? out : null;
  };
  // 이름 없이 "무엇이 뒤엉켰나"만 말하는 자리(그리고 옛 요약을 읽는 자리)를 위해 그 편
  // 사람들 것을 합친 목록도 남긴다 — 여기엔 이름이 안 붙으므로 섞여도 틀린 말이 아니다.
  const clashForceAll = (c: Clash, side: ParsedReplayPlayer[]): string[] => {
    const mine = c.parts.filter((n) => side.some((p) => p.rawName === n));
    return [...new Set(mine.flatMap((w) => forceAt(w, c.at, side)))];
  };
  /* 그 싸움에서 가장 많이 터진 마법(요청: 다양한 세부 기술 사용 진술) — 마법을 쓴 좌표에는
     시각이 함께 남으므로(castPositions), 그 싸움이 벌어진 동안 그 싸움터에서 몇 번 터졌는지를
     그대로 셀 수 있다. 기술 이야기를 따로 한 문장으로 세우면 짧은 경기에서는 자리 다툼에 늘
     밀리는데, 정작 마법이 실제로 쓰인 자리는 이 싸움터다 — 그러니 여기에 얹는다. */
  const clashTechOf = (c: Clash): { tech: string; n: number } | null => {
    const tally = new Map<string, number>();
    for (const p of [...winnerPlayers, ...loserPlayers]) {
      for (const cast of p.signals?.castPositions ?? []) {
        // 그 싸움이 벌어진 동안, 그 싸움터에서 터진 것만 센다(위 CLASH_TECH_MIN 주석).
        if (cast.frame < c.at || cast.frame > c.end) continue;
        if (Math.hypot(cast.x - c.xy[0], cast.y - c.xy[1]) > CLASH_RADIUS) continue;
        if ((TECH_RANK[cast.tech as keyof typeof TECH_RANK] ?? 0) < TECH_MIN_RANK) continue;
        tally.set(cast.tech, (tally.get(cast.tech) ?? 0) + 1);
      }
    }
    const best = [...tally].sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= CLASH_TECH_MIN ? { tech: best[0], n: best[1] } : null;
  };
  /** 교전 하나를 문장거리로 — 큰 순서로 i를 받는다. 첫째(i=0)가 그 판의 절정이라
   *  자리를 다투기 전에 먼저 들어간다. */
  const clashBeatOf = (c: Clash, i: number): Beat => {
    const top = i === 0;
    const partsWin = clashPartsOf(c, winnerPlayers);
    const partsLose = clashPartsOf(c, loserPlayers);
    const forceWin = forceOfSide(c, winnerPlayers, c.who[0]);
    const forceLose = forceOfSide(c, loserPlayers, c.who[1]);
    const force = [
      ...new Set([...clashForceAll(c, winnerPlayers), ...clashForceAll(c, loserPlayers)]),
    ].slice(0, CLASH_FORCE_MAX);
    const tech = clashTechOf(c);
    const place = clashPlace(c.xy, bases);
    /* 잘 싸운 전투인가(요청: "잘 싸운 전투 가려내서 실어주고 누가 잘 싸웠다는 내용 추가") —
       근거는 두 가지가 겹칠 때뿐이다: ① 싸움 뒤 그 자리에 남아 명령을 이어간 쪽이 있고
       (hold), ② 그 쪽이 상대보다 눈에 띄게 작았다. 규모는 기세 눈금이 쓰는 것과 같은 값이라
       (powerAt) 화면의 바와 자막이 같은 사실을 말한다.
       한쪽이 작다는 것만으로는 잘 싸웠다고 할 수 없고(그냥 진 싸움일 수 있다), 이겼다는
       것만으로도 안 된다(더 큰 쪽이 이기는 건 당연하다) — 둘이 겹쳐야 이야기가 된다. */
    const sidePower = (parts: string[], rep: string): number => {
      const names = parts.length > 0 ? parts : [rep];
      return names.reduce((n, raw) => n + powerAt(raw, c.at), 0);
    };
    const powA = sidePower(clashPartsOf(c, winnerPlayers), c.who[0]);
    const powB = sidePower(clashPartsOf(c, loserPlayers), c.who[1]);
    const held = c.hold === "a" ? { mine: powA, theirs: powB } : c.hold === "b" ? { mine: powB, theirs: powA } : null;
    const wellFought = held !== null && held.theirs > 0
      && held.mine <= held.theirs * WELL_FOUGHT_ODDS;
    return {
      k: "clash",
      who: c.who,
      won: true,
      at: c.at,
      // 둘째부터는 무게를 한 단계 낮춰 다른 이야기들과 겨루게 둔다 — 큰 싸움이 여러 번인
      // 판에서 전투 문장만 남고 빌드·러시가 통째로 밀리면 그것도 이야기가 아니다.
      weight: top ? CLASH_WEIGHT : CLASH_WEIGHT - 2,
      ...(top ? { keep: true } : {}),
      // 자리 이름은 두 갈래다 — 누군가의 기지면 그 사람을 who2로 부르고(이름은 볼 때
      // 다시 풀린다), 맵 한가운데면 place에 "mid"만 남긴다.
      ...(place ? { who2: [place] } : {}),
      p: {
        xy: c.xy, n: c.n,
        /* 열세를 딛고 이긴 싸움(위 wellFought) — 문장이 "잘 싸웠다"고 말할 근거다.
           몇 배 차이였는지도 함께 싣는다(소수 한 자리) — "두 배 가까운 병력을 상대로"처럼
           말할 수 있어야 그 장면이 읽힌다. */
        ...(wellFought && held ? {
          well: true,
          odds: Math.round((held.theirs / Math.max(1, held.mine)) * 10) / 10,
        } : {}),
        /* 그 판에서 몇 번째로 큰 싸움인가 — 둘째부터만 싣는다. 문장이 "그 판의 가장 큰
           싸움"이라고 말할 수 있는 건 하나뿐이라, 나머지는 그 말을 안 쓴다. 값이 없으면
           가장 큰 싸움이다(옛 요약도 하나뿐이었으므로 그대로 읽힌다). */
        ...(top ? {} : { nth: i + 1 }),
        // 몇 사람이 얽혔나 — 문장이 '둘의 싸움'과 '여럿이 얽힌 난전'을 갈라 쓰는 근거다
        // (지적: 둘이 붙은 건데 "양 팀 병력이 한데 엉켜"로 나온다). clashOf 주석 참고.
        people: c.people,
        /* 상당 부분 참여한 사람들을 편별로(요청: 큰 싸움은 유닛보다 누가 참여했는지를 다
           나열하고, 화살표도 그 사람들에게서 모이게) — 그때까지는 양쪽 대표 한 사람씩만
           불렀고 화살표도 둘뿐이라, 일곱이 얽힌 대난전이 1:1처럼 보였다(지적한 스크린샷).
           이름을 부를 만큼 싸웠나는 그 자리 전체 명령 대비 비율로 가른다. */
        ...(partsWin.length > 0 ? { partsA: partsWin } : {}),
        ...(partsLose.length > 0 ? { partsB: partsLose } : {}),
        // 그 싸움을 누가 이겼나 — 자리를 지킨 쪽이다(요청: 전투의 승패나 비긴 것도 묘사).
        hold: c.hold,
        ...(place === "" ? { place: "mid" } : {}),
        // 그 싸움에 실제로 나간 병력(요청) — "양 팀 병력이 크게 싸웠다"는 그 판의 절정을
        // 말하면서 정작 무엇이 부딪쳤는지를 안 말한다. 편별로 나눠 싣는다(지적: 뭉뚱그려
        // 말하니 어느 편 것인지 구분이 안 된다). forceA는 who[0](이긴 편 대표) 자신의,
        // forceB는 who[1](진 편 대표) 자신의 병력이다 — 이름과 병력의 주인이 반드시
        // 같아야 한다(위 forceOfSide 주석). force는 편을 안 가른 합친 목록이라 이름 없이
        // 쓰는 자리 전용이다.
        ...(force.length > 0 ? { force } : {}),
        ...(forceWin.length > 0 ? { forceA: forceWin } : {}),
        ...(forceLose.length > 0 ? { forceB: forceLose } : {}),
        ...(tech ? { tech: tech.tech, techN: tech.n } : {}),
      },
    };
  };
  /* 큰 교전이 여러 번이면 여러 번 문장이 된다(요청). 다만 가장 큰 싸움에 견줘 너무 작은
     것까지 세우면 자리를 다 먹으므로 CLASH_EXTRA_SHARE를 넘는 것만, CLASH_BEATS_MAX까지다.
     양쪽 대표를 못 뽑은 무리(who가 둘이 안 되는)는 문장이 될 수 없다. */
  const clashBeats: Beat[] = clashes
    .filter((c, i) => c.who.length >= 2 && (i === 0 || c.n >= clashes[0].n * CLASH_EXTRA_SHARE))
    .slice(0, CLASH_BEATS_MAX)
    .map((c, i) => clashBeatOf(c, i));

  /** 노엘이 진짜였던 사람 — 아래 pool 조립 중에 채워지고, 곧바로 그 사람의 GG를 거르는 데 쓴다. */
  const noElimReal = new Set<string>();
  const pool: Beat[] = [
    ...clashBeats,
    ...moveBeats,
    ...(idleBeat ? [idleBeat] : []),
    ...(standoff ? [standoff] : []),
    ...(lateHold ? [lateHold] : []),
    ...(handsBeat ? [handsBeat] : []),
    ...(attritionBeat ? [attritionBeat] : []),
    ...(wall ? [wall] : []),
    ...mergeSameFate(greedyBeats, "greedy-punished"),
    ...gangBeats,
    ...mergeMutual(tactics),
    ...allyHelpBeats,
    // 돌파 문장은 늘 '진 편의 벽'을 말하므로 그쪽 방어 문장만 덜어 낸다(이긴 편이 지어 둔
    // 방어는 다른 이야기다). 뒤늦은 증설과 겹치는 건 어느 편이든 덜어 낸다.
    ...sideAll.filter((b) => !(
      b.k === "defense" && ((breached && !b.won) || coveredByLate(b.who, b.p?.def))
    )),
  ]
    .filter((b) => !(b.k === "fallen" && b.who.some((w) => pickedOff.has(w))))
    /* 노엘은 말만으로는 이야기가 안 된다 — 실제로 그 사람 살림이 끝났을 때만 남긴다.
       기준을 '진 편인가'로 두지 않는 이유는 이긴 편에도 끝난 사람이 있기 때문이다(지적:
       이긴 팀 일부가 해골이 될 수도 있어 — 노엘로 가스 같은 것만 남기고 생산이 끊긴 경우).
       거꾸로 이긴 사람이 농담처럼 던진 노엘은 downs에 없으므로 여기서 걸린다(실측: 4:4
       한 판에서 이긴 편 100000g가 "노엘여"를 쳤는데 생산은 끝까지 이어졌다).
       남는 것은 그 판의 큰 사건이라, 잘려 나가지 않게 무게도 함께 올린다(GG와 같은 6은
       붐비는 팀전에서 늘 밀렸다). */
    .flatMap((b, _i, arr) => {
      if (b.k !== "no-elim") return [b];
      const raw = b.who[0];
      if (raw === undefined) return [];
      // 살림이 끝났거나(downs) GG까지 쳤으면 진짜 손을 든 것이다.
      const gaveUp = arr.some((x) => x.k === "gg" && x.who.includes(raw));
      /* 안 끝난 노엘도 남긴다(요청: 노엘은 이기고 지고가 무관하니 다 센다) — 예전에는
         여기서 통째로 버렸는데, 그러면 저장도 안 되어 통계에서 없던 일이 됐다. 외쳤다는
         사실은 그 자체로 그 사람의 한마디다.
         대신 무게로 가른다: 실제로 손든 노엘은 그 판의 큰 사건이라 15, 농담으로 던진
         노엘은 원래 무게 그대로 두어 자막 자리다툼에서는 거의 안 뽑힌다. */
      if (downs[raw] === undefined && !gaveUp) return [b];
      noElimReal.add(raw);
      return [{ ...b, weight: 15 }];
    })
    /* 노엘과 GG를 함께 남긴다(요청: 노엘·gg 중복으로도 세야 한다) — 한때 같은 사람의 GG는
       겹치는 말이라 뺐는데, 그건 자막 한 줄을 아끼려던 것이었다. 둘은 실제로 다른 한마디이고
       (봐 달라는 말과 졌다는 말), 칭호도 각각 다른 것을 센다(노엘을 외치는 자·매너 퀸).
       자막이 두 줄로 겹쳐 보이는 일은 무게가 알아서 가른다 — 노엘 쪽이 15로 훨씬 무겁다. */
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

  /* 업그레이드는 그 유닛이 나오는 문장에 딱지로 붙인다(요청) — "속업 저글링", "사업
     히드라"처럼 스타에서 실제로 쓰는 말이고, 한 문장을 따로 세우는 것보다 짧으면서 그
     병력이 어떤 물건이었는지가 한눈에 읽힌다. 그 사람이 그 문장의 시점 이전에 실제로 찍은
     것만 붙인다 — 20분에 찍은 속업을 5분 러시에 붙이면 거짓말이다. 여럿이면 이야깃거리가
     큰 쪽(UPGRADE_RANK)을 고른다. */
  /* 그 유닛이 '내 병력'인 문장에만 붙인다 — 방어·돌파·탐지 문장의 유닛은 상대 것이라
     내 업그레이드를 얹으면 딴 사람 물건에 딱지를 다는 셈이 된다. */
  const UP_FOLD_KEYS = new Set([
    "power-unit", "fast-tech", "long-run", "stand", "solo", "vision", "vision-eye",
  ]);
  const foldedUpgrades = new Set<string>();
  for (let i = 0; i < pool.length; i += 1) {
    const b = pool[i];
    if (!UP_FOLD_KEYS.has(b.k)) continue;
    // p.unit이 있는 문장만 본다 — 그 값을 쓰는 템플릿만 딱지를 실제로 보여주기 때문이다.
    // 안 보여주는 문장에까지 '붙었다'고 쳐 버리면 따로 세운 업그레이드 문장까지 지워져
    // 그 사실이 통째로 사라진다(실측: 캐리어 인터셉터 증설이 그렇게 없어졌다).
    const unit = typeof b.p?.unit === "string" ? b.p.unit : undefined;
    if (!unit || b.p?.up !== undefined) continue;
    const sg = replay.players.find((p) => p.rawName === b.who[0])?.signals;
    if (!sg) continue;
    const best = (Object.entries(UNIT_UPGRADE_TAG) as [string, { unit: string; tag: string }][])
      .filter(([key, v]) => v.unit === unit && sg.firstUpgradeFrame[key] !== undefined
        && (b.at === null || b.at === undefined || sg.firstUpgradeFrame[key] <= b.at))
      .sort((x, y) => (UPGRADE_RANK[y[0] as keyof typeof UPGRADE_RANK] ?? 0)
        - (UPGRADE_RANK[x[0] as keyof typeof UPGRADE_RANK] ?? 0))[0];
    if (!best) continue;
    pool[i] = { ...b, p: { ...(b.p ?? {}), up: best[1].tag } };
    foldedUpgrades.add(`${b.who[0]}|${best[0]}`);
  }
  // 유닛 문장에 이미 붙은 업그레이드는 따로 한 문장을 더 쓰지 않는다 — 같은 사실이 두 번이다.
  for (let i = pool.length - 1; i >= 0; i -= 1) {
    const b = pool[i];
    if (b.k !== "upgrade-signature") continue;
    if (foldedUpgrades.has(`${b.who[0]}|${String(b.p?.upgrade ?? "")}`)) pool.splice(i, 1);
  }

  /* 유닛을 뽑았다는 것만으로는 무게를 다 주지 않는다(요청: 무의미한 유닛생산 내용은
     중요도를 낮추고, 실제 이동·공격 등 타겟팅된 것 위주로 띄울 것).

     예전엔 '고급 유닛' 몇 가지만 낮췄는데, 정작 자리를 먹고 있던 건 "11분부터 30분까지
     드라군을 놓지 않고 뽑았다" "발키리 59기를 뽑았다" 같은 생산 이야기였다(실측한 요약
     한 편에 그런 문장이 나란히 둘). 무엇을 몇 기 뽑았다는 건 어느 경기에나 있는 사실이라,
     그 자체로는 그날의 장면이 아니다.

     낮추는 것은 '아무것도 못 짚은' 생산담뿐이다. 누구를 쳤는지(whom)나 어디였는지(p.xy)가
     붙어 있으면 그건 이미 생산 이야기가 아니라 공격 이야기라 그대로 둔다. 자리(b.pos)는
     여기서 못 쓴다 — 그건 고르기가 끝난 뒤에 붙는 값이다(아래 beatPositions). */
  const PROD_ONLY_KEYS = new Set([
    "carrier", "guardian", "bc", "valkyrie", "power-unit", "arbiter", "ultra",
    "long-run", "unit-mass", "devourer", "lurker", "infested", "scout", "reaver", "queen",
    /* 뮤탈(muta)도 여기서 뺐다. 이 표의 근거는 "무엇을 몇 기 뽑았다는 건 어느 경기에나
       있는 사실"이라는 것인데, 뮤탈 문턱이 '36기 고정'에서 '이 판 한 사람 몫의 0.15배'로
       바뀌면서(replayTactics의 MUTA_MASS_SHARE) 그 전제가 깨졌다 — 이제는 그 판에서
       뮤탈이 실제로 주력이었을 때만 뜬다(실측 11판에서 세 번, 그중 둘이 헌터 13분 판의
       15기·10기로 그 판의 병력 자체였다). 벌점 9를 그대로 물리면 무게가 MIN_WEIGHT 아래로
       떨어져 어떤 판에서도 문장이 될 수 없었다(실측: 옛 무게 9에서도 마찬가지라, 이 갈래는
       사실상 죽어 있었다). 위 SORTIE_GATE_KEYS로 '안 나간 뮤탈'은 여전히 걸러진다.
       (지적: "기준값이 왜 필요해? 이런 경기도 있다구" — 그 헌터 판 이야기다.) */
    // mass-army는 여기 없다 — 이 표가 낮추려는 것은 "캐리어 네 기 띄웠다"처럼 그 자체로는
    // 그날의 장면이 아닌 생산담인데, 분당 스무 기 넘게 찍어낸 물량은 그 판이 어떤 판이었나
    // 그 자체다(요청: "프로토스들의 질럿 드라군 물량 이야기도 없네" — 실제로 이 표에
    // 넣어 봤더니 그 이야기가 그대로 잘려 나갔다).
  ]);
  /* 무게를 낮추는 것으로는 모자란 갈래가 하나 있다: 뽑아 놓고 끝내 안 나간 병력(요청:
     "진출 안 한 생산은 이제 제외 — 고급유닛이든 많이 뽑았든"). 캐리어를 열두 기 띄웠어도
     그 병력이 집을 안 벗어났으면 그 판에서 아무 일도 안 한 것이라, 무게가 아무리 낮아도
     자리가 남으면 문장이 되어 "○○이 캐리어를 띄웠다"가 그날의 장면인 양 실린다.
     그래서 이 갈래만은 낮추는 게 아니라 뺀다.

     '나갔나'는 싸운 자리로 잰다 — 적진에 들어갔거나, 맵 한가운데서 붙었거나(요청:
     적진 기준으로 하되 중앙 교전을 놓치지 말 것). 제 진영에서 싸운 것은 나간 게 아니라
     막은 것이라 안 센다.

     세는 것은 둘이다. ①hits — 상대 유닛·건물을 직접 찍은 순간(파서가 대상의 임자까지
     확인한 기록이라 어림이 아니다). ②kind가 "attack"인 명령 — 어택땅처럼 대상 없이 땅을
     찍은 공격은 hits에 안 남으므로 이것으로 받는다.

     기준을 여러 개 놓고 표본 113명에게 재 봤다(3개 이상이면 '나감').
       ⓐ 내 본진에서 18타일 밖   → 0개인 사람 7명(나머지 106명은 열 개 이상)
       ⓑ 상대 본진에 더 가까움   → 0개 8명 · 1~2개 1명
       ⓒ 상대 본진 25타일 안     → 0개 16명 · 1~2개 2명 · 3~9개 7명
       ⓓ ⓒ 또는 맵 중앙 25타일 안 → 0개 7명 · 1~2개 1명
     ⓐ는 못 쓴다 — 넓은 맵에서는 제 앞마당만 오가도 18타일이 넘어, 사실상 전원이 '나감'이
     된다(첫 판에서 이 기준으로 짰다가 113명 전원 통과했다). ⓒ 하나로는 너무 좁다:
     센터 싸움만 하고 끝낸 사람이 통째로 '안 나감'이 되어 버린다(9명이 그렇게 걸렸다).
     그래서 ⓓ다 — 적진을 기준으로 삼되 중앙을 함께 센다.
     실제로 갈린 예: SamKim86은 ⓐ가 111개인데 ⓓ는 1개였다 — 집 밖에서 내내 싸웠지만
     끝까지 제 쪽이었다. 중앙 반경을 30으로 늘리면 이 사람도 3개로 통과해 버려서, 적진과
     같은 25로 맞췄다(반경 하나가 곧 '누군가의 자리' 크기라 읽기에도 낫다).

     맵 한가운데는 시작 자리들의 무게중심으로 잡는다 — 맵 크기를 따로 안 읽어도 되고,
     3시·9시만 쓰는 판처럼 자리가 치우친 경기에서도 그 판의 실제 가운데가 나온다.

     세 가지를 조심했다. ①그 생산 뒤에 나갔는지를 본다 — 5분에 질럿으로 한 번 나갔다가
     20분부터 집에서 캐리어만 모은 사람의 캐리어 이야기는 여전히 안 나간 생산이다(살짝
     앞까지는 봐 준다: 뽑기 시작한 시점과 나간 시점이 딱 맞아떨어지진 않는다).
     ②본진 좌표를 못 읽은 판은 거리를 잴 수 없으므로 그대로 둔다 — 못 재는 것을 '안
     나갔다'로 읽으면 그런 판의 요약이 통째로 비어 버린다.
     ③이미 위에서 걸러진 공격 이야기(whom·p.xy가 붙은 것)는 여기 오지도 않는다.

     남는 한계 하나는 적어 둔다: 어느 유닛이 나갔는지는 리플레이에 안 남는다. 그래서
     "캐리어는 집에 두고 질럿만 내보냈다"는 못 가른다 — 여기서 거르는 것은 그 사람이
     그 생산 뒤로 아예 상대 쪽에 발을 안 들인 경우다. */
  const SORTIE_GRACE_FRAMES = Math.round(60 / SECONDS_PER_FRAME);
  /** 나갔다고 볼 최소 횟수 — 한두 번은 정찰이거나 지나가다 찍은 것일 수 있다. */
  const SORTIE_MIN_HITS = 3;
  /** '누군가의 자리'로 볼 반경(타일) — 적진에도 맵 한가운데에도 같은 값을 쓴다. */
  const SORTIE_RADIUS = 25;
  /** 이 사람의 상대편 본진들 — '적진'을 가르는 기준점이다. */
  const foeBasesOf = (p: ParsedReplayPlayer): { x: number; y: number }[] => {
    const foes = replay.team1.includes(p) ? replay.team2
      : replay.team2.includes(p) ? replay.team1 : [];
    return foes.filter((q) => q.startX !== null && q.startY !== null)
      .map((q) => ({ x: q.startX as number, y: q.startY as number }));
  };
  /** 맵 한가운데 — 시작 자리들의 무게중심(위 주석). 자리를 하나도 못 읽으면 null. */
  const mapCenter = ((): { x: number; y: number } | null => {
    const bases = replay.players.filter((q) => q.startX !== null && q.startY !== null);
    if (bases.length === 0) return null;
    return {
      x: bases.reduce((s, q) => s + (q.startX as number), 0) / bases.length,
      y: bases.reduce((s, q) => s + (q.startY as number), 0) / bases.length,
    };
  })();
  /** 이 사람이 `from` 무렵 이후로 적진·중앙에서 실제로 친 자리들. 잴 근거가 없으면 null.
   *
   *  나갔는지(아래 wentOut)와 어디로 나갔는지(아래 sortiePos)가 같은 목록에서 나온다 —
   *  판정과 그림이 갈리면 "나갔다고 해놓고 화살표는 딴 데"가 되기 때문이다. */
  const sortieHits = (name: string, from: number | null): { frame: number; x: number; y: number }[] | null => {
    const p = replay.players.find((q) => q.rawName === name);
    const sg = p?.signals;
    if (!sg || !p || p.startX === null || p.startY === null) return null;
    const foes = foeBasesOf(p);
    if (foes.length === 0) return null;
    const since = from === null ? -Infinity : from - SORTIE_GRACE_FRAMES;
    const near = (o: { x: number; y: number }, t: { x: number; y: number }): boolean =>
      Math.hypot(o.x - t.x, o.y - t.y) < SORTIE_RADIUS;
    const over = (o: { frame: number; x: number; y: number }): boolean => {
      if (o.frame < since) return false;
      // 적진에 들어갔거나, 맵 한가운데서 붙었거나.
      return foes.some((e) => near(o, e)) || (mapCenter !== null && near(o, mapCenter));
    };
    const pick = (o: { frame: number; x: number; y: number }) => ({ frame: o.frame, x: o.x, y: o.y });
    const out = sg.hits.filter(over).map(pick);
    if (out.length < SORTIE_MIN_HITS) {
      out.push(...sg.orderPositions
        .filter((o) => o.kind === "attack" && o.by !== "Worker" && over(o)).map(pick));
    }
    return out;
  };
  /** 이 사람이 `from` 무렵 이후로 적진이나 중앙까지 나간 적이 있나. 잴 근거가 없으면 null. */
  const wentOut = (name: string, from: number | null): boolean | null => {
    const pts = sortieHits(name, from);
    return pts === null ? null : pts.length >= SORTIE_MIN_HITS;
  };
  /** 나간 사람이 '어디로' 갔나 — 위 목록에서 가장 붐비는 자리 하나.
   *
   *  화살표를 그으려면 자리가 있어야 한다(지적: "지금은 화살표도 없는 게 문제"). 생산담의
   *  기본 자리(beatPositions)는 그 무렵 명령이 가장 몰린 곳이라 대개 제 본진이고, 그러면
   *  화살표를 그릴 만큼 멀지가 않아 본진 이모지 하나로 끝난다. 나간 것이 확인된 이야기는
   *  '나간 자리'가 그 이야기의 자리다. */
  const sortiePos = (name: string, from: number | null): [number, number] | null => {
    const pts = sortieHits(name, from);
    if (!pts || pts.length < SORTIE_MIN_HITS) return null;
    return clusterOf(pts, from ?? pts[0].frame, null);
  };
  /** 한 자리로 세려면 그 자리에 이만큼은 찍혔어야 한다 — 지나가다 한 번 스친 것은 '찔렀다'가
   *  아니다. 전체 문턱(SORTIE_MIN_HITS)보다 낮은 이유는 이쪽이 이미 '나간 사람'만 보기
   *  때문이다: 나간 것은 확정이고 여기서는 그 안을 몇 갈래로 나눌지만 정한다. */
  const SPOT_MIN_HITS = 2;
  /** 한 문장이 그릴 화살표 수의 상한 — 그 이상은 미니맵이 실타래가 된다. */
  const SPOT_MAX = 4;
  /** 나간 사람이 '어디어디를' 갔나(지적: "사방을 찔렀으면 사방에 이모지가 있어야 할 듯").
   *
   *  위 sortiePos는 가장 붐비는 한 곳만 골라 준다. 그래서 여러 곳을 헤집은 이야기도 화살표가
   *  하나뿐이었고, 문장은 "사방을 찔렀다"는데 그림은 한 방향만 가리켰다.
   *
   *  자리를 나누는 기준은 상대 본진이다 — 맵 위의 점을 임의로 뭉치면 같은 집 앞뜰과 뒷마당이
   *  두 곳으로 갈리는데, 사람이 '몇 군데를 쳤나'로 세는 단위는 집이다. 어느 집에도 안 붙는
   *  가운데 싸움은 따로 한 자리로 둔다(맵 한가운데는 그 자체가 하나의 목적지다).
   *
   *  순서는 시간순이다 — 먼저 친 곳부터 그려야 화살표가 이야기의 차례대로 읽힌다. */
  const sortieSpots = (name: string, from: number | null): [number, number][] | null => {
    const pts = sortieHits(name, from);
    if (!pts || pts.length < SORTIE_MIN_HITS) return null;
    const me = replay.players.find((q) => q.rawName === name);
    if (!me) return null;
    const anchors: { x: number; y: number }[] = [
      ...foeBasesOf(me), ...(mapCenter !== null ? [mapCenter] : []),
    ];
    if (anchors.length === 0) return null;
    const buckets = new Map<number, { frame: number; x: number; y: number }[]>();
    for (const o of pts) {
      let best = -1;
      let bestD = Infinity;
      anchors.forEach((a2, i) => {
        const d = Math.hypot(o.x - a2.x, o.y - a2.y);
        if (d < bestD) { bestD = d; best = i; }
      });
      // 어느 자리에도 안 붙을 만큼 멀면 셈에서 뺀다 — 그 점은 무엇을 쳤는지 말해 주지 않는다.
      if (best < 0 || bestD >= SORTIE_RADIUS) continue;
      const list = buckets.get(best);
      if (list) list.push(o); else buckets.set(best, [o]);
    }
    const spots = [...buckets.values()]
      .filter((list) => list.length >= SPOT_MIN_HITS)
      .sort((x, y) => Math.min(...x.map((o) => o.frame)) - Math.min(...y.map((o) => o.frame)))
      .slice(0, SPOT_MAX)
      .map((list) => [
        Math.round((list.reduce((t, o) => t + o.x, 0) / list.length) * 10) / 10,
        Math.round((list.reduce((t, o) => t + o.y, 0) / list.length) * 10) / 10,
      ] as [number, number]);
    return spots.length > 0 ? spots : null;
  };
  /* 안 나갔으면 빼는 것은 물량(mass-army)에도 건다 — 요청이 "고급유닛/많이뽑아도"라
     둘 다를 짚고 있다. 무게를 낮추는 위 표에 물량이 빠져 있는 것과는 별개다: 저건
     "분당 스무 기를 찍어냈다"가 그 판의 그림이라 자리를 뺏지 말자는 것이고, 여기서
     막는 건 그 물량이 끝내 집 밖으로 안 나간 경우다. */
  /* 뮤탈은 위 표에서 뺐지만(아래 이유) 이 문은 그대로 지난다 — 뽑아 놓고 집에 세워
     둔 뮤탈은 여전히 그 판의 장면이 아니다. */
  const SORTIE_GATE_KEYS = new Set([...PROD_ONLY_KEYS, "mass-army", "muta"]);
  for (let i = pool.length - 1; i >= 0; i -= 1) {
    const b = pool[i];
    if (!SORTIE_GATE_KEYS.has(b.k)) continue;
    if ((b.whom ?? []).length > 0 || Array.isArray(b.p?.xy)) continue;
    const actors = b.who ?? [];
    const verdicts = actors.map((w) => wentOut(w, b.at ?? null));
    // 한 사람이라도 나갔으면 남긴다. 다 '안 나갔다'로 판정났을 때만 뺀다 — 판단 근거가
    // 없는 사람(null)이 섞여 있으면 그건 '안 나갔다'가 아니므로 빼지 않는다.
    if (verdicts.length > 0 && verdicts.every((v) => v === false)) {
      pool.splice(i, 1);
      continue;
    }
    if (PROD_ONLY_KEYS.has(b.k)) {
      pool[i] = { ...b, weight: Math.max(1, b.weight - PROD_ONLY_PENALTY) };
    }
  }

  // 이미 무너진 사람의 활약담은 말하지 않는다(지적: 해골이 붙었는데 "병력을 뽑았다"가
  // 나온다) — 생산이 끊긴 뒤의 이야기는 그림과 앞뒤가 안 맞는다. 무너짐 자체를 말하는
  // 문장(궤멸·GG·맺음·부활·이사)은 당연히 남긴다.
  const DOWN_KEEP = new Set(["fallen", "gg", "no-elim", "stand", "result", "revival", "relocate", "lodging"]);
  for (let i = pool.length - 1; i >= 0; i -= 1) {
    const b = pool[i];
    if (DOWN_KEEP.has(b.k) || b.at === null || b.at === undefined) continue;
    const actors = b.who ?? [];
    if (actors.length === 0) continue;
    const allDown = actors.every((w) => {
      const f = downs[w];
      return f !== undefined && b.at! > f + DOWN_GRACE_FRAMES;
    });
    if (allDown) pool.splice(i, 1);
  }

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

  /* 급습이 그대로 큰 싸움으로 번진 자리는 두 사건이 아니라 한 사건이다(지적: 거의 같은
     시간대의 유사한 내용이 두 번 들어갔다) — 큰 싸움만 남기고 급습 문장을 덜어 낸다.
     맞은 사람이 그 싸움에 있었고 때와 자리가 CLASH_RAID_SEC·CLASH_RAID_TILES 안쪽일
     때만이다(위 주석). 위 hitNarrated보다 뒤에 두는 이유는, 덜어 낸 급습도 '맞았다'는
     사실 자체는 있었던 일이라 방어 문장의 quiet 판단은 그대로 서야 하기 때문이다. */
  const xyOf = (b: Beat): [number, number] | null => {
    const xy = b.p?.xy;
    return Array.isArray(xy) && xy.length === 2
      && typeof xy[0] === "number" && typeof xy[1] === "number" ? [xy[0], xy[1]] : null;
  };
  const clashSpots = pool
    .filter((b) => b.k === "clash" && typeof b.at === "number")
    .map((b) => ({ at: b.at as number, xy: xyOf(b), b }))
    .filter((c): c is { at: number; xy: [number, number]; b: Beat } => c.xy !== null);
  if (clashSpots.length > 0) {
    /** 그 사람이 이 싸움에 있었나 — 양쪽 대표(who)와 이름을 부를 만큼 싸운 사람들(parts). */
    const fought = (c: Beat, who: string): boolean => {
      if ((c.who ?? []).includes(who)) return true;
      for (const key of ["partsA", "partsB"]) {
        const xs = c.p?.[key];
        if (Array.isArray(xs) && xs.some((x) => x === who)) return true;
      }
      return false;
    };
    for (let i = pool.length - 1; i >= 0; i -= 1) {
      const b = pool[i];
      if (b.k !== "raid-damage" && b.k !== "gang-rush") continue;
      const victim = b.whom?.[0];
      const xy = xyOf(b);
      const at = b.at;
      if (!victim || !xy || typeof at !== "number") continue;
      const merged = clashSpots.some((c) =>
        fought(c.b, victim)
        && Math.abs(c.at - at) * SECONDS_PER_FRAME <= CLASH_RAID_SEC
        && Math.hypot(c.xy[0] - xy[0], c.xy[1] - xy[1]) <= CLASH_RAID_TILES);
      if (merged) pool.splice(i, 1);
    }
  }

  // 전술·돌파·합공처럼 '그 경기에서만 있었던 일'이 자리보다 많으면 그만큼 더 쓴다
  // (요청: 할 얘기가 많은 경기는 좀 더 써도 됨). 일반적인 사실로 늘리지는 않는다.
  //
  // 한때 열 문장까지 열어 봤는데 오히려 읽기 어려웠다(지적) — 다섯으로 되돌린다.
  // 다만 30분을 넘긴 경기는 그만큼 국면이 많아 일곱까지 허용한다(요청 — 위 baseBudget).
  // 일방적인 경기는 늘어놓을 국면 자체가 없다(요청) — 자리를 줄여 짧게 끝낸다.
  const budget = oneSided ? Math.min(baseBudget, 5) : baseBudget;

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

  /* 후반은 이긴 편의 이야기를 앞세운다(요청: 마지막으로 갈수록 왜 결말이 났는지 이해되게,
     A가 잘 싸우다가 갑자기 B가 이겼다가 되면 이상하다). 마지막 국면(뒤 1/3)에서 이긴 편의
     문장에만 가산점을 줘서, 자리가 빠듯할 때 그 대목이 먼저 남게 한다. 무게 자체를 바꾸지는
     않는다 — 고르는 순서에만 쓰는 값이다. */
  const LATE_WINNER_BONUS = 6;
  /** 그 문장이 이긴 편 쪽으로 기운 국면인가 — 이긴 편이 한 일이라도 그게 역풍을 맞았거나
   *  (rush-backfire) 자원부터 챙기다 얻어맞은 이야기면 국면은 상대 쪽이다. 진 편이 당한
   *  이야기는 반대로 이긴 편에 유리한 국면이다(요청: 마지막 국면에선 전황이 이긴 팀에
   *  유리한 걸 고르면 될 듯). */
  const favorsWinner = (b: Beat): boolean => {
    // 어느 편에도 기울지 않는 이야기(대치·소모전·손 빠르기·물량 …)는 마지막 국면에서
    // 앞세울 이유가 없다.
    if (LATE_NEUTRAL.has(b.k)) return false;
    return LATE_AGAINST_ACTOR.has(b.k) ? !b.won : b.won;
  };
  const pickWeight = (b: Beat): number =>
    b.weight + (phaseOf(b) === 2 && favorsWinner(b) ? LATE_WINNER_BONUS : 0);
  /* 이름 없는 급습은 '무엇으로 갔는지 이름을 못 붙인 진격'이다(replaySummaryText의
     tacticLabel). 그러니 같은 사람의 이름 있는 진격이 가까이에 있으면 그건 별개의 급습이
     아니라 그 진격이 도착한 것이고, 이름이 있는 쪽만 남기면 된다.

     무게를 겨루기 전에 걸러야 한다 — 자리 다툼에 맡기면 무게가 큰 쪽이 이기는데, 실제로
     이름 없는 급습이 이겨서 "3게이트에서 질럿 8기로 러시를 했다" 대신 "병력을 몰아
     들이쳤다"만 남았다(실측). 어느 쪽이 더 나은 문장인지는 무게가 아니라 이름의 유무가
     정한다.

     창(120초)은 '나가서 닿는 데 걸리는 시간'이라 경기 시간대에 따라 늘고 줄지 않는 고정값이다.
     실측으로 잡았다(22판, 같은 사람이 같은 상대에게 들이친 문장 쌍 10개): 64초짜리 한 쌍만
     실제로 같은 사건이었고 나머지 아홉 쌍은 139초 이상 떨어진 서로 다른 사건이라, 그 사이에서
     끊는다. */
  const NAMELESS_RAID_SEC = 120;
  const namelessRaid = (b: Beat): boolean =>
    b.k === "base-raid" || (b.k === "raid-damage" && b.p?.k === "base-raid");
  const namedPush = pool.filter((b) => PUSH_STORY_KEYS.has(b.k) && !namelessRaid(b));
  const ranked = [...pool]
    .filter((b) => !(namelessRaid(b) && namedPush.some((n) => (
      n.who[0] === b.who[0]
      && typeof n.at === "number" && typeof b.at === "number"
      && Math.abs(n.at - b.at) * SECONDS_PER_FRAME <= NAMELESS_RAID_SEC
    ))))
    .sort((x, y) => pickWeight(y) - pickWeight(x));
  /** '누가 무슨 유닛으로' — 같은 사람의 같은 유닛 이야기는 요약에 한 번이면 된다.
   *
   *  실측한 리플레이에서 한 사람의 캐리어 이야기가 셋이나 나왔다: "10분부터 26분까지
   *  캐리어를 놓지 않고 뽑으며 끌고 갔다", "캐리어 20기를 띄워 올렸다", 그리고 맺음말의
   *  "캐리어까지 꺼냈지만". 서로 다른 beat라 각자 무게 겨루기를 통과했지만 읽는 사람에게는
   *  같은 말이 세 번이다. 무게가 큰 것 하나만 남긴다(맺음말은 경기 전체를 요약하는
   *  자리라 여기 안 걸린다). */
  const unitSig = (b: Beat): string | null => {
    const unit = UNIT_STORY_KEYS[b.k]
      ?? (typeof b.p?.unit === "string" ? b.p.unit : null)
      // 수 이름에 유닛이 박혀 있는 갈래(위 TACTIC_UNIT) — "3게이트 질럿 러시"와 "질럿 물량"은
      // 같은 사람의 같은 유닛 이야기라 한 번이면 된다.
      ?? (typeof b.p?.k === "string" ? TACTIC_UNIT[b.p.k] ?? null : null);
    return unit && b.who[0] ? `${b.who[0]}|${unit}` : null;
  };
  /** 두 문장이 사실은 한 사건인가 — 같은 사람이, 한 장면 안에서, 같은 상대에게 들이친
   *  이야기면 갈래가 달라도 벌어진 일은 한 번의 진격이다.
   *
   *  위 unitSig가 이걸 하려다 놓친 자리다(지적: 거의 같은 내용이 두 스냅으로 들어간다 —
   *  "[01:47] 3게이트에서 질럿 8기로 러시를 했다"와 "[01:52] 상대 진영으로 병력을 몰아
   *  들이쳤다"). unitSig는 사건의 동일성을 '유닛 이름'으로 판정하는데, 유닛을 못 짚은
   *  갈래(이름 없는 급습은 무엇으로 갔는지 모를 때 "병력"이라고만 말한다)에서는 키 자체가
   *  안 만들어져 그대로 통과한다. 유닛은 사건의 속성일 뿐이라 동일성의 근거가 못 된다 —
   *  사건을 가리키는 것은 '누가, 언제, 누구에게'다.
   *
   *  창은 한 장면 폭(RAID_MERGE_SEC)을 그대로 쓴다 — 같은 사람이 같은 상대에게 이 안에서
   *  두 번 들이쳤다면 그건 한 번의 진격을 두 각도로 본 것이다. 무게순으로 고르므로
   *  살아남는 쪽은 늘 더 구체적인 문장이다("3게이트에서 질럿 8기로" > "병력을 몰아"). */
  const sameEvent = (a: Beat, b: Beat): boolean => {
    if (!PUSH_STORY_KEYS.has(a.k) || !PUSH_STORY_KEYS.has(b.k)) return false;
    const who = a.who[0];
    if (!who || who !== b.who[0]) return false;
    if (typeof a.at !== "number" || typeof b.at !== "number") return false;
    if (Math.abs(a.at - b.at) * SECONDS_PER_FRAME > sceneWindowSec(RAID_MERGE_SEC, a.at)) return false;
    // 상대를 짚은 문장끼리는 같은 상대여야 한 사건이다 — 한쪽이 상대를 모르면 시간과
    // 사람만으로 본다(그 갈래는 애초에 '누구에게'를 못 싣는다).
    const av = a.whom ?? [];
    const bv = b.whom ?? [];
    if (av.length > 0 && bv.length > 0 && !av.some((w) => bv.includes(w))) return false;
    return true;
  };
  /** 인과 문장(이사·궤멸의 '왜')에만 내주는 여유 자리 — 요청: 문장 수를 늘리더라도
   *  스토리텔링이 잘 되게. 자리 다툼에 맡기면 앞이야기가 늘 먼저 잘려 나가, 해골이
   *  아무 맥락 없이 툭 뜨는 요약이 됐다. 여유분은 이 목적으로만 쓰이므로 평범한 경기의
   *  길이는 그대로다. */
  /* 마법을 실제로 여러 번 쓴 이야기(tech)에도 같은 방식의 예약석을 준다(요청: 스톰 문장
     자리 확보). 무게만으로는 이 갈래가 구조적으로 진다 — 최대치가 19쯤인데(TECH_BASE_WEIGHT
     9 + 기술 점수 + 사용 횟수 보너스 3) 러시·물량·교전은 20을 예사로 넘는다. 그래서 스톰을
     150번 쓴 판에서도 그 이야기가 통째로 빠졌다(실측: 8인전 vessel — 컷 20, 스톰 19). 예약석은
     tech에만 쓰이므로 마법이 없던 경기의 길이는 그대로다. */
  /* 큰 교전이 여러 번이면 여러 번 나오는 게 맞다(요청) — 그런데 둘째 교전은 자리 다툼에서
     구조적으로 진다. 실측(172판): 후보로는 둘 이상이 105판에서 만들어졌는데 요약까지 간 건
     10판뿐이었고, 밀린 306번이 전부 '자리가 다 찼다'였다(무게·갈래 상한·국면 상한에 걸린
     것은 한 번도 없었다). 무게를 올려도 소용없다 — 15까지 올려 봐도 22판이었다. 후반 문장은
     이긴 편 가산점(LATE_WINNER_BONUS)까지 얹혀 20을 예사로 넘기 때문이다.
     그래서 마법(tech)과 같은 방식의 예약석을 준다. 예약은 교전이 여러 번이던 판에서만
     쓰이므로 다른 경기의 길이는 그대로고, 밀려나는 이야기도 없다. */
  /* 물량 이야기(파워 OO·물량)도 같은 사연이다(지적: 탱크를 135기나 뽑아 중앙을 잡은
     내용이 통째로 안 나온다). 무게가 11~12라 급습·교전(20 안팎)에 늘 밀리는데, 172판에서
     실제로 요약까지 간 물량 문장은 8건뿐이었고 큰 교전이 여러 번 나오게 되면서 0건이
     됐다. 한 판에 한 자리만 내준다 — 물량이 있던 판에서만 쓰이므로 다른 경기 길이는
     그대로다. */
  /* 정찰(스캔)도 같은 사연이다(요청: 스캔·오버로드·옵저버로 여기저기 정찰한 것도 묘사
     포인트) — 무게 8~9로는 급습·교전(20 안팎)에 절대 못 이겨서 172판에서 0건이었다.
     한 자리만 내주되, 근거가 확실한 것에만 준다(아래 SCAN_RESERVE_MIN) — 스캔 몇 번은
     정찰이 아니라 그냥 탐지다. */
  /* 노엘도 같은 사연이다(요청: 노엘을 외쳤다는 대사를 넣으면 좋겠다) — 무게를 15까지
     올려 봐도 급습·교전(20 안팎)에 밀려 붐비는 팀전에서는 늘 '자리 없음'으로 잘렸다
     (실측: 4:4 한 판에서 두 번 다 no room). 한 판에 한 자리만 내준다 — 노엘이 나온
     판에서만 쓰이므로 다른 경기 길이는 그대로다. */
  const EXTRA_SLOTS = {
    cause: 2, tech: 2, clash: CLASH_BEATS_MAX - 1, mass: 1, scout: 1, giveup: 1,
  } as const;
  type Reserve = keyof typeof EXTRA_SLOTS;
  const extraUsed: Record<Reserve, number> = { cause: 0, tech: 0, clash: 0, mass: 0, scout: 0, giveup: 0 };
  /** 예약 없이 들어간 수 — 예약석은 갈래마다 따로 세야 한다. 예전엔 chosen.length로
   *  방을 쟀는데, 갈래가 둘이 되면 한쪽이 쓴 예약석이 다른 쪽 방까지 먹어 버린다. */
  let plain = 0;
  const consider = (b: Beat, capped: boolean, reserve?: Reserve): boolean => {
    if (chosen.includes(b)) return false;
    if (plain >= slots && (!reserve || extraUsed[reserve] >= EXTRA_SLOTS[reserve])) return false;
    // 앞이야기는 무게가 가벼워도 싣는다 — '재미'로 뽑는 자리가 아니라 '왜'를 대는 자리다.
    if (b.weight < (reserve === "cause" ? CAUSE_MIN_WEIGHT : MIN_WEIGHT)) return false;
    const sig = unitSig(b);
    if (sig && chosen.some((x) => unitSig(x) === sig)) return false;
    if (chosen.some((x) => sameEvent(x, b))) return false;
    const capKey = capKeyOf(b);
    const cap = PER_KEY_CAP[capKey];
    if (cap !== undefined && chosen.filter((x) => capKeyOf(x) === capKey).length >= cap) return false;
    if (capped && taken[phaseOf(b)] >= perPhaseMax) return false;
    if (b.dedupeOn && chosen.some((x) => renderReplaySummary(
      { v: REPLAY_SUMMARY_VERSION, beats: [strip(x)] }, (raw) => raw,
    )?.includes(b.dedupeOn!))) return false;
    if (reserve && plain >= slots) extraUsed[reserve] += 1; else plain += 1;
    chosen.push(b);
    taken[phaseOf(b)] += 1;
    return true;
  };
  // 0차: 이사·궤멸과 그 판 최대 교전은 자리를 다투기 전에 먼저 넣는다(요청: 중요 이벤트라
  // 절대 빠지면 안 된다). 무게로 겨루게 두면 러시·물량 이야기에 밀려 통째로 사라졌다 —
  // 실측으로 확인했다: 최대 교전은 리플레이 8판 모두에서 잡히는데 문장이 된 건 한 판뿐이었다.
  const MUST_KEEP = new Set(["relocate", "fallen", "clash"]);
  /** 그중 정말 먼저 넣을 문장 — 교전은 여러 번 나올 수 있게 됐지만(요청) 필수인 것은
   *  그 판의 절정 하나뿐이다. 나머지 교전은 무게로 겨룬다(clashBeatOf의 keep). */
  const mustKeep = (b: Beat): boolean => MUST_KEEP.has(b.k) && (b.k !== "clash" || b.keep === true);
  // 이사·빈사·궤멸 앞에는 반드시 '왜 그렇게 됐나'가 있어야 한다(지적: 그 앞에 아무 이야기가
  // 없으면 갑자기 무너진 것처럼 읽힌다 — 여전히 그런 경기가 너무 많다). 세 단계로 찾는다:
  //
  //  ① 그 사람을 whom으로 콕 집어 때린 문장. 가장 곧은 원인이라 무게순으로 고른다.
  //  ② 없으면, 그 사람을 밀어낸 사람(p.by — 그 집까지 병력을 몰고 온 사람)이 그 무렵 한 일.
  //     "누가 때렸다"고 못 박지는 못해도 "그 사람이 이러고 있을 때 이렇게 됐다"는 되고,
  //     팀전에서 whom을 못 짚는 경기가 정확히 여기서 구제된다.
  //  ③ 그것도 없으면 당사자가 직전에 무엇을 하고 있었나. 원인의 반쪽이지만, 아무 앞이야기
  //     없이 해골만 뜨는 것보다는 낫다(요청: 문장 수를 늘리더라도 스토리텔링이 되게).
  //
  // ②·③은 한참 전 이야기를 끌어오면 인과로 안 읽히므로 CAUSE_NEAR_SEC 안쪽만 본다. 또
  // 타겟 없는 순수 생산 이야기는 후보에서 뺀다(요청: 무의미한 유닛생산은 중요도 낮추기).
  // 최종 정렬은 시간순이라 여기서 챙긴 문장은 자연히 이사·궤멸 문장보다 앞에 놓인다.
  const causeFor = (b: Beat): Beat | null => {
    const victim = b.who[0];
    if (!victim) return null;
    const upTo = b.at;
    const before = (x: Beat) =>
      typeof upTo !== "number" || typeof x.at !== "number" || x.at <= upTo;
    const near = (x: Beat) =>
      typeof upTo !== "number" || typeof x.at !== "number"
      || (upTo - x.at) * SECONDS_PER_FRAME <= CAUSE_NEAR_SEC;
    const targeted = (x: Beat) =>
      !PROD_ONLY_KEYS.has(x.k) || (x.whom ?? []).length > 0 || Array.isArray(x.p?.xy);
    const cand = pool.filter((x) => x !== b && !MUST_KEEP.has(x.k) && before(x) && targeted(x));
    const heaviest = (xs: Beat[]) => xs.sort((m, n) => n.weight - m.weight)[0] ?? null;
    /** ②·③은 '직전'이 곧 인과라, 무게보다 가까움을 앞세운다. */
    const latest = (xs: Beat[]) =>
      xs.sort((m, n) => (n.at ?? -Infinity) - (m.at ?? -Infinity) || n.weight - m.weight)[0] ?? null;
    const direct = heaviest(cand.filter((x) => (x.whom ?? []).includes(victim)));
    if (direct) return direct;
    const by = typeof b.p?.by === "string" ? b.p.by : null;
    if (by) {
      const byAct = latest(cand.filter((x) => near(x) && (x.who ?? []).includes(by)));
      if (byAct) return byAct;
    }
    return latest(cand.filter((x) => near(x) && (x.who ?? []).includes(victim)));
  };
  for (const b of ranked) {
    if (!mustKeep(b) || !consider(b, false)) continue;
    const hit = causeFor(b);
    if (hit) consider(hit, false, "cause");
  }
  // 1차: 국면 상한을 지키며 무게순으로 채운다.
  for (const b of ranked) consider(b, true);
  // 2차: 그래도 자리가 남으면(한쪽 국면에만 이야기가 몰린 경기) 상한을 풀고 마저 채운다 —
  // 균형을 맞추자고 쓸 수 있는 이야기를 버리지는 않는다.
  for (const b of ranked) consider(b, false);
  // 3차: 마법 예약석(요청) — 여기까지 와서도 못 든 tech를 예약분만큼 태운다. 맨 뒤에 두는
  // 이유는, 자리 다툼에서 정상적으로 이겼으면 이미 들어가 있어 예약분을 안 쓰기 때문이다.
  // 갈래 상한(PER_KEY_CAP.tech)이 그대로 걸려 스톰 이야기가 줄줄이 서지는 않는다.
  //
  // 다만 예약석은 '많이 써서 그 판의 그림이 된' 마법에만 내준다 — 한두 번 써 본 스톰까지
  // 자리를 보장하면 예약이 곧 "스톰 한 번 썼음" 줄을 만드는 장치가 된다(실측: 스톰 1회,
  // 디스럽션웹 4회가 새로 문장이 됐다). 그런 것도 무게로 이기면 얼마든지 들어간다 —
  // 여기서 막는 건 자리 보장뿐이다.
  for (const b of ranked) {
    if (b.k !== "tech") continue;
    const uses = typeof b.p?.n === "number" ? b.p.n : 0;
    const rank = typeof b.p?.tech === "string"
      ? (TECH_RANK[b.p.tech as keyof typeof TECH_RANK] ?? 0) : 0;
    /* 자주 쓰는 마법은 '많이 썼나'로, 드물게 쓰는 마법은 '썼나'로 가른다(지적: 아비터를
       클로킹·스테이시스로도 쓰는데 무조건 리콜로만 연결되는 건 아닌지 검토).
       리콜은 실제로 리콜을 쓴 좌표에서만 나오므로 잘못 붙는 일은 없었지만, 확인하다 보니
       반대쪽이 비어 있었다 — 실측(172판) 스테이시스를 쓴 사람이 17명인데 요약에 나온 적은
       0건이었다. 예약석 문턱이 '열 번 이상'이라 그 마법에는 절대 안 걸린다: 마법별 사용
       횟수 중앙값이 스톰 11회·마인 18회인 반면 스테이시스 3회·플레이그 3회·EMP 4회다.
       한 번 쓰는 것만으로 판이 갈리는 마법(TECH_RANK 6 이상)은 세 번부터 자리를 준다. */
    if (uses < TECH_RESERVE_MIN_USES && !(rank >= TECH_RARE_RANK && uses >= TECH_RARE_MIN_USES)) continue;
    consider(b, false, "tech");
  }
  // 4차: 정찰 예약석 — 판을 훑어본 스캔에만(위 EXTRA_SLOTS 주석).
  for (const b of ranked) {
    if (b.k !== "vision-eye" || b.p?.unit !== "Scanner Sweep") continue;
    if ((typeof b.p?.n === "number" ? b.p.n : 0) < SCAN_RESERVE_MIN) continue;
    if (consider(b, false, "scout")) break;
  }
  // 4.5차: 노엘 예약석 — 그 판에 하나뿐인 한마디라 자리 다툼에 맡기지 않는다.
  for (const b of ranked) {
    if (b.k !== "no-elim") continue;
    if (consider(b, false, "giveup")) break;
  }
  // 5차: 물량 예약석 — 파워 OO와 물량 중 무거운 쪽 하나만 태운다(위 EXTRA_SLOTS 주석).
  for (const b of ranked) {
    if (b.k !== "power-unit" && b.k !== "mass-army") continue;
    if (consider(b, false, "mass")) break;
  }
  // 6차: 큰 교전 예약석(요청: 큰 교전이 여러 번이면 여러 번 나오는 게 맞다) — 그 판의 절정
  // 하나는 0차에서 이미 들어갔고, 여기서 태우는 건 그에 견줄 만한(CLASH_EXTRA_SHARE) 다른
  // 싸움들이다. 자리 다툼에서 정상적으로 이겼으면 이미 들어가 있어 예약분을 안 쓴다.
  for (const b of ranked) {
    if (b.k !== "clash") continue;
    consider(b, false, "clash");
  }
  /* 이야기의 뼈대는 시간이다 — 후보를 모두 시간순으로 세우고, 그 순서는 이 뒤로 절대
     바꾸지 않는다(요청). 이 줄 뒤에 남은 일은 '그중 무엇을 태울까'뿐이다.

     예전에는 여기서 꼬리를 따로 세웠다(GG를 맨 뒤로, 진 편의 맺음을 그 앞으로). 이유는
     "이미 항복한 사람 뒤에 다른 일이 이어지면 이상하다"였는데, 자막이 [42:17]처럼 초까지
     적는 지금은 순서를 손대는 쪽이 훨씬 더 이상하게 읽힌다 — 실제로 GG 42:17 뒤에 역공
     42:38이 있던 판에서 시각이 거꾸로 갔다(지적). GG를 치고도 더 맞았으면 그게 그 판의
     그림이다. 시점을 못 잡은 문장(올인처럼 한 순간이 아닌 것)만 시각이 없어 뒤로 간다.

     정렬은 안정 정렬이라 시각이 같은 것들끼리는 넣은 차례가 그대로 남는다. */
  const timeOf = (b: Beat): number =>
    (typeof b.at === "number" ? b.at : Number.POSITIVE_INFINITY);
  chosen.sort((a, b) => timeOf(a) - timeOf(b));
  /* (삭제) 시간순을 조금 어기면서까지 이야기를 다듬던 두 규칙 — ① 같은 편 문장 사이에
     낀 다른 편 문장을 비켜 세우기, ② 당한 문장을 그 사람의 제 문장 뒤로 밀기.
     둘 다 "자막에 적히는 분이 거꾸로 가지 않을 때만" 바꾼다는 안전장치를 달고 있었는데,
     그 판정(sameLabel)이 minutes() = Math.round(초/60)을 썼다. 자막이 "5분 만에"처럼
     분만 적던 시절의 잣대다.

     지금 자막은 [02:44]처럼 초까지 적는다. 그래서 2분 44초(round → 3)와 3분 09초
     (round → 3)가 '같은 분'으로 통과해 자리가 바뀌었고, 화면에는 03:09 다음에 02:44가
     떴다(지적: "그 직후"까지 붙었는데 그 스냅이 오히려 시간이 반대다). 타임라인 눈금도
     같은 값을 쓰므로 스크럽이 거꾸로 갔다.

     초까지 적는 자막에서는 시각이 다른 두 문장을 바꾸면 무조건 눈에 보인다 — 즉 이 두
     규칙은 안전하게 쓸 수 있는 자리가 없다. 잣대를 초 단위로 좁히면 사실상 한 번도 안
     도는 죽은 코드가 되므로 규칙 자체를 걷어낸다. 이야기의 뼈대는 시간이다(위 정렬). */

  /* 경기를 끝낸 마지막 싸움 — 맺음말이 가리킬 자리다(요청: 결론은 전투니까 화살표와 액션
     이모지도 다른 스냅과 동일하게). 근거는 그 판 최대 교전을 찾을 때와 같고(마법과 어택
     지정이 한때 한곳에 몰린 자리), 가장 큰 것 대신 가장 늦은 것을 고른다. */
  const finale = lastClash(winnerPlayers, loserPlayers);
  /** 그 마지막 싸움에서 맞은 쪽 — 그림이 이 사람들에게서도 화살표를 그어 맞부딪게 한다. */
  const finaleFoes = (() => {
    if (!finale) return [];
    const inSide = (raw: string) => loserPlayers.some((q) => q.rawName === raw);
    const named = finale.parts.filter(inSide);
    // 그 자리에서 이름을 부를 만큼 싸운 사람이 없으면(맞고만 있었으면 명령이 몇 개 안
    // 남는다) 그 편에서 가장 많이 찍은 한 사람을 쓴다 — 맞은 쪽이 없는 싸움은 없다.
    if (named.length > 0) return named;
    const rep = finale.who.find(inSide);
    return rep ? [rep] : [];
  })();

  /* 마지막 싸움이 '이긴 편의 집'에서 벌어진 판(요청: 결론 전투 장소가 이긴 팀 본진인
     경우가 많아 "정리했다"가 어색하다 — 이럴 땐 방어에 성공하고 그 후 역공하는 스냅까지
     있어야 한다). 실측(169판): 마지막 싸움터가 진 편 기지 56% · 센터 33% · 이긴 편 기지
     11%(18판)였고, 그 18판은 하나도 빠짐없이 그 뒤에 이긴 편이 진 편 진영으로 어택을
     찍었다(중앙 121번). 즉 그 판들의 결말은 '몰아붙여 정리'가 아니라 '막아 내고 역공'이다.

     그래서 두 장면을 따로 세운다 — 제 집에서 막아 낸 대목과, 그 뒤 상대 집으로 넘어간
     대목. 맺음말은 그 둘을 이어받아 맺는다(p.held). */
  const homeStand = (() => {
    if (!finale || finaleFoes.length === 0) return null;
    const homeOfRaw = (raw: string): [number, number] | null => bases[raw] ?? null;
    const yards = Object.values(bases);
    if (yards.length < 2) return null;
    let near = Infinity;
    for (let i = 0; i < yards.length; i += 1) {
      for (let j = i + 1; j < yards.length; j += 1) {
        near = Math.min(near, Math.hypot(yards[i][0] - yards[j][0], yards[i][1] - yards[j][1]));
      }
    }
    const yard = Math.max(HOME_STAND_MIN_TILES, near * HOME_STAND_YARD);
    /* 그 싸움터가 누구의 집이었나 — 가장 가까운 집 하나만 본다.

       한때는 "이긴 편 누군가의 마당(yard) 안인가"만 물었다. 절대 반경 하나라, 마당 원
       바깥으로 조금만 벗어나면 다른 어떤 집보다 두 배 가까운 자리인데도 '아무의 집도
       아님'이 됐다(지적: 격전지가 2팀 렉스의 본진 바로 앞인데 자막은 "2팀이 한꺼번에
       몰아붙여 판을 정리했다"였다 — 화면상 렉스까지가 다음 집까지의 절반도 안 됐다).

       그래서 두 잣대 중 하나만 맞으면 그 집으로 본다: 마당 안이거나, 다른 어떤 집보다
       뚜렷하게 가깝거나. 뒤엣것은 반경이 없는 비교라 맵 크기·본진 간격에 안 흔들린다.
       센터 싸움은 어느 집과도 거리가 비슷해 둘 다 안 맞는다(그게 이 판정의 목적이다). */
    const ranked = Object.entries(bases)
      .map(([raw, h]) => ({ raw, d: Math.hypot(finale.xy[0] - h[0], finale.xy[1] - h[1]) }))
      .sort((a, b) => a.d - b.d);
    const nearest = ranked[0];
    const runnerUp = ranked[1];
    const atSomeonesBase = nearest !== undefined
      && (nearest.d <= yard
        || (runnerUp !== undefined && nearest.d <= runnerUp.d * HOME_STAND_CLEAR));
    const host = atSomeonesBase
      ? winnerPlayers.find((p2) => p2.rawName === nearest.raw)
      : undefined;
    if (!host) return null;
    /* 막아 낸 뒤의 역공 — 그 싸움 뒤에 이긴 편이 진 편 진영에 찍은 어택 지정이다. 몇 번
       찍혔나로 '정말 넘어갔나'를 가른다(위 실측: 중앙 121번). 가장 많이 두들긴 집을
       목표로 삼고, 그 자리에 실제로 찍은 사람만 주어로 부른다. */
    const tally = new Map<string, { n: number; by: Map<string, number> }>();
    for (const p2 of winnerPlayers) {
      for (const o of p2.signals?.orderPositions ?? []) {
        if (o.kind !== "attack" || o.frame <= finale.at) continue;
        for (const q of loserPlayers) {
          const h = homeOfRaw(q.rawName);
          if (!h || Math.hypot(o.x - h[0], o.y - h[1]) > yard) continue;
          const cur = tally.get(q.rawName) ?? { n: 0, by: new Map<string, number>() };
          cur.n += 1;
          cur.by.set(p2.rawName, (cur.by.get(p2.rawName) ?? 0) + 1);
          tally.set(q.rawName, cur);
        }
      }
    }
    const hit = [...tally].sort((a, b) => b[1].n - a[1].n)[0];
    if (!hit || hit[1].n < COUNTER_MIN_ORDERS) return { host: host.rawName, counter: null };
    const pushers = [...hit[1].by]
      .filter(([, n]) => n >= COUNTER_MIN_EACH)
      .sort((a, b) => b[1] - a[1])
      .map(([raw]) => raw);
    if (pushers.length === 0) return { host: host.rawName, counter: null };
    // 역공이 시작된 때 — 그 집에 처음 어택을 찍은 순간이다.
    let from = Infinity;
    for (const raw of pushers) {
      const p2 = winnerPlayers.find((x) => x.rawName === raw);
      const h = homeOfRaw(hit[0]);
      if (!p2 || !h) continue;
      for (const o of p2.signals?.orderPositions ?? []) {
        if (o.kind !== "attack" || o.frame <= finale.at) continue;
        if (Math.hypot(o.x - h[0], o.y - h[1]) > yard) continue;
        from = Math.min(from, o.frame);
      }
    }
    return {
      host: host.rawName,
      counter: Number.isFinite(from)
        ? { at: from, who: pushers, whom: hit[0], xy: bases[hit[0]] ?? null, n: hit[1].n }
        : null,
    };
  })();
  const standBeats: Beat[] = homeStand
    ? [
      {
        k: "hold-off", won: true, at: finale!.at, weight: 24,
        who: [homeStand.host], whom: finaleFoes,
        p: { xy: finale!.xy, fight: true },
      },
      ...(homeStand.counter
        ? [{
          k: "counter", won: true, at: homeStand.counter.at, weight: 24,
          who: homeStand.counter.who, whom: [homeStand.counter.whom],
          p: {
            ...(homeStand.counter.xy ? { xy: homeStand.counter.xy } : {}),
          },
        } as Beat]
        : []),
    ]
    : [];

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
      /* 맺음말도 전투 장면이다(요청: 결론은 전투니까 화살표와 액션 이모지도 다른 스냅과
         동일하게) — 경기를 끝낸 그 싸움터가 이 문장의 자리다. 마지막으로 부딪친 자리를
         찍어 두면 그림 쪽이 다른 교전 스냅과 똑같이 그린다: 양쪽 화살표가 그 한 점에서
         만나고(fight), 촉에는 전투 이모지가 붙는다. 못 찾으면 예전처럼 자리 없이 간다. */
      /* 제 집에서 막아 내고 역공으로 끝낸 판은 맺음말의 자리도 그 역공 쪽이다 — 마지막
         싸움터(제 집)를 가리키면 "몰아붙여 끝냈다"와 그림이 정반대가 된다. */
      ...(homeStand?.counter?.xy
        ? { xy: homeStand.counter.xy, fight: true }
        : finale ? { xy: finale.xy, fight: true } : {}),
      ...(homeStand ? { held: true } : {}),
    },
    ...(useTeam
      ? (domUnit && dominant ? { who2: [dominant.rawName] } : {})
      : (heroUnit && star ? { who2: [star.rawName] } : {})),
    // 역전패한 경기는 진 편 입장에서 맺어도 좋다(요청: "결국 2팀은 초반 승기를 잡았지만
    // 1팀의 …에 버티지 못하고 GG"). 그러려면 진 편이 누구인지 문장 쪽이 알아야 한다.
    /* 역전패한 경기는 진 편 입장에서 맺어도 좋다(요청: "결국 2팀은 초반 승기를 잡았지만
       1팀의 …에 버티지 못하고 GG"). 그러려면 진 편이 누구인지 문장 쪽이 알아야 한다.
       그 밖의 경기에서는 '마지막 싸움에서 맞은 쪽'을 담는다 — 문장은 이 값을 쓰지 않지만
       그림이 그 사람들에게서 화살표를 받아 맞부딪는 장면을 그린다(위 finale). */
    ...(mode === "comeback"
      ? { whom: loserPlayers.map((p) => p.rawName) }
      : finaleFoes.length > 0 ? { whom: finaleFoes } : {}),
  };

  /* 승패는 맺음말에서 떼어 마지막 한 스냅으로 못박는다(요청: 결론 스텝을 결론 전투 내용과
     승패로 나누고, 승패는 시작 스냅처럼 누가 이겼는지만 표시하는 스냅으로 고정).

     맺음말(ending)은 '무엇으로 어떻게 끝냈나'까지만 말하고, '누가 이겼나'는 이 한 줄이
     전담한다. 이긴 편 전원을 담는다 — 문장은 팀 번호로 부르고(팀전) 그림은 이 사람들
     아바타에 트로피를 얹는다(GameResultStory). */
  const verdict: Beat = {
    k: "verdict", won: true, at: Number.POSITIVE_INFINITY, weight: 1001,
    who: winnerPlayers.map((p) => p.rawName),
  };

  /* 막아 냄·역공은 자리 다툼을 거치지 않는다 — 맺음말과 한 벌인 결말 장면이라 늘 들어가야
     한다(요청). 넣는 자리는 다른 후보와 똑같이 제 시각이 정한다. */
  chosen.push(...standBeats);
  chosen.sort((a, b) => timeOf(a) - timeOf(b));

  const moves: Record<string, [number, number, number][]> = {};
  for (const [raw, list] of moveList) moves[raw] = list;

  const byName = new Map(replay.players.map((p) => [p.rawName, p]));
  /* 마지막 몰아붙임(ending)은 GG보다 앞이다(지적: 브래드가 GG를 친 뒤에 브래드 기지로
     쳐들어간 모양새가 부자연스럽다) — GG는 그 싸움에 밀려 친 것이므로 순서가 뒤집히면
     이미 항복한 사람을 다시 치는 그림이 된다. chosen 안에서는 GG가 꼬리의 맨 뒤인데
     (tailRank) 맺음말·승패는 그 뒤에 따로 붙여 왔던 탓이다.
     ending에 GG와 같은 시각을 준다 — 타임라인은 눈금 자리를 at으로 잡으므로, 시각이
     없는 채로 GG 앞에 서면 눈금만 거꾸로 간다(시각 없는 문장은 맨 오른쪽에 놓인다).
     실제로도 그 싸움이 끝나는 순간이 GG라 지어낸 시각이 아니다. */
  const captionBeats: Beat[] = (() => {
    /* 노엘을 외치고도 끝내 다 털린 경우를 표시해 둔다(요청: 그게 웃음 포인트) —
       '털렸다'의 근거는 elims다: 판을 떠난 기록이거나, 그 뒤로 유닛도 건물도 하나
       안 낸 것(생산 0). 외친 뒤에 그렇게 됐을 때만이다. */
    for (let i = 0; i < chosen.length; i += 1) {
      const b = chosen[i];
      if (b.k !== "no-elim") continue;
      const raw = b.who?.[0];
      const end = raw === undefined ? undefined : elims[raw];
      if (end === undefined || (typeof b.at === "number" && end < b.at)) continue;
      chosen[i] = { ...b, p: { ...(b.p ?? {}), out: true } };
    }
    /* 맺음말과 승패는 사건이 아니라 이야기의 맺음이라 늘 맨 뒤 한 벌이다(요청: 결론
       전투 내용과 승패를 나눠서 스냅으로). 앞의 사건들은 시간순 그대로 두고 여기에만
       붙인다 — 맺음말에 마지막 사건의 시각을 주는 건 타임라인 눈금이 at을 쓰기
       때문이다(시각이 없으면 눈금만 맨 오른쪽으로 튄다). */
    const lastAt = Math.max(
      ...chosen.map((b) => (typeof b.at === "number" && Number.isFinite(b.at) ? b.at : -1)),
    );
    return [...chosen, ...(lastAt >= 0 ? [{ ...ending, at: lastAt }] : [ending]), verdict];
  })();

  /* 저장은 전부, 자막은 그중 일부다(요청: 전략·전술·건설·생산 등 모든 것을 최대한 저장해야
     통계에서도 쓴다). 한때는 자리 다툼에서 이긴 것만 저장했는데, 그러면 밀린 전술은 통계에
     아예 없던 일이 된다 — 칭호가 세는 수가 딱 그만큼 틀리고 있었다(지적).
     자막에 실을 것들을 앞에 세우고(그 자리번호가 곧 pick), 못 실린 후보를 뒤에 잇는다.
     이 순서가 곧 규칙이다 — 미니맵·타임라인은 "0번부터 이 문장까지"를 훑어 그때까지 무슨
     일이 있었는지를 쌓으므로, 자막에 실린 것들이 이야기 순서대로 앞에 서 있어야 한다.

     pool이 아니라 ranked로 잇는다: pool에는 이름 있는 진격과 같은 사건을 가리키는 이름 없는
     급습이 함께 들어 있고(위 NAMELESS_RAID_SEC), 그 둘을 다 저장하면 통계가 한 번의 진격을
     두 번 센다. ranked는 그 겹침을 이미 덜어낸 목록이다. */
  const restBeats = ranked.filter((b) => !captionBeats.includes(b));
  const enrich = (list: Beat[]) => list.map(strip).map(withCastPlace).map((b) => {
    const pos = beatPositions(b, byName);
    /* 나간 것이 확인된 생산담은 '나간 자리'를 그 이야기의 자리로 덮어쓴다(요청: 센터도
       진출로 보고 그 좌표에 화살표를 표시). 기본 자리는 그 무렵 명령이 가장 몰린 곳이라
       생산 중에는 거의 늘 제 본진이고, 그러면 화살표를 그릴 만큼 멀지 않아 본진 이모지
       하나로 끝난다 — 실제로 나간 이야기인데 그림에는 아무 움직임이 없었다.
       이미 자리를 아는 이야기(whom·p.xy)는 위 게이트에서 걸러져 여기 안 온다. */
    const sortie = SORTIE_GATE_KEYS.has(b.k)
      ? Object.fromEntries(
        (b.who ?? []).map((w) => [w, sortiePos(w, b.at ?? null)] as const)
          .filter((e): e is readonly [string, [number, number]] => e[1] !== null),
      )
      : {};
    /* 여러 곳을 헤집은 이야기는 자리를 여럿 싣는다(위 sortieSpots) — 한 곳뿐이면 위
       sortie가 이미 그 자리를 말하고 있으므로 싣지 않는다. 문장도 이 수를 보고 '사방'
       이라 말할지 말지를 정하므로(replaySummaryText) 주어의 수를 p에도 남긴다. */
    const spots = SORTIE_GATE_KEYS.has(b.k)
      ? Object.fromEntries(
        (b.who ?? []).map((w) => [w, sortieSpots(w, b.at ?? null)] as const)
          .filter((e): e is readonly [string, [number, number][]] =>
            e[1] !== null && e[1].length >= 2),
      )
      : {};
    const spotN = spots[(b.who ?? [])[0]]?.length ?? (sortie[(b.who ?? [])[0]] ? 1 : 0);
    /* 화살표 기둥의 이름표는 '그 무렵 무엇을 움직였나'라 시각이 있어야 한다. 맺음말은
       '늘 마지막'이라는 뜻으로 시각을 비워 두므로(strip), 그 대신 경기를 끝낸 싸움의
       시각을 넘겨 준다 — 그래야 다른 교전 스냅처럼 화살표에 병력 이름이 붙는다(요청). */
    const forArrow = b.k === "result" && finale ? { ...b, at: finale.at } : b;
    const units = arrowUnits(forArrow);
    const sizes = arrowSizes(forArrow, units);
    const finalPos = { ...(pos ?? {}), ...sortie };
    const hp = powersAt(forArrow.at);
    return {
      ...b,
      ...(spotN > 0 ? { p: { ...(b.p ?? {}), spotN } } : {}),
      ...(Object.keys(finalPos).length > 0 ? { pos: finalPos } : {}),
      ...(Object.keys(spots).length > 0 ? { spots } : {}),
      ...(units ? { units } : {}), ...(sizes ? { sizes } : {}),
      ...(hp ? { hp } : {}),
    };
  });
  /* 대사는 자막에 실린 장면에만 붙인다 — 말주머니는 미니맵 스냅에 뜨는 것이라, 안 보여줄
     비트에 붙으면 그 대사는 아무 데도 안 나오면서 가장 가까운 스냅의 몫만 뺏는다. */
  const shown = withChat(replay, enrich(captionBeats));
  const finalBeats = [...shown, ...enrich(restBeats)];

  /* BEST PLAYER는 이야기가 다 짜인 뒤에 뽑는다 — 근거가 그 이야기 자체라(위 bestOf 주석),
     자리 다툼에서 잘려 나간 후보들까지 세면 화면에 안 나온 일로 뽑는 셈이 된다. */
  const best = bestOf(shown, winnerPlayers, loserPlayers);

  return {
    v: REPLAY_SUMMARY_VERSION,
    // '초반'을 재려면 경기가 얼마나 길었는지를 알아야 한다(지적).
    ...(totalFrames ? { end: totalFrames } : {}),
    // 개인전에서는 팀 용어를 쓰지 않는다(요청).
    ...(duel ? { duel: true } : {}),
    ...(best ? { best } : {}),
    ...(Object.keys(bases).length > 0 ? { bases } : {}),
    ...(Object.keys(hubs).length > 0 ? { hubs } : {}),
    ...(Object.keys(moves).length > 0 ? { moves } : {}),
    ...(Object.keys(downs).length > 0 ? { downs } : {}),
    ...(Object.keys(elims).length > 0 ? { elims } : {}),
    beats: finalBeats,
    // 자막에 싣는 것들 — 앞에서부터 shown 개수만큼이다(위 captionBeats 주석).
    pick: shown.map((_, i) => i),
  };
}

/** 이긴 쪽이 이만큼 이하로 작았으면 '잘 싸웠다'로 본다(요청) — 규모(powerAt)로 잰다.
 *  0.75면 사분의 삼, 즉 넷에 하나쯤 모자란 병력으로 이긴 싸움부터다. 이보다 느슨하게
 *  잡으면 엇비슷한 싸움까지 다 잘 싸운 것이 되어 그 말이 값을 잃는다. */
const WELL_FOUGHT_ODDS = 0.75;

/** 큰 교전 문장의 무게 — 그 판의 절정이라 무겁게 잡되, 러시·돌파처럼 '누가 무엇을 했다'가
 *  분명한 이야기보다는 한 단계 아래다. */
const CLASH_WEIGHT = 14;

/* 마지막 싸움이 '이긴 편의 집'이었나를 가르는 값과, 그 뒤 역공으로 볼 어택 지정 수
   (위 homeStand 주석에 실측이 있다). 집 마당은 가장 가까운 두 시작 지점 거리의 40%로
   잡는다 — 화살표 쪽에서 쓰는 잣대(GameResultStory의 YARD)와 같은 생각이다. */
const HOME_STAND_YARD = 0.4;
const HOME_STAND_MIN_TILES = 10;
/* 마당 밖이어도 '그 집 자리'로 보는 잣대 — 가장 가까운 집이 그다음 집보다 이만큼 이상
   가까우면 그 집 쪽에서 벌어진 싸움이다. 절반이면 충분히 뚜렷하고, 센터 싸움은 어느
   집과도 거리가 비슷해 절대 걸리지 않는다. */
const HOME_STAND_CLEAR = 0.5;
/* 역공은 짧다 — 실측(제 집에서 막아 낸 19판): 막아 낸 뒤 경기가 끝나기까지 중앙 0.7분
   뿐이고, 그 사이 상대 진영에 찍은 어택 지정이 중앙 8건이다. 막아 내자마자 넘어가 끝낸
   그림이라, 문턱을 크게 잡으면 그 장면이 통째로 사라진다. */
const COUNTER_MIN_ORDERS = 5;
const COUNTER_MIN_EACH = 3;

/** 스캔을 '정찰했다'고 말할 최소 횟수와, 그 좌표가 누구 집인지 볼 반경(타일).
 *  위 vision 주석에 실측이 있다. */
/** 스캔 자리를 한 곳으로 묶는 반경(타일)과, 한 문장에 그릴 자리 수의 상한.
 *  맵이 128×128이라 16타일은 '같은 진영 안'쯤이고, 다섯이면 지도가 안 덮인다. */
const SCAN_SPOT_TILES = 16;
const SCAN_SPOT_MAX = 5;
const SCAN_SCOUT_MIN = 8;
/** 그중 '자리를 보장할 만큼' 판을 훑어본 선 — 실측 테란 225명의 상위 10%가 열두 번이다. */
const SCAN_RESERVE_MIN = 12;
const SCAN_BASE_TILES = 18;
/** 일꾼 정찰로 칠 창(초) — 첫 일꾼을 보내 보고 오는 시간이다. 그보다 뒤의 일꾼 이동은
 *  확장을 펴러 가거나 건물을 지으러 가는 길이라 정찰이라 부를 수 없다. */
const WORKER_SCOUT_SEC = 300;

/* 규모(미니맵 기세 눈금)를 셀 때 쓰는 몫. 병력 한 기를 1로 두고, 건물은 그 한 채가
   대신하는 병력만큼 얹는다 — 방어탑은 병력 둘 몫(replayTactics의 GREEDY_DEF_WORTH와 같은
   생각), 생산건물도 둘 몫(그 자리에서 병력이 계속 나온다), 본진은 셋 몫(그 위에 나머지가
   선다). 첫 본진은 지은 것이 아니라 처음부터 서 있어 buildingFrames에 없으므로 하나를 더한다. */
/* 병력을 셀 창(초) — 이 창 안에 나온 것만 '그 무렵 손에 있던 것'으로 본다.
   replayTactics의 CONCURRENT_WINDOW_SEC(150)과 같은 값이다: 거기서 캐리어·배틀크루저를
   '한때 몇 기나 함께 띄웠나'로 셀 때 쓴 창이고, 여기서 묻는 것도 같은 물음이라 잣대가
   둘로 갈릴 이유가 없다. 가장 오래 걸리는 유닛의 생산시간(약 2분)보다 살짝 넉넉해,
   한 창 안에서 뽑은 것은 대체로 아직 함께 살아 있다.
   (건물은 이 창을 안 쓴다 — 아래 주석 참고.) */
const POWER_WINDOW_SEC = 150;
const POWER_DEF_WORTH = 2;
const POWER_PROD_WORTH = 2;
const POWER_BASE_WORTH = 3;
const POWER_DEF = [
  "Creep Colony", "Sunken Colony", "Spore Colony", "Photon Cannon", "Bunker", "Missile Turret",
] as const;
const POWER_PROD = [
  "Gateway", "Robotics Facility", "Stargate", "Barracks", "Factory", "Starport",
] as const;
const POWER_BASE = ["Nexus", "Command Center", "Hatchery"] as const;
/** 병력으로 세지 않는 것 — 일꾼·수송·정찰, 그리고 알 단계. */
const POWER_PEACE = new Set([
  "SCV", "Probe", "Drone", "Larva", "Egg", "Overlord", "Cocoon", "Mutalisk Cocoon", "Lurker Egg",
  "Observer", "Shuttle", "Dropship", "Overlord (Transport)", "Medic", "Scanner Sweep",
]);

/** 화살표 굵기를 재는 창(초) — 그 직전 얼마 동안 뽑은 병력을 '그 무렵의 규모'로 볼 것인가.
 *  급습이 "무엇으로 갔나"를 재는 창(replayTactics의 WENT_WITH_SEC)과 같은 값이라야 자막의
 *  "질럿 13기"와 화살표 굵기가 같은 것을 말한다. */
const ARROW_SIZE_SEC = 120;

/** 화살표 기둥 이름표에 실을 최대 가짓수 — 지도 위 글이라 길면 그림을 가린다. */
const ARROW_LABEL_MAX = 2;

/** 그 자리를 사람이 부르는 말로 — 누군가의 본진 언저리면 그 사람의 기지, 맵 한가운데면
 *  센터. 어느 쪽도 아니면 자리를 말하지 않는다(틀린 이름을 붙이느니 생략한다). */
function clashPlace(xy: [number, number], bases: Record<string, [number, number]>): string | null {
  const spots = Object.entries(bases);
  const near = spots
    .map(([raw, b]) => ({ raw, d: Math.hypot(xy[0] - b[0], xy[1] - b[1]) }))
    .sort((a, b) => a.d - b.d)[0];
  if (near && near.d <= CLASH_AT_BASE) return near.raw;
  // 아래에서 ""(센터)를 돌려주므로, 부르는 쪽은 null(모름)과 ""(센터)를 갈라 봐야 한다.
  if (spots.length >= 2) {
    const xs = spots.map(([, b]) => b[0]);
    const ys = spots.map(([, b]) => b[1]);
    const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    const ring = spots.reduce((n, [, b]) => n + Math.hypot(b[0] - mid.x, b[1] - mid.y), 0) / spots.length;
    if (ring > 0 && Math.hypot(xy[0] - mid.x, xy[1] - mid.y) < ring * CLASH_AT_MID) return "";
  }
  return null;
}
/** 본진에서 이만큼 안이면 '그 사람 기지에서'라고 부른다(타일). */
const CLASH_AT_BASE = 18;
/** 시작 지점들의 한가운데에서 이 비율 안이면 센터로 본다. */
const CLASH_AT_MID = 0.3;

/* ── 병력이 앞선 채로 흘려보낸 시간(요청: 누가/어느 팀이 병력이 더 많았는데 공격하지
   않고 타이밍을 놓친 부분 — 상대가 그 사이에 확장을 더 했다면 더 좋은 스토리) ──

   리플레이에는 '지금 병력이 몇인가'가 안 남는다(전투도 죽음도 안 남는다). 대신 남는 건
   그때까지 뽑은 총량이고, 그건 '한 번도 안 싸운 구간'에서는 실제 병력과 거의 같다 —
   이 문장이 겨냥하는 구간이 정확히 그런 구간이라 이 어림이 성립한다. 그래서 판정은 늘
   같은 순서다: ① 한쪽이 훨씬 많이 뽑았나 → ② 그러고도 상대 집에 안 갔나 → ③ 그 사이
   상대는 무엇을 했나. */
/** 이 시각 이전은 아직 '병력'이라 부를 게 없다(초). */
const IDLE_FROM_SEC = 240;
/** 끝나기 이만큼 전부터는 이미 결판이 난 뒤다(초). */
const IDLE_TAIL_SEC = 120;
/** 이만큼을 그냥 흘려보내야 '타이밍을 놓쳤다'고 한다(초). */
const IDLE_WINDOW_SEC = 150;
/** 상대의 이 배는 넘어야 '훨씬 많다'. */
const IDLE_RATIO = 1.6;
/** 그리고 인구수 차이가 이만큼은 나야 한다 — 초반의 4:2를 두 배라고 말하지 않기 위한 것. */
const IDLE_GAP_MIN = 24;
/** 그 창 동안 상대 집 근처에 이보다 많이 찍었으면 들어간 것이다(정찰은 몇 번으로 끝난다). */
const IDLE_PUSH_MAX = 8;
/** 상대 집이라 부르는 반경(가장 가까운 상대까지 거리 대비) — pushersOn과 같은 자. */
const IDLE_HOME_RADIUS = 0.3;
/** 앞서고도 흘려보낸 이야기의 무게 — '무엇을 했다'가 아니라 '안 했다'라 러시·교전보다
 *  가볍지만, 그 판의 흐름을 설명하는 대목이라 생산담보다는 무겁다. */
const IDLE_LEAD_WEIGHT = 17;

/** 그 편이 프레임 f까지 뽑은 병력 인구수 — 일꾼·보급·건물은 빼고 전투 유닛만. */
function armyCurve(players: ParsedReplayPlayer[]): { at: number; w: number }[] {
  const made: { at: number; w: number }[] = [];
  for (const p of players) {
    for (const [unit, fs] of Object.entries(p.signals?.unitFrames ?? {})) {
      if (NON_COMBAT_UNITS.has(unit) || WORKER_UNITS.has(unit)) continue;
      for (const f of fs) made.push({ at: f, w: supplyOf(unit) });
    }
  }
  return made.sort((a, b) => a.at - b.at);
}
const armyAt = (curve: { at: number; w: number }[], f: number): number =>
  curve.reduce((n, m) => (m.at <= f ? n + m.w : n), 0);

/** 그 편이 창 동안 상대 집 근처에 찍은 이동·공격 명령 수 — '들어갔나'의 근거다. */
function ordersIntoFoes(
  movers: ParsedReplayPlayer[],
  foes: ParsedReplayPlayer[],
  from: number,
  to: number,
): number {
  const homes = foes
    .filter((f) => f.startX !== null && f.startY !== null)
    .map((f) => ({ x: f.startX as number, y: f.startY as number }));
  const mine = movers
    .filter((m) => m.startX !== null && m.startY !== null)
    .map((m) => ({ x: m.startX as number, y: m.startY as number }));
  if (homes.length === 0 || mine.length === 0) return 0;
  let base = Infinity;
  for (const h of homes) for (const m of mine) base = Math.min(base, Math.hypot(h.x - m.x, h.y - m.y));
  if (!(base > 0) || !Number.isFinite(base)) return 0;
  const r = base * IDLE_HOME_RADIUS;
  let n = 0;
  for (const p of movers) {
    for (const o of p.signals?.orderPositions ?? []) {
      if (o.frame < from || o.frame > to) continue;
      if (homes.some((h) => Math.hypot(o.x - h.x, o.y - h.y) <= r)) n += 1;
    }
  }
  return n;
}

/** 그 편이 창 동안 새로 앉힌 확장(본진 건물) 수. */
function expansionsIn(players: ParsedReplayPlayer[], from: number, to: number): number {
  return builtIn(players, from, to, EXPANSION_BUILDINGS);
}

/** 그 창 안에 그 편이 올린 테크 건물 수 — "그 사이 테크를 탔다"의 근거다(요청). */
function techIn(players: ParsedReplayPlayer[], from: number, to: number): number {
  return builtIn(players, from, to, TECH_BUILDINGS);
}

/** 그 창 안에 그 편이 지은 건물 수 — 어떤 건물을 셀지는 부르는 쪽이 정한다. */
function builtIn(
  players: ParsedReplayPlayer[], from: number, to: number, kinds: Set<string>,
): number {
  let n = 0;
  for (const p of players) {
    for (const [b, fs] of Object.entries(p.signals?.buildingFrames ?? {})) {
      if (!kinds.has(b)) continue;
      n += fs.filter((f) => f >= from && f <= to).length;
    }
  }
  return n;
}

/** 병력이 앞선 채로 그냥 흘려보낸 대목 — 없으면 null.
 *
 *  조건을 처음 채운 자리를 고른다. 한때 '차이가 가장 벌어진' 자리를 골랐는데, 그 차이는
 *  그때까지 뽑은 총량의 차라 시간이 갈수록 저절로 커진다 — 그러니 늘 경기 막판이 뽑혔고,
 *  정작 놓친 때는 한참 전이었다(지적: 그 경기가 타이밍을 놓친 건 후반이 아니라 초반이다).
 *  이야기가 되는 자리는 '가장 벌어진 때'가 아니라 '앞서기 시작했는데 안 간 그때'다. */
function idleLead(
  a: ParsedReplayPlayer[],
  b: ParsedReplayPlayer[],
  totalFrames: number | null,
): {
  lead: ParsedReplayPlayer[]; behind: ParsedReplayPlayer[];
  at: number; gap: number; ratio: number; exp: number; tech: number;
} | null {
  if (totalFrames === null || totalFrames <= 0) return null;
  const curves = [armyCurve(a), armyCurve(b)];
  if (curves[0].length === 0 || curves[1].length === 0) return null;
  const win = IDLE_WINDOW_SEC / SECONDS_PER_FRAME;
  const from = IDLE_FROM_SEC / SECONDS_PER_FRAME;
  const to = totalFrames - IDLE_TAIL_SEC / SECONDS_PER_FRAME - win;
  if (to <= from) return null;
  const step = 30 / SECONDS_PER_FRAME;
  for (let f = from; f <= to; f += step) {
    const na = armyAt(curves[0], f);
    const nb = armyAt(curves[1], f);
    const leadIsA = na > nb;
    const [hi, lo] = leadIsA ? [na, nb] : [nb, na];
    const gap = hi - lo;
    if (gap < IDLE_GAP_MIN || lo <= 0 || hi < lo * IDLE_RATIO) continue;
    const lead = leadIsA ? a : b;
    const behind = leadIsA ? b : a;
    if (ordersIntoFoes(lead, behind, f, f + win) > IDLE_PUSH_MAX) continue;
    return {
      lead, behind, at: Math.round(f), gap: Math.round(gap),
      ratio: hi / lo,
      exp: expansionsIn(behind, f, f + win), tech: techIn(behind, f, f + win),
    };
  }
  return null;
}

/** 이사 문장의 무게 — 본진을 버리고 다시 편 것은 승부를 가르는 사건이라 무겁게 잡는다.
 *  다만 러시·돌파 같은 '그 경기만의 수'보다는 한 단계 아래다. */
const RELOCATE_WEIGHT = 18;

/** 본진 살림의 무게중심을 잴 때, 시작 지점에서 이만큼(타일) 안에 있는 건물만 센다.
 *  스타의 본진 한 곳은 대략 이 정도 폭이고, 앞마당까지는 들어오되 삼룡이·센터는 빠진다 —
 *  멀리 나간 건물까지 세면 무게중심이 지도 한가운데로 끌려간다. */
const HUB_RADIUS = 22;
/** 그 안에 이만큼은 있어야 '살림'이라 부른다 — 한두 채로는 무게중심이 튄다. */
const HUB_MIN_BUILDINGS = 4;

/** 상대를 짚지 못한 고급 유닛 생산담에서 덜어 내는 무게 — 이만큼 빼면 러시·돌파·이사
 *  같은 '실제로 부딪친 이야기'가 먼저 자리를 잡는다. */
/** 아무것도 못 짚은 생산담을 깎는 폭(위 PROD_ONLY_KEYS) — 5에서 올렸다(요청: 무의미한
 *  유닛생산 내용은 중요도 낮추기). 5로는 러시·돌파와 겨루기에서 여전히 이겨서, 요약 한
 *  편에 "○○를 계속 뽑았다"가 나란히 둘씩 들어갔다. */
const PROD_ONLY_PENALTY = 9;

/** 무너진 뒤라도 이만큼(프레임 ≒ 1분)까지는 그 무렵의 이야기로 본다 — 무너지는 순간에
 *  걸쳐 있던 일을 통째로 잘라 내면 왜 무너졌는지가 사라진다. */
const DOWN_GRACE_FRAMES = 60 / 0.042;

/** 망했다고 말하려면 그 상태로 이만큼(프레임 ≒ 3분)은 더 끌려가야 한다 — 끝나기 직전의
 *  생산 중단은 경기가 끝나서 멈춘 것이다. */
const DOWN_MIN_TAIL_FRAMES = 180 / 0.042;

/** 이사 판정 — 맵의 시작 지점(스타팅 포인트)으로 본진 구역을 나눠서 본다(요청).
 *
 *  거리만으로 보던 판정은 두 가지를 자꾸 틀렸다(지적):
 *   ① 초반에는 본진 자원 옆에 짓지만 후반에는 같은 기지의 외곽에 짓는다 — 그걸 이사로 봤다.
 *   ② 8인용 맵은 시작 자리가 구석·외곽에 촘촘히 박혀 있어, 옆자리로 조금 나간 것도 딴
 *      동네로 읽혔다. 게다가 상대 진영에 지은 것까지 '거기로 이사했다'가 됐다.
 *  그래서 건물마다 '가장 가까운 시작 지점'을 붙여 그 자리로 묶는다 — 한 구역 안에서 어디에
 *  짓든 같은 집이고, 구역이 바뀌어야 이사다. 상대 자리로 간 것은 이사가 아니다(점령이다).
 */
/** 건물을 시작 지점에 붙일 때, 그 자리에서 이 배수(가장 가까운 두 시작 지점 사이 거리 대비)
 *  안에 있어야 그 구역으로 본다 — 맵 가운데에 지은 것을 남의 본진으로 세지 않기 위한 것이다. */
const SPOT_OWN_RATIO = 0.62;
/** 이 안에 있는 두 시작 지점은 같은 자리로 본다(타일) — 맵 데이터에 같은 지점이 두 번
 *  실려 있는 경우가 있어, 그걸 '바로 옆의 남의 자리'로 세면 안 된다. */
const SPOT_SAME_MAX = 2;
/** 새 자리에 이만큼은 지어야 살림을 옮긴 것으로 본다. */
const MOVE_MIN_NEW = 4;
/** 옮긴 뒤 옛 구역에 남는 것은 이 정도까지 — 그보다 많으면 아직 거기 산다. */
const MOVE_BACK_MAX = 1;
/* '돌아갔다'를 셀 때 빼는 건물 — 옛 자리에 이것들만 다시 올린 것은 거기서 다시 사는 게
   아니다(지적: 3시에서 몰래 살다가 걸려 죽고 12시로 옮겼는데 그 이야기가 없다).
   실측한 그 판에서 타센이 12시로 옮긴 뒤 옛 자리(3시)에 올린 것은 가스 셋·크립 하나·
   해처리 하나였다 — 그 다섯을 그대로 세니 '거의 안 돌아갔다'(최대 1)에 걸려 이사 자체가
   통째로 사라졌다. 가스는 남은 간헐천을 뒤늦게 빨아먹는 것이고 크립 콜로니는 그 자체로는
   아무것도 아닌 주춧돌이라, 둘 다 '거기 산다'는 증거가 못 된다. 살림을 말하는 건물
   (해처리·병영·테크 건물)만 센다 — 그것도 하나까지는 봐준다(MOVE_BACK_MAX). */
const MOVE_BACK_SKIP = new Set(["Extractor", "Assimilator", "Refinery", "Creep Colony"]);
/** 한 사람이 이사한 것으로 볼 수 있는 최대 횟수. */
const MOVE_MAX = 3;
/** 이사로 보려면 그 전에 본진 생산이 꺾인 적이 있어야 한다(지적: 자리만으로는 크게
 *  번성한 자기 기지의 한쪽 끝을 남의 동네로 잘못 재는 경우와, 아직 멀쩡한 본진을 두고
 *  그냥 멀티를 늘린 경우를 못 가른다 — 이사는 보통 본진이 크게 두들겨 맞아서 가는 것이므로
 *  새 자리가 옛 본진보다 클 수는 없다. 그래서 크기가 아니라 '본진이 실제로 얻어맞았나'를
 *  본다). 자원채집은 좌표가 안 남아 직접 잴 수 없으니(명령에 위치가 없다) 좌표 없이도
 *  잴 수 있는 생산 급감(productionDips, 건물+유닛 생산량 기준)으로 근사한다 — 이사 직전
 *  이 창 안에 그런 급감이 없으면, 자리는 바뀌었어도 실제로는 아직 잘 사는 멀티일 뿐이다. */
const RELOCATE_HIT_WINDOW_MIN = 10;
/** 이사는 '누가 쫓아냈나'까지 자리로 확인될 때만 말한다(지적: 이사하기 전에 그 사람이
 *  타격을 입은 내용이 아예 없었다).
 *
 *  생산 급감만으로는 모자랐다 — 실측한 4:4에서 타센이 10분에 '이사'로 잡혔는데, 그때까지
 *  타센 본진 반경에 병력을 몰고 온 상대가 아무도 없었다(가장 가까이 온 명령이 33타일
 *  밖). 빠른무한 같은 판에서는 다들 맵 곳곳에 짓기 때문에 자리가 바뀌는 일도, 생산이
 *  출렁이는 일도 흔하다. 그러니 상대가 실제로 그 집까지 밀고 들어온 기록(pushersOn)을
 *  함께 요구한다 — 그 이름을 알면 문장에서 "누구에게 내주고 옮겼는지"까지 말할 수 있다.
 *
 *  명령 좌표를 못 읽는 판(screp이 Pos를 안 주는 리플레이)에서는 이 검사가 늘 실패하므로
 *  그때는 예전처럼 생산 급감만 본다. */
/** 경기가 이만큼(분)도 안 남았을 때 바뀐 자리는 이사가 아니라 마지막 확장이다(지적:
 *  이긴 사람이 29분에 '터를 옮겼다'고 나왔는데, 31분 경기의 끝자락에 상대가 버리고 간
 *  자리에 몇 채 지은 것뿐이었다). '새 자리에서 판을 다시 폈다'고 말하려면 그 자리에서
 *  살아 볼 시간이 있어야 한다 — 위 DOWN_MIN_TAIL_FRAMES와 같은 생각이다. */
const MOVE_MIN_TAIL_MIN = 3;

/** 시작 지점마다 '이 구역'이라 부를 반경 — 가장 가까운 다른 시작 지점까지의 거리에서 잡는다.
 *  맵마다 자리 수와 간격이 달라서(2인용 투혼 vs 8인용 빠른무한) 고정값은 늘 한쪽에서 틀린다. */
function spotRadii(spots: [number, number][]): number[] {
  return spots.map(([x, y], i) => {
    let near = Infinity;
    spots.forEach(([ox, oy], j) => {
      if (i === j) return;
      const d = Math.hypot(x - ox, y - oy);
      // 같은 자리가 두 번 실린 맵이 있다(실측: 8인용 한 맵의 StartLocations에 6시가 두 번).
      // 그대로 재면 '가장 가까운 다른 자리'가 0이 되어 반경이 0이 되고, 그 구역은 자기
      // 시작점 말고는 아무 건물도 못 담는다 — 그 근처에 새 살림을 편 사람이 통째로
      // '구역 없음'이 되어 이사가 영영 안 잡혔다(지적). 겹친 자리는 남으로 안 센다.
      if (d < SPOT_SAME_MAX) return;
      near = Math.min(near, d);
    });
    return Number.isFinite(near) ? near * SPOT_OWN_RATIO : Infinity;
  });
}

/** 그 자리가 속한 시작 지점 번호 — 어느 구역에도 안 들면 -1(가운데·빈 땅). */
function spotAt(
  b: { x: number; y: number },
  spots: [number, number][],
  radii: number[],
): number {
  let best = -1;
  let bd = Infinity;
  spots.forEach(([x, y], i) => {
    const d = Math.hypot(b.x - x, b.y - y);
    if (d < bd && d <= radii[i]) { bd = d; best = i; }
  });
  return best;
}

/** 살림을 옮긴 자리들 — 시간순. 지금 사는 구역이 아닌 다른 시작 지점 구역에 넷 이상 짓고,
 *  그 뒤로 옛 구역에는 거의 돌아가지 않았으면 그때 옮긴 것이다. 한 번 찾으면 그 구역을 새
 *  집으로 삼아 같은 일을 다시 본다 — 이사는 여러 번 할 수 있다(요청).
 *
 *  상대가 살고 있는 자리로 간 것은 이사가 아니다(지적: 적군에 이사했다고 한다) — 그건 남의
 *  집에 들어간 것이다. 다만 '살고 있는지'는 그 순간을 봐야 한다(요청: 이사 간 자리에 누가
 *  들어왔을 때 그 땅의 주인을 정확히 파악해야 한다) — 상대가 이미 버리고 떠난 빈 자리에
 *  들어가는 것은 이사가 맞다. 그래서 자리 번호가 아니라 '그때 그 자리가 남의 집인가'를
 *  묻는 함수를 받는다. 아군 자리도 마찬가지로 남의 집이다(지적) — 실측한 4:4에서 타센이
 *  팀 동료 수달이의 시작 자리 언저리에 지은 것을 '본진을 포기하고 옮겼다'로 읽었다.
 *
 *  누가 쫓아냈는지(drivenBy)는 위 RELOCATE_HIT_WINDOW_MIN 옆 주석을 보라. */
function relocations(
  p: ParsedReplayPlayer,
  spots: [number, number][],
  taken: (spot: number, frame: number) => boolean,
  totalFrames: number | null,
  drivenBy?: (frame: number) => string | null,
): { spot: number; at: number; by?: string }[] {
  // 시작 지점을 못 읽은 리플레이는 판정하지 않는다 — 거리로 어림잡으면 위의 오판이 되돌아온다.
  if (spots.length < 2) return [];
  const radii = spotRadii(spots);
  const pts = (p.signals?.buildPositions ?? [])
    .filter((b): b is typeof b & { frame: number } => b.frame !== null)
    .sort((a, b) => a.frame - b.frame);
  if (pts.length < MOVE_MIN_NEW + 3) return [];
  // 본진이 실제로 얻어맞은 적이 있어야 이사다(위 RELOCATE_HIT_WINDOW_MIN 주석).
  const dips = productionDips(p, totalFrames);
  const hitWindow = (RELOCATE_HIT_WINDOW_MIN * 60) / SECONDS_PER_FRAME;
  const wasHitBefore = (frame: number): boolean => dips.some((d) => d <= frame && frame - d <= hitWindow);
  const zone = pts.map((b) => spotAt(b, spots, radii));
  let home = p.startX !== null && p.startY !== null
    ? spotAt({ x: p.startX, y: p.startY }, spots, radii)
    : -1;
  if (home < 0) {
    // 시작 자리를 모르면 처음 지은 건물들이 가장 많이 든 구역을 집으로 본다.
    const tally = new Map<number, number>();
    zone.slice(0, 5).forEach((z) => { if (z >= 0) tally.set(z, (tally.get(z) ?? 0) + 1); });
    home = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
  }
  if (home < 0) return [];

  // 끝나기 직전에 바뀐 자리는 이사가 아니라 마지막 확장이다(위 MOVE_MIN_TAIL_MIN 주석).
  const tail = (MOVE_MIN_TAIL_MIN * 60) / SECONDS_PER_FRAME;
  const lastMoveFrame = totalFrames === null ? Infinity : totalFrames - tail;

  const out: { spot: number; at: number; by?: string }[] = [];
  let from = 0;
  while (out.length < MOVE_MAX) {
    let hit: { i: number; z: number; by?: string } | null = null;
    for (let i = from; i < pts.length; i += 1) {
      const z = zone[i];
      if (z < 0 || z === home || taken(z, pts[i].frame)) continue;
      if (pts[i].frame > lastMoveFrame) continue;
      /* 이 자리 뒤로 새 구역에 몇 채나 짓나 / 옛 구역으로 몇 번이나 돌아가나.
         돌아간 쪽만 부속물을 빼고 센다(위 MOVE_BACK_SKIP) — 새 구역 쪽은 무엇을 짓든
         '거기서 시작했다'는 증거라 그대로 센다. */
      let newN = 0;
      let backN = 0;
      for (let j = i; j < pts.length; j += 1) {
        if (zone[j] === z) newN += 1;
        else if (zone[j] === home && !MOVE_BACK_SKIP.has(pts[j].unit)) backN += 1;
      }
      if (newN < MOVE_MIN_NEW) continue;
      if (backN > MOVE_BACK_MAX) continue;
      // 본진이 그 무렵 실제로 얻어맞았어야 이사다(위 RELOCATE_HIT_WINDOW_MIN 주석) — 아니면
      // 자리는 바뀌었어도 아직 멀쩡한 본진을 두고 그냥 멀티를 늘린 것일 수 있다.
      if (!wasHitBefore(pts[i].frame)) continue;
      // 그리고 실제로 누가 그 집까지 밀고 들어왔어야 한다 — 아무도 안 왔으면 스스로
      // 옮긴 것이라 '본진을 포기했다'는 이야기가 아니다.
      const by = drivenBy?.(pts[i].frame) ?? null;
      if (drivenBy && !by) continue;
      hit = { i, z, ...(by ? { by } : {}) };
      break;
    }
    if (!hit) break;
    out.push({ spot: hit.z, at: pts[hit.i].frame, ...(hit.by ? { by: hit.by } : {}) });
    home = hit.z;
    from = hit.i + 1;
  }
  return out;
}

/** 큰 교전을 찾는 데 쓰는 값들 — 마법과 공격 명령이 '한때 한곳에' 몰린 정도로 잰다.
 *  마법(스톰·다크스웜·플레이그·이레디에이트 …)은 병력이 실제로 엉켰다는 가장 확실한
 *  증거다. 아무 데나 뿌리는 마법은 없다. */
const CLASH_WINDOW_FRAMES = 60 / 0.042;
/** 같은 싸움으로 볼 반경(타일). */
const CLASH_RADIUS = 14;
/** 이만큼은 몰려야 '큰 교전'이다 — 양쪽 것을 합쳐 센다. */
const CLASH_MIN = 8;
// 그 싸움의 '참가자'로 셀 최소 명령 수 — 한두 번 스친 것은 옆을 지나간 것이지 싸운 게 아니다.
const CLASH_PART_MIN = 3;
/** 문장이 이름을 부를 만큼 '상당 부분' 참여했나 — 그 싸움 전체 명령의 이 비율은 돼야 한다
 *  (요청: 상당 부분 참여한 플레이어를 다 나열). 고정 수(CLASH_PART_MIN)만 쓰면 명령이
 *  백 건 넘게 몰린 대난전에서 두세 번 스친 사람까지 주인공으로 불린다.
 *
 *  5% → 10%(지적: 후반 전투가 너무 묶여 문장이 길어졌다). 후반 문장이 길어진 자리를 172판
 *  전체에서 찾아보니 범인은 시간 창이 아니라 이 문턱이었다 — 가장 긴 문장들은 하나같이
 *  큰 교전 하나였고, 한 문장이 양쪽 합쳐 대여섯 이름을 불렀다(4:4 팀전). 그 싸움의 명령이
 *  중앙 98건이라 5%는 다섯 번만 찍어도 주인공이 된다는 뜻이고, 그건 '상당 부분'이 아니라
 *  '옆을 지나갔다'에 가깝다.
 *
 *  실측(교전을 찾은 169판, 불리는 이름 수 중앙/75%/최대):
 *      5% → 5/5/8 · 8% → 4/5/7 · 10% → 3/4/6 · 15% → 2/3/5
 *  10%면 이름이 중앙 셋으로 줄고 한쪽이 통째로 비는 판은 20판인데, 그 판들은 예전처럼
 *  양쪽 대표 한 사람씩(clash.who)을 부르므로 문장이 비지 않는다. 15%부터는 그 판이
 *  38판으로 늘어 '누가 싸웠나'를 잃는 쪽이 커진다.
 *
 *  창을 좁히는 쪽은 답이 아니었다 — 60초·14타일을 20초·10타일까지 줄여 봐도 불리는 이름은
 *  중앙 5에서 4로 줄었을 뿐이다(교전을 찾은 판은 169 → 168). 큰 싸움에는 실제로 여럿이
 *  달려들기 때문이다. */
const CLASH_NAME_SHARE = 0.1;
/* ── 그 싸움을 누가 이겼나(요청: 전투의 승패나 비긴 것도 묘사) ──
   리플레이에는 "누가 몇 기를 잡았다"가 없다. 확실히 아는 것은 '싸움이 끝난 뒤 그 자리에
   누가 남아 계속 명령을 내렸나'다 — 밀린 쪽은 그 땅에서 물러나므로 명령이 끊긴다. 딱
   그만큼만 말한다: 자리를 지킨 쪽을 이겼다고 부르고, 양쪽 다 물러났거나 비슷하게 남아
   있으면 비긴 것으로 둔다. */
const CLASH_AFTER_SEC = 120;
/** 이긴 것으로 부르려면 남은 명령이 상대의 이 배는 돼야 한다. */
const CLASH_HOLD_RATIO = 2;
/** 그래도 이만큼은 남아 있어야 '지켰다'고 말한다 — 둘 다 물러난 자리에서 한둘 차이로
 *  승패를 가르면 그건 근거가 아니라 잡음이다. */
const CLASH_HOLD_MIN = 6;
/** 교전으로 세는 마법 — 병력끼리 엉켰을 때만 쓰는 것들이다(replayTactics의 FIGHT_TECHS).
 *  '이 자리에서 누구와 싸우고 있었나'를 묻는 쪽과 같은 목록을 써야 두 판정이 어긋나지
 *  않는다. */
const CLASH_TECHS = FIGHT_TECHS;

type ClashHit = { frame: number; x: number; y: number; side: 0 | 1; raw: string };

interface Clash {
  at: number;
  /** 그 싸움에 찍힌 마지막 명령의 프레임 — at부터 여기까지가 '그 싸움이 벌어진 동안'이다.
   *  거기서 터진 마법만 그 싸움 이야기에 얹는다(clashTech 주석). */
  end: number;
  xy: [number, number];
  n: number;
  who: string[];
  people: number;
  parts: string[];
  /** 참가자와 그 사람이 그 자리에 찍은 명령 수 — 많이 싸운 순. 문장이 이름을 부를 사람을
   *  고르는 데 쓴다(위 CLASH_NAME_SHARE). */
  ranked: [string, number][];
  /** 싸움이 끝난 뒤 그 자리를 지킨 쪽 — "a"는 who[0] 쪽(경기를 이긴 편), "b"는 who[1] 쪽,
   *  "draw"는 양쪽 다 물러났거나 비슷하게 남은 경우(위 CLASH_AFTER_SEC 주석). */
  hold: "a" | "b" | "draw";
}

/** 교전의 근거가 되는 점들 — 시간순.
 *
 *  두 가지다: 좌표가 그대로 적히는 마법(castPositions)과, 주인이 병력으로 확인된 공격
 *  명령(orderPositions의 kind/by). 둘을 한 통에 담는다. */
function clashHits(a: ParsedReplayPlayer[], b: ParsedReplayPlayer[]): ClashHit[] {
  const hits: ClashHit[] = [];
  const add = (ps: ParsedReplayPlayer[], side: 0 | 1) => {
    for (const p of ps) {
      const sg = p.signals;
      if (!sg) continue;
      for (const c of sg.castPositions ?? []) {
        if (CLASH_TECHS.has(c.tech)) hits.push({ frame: c.frame, x: c.x, y: c.y, side, raw: p.rawName });
      }
      for (const o of sg.orderPositions ?? []) {
        if (o.kind !== "attack" || o.by === "Worker" || o.by === "Building") continue;
        hits.push({ frame: o.frame, x: o.x, y: o.y, side, raw: p.rawName });
      }
    }
  };
  add(a, 0);
  add(b, 1);
  return hits.sort((x, y) => x.frame - y.frame);
}

/** '1분 안, 반경 14타일 안'에 가장 많이(또는 가장 늦게) 몰린 무리를 찾는다 — 그 첨자들.
 *  양쪽이 다 찍혀 있어야 교전이다: 한쪽만 있으면 일방적인 견제거나 그냥 진출이다.
 *  이미 다른 싸움으로 뽑아 간 점(used)은 없는 셈 치므로, 거듭 부르면 서로 다른 싸움이 나온다.
 *
 *  점이 시간순이라 창의 양끝(lo·hi)은 되돌아가지 않는다 — 모든 점을 매번 훑던 것을
 *  창 안쪽만 보게 바꿨다. 교전을 여러 번 찾으려면 이 훑기를 그만큼 되풀이해야 해서다. */
function bestCluster(hits: ClashHit[], used: Uint8Array, mode: "big" | "late"): number[] | null {
  let best: number[] | null = null;
  let bestAt = 0;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < hits.length; i += 1) {
    const h = hits[i];
    while (lo < hits.length && hits[lo].frame < h.frame - CLASH_WINDOW_FRAMES) lo += 1;
    while (hi < hits.length && hits[hi].frame <= h.frame + CLASH_WINDOW_FRAMES) hi += 1;
    if (used[i]) continue;
    const near: number[] = [];
    let hasA = false;
    let hasB = false;
    for (let j = lo; j < hi; j += 1) {
      if (used[j]) continue;
      const x = hits[j];
      const dx = x.x - h.x;
      const dy = x.y - h.y;
      if (dx * dx + dy * dy > CLASH_RADIUS * CLASH_RADIUS) continue;
      near.push(j);
      if (x.side === 0) hasA = true; else hasB = true;
    }
    if (near.length < CLASH_MIN || !hasA || !hasB) continue;
    // near는 첨자가 오름차순이라 near[0]이 그 무리에서 가장 이른 점이다.
    if (best && (mode === "big" ? near.length <= best.length : hits[near[0]].frame <= bestAt)) continue;
    best = near;
    bestAt = hits[near[0]].frame;
  }
  return best;
}

/** 뽑아낸 무리를 '누가 어떻게 싸웠나'까지 갖춘 교전으로 — hold는 뽑아 간 점까지 다 보고 센다. */
function clashOf(idx: number[], hits: ClashHit[]): Clash {
  const near = idx.map((i) => hits[i]);
  // 자리는 몰린 점들의 한가운데, 때는 그중 가장 이른 것 — 싸움이 시작된 시각이다.
  const cx = near.reduce((n, x) => n + x.x, 0) / near.length;
  const cy = near.reduce((n, x) => n + x.y, 0) / near.length;
  // 양쪽에서 가장 많이 찍은 사람 하나씩을 주인공으로 부른다.
  const top = (side: 0 | 1): string | null => {
    const tally = new Map<string, number>();
    near.filter((x) => x.side === side).forEach((x) => tally.set(x.raw, (tally.get(x.raw) ?? 0) + 1));
    return [...tally].sort((p, q) => q[1] - p[1])[0]?.[0] ?? null;
  };
  const who = [top(0), top(1)].filter((v): v is string => v !== null);
  /* 실제로 몇 사람이 얽혔나 — who는 양쪽에서 하나씩만 뽑은 대표라 늘 둘이어서, 이 수가
     없으면 둘이 붙은 싸움도 "양 팀 병력이 한데 엉켜"로 말하게 된다(지적). 자리에 찍힌
     사람 수를 세어 문장이 '둘의 싸움'과 '여럿이 얽힌 난전'을 갈라 쓰게 한다.
     한두 번 스친 사람은 빼고 센다 — 반경이 14타일·창이 60초라 옆에서 제 할 일 하던
     사람의 명령 한둘은 쉽게 딸려 들어오는데, 그걸 참가자로 세면 둘이 붙은 싸움이 곧바로
     '여럿'이 되어 이 구분이 무의미해진다(다른 곳의 POS_MIN_ORDERS와 같은 취지). */
  const tally = new Map<string, number>();
  for (const x of near) tally.set(x.raw, (tally.get(x.raw) ?? 0) + 1);
  const ranked = [...tally].sort((p, q) => q[1] - p[1]);
  const parts = ranked.filter(([, n]) => n >= CLASH_PART_MIN).map(([raw]) => raw);
  /* 싸움이 끝난 뒤 그 자리를 누가 지켰나(위 CLASH_AFTER_SEC 주석) — 교전 창이 끝난
     시점부터 2분 동안 같은 반경 안에 남은 명령을 편별로 센다. */
  const endAt = near[near.length - 1].frame;
  const after = hits.filter(
    (x) => x.frame > endAt && x.frame - endAt <= CLASH_AFTER_SEC / 0.042
      && Math.hypot(x.x - cx, x.y - cy) <= CLASH_RADIUS,
  );
  const heldA = after.filter((x) => x.side === 0).length;
  const heldB = after.filter((x) => x.side === 1).length;
  const hold = heldA >= CLASH_HOLD_MIN && heldA >= heldB * CLASH_HOLD_RATIO ? "a"
    : heldB >= CLASH_HOLD_MIN && heldB >= heldA * CLASH_HOLD_RATIO ? "b" : "draw";
  return {
    at: near[0].frame, end: endAt,
    xy: [round1(cx), round1(cy)], n: near.length, who, people: parts.length, parts, ranked, hold,
  };
}

/** 그 경기에서 따로 벌어진 큰 교전들 — 큰 순. 없으면 빈 배열.
 *
 *  한 번 뽑은 점은 빼고 다시 찾으므로 같은 싸움이 두 번 나오지 않는다(요청: 큰 교전이
 *  여러 번이면 여러 번 나오는 게 맞다). 예전에는 가장 큰 하나만 문장이 됐는데, 실측하면
 *  한 판에 따로 벌어진 교전이 여섯 번도 넘게 잡히고 1등과 2등 사이가 중앙 3.4분이라
 *  — 그 둘은 서로 다른 싸움인데 이야기에는 하나만 남았다. */
function findClashes(a: ParsedReplayPlayer[], b: ParsedReplayPlayer[], max: number): Clash[] {
  const hits = clashHits(a, b);
  if (hits.length < CLASH_MIN) return [];
  const used = new Uint8Array(hits.length);
  const out: Clash[] = [];
  for (let r = 0; r < max; r += 1) {
    const idx = bestCluster(hits, used, "big");
    if (!idx) break;
    for (const i of idx) used[i] = 1;
    out.push(clashOf(idx, hits));
  }
  return out;
}

/** 마지막으로 부딪친 자리 — 맺음말이 가리킬 곳은 가장 큰 싸움터가 아니라 여기다(요청:
 *  결론은 전투니까 화살표와 액션 이모지도 다른 스냅과 똑같이 — 경기를 끝낸 그 싸움터가
 *  그 문장의 자리다). 근거도 문턱도 위와 같고 고르는 자만 다르다. */
function lastClash(a: ParsedReplayPlayer[], b: ParsedReplayPlayer[]): Clash | null {
  const hits = clashHits(a, b);
  if (hits.length < CLASH_MIN) return null;
  const idx = bestCluster(hits, new Uint8Array(hits.length), "late");
  return idx ? clashOf(idx, hits) : null;
}

/** 미니맵 좌표는 소수 한 자리까지만 남긴다 — 128칸 맵에서 0.1타일은 3픽셀이라 그림에
 *  아무 차이가 없고, 저장되는 JSON만 길어진다. */
const round1 = (v: number): number => Math.round(v * 10) / 10;

// 그 순간 그 사람이 어디 있었나를 재는 창(초). 스타는 호흡이 빠르니 넉넉히 잡으면 다른
// 국면의 자리가 섞인다 — 앞뒤 30초까지만 본다.
const POS_WINDOW_SEC = 30;
// 이만큼은 찍혀 있어야 '거기 있었다'고 말한다. 한두 번은 정찰이거나 화면을 돌린 것일 수
// 있다(orderPositions 주석과 replayTactics의 pushersOn이 쓰는 것과 같은 기준).
const POS_MIN_ORDERS = 3;
// 같은 자리로 볼 반경(타일). 128칸 맵에서 10타일은 폭의 8%쯤 — 한 전장 안이다.
const POS_CLUSTER_RADIUS = 10;
// 자기 본진에서 이만큼 떨어졌으면 '집 밖'이다 — 본진과 앞마당을 넉넉히 벗어나는 거리다.
// 실측으로 갈렸다: 집 언저리 군집은 본진에서 3~7타일, 밖으로 나간 군집은 45~83타일이었다.
const POS_AWAY_MIN = 18;

/** 이 beat가 '들이친 일'인가 — 그렇다면 그 일을 한 사람은 집이 아니라 쳐들어간 자리에
 *  찍혀야 한다(요청: 공격 갔으면 공격 간 위치에 공격자가 표시되어야 함).
 *
 *  집 언저리 명령이 늘 훨씬 많다는 것이 문제였다(일꾼·건물·모으기 클릭). 그대로 가장
 *  붐비는 자리를 쓰면 러시를 간 사람도 자기 본진에 찍힌다 — 실측: 11드론 러시 beat에서
 *  창 안 명령 52개 중 33개가 집 언저리, 밖으로 나간 것은 7개였다.
 *
 *  전술 beat는 전술 키를 그대로 beat 키로 쓰므로(zling-rush·nydus·cloak-wraith …) 이미
 *  있는 두 목록을 그대로 쓰고, 전술이 아닌 '공격 이야기' 키만 따로 더한다. */
/** 공격 이야기인 beat 키 — 미니맵의 화살표도 이 목록으로 가른다(요청: 공격의 경우 본진에서
 *  공격위치까지 화살표). 병력을 모았다·물량을 뽑았다 같은 beat도 자리는 남지만, 거기까지
 *  화살을 그으면 아무 일 없던 곳으로 공격을 간 것처럼 읽힌다. */
export const ATTACK_BEAT_KEYS = new Set([
  ...RAID_KEYS, ...HARASS_KEYS,
  "raid-damage", "gang-rush", "duel-rush", "harass-workers", "harass-long", "breakthrough",
  // 막아 낸 뒤 상대 진영으로 넘어간 역공(요청) — 그 좌표로 화살표를 긋는다.
  "counter",
]);

/** 그 beat에 이름이 나오는 사람들이 그때 어디에 있었나 — 미니맵 스냅에 아바타를 놓는
 *  자리다(요청: 요약 전황 스냅에서는 해당 주인공들의 위치를 아바타만 표시).
 *
 *  근거는 이동·공격 명령의 좌표뿐이다. 리플레이에는 유닛이 실제로 어디 있었는지가 안 남아
 *  있고, 남는 건 '병력을 어디로 보냈나'다(orderPositions 주석). 그래서 이 자리는 '그
 *  사람이 있던 곳'이 아니라 '그 무렵 그 사람이 병력을 보낸 곳'이고, 명령이 몇 개 안 찍힌
 *  사람은 아예 뺀다 — 정찰 한 번을 그 사람의 자리라고 말할 수는 없다.
 *
 *  자리를 고르는 방법이 중요하다. 처음에는 x와 y의 가운뎃값을 따로 구했는데, 그러면 아무
 *  일도 없던 자리가 나온다(지적: 위치가 좀 안 맞는 것 같다) — 명령이 두 군데로 갈려 있으면
 *  가운뎃값은 그 사이 빈 곳에 떨어진다. 실측으로 확인했다: 한 사람의 11분 명령 25개가
 *  (75,107) 언저리에 22개나 몰려 있었는데 가운뎃값은 (108,93)이었다.
 *
 *  그래서 '가장 붐비는 자리'를 쓴다 — 반경 안 이웃이 가장 많은 점을 찾고 그 이웃들의
 *  무게중심을 낸다. 이러면 결과가 늘 실제로 명령이 몰린 곳이 된다. 같은 이웃 수라면 beat
 *  시점에 더 가까운 쪽을 고른다(그 순간에 더 충실하다). */
function beatPositions(
  b: ReplaySummaryBeat, byName: Map<string, ParsedReplayPlayer>,
): Record<string, [number, number]> | undefined {
  if (typeof b.at !== "number") return undefined;
  const at = b.at;
  const half = POS_WINDOW_SEC / SECONDS_PER_FRAME;
  const out: Record<string, [number, number]> = {};
  const actors = new Set([...(b.who ?? []), ...(b.who2 ?? [])]);
  const victims = b.whom ?? [];
  const attack = ATTACK_BEAT_KEYS.has(b.k) || victims.length > 0;
  const baseOf = (name: string): { x: number; y: number } | null => {
    const p = byName.get(name);
    return p && p.startX !== null && p.startY !== null ? { x: p.startX, y: p.startY } : null;
  };
  // 쳐들어간 자리를 아는 경우 — 당한 쪽 본진이 곧 그 자리다. 여럿이면 첫 사람 기준.
  const target = victims.map(baseOf).find((v) => v !== null) ?? null;

  for (const name of new Set([...actors, ...victims])) {
    const orders = byName.get(name)?.signals?.orderPositions;
    if (!orders) continue;
    // 일꾼이 자원 캐러 찍은 것, 건물이 랠리를 찍은 것은 '병력이 어디 있었나'와 아무 상관이
    // 없다(파서가 orderPositions.by로 짚어 준다) — 그 둘만 걷어 내도 좌표 뭉치가 훨씬
    // 깨끗해진다. 정체를 모르는 명령은 예전처럼 그대로 쓴다.
    const near = orders.filter((o) => Math.abs(o.frame - at) <= half)
      .filter((o) => o.by !== "Worker" && o.by !== "Building");
    if (near.length < POS_MIN_ORDERS) continue;
    const home = baseOf(name);
    const invader = attack && actors.has(name) && !victims.includes(name);
    // 진짜 공격 명령(kind === "attack")이 있으면 그게 최우선이다(요청: 어택 지정 좌표를
    // 정확히 알 수 있나 — 그게 있으면 공격 장면이 더 정확해진다) — screp이 Order 이름을
    // 주는 버전에서는 "집에서 멀리 떨어진 명령"이라는 거리 어림보다 훨씬 확실하다.
    const attacks = invader ? near.filter((o) => o.kind === "attack") : [];
    // 들이친 사람은 집이 아니라 나간 자리에 찍는다. 당한 사람은 그대로 — 당한 자리가 곧
    // 자기 진영이다.
    const away = invader && home !== null
      ? near.filter((o) => Math.hypot(o.x - home.x, o.y - home.y) > POS_AWAY_MIN)
      : [];
    const pool = attacks.length >= POS_MIN_ORDERS ? attacks
      : away.length >= POS_MIN_ORDERS ? away : near;
    const pick = clusterOf(pool, at, target);
    if (pick) out[name] = pick;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 명령들이 가장 붐비는 자리 — 반경 안 이웃이 가장 많은 점의 이웃들 무게중심.
 *
 *  쳐들어간 자리(target)를 아는 경우에는 '가장 붐비는 곳'이 아니라 '그쪽에 가장 가까운
 *  군집'을 고른다 — 여러 곳을 동시에 건드린 판에서 이야기가 말하는 그 싸움터를 짚어야 한다.
 *  받쳐 주는 명령이 모자란 군집은 후보에서 뺀다(정찰 한 번을 싸움터라 할 수는 없다).
 *
 *  창 안의 명령은 수십 개라 이중 순회로 충분하다(실측: 한 사람 최대 99개). */
function clusterOf(
  pts: { frame: number; x: number; y: number }[],
  at: number,
  target: { x: number; y: number } | null,
): [number, number] | null {
  if (pts.length === 0) return null;
  const near = (o: { x: number; y: number }) =>
    pts.filter((q) => Math.hypot(o.x - q.x, o.y - q.y) <= POS_CLUSTER_RADIUS);
  let best = pts[0];
  let bestScore = Infinity;
  let bestN = -1;
  for (const o of pts) {
    const n = near(o).length;
    if (target !== null) {
      // 쳐들어간 쪽에 가까운 군집 우선 — 다만 받쳐 주는 명령이 있는 것만.
      if (n < POS_MIN_ORDERS && bestN >= POS_MIN_ORDERS) continue;
      const score = Math.hypot(o.x - target.x, o.y - target.y);
      if (n >= POS_MIN_ORDERS && bestN < POS_MIN_ORDERS) { bestScore = score; bestN = n; best = o; continue; }
      if (score < bestScore) { bestScore = score; bestN = n; best = o; }
      continue;
    }
    // 아는 자리가 없으면 가장 붐비는 곳, 같으면 그 순간에 가까운 쪽.
    if (n > bestN || (n === bestN && Math.abs(o.frame - at) < Math.abs(best.frame - at))) {
      bestN = n;
      best = o;
    }
  }
  const cluster = near(best);
  return [
    round1(cluster.reduce((sum, q) => sum + q.x, 0) / cluster.length),
    round1(cluster.reduce((sum, q) => sum + q.y, 0) / cluster.length),
  ];
}
