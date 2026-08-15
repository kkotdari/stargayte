import type { ParsedReplay } from "./replayParser";
import { AIR_UNITS, CASTER_UNITS, NOT_ARMY } from "./replayBuildMix";

/* ── 연속 재생용 모션 트랙(요청: 장면 선정 없이 전부 연속으로) ─────────────────────
   스냅(beat) 방식은 등록 때 장면을 골라 저장하고 그 사이를 건너뛰었다. 연속 재생은 원본
   명령 스트림이 필요한데, 그건 파싱 순간에만 있고 버려진다 — 그래서 여기서 시간축으로
   솎아(다운샘플) 요약(summaryData.motion)에 함께 저장한다. beat는 그대로 남는다(칭호
   집계·자막·BEST의 원장이다) — 재생 시각이 beat를 지날 때 자막이 뜨는 재료가 된다.

   좌표는 전부 타일이고(미니맵 마커·화살표와 같은 자), 시각은 초(정수)다. 판당 크기는
   버킷·중복 접기·상한을 거쳐 수십 KB 안쪽이다 — 명령 만 개짜리 팀전도 트랙은 수백 점이다. */

const SECONDS_PER_FRAME = 0.042;
/** 부대 자취의 버킷(초) — 이보다 촘촘한 움직임은 어차피 미니맵 픽셀로 뭉개진다. */
const STEP_SEC = 4;
/** 한 사람의 자취 상한 — 넘치면 버킷을 배로 키워 다시 접는다(40분 팀전 대비). */
const TRACK_CAP = 400;
/** 같은 자리로 치는 거리(타일) — 이 안에서 맴돈 버킷은 한 점으로 접는다. */
const SAME_SPOT_TILES = 3;
/** 부대 이름표가 너무 촐싹대지 않게, 우세 유닛이 바뀌어도 이만큼은 지나야 갈아 준다(초). */
const UNIT_HOLD_SEC = 10;
/* 건물 무너짐 어림(요청) — 상대의 공격 명령이 건물 반경(타일) 안에서 창(초) 동안 이만큼
   몰리면, 그 창의 끝을 무너진 때로 본다. 리플레이에 파괴가 안 남아 명령 밀도로 어림한다. */
/* 판정 정밀화(요청: 어느 시점 이후 액션이 없으면 없어진 것) — 공격 뭉치 하나만으로는
   두 방향으로 틀렸다: 문턱(12)이 높아 조용히 부순 건물을 놓쳤고, 막아 낸 자리도 부쉈다고
   봤다. 이제 두 근거를 겹친다. ① 후보: 공격 명령 6개만 몰려도 후보다. ② 확인: 그 창이
   끝나고 90초 동안 임자의 명령이 그 곁(8타일)에 거의 없으면(1개 이하) 무너진 것이다 —
   서 있는 건물 곁에는 임자의 손이 계속 오간다(수리·생산·랠리·일꾼). 임자가 계속 움직이면
   막아 낸 것이라 안 부순다. 다만 뭉치가 압도적이면(14개) 임자의 손과 무관하게 무너진
   것으로 본다 — 그만큼 두들긴 자리가 남아 있는 일은 드물다. */
const RAZE_RADIUS = 6;
const RAZE_WINDOW_SEC = 30;
const RAZE_MIN_ORDERS = 6;
const RAZE_SURE_ORDERS = 14;
const RAZE_QUIET_SEC = 90;
const RAZE_QUIET_RADIUS = 8;
const RAZE_QUIET_MAX_ORDERS = 1;
/* 격퇴 증거(지적: 지었던 스포닝풀이 갑자기 없어짐, 쳐들어오지도 않았는데) — 기지 안
   방어전만 있어도 위 뭉치 판정이 곁 건물들을 죽은 것으로 봤다. 특히 돈맵에선 일꾼이
   클릭 없이 캐서 '임자 침묵'이 쉽게 성립하고, 풀 같은 테크 건물은 지어 두고 안 쓰는
   게 정상이라 살아 있다는 흔적도 없다. 그래서 철거 판정 뒤 얼마 안 돼 임자가 그 곁에
   '다른 종류' 건물을 새로 지으면 — 밀린 자리에서 태연히 공사할 수는 없으니 — 막아 낸
   것으로 보고 판정을 물린다. 같은 종류는 안 친다: 그 자리 재건축이야말로 진짜 철거의
   증거다(아래 같은 자리 재건 규칙). */
const RAZE_REBUILD_RADIUS = 12;
const RAZE_REBUILD_WINDOW_SEC = 180;
/** 일꾼 걸음(타일/초) — 착공 지연의 자다. 재생 쪽 SCOUT_WALK_SPEED와 같은 값. */
const WORKER_TILES_PER_SEC = 3.7;
/** 착공 지연 상한(초) — 몰래 건물이라도 이보다 오래 걷지는 않았다고 본다. */
const BUILD_TRAVEL_CAP_SEC = 45;
/** 띄울 수 있는 테란 건물 — 착륙(Land)이 오면 이 가운데 가장 가까운 것이 옮겨 앉는다. */
const LIFTABLE = new Set([
  "Command Center", "Barracks", "Factory", "Starport", "Engineering Bay", "Science Facility",
]);
/** 건물 변태의 재료 — 무엇에서 무엇이 되는가(요청: 저그 건물 변태 추적). */
const MORPH_SRC: Record<string, string[]> = {
  Lair: ["Hatchery"], Hive: ["Lair"],
  "Sunken Colony": ["Creep Colony"], "Spore Colony": ["Creep Colony"],
  "Greater Spire": ["Spire"],
};
/** 생산 건물 → 거기서 나오는 유닛들(요청: 생산 끊김 = 파괴의 재료). 저그 본진 3형제는
 *  라바 유닛 전부를 공유한다. */
