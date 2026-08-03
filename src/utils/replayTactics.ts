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

// 입구막기(wall-in)로 볼 시간 창 — 입구막기는 앞을 잠가 놓고 그 뒤에서 크는 수다.
// 빠른무한처럼 처음부터 자원이 넘치는 판에서는 벽이 더 늦게, 더 두껍게 서기도 해서
// 초반만 보면 통째로 놓친다(요청: 빠른무한에서도 나오게).
const WALL_IN_SEC = 10 * 60;
/** 입구 쪽 건물이 몇 채부터 '막았다'인가 — 한 채는 우연, 둘부터가 벽이다. */
const WALL_IN_MIN = 2;
/** 그 안에 몇 종류가 섞여야 벽인가 — 이 값이 살림과 벽을 가르는 핵심이다.
 *  파일런만 여섯 채, 해처리만 다섯 채는 그냥 살림을 앞으로 늘린 것이고,
 *  게이트+포토·배럭+서플+벙커·해처리+성큰처럼 다른 종류가 붙어 있어야 벽이다. */
const WALL_KIND_MIN = 2;
/** 한 벽으로 볼 만큼 서로 붙어 있는 거리(타일) — 실제 입구막기는 두세 채가 맞닿아
 *  한 줄을 이룬다. 이보다 벌어지면 벽이 아니라 그냥 앞쪽에 지은 살림이다. */
const WALL_SPAN = 5;
/** 이보다 두꺼우면 벽이 아니라 건물 밭이다 — 게이트·파일런 열몇 채가 한 자리에 모인 것은
 *  입구를 막은 게 아니라 생산 단지를 앞쪽에 앉힌 것이다(실측: 13채, 11채, 10채). */
const WALL_MAX = 6;
/** 그 몇 채가 '한 번에' 올라간 것으로 볼 시간 — 벽은 잇달아 짓는다. 재는 기준은 묶음
 *  전체의 처음~끝이다(가운데 한 채 기준이 아니라). 가운데를 기준으로 재면 앞뒤로 각각
 *  이만큼씩 늘어져 실제로는 두 배 넘게 벌어진 묶음도 '한 번에'가 된다 — 실측: 5.6분
 *  엔지니어링 베이부터 10.0분 팩토리까지 4.4분에 걸쳐 지은 본진 건물들이 하나의 벽으로
 *  잡혔다(지적: "팩토리와 엔지니어링베이는 입구를 막은 게 아니라 그냥 본진에 지은 것"). */
const WALL_BURST_SEC = 180;
/** 막은 뒤에 늘린 본진 + 새로 올린 테크 건물이 몇부터 '발전했다'인가. */
const WALL_IN_GROW_MIN = 2;

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
  /** 문장 틀에 꽂히는 값(드론 수·게이트 수 등)과, 마법 좌표처럼 그림이 쓰는 값(xy).
   *  없으면 생략. */
  /** 문자열 목록도 실을 수 있다(물량 조합의 유닛 이름 등) — 저장 쪽(replaySummaryData의
   *  Beat)도 같은 모양이라 그대로 실려 나간다. */
  p?: Record<string, string | number | boolean | string[] | number[]>;
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
/** 확장(멀티) 건물 — 이게 서 있는 자리는 무조건 '내 기지'다(지적: 위치에 따라 본인
 *  기지인데 상대 스타팅포인트와 더 가까울 수도 있다). 시작 지점 하나만 기준으로 자리를
 *  가르면, 지형상 상대 시작점 쪽에 더 가까운 뒷문·구석 멀티에 지은 건물이 '상대 진영에
 *  몰래 지은 것'(성큰러시·포토러시·몰래배럭)으로 오판된다. 그래서 시작 지점뿐 아니라
 *  실제로 멀티를 편 자리도 전부 '내 기지'에 넣는다. */
const TOWN_HALLS = new Set(["Nexus", "Hatchery", "Command Center"]);
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
/** 째기는 초반에만 본다(요청: 중반에 째는 건 없다) — 중반 이후의 확장은 째는 것이 아니라
 *  판을 넓히는 정상적인 운영이다. 병력 없이 늘리기만 한 쪽도 같은 잣대로 끊는다. */
const GREEDY_MASS_SEC = GREEDY_BUILD_SEC;
/** 저그가 병력 건물(스포닝풀)도 없이 늘린 확장이 이만큼이면 째기 — 첫 본진을 뺀 수라
 *  2면 해처리 셋이다(요청). 다른 종족은 하나만 늘려도(생더블) 순서가 곧 증거다. */
const GREEDY_BARE_EXPANDS_Z = 2;
/** 병력 건물이 있는데도 째기로 보려면 늘린 본진이 이만큼은 돼야 한다 — 첫 본진을 뺀
 *  수라 4면 해처리 다섯이다(요청: 풀이 있어도 병력·성큰 없이 해처리 다섯이면 째기). */
const GREEDY_MIN_EXPANDS = 4;
/** 늘린 몫 하나당 이만큼의 병력(생산 명령 수)은 있어야 '막으면서 늘렸다'로 본다. */
const GREEDY_ARMY_PER_BASE = 2;
/** 방어탑 하나를 병력 몇 몫으로 셀지 — 성큰·포토·벙커는 병력을 대신한다. */
const GREEDY_DEF_WORTH = 2;
/** 방어탑으로 세는 건물. 성큰·스포어는 크립 콜로니로 지어지므로 그것도 함께 본다. */
const DEF_BUILDINGS = [
  "Creep Colony", "Sunken Colony", "Spore Colony", "Photon Cannon", "Bunker", "Missile Turret",
];
/** 병력으로 세지 않는 것 — 일꾼과 수송·정찰용, 그리고 알 단계. */
const PEACE_UNITS = new Set([
  "SCV", "Probe", "Drone", "Larva", "Egg", "Overlord", "Cocoon", "Mutalisk Cocoon", "Lurker Egg",
  "Shuttle", "Dropship", "Observer", "Science Vessel", "Medic",
]);

// 아군 기지에 이만큼은 깔아 줘야 '받쳐줬다'고 말할 수 있다 — 한 개는 지나가다 지은 것일 수 있다.
const ALLY_CANNON_MIN = 2;

