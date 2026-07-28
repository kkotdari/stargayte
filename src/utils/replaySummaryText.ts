import { ga, neun, reul, ro, wa } from "./korean";
import { isReplaySummaryData, type ReplaySummaryBeat, type ReplaySummaryData } from "./replaySummaryData";

// 저장된 요약 데이터(replaySummaryData.ts)를 사람이 읽는 문단으로 옮긴다.
//
// 이 파일이 요약의 '말'을 독점한다 — 유닛·건물·테크의 한국어 표기도, 전술 설명 문구도 전부
// 여기에만 있다. 그래서 표현을 고치고 싶으면 여기만 고치면 되고, 이미 등록된 경기들도 다음
// 조회부터 새 문구로 읽힌다(요청). 이름은 저장된 게임 아이디를 호출부가 지금의 회원 연결로
// 풀어서(resolveName) 넘겨주므로 닉네임 변경도 자동으로 따라온다.

// ── 표기 ──────────────────────────────────────────────────────────────────
// screp 영문명 → 한국어 통용 표기. 여기 없는 유닛은 문장에 쓰지 않는다 — 영문명을 그대로
// 노출하면 어색하고, UMS 맵의 영웅 유닛까지 새어 나온다.
export const UNIT_KO: Record<string, string> = {
  Marine: "마린", Firebat: "파이어뱃", Medic: "메딕", Ghost: "고스트",
  Vulture: "벌처", Goliath: "골리앗",
  "Siege Tank (Tank Mode)": "탱크", "Siege Tank (Siege Mode)": "탱크",
  Wraith: "레이스", Dropship: "드랍십", "Science Vessel": "사이언스베슬",
  Battlecruiser: "배틀크루저", Valkyrie: "발키리", "Nuclear Missile": "핵",
  Zealot: "질럿", Dragoon: "드라군", "High Templar": "하이템플러",
  "Dark Templar": "다크템플러", Archon: "아콘", "Dark Archon": "다크아콘",
  Reaver: "리버", Shuttle: "셔틀", Observer: "옵저버", Scout: "스카웃",
  Corsair: "커세어", Carrier: "캐리어", Arbiter: "아비터",
  Zergling: "저글링", Hydralisk: "히드라", Lurker: "러커", Ultralisk: "울트라",
  Mutalisk: "뮤탈", Scourge: "스커지", Guardian: "가디언", Devourer: "디바우러",
  Queen: "퀸", Defiler: "디파일러", "Infested Terran": "감염된 테란",
};

/** 등장만으로도 이야깃거리가 되는 '한 방' 유닛 — 맺음말 머리에 세운다. */
export const SPECTACLE_UNITS: Record<string, string> = {
  "Nuclear Missile": "핵까지 등장한",
  Battlecruiser: "배틀크루저가 뜬",
  Carrier: "캐리어가 뜬",
  Guardian: "가디언이 뜬",
  Ultralisk: "울트라가 나온",
  Arbiter: "아비터까지 간",
  "Dark Archon": "다크아콘이 나온",
};

export const TECH_KO: Record<string, string> = {
  "Psionic Storm": "스톰", "Stim Packs": "스팀팩", Lockdown: "락다운",
  "Spider Mines": "마인", "Lurker Aspect": "럴커", Burrowing: "버로우",
  Irradiate: "이레디에이트", "Yamato Gun": "야마토", Recall: "리콜",
  "Stasis Field": "스테이시스", Consume: "컨슘", "Dark Swarm": "다크스웜",
  Plague: "플레이그", Hallucination: "환상", "Mind Control": "마인드컨트롤",
  Cloaking: "클로킹", "Personnel Cloaking": "클로킹",
};

/** 방어 건물 — "질럿과 성큰으로 막아섰지만 실패"처럼 유닛과 함께 말한다. */
export const DEFENSE_KO: Record<string, string> = {
  "Sunken Colony": "성큰", "Spore Colony": "스포어",
  Bunker: "벙커", "Missile Turret": "터렛", "Photon Cannon": "포토",
};

/** 확장 건물 — "멀티 5개"가 아니라 "5해처리"로 말한다. */
/** 생산 건물 — 몇 개까지 늘렸나로 규모 차이를 말한다(요청: 팩토리/게이트웨이/해처리 비교). */
export const PRODUCTION_KO: Record<string, string> = {
  Gateway: "게이트", Factory: "팩토리", Barracks: "배럭", Starport: "스타포트",
  "Robotics Facility": "로보", Hatchery: "해처리",
};

export const EXPANSION_KO: Record<string, string> = {
  Hatchery: "해처리", Nexus: "넥서스", "Command Center": "커맨드",
};

/** 혼자서는 경기를 끝내지 못하는 보조 유닛(지적) — 이 유닛만으로 "메딕 물량으로 이김"
 *  같은 문장이 나오면 곤란하다. 주력을 고를 때 뒤로 밀고, 문장에서는 늘 무엇과의 조합인지
 *  함께 말한다. */
export const SUPPORT_UNITS = new Set([
  "Medic", "Queen", "Defiler", "Science Vessel", "Observer", "Shuttle", "Dropship",
  "Arbiter", "Dark Archon", "Overlord",
]);

/** 유닛이 경기에서 하는 '역할' — 같은 승리라도 무엇으로 이겼는지에 따라 다르게 읽히도록. */
export const UNIT_ROLE: Record<string, string> = {
  "High Templar": "견제", "Dark Templar": "견제", Reaver: "견제", Mutalisk: "견제",
  Vulture: "견제", Dropship: "드랍", Shuttle: "드랍", Lurker: "매복", Ghost: "저격",
  Defiler: "마법", "Science Vessel": "마법", Arbiter: "마법", "Dark Archon": "마법", Queen: "마법",
  Carrier: "공중 장악", Battlecruiser: "공중 장악", Guardian: "공중 장악",
  Wraith: "공중 견제", Valkyrie: "제공권", Corsair: "제공권", Scourge: "제공권", Devourer: "제공권",
  Ultralisk: "돌파", Archon: "돌파", Zealot: "돌파", Firebat: "돌파",
  "Siege Tank (Tank Mode)": "자리 잡기", "Siege Tank (Siege Mode)": "자리 잡기",
  Zergling: "물량", Hydralisk: "물량", Marine: "물량", Dragoon: "물량", Goliath: "물량",
  Medic: "물량", Scout: "공중 견제", "Infested Terran": "자폭",
};

/** 역할별 맺음말 — 뜻에 맞춰 갈라 두면 같은 문장이 반복되지 않는다. */
const ROLE_TAIL: Record<string, string> = {
  견제: "승기를 잡음", "공중 견제": "승기를 잡음", 매복: "승기를 잡음", 저격: "승기를 잡음",
  드랍: "흔들어 놓음", 마법: "판을 갈랐음", 자폭: "판을 갈랐음",
  "공중 장악": "굳히기", 제공권: "굳히기", 돌파: "굳히기",
  물량: "밀어붙임", "자리 잡기": "밀어붙임",
};

// ── 문장 만들기 ────────────────────────────────────────────────────────────

/** "질럿으로" / "질럿과 하이템플러 조합으로" — 조합을 못 읽으면 빈 문자열. */
export function unitPhrase(units: string[]): string {
  // 보조 유닛은 뒤로 — "메딕과 마린 조합"이 아니라 "마린과 메딕 조합"이라야 읽힌다(지적).
  const sorted = [...units].sort(
    (a, b) => Number(SUPPORT_UNITS.has(a)) - Number(SUPPORT_UNITS.has(b))
  );
  const ko = sorted.map((u) => UNIT_KO[u]).filter(Boolean);
  if (ko.length === 0) return "";
  // 보조 유닛 하나뿐이면 그것만으로 이겼다고 할 수 없다 — '~도 썼다'까지만 말한다(지적).
  if (ko.length === 1) {
    return SUPPORT_UNITS.has(sorted[0]) ? `${ko[0]}도 섞어` : ro(ko[0]);
  }
  return `${wa(ko[0])} ${ko[1]} 조합으로`;
}

