import type { BuildPos, ParsedReplayPlayer, ReplayPlayerSignals } from "./replayParser";
import { hasTech, hasUpgrade } from "./replayTechNames";

// 리플레이 커맨드 스트림에서 '전술'을 짚어낸다(요청: 9드론 저글링 러시 / 투게이트 질럿 /
// 초반 포토러시 / 몰래 배럭 / 목동 저그 / 바이오닉 / 발키리 오버로드 사냥 / 아비터 리콜 /
// 성큰·벙커·포토 방어 / 드랍 플레이 / 센터 장악 …).
//
// 조합 이름("히드라와 뮤탈")만으로는 경기가 다 비슷하게 읽히는데, 전술은 그 경기에서만
// 일어난 일이라 문장이 확 살아난다. 대신 조건이 빡빡해야 한다 — 아무 경기에나 "저글링
// 러시"가 붙으면 전술 이름이 아니라 소음이 된다. 그래서 대부분 "무엇을 얼마나 + 언제"
// 두 가지를 함께 본다.
//
// 한계는 요약 전체와 같다. 커맨드는 '명령'이지 '완성'이 아니고(취소한 생산도 세진다),
// 저그 라바 다중 변태는 커맨드 하나로 잡힌다. 그래서 문장은 결과를 단정하지 않고
// "무엇을 시도했나"까지만 말한다.

const SECONDS_PER_FRAME = 0.042;

// 성큰러시로 볼 시간 창 — 이보다 늦게 본진 밖에 박는 성큰은 러시가 아니라 조이기·확장
// 방어에 가깝다.
const SUNKEN_RUSH_SEC = 7 * 60;
// 포토러시로 볼 시간 창 — 이보다 늦게 상대 본진에 박는 포토는 러시가 아니라 조이기다.
const CANNON_RUSH_SEC = 6 * 60;

/** 짚어낸 전술 하나. 문구는 여기 없다 — 저장은 키와 재료로만 하고(replaySummaryData.ts의
 *  이유 참고) 문장은 replaySummaryText.ts가 만든다. */
export interface Tactic {
  /** 같은 전술이 여러 사람에게서 나와도 한 번만 말하기 위한 키 = 문장 틀 키. */
  key: string;
  /** 이야깃거리로서의 무게 — 큰 것부터 말한다. */
  weight: number;
  /** 그 전술이 드러난 프레임 — 요약을 시간순으로 늘어놓을 때 쓴다. 못 잡으면 null. */
  at: number | null;
  /** 이 전술을 쓴 사람의 리플레이 원본 게임 아이디. */
  who: string;
  /** 당한 쪽 — "9시 조조에게 3게이트 질럿러시"처럼 대상이 있는 전술만(요청). */
  whom?: string;
  /** 덕을 본 아군 — 옆탱처럼 '누구 기지에서 했나'가 곧 전술의 뜻인 경우만. */
  who2?: string;
  /** 문장 틀에 꽂히는 값(드론 수·게이트 수 등). 없으면 생략. */
  p?: Record<string, string | number | boolean>;
}






/** 건물을 지은 자리가 내 본진인지, 아군 본진인지, 가운데인지, 상대 쪽인지.
 *  아군 본진을 내 본진과 갈라 두는 이유는 둘이 정반대 뜻이기 때문이다 — 성큰러시는
 *  아군 기지를 빼야 하고(지적: 다른 저그의 크립 콜로니 위에도 짓는다), 옆탱은 아군
 *  기지여야만 옆탱이다.
 *
 *  "unknown"은 넷 중 어디라고도 말할 수 없는 자리다 — 앞마당·삼룡이·구석 멀티 등.
 *  예전에는 이런 자리가 전부 "mid"(센터)로 떨어져서 "센터에 포토를 지었다" 같은 말이
 *  아무 데나 붙었다(지적: "위치를 센터로 판정하는 기준이 너무 넓어. 정말 센터에 가까워야만
 *  센터로 하고 나머지는 센터인지 아닌지 알 수 없으니 관련 언급 안 하기"). 이제 자리로
 *  이야기를 만드는 규칙들은 unknown을 아예 집어내지 않으므로, 그런 자리는 언급되지 않는다. */
type Zone = "home" | "ally" | "mid" | "enemy" | "unknown";

/** 건물을 지은 자리를 사람이 부르는 이름으로(요청: 내 입구/기지인지 아군 입구/기지인지
 *  상대 입구 앞인지 상대 본진인지 센터인지 다 파악해야 한다).
 *
 *  Zone과 따로 두는 이유: Zone은 규칙들이 '남의 기지냐 내 기지냐'만 가르는 데 쓰는 거친
 *  구분이고, 여기는 문장에 그대로 적을 이름이다. 리플레이에 지형이 없어 '입구'를 지형으로는
 *  못 찾지만 방향으로는 찾을 수 있다 — 그 기지 안이면서 상대 쪽으로 나가 있는 자리다. */
export type BuildSpot =
  | "myBase" | "myFront"
  | "allyBase" | "allyFront"
  | "enemyBase" | "enemyFront"
  | "mid"
  | "unknown";

/** 생산 프레임들을 '한 번에 몰아 뽑은 묶음'으로 자른다 — 생산 사이가 BURST_GAP_SEC 넘게
 *  벌어지면 다른 묶음이다. 총량만 세면 나눠 뽑은 것도 한 덩어리가 돼, 그 이야기를 놓을
 *  시점이 사라진다(지적: "연속적으로 뽑은 게 아니라 나눠져서 뽑은 거라 따로 계산돼야 함.
 *  합쳐서 계산하니 맨 뒤에 들어가서 타임라인적으로도 안 맞음"). 실제로 이 지적이 나온
 *  경기는 질럿 125기가 22·27·35·41기 네 묶음으로 나뉘어 있었고, 가장 큰 묶음은 38분경이었다. */
const BURST_GAP_SEC = 3 * 60;

export function burstsOf(frames: number[]): { from: number; to: number; n: number }[] {
  if (frames.length === 0) return [];
  const sorted = [...frames].sort((a, b) => a - b);
  const gap = BURST_GAP_SEC / SECONDS_PER_FRAME;
  const out: { from: number; to: number; n: number }[] = [{ from: sorted[0], to: sorted[0], n: 1 }];
  for (let i = 1; i < sorted.length; i += 1) {
    const cur = out[out.length - 1];
    if (sorted[i] - sorted[i - 1] > gap) out.push({ from: sorted[i], to: sorted[i], n: 1 });
    else { cur.to = sorted[i]; cur.n += 1; }
  }
  return out;
}

/* 생산 커맨드는 '큐에 넣은 명령'이지 '완성된 유닛'이 아니다. 스타게이트 열세 개를 한꺼번에
   잡고 캐리어를 누르면 그 한 번에 커맨드 열세 개가 찍히고, 거기서 한 번 더 누르면 스물여섯
   개가 된다 — 실제로 나오는 건 건물 수만큼이고 나머지는 줄을 선다. 판이 끝나면 줄에 남은
   것은 아예 나오지 않는다.
   실측(24분 빠른무한, 지적 "캐리어 대수가 자꾸 이상하게 잡혀"): DJKisoo의 캐리어 커맨드
   69개 중 23개가 23.2~23.5분에 몰려 있었다. 캐리어 한 기에 2100프레임(약 88초)이 걸리고
   판은 24분에 끝났으니 그 23기는 하나도 못 나왔다. 커맨드를 그대로 세면 없던 함대가 생긴다.

   그래서 생산 건물 수를 상한으로 두고 줄 세워 '언제 완성됐나'를 계산한다. 값은 표에 적어
   둔 유닛(느리고 비싸서 수가 곧 이야기가 되는 것들)에만 쓴다 — 저글링처럼 금방 나오는
   유닛은 큐가 밀리지 않아 커맨드 수와 다르지 않다.
   한계: 리플레이에는 파괴가 없어 부서진 생산 건물도 계속 뽑는 것으로 계산되고, 건물은
   건설 커맨드 시점부터 쓸 수 있다고 본다(완성까지의 시간만큼 조금 넉넉하다). 둘 다 수를
   부풀리는 쪽이라, 여기서 나온 값은 '많아야 이만큼'이다. */
const UNIT_BUILD_FRAMES: Record<string, { frames: number; from: string }> = {
  Carrier: { frames: 2100, from: "Stargate" },
  Battlecruiser: { frames: 2000, from: "Starport" },
};

/** 그 유닛이 실제로 완성됐을 프레임들 — 생산 건물 수를 상한으로 큐를 흉내 내고, 판이
 *  끝나기 전에 나오지 못한 것은 버린다. 표에 없는 유닛이나 생산 건물을 못 읽은 경우엔
 *  손대지 않고 커맨드 프레임을 그대로 돌려준다. */
export function producedFrames(
  s: ReplayPlayerSignals,
  unit: string,
  endFrame: number | null
): number[] {
  const cmds = [...(s.unitFrames[unit] ?? [])].sort((a, b) => a - b);
  const spec = UNIT_BUILD_FRAMES[unit];
  if (!spec || cmds.length === 0) return cmds;
  const producers = s.buildingFrames[spec.from] ?? [];
  if (producers.length === 0) return cmds;
  const freeAt = [...producers].sort((a, b) => a - b);
  const out: number[] = [];
  for (const f of cmds) {
    // 가장 먼저 비는 생산 건물에 넣는다 — 비어 있으면 곧바로, 아니면 그 건물이 빌 때까지 줄을 선다.
    let idx = 0;
    for (let i = 1; i < freeAt.length; i += 1) if (freeAt[i] < freeAt[idx]) idx = i;
    const at = Math.max(f, freeAt[idx]) + spec.frames;
    freeAt[idx] = at;
    if (endFrame === null || at <= endFrame) out.push(at);
  }
  return out;
}