const ZERG_FROM_LARVA = ["Drone", "Overlord", "Zergling", "Hydralisk", "Mutalisk", "Scourge", "Queen", "Ultralisk", "Defiler"];
const PROD_OF: Record<string, string[]> = {
  Barracks: ["Marine", "Firebat", "Medic", "Ghost"],
  Factory: ["Vulture", "Siege Tank (Tank Mode)", "Siege Tank", "Goliath"],
  Starport: ["Wraith", "Dropship", "Science Vessel", "Battlecruiser", "Valkyrie"],
  "Command Center": ["SCV"],
  Gateway: ["Zealot", "Dragoon", "High Templar", "Dark Templar"],
  "Robotics Facility": ["Shuttle", "Reaver", "Observer"],
  Stargate: ["Scout", "Corsair", "Carrier", "Arbiter"],
  Nexus: ["Probe"],
  Hatchery: ZERG_FROM_LARVA, Lair: ZERG_FROM_LARVA, Hive: ZERG_FROM_LARVA,
};
/** 생산이 판 끝보다 이만큼 일찍 영영 멎었으면 '끊김'으로 본다(초). */
const PROD_QUIET_SEC = 90;
/** 취소가 물릴 수 있는 착공 후 시간(초) — 이보다 오래된 건물은 이미 다 섰다. */
const CANCEL_WINDOW_SEC = 60;

/** 자취 한 점 [초, x, y, 선택 묶음 번호?] — 넷째 값(g)은 같은 부대지정으로 내린 명령끼리
 *  같은 번호다(지적: 단축키 부대 이동의 순간이동). 옛 분석본에는 없다. */
export type TrackPt = [number, number, number, number?];

/** 한 사람의 자취 — 원본 게임 아이디(raw)로 부른다(beats와 같은 규칙). */
export interface MotionTrack {
  raw: string;
  /** 게임 내 색(#rrggbb, 요청) — 재생 화면이 팀 2색 대신 이 색으로 칠한다. 없으면 팀 색. */
  color?: string;
  /** [초, x, y, g?] — STEP_SEC 버킷의 마지막 명령 자리. 안 움직인 버킷은 접혀 있다. */
  pts: TrackPt[];
  /** 일꾼의 자취 — 부대 자취(pts)에서 걷어낸, 정체가 일꾼으로 드러난 명령들이다(지적:
   *  정찰이 안 보인다). 옛 분석본에는 없거나(더 옛것) 정찰 전부가 섞여 있다(한 벌이던
   *  시절) — 화면은 어느 쪽이든 "일꾼"으로 부른다. */
  spts?: TrackPt[];
  /** 수송선(오버로드 포함)의 자취 — 한 기짜리 클릭인데 정체가 수송선인 것(지적: 드랍십
   *  순간이동). 저그면 화면이 "오버로드"라 부른다. 옛 분석본에는 없다. */
  tpts?: TrackPt[];
  /** 정체 모를 한 기짜리 클릭의 자취 — 시작 오버로드·옵저버 정찰이 대부분이다(지적:
   *  오버로드 이름이 안 나온다). 저그면 "오버로드", 아니면 "정찰"로 부른다. */
  opts?: TrackPt[];
  /** 뜬 건물의 비행 클릭 자취(요청: 엔베 띄워 정찰이 안 나온다) — 떠 있는(liftAt) 건물
   *  마커가 이 자취를 비행 속도로 따라 난다. 옛 분석본에는 없다. */
  fpts?: TrackPt[];
  /** 명령의 선택 크기 자취 [초, x, y, 몇 기 골랐나](요청: 유닛 수를 죽음 판정보다 실제
   *  컨트롤되는 수로) — 죽은 유닛은 더 못 고르니 저절로 준다. 5초·6타일 안 연속 클릭은
   *  최대값 하나로 접는다. 옛 분석본에는 없다. */
  sels?: [number, number, number, number][];
  /** 수송선 드랍 지점 [초, x, y](요청: 드랍 표현). 옛 분석본에는 없다. */
  drops?: [number, number, number][];
  /** 태우기 지점 [초, x, y](요청: 태운 것 표현) — 제 수송선을 찍은 우클릭. 옛 분석본에는 없다. */
  loads?: [number, number, number][];
  /** 정체가 드러난 유닛별 자취(요청: 모든 유닛의 위치를 따로 표시, 같은 종류끼리만
   *  묶기) — 시즈·버로우·스팀팩처럼 그 유닛만 하는 커맨드로 정체가 드러난 번호(orderPositions
   *  의 by)의 명령들이다. 키는 그 이름("Siege Tank"·"Bionic"·"Lurker"…). 정체가 안
   *  드러난 명령은 여전히 pts(무명 부대)다. 옛 분석본에는 없다. */
  upts?: Record<string, TrackPt[]>;
  /** [초, x, y, 건물 태그] — 생산 건물의 랠리 포인트(지적: 갓 나온 유닛이 갑자기 사라짐).
   *  태그는 생산 귀속(ptag)과 같은 번호라, 유닛→건물→랠리가 이어진다. 옛 분석본에는 없다. */
  rly?: [number, number, number, number][];
  /** [초, 유닛 영문명] — 그때까지 가장 많이 뽑은 전투 유닛이 바뀐 순간들(이름표 재료). */
  units: [number, string][];
  /** [초, 누적 일꾼 수] — 자원 캐는 모습의 재료(요청). 생산 커맨드 누적이라 죽은 일꾼은
   *  못 뺀다(리플레이에 죽음이 없다) — "여태 뽑은 일꾼"으로 읽어야 한다. */
  workers: [number, number][];
  /** [초, 업그레이드 영문명] — 속도 업그레이드의 연구 시점(요청: 속업 여부가 이동 속도에
   *  중요하다). 속도와 무관한 업은 안 싣는다(트랙만 굵어진다). */
  ups?: [number, string][];
  /** 유닛 영문명 → 생산 시각(초)들 — "생산할 때 건물 이름 켜기"(요청)의 재료다. 마린이
   *  나온 순간 그 사람 배럭이 일하고 있었다는 뜻이라, 건물 종류로 되짚는다. */
  prod: Record<string, number[]>;
  /** prod와 나란한 '그때 골라져 있던 건물 번호(태그)' — 어느 건물에서 뽑았는지의 어림
   *  재료다(요청). 옛 분석본에는 없다 — 그때는 같은 종류가 함께 깜빡이는 폴백. */
  ptag?: Record<string, number[]>;
  /** [초, 병력 규모] — 최근 3분 안에 뽑은 전투 유닛 수(요청: 뭉친 병력은 크기로 수를 표현).
   *  죽음을 모르니 '지금 서 있는 병력'이 아니라 '최근에 몰아 뽑은 규모'다 — 진군 직전에
   *  커지고 소강기에 줄어, 화면의 뜻(지금 움직이는 덩어리가 얼마나 큰가)과 결이 맞다. */
  size: [number, number][];
  /** [시작, 끝] 초 — 상대의 공격 명령이 내 부대 자리 곁에 몰린 구간(전투 어림). 재생이
   *  이 구간에서 규모를 깎는다(지적: 전투 중인데 유닛 수가 안 준다) — 리플레이에 죽음이
   *  안 남아 수를 셀 수는 없고, 맞고 있는 시간만큼 지수로 줄이는 것이 어림의 한계다. */
  hot?: [number, number][];
}

