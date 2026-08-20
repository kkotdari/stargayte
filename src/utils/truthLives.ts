/* 참값 자취 → 재생 화면이 읽는 **생애** 목록 ────────────────────────────────────
 *
 * 여기 있던 것은 원래 `truthToV2`라는 **어댑터**였다. 화면이 오래도록 `UnitTracksV2`라는
 * 표를 먹고 살았기 때문이다 — 그 표는 브라우저가 리플레이 **명령에서 유추해** 만든
 * 것이었고, 유닛이 어디 있는지를 증거로 좁히느라 '증거(ev)'라는 숫자 갈래 스무 가지를
 * 달고 있었다(0 이동명령·1 남이 찍은 자리·3 멈춤·4 생산·10 수리·12 승선·17 추정 자리…).
 *
 * 이제 서버가 그 경기를 실제로 돌려 참값을 굽는다. 유추할 것이 없으니 그 갈래도 대부분
 * 필요 없다 — **참값이 내놓을 수 있는 것은 일곱뿐**이었다(건설 2 · 착륙 5 · 이륙 6 ·
 * 시즈 8·9 · 이동 0 · 공격 7). 나머지 열몇 갈래는 어댑터가 **한 번도 안 만들었고**,
 * 그것을 읽던 화면 쪽 코드도 그만큼 늘 빈손이었다. 어댑터를 걷으며 그 죽은 갈래와
 * 그것을 읽던 자리를 함께 걷었다.
 *
 * 그래서 이 파일은 어댑터가 아니다. 참값이 아는 것을 **이름 붙여** 내놓을 뿐이다:
 * 숫자 갈래 대신 `sites`·`lifts`·`sieges`·`orders`라는 칸이 있고, 그 넷이 전부다.
 *
 * ── 왜 '트랙'이 아니라 '생애'인가
 * 자취의 한 트랙은 **번호(태그) 하나의 일생**이고, 그 안에서 유닛이 변태하면(라바→알→
 * 저글링, 애벌레→고치→뮤탈) 종류가 바뀐다. 화면은 그 토막마다 다른 몸을 그려야 하므로
 * 종류가 바뀌는 자리에서 잘라 **생애**로 나눈다. 시즈탱크만은 예외다 — 박히고 풀릴 때
 * 종류 번호가 바뀌지만(5 ↔ 30) 같은 탱크가 자세만 바꾼 것이라, 자르지 않고 자세 바뀜
 * (`sieges`)으로 적는다.
 */
import { BUILDING_FOOT } from "./bwUnits";
import { BW_UNIT_NAME } from "./bwUnitNames";
import { TRUTH_ST_GONE, type TruthTrack, type TruthTracks } from "./openbwTracks";

/** 시즈탱크의 두 자세 — 종류 번호가 바뀌지만 같은 몸이다. */
const TANK_ID = 5;
const TANK_SIEGE_ID = 30;

/** 건물 이름인가 — 발자국 표에 있으면 건물이다(그 표가 곧 건물 목록이다). */
const isBuilding = (kind: string): boolean => BUILDING_FOOT[kind] !== undefined;

/** 이 유닛이 다 지어지는 데 걸리는 초 — 처음부터 서 있던 건물의 '착공 시각'을 되짚는 데 쓴다. */
export type BuildSecOf = (kind: string) => number;

/** 건물이 앉은 자리 [초, 발자국 좌상단 타일 x, y] — 처음 지은 자리와, 떠서 옮겨 앉은 자리. */
export type LifeSite = [number, number, number];
/** 이 유닛에게 떨어진 명령 [초, 타일 x, 타일 y, 공격인가]. */
export type LifeOrder = [number, number, number, boolean];