/** "유비의 마린, 관우의 저글링으로" / "유비·관우의 마린으로" / "2인 팀의 마린 몰아치기로".
 *  팀 승리를 한 사람 몫으로 돌리지 않기 위한 것이다(요청). 재료가 모자라면 빈 문자열. */
function teamPhrase(c: Ctx): string {
  const names = c.whoList;
  const leads = list(c.p.teamUnits);
  const comps = list(c.p.teamComp).map((x) => x.split("|"));
  if (leads.length < 2 || names.length !== leads.length) return "";

  // 주력이 같은 사람끼리 묶는다(요청) — 같은 그림으로 싸운 사람을 따로 늘어놓으면
  // 문장만 길어지고, 묶으면 "정구, 브래드의 마린 메딕 조합"처럼 한 덩어리로 읽힌다.
  const groups: { key: string; names: string[]; units: string[] }[] = [];
  names.forEach((n, i) => {
    const g = groups.find((x) => x.key === leads[i]);
    const own = comps[i] ?? [leads[i]];
    if (g) {
      g.names.push(n);
      for (const u of own) if (!g.units.includes(u)) g.units.push(u);
    } else {
      groups.push({ key: leads[i], names: [n], units: [...own] });
    }
  });

  // 다들 같은 그림으로 싸웠고 사람도 많으면, 이름을 다 부르는 대신 팀으로 뭉뚱그린다.
  // 다만 "힘을 모아"로 끝내면 무엇으로 이겼는지가 빠진다(지적) — 종족과 무관하게 그 편이
  // 함께 쓴 조합을 앞세워 말한다.
  if (groups.length === 1 && names.length >= 4) {
    const ko = groups[0].units.map((u) => UNIT_KO[u]).filter(Boolean).slice(0, 3);
    const team = `${names.length}인 팀`;
    if (ko.length === 0) return c.pick([`${team}이 힘을 모아`, `${names.join("·")} 팀이 함께 밀어붙여`]);
    const combo = ko.length >= 2 ? `${ko.join(" ")} 조합` : ko[0];
    return c.pick([
      `${team}이 ${reul(combo)} 필두로`,
      `${team}이 ${reul(combo)} 앞세워`,
      `${names.join("·")} 팀이 ${ro(combo)} 몰아쳐`,
    ]);
  }
  // 많이 뽑은 쪽부터 세 무리까지 말한다 — 그 이상은 문장만 길어진다.
  const shown = groups.slice(0, 3);
  const parts = shown.map((g) => {
    const many = g.names.length > 1;
    const ko = g.units.map((u) => UNIT_KO[u]).filter(Boolean).slice(0, many ? 3 : 2);
    if (ko.length === 0) return "";
    const who = g.names.join(", ");
    return many ? `${who}의 ${ko.join(" ")} 조합` : `${who}의 ${ko.join(" ")}`;
  }).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return ro(parts[0]);
  const head = parts.slice(0, -1).join(", ");
  return ro(`${wa(head)} ${parts[parts.length - 1]}`);
}

/** 이어받는 맺음말의 앞머리 — "결국 마린과 메딕 조합으로 " / "계속된 마린 공격으로 ". */
function contPhrase(units: string[], pick: (o: string[]) => string): string {
  const sorted = [...units].sort(
    (a, b) => Number(SUPPORT_UNITS.has(a)) - Number(SUPPORT_UNITS.has(b))
  );
  const ko = sorted.map((u) => UNIT_KO[u]).filter(Boolean);
  if (ko.length === 0) return "";
  if (ko.length === 1) {
    return pick([`계속된 ${ko[0]} 공격으로 `, `결국 ${ro(ko[0])} `, `${ko[0]}을 계속 뽑아 `]);
  }
  return pick([
    `결국 ${wa(ko[0])} ${ko[1]} 조합으로 `,
    `계속된 ${ko[0]} 공격으로 `,
    `${reul(ko[0])} 계속 뽑아 ${ko[1]}과 함께 `,
  ]);
}

interface Ctx {
  /** 이름들을 이미 합쳐 놓은 것("조조" 또는 "조조·유비"). */
  who: string;
  /** 합치기 전의 이름들 — 팀 승리를 "유비의 마린, 관우의 저글링"으로 말할 때 쓴다. */
  whoList: string[];
  who2: string;
  /** 당한 쪽 — 없으면 빈 문자열이고, 그때는 대상을 뺀 표현을 쓴다. */
  whom: string;
  won: boolean;
  p: Record<string, unknown>;
  /** 진 편의 마지막 문장인가 — 그때만 "경기는 내줌" 같은 결말을 말할 수 있다. */
  last: boolean;
  /** 여러 표현 중 하나를 고른다 — 같은 경기는 늘 같은 것이 나온다(아래 variantSeed 참고). */
  pick: (opts: string[]) => string;
}

const num = (v: unknown, fallback = 0): number => (typeof v === "number" ? v : fallback);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

