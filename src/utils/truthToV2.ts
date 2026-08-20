/* 참값 자취를 재생 화면이 먹는 꼴로 빚는다 ────────────────────────────────────
 *
 * 재생 화면은 오래도록 `UnitTracksV2`라는 꼴을 먹고 살았다. 그 표는 브라우저가 리플레이
 * 명령에서 **유추**해 만든 것이었다 — 리플레이에는 유닛이 안 들어 있고 사람이 누른 명령만
 * 있어서, "이 번호가 무슨 유닛이고 지금 어디 있나"를 증거로 좁히는 수밖에 없었다.
 *
 * 이제 서버가 그 경기를 실제로 돌려 참값을 구워 준다. 유추할 것이 없다. 그래서 유추하던
 * 표를 걷어내되, **꼴은 그대로 두고 속만 참값으로 갈아 끼운다** — 그 표를 읽는 자리가
 * 화면 곳곳에 수백 군데라, 꼴까지 바꾸면 고칠 데가 끝이 없고 그만큼 깨뜨릴 데도 많다.
 *
 * ── 유추가 만들던 것 중 여기서 없어지는 것
 *
 * v2의 '증거(ev)'는 대부분 **유추의 발판**이었다. 이동 명령 목적지(0)·남이 찍은 자리(1)
 * ·공격 목적지(7) 따위는 "유닛이 아마 여기 있을 것"을 좁히려고 모은 것이라, 참 자리가
 * 있는 지금은 쓸 데가 없다. 그래서 안 만든다.
 *
 * 남기는 것은 화면이 **자리 말고 다른 것을 알아야** 하는 셋뿐이다:
 *   2  건설 자리   — 건물이 처음 선 자리(건물 층이 이걸로 그린다)
 *   5·6 착륙·이륙  — 띄운 건물이 옮겨 앉는 장면
 *   8·9 시즈 켬·끔 — 탱크가 박히고 풀리는 장면
 * 셋 다 참 자취에서 곧장 읽어 낸다: 건물이 자리를 옮겼으면 이륙·착륙이고, 유닛 종류가
 * 시즈모드로 바뀌었으면 시즈다.
 */
import { BLD_STATS, type UnitEnt, type UnitEv, type UnitTracksV2 } from "../legacy/replayUnits";
import type { Race } from "../types";
import { BW_UNIT_NAME } from "./bwUnitNames";
import { TRUTH_ST_GONE, type TruthTracks } from "./openbwTracks";

/* 시즈탱크는 박힐 때 **유닛 종류 자체가 바뀐다**(5 ↔ 30). 다른 종류 바뀜(라바→알→저글링)은
   생애가 이어지는 변태라 개체를 갈라 주지만, 시즈는 같은 탱크가 자세만 바꾼 것이라 가르면
   체력바와 고르기가 끊긴다. 그래서 이 짝만 따로 알아본다(영웅 에드먼드 듀크도 같다). */
const SIEGE_ON = new Set([30, 31, 25, 26]);
const SIEGE_OFF = new Set([5, 6, 24, 27]);
const isSiegePair = (a: number, b: number): boolean =>
  (SIEGE_OFF.has(a) && SIEGE_ON.has(b)) || (SIEGE_ON.has(a) && SIEGE_OFF.has(b));

const RACE_OF: Record<number, Race> = { 0: "저그", 1: "테란", 2: "프로토스" };

/** 건물인가 — 이름표로 가린다(참값은 종류 번호를 주고, 화면은 이름으로 산다). */
const isBuilding = (kind: string): boolean => !!BLD_STATS[kind];