export interface SummaryMotion {
  v: 1;
  step: number;
  players: MotionTrack[];
  /** [초, x, y, 건물 영문명, raw, 무너진 초(0이면 살아 있음), 이륙한 초?] — 자리·시각은
   *  건설 커맨드 그대로 정확하고, 무너짐만 어림이다(요청: 파괴 파악) — 상대의 공격 명령이
   *  그 자리에 몰린 창의 끝을 무너진 때로 본다.
   *  일곱째 값은 착륙 이사의 옛 자리에만 붙는다(지적: 건물 떠 있는 게 표현이 안 된다) —
   *  이륙(Lift Off)한 초다. 그때부터 착륙까지 옛 자리 마커가 '떠 있음'으로 그려진다.
   *  옛 분석본에는 없다. */
  builds: [number, number, number, string, string, number, number?][];
  /** [초, x, y, 기술 영문명, raw] — 좌표가 남는 마법(스톰·스웜·리콜…). */
  casts: [number, number, number, string, string][];
}

const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

/** 부대 자취 — 이동·공격 명령(건물 랠리 제외)을 버킷으로 접는다.
 *
 *  정찰을 리플레이 정보로 걷는다(지적: 특히 초반에 자리가 튄다 — 오버로드인지 갑자기
 *  저 멀리 가 있다). 화면의 어림(멀리 갔다 돌아오면 빼기)보다 근거가 굵은 세 가지다.
 *   · by가 "Worker"인 명령 — 자원 클릭·건설로 정체가 드러난 일꾼의 클릭이다. 일꾼
 *     정찰·매너 파일런이 부대 자리로 읽히면 안 된다.
 *   · 한 기짜리 클릭(n === 1)인데 정체를 모르거나 수송선인 것 — 시작 오버로드는 아무
 *     커맨드로도 정체가 안 드러나지만 '한 기'인 것은 선택 기록이 말해 준다. 한 기는
 *     부대가 아니다(수송선 한 대의 원정도 오버로드 정찰과 같은 결이다 — 내린 뒤의 부대
 *     명령이 어차피 그 자리를 찍는다).
 *   · 첫 전투 유닛 생산 전의 모든 명령 — 병력이 없는 동안 움직이는 것은 죄다 일꾼과
 *     오버로드다. 부대 마커는 부대가 생기고서야 움직일 자격이 있다.
 *  옛 분석본에는 n이 없어 둘째 조건이 그냥 통과된다 — 그런 판은 재생 쪽의 나들이 걷기
 *  (dropSpikes)가 마저 막는다. */
function foldTrack(
  combat: { frame: number; x: number; y: number; g?: number }[],
): TrackPt[] {
  let step = STEP_SEC;
  for (;;) {
    const byBucket = new Map<number, { sec: number; x: number; y: number; g?: number }>();
    for (const o of combat) {
      const sec = o.frame * SECONDS_PER_FRAME;
      byBucket.set(Math.floor(sec / step), { sec: Math.round(sec), x: o.x, y: o.y, g: o.g });
    }
    const pts: TrackPt[] = [];
    for (const key of [...byBucket.keys()].sort((a, b) => a - b)) {
      const p = byBucket.get(key)!;
      const last = pts[pts.length - 1];
      // 같은 자리에서 맴돈 버킷은 접는다 — 자취는 "어디로 갔나"지 "몇 번 찍었나"가 아니다.
      if (last && dist(last[1], last[2], p.x, p.y) < SAME_SPOT_TILES) continue;
      // 선택 묶음 번호(g)는 그대로 실어 나른다(지적: 부대지정 이동의 순간이동).
      pts.push(p.g !== undefined
        ? [p.sec, Math.round(p.x), Math.round(p.y), p.g]
        : [p.sec, Math.round(p.x), Math.round(p.y)]);
    }
    if (pts.length <= TRACK_CAP) return pts;
    step *= 2;
  }
}

function trackOf(
  orders: { frame: number; x: number; y: number; kind?: "attack" | "move"; by?: string; n?: number; g?: number }[],
  armyStartSec: number,
  zerg = false,
  home: [number, number] | null = null,
): {
  pts: TrackPt[]; spts: TrackPt[];
  tpts: TrackPt[]; opts: TrackPt[];
  upts: Record<string, TrackPt[]>;
} {
  const movable = orders.filter((o) => o.kind !== undefined && o.by !== "Building");
  type O = (typeof movable)[number];
  /* 걷어낸 쪽이 버려지지 않고 제 자취가 된다(지적: 일꾼 정찰을 하나도 못 잡는다). 세
     갈래로 가르는 까닭은 이름과 움직임이 다 달라서다(지적: 오버로드 이름이 안 나온다 /
     드랍십이 순간이동한다) — 한 벌로 묶으면 일꾼 정찰과 셔틀 원정이 한 점을 놓고
     밀당하며 순간이동한다. */
  const worker = (o: O): boolean => o.by === "Worker";
  const carrier = (o: O): boolean => o.by === "Transport" && (o.n ?? 1) === 1;
  const early = (o: O): boolean => o.frame * SECONDS_PER_FRAME < armyStartSec;
  const lone = (o: O): boolean => (o.n === 1 && o.by === undefined)
    /* 초반 저그의 두 마리 이하 무명 선택도 오버로드로 본다(지적: 오버로드가 너무 늦게
       출발 — 시작 오버로드를 드론과 함께 잡고 찍으면 n=2가 돼 lone에서 새고, 다음 홑
       클릭이 올 때까지 몇 분을 풍선이 서 있었다). */
    || (zerg && o.n !== undefined && o.n <= 2 && o.by === undefined && early(o))
    /* 옛 분석본 폴백(지적: 오버로드가 초반에 정찰을 안 한다) — n(선택 크기)이 없던
       시절 자료에선 시작 오버로드의 홑 클릭을 알 길이 없어 일꾼 정찰(spts)에 묻혔다.
       저그의 이른 무명 원거리 클릭(집에서 25타일 너머)은 오버로드 정찰로 본다. */
    || (zerg && o.n === undefined && o.by === undefined && early(o)
      && home !== null && Math.hypot(o.x - home[0], o.y - home[1]) > 25);
  const scout = (o: O): boolean => worker(o) || carrier(o) || lone(o) || early(o);
  const army = movable.filter((o) => !scout(o));
  /* 정체가 드러난 유닛은 제 자취로(요청: 유닛별 위치) — 무명 명령만 '부대'로 남는다.
     그래야 탱크 라인과 바이오닉 본대가 서로 딴 자리에 있어도 각자의 점으로 선다. */
  const upts: Record<string, TrackPt[]> = {};
  const named = new Map<string, typeof army>();
  for (const o of army) {
    if (!o.by) continue;
    const list = named.get(o.by) ?? [];
    list.push(o);
    named.set(o.by, list);
  }
  for (const [unit, list] of named) {
    const folded = foldTrack(list);
    if (folded.length > 0) upts[unit] = folded;
  }
  return {
    pts: foldTrack(army.filter((o) => !o.by)),
    // 병력 생기기 전의 여럿 클릭도 일꾼이다 — 그때 여럿을 골랐다면 일꾼 무리뿐이다.
    spts: foldTrack(movable.filter((o) => worker(o) || (early(o) && !carrier(o) && !lone(o)))),
    tpts: foldTrack(movable.filter(carrier)),
    opts: foldTrack(movable.filter((o) => lone(o) && !worker(o))),
    upts,
  };
}