/* '한때 몇 기나 함께 떠 있었나'를 재는 창 — 캐리어(약 1분 반)·배틀크루저(약 2분)의
   생산시간보다 살짝 넉넉하게 잡는다. 리플레이에는 유닛의 죽음이 없어 동시 보유는 알 수
   없지만, 짧은 창으로 자르면 그 무렵 손에 있던 수에 훨씬 가깝다. */
const CONCURRENT_WINDOW_SEC = 150;

/** 어느 CONCURRENT_WINDOW_SEC 창에 가장 많이 나왔나 — 캐리어·배틀크루저처럼 '몇 기까지
 *  띄웠나'가 이야기인 유닛의 수를 여기서 잡는다. 반드시 producedFrames를 거친 완성 시점을
 *  넣어야 한다(커맨드 프레임을 그대로 넣으면 한꺼번에 큐에 넣은 것이 그대로 한 창에 몰린다).
 *
 *  누계를 쓰면 경기가 길수록 끝없이 늘어나 함대 규모로 읽히는데, 그건 완전히 틀린
 *  그림이다(지적: 캐리어 대수가 이상하게 잡힘). 캐리어는 6서플이라 동시 보유 상한이
 *  서른셋인데다 지상군까지 같이 뽑는 이상, 십여 분에 걸친 누계는 함대와 아무 상관이 없다. */