/** 자취 하나를 v2 개체 하나 이상으로 편다. 변태는 생애가 갈리므로 개체도 갈린다. */
function entsOfTrack(tr: TruthTracks["tracks"][number]): UnitEnt[] {
  const n = tr.types.length;
  if (!n) return [];
  const out: UnitEnt[] = [];
  /* 종류가 바뀌는 자리에서 자른다 — 다만 시즈 자세 바뀜은 자르지 않고 증거로 남긴다. */
  let segStart = 0;
  const sieges: UnitEv[] = [];
  const cuts: number[] = [];
  for (let i = 1; i < n; i += 1) {
    if (tr.types[i] === tr.types[i - 1]) continue;
    if (isSiegePair(tr.types[i - 1], tr.types[i])) {
      sieges.push([tr.keys[i * 5], -1, -1, SIEGE_ON.has(tr.types[i]) ? 8 : 9]);
      continue;
    }
    cuts.push(i);
  }
  cuts.push(n);

  for (let ci = 0; ci < cuts.length; ci += 1) {
    const end = cuts[ci];                     // 이 토막의 끝(제외)
    const type = tr.types[segStart];
    const kind = BW_UNIT_NAME[type] ?? `?${type}`;
    const born = tr.keys[segStart * 5];
    const lastIdx = end - 1;
    const lastT = tr.keys[lastIdx * 5];
    const gone = tr.keys[lastIdx * 5 + 4] === TRUTH_ST_GONE;
    const more = ci < cuts.length - 1;        // 뒤에 다음 생애가 있나(=변태)
    const bld = isBuilding(kind);

    const ev: UnitEv[] = [];
    if (bld) {
      // 건설 자리 — 이 생애의 첫 자리다.
      ev.push([born, tr.keys[segStart * 5 + 1], tr.keys[segStart * 5 + 2], 2]);
      /* 이륙·착륙 — 건물이 자리를 옮겼으면 뜬 것이다. 참 자취가 그 사이를 다 그리므로
         뜬 때와 앉은 때만 찍어 주면 된다(화면은 그 둘로 장면을 만든다). */
      let px = tr.keys[segStart * 5 + 1];
      let py = tr.keys[segStart * 5 + 2];
      let flying = false;
      for (let i = segStart + 1; i < end; i += 1) {
        const x = tr.keys[i * 5 + 1];
        const y = tr.keys[i * 5 + 2];
        const moved = Math.abs(x - px) > 0.4 || Math.abs(y - py) > 0.4;
        if (moved && !flying) { flying = true; ev.push([tr.keys[i * 5], -1, -1, 6]); }
        else if (!moved && flying) { flying = false; ev.push([tr.keys[i * 5], x, y, 5]); }
        px = x; py = y;
      }
    }
    for (const s of sieges) if (s[0] >= born && s[0] <= lastT) ev.push(s);
    ev.sort((a, b) => a[0] - b[0]);

    out.push({
      t: tr.tag,
      o: tr.owner,
      k: kind,
      b: born,
      d: more || gone ? lastT : null,
      dk: more ? "morph" : gone ? "atk" : "",
      bld: bld ? 1 : 0,
      /* 체력·인터셉터는 트랙 전체 것이라 이 생애의 구간만 잘라 준다. */
      hp: tr.hp?.filter(([t]) => t >= born && t <= lastT),
      ic: tr.ic?.filter(([t]) => t >= born && t <= lastT),
      ev,
    });
    segStart = end;
  }
  return out;
}

/** 참값 → 재생 화면이 먹는 표. 자리는 자취에서 오고, 이 표는 그 곁의 사실만 담는다. */
export function truthToV2(truth: TruthTracks): UnitTracksV2 {
  /* 지도가 놓아 준 자원은 덤퍼가 이미 뺐다(화면이 지도에서 그린다). */
  const ents: UnitEnt[] = [];
  for (const tr of truth.tracks) ents.push(...entsOfTrack(tr));
  return {
    v: 2,
    /* 임자 번호를 그대로 쓴다 — 옛 표는 리플레이 분석기(screp)의 번호를 썼지만, 이제 표와
       자취가 **같은 곳에서** 오므로 둘만 짝이 맞으면 된다. 화면 로스터와는 이름으로 잇는다. */
    players: truth.players.map((pl) => ({
      id: pl.owner,
      name: pl.name,
      race: RACE_OF[pl.race] ?? "",
      color: pl.color,
      team: pl.force,
    })),
    ents,
    /* 옛 표는 '연구를 누른 때'(ups)와 '끝난 때'(upsDone)를 따로 뒀다 — 끝나는 때를 몰라
       눌린 때에서 셈해야 했기 때문이다. 참값은 실제로 올라간 순간을 알므로 둘이 같다. */
    ups: truth.ups,
    upsDone: truth.ups,
    casts: truth.casts,
    pings: truth.pings,
    /* 유추가 얼마나 맞았나를 세던 칸 — 유추를 안 하니 셀 것이 없다. 꼴을 지키려고
       0으로 채운다(화면은 이 칸을 안 그린다; 개발 중 콘솔에만 찍혔다). */
    stats: { cmds: 0, attributed: 0, anchors: 0, lives: ents.length, tags: truth.tracks.length },
  };
}