/** 우세 유닛 이름표의 변천 — 그때까지 가장 많이 뽑은 전투 유닛. 전투 유닛이 아직 없으면
 *  일꾼·오버로드가 그 자리를 맡는다(지적: 초반 정찰 — 오버로드·일꾼이 이름 없이 점으로만
 *  움직였다. 초반에 움직이는 것은 죄다 그 둘이다). */
const SCOUT_FALLBACK = new Set(["SCV", "Probe", "Drone", "Overlord"]);

function unitTimeline(unitFrames: Record<string, number[]>): [number, string][] {
  const events: { sec: number; unit: string; army: boolean }[] = [];
  for (const [unit, frames] of Object.entries(unitFrames)) {
    const army = !NOT_ARMY.has(unit);
    if (!army && !SCOUT_FALLBACK.has(unit)) continue;
    for (const f of frames) events.push({ sec: f * SECONDS_PER_FRAME, unit, army });
  }
  events.sort((a, b) => a.sec - b.sec);
  const armyCounts = new Map<string, number>();
  const scoutCounts = new Map<string, number>();
  const out: [number, string][] = [];
  let leader = "";
  let lastAt = -Infinity;
  for (const e of events) {
    (e.army ? armyCounts : scoutCounts).set(
      e.unit, ((e.army ? armyCounts : scoutCounts).get(e.unit) ?? 0) + 1,
    );
    const counts = armyCounts.size > 0 ? armyCounts : scoutCounts;
    let top = "";
    let topN = 0;
    for (const [u, n] of counts) if (n > topN) { top = u; topN = n; }
    if (top !== leader && e.sec - lastAt >= UNIT_HOLD_SEC) {
      leader = top;
      lastAt = e.sec;
      out.push([Math.round(e.sec), top]);
    }
  }
  return out;
}


/** 본진 건물이 지어져 생산 슬롯이 되기까지(초) — 커맨드·넥서스·해처리의 어림 건설 시간. */
const HALL_BUILD_SEC = 55;




/** 건물이 무너진 때의 어림 — 상대 공격 뭉치(후보) + 그 뒤 임자의 침묵(확인). 위 정밀화
 *  주석 참고. 안 무너졌으면 0. */
function razedAt(
  builtSec: number, x: number, y: number,
  foeAttacks: { sec: number; x: number; y: number }[],
  ownOrders: { sec: number; x: number; y: number }[],
): number {
  const near = foeAttacks.filter(
    (o) => o.sec > builtSec && Math.hypot(o.x - x, o.y - y) <= RAZE_RADIUS,
  );
  for (let i = 0; i < near.length; i += 1) {
    let j = i;
    while (j + 1 < near.length && near[j + 1].sec - near[i].sec <= RAZE_WINDOW_SEC) j += 1;
    const count = j - i + 1;
    if (count < RAZE_MIN_ORDERS) continue;
    const end = Math.round(near[j].sec);
    if (count >= RAZE_SURE_ORDERS) return end;
    // 임자의 손이 그 곁에서 끊겼나 — 계속 오가면 막아 낸 것이다.
    const after = ownOrders.reduce((n, o) => (
      o.sec > end && o.sec <= end + RAZE_QUIET_SEC
      && Math.hypot(o.x - x, o.y - y) <= RAZE_QUIET_RADIUS ? n + 1 : n), 0);
    if (after <= RAZE_QUIET_MAX_ORDERS) return end;
    // 막아 냈다 — 이 뭉치는 지나가고 다음 뭉치를 본다.
    i = j;
  }
  return 0;
}