export function windowPeak(frames: number[], seconds = CONCURRENT_WINDOW_SEC): number {
  if (frames.length === 0) return 0;
  const sorted = [...frames].sort((a, b) => a - b);
  const w = seconds / SECONDS_PER_FRAME;
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < sorted.length; hi += 1) {
    while (sorted[hi] - sorted[lo] > w) lo += 1;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

/** 그중 가장 큰 묶음 — '언제 그 물량이 쏟아졌나'의 답이다. */
export function biggestBurst(frames: number[]): { from: number; to: number; n: number } | null {
  const bs = burstsOf(frames);
  if (bs.length === 0) return null;
  return bs.reduce((a, b) => (b.n > a.n ? b : a));
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 점들의 메도이드(다른 점들까지의 거리 합이 가장 작은 점) = 그 사람의 본진.
 *  평균이 아니라 메도이드를 쓰는 이유는, 몰래 배럭·앞마당 포토처럼 멀리 나간 건물 한두
 *  채가 평균을 통째로 끌고 가버리기 때문이다. 건물 대부분은 본진에 몰려 있으므로
 *  메도이드는 그 덩어리 안에 남는다. */
function medoid(pts: { x: number; y: number }[]): { x: number; y: number } | null {
  if (pts.length === 0) return null;
  let best = pts[0];
  let bestSum = Infinity;
  for (const a of pts) {
    let sum = 0;
    for (const b of pts) sum += dist(a, b);
    if (sum < bestSum) { bestSum = sum; best = a; }
  }
  return best;
}

/** 그 사람 건물들이 본진에서 흩어진 정도(중앙값) = 그 기지의 크기. 지도 단위를 몰라도
 *  되도록 절대값이 아니라 그 사람 자신의 건물 분포로 잰다. */
function spreadOf(p: ParsedReplayPlayer): number | null {
  const pts = p.signals?.buildPositions ?? [];
  const h = homeOf(p);
  if (!h || pts.length < MIN_BUILDINGS_FOR_HOME) return null;
  const ds = pts.map((b) => dist(b, h)).sort((a, b) => a - b);
  return ds[Math.floor(ds.length / 2)];
}

// 본진을 믿고 쓰려면 건물이 이만큼은 있어야 한다 — 두 채뿐이면 어느 쪽이 본진인지 모른다.
const MIN_BUILDINGS_FOR_HOME = 4;
// 내 본진 ↔ 가장 가까운 상대 본진 거리를 1로 뒀을 때의 경계.
const HOME_RADIUS = 0.33;
/* 상대 '본진'이라 부를 수 있는 반경. 0.35는 상대 앞마당·입구까지 품어서, 그쪽에 지은
   방어 건물을 러시로 오판할 여지가 있었다(지적: 무조건 상대 본진에 가까울 때만).
   본진 덩어리에 붙은 자리만 남도록 좁힌다. */
const ENEMY_RADIUS = 0.22;
/* (삭제) '센터'를 내 본진↔가장 가까운 상대 본진의 중점 기준으로 재던 반경(MID_RADIUS=0.12).
   일대일에서는 그 중점이 맵 가운데와 같아서 잘 맞았고, 실측으로도 진짜 길목 포토는 0.04~0.15에
   몰려 있었다. 하지만 본진이 여덟 개인 팀전에서 이 기준이 무너졌다 — 아래 MID_MAP_RATIO. */
/* '센터'를 재는 기준점을 바꾼 이유(지적: 입구 방어를 센터 포토로 오인하는 경우가 많다).
   예전에는 '내 본진과 가장 가까운 상대 본진의 중점'을 센터로 삼았다. 일대일에서는 그게 곧
   맵 가운데지만, 본진이 여덟 개인 팀전에서는 가장 가까운 상대가 바로 옆자리일 수 있어 그
   중점이 내 입구 바로 앞이 된다 — 입구에 박은 포토가 그대로 "센터 포토"가 됐다.
   그래서 참가자 전원의 시작 자리 평균(=맵 가운데)을 쓰고, 그 자리들이 놓인 반지름을 자로
   삼는다. 이러면 팀 구성이나 자리 배치와 무관하게 늘 같은 곳이 센터다. */
const MID_MAP_RATIO = 0.22;
/* 센터는 '아무 본진에서도 멀리 떨어진' 자리이기도 하다(지적: 센터포토 금지맵인데도 센터포토가
   나온다 — 자기 본진 입구를 포토로 막은 것을 센터로 잡는 듯하다. 실측한 그 경기에서
   Taschen_Ever의 포토는 자기 집에서 30타일 나간 자리였는데, 참가자 다섯 명의 시작 자리 평균이
   왼쪽으로 쏠려 있어서 그 자리가 '가운데'로 잡혔다). 그래서 가운데에 가까운 것만으로는 안 되고,
   어느 본진에서도 이만큼(링 반지름 대비)은 떨어져 있어야 센터라고 부른다. */
const MID_AWAY_RATIO = 0.35;
/* 맵 곳곳에 건물을 흩뿌리며 버틴 그림(요청: "둘은 계속해서 맵 구석구석에 건물을 지으며
   도망다니며 버텼어. 이런것도 추출해서 스토리화해줘"). 빠른무한처럼 자원이 무한한 판에서
   서로 자리를 내주고 도망 다니며 새로 짓기를 반복하면 본진 언저리가 아니라 판 전체에
   군집이 생긴다. 실측(Super빠른무한 45분 경기): 두 사람 다 군집 17~18개, 본진에서 본진↔본진
   거리의 0.7배 넘게 나가 지은 건물이 73~80채였다. 보통 경기는 본진·앞마당·삼룡이 정도라
   군집이 서넛을 안 넘으므로 8을 기준으로 잡으면 오탐이 사실상 없다. */
const SCATTER_RADIUS = 0.2;   // 이 안쪽이면 같은 군집
const SCATTER_FAR = 0.7;      // 본진에서 이만큼 넘게 나가면 '멀리 나가 지은 것'
const SCATTER_CLUSTERS_MIN = 8;
const SCATTER_FAR_MIN = 20;
// 본진 중심에서 이만큼은 나가 있어야 '앞'이다 — 안쪽에 박은 건 그냥 본진 건물이다.
const FRONT_MIN = 0.1;
// 상대 쪽으로 60도 안쪽(cos 0.5)이어야 진출로 쪽이라고 본다.
const FRONT_COS = 0.5;
// 몰래 배럭에 딸려 나오면 그 자체가 러시의 증거가 되는 파이어뱃 수 — 방어용으로는 이만큼
// 뽑지 않는다.
const FIREBAT_RUSH_MIN = 6;
// '대규모 뮤탈'로 볼 수 — 한 부대 12기 기준 세 부대(지적: 3~4부대).
const MUTA_MASS_MIN = 36;

// 저글링 러시라 부르려면 초반에 이만큼은 뽑았어야 한다 — 성큰러시에 딸린 두어 기와 가른다.
const ZLING_RUSH_MIN = 6;
// 러시라면 저글링을 꾸준히 뽑는다(지적: 스포닝풀을 해처리보다 먼저 지었다고 무조건 저글링
// 러시는 아니고, 저글링을 좀 꾸준히 뽑았는지 봐야 한다). 예전엔 '경기 전체 저글링 수'만
// 봤는데 그건 어떤 저그든 넘기는 문턱이라, 풀 먼저 올린 뒤 테크로 간 사람까지 러시로
// 읽혔다. 이제 첫 저글링 직후의 구간만 보고, 그 구간에 충분히 뽑았고 한 번에 몰아 뽑은
// 것이 아니라 이어서 뽑았는지까지 확인한다.
const ZLING_RUSH_WINDOW_SEC = 120;
const ZLING_RUSH_SPAN_SEC = 30;

// 병력 건물보다 자원을 먼저 늘린 것이 '초반'이라 할 수 있는 한계 — 이보다 늦으면
// 그냥 확장한 것이지 째기가 아니다.
const GREEDY_BUILD_SEC = 6 * 60;

// 아군 기지에 이만큼은 깔아 줘야 '받쳐줬다'고 말할 수 있다 — 한 개는 지나가다 지은 것일 수 있다.
const ALLY_CANNON_MIN = 2;

// 성큰러시·포토러시·몰래 배럭은 '자리를 보고서야 알 수 있는' 기습이라, 그 경기에서만
// 있었던 일 중에서도 특히 이야깃거리다(요청: 무게감을 올려 달라). 자리가 모자랄 때
// 일반적인 사실보다 먼저 남도록 무게를 따로 잡아 둔다.
// 16 → 20(요청: 포토러시·성큰러시·몰래 배럭이 중요한데 안 나오는 느낌). 이 셋은 그 경기에서만
// 있었던 '자리로만 알 수 있는' 기습이라, 자리다툼에서 물량·업그레이드 같은 일반적인 사실보다
// 확실히 앞서야 한다. 실측(빠른무한 24분 팀전): 20으로 올리자 포토러시가 요약에 남았다.
const SNEAK_WEIGHT = 20;

// '패스트 OO' — 이 시각보다 이르게 첫 기가 나오면 빠른 것이다(요청). 초 단위.
const FAST_UNITS: [string, number][] = [
  ["Dark Templar", 8 * 60], ["Reaver", 9 * 60], ["Lurker", 7 * 60],
  ["Dragoon", 5 * 60], ["Vulture", 4 * 60], ["Mutalisk", 7 * 60],
];
// 한 기만 뽑고 만 것은 '전략'이 아니라 사고다 — 최소한 이만큼은 이어 뽑아야 한다.
const FAST_MIN_UNITS = 3;
// '파워 OO' — 이만큼 뽑고, 그게 병력의 이 비율을 넘으면 그 유닛 하나로 간 것이다(요청).
const POWER_UNITS: [string, number][] = [
  ["Dragoon", 30], ["Hydralisk", 40], ["Zealot", 40], ["Marine", 50],
  ["Vulture", 30], ["Zergling", 60],
];
const POWER_SHARE = 0.6;
// 클로킹 레이스 — 이만큼은 띄워야 '레이스 전략'이다.
const WRAITH_MIN = 4;
// 캐리어 — 한두 기 띄워 보고 접은 것과 실제로 캐리어를 굴린 것을 가른다. 인터셉터까지
// 채워야 쓸모가 생기는 유닛이라 배틀크루저(3기)보다 조금 넉넉히 잡는다.
const CARRIER_MIN = 4;
// 일꾼은 종족을 그대로 드러낸다 — 제 종족이 아닌 일꾼을 뽑았다면 뺏어 온 것이다(요청).
const WORKER_OF = new Map<string, string>([
  ["Probe", "프로토스"], ["Drone", "저그"], ["SCV", "테란"],
]);
// 한두 기는 오차일 수 있다 — 실제로 그 종족을 굴렸다고 하려면 이만큼은 뽑아야 한다.
const MIND_WORKER_MIN = 3;
// '한 종류만 뽑았나'를 셀 때 제외할 것들 — 일꾼·보급·소모품은 조합이 아니다.
const SOLO_EXCLUDE = new Set([
  "SCV", "Probe", "Drone", "Overlord", "Larva", "Egg",
  "Interceptor", "Scarab", "Spider Mine", "Scanner Sweep",
]);
// 셋방살이는 '나중에 들어온 쪽'이다 — 집주인보다 이만큼은 늦게 그 자리에 지었어야 한다.
// 이 조건이 없으면 같은 자리를 공유한 두 아군이 서로를 셋방살이로 지목한다.
const LODGING_LATE_SEC = 3 * 60;

/** 이 사람의 건물 좌표를 구역으로 바꿔 주는 함수. 좌표를 못 읽었거나(screp이 Pos를 안 줌)
 *  본진을 못 정하면 null — 자리 기반 전술(몰래 배럭·센터 포토)은 그냥 안 나온다. */
function homeOf(p: ParsedReplayPlayer): { x: number; y: number } | null {
  const pts = p.signals?.buildPositions ?? [];
  return pts.length >= MIN_BUILDINGS_FOR_HOME ? medoid(pts) : null;
}

/** 시작 본진 — 가장 이른 건물 몇 채의 메도이드.
 *
 *  구역을 가르는 기준은 반드시 이쪽이어야 한다. 경기 전체의 메도이드를 쓰면 멀티를 늘리거나
 *  자리를 옮겨 다닌 사람의 '본진'이 경기가 끝날 때쯤의 무게중심으로 끌려간다 — 실제
 *  리플레이에서 시작 본진이 (111,111)인데 전체 메도이드는 (95,89)로 27만큼 밀렸고, 그
 *  바람에 그 본진 코앞에 박은 건물이 '상대 진영'에서 벗어나 성큰러시·포토러시가 통째로
 *  안 잡혔다(지적: 굉장히 중요한데 빠지는 느낌). 기지 크기를 재는 spreadOf는 지금처럼
 *  전체 메도이드를 쓴다 — 그건 '얼마나 퍼져 있나'라서 뜻이 다르다. */
const HOME_EARLY_BUILDINGS = 8;
function startHomeOf(p: ParsedReplayPlayer): { x: number; y: number } | null {
  const pts = p.signals?.buildPositions ?? [];
  if (pts.length < MIN_BUILDINGS_FOR_HOME) return null;
  const early = [...pts]
    .sort((a, b) => (a.frame ?? 0) - (b.frame ?? 0))
    .slice(0, HOME_EARLY_BUILDINGS);
  return medoid(early);
}

/* '누가 그 사람 진영으로 밀고 들어왔나'를 가르는 값들(요청: 여러 명이 함께 덮친 걸 알 수
   있나). 근거는 이동·공격 명령의 좌표다 — 리플레이에는 전투도 죽음도 없지만 병력을 어디로
   보냈는지는 명령에 남는다.
   반경은 상대 진영을 재는 값(ENEMY_RADIUS)보다 조금 넉넉하게 잡는다: 공격은 본진 한복판이
   아니라 입구·앞마당에서 붙는 일이 흔해서, 0.22로 재면 실제로 들이친 사람이 빠진다. */
const PUSH_RADIUS = 0.3;
/* 그 안에 이만큼은 찍혀야 '병력을 몰고 갔다'로 본다. 정찰 일꾼·오버로드도 상대 본진에
   가지만 그건 몇 번으로 끝난다 — 싸우러 간 쪽은 컨트롤하느라 훨씬 많이 찍는다. */
const PUSH_ORDER_MIN = 12;

/** 그 사람 진영으로 실제로 병력을 몰고 들어온 상대들의 이름(요청). from~to 프레임 사이만
 *  본다 — 경기 내내로 재면 결국 모두가 한 번씩은 들어가므로 아무 뜻이 없다.
 *
 *  한계는 늘 같다: 이건 '명령'이지 '도달'이 아니고, 몇 명이 갔는지이지 누가 무엇을 죽였는지는
 *  아니다. 그래서 "셋이 몰아쳤다"까지만 말하고 전과는 말하지 않는다. */
export function pushersOn(
  victim: ParsedReplayPlayer,
  movers: ParsedReplayPlayer[],
  from: number,
  to: number,
  /** 반경의 자를 정하는 사람들 — 기본은 움직인 사람들(적이 몰고 온 경우가 이 함수의 본래
   *  용도라 그게 맞다). 아군이 도우러 온 것을 재려면 반드시 상대 쪽을 넘겨야 한다:
   *  아군 본진은 서로 붙어 있는 일이 흔해서 그 거리로 자를 잡으면 반경이 거의 0이 되어
   *  아무도 안 걸린다(실측: 팀전 다섯 판에서 아군 지원이 0건이었다). */
  scaleWith?: ParsedReplayPlayer[],
): string[] {
  const home = startHomeOf(victim);
  if (!home) return [];
  const moverHomes = movers.map(startHomeOf).filter((h): h is { x: number; y: number } => h !== null);
  if (moverHomes.length === 0) return [];
  const scaleHomes = (scaleWith ?? movers)
    .map(startHomeOf).filter((h): h is { x: number; y: number } => h !== null);
  if (scaleHomes.length === 0) return [];
  // 기준 거리는 '가장 가까운 상대까지' — geoOf와 같은 좌표계를 쓴다.
  const base = Math.min(...scaleHomes.map((h) => dist(home, h)));
  if (!(base > 0)) return [];
  const r = base * PUSH_RADIUS;
  return movers
    .filter((f) => {
      let n = 0;
      for (const o of f.signals?.orderPositions ?? []) {
        if (o.frame < from || o.frame > to) continue;
        if (dist(o, home) < r && ++n >= PUSH_ORDER_MIN) return true;
      }
      return false;
    })
    .map((f) => f.rawName);
}

/** 자리로 알 수 있는 것들을 한 벌로 묶은 것. 좌표를 못 읽었거나 본진을 못 정하면 통째로
 *  null이고, 자리 기반 전술은 그냥 안 나온다(요청: 불확실한 건 빼기). */
interface Geo {
  zone: (b: BuildPos) => Zone;
  /** 이 자리가 어느 아군의 본진인가 — 옆탱처럼 '누구를 도왔나'를 말해야 하는 경우. */
  allyAt: (b: BuildPos) => string | null;
  /** 이 자리가 어느 상대의 진영인가 — 성큰러시·포토러시처럼 '누구한테 갔나'가 곧
   *  전술의 내용인 경우. 팀전에서도 자리로는 확실히 짚힌다(요청). */
  enemyAt: (b: BuildPos) => string | null;
  /** 내 본진 안이면서 상대 쪽으로 나가 있는 자리인가 = 진출로(입구) 쪽. */
  front: (b: BuildPos) => boolean;
  /** 그 자리를 사람이 부르는 이름 — 내 기지/입구, 아군 기지/입구, 상대 본진/입구 앞, 센터. */
  spot: (b: BuildPos) => BuildSpot;
  /** 내 살림이 아군 기지에 얹혀 있으면 그 아군(지적: 내 기지에 건물이 거의 없고 아군
   *  기지에 있는 게 셋방살이다). 아니면 null. */
  lodgingHost: string | null;
  /** 그중에서도 '시작 자리를 두고 옮겨온' 경우 — 본진을 잃은 그림이라 문장이 달라진다. */
  lodgingLost: boolean;
  /** 건물이 판 전체에 얼마나 흩어져 있나 — 자리를 내주고 도망 다니며 새로 짓기를 반복하면
   *  본진 언저리가 아니라 맵 곳곳에 군집이 생긴다. clusters는 서로 떨어진 건물 무리의 수,
   *  far는 본진에서 SCATTER_FAR 배 넘게 나가 지은 건물 수. */
  spread: { clusters: number; far: number; at: number | null };
}

function geoOf(
  me: ParsedReplayPlayer,
  allies: ParsedReplayPlayer[],
  foes: ParsedReplayPlayer[]
): Geo | null {
  // 구역은 전부 '시작 본진'을 기준으로 가른다(위 startHomeOf 참고) — 경기 전체의 무게중심을
  // 쓰면 멀티를 늘리거나 자리를 옮긴 사람의 본진이 통째로 밀려 러시가 안 잡힌다.
  const home = startHomeOf(me);
  if (!home) return null;
  const foeHomes = foes.map(startHomeOf).filter((h): h is { x: number; y: number } => h !== null);
  if (foeHomes.length === 0) return null;
  const allyHomes = allies
    .map((a) => ({ raw: a.rawName, h: startHomeOf(a) }))
    .filter((a): a is { raw: string; h: { x: number; y: number } } => a.h !== null);
  // 기준 거리는 '가장 가까운 상대까지' — 팀전에서 멀리 있는 상대까지 재면 구역이 다 뭉개진다.
  const base = Math.min(...foeHomes.map((h) => dist(home, h)));
  if (!(base > 0)) return null;
  // 앞쪽을 재는 기준 방향 = 가장 가까운 상대 본진 쪽.
  const near = foeHomes.reduce((a, b) => (dist(home, b) < dist(home, a) ? b : a));
  const dir = { x: (near.x - home.x) / base, y: (near.y - home.y) / base };

  const foeHomeOf = foes
    .map((f) => ({ raw: f.rawName, h: startHomeOf(f) }))
    .filter((f): f is { raw: string; h: { x: number; y: number } } => f.h !== null);

  // 맵 가운데 — 시작 자리들의 '바깥 테두리 가운데'다. 평균을 쓰면 참가자가 한쪽에 쏠린 판에서
  // 가운데가 그쪽으로 끌려간다(실측: 다섯 명 중 셋이 왼쪽인 경기에서 평균이 (53,51)이었고,
  // 그 때문에 왼쪽 사람의 앞마당 포토가 센터로 잡혔다). 테두리 가운데는 그 쏠림에 흔들리지
  // 않는다 — 같은 경기에서 (64,62.5)로, 128×128 맵의 실제 가운데와 거의 같다.
  const allHomes = [home, ...allyHomes.map((a) => a.h), ...foeHomes];
  const mapMid = {
    x: (Math.min(...allHomes.map((h) => h.x)) + Math.max(...allHomes.map((h) => h.x))) / 2,
    y: (Math.min(...allHomes.map((h) => h.y)) + Math.max(...allHomes.map((h) => h.y))) / 2,
  };
  const ring = allHomes.reduce((n, h) => n + dist(h, mapMid), 0) / allHomes.length;
  /** 정말 맵 가운데인가 — 가운데에 가깝고, 어느 본진에서도 충분히 멀어야 한다(위 주석).
   *  본진·아군기지·상대기지 판정 뒤에만 쓴다. */
  const atMapMid = (b: BuildPos): boolean => {
    if (!(ring > 0)) return false;
    if (dist(b, mapMid) >= ring * MID_MAP_RATIO) return false;
    return allHomes.every((h) => dist(b, h) > ring * MID_AWAY_RATIO);
  };

  const enemyAt = (b: BuildPos): string | null => {
    let best: { raw: string; d: number } | null = null;
    for (const f of foeHomeOf) {
      const d = dist(b, f.h);
      if (d < base * ENEMY_RADIUS && (!best || d < best.d)) best = { raw: f.raw, d };
    }
    return best?.raw ?? null;
  };

  const allyAt = (b: BuildPos): string | null => {
    let best: { raw: string; d: number } | null = null;
    for (const a of allyHomes) {
      const d = dist(b, a.h);
      if (d < base * HOME_RADIUS && (!best || d < best.d)) best = { raw: a.raw, d };
    }
    return best?.raw ?? null;
  };

  const zone = (b: BuildPos): Zone => {
    const toFoe = Math.min(...foeHomes.map((h) => dist(b, h)));
    if (toFoe < base * ENEMY_RADIUS) return "enemy";
    if (dist(b, home) < base * HOME_RADIUS) return "home";
    // 아군 본진도 '남의 기지가 아닌 곳'이다(지적: 다른 저그의 크립 콜로니 위에도 짓는다).
    // 내 본진과 갈라 두어야 성큰러시에서 빼고 옆탱에서만 쓸 수 있다.
    if (allyAt(b) !== null) return "ally";
    // '센터'라고 부르려면 정말 맵 가운데여야 한다(요청) — 참가자 전원의 시작 자리 평균
    // 언저리만 센터로 친다(MID_MAP_RATIO 주석: 예전 기준은 팀전에서 내 입구를 센터로
    // 잡았다). 여기 안 드는 자리(앞마당·삼룡이·구석 멀티 등)는 어디라고 특정할 수 없으므로
    // unknown으로 두고, 자리를 근거로 삼는 규칙들이 아예 안 건드린다.
    if (atMapMid(b)) return "mid";
    return "unknown";
  };

  // 리플레이에는 지형이 없다 — 램프가 어디인지는 알 방법이 없다. 대신 확실한 건
  // 방향이다: 내 본진 안이되 상대 쪽으로 나가 있는 자리는 진출로 쪽이다. 뒤나 옆에
  // 박은 건물은 걸리지 않는다.
  const front = (b: BuildPos): boolean => {
    const v = { x: b.x - home.x, y: b.y - home.y };
    const len = Math.hypot(v.x, v.y);
    if (len < base * FRONT_MIN) return false;      // 본진 한복판이면 앞이 아니다
    if (len > base * HOME_RADIUS) return false;    // 너무 멀면 그건 본진 밖이다
    return (v.x * dir.x + v.y * dir.y) / len > FRONT_COS;
  };

  /** origin 기지 안이면서 target 쪽으로 나가 있는 자리인가 — front를 임의의 기지에
   *  대해 쓸 수 있게 일반화한 것이다(아군 입구·상대 입구 앞을 같은 자로 재려면 필요하다). */
  const towardFront = (
    origin: { x: number; y: number }, target: { x: number; y: number }, b: BuildPos, radius: number,
  ): boolean => {
    const len = Math.hypot(b.x - origin.x, b.y - origin.y);
    if (len < base * FRONT_MIN || len > base * radius) return false;
    const tl = Math.hypot(target.x - origin.x, target.y - origin.y);
    if (!(tl > 0)) return false;
    const cos = ((b.x - origin.x) * (target.x - origin.x) + (b.y - origin.y) * (target.y - origin.y))
      / (len * tl);
    return cos > FRONT_COS;
  };

  /** 그 자리를 사람이 부르는 이름으로(요청). 상대 진영은 '본진'과 '입구 앞'을 가른다 —
   *  내 쪽을 향한 바깥쪽이 입구 앞이고, 더 깊이 들어간 곳이 본진이다. 포토러시가 입구
   *  앞을 막은 것인지 본진 한복판에 박은 것인지는 전혀 다른 이야기라서다. */
  const spot = (b: BuildPos): BuildSpot => {
    // 상대 진영이 가장 먼저다 — 남의 기지에 지은 건물은 무엇보다 그 사실이 중요하다.
    let nearFoe: { h: { x: number; y: number }; d: number } | null = null;
    for (const h of foeHomes) {
      const d = dist(b, h);
      if (!nearFoe || d < nearFoe.d) nearFoe = { h, d };
    }
    if (nearFoe && nearFoe.d < base * ENEMY_RADIUS) {
      // 그 상대 기지에서 볼 때 '내 쪽으로 나와 있는' 자리 = 그 사람의 입구 앞.
      return towardFront(nearFoe.h, home, b, ENEMY_RADIUS) ? "enemyFront" : "enemyBase";
    }
    if (dist(b, home) < base * HOME_RADIUS) {
      return front(b) ? "myFront" : "myBase";
    }
    for (const a of allyHomes) {
      if (dist(b, a.h) >= base * HOME_RADIUS) continue;
      // 그 아군의 입구는 그 아군에게 가장 가까운 상대 쪽이다.
      const foe = foeHomes.reduce((x, y) => (dist(a.h, y) < dist(a.h, x) ? y : x));
      return towardFront(a.h, foe, b, HOME_RADIUS) ? "allyFront" : "allyBase";
    }
    if (atMapMid(b)) return "mid";
    return "unknown";
  };

  // 셋방살이 — 두 갈래로 잡는다(요청: 이 이야기가 더 자주 나왔으면).
  //   ① 내 건물 덩어리 자체가 아군 기지 안에 앉아 있다(메도이드가 거기 있다).
  //   ② 시작 자리는 따로 있었는데, 나중에 아군 기지로 살림을 옮겼다 — 본진을 잃은 그림이다.
  // ②가 실제로 훨씬 흔하다. ①만 보면 원래 자리에 건물이 많이 남은 경우를 놓친다.
  const lodging = (() => {
    const myPts = me.signals?.buildPositions ?? [];
    /** 그 자리 근처에 이 사람이 처음 지은 시각 — 누가 집주인인지 가른다. */
    const firstNear = (p: ParsedReplayPlayer, at: { x: number; y: number }, r: number) => {
      const fs = (p.signals?.buildPositions ?? [])
        .filter((b) => dist(b, at) <= r && b.frame !== null)
        .map((b) => b.frame as number);
      return fs.length > 0 ? Math.min(...fs) : null;
    };
    // 시작 자리 = 가장 이른 건물 몇 채의 메도이드. 지금의 본진(메도이드)과 다를 수 있다.
    const early = [...myPts].sort((a, b) => (a.frame ?? 0) - (b.frame ?? 0)).slice(0, 5);
    const start = medoid(early) ?? home;
    const mySpread = spreadOf(me) ?? 0;

    let best: { raw: string; lost: boolean; d: number } | null = null;
    for (const a of allies) {
      const h = homeOf(a);
      const spread = spreadOf(a);
      if (!h || spread === null || !(spread > 0)) continue;
      if (dist(home, h) >= base * HOME_RADIUS) continue; // 아예 딴 동네면 볼 것 없다
      // 늦게 들어온 쪽이 셋방이다. 집주인은 처음부터 거기 있었다.
      const mine = firstNear(me, h, spread);
      const theirs = firstNear(a, h, spread);
      if (mine === null || theirs === null || sec(mine - theirs) < LODGING_LATE_SEC) continue;

      const inside = dist(home, h) <= spread;
      // ② 시작 자리는 딴 곳이었는데 그 뒤로 여기에 세 채 넘게 지었고, 원래 자리에는
      //    거의 돌아가지 않았다 — 옮겨온 것이다.
      const mineThere = myPts.filter((b) => dist(b, h) <= spread);
      const backHome = myPts.filter(
        (b) => (b.frame ?? 0) > mine && mySpread > 0 && dist(b, start) <= mySpread
      );
      const moved = dist(start, h) > spread && mineThere.length >= 3 && backHome.length <= 1;
      if (!inside && !moved) continue;
      const d = dist(home, h);
      if (!best || d < best.d) best = { raw: a.rawName, lost: moved, d };
    }
    return best;
  })();
  const lodgingHost = lodging?.raw ?? null;
  const lodgingLost = lodging?.lost ?? false;

  // 건물 분포 — 군집 수는 '그리디 군집화'로 센다(서로 SCATTER_RADIUS 안쪽이면 같은 무리).
  const mine = me.signals?.buildPositions ?? [];
  const seeds: BuildPos[] = [];
  for (const b of mine) {
    if (!seeds.some((c) => dist(c, b) < base * SCATTER_RADIUS)) seeds.push(b);
  }
  // 시점은 '본진을 벗어나 지은 건물들의 중간 때' — 첫 채로 잡으면 지나가다 하나 지은 것에
  // 끌려 앞으로 당겨지고, 시점을 아예 안 두면 맺음말 앞으로 밀려 타임라인이 어긋난다(지적).
  const far = mine.filter((b) => dist(b, home) > base * SCATTER_FAR);
  const farFrames = far
    .map((b) => b.frame)
    .filter((f): f is number => f !== null)
    .sort((x, y) => x - y);
  const spread = {
    clusters: seeds.length,
    far: far.length,
    at: farFrames.length > 0 ? farFrames[Math.floor(farFrames.length / 2)] : null,
  };

  return { zone, allyAt, enemyAt, front, spot, lodgingHost, lodgingLost, spread };
}

interface Ctx {
  /** 리플레이 원본 게임 아이디 — 문장에 쓸 이름은 볼 때 다시 푼다. */
  rawName: string;
  s: ReplayPlayerSignals;
  race: string;
  foeRaces: string[];
  /** 이 사람이 지은 건물의 자리로 알 수 있는 것들. 좌표를 못 읽으면 null. */
  geo: Geo | null;
  /** 1:1이면 상대 한 사람 — 팀전은 누가 당했는지 커맨드만으로 알 수 없어 null이다.
   *  당한 쪽을 말할 땐 반드시 한 쪽도 함께 말한다(요청). */
  soleFoe: string | null;
  /** 팀전에서 '내 옆에 붙은' 상대 — 나머지 상대보다 뚜렷하게 가까운 한 사람이 먼저
   *  나가떨어졌을 때만 값이 있다. 탱크 방어의 근거다. */
  neighbor: { raw: string; fellAt: number } | null;
  /** 판이 끝난 프레임 — 큐에 남아 끝내 나오지 못한 생산을 걸러내는 데 쓴다(producedFrames). */
  endFrame: number;
}

const sec = (frame: number) => frame * SECONDS_PER_FRAME;


function detectFor(c: Ctx): Tactic[] {
  const { rawName, s, race, foeRaces, soleFoe, geo, neighbor, endFrame } = c;
  const out: Tactic[] = [];
  const u = (n: string) => s.unitCounts[n] ?? 0;
  const firstU = (n: string): number | null => s.firstUnitFrame[n] ?? null;
  const firstB = (n: string): number | null => s.firstBuildingFrame[n] ?? null;
  const tanks = u("Siege Tank (Tank Mode)") + u("Siege Tank (Siege Mode)");
  const who = rawName;
  // 당한 쪽 — 1:1에서만 확실하다. 못 짚으면 그 부분만 빠지고 문장은 그대로 나온다.
  const target = soleFoe ? { whom: soleFoe } : {};
  // 한 종류만 주야장천 뽑았나 — 그러면 이겼더라도 '무지성'이라 부를 수 있다(지적).
  const army = Object.entries(s.unitCounts).filter(([u]) => !SOLO_EXCLUDE.has(u));
  const armyTotal = army.reduce((acc, [, n]) => acc + n, 0);
  const topArmy = army.map(([, n]) => n).sort((a, b) => b - a)[0] ?? 0;
  const solo = armyTotal >= 12 && topArmy / armyTotal >= 0.8;
  /** 드랍은 수송선을 뽑은 것만으로는 알 수 없다 — 실제로 내린 커맨드가 있어야 드랍이다. */
  const dropped = s.unloadCount >= 2;
  /** 그 구역에 지은 건물들(좌표를 못 읽으면 항상 빈 배열). */
  /** 그 건물들이 지어진 '자리 이름' — 여럿이면 가장 많이 나온 이름을 쓴다(요청: 내 입구/
   *  기지, 아군 입구/기지, 상대 입구 앞, 상대 본진, 센터를 다 파악해야 한다). 자리를 못
   *  가리면 아무 값도 안 남긴다(문장이 자리를 말하지 않는다). */
  const spotOf = (bs: BuildPos[]): { spot: BuildSpot } | Record<string, never> => {
    if (!geo || bs.length === 0) return {};
    const tally = new Map<BuildSpot, number>();
    for (const b of bs) {
      const sp = geo.spot(b);
      if (sp !== "unknown") tally.set(sp, (tally.get(sp) ?? 0) + 1);
    }
    if (tally.size === 0) return {};
    const best = [...tally].sort((a, b) => b[1] - a[1])[0][0];
    return { spot: best };
  };

  const inZone = (z: Zone, unit?: string, beforeSec?: number): BuildPos[] => {
    if (!geo) return [];
    return s.buildPositions.filter(
      (p) =>
        (unit === undefined || p.unit === unit) &&
        (beforeSec === undefined || (p.frame !== null && sec(p.frame) < beforeSec)) &&
        geo.zone(p) === z
    );
  };
  /** 내 본진 앞(진출로 쪽)에 세운 것들 — 지형이 없으니 '상대 쪽으로 나가 있나'로 본다. */
  const atFront = (unit: string): BuildPos[] =>
    geo ? inZone("home", unit).filter(geo.front) : [];
  /** 그 건물들이 들어선 진영의 주인 — 팀전에서도 '누구한테 갔나'를 자리로 짚는다(요청).
   *  가운데에 박은 것뿐이면 주인이 없어 null이고, 그때는 1:1일 때만 상대를 말한다. */
  const foeAt = (b: BuildPos[]): { whom: string } | typeof target => {
    if (geo) {
      for (const x of b) {
        const f = geo.enemyAt(x);
        if (f) return { whom: f };
      }
    }
    return target;
  };
  /** 건물 묶음에서 가장 이른 프레임 — 그 전술이 드러난 시점. */
  const firstOf = (b: BuildPos[]): number | null => {
    const f = b.map((x) => x.frame).filter((x): x is number => x !== null);
    return f.length > 0 ? Math.min(...f) : null;
  };

  // 병력 건물부터 올리지 않고 자원부터 늘리는 것도 '째기'다(요청) — 저그는 스포닝풀 없이
  // 해처리 셋, 프로토스·테란은 게이트/배럭 없이 투넥서스·투커맨드가 그 신호다. 순서 자체가
  // 증거라 유닛 수를 세는 것보다 확실하다.
  {
    // 병력 건물이 아예 안 보이는 기록은 '늦게 지었다'가 아니라 '기록이 없다'로 봐야 한다 —
    // 그걸 째기로 세면 커맨드만 늘린 판이 죄다 째기가 된다. 병력 건물이 실제로 있는
    // 기록에서만, 그것보다 자원 건물이 먼저 올라갔을 때를 본다.
    const later = (b: string) => firstB(b) ?? Infinity;
    const military = race === "저그" ? "Spawning Pool" : race === "프로토스" ? "Gateway" : "Barracks";
    const hatches = (s.buildingFrames["Hatchery"] ?? []).filter((f) => f < later(military));
    const greedy =
      firstB(military) === null ? null
      : race === "저그" ? (hatches.length >= 2 ? hatches[1] : null)
      : race === "프로토스" ? (later("Nexus") < later("Gateway") ? firstB("Nexus") : null)
      : race === "테란" ? (later("Command Center") < later("Barracks") ? firstB("Command Center") : null)
      : null;
    if (greedy !== null && sec(greedy) < GREEDY_BUILD_SEC) {
      out.push({
        key: "greedy-build", weight: 12, at: greedy, who,
        p: { kind: race === "저그" ? "hatch" : race === "프로토스" ? "nexus" : "command" },
      });
    }
  }

  // ── 종족을 가리지 않는 것들 ──
  // '패스트 OO' — 그 유닛이 나오는 보통 타이밍보다 확실히 이르면 그 자체가 전략이다(요청).
  for (const [unit, bySec] of FAST_UNITS) {
    const f = firstU(unit);
    if (f !== null && sec(f) <= bySec && u(unit) >= FAST_MIN_UNITS) {
      out.push({ key: "fast-tech", ...target, weight: 12, at: f, who, p: { unit, min: Math.max(1, Math.round(sec(f) / 60)) } });
      break; // 하나만 — 여러 개를 다 말하면 '빠른 무엇'이 흐려진다
    }
  }
  // 마인드 컨트롤(다크 아콘)로 아군의 일꾼을 뺏어 그 종족 건물까지 올리는 전략(요청) —
  // 제 종족이 아닌 일꾼을 뽑았다는 것이 그 증거다. 다른 방법으로는 나올 수 없는 커맨드다.
  const foreign = ([...WORKER_OF] as [string, string][])
    .filter(([w, r]) => r !== race && u(w) >= MIND_WORKER_MIN)
    .map(([, r]) => r);
  if (foreign.length > 0) {
    out.push({
      key: "mind-control", weight: 16,
      at: firstU([...WORKER_OF].find(([, r]) => r === foreign[0])?.[0] ?? "") ?? null,
      who, p: { race: foreign[0] },
    });
  }
  // '파워 OO' — 한 유닛을 압도적으로 뽑아 그 물량으로 밀어붙이는 그림(요청).
  for (const [unit, min] of POWER_UNITS) {
    if (u(unit) >= min && armyTotal > 0 && u(unit) / armyTotal >= POWER_SHARE) {
      // 시점은 '가장 크게 몰아 뽑은 묶음'에 건다. 예전엔 총량 이야기라며 시점을 안 뒀는데,
      // 시점 없는 문장은 맺음말 바로 앞으로 밀려서 정작 그 물량이 쏟아진 때와 한참 어긋난
      // 자리에 놓였다(지적). 나눠 뽑았으면 그중 가장 큰 묶음이 곧 그 이야기의 시점이다.
      const burst = biggestBurst(s.unitFrames[unit] ?? []);
      out.push({
        key: "power-unit", weight: 11, at: burst ? burst.from : null, who,
        p: {
          unit, n: u(unit),
          // 한 묶음에 다 뽑았으면 굳이 나눠 말하지 않는다 — 총량 문장 그대로다.
          ...(burst && burst.n < u(unit) ? { burst: burst.n, min: Math.round((burst.from * SECONDS_PER_FRAME) / 60) } : {}),
        },
      });
      break;
    }
  }

  // ── 저그 ──
  if (race === "저그") {
    // N드론 저글링 러시 — 스포닝풀을 짓기 전에 드론을 몇 기 뽑았나가 곧 빌드 이름이다
    // (시작 드론 4기 + 그때까지 뽑은 수). 풀도 저글링도 충분히 일러야 '러시'다.
    const pool = firstB("Spawning Pool");
    const ling = firstU("Zergling");
    // 저글링을 이만큼은 뽑아야 '러시'다 — 두어 기는 정찰·수비지 러시가 아니다(지적:
    // 성큰러시를 9드론 저글링 러시로 오인함). 성큰러시도 풀을 일찍 올리고 저글링을
    // 조금 뽑기 때문에, 수를 보지 않으면 그대로 저글링 러시로 읽힌다.
    //
    // 그리고 '경기 전체에 몇 기'가 아니라 '첫 저글링 직후에 꾸준히 뽑았나'를 본다(지적:
    // 풀을 먼저 지었다고 무조건 러시는 아니다). 두 가지를 함께 요구한다 —
    //   ① 러시 구간(첫 저글링 + 2분) 안에 충분한 수
    //   ② 그 수가 한 순간에 몰린 게 아니라 30초 넘게 이어졌다
    // ②가 없으면 라바 여섯 마리를 한꺼번에 저글링으로 변태시킨 수비 한 번도 러시가 된다.
    const rushLings = ling === null
      ? []
      : (s.unitFrames["Zergling"] ?? [])
        .filter((f) => f <= ling + ZLING_RUSH_WINDOW_SEC / SECONDS_PER_FRAME)
        .sort((a, b) => a - b);
    const rushSpan = rushLings.length > 0
      ? (rushLings[rushLings.length - 1] - rushLings[0]) * SECONDS_PER_FRAME
      : 0;
    if (
      pool !== null && ling !== null && sec(pool) < 210 && sec(ling) < 300
      && rushLings.length >= ZLING_RUSH_MIN && rushSpan >= ZLING_RUSH_SPAN_SEC
    ) {
      const drones = 4 + (s.unitFrames["Drone"] ?? []).filter((f) => f < pool).length;
      if (drones >= 7 && drones <= 14) {
        out.push({
          key: "zling-rush", ...target, weight: 12, at: ling,
          who, p: { drones, solo },
        });
      }
    }
    // 목동 저그 — 저글링·울트라에 다크스웜(또는 디파일러)까지 얹은 그림.
    const swarm = hasTech(s, "Dark Swarm") || u("Defiler") >= 2;
    if (u("Zergling") >= 12 && u("Ultralisk") >= 3 && swarm) {
      out.push({
        key: "moka", weight: 11, at: firstU("Ultralisk"),
        who,
      });
    } else if (hasTech(s, "Dark Swarm")) {
      out.push({
        key: "swarm", weight: 6, at: s.firstTechFrame["Dark Swarm"] ?? null,
        who,
      });
    }
    if (u("Devourer") >= 3 && u("Mutalisk") >= 6) {
      out.push({
        key: "devourer", weight: 9, at: firstU("Devourer"),
        who,
      });
    }
    // 러커/히드라 드랍(요청) — 저그는 오버로드에 태워야 하므로 수송 업그레이드가 곧 신호다.
    if (dropped && hasUpgrade(s, "Ventral Sacs") && (u("Lurker") >= 3 || u("Hydralisk") >= 8)) {
      out.push({
        key: "zerg-drop", ...target, weight: 11,
        at: s.firstUnloadFrame,
        who, p: { lurker: u("Lurker") >= 3 },
      });
    }
    // 커널(나이더스 커널) — 뚫어 놓으면 병력이 순식간에 건너간다(요청). 건물 건설 커맨드
    // 하나로 확실히 잡히고, 애초에 자주 나오지 않아 나오면 그 자체가 이야깃거리다.
    //
    // 다만 커널은 그 자체로 때리는 수가 아니라 문이다 — '누구를 때렸다'로 쓰려면 그 문이
    // 실제로 상대 진영에 뚫려 있어야 한다(지적: "정구는 저그고 수달은 프로토스인데 커널로
    // 피해?"). 실측한 리플레이에서 커널 6개가 전부 제 본진 언저리(본진↔본진 거리의
    // 0.17~0.25배)에 있고 상대 본진과는 0.77배 넘게 떨어져 있었는데도, 그 상대의 생산이
    // 꺾인 것을 커널 탓으로 적었다. 자리를 근거로 쓸 수 있을 때만 상대를 짚고, 그때만
    // 피해의 원인으로 쓴다(intoFoe — replaySummary의 damageFrom이 본다).
    const nydusSpots = s.buildPositions.filter((b) => b.unit === "Nydus Canal");
    if (nydusSpots.length >= 1) {
      const into = foeAt(nydusSpots);
      const intoFoe = "whom" in into && !!into.whom && geo !== null
        && nydusSpots.some((b) => geo.enemyAt(b) !== null);
      // 상대 진영에 뚫은 것을 근거로 쓸 때는 시점도 그 커널의 것이어야 한다 — 첫 커널이
      // 제 본진 쪽이면 시점과 근거가 서로 다른 커널을 가리킨다(실측: 첫 커널 14.2분은 아무
      // 진영도 아니고, 상대 진영에 들어간 것은 16.1분이었다).
      const intoSpots = geo ? nydusSpots.filter((b) => geo.enemyAt(b) !== null) : [];
      out.push({
        key: "nydus", ...(intoFoe ? into : target), weight: 12,
        at: (intoFoe ? firstOf(intoSpots) : null) ?? s.firstBuildingFrame["Nydus Canal"] ?? null,
        who, p: { intoFoe },
      });
    }
    // 성큰러시(요청) — 초반에 상대 본진 코앞에 성큰을 박는 것. 해처리는 보지 않는다
    // (지적: 보통 해처리를 안 펴고 바로 성큰을 짓는다) — 크립콜로니/성큰 자체의 자리만 본다.
    //
    // 한때 '내 본진 밖'이면 다 러시로 봤는데, 그러면 내 앞마당·입구·멀티에 편 방어 성큰이
    // 죄다 러시가 됐다(지적, 두 번). '상대 쪽으로 절반 넘게 넘어갔나'로 바꿔도 마찬가지다 —
    // 맵에 따라 내 앞마당이나 빨무 입구, 멀티가 내 본진보다 상대 본진에 가까울 수 있는데,
    // 그렇다고 거기가 상대 진영인 건 아니기 때문이다(지적). 그래서 기준은 하나로 못박는다:
    // 상대 '본진'에 붙어 있을 때만 러시다.
    const sunkenRush = (["Creep Colony", "Sunken Colony"] as const)
      .flatMap((b) => inZone("enemy", b, SUNKEN_RUSH_SEC));
    if (sunkenRush.length > 0) {
      out.push({
        key: "sunken-rush", ...foeAt(sunkenRush), weight: SNEAK_WEIGHT, at: firstOf(sunkenRush), who,
        p: { ...spotOf(sunkenRush) },
      });
    }
    // 뮤탈 대규모 — 한두 부대로는 '대규모'가 아니다(지적: 3~4부대). 한 부대 12기 기준으로
    // 세 부대부터 본다. 견제의 대명사라 상대 일꾼 생산이 치솟았는지와 짝지어 볼 수 있다(요청).
    const mutas = u("Mutalisk");
    if (mutas >= MUTA_MASS_MIN) {
      out.push({
        key: "muta", weight: 9, at: firstU("Mutalisk"), who,
        p: { squads: Math.floor(mutas / 12) },
      });
    }
    // 가디언 — 뮤탈을 변태시켜 지상을 두들기는 그림. 나오는 것 자체가 드물어 이야깃거리다(요청).
    if (u("Guardian") >= 4) {
      out.push({
        key: "guardian", weight: 10, at: firstU("Guardian"), who,
        p: { n: u("Guardian") },
      });
    }
    // 인페스티드 테란(요청) — 퀸으로 상대 커맨드센터를 감염시켜야만 나온다. 경기에 한 번
    // 나올까 말까 한 사건이라, 나왔다는 것 자체가 그날의 이야기다.
    if (u("Infested Terran") >= 1) {
      out.push({
        key: "infested", ...target, weight: 16,
        at: firstU("Infested Terran"), who, p: { n: u("Infested Terran") },
      });
    }
    if (u("Lurker") >= 5) {
      out.push({
        key: "lurker", weight: 7, at: firstU("Lurker"),
        who,
      });
    }
  }

  // ── 테란 ──
  if (race === "테란") {
    if (u("Marine") >= 16 && u("Medic") >= 5) {
      const withTank = tanks >= 4;
      out.push({
        key: "bionic", weight: 10, at: firstU("Medic"),
        who, p: { tank: withTank },
      });
    } else if (tanks >= 6 && u("Vulture") + u("Goliath") >= 8 && u("Marine") < 10) {
      out.push({
        key: "mech", weight: 9, at: firstU("Siege Tank (Tank Mode)") ?? firstU("Goliath"),
        who,
      });
    }
    // 배틀크루저 — 띄우는 것 자체가 사건이고, 띄우고도 지는 경기가 많아 이야기가 된다(요청).
    // 캐리어와 같은 이유로 누계가 아니라 창 단위 최대로 잰다(위 windowPeak 참고).
    const bcs = producedFrames(s, "Battlecruiser", endFrame);
    const bcPeak = windowPeak(bcs);
    if (bcPeak >= 3) {
      out.push({
        key: "bc", weight: 11, at: firstU("Battlecruiser"), who,
        p: { n: bcPeak },
      });
    }
    if (u("Valkyrie") >= 3 && foeRaces.includes("저그")) {
      out.push({
        key: "valkyrie", weight: 8, at: firstU("Valkyrie"),
        who,
      });
    }
    // 몰래 배럭 — 본진에서 한참 떨어진 자리에 올린 초반 배럭. 자리를 안 보면 그냥 배럭이다.
    // 자리만으로는 애매한 구석이 있다(지적) — 상대 진영으로 보이는 자리는 그것만으로 확실하지만,
    // 가운데에 올린 배럭은 앞마당 방어일 수도 있다. 그래서 가운데 배럭은 파이어뱃까지 나왔을
    // 때만 인정하고, 그 조합은 아예 '몰래 배럭 파이어뱃 러시'로 부른다(요청).
    const firebats = u("Firebat");
    const rushFirebat = firebats >= FIREBAT_RUSH_MIN;
    const atFoe = inZone("enemy", "Barracks", 300);
    const sneaky = [...atFoe, ...(rushFirebat ? inZone("mid", "Barracks", 300) : [])];
    if (sneaky.length > 0) {
      out.push({
        key: "sneak-rax", ...foeAt(sneaky), weight: rushFirebat ? SNEAK_WEIGHT + 1 : SNEAK_WEIGHT,
        at: firstOf(sneaky), who, p: { firebat: rushFirebat, ...spotOf(sneaky) },
      });
    }
    // 탱크 방어(흔히 옆탱, 요청) — 두 갈래다. 아군 기지에 팩토리를 올려 그쪽을 받쳐주는 것도 옆탱이고,
    // 내 기지에서 뽑은 탱크로 바로 옆에 붙은 상대를 잡아내는 것도 옆탱이다(지적).
    const sideFactory = inZone("ally", "Factory");
    const firstTank = firstU("Siege Tank (Tank Mode)") ?? firstU("Siege Tank (Siege Mode)");
    if (sideFactory.length > 0 && tanks >= 3) {
      const helped = geo?.allyAt(sideFactory[0]) ?? null;
      out.push({
        key: "side-tank", weight: 11, at: firstOf(sideFactory), who,
        ...(helped ? { who2: helped } : {}), p: { at: "ally" },
      });
    } else if (neighbor && tanks >= 3 && firstTank !== null && neighbor.fellAt > firstTank) {
      // 탱크가 실제로 무엇을 잡았는지는 리플레이에 없다. 확실한 건 '옆에 붙은 상대가
      // 내 탱크가 나온 뒤에 먼저 판에서 사라졌다'는 것이고, 딱 그만큼만 말한다.
      out.push({
        key: "side-tank", weight: 12, at: firstTank, who,
        whom: neighbor.raw, p: { at: "home" },
      });
    }
    if (dropped && u("Dropship") >= 2) {
      out.push({
        key: "dropship", ...target, weight: 7, at: s.firstUnloadFrame,
        who,
      });
    }
  }

  // 클로킹 레이스(요청) — 레이스만으로는 정찰일 수 있고, 클로킹까지 올려야 전략이다.
  // 레이스 클로킹은 '기술(Tech)'이다 — 예전엔 upgradeNames에서 찾고 있어서 이 전술이
  // 한 번도 안 떴다(지적). 이름을 타입으로 좁힌 hasTech로 바꿔 같은 실수를 막는다.
  if (race === "테란" && u("Wraith") >= WRAITH_MIN && hasTech(s, "Cloaking Field")) {
    out.push({
      key: "cloak-wraith", ...target, weight: 12,
      at: firstU("Wraith"), who, p: { n: u("Wraith") },
    });
  }
  // (삭제) 이레디에이트로 일꾼을 지웠다는 이야기 — 근거가 "이레디를 올리고 베슬을 몇 기
  // 뽑았다"뿐이었다. 그건 그 마법을 무엇에 썼는지는 하나도 말해 주지 않는다. 이레디는
  // 러커·뮤탈·디파일러에게 훨씬 자주 쓰이고, 커맨드 스트림에는 대상이 안 남는다
  // (지적: "하이템플러나 사베가 일꾼 견제에 쓰였는지 그냥 전투·방어에 쓰였는지 구분하기
  // 힘들면 그런 자세한 묘사는 제거해줘"). 남길 만한 사실이 없어 통째로 뺀다.

  // ── 프로토스 ──
  if (race === "프로토스") {
    // N게이트 질럿 러시 — 첫 질럿이 나오기 전에 세운 게이트 수가 곧 빌드 이름이다.
    const zealot = firstU("Zealot");
    if (zealot !== null && sec(zealot) < 260 && u("Zealot") >= 6) {
      const gates = (s.buildingFrames["Gateway"] ?? []).filter((f) => f < zealot).length;
      if (gates >= 2) {
        out.push({
          key: "zealot-rush", ...target, weight: 12, at: zealot,
          who, p: { gates, solo },
        });
      }
    }
    // 초반 포토러시 — 상대 본진에 박은 포토만 해당한다(지적). 가운데까지 세면 앞마당·길목
    // 방어 포토가 죄다 러시로 잡혀 지나치게 자주 나왔다. 포지를 게이트보다 먼저 올린 것도
    // 근거가 아니다 — 그건 빠른 포지일 뿐이고 그 포토를 제 본진에 지었으면 방어다.
    // 포토도 같은 기준 — 상대 본진에 붙은 것만(지적: 내 앞마당·입구에 지은 포토를 러시로 봄).
    //
    // 때를 재는 건 '상대 본진에 박은 그 포토'다. 예전엔 아무 데나 지은 첫 포토의 시각을
    // 봤는데, 그러면 제 본진에 방어 포토를 먼저 깔았다가 나중에 러시를 간 경기가 통째로
    // 빠지고(첫 포토는 이르지만 러시는 아니었다) 반대로 6분에 간 진짜 포토러시도 5분 30초
    // 문턱에 걸려 빠졌다(지적). inZone이 이미 6분 안쪽만 넘겨주므로 그걸 그대로 쓴다.
    const forward = inZone("enemy", "Photon Cannon", CANNON_RUSH_SEC);
    if (forward.length > 0) {
      out.push({
        key: "cannon-rush", ...foeAt(forward), weight: SNEAK_WEIGHT, at: firstOf(forward),
        who, p: { ...spotOf(forward) },
      });
    }
    if (u("Arbiter") >= 1 && hasTech(s, "Recall")) {
      out.push({
        // 아비터 리콜은 전황을 통째로 뒤집는 수다(요청) — 다른 견제와 같은 무게로 두면
        // 정작 판이 뒤집힌 대목이 요약에서 빠진다.
        key: "recall", weight: 15, at: firstU("Arbiter"),
        who,
      });
    }
    // 캐리어 — 저그의 목동(울트라), 테란의 배틀크루저와 같은 자리인데 프로토스만 비어
    // 있었다(지적: "중반 캐리어에 대한 내용이 없는듯"). 실제 리플레이에서 12분대에
    // 캐리어를 32기까지 모은 경기인데 요약 본문에 그 대목이 통째로 없었다 — 질럿을 125기
    // 뽑은 탓에 '파워 유닛'은 질럿이 가져갔고, 캐리어는 맺음말의 조합에만 이름이 남았다.
    //
    // 물량 유닛과 달리 캐리어는 몇 기냐보다 '언제 띄웠고 몇 기까지 모았나'가 이야기다.
    // 시점은 가장 크게 몰아 뽑은 묶음의 시작으로 둔다 — 첫 기로 잡으면 한 기 띄워 보고
    // 접은 경기와 구별이 안 된다.
    //
    // 수는 누계가 아니라 창 단위 최대(windowPeak)다 — 누계를 말하면 긴 경기에서 "캐리어를
    // 69기 뽑았다"가 되어 함대 규모로 읽힌다(지적). 문턱도 같은 값으로 재야 뜻이 맞는다:
    // 스무 분에 걸쳐 넷을 뽑은 것은 캐리어를 굴린 게 아니라 한두 기씩 갈아 넣은 것이다.
    const carriers = producedFrames(s, "Carrier", endFrame);
    const carrierPeak = windowPeak(carriers);
    if (carrierPeak >= CARRIER_MIN) {
      const burst = biggestBurst(carriers);
      out.push({
        key: "carrier", weight: 13, at: burst ? burst.from : firstU("Carrier"),
        who, p: { n: carrierPeak },
      });
    }
    if (dropped && u("Shuttle") >= 2 && u("Reaver") >= 3) {
      out.push({
        key: "shuttle-reaver", ...target, weight: 11, at: s.firstUnloadFrame,
        who,
      });
    } else if (dropped && u("Shuttle") >= 2 && u("High Templar") >= 4) {
      // 하이템플러 드랍(요청) — 셔틀에 템플러를 태워 일꾼을 지지는 그림. 리버 드랍과
      // 같은 셔틀 플레이지만 결과가 전혀 달라서 따로 말한다.
      out.push({
        key: "templar-drop", ...target, weight: 11, at: s.firstUnloadFrame,
        who,
      });
    } else if (dropped && u("Shuttle") >= 2) {
      out.push({
        key: "shuttle", ...target, weight: 6, at: s.firstUnloadFrame,
        who,
      });
    }
  }

  // ── 종족 공통(자리 기반) ── 어느 종족이든 '가운데를 먹었나'는 자리로만 알 수 있다.
  // 아군 기지에 포토를 깔아 주는 것도 팀을 위한 좋은 수다(요청) — 제 앞마당이 아니라
  // 남의 기지에 지었다는 게 자리로 드러나므로, 방어용 포토와 헷갈릴 일이 없다.
  const allyCannons = inZone("ally", "Photon Cannon");
  if (allyCannons.length >= ALLY_CANNON_MIN) {
    const helped = geo?.allyAt(allyCannons[0]) ?? null;
    out.push({
      key: "ally-cannon", weight: 11, at: firstOf(allyCannons), who,
      ...(helped ? { who2: helped } : {}), p: { n: allyCannons.length },
    });
  }
  // 판 전체에 건물을 흩뿌리며 버틴 그림(요청) — 자리를 내주고 도망 다니며 새로 짓기를
  // 반복한 경기다. 아래 센터 건물 이야기보다 이쪽이 훨씬 큰 그림이라 무게를 더 준다.
  if (
    geo && geo.spread.clusters >= SCATTER_CLUSTERS_MIN && geo.spread.far >= SCATTER_FAR_MIN
  ) {
    out.push({
      key: "scatter", weight: 14, who, at: geo.spread.at,
      p: { spots: geo.spread.clusters, far: geo.spread.far },
    });
  }
  const midCannons = inZone("mid", "Photon Cannon");
  if (midCannons.length >= 2) {
    // 무게 10 → 16(요청: "센터포토 가중치도 좀 높여야 될 듯, 너무 요약에 출현 빈도가 낮음").
    // 센터 포토는 자리로 확실히 잡히는 데다, 길목 하나로 판 전체가 갈리는 수라 이야기로서의
    // 값이 크다 — 다른 전술과 자리다툼에서 계속 밀려 요약에 거의 안 나왔다. scatter(14)보다
    // 조금 위에 둬서, 후반에 둘이 같이 걸리면 이쪽이 먼저 뽑히게 한다.
    out.push({ key: "center-photon", ...target, weight: 16, at: firstOf(midCannons), who, p: { n: midCannons.length } });
  } else {
    const mid = inZone("mid");
    if (mid.length >= 3) {
      // 무슨 건물을 지었는지까지 말한다(지적: 무슨 건물인지 모르겠음) — 가장 많이 세운 것 하나.
      const byKind = new Map<string, number>();
      for (const b of mid) byKind.set(b.unit, (byKind.get(b.unit) ?? 0) + 1);
      const top = [...byKind.entries()].sort((a, b) => b[1] - a[1])[0];
      out.push({
        key: "center", weight: 8, at: firstOf(mid), who,
        p: { n: mid.length, ...(top ? { b: top[0] } : {}) },
      });
    }
  }

  // ── 입구 방어(요청) ── 리플레이에 지형이 없어 램프 자체는 알 수 없다. 대신 '내 본진
  // 안이면서 상대 쪽으로 나가 있는 자리'는 진출로 쪽이고, 거기 박은 방어 건물은 뒤나 옆에
  // 세운 것과 뜻이 다르다. 한 채는 우연일 수 있어 두 채부터 말한다.
  const frontDef = (["Bunker", "Photon Cannon", "Sunken Colony"] as const).map((b) => ({
    b, at: atFront(b),
  })).filter((x) => x.at.length >= 2).sort((a, b) => b.at.length - a.at.length)[0];
  if (frontDef) {
    out.push({
      key: "front-defense", weight: 8, at: firstOf(frontDef.at), who,
      p: { b: frontDef.b, n: frontDef.at.length },
    });
  }

  // ── 셋방살이(요청) ── 내 기지에는 건물이 거의 없고 아군 기지에 얹혀 있는 것(지적).
  // 건물 하나가 아군 쪽에 있는 걸로는 부족하다 — 내 건물 덩어리 자체가 거기 앉아야 한다.
  if (geo?.lodgingHost) {
    out.push({
      key: "lodging", weight: 9, who, who2: geo.lodgingHost,
      at: firstOf(s.buildPositions),
      ...(geo.lodgingLost ? { p: { lost: true } } : {}),
    });
  }

  // ── 채팅(요청) ── GG 선언은 승부가 어디서 끝났는지 알려주는 유일한 '사람의 말'이다.
  // 오타·장난까지 잡으려 들면 오탐이 늘어서, 통용되는 항복 표현만 좁게 본다.
  // gg / ㅈㅈ / ww — 셋 다 같은 말이다(지적). ww는 한글 자판에서 ㅈㅈ을 영문 상태로 친 것이고,
  // ㅈㅈ은 그 반대다. ㅎㅎ은 웃음이라 넣지 않는다.
  const gg = s.chats.find((c) => /^\s*(g{2,}|w{2,}|ㅈ{2,}|지지|잘{1,2}했|잘하시네)/i.test(c.text));
  if (gg) {
    out.push({ key: "gg", weight: 6, at: gg.frame, who });
  }

  // 성큰러시와 저글링 러시는 다른 빌드다 — 자리로 확인된 성큰러시가 있으면 그게 진짜
  // 이야기이고, 같은 사람의 저글링 러시 판정은 그 빌드에 딸려 온 것이라 지운다(지적).
  if (out.some((t) => t.key === "sunken-rush")) {
    return out.filter((t) => t.key !== "zling-rush");
  }
  return out;
}

// '옆'이라고 부르려면 나머지 상대보다 이만큼은 가까워야 한다 — 셋 다 비슷한 거리면
// 누가 옆인지 말할 수 없다.
const NEIGHBOR_MARGIN = 1.3;
// 판이 끝나기 이만큼 전에 손을 놓았다면 먼저 정리된 것이다.
const FELL_EARLY_SEC = 2 * 60;

/** 팀전에서 내 옆에 붙은 상대가 먼저 나가떨어졌는가. 탱크 방어의 유일한 확실한 근거다 —
 *  탱크가 무엇을 잡았는지는 리플레이에 없고, '누가 가까웠고 누가 먼저 사라졌나'는 있다. */
function neighborOf(
  me: ParsedReplayPlayer,
  foes: ParsedReplayPlayer[],
  endFrame: number
): { raw: string; fellAt: number } | null {
  if (foes.length < 2) return null; // 1:1엔 '옆'이 없다
  // 누가 '내 옆'인지는 시작 자리가 정한다 — 경기 중에 옮겨 다닌 자취까지 섞으면 흐려진다.
  const home = startHomeOf(me);
  if (!home) return null;
  const ranked = foes
    .map((f) => ({ f, h: startHomeOf(f) }))
    .filter((x): x is { f: ParsedReplayPlayer; h: { x: number; y: number } } => x.h !== null)
    .map((x) => ({ f: x.f, d: dist(home, x.h) }))
    .sort((a, b) => a.d - b.d);
  if (ranked.length < 2) return null;
  if (!(ranked[1].d >= ranked[0].d * NEIGHBOR_MARGIN)) return null;
  const last = ranked[0].f.signals?.lastCmdFrame ?? null;
  if (last === null || sec(endFrame - last) < FELL_EARLY_SEC) return null;
  return { raw: ranked[0].f.rawName, fellAt: last };
}

export interface TacticScanInput {
  sidePlayers: ParsedReplayPlayer[];
  foePlayers: ParsedReplayPlayer[];
}

/** 한 편의 전술 목록 — 무게 큰 것부터, 같은 전술은 한 번만. */
export function scanTactics({ sidePlayers, foePlayers }: TacticScanInput): Tactic[] {
  const foeRaces = [...new Set(foePlayers.map((p) => p.race).filter(Boolean))];
  // 당한 쪽은 1:1에서만 확실하다 — 팀전에서 누구를 때렸는지는 커맨드만으로 알 수 없어서
  // 아예 말하지 않는다(요청: 불확실한 건 빼기).
  const soleFoe = foePlayers.length === 1 ? foePlayers[0].rawName : null;
  // 판이 끝난 시점 — 마지막까지 손을 놀린 사람의 마지막 커맨드. 여기서 한참 앞서 손을 놓은
  // 사람은 그 전에 죽었거나 나간 것이다.
  const endFrame = Math.max(
    0,
    ...[...sidePlayers, ...foePlayers].map((p) => p.signals?.lastCmdFrame ?? 0)
  );

  const all: Tactic[] = [];
  for (const p of sidePlayers) {
    if (!p.signals) continue;
    all.push(
      ...detectFor({
        rawName: p.rawName, s: p.signals, race: p.race, foeRaces, soleFoe,
        geo: geoOf(p, sidePlayers.filter((x) => x !== p), foePlayers),
        neighbor: neighborOf(p, foePlayers, endFrame),
        endFrame,
      })
    );
  }
  const seen = new Set<string>();
  return all
    .sort((a, b) => b.weight - a.weight)
    // gg는 사람마다 남긴다 — 팀원이 잇달아 친 걸 한 문장으로 묶으려면 전부 필요하다(요청).
    .filter((t) => {
      const key = t.key === "gg" ? `gg|${t.who}` : t.key;
      return seen.has(key) ? false : (seen.add(key), true);
    });
}