/** 한 몸의 한 생애. */
export type TruthLife = {
  /** 유닛 번호(태그) — 변태로 갈린 생애들은 같은 번호를 나눠 쓴다. */
  tag: number;
  /** 주인(시뮬 안 임자 번호). */
  owner: number;
  /** 정체(스크렙과 같은 유닛 이름). */
  kind: string;
  /** 태어난 초. */
  born: number;
  /** 사라진 초 — 끝까지 살아 있었으면 null. */
  died: number | null;
  /** 끝난 갈래 — "morph" 다음 생애로 이어짐 · "atk" 사라짐 · "" 끝까지 삶. */
  end: "morph" | "atk" | "";
  /** 건물인가. */
  bld: boolean;
  /** 앉은 자리들 — 첫째가 처음 지은 자리, 그 뒤는 옮겨 앉은 자리다. 건물만 갖는다. */
  sites: LifeSite[];
  /** 떠오른 초들 — 착륙(sites)과 짝이 된다. */
  lifts: number[];
  /** 자세 바뀜 [초, 박혔나] — 시즈탱크만 갖는다. */
  sieges: [number, boolean][];
  /** 떨어진 명령들 — 마우스 자국과 선택 링이 이것으로 선다. */
  orders: LifeOrder[];
  /** 체력 변곡점 [초, 남은 체력(실드 포함, 실제 수치)]. */
  hp?: [number, number][];
  /** 캐리어 인터셉터 수 변곡점 [초, 개수]. */
  ic?: [number, number][];
};

/** 참값 한 판이 아는 사람·사건 — 화면이 자취 곁에서 읽는 것 전부. */
export type TruthWorld = {
  players: { owner: number; name: string; race: "" | "테란" | "저그" | "프로토스";
    color: string; team: number }[];
  lives: TruthLife[];
  /** 연구가 실제로 올라간 [초, 이름, 임자]. */
  ups: [number, string, number][];
  /** 좌표가 남는 마법 [초, x, y, 기술, 임자]. */
  casts: [number, number, number, string, number][];
  /** 미니맵 핑 [초, x, y, 임자]. */
  pings: [number, number, number, number][];
};

const RACE_OF: Record<number, "" | "테란" | "저그" | "프로토스"> =
  { 0: "저그", 1: "테란", 2: "프로토스" };