/** 게임 하나의 모션 트랙 — 좌표를 못 읽은 리플레이(옛 포맷)는 null(연속 재생은 그 판만 쉰다). */
export function motionOf(replay: ParsedReplay): SummaryMotion | null {
  const players = replay.players.filter((p) => !p.isComputer && p.signals);
  if (players.length === 0) return null;

  // 판의 끝 — 생산 끊김 판정(요청)의 기준선. 마지막 커맨드가 곧 판의 끝이다.
  const gameEndSec = players.reduce(
    (m, pp) => Math.max(m, (pp.signals?.lastCmdFrame ?? 0) * SECONDS_PER_FRAME), 0,
  );
  const tracks: MotionTrack[] = [];
  const builds: SummaryMotion["builds"] = [];
  /* 부드러운 끝(지적: 지었던 스포닝풀이 갑자기 없어짐) — 모프(해처리→레어)나 건설 취소로
     끝난 건물의 end는 '무너짐'이 아니다. 그런데 아래 파괴 전파가 end>0인 생산 건물을
     전부 무너진 것으로 보고 곁 비생산 건물(풀·덴·익스트랙터)까지 걷어서, 레어만 가도
     제 풀이 변태 시각에 사라졌다. 여기 든 항목은 전파의 근원이 되지 않는다. */
  const softEnd = new Set<SummaryMotion["builds"][number]>();
  const casts: SummaryMotion["casts"] = [];
  /* 팀별 공격 명령 — 건물 무너짐 어림의 재료. 한 번만 모아 두고 건물마다 훑는다. */
  const attacksByTeam = new Map<number, { sec: number; x: number; y: number }[]>();
  for (const p of players) {
    const list = attacksByTeam.get(p.team) ?? [];
    for (const o of p.signals!.orderPositions ?? []) {
      if (o.kind !== "attack" || o.by === "Building") continue;
      list.push({ sec: o.frame * SECONDS_PER_FRAME, x: o.x, y: o.y });
    }
    attacksByTeam.set(p.team, list);
  }
  for (const list of attacksByTeam.values()) list.sort((a, b) => a.sec - b.sec);
  /* 나를 직접 찍은 공격(hits) — 상대가 '내 유닛'을 우클릭·표적으로 찍은 기록이라, 공격
     명령 뭉치보다 표적이 확실한 전투 증거다(지적: 치열하게 싸워 다 소모했는데 유닛 수가
     그대로 누적 — 전투 감지(hot)가 빗나가면 감쇠가 아예 안 걸렸다). 전투 구간 감지에
     합친다. */
  const hitsOnRaw = new Map<string, { sec: number; x: number; y: number }[]>();
  for (const p of players) {
    for (const h of p.signals!.hits ?? []) {
      const list = hitsOnRaw.get(h.whom) ?? [];
      list.push({ sec: h.frame * SECONDS_PER_FRAME, x: h.x, y: h.y });
      hitsOnRaw.set(h.whom, list);
    }
  }
  for (const list of hitsOnRaw.values()) list.sort((a, b) => a.sec - b.sec);

  for (const p of players) {
    const sg = p.signals!;
    /* 첫 전투 유닛의 생산 명령 시각 — 그 전의 명령은 전부 정찰이다(trackOf 주석).
       전투 유닛을 아예 안 뽑은 사람(일꾼뿐)은 0으로 두어 옛 동작 그대로 남긴다 —
       자취가 통째로 비는 것보다는 낫다. */
    let armyStartSec = Infinity;
    for (const [unit, frames] of Object.entries(sg.unitFrames ?? {})) {
      if (NOT_ARMY.has(unit)) continue;
      for (const f of frames) armyStartSec = Math.min(armyStartSec, f * SECONDS_PER_FRAME);
    }
    if (armyStartSec === Infinity) armyStartSec = 0;
    const { spts } = trackOf(
      sg.orderPositions ?? [], armyStartSec, p.race === "저그",
      p.startX !== null && p.startY !== null ? [p.startX, p.startY] : null,
    );
    const units = unitTimeline(sg.unitFrames ?? {});
    // 생산 슬롯 — 시작 본진(0초) + 지어진 본진 건물들(건설 시간 지나서부터).
    const slotOpenSecs = [0, ...(sg.buildPositions ?? [])
      .filter((b) => b.frame !== null
        && ["Command Center", "Nexus", "Hatchery"].includes(b.unit))
      .map((b) => b.frame! * SECONDS_PER_FRAME + HALL_BUILD_SEC)];
    void slotOpenSecs;
    /* 비행·드랍·태움(요청: 엔베 띄워 정찰, 수송선 태우기·드랍 표현). */
    const fpts = foldTrack(sg.flyPositions ?? []);
    // (스토리 다이어트) 선택 크기·승하차 자취는 v2가 대체 — 더 안 만든다.
    const ups: [number, string][] = [];
    for (const [name, frame] of Object.entries(sg.firstUpgradeFrame ?? {})) {
      ups.push([Math.round(frame * SECONDS_PER_FRAME), name]);
    }
    for (const [name, frame] of Object.entries(sg.firstTechFrame ?? {})) {
      ups.push([Math.round(frame * SECONDS_PER_FRAME), name]);
    }
    ups.sort((a, b) => a[0] - b[0]);
    const prod: Record<string, number[]> = {};
    for (const [unit, frames] of Object.entries(sg.unitFrames ?? {})) {
      if (frames.length === 0) continue;
      prod[unit] = frames.map((f) => Math.round(f * SECONDS_PER_FRAME));
    }
    // 생산 태그(요청: 어느 건물인지) — prod와 길이가 맞는 것만 싣는다(어긋나면 오지목).
    const ptag: Record<string, number[]> = {};
    for (const [unit, tags] of Object.entries(sg.trainTags ?? {})) {
      if (tags.length > 0 && tags.length === (sg.unitFrames?.[unit]?.length ?? 0)
        && tags.some((tg) => tg > 0)) {
        ptag[unit] = tags;
      }
    }
    const foeAttacks = [...attacksByTeam.entries()]
      .filter(([team]) => team !== p.team)
      .flatMap(([, list]) => list)
      .sort((a, b) => a.sec - b.sec);
    /* 임자의 모든 명령 좌표(캐기·랠리처럼 kind 없는 것 포함) — 무너짐 확인의 재료다.
       서 있는 건물 곁에는 이런 손길이 계속 지나간다. */
    const ownOrders = (sg.orderPositions ?? [])
      .map((o) => ({ sec: o.frame * SECONDS_PER_FRAME, x: o.x, y: o.y }));
    const myBuildIdx: number[] = [];
    // 건물 번호 → razedAt 원본 값(격퇴 증거 물리기용, RAZE_REBUILD 주석).
    const razeByIdx = new Map<number, number>();
    /* 시작 본진을 심는다(지적: 본진 기지 건물은 절대 안 망함 + 요청: 기존 기지는 평범한
       기지 아이콘으로) — 시작 홀은 건설 커맨드가 없어 builds에 없었고, 그래서 무너짐
       판정의 대상조차 아니었다. 시작 지점에 종족 홀을 0초로 세우면 무너짐 어림·파괴
       전파·변태(시작 해처리 → 레어)가 전부 걸리고, 맵에는 다른 홀과 같은 도형이 선다.
       좌표는 중심(startX·Y)에서 발자국 절반(4×3)을 물려 왼쪽 위 타일로 맞춘다(builds
       규약). */
    if (p.startX !== null && p.startY !== null && p.race) {
      const hallUnit = p.race === "저그" ? "Hatchery"
        : p.race === "테란" ? "Command Center" : "Nexus";
      myBuildIdx.push(builds.length);
      builds.push([
        0, Math.round(p.startX - 2), Math.round(p.startY - 1.5), hallUnit, p.rawName,
        razedAt(0, p.startX, p.startY, foeAttacks, ownOrders),
      ]);
    }
    for (const b of sg.buildPositions ?? []) {
      if (b.frame === null) continue; // 시각을 모르는 건설은 시간축에 못 세운다.
      const clickSec = b.frame * SECONDS_PER_FRAME;
      /* 착공은 일꾼이 닿고서다(요청, 재지적: 여전히 클릭 순간 올라감) — 예전엔 '직전
         명령 자리'를 일꾼 자리로 썼는데, 직전 명령이 딴 부대 것이라 우연히 현장 근처면
         지연이 0이 됐다. 이제 마지막 '일꾼' 명령 자리(없으면 본진)에서 현장까지 일꾼
         걸음으로 걸린 시간을 얹는다. 몰래 건물일수록 지연이 길어져, 클릭 순간 짠 하고
         서던 것이 걸어가 닿은 뒤 올라간다. 일꾼 점도 현장으로 걷는다(아래 spts 주석). */
      let prev: { x: number; y: number } | null = null;
      for (const o of sg.orderPositions ?? []) {
        if (o.frame * SECONDS_PER_FRAME > clickSec) break;
        if (o.by === "Worker") prev = { x: o.x, y: o.y };
      }
      if (!prev && p.startX !== null && p.startY !== null) prev = { x: p.startX, y: p.startY };
      const travel = prev
        ? Math.min(BUILD_TRAVEL_CAP_SEC, Math.hypot(prev.x - b.x, prev.y - b.y) / WORKER_TILES_PER_SEC)
        : 0;
      const builtSec = Math.round(clickSec + travel);
      spts.push([Math.round(clickSec), Math.round(b.x), Math.round(b.y)]);
      myBuildIdx.push(builds.length);
      // 철거 판정의 원본 값을 따로 적는다 — 아래 격퇴 증거 물리기가 '철거 판정이 그대로
      // 남은' 항목만 만지기 위해서다(모프·취소가 덮은 끝은 그쪽 사정).
      const rz = razedAt(builtSec, b.x, b.y, foeAttacks, ownOrders);
      if (rz > 0) razeByIdx.set(builds.length, rz);
      builds.push([
        builtSec, Math.round(b.x), Math.round(b.y), b.unit, p.rawName, rz,
      ]);
    }
    spts.sort((a, b) => a[0] - b[0]);
    /* 저그 건물 변태(요청) — 명령에 자리가 없어 재료 건물을 되짚는다. 성큰·스포어는 방금
       깐 콜로니(가장 최근)가, 레어·하이브는 가장 오래된 재료(대개 본진)가 변한 것이다.
       시작 해처리는 건설 기록이 없어 못 되짚는다 — 그때는 그냥 넘어간다(자리를 모르는
       레어를 아무 데나 세울 수는 없다). */
    for (const bm of sg.buildingMorphs ?? []) {
      const srcKinds = MORPH_SRC[bm.to];
      if (!srcKinds) continue;
      const sec = Math.round(bm.frame * SECONDS_PER_FRAME);
      const recentFirst = bm.to.includes("Colony");
      let pick = -1;
      for (const k of myBuildIdx) {
        const e = builds[k];
        if (!srcKinds.includes(e[3]) || e[0] > sec || (e[5] > 0 && e[5] <= sec)) continue;
        if (pick < 0 || (recentFirst ? e[0] > builds[pick][0] : e[0] < builds[pick][0])) pick = k;
      }
      if (pick < 0) continue;
      const e = builds[pick];
      e[5] = e[5] > 0 ? Math.min(e[5], sec) : sec;
      softEnd.add(e); // 변태로 물러난 것 — 무너진 게 아니다(위 softEnd 주석).
      myBuildIdx.push(builds.length);
      builds.push([sec, e[1], e[2], bm.to, p.rawName, razedAt(sec, e[1], e[2], foeAttacks, ownOrders)]);
    }
    /* 테란 착륙(요청: 띄우기 판단) — 어느 건물이 내렸는지는 안 남아, 그 시각 살아 있는
       띄울 수 있는 건물 중 가장 가까운 것이 옮겨 앉은 것으로 본다. 옛 자리는 그때 비고
       (✕ 없이 사라짐), 새 자리에 같은 건물이 선다. */
    /* 이륙 시각을 착륙과 짝짓는다(지적: 건물 떠 있는 게 표현이 안 된다) — 이륙에는 좌표도
       대상도 안 남아, "이 착륙보다 앞의 아직 안 쓴 마지막 이륙"이 그 건물이 뜬 순간이다.
       옛 자리 마커가 그때부터 착륙까지 '떠 있음'으로 그려진다. */
    const liftSecs = (sg.lifts ?? []).map((f) => Math.round(f * SECONDS_PER_FRAME)).sort((a, b) => a - b);
    const liftUsed = new Set<number>();
    for (const l of sg.lands ?? []) {
      const sec = Math.round(l.frame * SECONDS_PER_FRAME);
      let pick = -1;
      let bd = Infinity;
      for (const k of myBuildIdx) {
        const e = builds[k];
        if (!LIFTABLE.has(e[3]) || e[0] > sec || (e[5] > 0 && e[5] <= sec)) continue;
        const d = Math.hypot(e[1] - l.x, e[2] - l.y);
        if (d < bd) { bd = d; pick = k; }
      }
      // 같은 자리 재착륙(애드온 붙이기 실패 등)은 이사가 아니다.
      if (pick < 0 || bd <= 2) continue;
      const e = builds[pick];
      e[5] = e[5] > 0 ? Math.min(e[5], sec) : sec;
      for (let li = liftSecs.length - 1; li >= 0; li -= 1) {
        if (liftUsed.has(li) || liftSecs[li] > sec || liftSecs[li] <= e[0]) continue;
        liftUsed.add(li);
        e[6] = liftSecs[li];
        break;
      }
      myBuildIdx.push(builds.length);
      builds.push([
        sec, Math.round(l.x), Math.round(l.y), e[3], p.rawName,
        razedAt(sec, l.x, l.y, foeAttacks, ownOrders),
      ]);
    }
    /* 착륙 없이 끝나는 이륙(요청: 엔베 띄워 정찰이 안 나온다) — 엔지니어링 베이가 가장
       흔한 '띄우고 안 내리는' 정찰이라, 남은 이륙을 살아 있는 엔베에 붙인다. 그때부터
       그 마커는 둥실 뜬 채 비행 클릭(fpts)을 따라 난다. 생산 건물은 안 짚는다 —
       이사(착륙)로 끝나는 것이 보통이라, 잘못 짚으면 멀쩡히 생산하는 건물이 떠 버린다. */
    for (let li = 0; li < liftSecs.length; li += 1) {
      if (liftUsed.has(li)) continue;
      const sec = liftSecs[li];
      for (const k of myBuildIdx) {
        const e = builds[k];
        if (e[3] !== "Engineering Bay" || e[0] > sec || (e[5] > 0 && e[5] <= sec) || e[6]) continue;
        e[6] = sec;
        liftUsed.add(li);
        break;
      }
    }
    /* 생산 끊김 = 파괴(요청) — 그 종류의 생산이 판 끝보다 한참(PROD_QUIET_SEC) 일찍
       영영 멎었고, 멎은 무렵부터 그 건물 곁으로 상대 공격이 지나갔다면 무너진 것으로
       본다. 공격 뭉치 판정(razedAt: 2발+침묵)이 못 잡는 치고 빠진 파괴를 줍는다. 같은
       종류가 여럿이면 생산 스트림이 공유라 어느 채인지 모르니, 공격이 닿은 채만 걷는다. */
    for (const k of myBuildIdx) {
      const e = builds[k];
      if (e[5] > 0) continue;
      const us = PROD_OF[e[3]];
      if (!us) continue;
      /* 건물별 생산 귀속(재지적: 생산 끊긴 건물이 끝까지 남는다 — 좌표·개체를 잘 봐야
         한다, 딴 데 같은 종류 건물이 계속 뽑으면 종류 합계로는 끊김이 안 보인다) —
         생산 태그의 첫 등장 순서 = 그 종류를 지은 순서로 보고(재생 tagOrdinals와 같은
         어림), 이 건물 몫의 생산만 잰다. 본진 계열은 시작 본진이 건설 기록에 없어
         순번이 어긋나므로, 태그 없는 옛 분석본과 함께 종류 합계 그대로다. */
      const hall = ["Command Center", "Nexus", "Hatchery", "Lair", "Hive"].includes(e[3]);
      let lastProd = 0;
      let attributed = false;
      if (!hall) {
        const sameType = myBuildIdx.filter((k2) => builds[k2][3] === e[3]);
        const myOrd = sameType.indexOf(k);
        const evs: [number, number][] = [];
        for (const u of us) {
          const frames = sg.unitFrames?.[u] ?? [];
          const tags = sg.trainTags?.[u] ?? [];
          if (tags.length === 0 || tags.length !== frames.length) continue;
          for (let x = 0; x < frames.length; x += 1) {
            evs.push([frames[x] * SECONDS_PER_FRAME, tags[x]]);
          }
        }
        if (evs.length > 0) {
          evs.sort((a, b) => a[0] - b[0]);
          const ord = new Map<number, number>();
          for (const [, tg] of evs) if (tg > 0 && !ord.has(tg)) ord.set(tg, ord.size);
          for (const [sec2, tg] of evs) {
            if (ord.get(tg) === myOrd) {
              lastProd = Math.max(lastProd, sec2);
              attributed = true;
            }
          }
        }
      }
      if (!attributed) {
        for (const u of us) {
          for (const f of sg.unitFrames?.[u] ?? []) lastProd = Math.max(lastProd, f * SECONDS_PER_FRAME);
        }
      }
      // 생산이 아예 없던 건물은 선 시각부터 잰다 — 갓 지은 건물을 옛 공격으로 걷지 않게.
      if (lastProd === 0) lastProd = e[0];
      if (gameEndSec - lastProd < PROD_QUIET_SEC) continue;
      let lastHit = 0;
      for (const o of foeAttacks) {
        if (o.sec > Math.max(lastProd - 30, e[0]) && Math.hypot(o.x - e[1], o.y - e[2]) <= RAZE_RADIUS) {
          lastHit = Math.max(lastHit, o.sec);
        }
      }
      if (lastHit > 0) e[5] = Math.round(Math.max(lastHit, lastProd));
    }
    /* 건설 취소(요청: 짓다가 멈추거나 취소) — 어느 건물인지 안 남아, 가장 최근에 착공돼
       아직 짓고 있던 건물을 물린 것으로 본다. */
    for (const cf of sg.cancelBuilds ?? []) {
      const sec = Math.round(cf * SECONDS_PER_FRAME);
      let pick = -1;
      for (const k of myBuildIdx) {
        const e = builds[k];
        if (e[0] > sec || sec - e[0] > CANCEL_WINDOW_SEC || (e[5] > 0 && e[5] <= sec)) continue;
        if (pick < 0 || e[0] > builds[pick][0]) pick = k;
      }
      if (pick >= 0) {
        const e = builds[pick];
        e[5] = e[5] > 0 ? Math.min(e[5], sec) : sec;
        softEnd.add(e); // 취소로 물러난 것 — 무너진 게 아니다(위 softEnd 주석).
      }
    }
    /* 격퇴 증거로 철거 판정 물리기(지적: 스포닝풀이 갑자기 없어짐 — RAZE_REBUILD 주석)
       — 철거로 봤던 시각 뒤 얼마 안 돼 임자가 그 곁에 다른 종류 건물을 새로 지었으면
       막아 낸 것이다. 철거 값이 그대로 남은 항목만 만진다. */
    for (const [k, rz] of razeByIdx) {
      const a = builds[k];
      if (a[5] !== rz) continue;
      const defended = myBuildIdx.some((k2) => {
        const b2 = builds[k2];
        return b2[0] > rz && b2[0] - rz <= RAZE_REBUILD_WINDOW_SEC && b2[3] !== a[3]
          && Math.hypot(b2[1] - a[1], b2[2] - a[2]) <= RAZE_REBUILD_RADIUS;
      });
      if (defended) a[5] = 0;
    }
    /* 스토리 다이어트(요청: 비트 단위 스토리 저장 완전 삭제 — 용량 확보) — v2 개체
       트랙이 장면을 통째로 대체한 뒤라, v1 자취(pts·tpts·opts·upts)·선택 크기(sels)·
       승하차(drops·loads)·랠리(rly)·규모(size)·전투 구간(hot)·일꾼 수(workers)는
       아무도 안 읽는다. 남기는 것은 걸음 속도 재료(units·ups), 생산 깜빡(prod·ptag),
       비행 자취(fpts), 건설 걸음(spts), 그리고 색뿐이다. */
    if (spts.length > 0 || units.length > 0 || fpts.length > 0
      || Object.keys(prod).length > 0) {
      tracks.push({
        raw: p.rawName, ...(p.color ? { color: p.color } : {}),
        ...(ups.length > 0 ? { ups } : {}), pts: [], units, workers: [], size: [], prod,
        ...(spts.length > 0 ? { spts } : {}),
        ...(fpts.length > 0 ? { fpts } : {}),
        ...(Object.keys(ptag).length > 0 ? { ptag } : {}),
      });
    }
    for (const c of sg.castPositions ?? []) {
      casts.push([
        Math.round(c.frame * SECONDS_PER_FRAME), Math.round(c.x), Math.round(c.y), c.tech, p.rawName,
      ]);
    }
  }
  if (tracks.length === 0 && builds.length === 0) return null;
  /* 공격이 온 뒤 그 자리에 새 건물이 서면, 옛 건물은 그 공격 때 없어진 것이다(요청:
     "건물 없어짐 시점은 새건물 지을때가 아니라 공격시점") — 같은 타일에 두 채가 같이 설
     수는 없으니 재건 자체가 파괴의 증거이고, 무너진 순간은 마지막으로 그 자리를 때린
     공격이 말한다. 예전엔 새 건물이 서는 순간을 썼는데, 그러면 부서진 건물이 재건 직전
     까지 몇 분씩 멀쩡히 서 있었다. 임자가 같아도 적용된다(부서진 자리에 다시 지은 것).
     공격 근거 없이 겹친 것은 취소·재배치일 수 있어 안 건드린다. */
  const teamOfRaw = new Map<string, number>();
  for (const p of players) teamOfRaw.set(p.rawName, p.team);
  for (const a of builds) {
    for (const b of builds) {
      if (b[0] <= a[0] || Math.hypot(a[1] - b[1], a[2] - b[2]) > 2) continue;
      if (a[5] > 0 && a[5] <= b[0]) continue;
      const foes = [...attacksByTeam.entries()]
        .filter(([team]) => team !== teamOfRaw.get(a[4]))
        .flatMap(([, list]) => list);
      let hitNear = 0;
      let lastHit = 0;
      for (const o of foes) {
        if (o.sec > a[0] && o.sec < b[0] && Math.hypot(o.x - a[1], o.y - a[2]) <= RAZE_RADIUS) {
          hitNear += 1;
          if (o.sec > lastHit) lastHit = o.sec;
        }
      }
      if (hitNear >= 2) a[5] = Math.round(lastHit);
    }
  }
  /* 파괴 전파(지적: 파괴 판정이 약하다) — 생산·본진 건물이 무너지면 곁의 같은 임자
     비생산 건물(서플·파일런·테크류)도 같이 무너진 것으로 본다. 무너짐 어림(razedAt)은
     '그 자리에 공격이 몰렸나'를 보는데, 밀리는 기지에서 공격 클릭은 생산 건물에 몰리고
     곁 건물 위에는 따로 안 찍혀 홀로 살아남곤 했다. 비생산 건물로만 전파한다 — 생산
     건물은 제 판정(공격 뭉치·생산 신호)이 따로 있다. */
  const PROP_RADIUS_TILES = 10;
  const prodLike = new Set([
    "Command Center", "Nexus", "Hatchery", "Lair", "Hive",
    "Barracks", "Factory", "Starport", "Gateway", "Stargate", "Robotics Facility",
  ]);
  for (const a of builds) {
    // softEnd(모프·취소)는 무너진 게 아니다 — 레어 변태가 곁 풀·덴을 걷어 갔다(지적).
    if (a[5] <= 0 || !prodLike.has(a[3]) || softEnd.has(a)) continue;
    for (const b of builds) {
      if (b === a || b[4] !== a[4] || prodLike.has(b[3]) || softEnd.has(b)) continue;
      // 그 시각에 서 있던 것만 — 나중에 다시 지은 건물을 소급해 걷으면 안 된다.
      if (b[0] > a[5] || (b[5] > 0 && b[5] <= a[5])) continue;
      if (Math.hypot(a[1] - b[1], a[2] - b[2]) > PROP_RADIUS_TILES) continue;
      b[5] = b[5] > 0 ? Math.min(b[5], a[5]) : a[5];
    }
  }
  /* 홀의 함락(요청: 주변 생산 건물이 깨지면 기지도 파괴로 — 보통 기지를 먼저 깨지만 아닌
     경우도 있어 조심히, 시작 본진뿐 아니라 후에 지은 확장도 포함) — 곁(10타일)의 같은
     임자 생산 건물이 무너졌고, 그 무렵 홀 자신에게도 상대 공격이 두 발 이상 닿았을 때만
     같이 무너진 것으로 본다. 공격 근거 없이 전파하면 수비에 성공한 기지까지 걷는다. */
  const hallSet = new Set(["Command Center", "Nexus", "Hatchery", "Lair", "Hive"]);
  for (const a of builds) {
    if (a[5] <= 0 || !prodLike.has(a[3]) || hallSet.has(a[3]) || softEnd.has(a)) continue;
    for (const b of builds) {
      if (b === a || b[5] > 0 || b[4] !== a[4] || !hallSet.has(b[3])) continue;
      if (b[0] > a[5] || Math.hypot(a[1] - b[1], a[2] - b[2]) > PROP_RADIUS_TILES) continue;
      const foes = [...attacksByTeam.entries()]
        .filter(([team]) => team !== teamOfRaw.get(b[4]))
        .flatMap(([, list]) => list);
      let hitNear = 0;
      let lastHit = 0;
      for (const o of foes) {
        if (Math.abs(o.sec - a[5]) <= 60 && Math.hypot(o.x - b[1], o.y - b[2]) <= RAZE_RADIUS) {
          hitNear += 1;
          if (o.sec > lastHit) lastHit = o.sec;
        }
      }
      if (hitNear >= 2) b[5] = Math.round(Math.max(lastHit, a[5]));
    }
  }
  builds.sort((a, b) => a[0] - b[0]);
  casts.sort((a, b) => a[0] - b[0]);
  return { v: 1, step: STEP_SEC, players: tracks, builds, casts };
}

/** 공중 유닛인가 — 이름표에 ✈ 같은 표기를 따로 안 쓰지만, 부대 표기의 결(지상/공중)을
 *  플레이어가 알고 싶을 때 쓴다. (지금은 미사용 — 자리만 마련해 둔다.) */
export const isAirUnit = (unit: string): boolean => AIR_UNITS.has(unit) && !CASTER_UNITS.has(unit);