/** 자리만으로 옆탱을 말하려면 탱크가 이만큼은 있어야 한다 — 한두 기를 옮긴 것은 옆탱이 아니다. */
/** 내린 자리를 찾을 때 언로드 시각에서 앞뒤로 보는 폭(프레임 ≒ 40초). */
const DROP_WINDOW_FRAMES = 40 / 0.042;
const SIDE_TANK_MIN = 5;
/** 그 자리로 이만큼은 몰아야 '세워 뒀다'고 본다 — 한두 번은 지나가며 찍은 것일 수 있다. */
const SIDE_TANK_ORDERS = 4;
/** 탱크를 세운 '한 지점'으로 묶는 반경(타일) — 자리를 잡고 나서도 조금씩 고쳐 앉으므로
 *  낱개 좌표가 아니라 몰린 덩어리의 가운데를 쓴다(요청: 옆탱한 지점을 정확히). */
const SIDE_TANK_SPOT_TILES = 6;

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
/* ── 물량(요청: "프로토스들의 질럿 드라군 물량 이야기도 없네") ──
   위 '파워 OO'는 한 유닛이 병력의 60%를 넘겨야 나온다. 그런데 실제로 사람들이 물량이라
   부르는 그림은 대개 두 유닛의 조합이다 — 실측한 판에서 질럿 521 + 드라군 504로 둘이
   합쳐 94%였는데, 각각은 48%·46%라 어느 쪽도 60%를 못 넘어 아무 이야기도 안 나왔다.

   총량이 아니라 '분당 몇 기'로 잰다. 35분 빠른무한과 12분 경기를 같은 자로 잴 수 없어서다.
   실측 열 판에서 분당 생산량은 대개 3~15기였고, 사람이 물량이라 부른 그 판의 두 사람만
   26·31기로 뚜렷이 떨어져 있었다 — 그 사이에 선을 긋는다. */
const MASS_RATE_MIN = 20;
/** 그래도 총량이 이만큼은 돼야 한다 — 짧은 경기의 한순간 폭발은 물량이 아니다. */
const MASS_TOTAL_MIN = 200;
/** 상위 두 유닛이 이만큼을 차지해야 "OO·OO 물량"이라 이름 붙여 부른다 — 그보다 흩어져
 *  있으면 조합이라 부를 게 없어 수만 말한다. */
const MASS_PAIR_SHARE = 0.7;
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
/** 러시라고 부르려면 그 뒤 RUSH_GO_SEC 안에 상대 진영에 이만큼은 찍혀야 한다(위 wentAt). */
const RUSH_GO_ORDERS = 12;
/** 러시는 뽑자마자 가는 수다 — 첫 병력이 나온 뒤 이 안에 안 갔으면 러시가 아니라 빌드다. */
const RUSH_GO_SEC = 180;

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
        // 일꾼·건물이 낸 명령(자원 캐기·랠리)은 '덮치러 갔다'의 근거가 못 된다
        // (파서가 orderPositions.by로 짚어 준다).
        if (o.by === "Worker" || o.by === "Building") continue;
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
  /** 건물 자리뿐 아니라 마법·이동 명령 좌표도 넘길 수 있게 좌표만 받는다. */
  enemyAt: (b: { x: number; y: number }) => string | null;
  /** 내 본진 안이면서 상대 쪽으로 나가 있는 자리인가 = 진출로(입구) 쪽. */
  front: (b: BuildPos) => boolean;
  /** 그 자리를 사람이 부르는 이름 — 내 기지/입구, 아군 기지/입구, 상대 본진/입구 앞, 센터. */
  /** 건물 자리뿐 아니라 명령 좌표(옆탱 판정)도 넘길 수 있게 좌표만 받는다. */
  spot: (b: { x: number; y: number }) => BuildSpot;
  /** 아군 기지의 진출로(allyFront)라면 그 아군과, 그 진출로가 향하고 있는 상대.
   *  spot()이 "allyFront"를 가르는 데 이미 이 둘을 쓰고 있는데, 밖에서는 "아군 앞"이라는
   *  사실만 받고 누구의 앞인지·어느 쪽을 보고 선 앞인지는 못 봤다 — 옆탱은 그 둘이 곧
   *  이야기라(지적: "브래드가 군범 기지에서 7시를 옆탱으로 견제") 여기서 함께 돌려준다. */
  allyFrontOf: (b: { x: number; y: number }) => { ally: string; foe: string | null } | null;
  /** 내 살림이 아군 기지에 얹혀 있으면 그 아군(지적: 내 기지에 건물이 거의 없고 아군
   *  기지에 있는 게 셋방살이다). 아니면 null. */
  lodgingHost: string | null;
  /** 그중에서도 '시작 자리를 두고 옮겨온' 경우 — 본진을 잃은 그림이라 문장이 달라진다. */
  lodgingLost: boolean;
}