// 같은 전황이라도 경기마다 다른 문장이 나오게 표현을 여러 개 준비해 두고 하나를 고른다
// (요청: 지루하지 않게, 대신 장황하지 않게). 고르는 건 난수가 아니라 그 beat 내용의 해시다 —
// 난수로 하면 같은 경기를 다시 볼 때마다 글이 바뀌어서 읽는 사람이 헷갈린다.
// FNV-1a: 짧고 분포가 고르다.
function variantSeed(b: ReplaySummaryBeat): number {
  const src = `${b.k}|${(b.who ?? []).join(",")}|${b.at ?? ""}|${JSON.stringify(b.p ?? {})}`;
  let h = 2166136261;
  for (let i = 0; i < src.length; i += 1) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type Tpl = (c: Ctx) => string | null;

/** "조조에게 " — 당한 쪽을 앞에 붙인다. 1:1이 아니면 누가 당했는지 알 수 없어 빈 문자열이고,
 *  그때는 대상을 뺀 표현으로 문장이 그대로 성립한다(요청: 당한 쪽을 말하면 한 쪽도 함께). */
function targetPhrase(c: Ctx): string {
  return c.whom ? `${c.whom}에게 ` : "";
}

/** "조조의 진영에 " — 드랍을 받은 쪽. 마찬가지로 1:1에서만 값이 있다. */
function victimPhrase(c: Ctx): string {
  return c.whom ? `${c.whom}의 진영에 ` : "";
}

// 전술 문장이 말할 수 있는 것과 없는 것(지적: 9드론 러시를 간 건 알아도 본진을 초토화했는지는
// 모른다). 커맨드에 남는 건 '무엇을 언제 얼마나 했나'뿐이고, 그게 통했는지·상대가 어떻게
// 됐는지는 리플레이에 없다. 그래서 전술 문장은 한 일만 말하고, 결과를 말해야 할 때는
// 확실한 사실 하나 — 그 경기를 누가 가져갔나 — 만 붙인다. "본진을 초토화" "앞마당을 헤집음"
// "그대로 태움" 같은 수식은 전부 걷어냈다(지적).
// "경기는 내줌"은 경기가 끝났다는 말이라 문단 중간에 나오면 어색하다(지적) — 진 편의
// 마지막 문장에서만 쓰고, 중간에는 그때까지의 흐름만 말한다.
const END_TAILS = [
  "경기는 내줌", "승부는 상대 쪽으로 넘어감", "판을 가져오지는 못함",
  "역부족이었음", "경기는 기움", "끝내 승부를 못 뒤집음",
];
const MID_TAILS = [
  "흐름은 상대에게 넘어감", "판이 조금씩 기울기 시작함", "소득은 크지 않았음",
  "재미를 보지 못함", "그만큼을 되찾지는 못함",
];
// 도박수(초반 올인)가 안 됐을 때만 쓰는 맺음 — 성공 여부를 단정하지 않는 선에서
// "실패함" "큰 피해는 못 줌"까지만 말한다(지적: 독이 됐다·발목을 잡았다는 지나치다).
const RISKY_TAILS = ["실패함", "큰 피해는 못 줌", "결국 망함", "소용없었음", "재미를 못 봄"];

// 진 편 문장은 "…뚫음, 경기는 내줌"처럼 끊어 붙이는 것보다 "…뚫었으나 경기는 내줌"으로
// 이어야 자연스럽다(지적). 한 일은 전부 명사형('-ㅁ')으로 써 두었으므로, 그 끝만 과거
// 연결형으로 바꾼다. 불규칙이 많아 규칙으로 만들지 않고 실제로 쓰는 끝만 적어 둔다 —
// 표에 없는 끝이 나오면 이어 붙이지 않고 쉼표로 두어, 틀린 말이 나오는 일은 없다.
const CONNECTIVE: [string, string][] = [
  ["막아섬", "막아섰으나"], ["막힘", "막혔으나"], ["나름", "날랐으나"], ["잡음", "잡았으나"], ["뚫음", "뚫었으나"],
  ["지음", "지었으나"], ["뽑음", "뽑았으나"], ["잠금", "잠갔으나"], ["얹혀삶", "얹혀살았으나"],
  ["감행함", "감행했으나"], ["함", "했으나"], ["줌", "줬으나"], ["씀", "썼으나"],
  ["섬", "섰으나"], ["춤", "췄으나"], ["굼", "궜으나"], ["김", "겼으나"],
  ["움", "웠으나"], ["림", "렸으나"], ["됨", "됐으나"], ["옴", "왔으나"],
  ["깜", "깠으나"], ["감", "갔으나"],
];

function toConnective(action: string): string | null {
  for (const [from, to] of CONNECTIVE) {
    if (action.endsWith(from)) return `${action.slice(0, -from.length)}${to}`;
  }
  return null;
}

/** 한 일 + (진 편이면) 결과 한 마디. 이어 붙일 수 있으면 "…뚫었으나 경기는 내줌"으로,
 *  못 이으면 쉼표로 둔다. */
const done = (c: Ctx, action: string, risky = false): string => {
  if (c.won) return action;
  const base = c.last ? END_TAILS : MID_TAILS;
  const t = c.pick(risky ? [...base, ...RISKY_TAILS] : base);
  const joined = toConnective(action);
  return joined ? `${joined} ${t}` : `${action}, ${t}`;
};

/** 한 일만 말하는 흔한 꼴 — 이긴 쪽/진 쪽 모두 같은 표현을 쓰고, 진 쪽에만 결과를 덧붙인다. */
const act = (actions: string[]): Tpl => (c) => `${ga(c.who)} ${done(c, c.pick(actions))}`;

/** 전술을 문장 안에서 부를 이름 — "3게이트 질럿 러쉬로 …"처럼 다른 문장에 끼워 넣을 때 쓴다.
 *  여기 없는 키는 '들이친 수'가 아니라는 뜻이라, 피해 문장 자체가 만들어지지 않는다. */
function tacticLabel(k: string, p: Record<string, unknown>): string {
  switch (k) {
    case "zling-rush": {
      const n = num(p.drones);
      return n > 0 ? `${n}드론 저글링 러쉬` : "초반 저글링 러쉬";
    }
    case "zealot-rush": {
      const g = num(p.gates, 2);
      return `${g === 2 ? "투게이트" : `${g}게이트`} 질럿 러쉬`;
    }
    case "cannon-rush": return "포토러쉬";
    case "sunken-rush": return "성큰러쉬";
    case "sneak-rax": return p.firebat ? "몰래 배럭 파이어뱃 러쉬" : "몰래 배럭";
    case "shuttle-reaver": return "리버 드랍";
    case "templar-drop": return "하이템플러 드랍";
    case "zerg-drop": return p.lurker ? "러커 드랍" : "히드라 드랍";
    case "dropship": return "드랍십 견제";
    case "shuttle": return "셔틀 견제";
    case "nydus": return "커널";
    case "recall": return "아비터 리콜";
    case "bionic": return "바이오닉 한 방";
    case "mech": return "메카닉 진출";
    case "moka": return "목동 저그";
    case "muta": return "뮤탈 견제";
    case "guardian": return "가디언";
    case "bc": return "배틀크루저";
    default: return "";
  }
}

const TEMPLATES: Record<string, Tpl> = {
  // 들이친 수와 그 결과를 한 문장으로(요청) — 그 타이밍에 상대 생산이 끊긴 게 근거다.
  "raid-damage": (c) => {
    const label = tacticLabel(str(c.p.k), c.p);
    if (!label) return null;
    const of = c.whom ? `${c.whom}의 ` : "상대 ";
    const foe = c.whom || "상대";
    // "Rex가 리버 드랍 한 방에"가 아니라 "Rex의 리버 드랍 한 방에"라야 읽힌다(지적) —
    // 그런 꼴은 주어까지 문장 안에서 만든다.
    const mine = `${c.who}의 ${label}`;
    // 초반 올인에 초반부터 무너진 그림(요청) — 몇 분 만이었는지가 곧 이야기다.
    if (c.p.early && !c.p.out) {
      const m = num(c.p.hitMin);
      const when = m > 0 ? `${m}분 만에 ` : "";
      return done(c, c.pick([
        `${ga(c.who)} ${ro(label)} ${when}${of}기지를 반쯤 파괴함`,
        `${mine} 한 방에 ${when}${ga(foe)} 무너짐`,
        `${ga(c.who)} ${ro(label)} ${when}${reul(foe)} 몰아붙임`,
      ]));
    }
    // 그 창 안에 실제로 탈락했으면(Leave Game) 짐작이 아니라 사실이다 — 그렇게 말한다.
    if (c.p.out) {
      const min = num(c.p.outMin);
      const when = min > 0 ? `${min}분경 ` : "";
      return done(c, c.pick([
        `${ga(c.who)} ${ro(label)} ${when}${reul(foe)} 엘리미네이트`,
        `${mine}에 ${when}${ga(foe)} 탈락`,
        `${ga(c.who)} ${ro(label)} ${when}${reul(foe)} 판에서 지움`,
      ]));
    }
    return done(c, c.pick([
      `${ga(c.who)} ${ro(label)} ${of}본진을 파괴함`,
      `${ga(c.who)} ${ro(label)} ${of}생산이 막힘`,
      `${mine} 한 방에 ${of}기지가 파괴됨`,
      `${ga(c.who)} ${ro(label)} ${of}살림을 통째로 흔듦`,
    ]));
  },

  // ── 전술(replayTactics) ──
  "zling-rush": (c) => {
    const n = num(c.p.drones);
    const build = n > 0 ? `${n}드론 저글링 러시` : "초반 저글링 러시";
    // 올인 표현은 '러시'를 갈아 끼운다 — "…저글링 러시 올인러시"가 되면 말이 겹친다.
    const allin = build.replace(/러시$/, "올인러시");
    const at = targetPhrase(c);
    return `${ga(c.who)} ${at}${done(c, c.pick([
      `${build}를 함`, `빠른 ${build}를 함`, `과감한 ${allin}를 함`,
      // 깎아내리는 말은 졌거나, 이겼더라도 한 종류만 주야장천 뽑았을 때만(지적).
      ...(c.won && !c.p.solo ? [] : [`무지성 ${build}를 함`]),
      ...(c.won ? [] : [`무리하게 ${build}를 함`]),
    ]), true)}`;
  },
  moka: act([
    "저글링·울트라에 다크스웜을 얹은 목동 저그로 싸움", "울트라까지 모아 목동 저그를 운용함",
    "예상치 못한 목동 저그를 꺼냄", "저글링·울트라 병력을 이끌고 진출함",
    "다크스웜 아래로 저글링·울트라를 모음",
    "목동 저그로 판을 굴림", "울트라를 앞세워 목동 저그로 밀어붙임",
  ]),
  swarm: act([
    "다크스웜을 깔고 들어감", "다크스웜 아래로 병력을 밀어 넣음", "다크스웜을 뿌리며 붙음",
    "다크스웜으로 총알을 지우고 싸움", "다크스웜을 깔아 놓고 전투에 임함",
  ]),
  devourer: act([
    "디바우러와 뮤탈을 섞어 공중을 노림", "뮤탈에 디바우러를 붙임", "디바우러를 섞어 제공권을 노림",
    "디바우러 뮤탈 조합으로 하늘 싸움을 걺", "공중 조합을 갖추고 제공권 싸움에 나섬",
  ]),
  lurker: act([
    "러커로 길목을 조임", "러커를 심어 길을 막음", "러커 조이기로 나감",
    "러커를 박아 놓고 자리를 굳힘", "러커로 진출로를 걸어 잠금",
  ]),
  bionic: (c) =>
    `${ga(c.who)} ${done(c, c.pick(
      c.p.tank
        ? ["마린·메딕에 탱크까지 붙인 바이오닉으로 싸움", "탱크를 붙인 바이오닉으로 공격함"]
        : ["마린·메딕 바이오닉 전략을 씀", "마린·메딕을 모아 바이오닉을 운용함",
           "마린·메딕 병력을 이끌고 진출함"]
    ))}`,
  mech: act([
    "탱크와 골리앗을 앞세운 메카닉으로 싸움", "메카닉으로 자리를 잡고 나감", "메카닉 전략을 씀",
    "탱크와 골리앗 병력을 이끌고 진출함", "탱크를 앞세워 한 걸음씩 조여 나감",
    "메카닉 병력을 모아 전투에 임함",
  ]),
  valkyrie: act([
    "발키리를 뽑아 오버로드를 사냥함", "발키리를 모아 제공권 싸움에 나섬",
    "예상치 못한 발키리로 하늘을 노림", "발키리를 띄워 하늘을 정리하려 함",
  ]),
  dropship: (c) => {
    const of = victimPhrase(c);
    return `${ga(c.who)} ${done(c, c.pick([
      `드랍십을 계속 돌려 ${of}병력을 떨굼`, `드랍 견제로 ${of}피해를 줌`,
    ]))}`;
  },
  "zealot-rush": (c) => {
    const g = num(c.p.gates, 2);
    const label = g === 2 ? "투게이트" : `${g}게이트`;
    const at = targetPhrase(c);
    return `${ga(c.who)} ${at}${done(c, c.pick([
      `${label} 질럿 러쉬를 함`, `빠른 ${label} 질럿 러쉬를 함`, `과감한 ${label} 질럿 올인 러쉬를 함`,
      ...(c.won && !c.p.solo ? [] : [`무지성 ${label} 질럿 러쉬를 함`]),
      ...(c.won ? [] : [`무리하게 ${label} 질럿 러쉬를 함`]),
    ]), true)}`;
  },
  "cannon-rush": (c) => {
    const at = targetPhrase(c);
    return `${ga(c.who)} ${at}${done(c, c.pick([
      "포토러쉬를 함", "초반 포토러쉬를 함", "빠른 포토러쉬를 시도함",
      "예상치 못한 포토러쉬를 함",
    ]), true)}`;
  },
  recall: act([
    "아비터를 띄우고 리콜까지 씀", "리콜로 병력을 뒤로 넘김", "과감한 아비터 리콜을 씀",
    "아비터 리콜로 뒤를 파고듦", "리콜 한 방으로 판을 흔들려 함",
  ]),
  // 리버 드랍 — 셔틀에 리버를 태워 일꾼을 지지는 그림(요청).
  "shuttle-reaver": (c) => {
    const of = victimPhrase(c);
    return `${ga(c.who)} ${done(c, c.pick([
      `${of}리버 드랍을 감행함`, `리버 드랍으로 ${of}일꾼을 잡아냄`,
      `셔틀에 리버를 태워 ${of}자원 줄을 끊음`,
    ]))}`;
  },
  // 하이템플러 드랍 — 스톰 한 방에 일꾼이 녹는다(요청).
  "templar-drop": (c) => {
    const of = victimPhrase(c);
    return `${ga(c.who)} ${done(c, c.pick([
      `${of}하이템플러 드랍을 감행함`, `${of}스톰으로 자원 줄을 끊음`,
      `템플러 드랍으로 ${of}일꾼을 섬멸함`, `${of}스톰을 뿌려 자원 수급을 방해함`,
    ]))}`;
  },
  // 러커/히드라 드랍 — 저그는 오버로드 수송 업그레이드가 곧 드랍 의도다(요청).
  "zerg-drop": (c) => {
    const kind = c.p.lurker ? "러커 드랍" : "히드라 드랍";
    const of = victimPhrase(c);
    return `${ga(c.who)} ${done(c, c.pick([
      `오버로드에 태운 ${kind}을 ${of}감행함`, `${kind}으로 ${of}피해를 줌`,
    ]))}`;
  },
  shuttle: (c) => {
    const of = victimPhrase(c);
    return `${ga(c.who)} ${done(c, c.pick([
      `${of}셔틀 드랍을 감행함`, `셔틀 견제로 ${of}피해를 줌`,
    ]))}`;
  },
  // ── 전황(replaySummary) ──
  // 진 편의 머리 문장 — 무엇으로 맞섰고 왜 안 됐나.
  stand: (c) => {
    const mode = str(c.p.mode);
    const phrase = unitPhrase(list(c.p.units));
    if (mode === "spectacle") {
      const u = UNIT_KO[str(c.p.unit)];
      if (!u) return null;
      // 몇 기까지 갔는지가 곧 그림이다(요청) — 한 부대면 그렇게 말한다.
      const n = num(c.p.n);
      const amount = n >= 12 ? "한 부대" : n >= 4 ? `${n}기` : "";
      return `${neun(c.who)} ${c.pick([
        ...(amount ? [`${reul(u)} ${amount} 뽑았으나 망함`, `${reul(u)} ${amount}나 뽑고도 재미를 못 봄`] : []),
        `${u} 등의 고급 유닛을 사용해 전투에 임했으나 판을 뒤집지 못함`,
        `${u}까지 꺼냈지만 판을 뒤집지 못함`,
        `${u}까지 갔지만 늦었음`,
      ])}`;
    }
    if (mode === "nothing") {
      return `${neun(c.who)} ${c.pick([
        "제대로 싸워보지 못하고 무너짐", "손 쓸 새도 없이 무너짐", "허무하게 당함",
        "싸워보지도 못하고 끝남", "시작하자마자 정리됨",
      ])}`;
    }
    if (!phrase) return null;
    if (mode === "pressed") {
      return `${neun(c.who)} ${c.pick([
        `초반을 잡고 흔들었지만 ${phrase} 굳히지 못함`,
        `초반 주도권을 쥐고도 ${phrase} 마무리하지 못함`,
      ])}`;
    }
    if (mode === "late") {
      return `${neun(c.who)} ${c.pick([`${phrase} 후반을 노렸지만 역부족`, `${phrase} 길게 갔지만 미치지 못함`])}`;
    }
    return `${neun(c.who)} ${c.pick([
      `${phrase} 맞섰지만 역부족`, `${phrase} 버텼지만 모자랐음`, `${phrase} 받아쳤지만 밀림`,
      `${phrase} 끝까지 붙었지만 넘지 못함`, `${phrase} 싸웠지만 한 끗이 모자랐음`,
      ...(c.p.team ? [`${phrase} 팀원과 함께 막아섰으나 역부족`, `팀원이 도와줬으나 ${phrase} 막지 못함`] : []),
    ])}`;
  },
  defense: (c) => {
    const unit = UNIT_KO[str(c.p.unit)];
    const def = DEFENSE_KO[str(c.p.def)];
    if (!unit || !def) return null;
    const n = num(c.p.n);
    // 방어 건물이 많으면 개수 자체가 전황이다(요청) — 그럴 땐 몇 개까지 박았는지 말한다.
    const heavy = num(c.p.total) >= 6;
    // 지어 놓은 건 확실하지만 그게 막아냈는지는 리플레이에 없다(지적) — 갖춘 데까지만 말한다.
    // 수가 많으면 그 자체가 그림이라 '도배'로 말한다(요청).
    if (heavy) {
      return `${ga(c.who)} ${done(c, c.pick([
        `본진에 ${reul(def)} 도배해서 방어함`,
        `${def} ${n}개를 지어서 본진을 도배함`,
        `${def} ${n}개를 지어 놓고 ${ro(unit)} 웅크림`,
      ]))}`;
    }
    return `${ga(c.who)} ${done(c, c.pick([
      `${def} ${n}개를 지어서 ${ro(unit)} 방어함`,
      `${reul(def)} 지어서 방어 라인을 세움`,
      `${ro(`${wa(unit)} ${def}`)} 막아섬`,
    ]))}`;
  },
  expand: (c) => {
    const kind = EXPANSION_KO[str(c.p.kind)];
    const n = num(c.p.n);
    if (!kind || n <= 0) return null;
    const label = `${n}${kind}`;
    const unit = UNIT_KO[str(c.p.unit)];
    // 확장을 크게 벌렸으면 그게 곧 생산량이다 — 무엇을 뽑았는지까지 붙여 말한다(요청).
    if (unit && n >= 6) {
      return `${ga(c.who)} ${done(c, c.pick([
        `${reul(kind)} ${n}개까지 늘려서 ${reul(unit)} 폭발적으로 생산함`,
        `${label}까지 늘려 ${reul(unit)} 쏟아냄`,
      ]))}`;
    }
    return `${ga(c.who)} ${done(c, c.pick([
      `${reul(kind)} ${n}개까지 늘려 자원을 벌림`,
      `${label}까지 늘려 판을 넓힘`,
      `${label}까지 돌림`,
    ]))}`;
  },
  tech: (c) => {
    const t = TECH_KO[str(c.p.tech)];
    if (!t) return null;
    return `${ga(c.who)} ${done(c, c.pick([
      `${t} 등의 고급 기술을 사용해 전투에 임함`, `${t}까지 꺼내 씀`, `${reul(t)} 확보해 씀`,
    ]), true)}`;
  },
  allin: (c) =>
    `${ga(c.who)} ${c.pick(["일꾼을 거의 안 뽑고 병력만 짜낸 올인", "일꾼을 접고 병력만 뽑은 올인"])}`,
  // 탈락이 리플레이에 그대로 적혀 있으면(Leave Game) 짐작 없이 단정해 말한다(요청).
  fallen: (c) =>
    `${ga(c.who)} ${c.pick(
      c.p.out
        ? c.p.team
          ? ["먼저 엘리미네이트 당함", "제일 먼저 탈락하며 한 명이 빠짐", "먼저 지워짐"]
          : ["엘리미네이트 당함", "탈락함"]
        : c.p.team
          ? ["먼저 무너지며 전열이 갈림", "먼저 정리되며 한 명이 빠짐"]
          : ["일찍 손을 놓음", "일찍 무너짐", "허무하게 먼저 정리됨"]
    )}`,

  // 일꾼 생산 격차 — 커맨드로 센 '뽑은 수'다(살아남은 수가 아니다). 그래도 한쪽이 한참
  // 적게 뽑았다면 그만큼 경제가 눌렸다는 뜻이라, 승부의 밑바탕을 말해준다(요청).
  "worker-gap": (c) => {
    const n = num(c.p.n);
    const foe = num(c.p.foe);
    if (n <= 0 || foe <= 0) return null;
    return `${ga(c.who)} ${c.pick(
      c.won
        ? [`일꾼을 ${n}기까지 굴리며 ${foe}기에 그친 상대를 경제로 눌렀음`,
           `일꾼 ${n}기 대 ${foe}기로 경제에서 앞섰음`]
        : [`일꾼을 ${n}기밖에 못 뽑아 ${foe}기를 뽑은 상대에게 경제로 밀렸음`,
           `일꾼 ${n}기 대 ${foe}기, 경제부터 벌어졌음`]
    )}`;
  },

  // 생산 건물 규모 — 게이트 8개와 3개는 뽑는 속도가 다르다(요청).
  "prod-gap": (c) => {
    const kind = PRODUCTION_KO[str(c.p.kind)];
    const n = num(c.p.n);
    const foe = num(c.p.foe);
    if (!kind || n <= 0) return null;
    return `${ga(c.who)} ${c.pick(
      c.won
        ? [`${kind}를 ${n}개까지 늘려 ${foe}개에 머문 상대보다 훨씬 빨리 찍어냄`,
           `${kind} ${n}개로 생산량 자체가 달랐음`]
        : [`${kind}를 ${n}개에서 못 늘려 ${foe}개를 돌린 상대에게 물량으로 밀렸음`,
           `${kind} ${n}개로는 상대의 ${foe}개를 못 따라갔음`]
    )}`;
  },

  // 건물을 띄웠다 — 자리를 다 내주고 도망다녔다는 뜻이다(요청: 상당히 불리한 지표).
  "lift-off": (c) => {
    const n = num(c.p.n);
    return `${ga(c.who)} ${c.pick(
      c.won
        ? [`건물을 ${n}채나 띄우고 버티다 끝내 살아남음`, `건물을 띄워가며 버텨냄`]
        : [`건물을 ${n}채나 띄우고 쫓겨다님`, `자리를 다 내주고 건물만 띄우다 끝남`]
    )}`;
  },

  // 몰래 배럭 — 본진에서 한참 떨어진 자리에 올린 초반 배럭(요청).
  "sneak-rax": (c) => {
    const at = targetPhrase(c);
    // 파이어뱃까지 나왔으면 그건 정찰용 몰래 배럭이 아니라 러시다(요청).
    if (c.p.firebat) {
      return `${ga(c.who)} ${at}${done(c, c.pick([
        "몰래 배럭 파이어뱃 러쉬를 함",
        ...(c.won ? [] : ["무리하게 몰래 배럭 파이어뱃 러쉬를 함"]),
      ]), true)}`;
    }
    return `${ga(c.who)} ${at}${done(c, c.pick([
      "몰래 배럭을 올림", "몰래 배럭을 시도함", "이른 시간에 몰래 배럭을 올림",
      "예상치 못한 몰래 배럭을 올림",
    ]), true)}`;
  },
  // 성큰러쉬 — 내 기지가 아닌 곳에 초반부터 성큰을 박는 올인(요청). 해처리는 펴지 않는다.
  "sunken-rush": (c) => {
    const at = targetPhrase(c);
    return `${ga(c.who)} ${at}${done(c, c.pick([
      "성큰러쉬를 함", "초반 성큰러쉬를 함", "빠른 성큰러쉬를 시도함",
      "예상치 못한 성큰러쉬를 함",
    ]), true)}`;
  },
  // 센터 포토 — 가운데를 포토로 걸어 잠그는 그림(요청).
  // 센터 포토 — 수가 많으면 '도배', 적으면 그냥 깔았다는 데까지만.
  "center-photon": (c) => {
    const n = num(c.p.n, 2);
    return `${ga(c.who)} ${done(c, c.pick(
      n >= 6
        ? [`포토 ${n}개를 지어서 센터를 장악함`, "센터에 포토를 도배함"]
        : [`포토 ${n}개를 지어서 센터를 걸어 잠금`, "센터에 포토를 지어 길을 끊음"]
    ))}`;
  },
  // 센터 장악 — 가운데에 건물을 늘려 판을 넓힌 그림(요청).
  center: act(["센터에 건물을 늘림", "센터까지 건물을 폄"]),

  // 탱크 방어(흔히 옆탱 — 요청: 문장에서는 '탱크 방어'로) — 두 갈래다. 아군 기지에
  // 팩토리를 올려 그쪽을 받쳐주는 것과, 내 기지에서 뽑은 탱크로 바로 옆에 붙은 상대를
  // 잡아내는 것(지적: 꼭 아군 기지에만 하는 게 아니다).
  "side-tank": (c) => {
    if (str(c.p.at) === "home") {
      const foe = c.whom ? reul(c.whom) : "옆에 붙은 상대를";
      return `${ga(c.who)} ${c.pick(
        c.won
          ? [`탱크로 ${foe} 눌러 정리함`, `탱크 방어로 옆을 걸어 잠그고 ${foe} 끊어냄`,
             `탱크를 뽑아 ${foe} 그대로 밀어냄`]
          : [`탱크 방어로 ${foe} 잡아냈지만 판을 뒤집지 못함`, `${foe} 탱크로 눌러놓고도 끝내 밀림`]
      )}`;
    }
    const at = c.who2 ? `${c.who2}의 기지에 ` : "아군 기지에 ";
    return `${ga(c.who)} ${at}${done(c, c.pick([
      "팩토리를 올려 탱크 방어를 받쳐줌", "팩토리를 펴고 탱크를 뽑음",
    ]))}`;
  },
  // 입구 방어(요청) — 리플레이에 지형이 없어 램프 자체는 알 수 없다. '본진 안이면서 상대
  // 쪽으로 나가 있는 자리'까지가 확실한 근거라, 문장도 딱 그만큼만 말한다.
  "front-defense": (c) => {
    const def = DEFENSE_KO[str(c.p.b)];
    if (!def) return null;
    const n = num(c.p.n, 2);
    return `${ga(c.who)} ${done(c, c.pick([
      `입구 쪽에 ${def} ${n}개를 지어서 방어함`,
      `본진 앞을 ${def} ${n}개로 막아 세움`,
      `진출로 쪽에 ${def} ${n}개를 지어 길을 좁힘`,
    ]))}`;
  },

  // 커널(나이더스 커널) — 뚫어 놓고 병력을 실어 나르는 플레이(요청). 건물 하나로 확실하다.
  nydus: (c) => {
    const at = targetPhrase(c);
    return `${ga(c.who)} ${done(c, c.pick([
      `커널을 뚫어 ${at}병력을 실어 나름`, `${at}커널을 뚫음`,
      `예상치 못한 커널을 뚫어 ${at}병력을 넘김`,
    ]))}`;
  },

  // 셋방살이(요청) — 제 기지에는 건물이 거의 없고 아군 기지에 살림을 차린 것.
  // 시작 자리를 두고 옮겨온 경우는 '본진을 잃고'까지 말한다 — 그게 더 재미있는 그림이다.
  lodging: (c) => {
    const host = c.who2 ? `${c.who2}의 기지에 ` : "아군 기지에 ";
    if (c.p.lost) {
      return `${ga(c.who)} ${done(c, c.pick([
        `본진을 잃고 ${host}얹혀삶`,
        `본진이 망해서 ${host}살림을 옮김`,
        `본진을 내주고 ${host}기생하기 시작함`,
        `제 기지를 잃고 ${host}셋방살이에 들어감`,
      ]))}`;
    }
    return `${ga(c.who)} ${host}${done(c, c.pick([
      "살림을 차리고 셋방살이를 함", "눌러앉아 셋방살이를 함", "건물을 옮겨 얹혀삶",
      "과감하게 살림을 차리고 셋방살이를 함", "기생하듯 붙어삶",
    ]))}`;
  },

  // 배틀크루저(요청) — 띄우는 것 자체가 사건인데, 띄우고도 지는 경기가 많아 이야기가 된다.
  // 그래서 진 쪽에는 도박수와 같은 맺음(망함·재미를 못 봄)을 붙인다.
  bc: (c) => {
    const n = num(c.p.n, 3);
    return `${ga(c.who)} ${done(c, c.pick([
      `배틀크루저 ${n}기를 띄움`,
      `끝내 배틀크루저까지 올림`,
      `배틀크루저 ${n}기를 모아 하늘로 밀고 나감`,
    ]), true)}`;
  },

  // 가디언(요청) — 뮤탈을 변태시켜 지상을 두들기는 그림. 드물게 나와서 그 자체가 이야기다.
  guardian: (c) => {
    const n = num(c.p.n, 4);
    return `${ga(c.who)} ${done(c, c.pick([
      `가디언 ${n}기를 띄워 지상을 두들김`,
      `뮤탈을 가디언으로 변태시켜 밀고 들어감`,
      `가디언을 띄워 자리를 하나씩 걷어냄`,
    ]))}`;
  },

  // 초반 올인이 막히고 역으로 무너진 경우(요청) — 러쉬가 실패한 것만 말하는 것보다,
  // 그 뒤에 제 살림이 무너진 것까지 이어야 이야기가 된다.
  "rush-backfire": (c) => {
    const label = tacticLabel(str(c.p.k), c.p) || "초반 러쉬";
    // 러쉬가 막힌 뒤에 오는 건 '살림이 무너짐'이 아니라 테크·발전에서의 손해다(지적).
    return `${ga(c.who)} ${c.pick([
      `${reul(label)} 갔으나 막힘`,
      `${label} 실패함`,
      `${reul(label)} 갔다가 막혀 테크에서 손해를 봄`,
      `${label}가 막힌 뒤 발전이 늦어짐`,
      `${reul(label)} 갔다가 막혀 그 사이 상대만 테크를 탐`,
      `${label} 실패로 한동안 발전을 못함`,
    ])}`;
  },

  // 대규모 뮤탈(요청) — 몇 부대까지 모았는지가 곧 그림이다.
  muta: (c) => {
    const q = num(c.p.squads, 3);
    return `${ga(c.who)} ${done(c, c.pick([
      `뮤탈을 ${q}부대까지 모아 흔듦`,
      `${q}부대 뮤탈로 하늘을 뒤덮음`,
      `뮤탈 ${q}부대를 굴리며 사방을 찌름`,
    ]))}`;
  },

  // 견제로 일꾼을 잡아냈다(요청) — 드랍·뮤탈 뒤에 상대가 일꾼을 다시 잔뜩 뽑았다면
  // 그 일꾼들이 잡히고 있었다는 뜻이다. 죽지 않으면 새로 뽑을 일이 없다.
  "harass-workers": (c) => {
    const label = tacticLabel(str(c.p.k), c.p) || "견제";
    const foe = c.whom ? `${c.whom}의 ` : "상대 ";
    return `${ga(c.who)} ${done(c, c.pick([
      `${ro(label)} ${foe}일꾼을 잡아냄`,
      `${ro(label)} ${foe}일꾼 줄을 계속 끊음`,
      `${foe}일꾼이 ${label}에 계속 잡혀 다시 뽑기 바쁨`,
    ]))}`;
  },

  // 끈질긴 일꾼 견제(요청) — 한 번 크게 맞은 게 아니라 내내 시달린 그림. 상대가 일꾼을
  // 몰아 뽑은 구간이 몇 분이나 이어졌는지가 그 근거다.
  "harass-long": (c) => {
    const label = tacticLabel(str(c.p.k), c.p) || "견제";
    const foe = c.whom ? `${c.whom}의 ` : "상대 ";
    const m = num(c.p.min);
    const span = m > 0 ? `${m}분 내내 ` : "";
    return `${ga(c.who)} ${done(c, c.pick([
      `${span}${ro(label)} ${foe}일꾼을 끈질기게 괴롭힘`,
      `${ro(label)} ${foe}일꾼 줄을 ${span}끊어댐`,
      `${foe}일꾼이 ${span}${label}에 시달려 다시 뽑기만 반복함`,
    ]))}`;
  },

  // 발키리 오버로드 사냥(요청) — 발키리가 뜬 뒤 상대가 오버로드를 다시 뽑기 시작했다면
  // 그건 계속 잡히고 있었다는 뜻이다. 그림이 확실해서 대상까지 지목한다.
  "valk-hunt": (c) => {
    const foe = c.whom ? `${c.whom}의 ` : "상대 ";
    return `${ga(c.who)} ${done(c, c.pick([
      `발키리를 띄워 ${foe}오버로드를 계속 잡아냄`,
      `발키리로 ${foe}오버로드를 사냥함`,
      `${foe}오버로드가 발키리에 계속 녹아 다시 뽑히기 바쁨`,
    ]))}`;
  },

  // 부활(요청) — 무너졌다가 다시 일어선 것. 그 자체가 이야기라 따로 말한다.
  revival: (c) =>
    `${ga(c.who)} ${done(c, c.pick([
      "무너졌다가 다시 일어섬",
      "다 밀리고도 살림을 다시 세움",
      "끝난 줄 알았던 자리에서 되살아남",
      "생산을 다시 돌리며 판에 복귀함",
    ]))}`,

  // 팽팽한 대치(요청) — 주어가 없는 문장이다. 양쪽 얘기라 누구를 앞세울 수 없다.
  standoff: (c) => {
    const m = num(c.p.min);
    if (m <= 0) return null;
    return c.pick([
      `${m}분 동안 팽팽하게 대치함`,
      `양 팀이 ${m}분 가까이 팽팽하게 맞섬`,
      `${m}분 내내 승부가 기울지 않음`,
      `${m}분을 서로 밀고 밀리며 버팀`,
    ]);
  },

  // 시야(요청) — 오버로드·옵저버를 뿌려 판을 읽는 플레이.
  vision: (c) => {
    const u = UNIT_KO[str(c.p.unit)];
    if (!u) return null;
    return `${ga(c.who)} ${done(c, c.pick([
      `${reul(u)} 곳곳에 뿌려 전황을 파악함`,
      `${reul(u)} 여기저기 띄워 상대의 움직임을 읽음`,
      `${u} 시야로 판을 넓게 봄`,
    ]))}`;
  },

  // 안 보이는 유닛에 대한 대비 부족(요청) — 무엇을 못 갖췄는지는 종족마다 다르다.
  "no-detect": (c) => {
    const u = UNIT_KO[str(c.p.unit)];
    if (!u) return null;
    const none = str(c.p.race) === "테란" ? "스캔도 사이언스베슬도" : "옵저버도";
    return `${ga(c.who)} ${c.pick([
      `${none} 없이 ${reul(u)} 상대함`,
      `${reul(u)} 잡을 탐지 수단을 갖추지 못함`,
      `탐지 없이 ${reul(u)} 맞이함`,
    ])}`;
  },

  // 합공(요청: 초반에 누가 죽은 것 같으면 몇 명이 러시했는지 유추) — 이름을 다 부르므로
  // 숫자는 "둘이서/셋이서"로만 거든다.
  "gang-rush": (c) => {
    const n = num(c.p.n, 2);
    const cnt = n === 2 ? "둘이서" : `${n}명이서`;
    const whom = c.whom ? `${reul(c.whom)} ` : "";
    return `${ga(c.who)} ${cnt} ${c.pick(
      c.won
        ? [`초반부터 몰아쳐 ${whom}먼저 무너뜨림`, `함께 붙어 ${whom}일찌감치 정리함`,
           `초반에 달라붙어 ${whom}그대로 지워버림`]
        : [`초반부터 몰아쳐 ${whom}잡았지만 판을 뒤집지 못함`, `함께 붙어 ${whom}먼저 끊고도 끝내 밀림`]
    )}`;
  },

  // 채팅에서 잡은 항복 선언(요청) — 승부가 어디서 끝났는지 말해주는 유일한 '사람의 말'이다.
  gg: (c) =>
    c.p.all
      ? `${c.whoList.join("·")} 팀이 ${c.pick(["결국 GG 선언", "결국 GG를 치고 물러남"])}`
      : `${ga(c.who)} ${c.pick(["결국 GG 선언", "GG를 침", "GG 치고 나감", "일찌감치 GG"])}`,

  // "유비의 바이오닉 한 방으로 관우의 저글링 성큰을 뚫음"(요청) — 양쪽을 한 문장에 담는다.
  breakthrough: (c) => {
    const push = unitPhrase(list(c.p.units));
    const unit = UNIT_KO[str(c.p.unit)];
    const def = DEFENSE_KO[str(c.p.def)];
    if (!push || !unit || !def || !c.whom) return null;
    const n = num(c.p.n);
    const wall = n >= 5 ? `${unit} ${def} ${n}개` : `${unit} ${def}`;
    return `${c.who}의 ${push} ${c.whom}의 ${reul(wall)} ${c.pick(["뚫음", "밀어버림", "걷어냄"])}`;
  },

  // ── 맺음말 ──
  result: (c) => {
    const phrase = c.p.units ? unitPhrase(list(c.p.units)) : "";
    const mode = str(c.p.mode);
    // 앞 문장이 이미 같은 사람·같은 유닛을 말했으면 맺음말은 그걸 이어받는다(요청).
    // "계속해서 마린과 메딕 조합으로"는 어색해서, 이어받을 때는 아예 다른 꼴로 쓴다 —
    // "결국 마린과 메딕 조합으로" "계속된 마린 공격으로". 초반·후반·역전은 저마다 시간과
    // 흐름을 이미 말하고 있어 이어받기를 얹지 않는다.
    const units = list(c.p.units);
    const cont = c.p.cont && mode === "plain";
    const p = cont ? contPhrase(units, c.pick) : phrase ? `${phrase} ` : "";
    const lead = str(c.p.lead);
    const min = num(c.p.leadMin);
    let head = "";
    if (lead === "epic") head = `${c.pick([`${min}분 혈투 끝에`, `${min}분을 끌고 간 끝에`])} `;
    else if (lead === "rush") head = `${c.pick([`${min}분 만에`, `단 ${min}분 만에`])} `;
    // 드문 유닛은 "캐리어가 뜬"처럼 주인 없이 말하지 않는다(지적) — 누구의 캐리어인지
    // 밝히고, 그 문장이 곧 맺음말이 된다. 아래 팀 문장 다음에서 처리한다.
    const spectacle = lead === "spectacle" ? UNIT_KO[str(c.p.leadUnit)] : "";
    // 팀전에서 특히 활약한 사람 한 마디 — 그 사람을 특징짓는 유닛과 역할로 말한다.
    // 팀 전체로 말할 때는 생산이 압도적이었던 사람만 따로 적는다(요청).
    const heroUnit = UNIT_KO[str(c.p.heroUnit)];
    const role = UNIT_ROLE[str(c.p.heroUnit)];
    const hero =
      c.who2 && heroUnit && role
        ? str(c.p.heroMode) === "dominant"
          ? `${ga(c.who2)} ${c.pick([
              `압도적인 ${heroUnit} 생산으로 앞장섬`,
              `혼자 ${reul(heroUnit)} 쏟아내며 팀을 이끔`,
              `${heroUnit} 물량을 압도적으로 뽑아냄`,
            ])}`
          : `${c.who2}의 ${ro(`${heroUnit} ${role}`)} ${c.pick([
              ROLE_TAIL[role] ?? "승기를 잡음", "팀의 승리를 이끔", "팀을 강력하게 보조함",
            ])}`
        : null;

    const who = ga(c.who);
    // 팀전 승리는 한 사람의 공이 아니다(요청) — 각자가 무엇으로 싸웠는지를 나란히 말한다.
    // 흐름을 이미 말하는 초반 승리·역전에는 얹지 않는다(문장이 길어지고 앞뒤가 어긋난다).
    const team = teamPhrase(c);
    if (team && (mode === "plain" || mode === "late")) {
      const t = mode === "late" ? c.pick(["후반 ", "길게 끌어 "]) : "";
      const body2 = head + `${t}${team} ${c.pick(["승리", "이김"])}`;
      return [body2, ...(hero ? [hero] : [])].join(", ");
    }
    if (spectacle) {
      const b2 = `${c.who}의 ${c.pick([
        `${spectacle}까지 나온 끝에 승리`,
        `${reul(spectacle)} 앞세워 승리`,
        `${spectacle} 한 방으로 승부를 냄`,
      ])}`;
      return [b2, ...(hero ? [hero] : [])].join(", ");
    }
    // 조합을 빼면 "초반 승리"처럼 앙상해지므로, 그럴 땐 수식도 같이 정리한다.
    let body: string;
    if (mode === "rush") {
      body = phrase
        ? `${who} ${c.pick([`초반 ${p}승리`, `초반 ${p}그대로 끝냄`])}`
        : `${who} ${c.pick(["승리", "그대로 끝냄"])}`;
    } else if (mode === "comeback") {
      const late = c.p.wentLate ? "후반에 " : "";
      body = `${who} ${c.pick([`초반 열세이다가 ${late}${p}역전`, `밀리다가 ${late}${p}뒤집음`])}`;
    } else if (mode === "late") {
      body = `${who} ${c.pick([`후반 ${p}승리`, `길게 끌어 ${p}승리`])}`;
    } else {
      // 주력을 부대 단위로 뽑았으면 그 규모 자체가 그림이다(요청) — 12기를 한 부대로 센다.
      const leadKo = UNIT_KO[list(c.p.units)[0] ?? ""] ?? "";
      const squads = Math.floor(num(c.p.unitN) / 12);
      const bulk = leadKo && squads >= 2 && !cont
        ? [`${leadKo} ${squads}부대를 뽑아 승리`, `${leadKo}만 ${squads}부대 넘게 생산해 이김`]
        : [];
      body = phrase
        ? `${who} ${c.pick([`${p}승리`, `${p}이김`, ...bulk])}`
        : `${who} ${c.pick(["그대로 승리", "그대로 가져감"])}`;
    }

    return [head + body, ...(hero ? [hero] : [])].join(", ");
  },
};

/** 이 키를 지금 코드가 문장으로 옮길 수 있나 — 만들 때 미리 걸러내는 용도. */
export function hasSummaryTemplate(key: string): boolean {
  return key in TEMPLATES;
}

const joinNames = (names: string[]): string => names.filter(Boolean).join("·");

/** "조조와 유비" — 양쪽이 같은 짓을 했을 때는 가운뎃점이 아니라 '와/과'로 잇는다(요청). */
const joinPair = (names: string[]): string => {
  const n = names.filter(Boolean);
  if (n.length < 2) return joinNames(n);
  return `${wa(n.slice(0, -1).join("·"))} ${n[n.length - 1]}`;
};

/**
 * 저장된 요약을 한 문단으로 옮긴다. resolveName은 리플레이 원본 게임 아이디를 지금 보여줄
 * 이름으로 바꾸는 함수 — 회원이면 현재 닉네임, 아니면 그 이름 그대로.
 * 모르는 틀 키나 재료가 모자란 줄은 조용히 건너뛴다(옛 데이터가 화면을 깨뜨리지 않도록).
 */
export function renderReplaySummary(
  data: ReplaySummaryData | unknown,
  resolveName: (rawName: string) => string
): string | null {
  if (!isReplaySummaryData(data)) return null;
  const out: string[] = [];
  // 앞 문장과 인과로 이어지는 자리를 표시해 둔다(요청: 서사·인과가 있어야 재밌다).
  // 크게 한 방 먹인 바로 다음에 같은 사람이 또 무언가를 했다면 그건 '그 기세로' 한 것이다.
  let prev: ReplaySummaryBeat | null = null;
  const beats = data.beats as ReplaySummaryBeat[];
  // 진 편의 마지막 문장 자리 — 결말은 거기서만 말한다(맺음말 result는 이긴 편 몫이다).
  let lastLost = -1;
  beats.forEach((b, i) => { if (!b.won && b.k !== "result") lastLost = i; });
  for (let i = 0; i < beats.length; i += 1) {
    const b = beats[i];
    const tpl = TEMPLATES[b?.k];
    if (!tpl) continue;
    // 양쪽이 같은 짓을 했으면 한 문장으로 묶는다(요청) — 모든 전술 틀이 `${ga(who)} ${동작}`
    // 꼴이라, 이름을 '와/과'로 잇고 동작 앞에 한마디만 붙이면 어느 틀이든 그대로 읽힌다.
    // '서로'는 정말 서로를 향했을 때만 쓴다(지적). 대상을 모르는 경우는 '양 팀'으로 말한다.
    const mutual = b.p?.mutual === true;
    const both = b.p?.both === true;
    const names = (b.who ?? []).map(resolveName);
    const seed = variantSeed(b);
    let who = mutual || both ? joinPair(names) : joinNames(names);
    if (
      prev && b.k !== "result"
      && (prev.k === "raid-damage" || prev.k === "gang-rush")
      && !!prev.won === !!b.won
      && (b.who ?? []).some((w) => (prev?.who ?? []).includes(w))
    ) {
      who = `${seed % 2 === 0 ? "그 기세로" : "여세를 몰아"} ${who}`;
    }
    let lead = "";
    if (mutual) lead = "서로 ";
    else if (both) {
      if (seed % 2 === 0) who = `양 팀의 ${who}`;
      else lead = "모두 ";
    }
    if (!who) continue;
    let firstPick = true;
    const text = tpl({
      who,
      whoList: (b.who ?? []).map(resolveName).filter(Boolean),
      who2: joinNames((b.who2 ?? []).map(resolveName)),
      whom: joinNames((b.whom ?? []).map(resolveName)),
      won: !!b.won,
      last: i === lastLost,
      p: b.p ?? {},
      pick: (opts) => {
        const t = opts[seed % opts.length];
        if (!lead || !firstPick) return t;
        firstPick = false;
        return `${lead}${t}`;
      },
    });
    if (text) { out.push(text); prev = b; }
  }
  return out.length > 0 ? out.join(". ") : null;
}