/** 트랙 하나를 생애들로 가른다 — 종류가 바뀌는 자리가 곧 경계다(시즈는 빼고). */
function livesOfTrack(
  tr: TruthTrack, orders: Map<number, [number, number, number, number][]>,
  buildSecOf: BuildSecOf,
): TruthLife[] {
  const n = tr.types.length;
  if (n === 0) return [];
  const out: TruthLife[] = [];
  /* 시즈 자세 바뀜은 생애를 안 가른다 — 같은 탱크가 박혔다 풀린 것이다. 먼저 뽑아
     두고, 아래 자르기에서는 두 번호를 한 종류로 본다. */
  const sieges: [number, boolean][] = [];
  const same = (t: number): number => (t === TANK_SIEGE_ID ? TANK_ID : t);
  for (let i = 1; i < n; i += 1) {
    if (tr.types[i] === tr.types[i - 1]) continue;
    if (same(tr.types[i]) !== same(tr.types[i - 1])) continue;
    sieges.push([tr.keys[i * 5], tr.types[i] === TANK_SIEGE_ID]);
  }
  // 종류가 (시즈를 뺀 뒤에도) 바뀌는 자리 = 생애 경계.
  const cuts: number[] = [];
  for (let i = 1; i < n; i += 1) if (same(tr.types[i]) !== same(tr.types[i - 1])) cuts.push(i);
  cuts.push(n);

  let segStart = 0;
  for (let ci = 0; ci < cuts.length; ci += 1) {
    const end = cuts[ci];
    const kind = BW_UNIT_NAME[tr.types[segStart]] ?? `?${tr.types[segStart]}`;
    const born = tr.keys[segStart * 5];
    const lastIdx = end - 1;
    const lastT = tr.keys[lastIdx * 5];
    const gone = tr.keys[lastIdx * 5 + 4] === TRUTH_ST_GONE;
    const more = ci < cuts.length - 1;
    const bld = isBuilding(kind);

    const sites: LifeSite[] = [];
    const lifts: number[] = [];
    if (bld) {
      /* 자취의 자리는 **몸 한가운데**다(BW의 unit.position). 화면의 건물 층은 발자국
         **좌상단 타일**을 기준으로 그리므로 반 발자국을 뺀다 — 안 빼면 건물이 통째로
         오른아래로 밀린다(지적: "건물들 위치가 조금 틀림 우하단으로 쏠린느낌"). */
      const foot = BUILDING_FOOT[kind] ?? [3, 2];
      const bx = tr.keys[segStart * 5 + 1] - foot[0] / 2;
      const by = tr.keys[segStart * 5 + 2] - foot[1] / 2;
      /* 처음부터 서 있던 건물인가 — 참값이 키마다 '다 지어졌나'를 준다. 다만 그 비트만
         믿으면 안 된다(지적: "아직도 스타팅 홀 건설되면서 시작한다구"): 시작 본진은
         자취의 첫 키가 0초가 아닐 수 있고, 그러면 done이 1이어도 born > 0이라 화면이
         그때부터 짓는 장면을 그린다. 경기 첫 1초 안에 나타난 건물은 지을 시간 자체가
         없다(가장 빠른 건물도 15초) — 그런 것은 처음부터 서 있던 것으로 본다. */
      const raising = tr.done[segStart] === 0 && born > 1;
      sites.push([raising ? born : born - buildSecOf(kind), bx, by]);
      /* 이륙·착륙 — 건물이 자리를 옮겼으면 뜬 것이다. 참 자취가 그 사이를 다 그리므로
         뜬 때와 앉은 때만 찍어 주면 화면이 그 둘로 장면을 만든다. */
      let px = tr.keys[segStart * 5 + 1];
      let py = tr.keys[segStart * 5 + 2];
      let flying = false;
      for (let i = segStart + 1; i < end; i += 1) {
        const x = tr.keys[i * 5 + 1];
        const y = tr.keys[i * 5 + 2];
        const moved = Math.abs(x - px) > 0.4 || Math.abs(y - py) > 0.4;
        if (moved && !flying) { flying = true; lifts.push(tr.keys[i * 5]); }
        else if (!moved && flying) {
          flying = false;
          sites.push([tr.keys[i * 5], x - foot[0] / 2, y - foot[1] / 2]);
        }
        px = x; py = y;
      }
    }
    const mine: LifeOrder[] = [];
    for (const o of orders.get(tr.tag) ?? []) {
      if (o[0] >= born && o[0] <= lastT) mine.push([o[0], o[1], o[2], o[3] === 7]);
    }
    out.push({
      tag: tr.tag,
      owner: tr.owner,
      kind,
      born,
      died: more || gone ? lastT : null,
      end: more ? "morph" : gone ? "atk" : "",
      bld,
      sites,
      lifts,
      // 시즈는 이 생애의 구간에 든 것만.
      sieges: sieges.filter(([s]) => s >= born && s <= lastT),
      orders: mine,
      hp: tr.hp?.filter(([t]) => t >= born && t <= lastT),
      ic: tr.ic?.filter(([t]) => t >= born && t <= lastT),
    });
    segStart = end;
  }
  return out;
}

/** 참값 한 판 → 화면이 읽는 사람·생애·사건. */
export function truthWorld(truth: TruthTracks, buildSecOf: BuildSecOf): TruthWorld {
  const lives: TruthLife[] = [];
  for (const tr of truth.tracks) lives.push(...livesOfTrack(tr, truth.orders, buildSecOf));
  return {
    /* 임자 번호는 자취의 것을 그대로 쓴다 — 표와 자취가 **같은 곳에서** 오므로 둘만
       짝이 맞으면 된다. 화면 로스터와는 이름으로 잇는다. */
    players: truth.players.map((pl) => ({
      owner: pl.owner,
      name: pl.name,
      race: RACE_OF[pl.race] ?? "",
      color: pl.color,
      team: pl.force,
    })),
    lives,
    ups: truth.ups,
    casts: truth.casts,
    pings: truth.pings,
  };
}