function geoOf(
  me: ParsedReplayPlayer,
  allies: ParsedReplayPlayer[],
  foes: ParsedReplayPlayer[],
  /** 맵의 모든 시작 지점(타일) — 센터를 재는 기준(요청). */
  startSpots?: [number, number][],
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

  // 맵 가운데 — 맵에 있는 '모든' 시작 지점의 가운데다(요청: 실제로 안 나왔더라도 모든 스타팅
  // 포인트의 중심으로). 참가자 자리만 쓰면 한쪽에 쏠린 판에서 가운데가 그쪽으로 끌려간다
  // (실측: 다섯 명 중 셋이 왼쪽인 경기에서 (53,51)). 시작 지점을 못 읽은 리플레이에서는
  // 참가자 자리의 테두리 가운데로 물러선다 — 평균보다는 쏠림에 덜 흔들린다.
  const seatHomes = [home, ...allyHomes.map((a) => a.h), ...foeHomes];
  const allHomes = (startSpots ?? []).length >= 2
    ? (startSpots as [number, number][]).map(([x, y]) => ({ x, y }))
    : seatHomes;
  const mapMid = {
    x: (Math.min(...allHomes.map((h) => h.x)) + Math.max(...allHomes.map((h) => h.x))) / 2,
    y: (Math.min(...allHomes.map((h) => h.y)) + Math.max(...allHomes.map((h) => h.y))) / 2,
  };
  const ring = allHomes.reduce((n, h) => n + dist(h, mapMid), 0) / allHomes.length;
  /** 정말 맵 가운데인가 — 가운데에 가깝고, 어느 본진에서도 충분히 멀어야 한다(위 주석).
   *  본진·아군기지·상대기지 판정 뒤에만 쓴다. */
  const atMapMid = (b: { x: number; y: number }): boolean => {
    if (!(ring > 0)) return false;
    if (dist(b, mapMid) >= ring * MID_MAP_RATIO) return false;
    // 멀리 떨어져 있어야 한다는 조건은 '실제로 앉은 자리'로만 본다 — 빈 시작 지점은 그 판에
    // 아무도 없던 곳이라 거기서 멀 이유가 없다.
    return seatHomes.every((h) => dist(b, h) > ring * MID_AWAY_RATIO);
  };

  // 내가 실제로 지은 확장(멀티) 건물 자리 — 위 TOWN_HALLS 주석대로, 시작 지점 하나만으로
  // '내 기지'를 가르면 상대 쪽에 더 가까운 멀티가 몰래러시로 오판된다. 그 건물이 서 있는
  // 자리 자체를 '내 기지'로 더해 둔다(집을 늘려 가며 옮긴 이사와는 다르다 — 이사는
  // relocations()가 시간순으로 따로 판정한다).
  const myBases = [home, ...(me.signals?.buildPositions ?? [])
    .filter((b) => TOWN_HALLS.has(b.unit))
    .map((b) => ({ x: b.x, y: b.y }))];
  const nearMyBase = (b: { x: number; y: number }): boolean => myBases.some((h) => dist(b, h) < base * HOME_RADIUS);

  const enemyAt = (b: { x: number; y: number }): string | null => {
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
    // 내 멀티부터 먼저 본다 — 상대 진영 판정보다 앞서야 한다(위 myBases 주석).
    if (nearMyBase(b)) return "home";
    const toFoe = Math.min(...foeHomes.map((h) => dist(b, h)));
    if (toFoe < base * ENEMY_RADIUS) return "enemy";
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
  const front = (b: { x: number; y: number }): boolean => {
    const v = { x: b.x - home.x, y: b.y - home.y };
    const len = Math.hypot(v.x, v.y);
    if (len < base * FRONT_MIN) return false;      // 본진 한복판이면 앞이 아니다
    if (len > base * HOME_RADIUS) return false;    // 너무 멀면 그건 본진 밖이다
    return (v.x * dir.x + v.y * dir.y) / len > FRONT_COS;
  };

  /** origin 기지 안이면서 target 쪽으로 나가 있는 자리인가 — front를 임의의 기지에
   *  대해 쓸 수 있게 일반화한 것이다(아군 입구·상대 입구 앞을 같은 자로 재려면 필요하다). */
  const towardFront = (
    origin: { x: number; y: number }, target: { x: number; y: number },
    b: { x: number; y: number }, radius: number,
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
  const spot = (b: { x: number; y: number }): BuildSpot => {
    // 내 멀티부터 먼저 본다 — 상대 진영 판정보다 앞서야 한다(위 myBases 주석).
    if (nearMyBase(b)) return front(b) ? "myFront" : "myBase";
    // 상대 진영이 다음이다 — 남의 기지에 지은 건물은 무엇보다 그 사실이 중요하다.
    let nearFoe: { h: { x: number; y: number }; d: number } | null = null;
    for (const h of foeHomes) {
      const d = dist(b, h);
      if (!nearFoe || d < nearFoe.d) nearFoe = { h, d };
    }
    if (nearFoe && nearFoe.d < base * ENEMY_RADIUS) {
      // 그 상대 기지에서 볼 때 '내 쪽으로 나와 있는' 자리 = 그 사람의 입구 앞.
      return towardFront(nearFoe.h, home, b, ENEMY_RADIUS) ? "enemyFront" : "enemyBase";
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

  /** 아군 진출로면 그 아군과 그 앞이 향한 상대 — 위 spot()의 allyFront 갈래와 같은 계산이다
   *  (거기서는 판정 결과만 쓰고 누구의 앞인지는 버린다). */
  const allyFrontOf = (b: { x: number; y: number }): { ally: string; foe: string | null } | null => {
    if (spot(b) !== "allyFront") return null;
    const a = allyHomes.find((x) => dist(b, x.h) < base * HOME_RADIUS);
    if (!a) return null;
    const foe = foeHomeOf.length > 0
      ? foeHomeOf.reduce((x, y) => (dist(a.h, y.h) < dist(a.h, x.h) ? y : x)).raw : null;
    return { ally: a.raw, foe };
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

  // (삭제) 건물이 몇 군데에 흩어졌나(spread) — scatter 전술만 쓰던 값이라 함께 걷어냈다.
  return { zone, allyAt, enemyAt, front, spot, allyFrontOf, lodgingHost, lodgingLost };
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
  // 한 종류만 주야장천 뽑았나 — 그러면 이겼더라도 '일편단심'이라 부를 수 있다(지적: 무지성
  // 같은 부정적 어휘 대신 긍정적인 어휘를 쓴다).
  const army = Object.entries(s.unitCounts).filter(([u]) => !SOLO_EXCLUDE.has(u));
  const armyTotal = army.reduce((acc, [, n]) => acc + n, 0);
  const topArmy = army.map(([, n]) => n).sort((a, b) => b - a)[0] ?? 0;
  const solo = armyTotal >= 12 && topArmy / armyTotal >= 0.8;
  /** 드랍은 수송선을 뽑은 것만으로는 알 수 없다 — 실제로 내린 커맨드가 있어야 드랍이다. */
  const dropped = s.unloadCount >= 2;
  /** 그 무렵 실제로 상대 진영까지 병력을 몰고 갔나(지적: 3게이트를 갔지만 공격으로 안
   *  이어진 경기도 "3게이트 질럿 러시를 했다"로 나온다).
   *
   *  러시의 근거는 빌드가 아니라 '갔다'는 사실이다. 게이트 셋을 세우고 질럿을 뽑는 것까지는
   *  누구나 하는 빌드고, 그걸 들고 상대 집까지 갔을 때만 러시다. 리플레이에는 전투가 안
   *  남지만 병력을 어디로 보냈는지는 명령에 그대로 남으므로(orderPositions) 그것으로 잰다.
   *  정찰 일꾼도 상대 본진에 가지만 그건 몇 번으로 끝난다 — 싸우러 간 쪽은 컨트롤하느라
   *  훨씬 많이 찍는다(pushersOn의 PUSH_ORDER_MIN과 같은 생각).
   *
   *  좌표를 못 읽는 리플레이(geo 없음)에서는 예전처럼 빌드만으로 통과시킨다 — 여기서 막으면
   *  그런 판은 러시가 통째로 사라진다. */
  const wentAt = (from: number | null, withinSec: number): boolean => {
    if (!geo) return true;
    if (from === null) return false;
    const to = from + withinSec / SECONDS_PER_FRAME;
    let n = 0;
    for (const o of s.orderPositions) {
      if (o.frame < from || o.frame > to) continue;
      if (geo.enemyAt(o) === null) continue;
      n += 1;
      if (n >= RUSH_GO_ORDERS) return true;
    }
    return false;
  };
  /** 그 구역에 지은 건물들(좌표를 못 읽으면 항상 빈 배열). */
  /** 그 마법을 실제로 쓴 지점 — 리플레이에 그대로 적힌 좌표라, 명령 뭉치를 어림하는
   *  것과 비교가 안 되게 정확하다(요청: 유닛 특정 로직을 다른 기술로 넓히면 요약이 정확해
   *  진다). 쓴 적이 없으면 null.
   *
   *  여러 번 썼으면 '상대 진영에 떨어진' 것을 고른다(지적: 리콜인데 화살표가 내 기지
   *  쪽이다) — 예전엔 무조건 첫 시전을 썼는데, 실측한 팀전에서 리콜 셋이 모두 제 본진에서
   *  33타일(본진 사이 거리의 0.57배)인 제 쪽 빈 땅이었는데도 그 첫 좌표가 "타센에게 큰
   *  타격을 줬다"는 문장의 화살표가 됐다. 상대 진영에 떨어진 것이 없으면 첫 시전을 그대로
   *  쓰되, 그때는 누구를 친 것인지 말할 근거가 없으므로 whom을 남기지 않는다. */
  const castAt = (
    tech: string,
  ): { frame: number; xy: [number, number]; whom?: string } | null => {
    const hits = (s.castPositions ?? [])
      .filter((c) => c.tech === tech)
      .sort((a, b) => a.frame - b.frame);
    if (hits.length === 0) return null;
    const owned = geo
      ? hits.map((c) => ({ c, whom: geo.enemyAt(c) })).find((x) => x.whom !== null)
      : undefined;
    const hit = owned?.c ?? hits[0];
    return {
      frame: hit.frame, xy: [hit.x, hit.y],
      ...(owned?.whom ? { whom: owned.whom } : {}),
    };
  };

  /** 수송선을 어디로 몰고 갔나 — 내린 순간(firstUnloadFrame) 언저리에 수송선에게 내린
   *  이동 명령의 좌표다(요청: 유닛 특정을 살려 드랍 지점을 정확히). 언로드 커맨드 자체에는
   *  좌표가 없어서, 그 직전에 수송선을 어디로 보냈나가 곧 내린 자리다. 집 근처(태우러 간
   *  것)는 빼고 가장 가까운 시각의 것을 고른다.
   *
   *  그중에서도 '누군가의 진영에 들어간' 것을 먼저 고른다 — 그 진영의 주인이 곧 드랍을
   *  맞은 사람이다(요청: 자막과 화살표가 같은 곳을 가리켜야 한다). 팀전에서는 이 값이
   *  없으면 누구에게 내렸는지를 말할 길이 아예 없다. */
  const dropSpot = (): { xy: [number, number]; whom?: string } | null => {
    const unload = s.firstUnloadFrame;
    if (unload === null || !geo) return null;
    const near = (s.orderPositions ?? [])
      .filter((o) => o.by === "Transport" && Math.abs(o.frame - unload) <= DROP_WINDOW_FRAMES)
      // 태우러 집에 들른 것은 뺀다 — 내 기지 안에서 내리는 드랍은 없다.
      .filter((o) => { const sp = geo.spot(o); return sp !== "myBase" && sp !== "myFront"; })
      .sort((a, b) => Math.abs(a.frame - unload) - Math.abs(b.frame - unload));
    if (near.length === 0) return null;
    const owned = near.map((o) => ({ o, whom: geo.enemyAt(o) })).find((x) => x.whom !== null);
    const pick = owned?.o ?? near[0];
    return { xy: [pick.x, pick.y], ...(owned?.whom ? { whom: owned.whom } : {}) };
  };

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
  /** 그 묶음이 '다 갖춰진' 때 — 마지막 한 채가 올라간 프레임.
   *
   *  "포토 13개로 막아 세웠다"처럼 개수를 말하는 이야기는 첫 채가 아니라 그 개수가 된 때를
   *  시점으로 잡아야 한다. 예전엔 첫 채의 프레임을 썼는데, 그러면 같은 화면에서 "3분 30초에
   *  포토 13개로 막아 세웠다"와 "포토 2개뿐인 상태에서 크게 당했다"가 나란히 나왔다(실측한
   *  리플레이에서 그대로 나왔다) — 3분 30초에는 실제로 두 채뿐이었으니 앞 문장이 거짓이다.
   *  러시(포토러시·성큰러시)는 반대로 언제 시작했나가 곧 이야기라 그대로 firstOf를 쓴다. */
  const lastOf = (b: BuildPos[]): number | null => {
    const f = b.map((x) => x.frame).filter((x): x is number => x !== null);
    return f.length > 0 ? Math.max(...f) : null;
  };

  // 째기의 기준은 하나다 — 병력과 방어탑에 견줘 본진(가장 중요)이나 생산건물을 늘렸나(요청).
  // 저그는 원래 해처리를 여러 개 가는 종족이라, 수만 세면 정상적인 운영이 죄다 째기가 된다
  // (지적: 너무 째기가 잘 나온다). 그래서 두 갈래로만 본다.
  //  ① 병력 건물도 없이 늘렸을 때 — 저그는 스포닝풀 없이 해처리 셋, 프로토스·테란은
  //     게이트·배럭 없는 더블. 순서 자체가 증거다.
  //  ② 병력 건물은 있어도 병력도 방어탑도 없이 늘리기만 했을 때 — 늘린 수에 견줘 본다.
  {
    const base = race === "저그" ? "Hatchery" : race === "프로토스" ? "Nexus" : "Command Center";
    const military = race === "저그" ? "Spawning Pool" : race === "프로토스" ? "Gateway" : "Barracks";
    const prod = race === "저그" ? [] : race === "프로토스"
      ? ["Gateway", "Robotics Facility", "Stargate"] : ["Barracks", "Factory", "Starport"];
    const before = (b: string, f: number) => (s.buildingFrames[b] ?? []).filter((x) => x < f).length;
    /** 그때까지 갖춘 방어력 — 뽑은 병력에 방어탑을 몇 몫으로 얹어 센다. */
    const guarded = (f: number) => {
      const troops = Object.entries(s.unitFrames)
        .filter(([n]) => !PEACE_UNITS.has(n))
        .reduce((n, [, fs]) => n + fs.filter((x) => x < f).length, 0);
      return troops + DEF_BUILDINGS.reduce((n, b) => n + before(b, f), 0) * GREEDY_DEF_WORTH;
    };
    /** 그때까지 늘린 정도 — 본진이 가장 무겁고 생산 건물은 절반 몫이다(요청). */
    const grown = (f: number, i: number) =>
      i + 1 + Math.max(0, prod.reduce((n, b) => n + before(b, f), 0) - 1) * 0.5;

    // 병력 건물이 아예 안 보이는 기록은 '늦게 지었다'가 아니라 '기록이 없다'로 봐야 한다 —
    // 그걸 째기로 세면 커맨드만 늘린 판이 죄다 째기가 된다.
    const milFrame = firstB(military);
    const expands = [...(s.buildingFrames[base] ?? [])].sort((a, b) => a - b);
    const bareFrom = race === "저그" ? GREEDY_BARE_EXPANDS_Z : 1;
    const greedy = expands.find((f, i) => {
      if (milFrame !== null && milFrame > f) return i + 1 >= bareFrom && sec(f) < GREEDY_BUILD_SEC;
      return i + 1 >= GREEDY_MIN_EXPANDS
        && sec(f) < GREEDY_MASS_SEC
        && guarded(f) < grown(f, i) * GREEDY_ARMY_PER_BASE;
    }) ?? null;
    if (greedy !== null) {
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
    const mc = castAt("Mind Control");
    out.push({
      key: "mind-control", weight: 16,
      ...(mc?.whom ? { whom: mc.whom } : {}),
      at: firstU([...WORKER_OF].find(([, r]) => r === foreign[0])?.[0] ?? "") ?? null,
      who, p: { race: foreign[0], ...(mc ? { xy: mc.xy } : {}) },
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
  /* 물량 — 한 유닛에 쏠리지 않아도 '분당 몇 기를 찍어냈나' 자체가 이야기다(요청, 위
     MASS_RATE_MIN 주석). 위 '파워 OO'가 이미 나왔으면 안 낸다: 같은 물량을 두 번 말하는
     꼴이고, 그쪽이 더 구체적이다. */
  if (!out.some((t) => t.key === "power-unit")) {
    const mins = sec(endFrame) / 60;
    const rate = mins > 0 ? armyTotal / mins : 0;
    if (armyTotal >= MASS_TOTAL_MIN && rate >= MASS_RATE_MIN) {
      const top = [...army].sort((a, b) => b[1] - a[1]).slice(0, 2);
      const pair = top.length === 2 && (top[0][1] + top[1][1]) / armyTotal >= MASS_PAIR_SHARE
        ? top : null;
      /* 시점은 그 병력을 절반쯤 뽑았을 때 — 물량이 한창 쏟아지던 무렵이다. power-unit처럼
         '가장 몰아 뽑은 묶음'을 쓰면 안 된다: 경기 내내 쉼 없이 뽑는 그림이라 가장 빽빽한
         한 토막은 초반 질럿 연타 같은 데 걸린다(실측: 35분 경기인데 1.7분으로 찍혔다).
         시점을 아예 안 두면 문장이 맺음말 바로 앞으로 밀린다. */
      const frames = (pair ?? top).flatMap(([unit]) => s.unitFrames[unit] ?? []).sort((a, b) => a - b);
      const mid = frames.length > 0 ? frames[Math.floor(frames.length / 2)] : null;
      out.push({
        key: "mass-army", weight: 12, at: mid, who,
        p: {
          n: armyTotal, rate: Math.round(rate),
          ...(pair ? { units: pair.map(([unit]) => unit), ns: pair.map(([, n]) => n) } : {}),
        },
      });
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
      if (drones >= 7 && drones <= 14 && wentAt(ling, RUSH_GO_SEC)) {
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
      const at = dropSpot();
      out.push({
        key: "zerg-drop", ...target, ...(at?.whom ? { whom: at.whom } : {}), weight: 11,
        at: s.firstUnloadFrame,
        who, p: { lurker: u("Lurker") >= 3, ...(at ? { xy: at.xy } : {}) },
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
        key: "nydus",
        ...(intoFoe ? into : target),
        // 제 진영 안에만 뚫은 커널은 이야깃거리가 아니라 살림 도구다 — 병력을 실어 나르는
        // 길일 뿐이라 "커널을 뚫었다"만 덩그러니 나오면 읽는 사람에게 아무 뜻이 없다(실측:
        // 한 경기에 커널 문장이 둘 나왔는데 뒤엣것이 그런 커널이었다). 지우지는 않고
        // 무게만 낮춰, 할 이야기가 그것뿐일 때만 나오게 한다.
        weight: intoFoe ? 12 : 5,
        at: (intoFoe ? firstOf(intoSpots) : null) ?? s.firstBuildingFrame["Nydus Canal"] ?? null,
        // 상대 진영에 뚫은 문의 자리 — 그게 곧 병력이 나온 곳이다(지적: 커널의 자막과 실제
        // 도착 위치가 달랐다). 그 사람 본진 한복판보다 정확하다.
        who, p: { intoFoe, ...(intoFoe && intoSpots.length > 0
          ? { xy: [intoSpots[0].x, intoSpots[0].y] as [number, number] } : {}) },
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
      const inf = castAt("Infestation");
      out.push({
        key: "infested", ...target, ...(inf?.whom ? { whom: inf.whom } : {}), weight: 16,
        at: firstU("Infested Terran"), who,
        p: { n: u("Infested Terran"), ...(inf ? { xy: inf.xy } : {}) },
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
    /** 탱크를 세워 둔 자리 — '내 기지(또는 아군 기지) 안이면서 상대 쪽 가장자리'로 탱크를
     *  옮긴 시점(요청: 옆탱은 탱크를 이동시킨 위치 기준이다).
     *
     *  어떤 유닛에게 내린 명령인지는 파서가 짚어 준다(replayParser의 orderPositions.by) —
     *  시즈/언시즈를 누른 순간 골라져 있던 유닛 번호가 곧 탱크라서, 그 번호를 고른 채 내린
     *  이동 명령만 추린다. 탱크는 한 번 자리를 잡으면 눌러앉으므로 같은 자리에 여러 번
     *  찍힌다 — 그만큼 몰렸을 때만 '세워 뒀다'고 말한다. */
    const tankPark = (() => {
      if (!geo || tanks < SIDE_TANK_MIN) return null;
      const tankOrders = (s.orderPositions ?? []).filter((o) => o.by === "Siege Tank");
      /** 그 자리들 중 가장 붐빈 한 점 — 탱크를 세운 지점을 그대로 찍어야지, 본진 한가운데를
       *  가리키면 옆탱이라는 말이 무색해진다(요청: 옆탱한 지점을 정확히). */
      const busiest = (parked: typeof tankOrders) => {
        if (parked.length < SIDE_TANK_ORDERS) return null;
        const seed = parked.reduce((best, o) => {
          const n = parked.filter((x) => dist(x, o) <= SIDE_TANK_SPOT_TILES).length;
          return n > best.n ? { o, n } : best;
        }, { o: parked[0], n: 0 });
        const near = parked.filter((x) => dist(x, seed.o) <= SIDE_TANK_SPOT_TILES);
        return {
          frame: Math.min(...near.map((o) => o.frame)),
          xy: [
            near.reduce((a, o) => a + o.x, 0) / near.length,
            near.reduce((a, o) => a + o.y, 0) / near.length,
          ] as [number, number],
        };
      };
      /* 아군 진출로에 세운 것을 먼저 본다(지적: "브래드가 군범 기지에서 7시를 옆탱으로
         견제"한 내용이 없다). 예전에는 내 앞이든 아군 앞이든 한 자루에 담아 가장 붐빈
         한 점만 골랐는데, 그러면 내 앞의 명령이 조금이라도 많으면 아군 쪽 이야기가 통째로
         사라진다 — 실측한 그 판에서 내 앞 16건 대 아군 앞 14건으로 갈렸고, 정작 사람이
         기억하는 장면은 아군 쪽이었다. 남의 집 앞까지 탱크를 끌고 가 지켜 주는 것이
         제 앞을 잠그는 것보다 훨씬 눈에 띄는 일이라, 수가 비슷하면 그쪽을 말한다. */
      const ally = busiest(tankOrders.filter((o) => geo.spot(o) === "allyFront"));
      if (ally) {
        const at = geo.allyFrontOf({ x: ally.xy[0], y: ally.xy[1] });
        if (at) return { ...ally, ally: at.ally, foe: at.foe };
      }
      const mine = busiest(tankOrders.filter((o) => geo.spot(o) === "myFront"));
      return mine ? { ...mine, ally: null as string | null, foe: null as string | null } : null;
    })();
    if (sideFactory.length > 0 && tanks >= 3) {
      const helped = geo?.allyAt(sideFactory[0]) ?? null;
      out.push({
        key: "side-tank", weight: 11, at: firstOf(sideFactory), who,
        ...(helped ? { who2: helped } : {}), p: { at: "ally" },
      });
    } else if (tankPark !== null) {
      // 옆탱은 팩토리를 어디에 지었나가 아니라 탱크를 어디로 옮겼나로 가른다(지적).
      out.push({
        key: "side-tank", weight: tankPark.ally ? 12 : 11, at: tankPark.frame, who,
        // 아군 앞이면 누구의 앞인지·어느 쪽을 보고 선 앞인지가 곧 그 이야기다(지적).
        ...(tankPark.ally ? { who2: tankPark.ally } : {}),
        ...(tankPark.foe ? { whom: tankPark.foe } : {}),
        p: { at: tankPark.ally ? "allyFront" : "front", xy: tankPark.xy },
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
      const at = dropSpot();
      out.push({
        key: "dropship", ...target, ...(at?.whom ? { whom: at.whom } : {}),
        weight: 7, at: s.firstUnloadFrame,
        who, ...(at ? { p: { xy: at.xy } } : {}),
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
      if (gates >= 2 && wentAt(zealot, RUSH_GO_SEC)) {
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
    const recall = castAt("Recall");
    if (u("Arbiter") >= 1 && hasTech(s, "Recall")) {
      out.push({
        // 아비터 리콜은 전황을 통째로 뒤집는 수다(요청) — 다른 견제와 같은 무게로 두면
        // 정작 판이 뒤집힌 대목이 요약에서 빠진다.
        key: "recall", weight: 15,
        // 누구한테 떨어뜨린 리콜인지는 그 좌표가 말해 준다 — 상대 진영 밖에서 쓴 리콜은
        // 병력을 모으려고 부른 것이라 '누구를 쳤다'고 말하지 않는다(1:1이면 상대가 하나뿐).
        ...(recall?.whom ? { whom: recall.whom } : target),
        // 리콜은 아비터가 나온 때가 아니라 실제로 리콜을 쓴 때·자리다(지적: 리콜 화살표가
        // 자기 기지를 가리킨다) — 마법 좌표가 있으면 그것부터 쓴다.
        at: recall?.frame ?? firstU("Arbiter"),
        who, ...(recall ? { p: { xy: recall.xy } } : {}),
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
    const shuttleAt = dropped && u("Shuttle") >= 2 ? dropSpot() : null;
    const shuttleWhom = shuttleAt?.whom ? { whom: shuttleAt.whom } : {};
    const shuttleP = shuttleAt ? { p: { xy: shuttleAt.xy } } : {};
    if (dropped && u("Shuttle") >= 2 && u("Reaver") >= 3) {
      out.push({
        key: "shuttle-reaver", ...target, ...shuttleWhom, weight: 11,
        at: s.firstUnloadFrame, who, ...shuttleP,
      });
    } else if (dropped && u("Shuttle") >= 2 && u("High Templar") >= 4) {
      // 하이템플러 드랍(요청) — 셔틀에 템플러를 태워 일꾼을 지지는 그림. 리버 드랍과
      // 같은 셔틀 플레이지만 결과가 전혀 달라서 따로 말한다.
      out.push({
        key: "templar-drop", ...target, ...shuttleWhom, weight: 11,
        at: s.firstUnloadFrame, who, ...shuttleP,
      });
    } else if (dropped && u("Shuttle") >= 2) {
      out.push({
        key: "shuttle", ...target, ...shuttleWhom, weight: 6,
        at: s.firstUnloadFrame, who, ...shuttleP,
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
      key: "ally-cannon", weight: 11, at: lastOf(allyCannons), who,
      ...(helped ? { who2: helped } : {}), p: { n: allyCannons.length },
    });
  }
  /* (삭제) "이곳저곳에 건물을 벌려 지으며 버텼다" — 건물이 몇 군데에 흩어졌나만 세는
     이야기였다. 그 군데들이 제 본진 안인지, 센터에 박은 포토인지, 정말 쫓겨 다니며 새로
     지은 자리인지를 좌표만으로는 못 가른다(지적: 본진 안인 것 같기도 하고 센터 포토
     같기도 하고 부정확하고 의미없다). 게다가 빠른무한 같은 판에서는 원래 다들 맵 곳곳에
     짓는다 — 이사 판정이 헛돌던 것과 같은 이유다. 무게를 낮춰 두는 것으로는 부족했다:
     낮춰 놔도 할 얘기가 적은 경기에서는 결국 자리를 차지했다. */
  /* 센터에 박은 방어 건물 — 포토뿐 아니라 성큰·터렛도 같은 수다(요청: 터렛도 포토·성큰처럼
     맥락 적용). 어느 것으로 박든 '다투는 땅에 자리를 잡아 길을 잠갔다'는 이야기가 같아서,
     예전처럼 포토만 보면 같은 수를 저그·테란이 냈을 때만 통째로 안 나왔다. 가장 많이 세운
     것 하나로 말한다 — 무엇으로 잠갔는지는 문장이 p.b로 부른다. */
  const midGuard = (["Photon Cannon", "Sunken Colony", "Missile Turret"] as const)
    .map((b) => ({ b, at: inZone("mid", b) }))
    .filter((x) => x.at.length >= 2)
    .sort((a, b) => b.at.length - a.at.length)[0];
  if (midGuard) {
    // 무게 10 → 16(요청: "센터포토 가중치도 좀 높여야 될 듯, 너무 요약에 출현 빈도가 낮음").
    // 센터 포토는 자리로 확실히 잡히는 데다, 길목 하나로 판 전체가 갈리는 수라 이야기로서의
    // 값이 크다 — 다른 전술과 자리다툼에서 계속 밀려 요약에 거의 안 나왔다.
    out.push({
      key: "center-photon", ...target, weight: 16, at: lastOf(midGuard.at), who,
      p: { n: midGuard.at.length, b: midGuard.b },
    });
  } else {
    const mid = inZone("mid");
    if (mid.length >= 3) {
      // 무슨 건물을 지었는지까지 말한다(지적: 무슨 건물인지 모르겠음) — 가장 많이 세운 것 하나.
      const byKind = new Map<string, number>();
      for (const b of mid) byKind.set(b.unit, (byKind.get(b.unit) ?? 0) + 1);
      const top = [...byKind.entries()].sort((a, b) => b[1] - a[1])[0];
      out.push({
        key: "center", weight: 8, at: lastOf(mid), who,
        p: { n: mid.length, ...(top ? { b: top[0] } : {}) },
      });
    }
  }

  /* ── 입구 막고 발전하기(요청: "본진 입구를 막고 발전한거도 좋은 묘사 포인트임") ──
     아래 front-defense가 '입구에 방어탑을 세운' 이야기라면, 이건 건물로 길 자체를
     틀어막은 이야기다. 그리고 실제로 사람들이 막는 방식은 살림 건물 하나로만이 아니다
     (지적): 테란은 배럭·서플에 벙커를 얹고, 프로토스는 게이트웨이에 포토를, 저그는
     해처리에 성큰을 붙여 막는다. 그래서 살림 건물과 방어 건물을 함께 본다.

     자리로만 보면 오탐이 아주 쉽다 — 리플레이에 지형이 없어 램프가 어디인지 모르는데,
     원래 본진 건물은 다 본진 안에 있고 그중 상대 쪽에 치우친 것이 몇 채 되는 일은 흔하다.
     실측한 아홉 판(대부분 빠른무한)에서 '앞쪽 건물'은 사람마다 열 채씩 잡혔는데, 그건
     파일런을 한 줄로 죽 늘어놓은 것이지 벽이 아니었다.

     그 둘을 가르는 진짜 열쇠가 '섞임'이다(요청이 알려 준 것): 파일런만 여섯 채, 해처리만
     다섯 채는 살림이고, 게이트+포토·배럭+서플+벙커·해처리+성큰처럼 **다른 종류가 섞여**
     한 자리에 붙어 있는 것이 벽이다. 한 종류만으로는 벽이라 부르지 않는다.
     여기에 자리(붙어 있나)·시각(잇달아 세웠나)·발전(그러고 나서 컸나)을 함께 본다. */
  const wallIn = ((): { at: number; n: number; kinds: string[] } | null => {
    /* 벽을 이룰 수 있는 건물만 본다 — 사람이 실제로 길을 막는 데 쓰는 것들이다(요청이
       그대로 알려 줬다: "테란 배럭과 서플 벙커로 입구 막거나 프로토스 게이트웨이나 포토로
       막기 저그도 해처리와 성큰으로"). 테란에서 엔지니어링 베이·팩토리를 뺐다 — 그 둘은
       길을 막는 물건이 아니라 본진 아무 데나 서는 테크·생산 건물이고, 실제로 그 둘 때문에
       평범한 본진 살림이 벽으로 잡혔다(지적). 팩토리는 애초에 아래 '막고 나서 컸나'를
       재는 테크 목록에도 들어 있어, 벽이면서 동시에 벽 뒤의 발전이라는 앞뒤가 안 맞는
       자리였다. 터렛도 뺀다 — 대공·탐지용이라 길을 막는 데는 쓰지 않는다(입구에 세운
       터렛 이야기는 아래 front-defense가 따로 맡는다). */
    const live = race === "저그"
      ? ["Hatchery", "Evolution Chamber", "Spawning Pool"]
      : race === "프로토스"
        ? ["Pylon", "Gateway", "Forge"]
        : ["Supply Depot", "Barracks"];
    const guard = race === "저그"
      ? ["Sunken Colony", "Creep Colony", "Spore Colony"]
      : race === "프로토스" ? ["Photon Cannon"] : ["Bunker"];
    const cand = [...live, ...guard]
      .flatMap((b) => atFront(b))
      .filter((b) => b.frame !== null && sec(b.frame) < WALL_IN_SEC)
      .sort((a, b) => (a.frame ?? 0) - (b.frame ?? 0));
    const near = (a: BuildPos, b: BuildPos) => Math.hypot(a.x - b.x, a.y - b.y) <= WALL_SPAN;
    const wall = cand
      .map((seed) => cand.filter((b) => near(seed, b)
        && Math.abs((b.frame ?? 0) - (seed.frame ?? 0)) * SECONDS_PER_FRAME <= WALL_BURST_SEC))
      // 섞여 있어야 벽이다 — 같은 건물만 줄지어 선 것은 살림이지 벽이 아니다.
      // 묶음 전체가 한 번에 올라갔어야 한다 — 위 near가 씨앗 한 채를 기준으로 앞뒤를
      // 보는 탓에, 씨앗에서 각각 3분 이내여도 처음과 끝은 6분 가까이 벌어질 수 있다.
      .filter((g) => {
        if (g.length < WALL_IN_MIN || g.length > WALL_MAX) return false;
        if (new Set(g.map((b) => b.unit)).size < WALL_KIND_MIN) return false;
        const fs = g.map((b) => b.frame ?? 0);
        return sec(Math.max(...fs) - Math.min(...fs)) <= WALL_BURST_SEC;
      })
      // 여럿이면 가장 여러 종류가 섞인 것 — 그게 가장 벽다운 자리다.
      .sort((a, b) => new Set(b.map((x) => x.unit)).size - new Set(a.map((x) => x.unit)).size)[0];
    const closed = wall ? lastOf(wall) : null;
    if (!wall || closed === null) return null;
    // 막은 뒤에 실제로 컸나("발전") — 막아 놓고 아무것도 안 했으면 할 얘기가 아니다.
    // 벽을 이룬 건물이 여기 다시 세어지지 않도록 '막은 시각 뒤'만 본다.
    const base = race === "저그" ? "Hatchery" : race === "프로토스" ? "Nexus" : "Command Center";
    const tech = race === "저그"
      ? ["Lair", "Hive", "Spire", "Hydralisk Den", "Queen's Nest"]
      : race === "프로토스"
        ? ["Robotics Facility", "Stargate", "Citadel of Adun", "Templar Archives"]
        : ["Factory", "Starport", "Science Facility", "Armory"];
    const grew = [base, ...tech]
      .reduce((n, b) => n + (s.buildingFrames[b] ?? []).filter((f) => f > closed).length, 0);
    if (grew < WALL_IN_GROW_MIN) return null;
    /* 무엇으로 막았나 — 많이 쓴 것부터 두 가지까지 문장이 부른다.
       저그만 사정이 다르다: 리플레이에 자리가 남는 건 크립 콜로니뿐이고, 성큰·스포어로의
       변태는 자리 없이 개수로만 남는다(실측한 판에서 크립 19, 스포어 15, 성큰 1). 그래서
       그 자리를 "크립 콜로니"라 부르면 이야기가 어색하고, 무턱대고 "성큰"이라 부르면
       열에 아홉이 스포어였던 판에서 거짓이 된다. 그 사람이 실제로 무엇으로 바꿨는지가
       한쪽으로 확실히 기울 때만(두 배 이상) 그 이름을 쓰고, 아니면 크립 그대로 둔다. */
    const tally = new Map<string, number>();
    for (const b of wall) tally.set(b.unit, (tally.get(b.unit) ?? 0) + 1);
    if (tally.has("Sunken Colony") || tally.has("Spore Colony")) tally.delete("Creep Colony");
    const creep = tally.get("Creep Colony");
    if (creep !== undefined) {
      const sunk = s.buildingCounts["Sunken Colony"] ?? 0;
      const spore = s.buildingCounts["Spore Colony"] ?? 0;
      const grown = sunk >= spore * 2 && sunk > 0 ? "Sunken Colony"
        : spore >= sunk * 2 && spore > 0 ? "Spore Colony" : null;
      if (grown) { tally.delete("Creep Colony"); tally.set(grown, creep); }
    }
    const kinds = [...tally].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([u]) => u);
    return { at: closed, n: wall.length, kinds };
  })();
  if (wallIn) {
    out.push({
      // 몇 분에 잠겼나 — 첫 채가 아니라 마지막 한 채가 올라가 길이 닫힌 때다(문장에
      // 실리는 시각 at과도 같아야 한다. 첫 채로 쓰면 "2분경"이라 말해 놓고 화면의
      // 타임라인은 8분을 가리키는 어긋남이 난다).
      key: "wall-in", weight: 11, at: wallIn.at, who,
      p: { n: wallIn.n, min: Math.max(1, Math.round(sec(wallIn.at) / 60)), bs: wallIn.kinds.join(",") },
    });
  }

  // ── 입구 방어(요청) ── 리플레이에 지형이 없어 램프 자체는 알 수 없다. 대신 '내 본진
  // 안이면서 상대 쪽으로 나가 있는 자리'는 진출로 쪽이고, 거기 박은 방어 건물은 뒤나 옆에
  // 세운 것과 뜻이 다르다. 한 채는 우연일 수 있어 두 채부터 말한다.
  // 터렛도 함께 본다(요청: 터렛도 포토·성큰처럼 맥락 적용) — 제 진출로에 세운 것이면
  // 그것도 막아선 이야기다. 이 자리의 표시는 방패다(GameResultStory의 BEAT_MARK 주석).
  //
  // 위 입구막기가 잡혔으면 이 이야기는 하지 않는다 — 그 방어탑은 십중팔구 벽의 일부라,
  // 둘 다 말하면 같은 자리를 두 문장이 나눠 말하게 된다("입구를 막고 발전했다" 다음에
  // "입구 쪽에 포토 2개를 지어 방어했다"). 벽 쪽이 더 큰 이야기다.
  const frontDef = wallIn ? undefined
    : (["Bunker", "Photon Cannon", "Sunken Colony", "Missile Turret"] as const)
      .map((b) => ({ b, at: atFront(b) }))
      .filter((x) => x.at.length >= 2).sort((a, b) => b.at.length - a.at.length)[0];
  if (frontDef) {
    out.push({
      key: "front-defense", weight: 8, at: lastOf(frontDef.at), who,
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
  /** 맵의 모든 시작 지점(타일) — 이번 판에 아무도 안 앉은 자리까지. 센터를 재는 기준이다
   *  (요청). 안 넘기면 참가자들의 자리만으로 잰다. */
  startSpots?: [number, number][];
}

/** 한 편의 전술 목록 — 무게 큰 것부터, 같은 전술은 한 번만. */
export function scanTactics({ sidePlayers, foePlayers, startSpots }: TacticScanInput): Tactic[] {
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
        geo: geoOf(p, sidePlayers.filter((x) => x !== p), foePlayers, startSpots),
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
