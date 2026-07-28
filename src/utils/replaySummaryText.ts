import { ga, ira, neun, reul, ro, wa } from "./korean";
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

/** 문장에 쓸 만한 건물 이름 — 여기 없는 건물은 그냥 '건물'이라고만 말한다. */
export const BUILDING_KO: Record<string, string> = {
  ...DEFENSE_KO, ...PRODUCTION_KO,
  Pylon: "파일런", "Supply Depot": "서플라이", "Creep Colony": "크립 콜로니",
  Forge: "포지", Academy: "아카데미", Armory: "아머리", Observatory: "옵저버토리",
  "Nydus Canal": "커널", "Engineering Bay": "엔지니어링 베이", Refinery: "리파이너리",
  Assimilator: "어시밀레이터", Extractor: "익스트랙터", Nexus: "넥서스",
  "Command Center": "커맨드", Hatchery: "해처리",
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
    // "4인 팀"은 쓰지 않는 말이다(지적) — 로스터에 있는 그대로 "1팀/2팀"이라 부른다.
    // 팀 번호를 모르면(옛 데이터·1:1) 이름을 늘어놓는 쪽으로 물러선다.
    const team = c.team ? `${c.team}팀` : names.join("·");
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
  const made = shown.map((g) => {
    const many = g.names.length > 1;
    const ko = g.units.map((u) => UNIT_KO[u]).filter(Boolean).slice(0, many ? 3 : 2);
    if (ko.length === 0) return null;
    return { who: g.names.join("·"), what: many ? `${ko.join(" ")} 조합` : ko.join(" ") };
  }).filter((x): x is { who: string; what: string } => x !== null);
  if (made.length === 0) return "";
  // 조합만 늘어놓고 끝내면 누가 이겼는지가 빠진다(지적) — 팀 번호로 주어를 세우거나,
  // 아예 사람을 주격으로 놓고 "누가 무엇으로 몰아붙여"로 말한다.
  const subject = c.team ? `${c.team}팀이 ` : "";
  const parts = made.map((g) => `${g.who}의 ${g.what}`);
  if (parts.length === 1) return `${ro(parts[0])} ${subject}`.trimEnd();
  const head = parts.slice(0, -1).join(", ");
  const listed = `${ro(`${wa(head)} ${parts[parts.length - 1]}`)} ${subject}`.trimEnd();
  // "제롬·Rex가 질럿 조합으로, 태섭이 마린 메딕 조합으로 몰아붙여"(요청) — 무리마다
  // 격을 달리하면 셋 이상일 때 문장이 무너진다(지적: ~을 ~을 ~으로가 된다). 모두 같은
  // 도구격으로 늘어놓고 마지막에 서술어 하나만 받는다.
  const acting = `${made.map((g) => `${ga(g.who)} ${ro(g.what)}`).join(", ")} 몰아붙여`;
  return c.pick([listed, acting]);
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
  /** 일어난 프레임 — 초반 일은 결과를 덧붙이지 않고 그때 일만 말한다(지적). */
  at: number | null;
  /** 경기 전체 길이(프레임). '초반'을 경기 길이에 대비해 재는 데만 쓴다. */
  end: number | null;
  /** 진 편 문장 중 마지막인가 — 부정적인 맺음은 경기당 한 번만 쓴다(지적). */
  lastLost: boolean;
  /** 이 사람들이 속한 팀 번호 — 팀 전체를 부를 때 "1팀"이라 말하기 위한 것이다(지적:
   *  "4인 팀"은 이상한 말). 팀을 모르면 0이고, 그때는 이름을 늘어놓는다. */
  team: 0 | 1 | 2;
  p: Record<string, unknown>;
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

// 1 프레임 = 0.042초(replayParser와 같은 상수).
const SECONDS_PER_FRAME = 0.042;
// 이 안에 벌어진 양쪽 일은 '같은 때'로 보고 이어 주는 말을 붙인다.
// 스타는 호흡이 빨라 1분만 지나도 다른 국면이다(지적) — 창을 더 좁혔다.
const SAME_TIME_SEC = 45;
// 이만큼이나 벌어졌으면 그 사이는 정말로 대치였다고 말해도 된다(요청: "한동안의 대치 후").
const STANDOFF_SEC = 5 * 60;
// 두 일을 한 문장으로 합칠 수 있는 최대 시간 차(지적: 시간 차이가 제일 우선) — 이보다
// 벌어지면 인과가 아무리 그럴듯해도 각각 제 문장으로 둔다.
const JOIN_MAX_SEC = 3 * 60;
/** '-다가'로 이을 수 있는 사이 — 이 어미는 하던 일이 그 일 때문에 끊겼다는 뜻이라,
 *  정말 밀접한 인과관계가 아니면 쓰면 안 된다(지적). 몇 분 떨어진 두 일을 이걸로 묶으면
 *  없는 인과를 지어내는 셈이다. 다만 '자원부터 먼저 챙겼다'처럼 한동안 이어지는 상태는
 *  시간이 좀 벌어져도 뒤의 일과 곧바로 이어진다. */
const CAUSE_SEC = 90;
// 대비를 뜻하는 이음말 — 이 뒤에는 주어를 주제격("Rex는")으로 세운다(지적).
/** 곧이곧대로 뒤집는 말들 — 잇달아 쓰면 같은 말을 반복하는 꼴이 된다(지적). */
const ADVERSATIVE = new Set(["하지만", "그러나", "그렇지만"]);
const CONTRAST_LINKS = new Set(["한편", "그와 동시에", "반면", "그러나", "하지만", "그렇지만", "이에 질세라", "다른 쪽에서는", "반대로", "역으로"]);
// 시간 순서를 짚는 이음말 — 위 대비 이음말과 함께 문장 앞머리를 알아보는 데 쓴다.
const SEQUENCE_LINKS = ["이어서", "곧이어", "그 직후", "잠시 후", "한참 후", "소강상태 후", "그 후", "한동안의 대치 후", "그 기세로", "여세를 몰아", "그 기세를 이어간", "여기에", "게다가", "설상가상으로", "그리고"];
// 정규식에 이름을 그대로 넣기 전에 특수문자를 막는다 — 닉네임에 무엇이 들어올지 모른다.
const escapeRe = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 어느 편에도 기울지 않는 문장들 — 대치·소모전·손 빠르기·총 생산량처럼 '그 순간 누가
// 유리한가'를 말하지 않는 것들이다.
const NEUTRAL_BEATS = new Set([
  "standoff", "attrition", "fast-hands", "power-unit", "expand", "prod-gap", "worker-gap",
  "tech", "vision", "no-detect", "revival",
]);
// 한 사람의 일이지만 국면은 상대 쪽으로 기우는 문장들 — 제 수가 역풍을 맞았거나 당한 것.
const AGAINST_ACTOR = new Set([
  "rush-backfire", "greedy-punished", "fallen", "lodging", "lift-off", "gg",
]);
// 문장 앞에 붙는 이음말을 알아보는 조각 — 고정된 말들에 더해 "8분 뒤"처럼 그때그때
// 만들어지는 시간 표현도 함께 본다(요청: 시간이 많이 벌어지면 몇 분 후라고 적기).
const LINK_HEAD = () => `(?:${[...CONTRAST_LINKS, ...SEQUENCE_LINKS].join("|")}|\\d+분 (?:뒤|후))`;
// 한 문장에 이어 붙일 수 있는 마디 수 — 이보다 길어지면 읽다가 숨이 찬다.
const MAX_CHAIN = 2;
// 진 편 문장에 결과 한 마디를 다는 건 '끝 무렵에 벌어진 일'에만 한다(지적) — 초중반의
// 한 수를 곧바로 경기 결과와 이어 붙이면 인과가 과장된다. 끝나기 전 몇 분 동안의 일이라야
// 결과에 영향을 줬다고 말할 수 있다.
// 절대 시간이 아니라 경기 길이에 대비해 잰다(지적) — 40분 경기의 8분과 9분 경기의 8분은
// 전혀 다른 자리다. 길이를 모르는 옛 데이터만 절대 시간으로 대신한다.
const LATE_SEC = 5 * 60;
const LATE_RATIO = 0.2;
const EARLY_SEC_FALLBACK = 8 * 60;

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
// "경기는 내줌"은 경기가 끝났다는 말이라 이야기 도중에 나오면 어색하다(지적). 진 편의
// 마지막 문장도 맺음말 앞이라 결국 도중이다 — 결말은 맺음말 한 문장이 전담하고, 그 앞은
// 전부 그때까지의 흐름만 말한다.
const LOST_TAILS = [
  // 이 꼬리는 이제 끝 무렵 문장에만 붙는다 — "기울기 시작함"처럼 앞을 내다보는 말은 뺐다.
  "흐름은 상대에게 넘어감", "끝내 뒤집지는 못함", "소득은 크지 않았음",
  "전황을 뒤집지 못함", "역부족이었음", "경기를 뒤집기엔 역부족",
];
// 도박수(초반 올인)가 안 됐을 때만 쓰는 맺음 — 성공 여부를 단정하지 않는 선에서
// "실패함" "큰 피해는 못 줌"까지만 말한다(지적: 독이 됐다·발목을 잡았다는 지나치다).
const RISKY_TAILS = ["실패함", "큰 피해는 못 줌", "결국 망함", "소용없었음"];

// 진 편 문장은 "…뚫음, 경기는 내줌"처럼 끊어 붙이는 것보다 "…뚫었으나 경기는 내줌"으로
// 이어야 자연스럽다(지적). 한 일은 전부 명사형('-ㅁ')으로 써 두었으므로, 그 끝만 과거
// 연결형으로 바꾼다. 불규칙이 많아 규칙으로 만들지 않고 실제로 쓰는 끝만 적어 둔다 —
// 표에 없는 끝이 나오면 이어 붙이지 않고 쉼표로 두어, 틀린 말이 나오는 일은 없다.
const CONNECTIVE: [string, string][] = [
  // 긴 것부터 — 먼저 걸리는 것이 이긴다("밀어붙임"이 "임"보다 앞에 있어야 한다).
  ["승부를 걸음", "승부를 걸었으나"], ["막아섬", "막아섰으나"], ["얹혀삶", "얹혀살았으나"], ["붙어삶", "붙어살았으나"],
  ["되살아남", "되살아났으나"], ["물러남", "물러났으나"], ["끝남", "끝났으나"],
  ["밀어붙임", "밀어붙였으나"], ["파고듦", "파고들었으나"], ["흔듦", "흔들었으나"],
  ["감행함", "감행했으나"], ["뒤집음", "뒤집었으나"], ["헤집음", "헤집었으나"],
  ["놓음", "놓았으나"], ["막음", "막았으나"], ["잡음", "잡았으나"], ["뽑음", "뽑았으나"],
  ["넣음", "넣었으나"], ["끊음", "끊었으나"], ["뚫음", "뚫었으나"], ["지음", "지었으나"],
  ["모음", "모았으나"], ["잠금", "잠갔으나"], ["나름", "날랐으나"],
  ["무너짐", "무너졌으나"], ["지워짐", "지워졌으나"], ["빠짐", "빠졌으나"],
  ["탈락", "탈락했으나"], ["실패", "실패했으나"],
  // 여기부터는 끝 한 글자로 가르는 것들.
  ["함", "했으나"], ["줌", "줬으나"], ["씀", "썼으나"], ["섬", "섰으나"],
  ["춤", "췄으나"], ["굼", "궜으나"], ["김", "겼으나"], ["움", "웠으나"],
  ["림", "렸으나"], ["힘", "혔으나"], ["침", "쳤으나"], ["댐", "댔으나"],
  ["냄", "냈으나"], ["됨", "됐으나"], ["옴", "왔으나"], ["임", "였으나"],
  ["듦", "들었으나"], ["걺", "걸었으나"], ["봄", "봤으나"], ["폄", "폈으나"], ["삶", "살았으나"],
  ["바쁨", "바빴으나"], ["찌름", "찔렀으나"], ["덮음", "덮었으나"], ["붙음", "붙었으나"],
  ["읽음", "읽었으나"],
  ["깜", "깠으나"], ["감", "갔으나"], ["끔", "끌었으나"],
  ["버팀", "버텼으나"], ["않음", "않았으나"], ["짐", "졌으나"],
];

function toConnective(action: string): string | null {
  for (const [from, to] of CONNECTIVE) {
    if (action.endsWith(from)) return `${action.slice(0, -from.length)}${to}`;
  }
  return null;
}

/** "…뽑음" → "…뽑았고". 위 표가 '-았/었으나'까지 만들어 주므로 끝만 '-고'로 바꾼다.
 *  비슷한 때에 벌어진 두 일을 한 문장으로 잇는 데 쓴다(요청: "~했고, ~했음"). */
function toAnd(action: string): string | null {
  const c = toConnective(action);
  return c && c.endsWith("으나") ? `${c.slice(0, -2)}고` : null;
}

/** "…도배함" → "…도배하다가". 하던 일이 도중에 끊긴 그림을 한 문장으로 만든다(요청:
 *  "해처리를 먼저 늘리다가 …"). 여기만은 과거형('늘렸다가')이 아니라 현재형이라야 한다 —
 *  과거형은 '늘렸다가 도로 물렸다'로 읽혀 원인·결과가 아니라 번복이 된다(지적).
 *
 *  명사형('-ㅁ')에서 어간을 되찾는 방법은 받침 ㅁ을 떼는 것이다: 늘림→늘리, 도배함→도배하,
 *  흔듦→흔들(ㄻ에서 ㅁ만 떼면 ㄹ이 남는다). '음'이 한 글자로 붙은 꼴은 그 글자를 통째로
 *  뗀다: 뽑음→뽑. */
function stemOf(action: string): string | null {
  if (action.endsWith("음")) return action.slice(0, -1);
  const last = action.charCodeAt(action.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return null;
  const j = (last - 0xac00) % 28;
  if (j === 16) return `${action.slice(0, -1)}${String.fromCharCode(last - 16)}`;
  if (j === 10) return `${action.slice(0, -1)}${String.fromCharCode(last - 2)}`;
  return null;
}

function toWhile(action: string): string | null {
  const stem = stemOf(action);
  return stem === null ? null : `${stem}다가`;
}

/** "…해처리를 먼저 늘림" → "…해처리를 먼저 늘린 뒤". 앞의 수가 뒤의 수로 이어질 때
 *  둘을 한 문장으로 엮는다(요청: 째기가 무게감 있는 액션과 이어지면 같이 엮어서).
 *  받침이 없는 어간에는 'ㄴ'을 얹고, 있는 어간('뽑')에는 '-은'을 붙인다. */
function toAfter(action: string, word: "뒤" | "후" = "뒤"): string | null {
  const stem = stemOf(action);
  if (stem === null) return null;
  const last = stem.charCodeAt(stem.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return null;
  const j = (last - 0xac00) % 28;
  if (j === 0) return `${stem.slice(0, -1)}${String.fromCharCode(last + 4)} ${word}`;
  return `${stem}은 ${word}`;
}

/** "…뽑음" → "…뽑았으며". '-고'가 두 번 이어지면 지겨워서 두 번째 마디에 쓴다. */
function toAlso(action: string): string | null {
  const c = toConnective(action);
  return c && c.endsWith("으나") ? `${c.slice(0, -2)}으며` : null;
}

/** "…파괴됨" → "…파괴됐지만". 앞의 전황을 뒤집으며 맺을 때 쓴다(요청). */
function toBut(action: string): string | null {
  const c = toConnective(action);
  return c && c.endsWith("으나") ? `${c.slice(0, -2)}지만` : null;
}

/** 문장 첫머리의 주어에 '도'를 붙인다 — "제롬이 " → "제롬도 ". 전황이 뒤집히면서
 *  주체까지 다른 팀으로 넘어갈 때, 앞말을 받아 "…했지만 제롬도 …했다"로 읽히게 한다(요청). */
function toAlsoSubject(sentence: string): string {
  return sentence.replace(
    /^(\d+팀의 )?([^\s]+?)(?:가|이|는|은)(\s)/,
    (_m, team: string | undefined, name: string, sp: string) => `${team ?? ""}${name}도${sp}`,
  );
}

/** 문장 첫머리의 주격("브래드가")을 주제격("브래드는")으로 바꾼다 — 두 사람의 일을 한
 *  문장에 나란히 놓을 때는 "브래드는 …했고 정구는 …했음"이라야 대비가 읽힌다(요청). */
function toTopic(sentence: string): string {
  // 앞에 "1팀의 "처럼 팀 표시가 붙어 있어도 그 뒤의 이름을 주제격으로 바꾼다(요청).
  return sentence.replace(
    /^(\d+팀의 )?([^\s]+?)(?:가|이)(\s)/,
    (_m, team: string | undefined, name: string, sp: string) => `${team ?? ""}${neun(name)}${sp}`,
  );
}

/** 한 일 + (진 편이면) 결과 한 마디. 이어 붙일 수 있으면 "…뚫었으나 경기는 내줌"으로,
 *  못 이으면 쉼표로 둔다. */
const done = (c: Ctx, action: string, risky = false): string => {
  if (c.won) return action;
  // "…했으나 역부족" 같은 부정적인 맺음은 경기당 딱 한 번, 진 편의 마지막 문장에만 붙인다
  // (지적) — 문장마다 붙으면 같은 말이 반복돼 읽는 맛이 없다.
  if (!c.lastLost) return action;
  // 그 한 번도 끝 무렵의 일이라야 한다 — 초중반의 한 수를 곧바로 결과와 잇지 않는다.
  if (c.at !== null) {
    const late = c.end !== null
      ? c.end - c.at <= Math.max(LATE_SEC / SECONDS_PER_FRAME, c.end * LATE_RATIO)
      : c.at > EARLY_SEC_FALLBACK / SECONDS_PER_FRAME;
    if (!late) return action;
  }
  const t = c.pick(risky ? [...LOST_TAILS, ...RISKY_TAILS] : LOST_TAILS);
  const joined = toConnective(action);
  return joined ? `${joined} ${t}` : `${action}, ${t}`;
};

/** 한 일만 말하는 흔한 꼴 — 이긴 쪽/진 쪽 모두 같은 표현을 쓰고, 진 쪽에만 결과를 덧붙인다. */
const act = (actions: string[]): Tpl => (c) => `${ga(c.who)} ${done(c, c.pick(actions))}`;

/** 전술을 문장 안에서 부를 이름 — "3게이트 질럿 러시로 …"처럼 다른 문장에 끼워 넣을 때 쓴다.
 *  여기 없는 키는 '들이친 수'가 아니라는 뜻이라, 피해 문장 자체가 만들어지지 않는다. */
function tacticLabel(k: string, p: Record<string, unknown>): string {
  switch (k) {
    case "zling-rush": {
      const n = num(p.drones);
      return n > 0 ? `${n}드론 저글링 러시` : "초반 저글링 러시";
    }
    case "zealot-rush": {
      const g = num(p.gates, 2);
      return `${g === 2 ? "투게이트" : `${g}게이트`} 질럿 러시`;
    }
    case "cannon-rush": return "포토러시";
    case "sunken-rush": return "성큰러시";
    case "sneak-rax": return p.firebat ? "몰래 배럭 파이어뱃 러시" : "몰래 배럭";
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
    case "fast-tech": {
      const unit = UNIT_KO[str(p.unit)] ?? "";
      return unit ? `패스트 ${unit}` : "";
    }
    case "cloak-wraith": return "클로킹 레이스";
    case "irradiate": return "이레디에이트";
    case "guardian": return "가디언";
    case "bc": return "배틀크루저";
    default: return "";
  }
}

/** 숫자를 우리말로 읽었을 때 받침이 있나 — "320(삼백이십)을", "42(사십이)를"처럼 조사가
 *  달라진다. 마지막 자리가 0이면 십/백/천 단위가 끝소리가 되고, 그 셋은 모두 받침이 있다. */
function numBatchim(n: number): boolean {
  const d = Math.abs(Math.trunc(n)) % 10;
  if (d !== 0) return d === 1 || d === 3 || d === 6 || d === 7 || d === 8;
  return Math.abs(Math.trunc(n)) !== 0; // 십·백·천·만은 모두 받침으로 끝난다
}
/** 숫자 뒤의 목적격/도구격 조사. */
const numReul = (n: number): string => `${n}${numBatchim(n) ? "을" : "를"}`;
const numRo = (n: number): string => `${n}${numBatchim(n) ? "으로" : "로"}`;

/** 문장 끝의 명사형('-ㅁ')을 평서형('-다')으로 바꾼다(지적: ~함 체를 ~했다 체로).
 *  "…뚫음" → "…뚫었다", "…모자랐음" → "…모자랐다". 다만 "…견제", "…승리", "…역부족"처럼
 *  명사로 끝나는 문장은 그 자체가 한 단어라 손대지 않는다 — 표에 없는 끝은 그대로 둔다. */
function toPlain(sentence: string): string {
  // 이미 과거형인 명사형("…했음", "…모자랐음")은 끝의 '음'만 '다'로 갈면 된다. '았/었/였'
  // 글자만 보면 "모자랐음"처럼 앞 글자에 받침 ㅆ이 얹힌 꼴을 놓치므로 종성으로 가른다
  // (한글 음절 = 0xAC00 + (초성*21+중성)*28 + 종성, ㅆ은 20번).
  if (sentence.endsWith("음") && sentence.length >= 2) {
    const prev = sentence.charCodeAt(sentence.length - 2);
    if (prev >= 0xac00 && prev <= 0xd7a3 && (prev - 0xac00) % 28 === 20) {
      return `${sentence.slice(0, -1)}다`;
    }
  }
  // 여기서부터는 명사형('-ㅁ')만 손댄다 — "…역부족", "…승리", "…실패"처럼 명사로 끝나는
  // 문장은 그 자체가 한 단어라 평서형으로 펴면 오히려 어색해진다(요청).
  const last = sentence.charCodeAt(sentence.length - 1);
  const jong = last >= 0xac00 && last <= 0xd7a3 ? (last - 0xac00) % 28 : -1;
  const nominal = jong === 16 || jong === 10; // ㅁ, ㄻ("흔듦"·"살")
  if (!nominal) return sentence;
  const c = toConnective(sentence);
  return c && c.endsWith("으나") ? `${c.slice(0, -2)}다` : sentence;
}

/** 그 문장이 어느 편에 유리한 국면인가 — 다음 문장을 어떻게 이을지 정하는 기준이다(요청:
 *  전황이 굉장히 중요하다). +1은 이긴 편 쪽으로, -1은 진 편 쪽으로 기운 국면이고, 0은
 *  어느 쪽도 아니라는 뜻이다.
 *
 *  beat의 won은 '그 일을 한 사람이 어느 편인가'일 뿐이라 그대로 쓰면 안 된다 — 제 러시가
 *  역풍을 맞았거나(rush-backfire) 자원부터 챙기다 얻어맞은(greedy-punished) 문장은 한 사람의 일이지만
 *  국면은 상대 쪽으로 기운 것이다. 반대로 대치·소모전·손 빠르기처럼 어느 편에도 기울지
 *  않는 문장은 0이라, 그 앞뒤를 "하지만"으로 잇는 건 없는 반전을 지어내는 셈이 된다. */
function tideOf(b: ReplaySummaryBeat): -1 | 0 | 1 {
  if (NEUTRAL_BEATS.has(b.k)) return 0;
  const mine = b.won ? 1 : -1;
  return (AGAINST_ACTOR.has(b.k) ? -mine : mine) as -1 | 1;
}

/** 여럿을 늘어놓을 때 쓰는 꼴 — "A의 바이오닉 한 방과 B의 3게이트 질럿 러시"는 어색하다.
 *  목록 안에서는 '한 방'을 떼고 병력으로 부른다(요청: 누구의 바이오닉 병력으로). */
const listForm = (label: string): string => label.replace(/ 한 방$/, " 병력");

const TEMPLATES: Record<string, Tpl> = {
  // 들이친 수와 그 결과를 한 문장으로(요청) — 그 타이밍에 상대 생산이 끊긴 게 근거다.
  "raid-damage": (c) => {
    const label = tacticLabel(str(c.p.k), c.p);
    if (!label) return null;
    const of = c.whom ? `${c.whom}의 ` : "상대 ";
    const foe = c.whom || "상대";
    // 한 사람이 여러 수에 잇달아 무너졌으면 한 문장으로 묶는다(지적: 같은 이야기가 두 번
    // 나옴). "Rex의 9드론 저글링 러시와 제롬의 4게이트 질럿 러시에 군범이 2분 만에 무너짐".
    const ks = list(c.p.ks);
    if (ks.length >= 2 && c.whoList.length === ks.length) {
      const vs = list(c.p.vs);
      const each = c.whoList
        .map((n, i) => ({
          n,
          // 값이 없으면 아예 넘기지 않는다 — 0을 넘기면 "0게이트 질럿 러시"가 나온다.
          label: listForm(tacticLabel(ks[i], {
            ...(Number(vs[i]) > 0 ? { drones: Number(vs[i]), gates: Number(vs[i]) } : {}),
            firebat: vs[i] === "firebat", lurker: vs[i] === "lurker", unit: vs[i],
          })),
        }))
        .filter((x) => x.label);
      // "패스트 리버와 리버 드랍"처럼 같은 유닛을 두 번 부르는 짝은 하나로 합친다(지적) —
      // 빠르게 뽑아 곧바로 드랍을 간 것이니 "패스트 리버 드랍"이 그 경기의 실제 그림이다.
      for (const x of each) {
        const m = /^패스트 (.+)$/.exec(x.label);
        if (!m) continue;
        const drop = each.find((y) => y !== x && y.n === x.n && y.label === `${m[1]} 드랍`);
        if (drop) { x.label = `패스트 ${m[1]} 드랍`; drop.label = ""; }
      }
      const merged = each.filter((x) => x.label);
      // 같은 수를 여러 명이 가는 일이 흔하다(지적) — 그때 "A의 3게이트 질럿 러시와 B의
      // 3게이트 질럿 러시"는 같은 말을 두 번 하는 것이라, 이름만 묶어 한 번만 말한다.
      const byLabel: { label: string; names: string[] }[] = [];
      for (const x of merged) {
        const g = byLabel.find((y) => y.label === x.label);
        if (g) g.names.push(x.n); else byLabel.push({ label: x.label, names: [x.n] });
      }
      // 다 같은 사람이 여러 수를 간 것이면 이름을 한 번만 부른다 — "Rex의 패스트 리버와
      // 리버 드랍"이라야 읽히지, "Rex의 …와 Rex의 …"는 같은 말을 두 번 하는 것이다(지적).
      const oneName = new Set(merged.map((x) => x.n)).size === 1 ? merged[0].n : "";
      const parts = oneName
        ? [`${oneName}의 ${byLabel.map((g) => g.label).reduce((a, l) => (a ? `${wa(a)} ${l}` : l), "")}`]
        : byLabel.map((g) => `${joinNames(g.names)}의 ${g.label}`);
      if (each.length >= 2 && parts.length >= 1) {
        const head = parts.slice(0, -1).join(", ");
        const all = parts.length >= 2 ? `${wa(head)} ${parts[parts.length - 1]}` : parts[0];
        const m = num(c.p.outMin) || num(c.p.hitMin);
        const when = m > 0 ? `${m}분 만에 ` : "";
        // 누구 기지인지 모르면 "상대 기지가 파괴됨"은 말하지 않는 편이 낫다(지적) —
        // 확인된 건 무슨 수를 갔다는 것뿐이니 거기까지만 말한다.
        if (!c.whom) {
          const labels = byLabel.map((g) => g.label);
          const only = oneName
            ? `${ga(oneName)} ${reul(labels.reduce((a, l) => (a ? `${wa(a)} ${l}` : l), ""))} 감행함`
            : `${ga(joinNames(c.whoList))} ${reul(labels[0])} 감행함`;
          return done(c, only);
        }
        return done(c, c.pick([
          `${all}에 ${ga(foe)} ${when}${c.p.out ? "탈락" : "무너짐"}`,
          `${all}에 ${when}${ga(foe)} 버티지 못함`,
          c.p.out
            ? `${ro(all)} ${when}${ga(foe)} 탈락`
            : `${ro(all)} ${of}생산이 ${when || "빠르게 "}끊김`,
        ]));
      }
    }
    // 당한 사람을 못 짚었으면 피해까지 말하지 않는다(지적) — 무슨 수를 갔다는 것만 말한다.
    if (!c.whom) return `${ga(c.who)} ${done(c, `${reul(label)} 감행함`)}`;
    // "Rex가 리버 드랍 한 방에"가 아니라 "Rex의 리버 드랍 한 방에"라야 읽힌다(지적) —
    // 그런 꼴은 주어까지 문장 안에서 만든다.
    const mine = `${c.who}의 ${label}`;
    // 이름에 이미 '한 방'이 들어 있으면 또 붙이지 않는다(지적: "바이오닉 한 방 한 방에").
    const blow = label.endsWith("한 방") ? `${mine}에` : `${mine} 한 방에`;
    // 뒤에 그 사람이 한 행동이 오는 문장('…로 무엇을 파괴함')은 주격으로 세운다(지적:
    // "조조의 바이오닉 한 방으로 …파괴함"이 아니라 "조조는 바이오닉 한 방으로 …파괴함").
    // 소유격은 당한 쪽이 주어인 '-에' 꼴(아래 blow)에만 남긴다.
    const by = `${ga(c.who)} ${label}`;
    // 초반 올인에 초반부터 무너진 그림(요청) — 몇 분 만이었는지가 곧 이야기다.
    if (c.p.early && !c.p.out) {
      const m = num(c.p.hitMin);
      const when = m > 0 ? `${m}분 만에 ` : "";
      return done(c, c.pick([
        `${ro(by)} ${when}${of}일꾼에 큰 피해를 줌`,
        `${blow} ${when}${ga(foe)} 휘청임`,
        `${blow} ${when}${ga(foe)} 빈사 상태가 됨`,
        `${ro(by)} ${when}${reul(foe)} 몰아붙임`,
      ]));
    }
    // 그 창 안에 실제로 탈락했으면(Leave Game) 짐작이 아니라 사실이다 — 그렇게 말한다.
    if (c.p.out) {
      const min = num(c.p.outMin);
      const when = min > 0 ? `${min}분경 ` : "";
      return done(c, c.pick([
        `${ro(by)} ${when}${reul(foe)} 엘리시킴`,
        `${blow} ${when}${ga(foe)} 탈락`,
        `${ro(by)} ${when}${reul(foe)} 판에서 지움`,
      ]));
    }
    // 그 사람이 한 행동을 말하는 문장은 주격으로(위 by 참고), 상대 쪽 일이 주어인
    // 문장('생산이 막힘')만 소유격으로 둔다.
    return done(c, c.pick([
      `${ro(by)} ${of}생산에 큰 피해를 줌`,
      `${ro(mine)} ${of}생산이 막힘`,
      `${blow} ${of}생산이 뚝 끊김`,
      `${ro(by)} ${of}살림을 크게 흔듦`,
    ]));
  },

  // ── 전술(replayTactics) ──
  "zling-rush": (c) => {
    const n = num(c.p.drones);
    const build = n > 0 ? `${n}드론 저글링 러시` : "초반 저글링 러시";
    // 올인 표현은 '러시'를 갈아 끼운다 — "…저글링 러시 올인러시"가 되면 말이 겹친다.
    const allin = build.replace(/러시$/, "올인 러시");
    const at = targetPhrase(c);
    return `${ga(c.who)} ${at}${done(c, c.pick([
      `${reul(build)} 함`, `빠른 ${reul(build)} 함`, `과감한 ${reul(allin)} 함`,
      `${ira(build)} 날카로운 전략을 꺼냄`, `날카로운 ${reul(build)} 감행함`,
      // 깎아내리는 말은 졌거나, 이겼더라도 한 종류만 주야장천 뽑았을 때만(지적).
      ...(c.won && !c.p.solo ? [] : [`무지성 ${reul(build)} 함`]),
      ...(c.won ? [] : [`무리하게 ${reul(build)} 함`]),
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
    // 질럿 러시는 도박이 아니라 정석이다(지적) — 실패했다고 "결국 망함"으로 맺지 않는다.
    // 한 유닛만 뽑고 달린 경우에만 '무지성'을 붙인다.
    return `${ga(c.who)} ${at}${done(c, c.pick([
      `${label} 질럿 러시를 함`, `빠른 ${label} 질럿 러시를 함`,
      ...(g >= 3 ? [`${label} 질럿 올인 러시를 함`] : []),
      ...(c.p.solo ? [`무지성 ${label} 질럿 러시를 함`] : []),
    ]))}`;
  },
  "cannon-rush": (c) => {
    const at = targetPhrase(c);
    return `${ga(c.who)} ${at}${done(c, c.pick([
      "포토러시를 함", "초반 포토러시를 함", "빠른 포토러시를 시도함",
      "예상치 못한 포토러시를 함",
      "포토러시라는 날카로운 전략을 꺼냄", "날카로운 포토러시를 감행함",
    ]), true)}`;
  },
  // 리콜은 병력을 통째로 상대 뒤에 떨구는 수라, 말도 그만큼의 무게로 한다(요청).
  recall: act([
    "아비터 리콜로 병력을 통째로 뒤에 떨굼", "아비터 리콜로 뒤를 파고듦",
    "과감한 아비터 리콜로 판을 흔듦", "리콜 한 방으로 전황을 뒤집으려 함",
    "아비터를 띄워 리콜로 승부를 걸음",
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
        ...(amount ? [`${reul(u)} ${amount} 뽑았으나 망함`, `${reul(u)} ${amount}나 뽑고도 소용없었음`] : []),
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
          ? ["먼저 엘리당함", "제일 먼저 탈락하며 한 명이 빠짐", "먼저 지워짐"]
          : ["엘리당함", "탈락함"]
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
        "몰래 배럭 파이어뱃 러시를 함",
        "몰래 배럭 파이어뱃이라는 날카로운 전략을 꺼냄",
        ...(c.won ? [] : ["무리하게 몰래 배럭 파이어뱃 러시를 함"]),
      ]), true)}`;
    }
    return `${ga(c.who)} ${at}${done(c, c.pick([
      "몰래 배럭을 올림", "몰래 배럭을 시도함", "이른 시간에 몰래 배럭을 올림",
      "예상치 못한 몰래 배럭을 올림",
      "몰래 배럭이라는 날카로운 빌드로 허를 찌름", "날카로운 몰래 배럭으로 허를 찌름",
    ]), true)}`;
  },
  // 성큰러시 — 내 기지가 아닌 곳에 초반부터 성큰을 박는 올인(요청). 해처리는 펴지 않는다.
  "sunken-rush": (c) => {
    const at = targetPhrase(c);
    return `${ga(c.who)} ${at}${done(c, c.pick([
      "성큰러시를 함", "초반 성큰러시를 함", "빠른 성큰러시를 시도함",
      "예상치 못한 성큰러시를 함",
      // 상대의 허점을 노린 수는 '날카로운 빌드'라 부른다(요청).
      "성큰러시라는 날카로운 전략을 꺼냄", "날카로운 성큰러시로 허를 찌름",
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
  center: (c) => {
    const n = num(c.p.n);
    const b = BUILDING_KO[str(c.p.b)];
    const what = b ? `${b}${n > 1 ? ` ${n}개` : ""}` : `건물 ${n || 3}채`;
    return `${ga(c.who)} ${done(c, c.pick([
      `센터까지 ${reul(what)} 지음`,
      `센터에 ${reul(what)} 지어 자리를 잡음`,
    ]))}`;
  },

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
  // 그래서 진 쪽에는 도박수와 같은 맺음(망함·소용없었음)을 붙인다.
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

  // 같은 수를 서로 갔는데 한쪽만 통한 경우(지적) — 두 문장으로 나누면 앞뒤가 뒤집혀 읽힌다.
  "duel-rush": (c) => {
    const label = tacticLabel(str(c.p.k), c.p);
    if (!label) return null;
    const foe = c.whom || "상대";
    const m = num(c.p.outMin) || num(c.p.hitMin);
    const when = m > 0 ? `${m}분 만에 ` : "";
    const head = `${wa(foe)} ${ga(c.who)} ${reul(label)} 갔는데`;
    if (c.p.out) {
      return `${head}, ${neun(foe)} 막히고 ${ga(c.who)} ${when}${reul(foe)} 엘리시킴`;
    }
    return `${head}, ${neun(foe)} 막히고 ${ga(c.who)} ${when}${foe}의 ${c.pick([
      "생산에 큰 피해를 줌", "살림을 크게 흔듦",
    ])}`;
  },

  // 초반 올인이 막히고 역으로 무너진 경우(요청) — 러시가 실패한 것만 말하는 것보다,
  // 그 뒤에 제 살림이 무너진 것까지 이어야 이야기가 된다.
  "rush-backfire": (c) => {
    const label = tacticLabel(str(c.p.k), c.p) || "초반 러시";
    // 러시가 막힌 뒤에 오는 건 '살림이 무너짐'이 아니라 테크·발전에서의 손해다(지적).
    const opts = [
      `${reul(label)} 갔으나 막힘`,
      `${ga(label)} 실패함`,
      `${reul(label)} 갔다가 막혀 테크에서 손해를 봄`,
      `${label}가 막힌 뒤 발전이 늦어짐`,
      `${label} 실패로 한동안 발전을 못함`,
    ];
    // '상대만 테크를 탐'은 상대가 한 사람일 때만 말이 된다(지적) — 팀전에서는 빼 둔다.
    if (c.p.duel === true) opts.push(`${reul(label)} 갔다가 막혀 그 사이 상대만 테크를 탐`);
    return `${ga(c.who)} ${c.pick(opts)}`;
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
    // 마지막 꼴은 주어가 '일꾼'이라 바깥 주어를 붙이면 주어가 둘이 된다 — 통째로 만든다.
    return done(c, c.pick([
      `${ga(c.who)} ${ro(label)} ${foe}일꾼을 잡아냄`,
      `${ga(c.who)} ${ro(label)} ${foe}일꾼 줄을 계속 끊음`,
      `${foe}일꾼이 ${c.who}의 ${label}에 계속 잡혀 다시 뽑기 바쁨`,
    ]));
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
    ]))}`;
  },

  // 발키리 오버로드 사냥(요청) — 발키리가 뜬 뒤 상대가 오버로드를 다시 뽑기 시작했다면
  // 그건 계속 잡히고 있었다는 뜻이다. 그림이 확실해서 대상까지 지목한다.
  "valk-hunt": (c) => {
    const foe = c.whom ? `${c.whom}의 ` : "상대 ";
    return done(c, c.pick([
      `${ga(c.who)} 발키리를 띄워 ${foe}오버로드를 계속 잡아냄`,
      `${ga(c.who)} 발키리로 ${foe}오버로드를 사냥함`,
      `${foe}오버로드가 ${c.who}의 발키리에 계속 녹아 다시 뽑히기 바쁨`,
    ]));
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

  // 병력을 늦게까지 안 뽑고 자원부터 챙긴 것. 얻어맞았으면 그 이야기가 되고, 무사히
  // 넘겼으면 그 뒤의 물량이 이야기가 된다. '째다'라는 말은 쓰지 않는다(요청) — 무엇을
  // 먼저 했는지 그대로 말하는 편이 읽는 사람에게 더 분명하다.
  "greedy-punished": (c) => {
    const m = num(c.p.min);
    const when = m > 0 ? `${m}분까지 ` : "";
    const foe = c.whom ? `${c.whom}의 ` : "상대의 ";
    return `${ga(c.who)} ${done(c, c.pick([
      `무리하게 자원부터 챙기다가 ${foe}공격에 노출됨`,
      `초반에 병력을 미루다가 ${foe}공격에 무너짐`,
      `${when}병력보다 일꾼을 먼저 채우다 ${foe}공격에 노출됨`,
      `병력을 너무 늦추다 ${foe}공격에 그대로 무너짐`,
    ]))}`;
  },
  "greedy-paid": (c) => {
    const unit = UNIT_KO[str(c.p.unit)] ?? "병력";
    const m = num(c.p.min);
    const when = m > 0 ? `${m}분까지 ` : "";
    // 마지막 꼴은 주어를 문장 안에서 만든다 — 다른 곳에서 싸움이 나는 동안 조용히 컸다는
    // 그림이라(요청) 앞머리가 '그 사이'로 시작해야 읽힌다.
    return done(c, c.pick([
      `${ga(c.who)} 자원을 먼저 챙긴 덕에 ${unit} 물량이 폭발함`,
      `${ga(c.who)} 초반을 무사히 넘기고 ${unit} 물량이 폭발함`,
      `${ga(c.who)} ${when}일꾼부터 채운 뒤 ${reul(unit)} 쏟아냄`,
      `${ga(c.who)} 자원을 넉넉히 벌어 ${unit} 물량으로 밀어붙임`,
      `그 사이 조용히 몸집을 불린 ${ga(c.who)} ${unit} 물량을 뽑아냄`,
    ]));
  },

  // 패스트 OO(요청) — 보통 나오는 때보다 이르게 뽑아 상대가 준비하기 전에 들이대는 수.
  "fast-tech": (c) => {
    const unit = UNIT_KO[str(c.p.unit)] ?? "";
    if (!unit) return null;
    const m = num(c.p.min);
    const when = m > 0 ? `${m}분 만에 ` : "";
    const at = targetPhrase(c);
    return `${ga(c.who)} ${at}${done(c, c.pick([
      `${ro(`패스트 ${unit}`)} 승부를 걸음`,
      `${ira(`패스트 ${unit}`)} 날카로운 빌드로 허를 찌름`,
      `${when}${reul(unit)} 뽑아 상대가 준비하기 전에 들이댐`,
      `${unit} 타이밍을 크게 당김`,
    ]))}`;
  },
  // 파워 OO(요청) — 한 유닛만 압도적으로 뽑아 그 물량으로 밀어붙이는 그림.
  "power-unit": (c) => {
    const unit = UNIT_KO[str(c.p.unit)] ?? "";
    if (!unit) return null;
    const n = num(c.p.n);
    // 이 수는 그 순간의 병력이 아니라 경기 내내 뽑은 총량이다 — 그렇게 말해야 정확하다(지적).
    return `${ga(c.who)} ${done(c, c.pick([
      `${ro(`파워 ${unit}`)} 밀어붙임`,
      `${unit}만 경기 내내 총 ${n}기를 뽑아 물량으로 승부함`,
      `${reul(unit)} 총 ${n}기나 뽑아내며 물량으로 몰아침`,
      `경기 내내 ${unit} 물량을 많이 뽑아냄`,
      `${unit} 물량 하나로 판을 끌고 감`,
    ]))}`;
  },
  // 클로킹 레이스(요청) — 보이지 않는 병력이라 대공이 없으면 그대로 뚫린다.
  "cloak-wraith": (c) => {
    const n = num(c.p.n);
    const at = targetPhrase(c);
    return `${ga(c.who)} ${at}${done(c, c.pick([
      `클로킹 레이스로 하늘을 잡음`,
      `레이스 ${n}기에 클로킹까지 올려 흔듦`,
      `보이지 않는 레이스로 휘저음`,
    ]))}`;
  },
  // 이레디에이트(요청) — 베슬 한 기가 일꾼 줄을 통째로 지운다.
  irradiate: (c) => {
    const of = c.whom ? `${c.whom}의 ` : "상대 ";
    return `${ga(c.who)} ${done(c, c.pick([
      `사이언스 베슬 이레디에이트로 ${of}일꾼을 견제함`,
      `이레디에이트로 ${of}일꾼을 압박함`,
      `베슬을 띄워 이레디에이트로 ${of}일꾼을 계속 압박함`,
    ]))}`;
  },
  // 인페스티드 테란(요청) — 퀸이 커맨드센터를 감염시켜야만 나오는, 경기당 한 번 볼까 말까
  // 한 사건이다. 당한 쪽 입장에서는 그 자체가 이야기라 그렇게 말한다.
  infested: (c) => {
    const of = c.whom ? `${c.whom}의 ` : "상대 ";
    // 가운뎃 꼴은 주어가 '기지'라 바깥 주어를 붙이면 주어가 둘이 된다 — 통째로 만든다.
    return done(c, c.pick([
      `${ga(c.who)} 퀸으로 ${of}기지를 감염시켜 인페스티드 테란까지 뽑아냄`,
      `${c.who}의 퀸에 ${of}기지가 감염되는 사태가 벌어짐`,
      `${ga(c.who)} 인페스티드 테란을 뽑아내며 ${of}수치를 안김`,
    ]));
  },
  // 마인드 컨트롤(요청) — 뺏은 일꾼으로 남의 종족을 통째로 굴리는 그림.
  "mind-control": (c) => {
    const race = str(c.p.race) || "다른 종족";
    return `${ga(c.who)} ${done(c, c.pick([
      `마인드 컨트롤로 ${race} 유닛까지 뽑아 씀`,
      `일꾼을 뺏어 ${race}까지 함께 굴림`,
      `마인드 컨트롤로 ${race} 살림을 통째로 가져옴`,
    ]))}`;
  },

  // 손이 유난히 빨랐던 사람(요청) — 숫자만 던지지 않고 그 숫자가 무엇으로 나타났는지까지
  // 말한다. 컨트롤과 생산, 둘 다 손에서 나온다.
  "fast-hands": (c) => {
    const n = num(c.p.apm);
    const label = c.p.eff ? "유효 APM" : "APM";
    if (n <= 0) return null;
    // 손이 유난히 빨랐던 경기는 숫자만 적기보다 그 손이 무엇을 했는지까지 말해 준다(요청).
    return `${ga(c.who)} ${done(c, c.pick(c.p.elite ? [
      `${label} ${numReul(n)} 찍으며 멋진 컨트롤을 보여줌`,
      `${label} ${numRo(n)} 놀라운 컨트롤을 보여줌`,
      `${label} ${numReul(n)} 찍으며 손끝으로 판을 흔듦`,
      `${label} ${numRo(n)} 혼자 다른 속도로 경기를 하며 컨트롤에서 차이를 냄`,
    ] : [
      `${label} ${numRo(n)} 손이 가장 빨랐고 컨트롤에서 차이를 냄`,
      `${label} ${numReul(n)} 찍으며 생산과 컨트롤을 쉬지 않음`,
      `${label} ${numRo(n)} 혼자 다른 속도로 경기를 함`,
    ]))}`;
  },
  // 양쪽이 병력을 계속 쏟아부은 경기(요청) — 한 방 싸움이 아니라 소모전이었다는 말이다.
  attrition: (c) => {
    const n = num(c.p.n);
    const m = num(c.p.min);
    return c.pick([
      `양 팀이 ${m}분 동안 병력 ${n}기를 쏟아부은 소모전이었음`,
      `쉼 없이 병력이 갈려 나간 소모전으로 흘러감`,
      `${m}분 내내 병력을 계속 부딪친 소모전이 이어짐`,
    ]);
  },

  // 아군 기지에 포토를 깔아 주는 것 — 제 이득이 아니라 팀을 위한 수라 따로 말한다(요청).
  "ally-cannon": (c) => {
    const n = num(c.p.n);
    const host = c.who2 ? `${c.who2}의 ` : "아군 ";
    return `${ga(c.who)} ${done(c, c.pick([
      `${host}기지에 포토 ${n}개를 깔아 줌`,
      `${host}기지를 포토로 받쳐줌`,
      `${host}기지에 포토를 지어 방어를 도움`,
    ]))}`;
  },

  // 병력 건물 없이 자원부터 늘린 것 — 순서가 곧 증거다(요청).
  "greedy-build": (c) => {
    const kind = str(c.p.kind);
    const what = kind === "hatch" ? "해처리" : kind === "nexus" ? "투넥서스" : "투커맨드";
    return `${ga(c.who)} ${done(c, c.pick(
      kind === "hatch"
        ? [`해처리를 먼저 늘리는 전략을 시도함`, `초반부터 해처리를 늘려 자원을 앞세움`,
           `해처리를 먼저 올려 자원을 챙기는 전략을 씀`]
        : [`${reul(what)} 먼저 올리는 전략을 시도함`, `초반부터 ${ro(what)} 자원을 앞세움`,
           `${reul(what)} 먼저 가져가 자원을 챙기는 전략을 씀`],
    ))}`;
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
              ...(SUPPORT_UNITS.has(str(c.p.heroUnit)) ? [] : [`${heroUnit} 물량으로 경기를 캐리함`]),
            ])}`
          : `${c.who2 === c.who ? "" : `${c.who2}의 `}${ro(`${heroUnit} ${role}`)} ${c.pick([
              ROLE_TAIL[role] ?? "승기를 잡음", "팀의 승리를 이끔",
              // 혼자 경기를 끝내지 못하는 보조유닛에는 '캐리'를 쓰지 않는다(지적) —
              // 그쪽은 '보조함'이 맞는 말이다.
              ...(SUPPORT_UNITS.has(str(c.p.heroUnit))
                ? ["팀을 강력하게 보조함"]
                : ["경기를 캐리함", "승리를 캐리함"]),
            ])}`
        : null;
    const withHero = (main: string): string => {
      if (!hero) return main;
      // 앞마디를 연결형으로 바꿔야 "…뒤집었고, 조조가 …"처럼 읽힌다 — 명사형 그대로 두면
      // 문장 한가운데에 '-ㅁ'이 남는다.
      return `${toAnd(main) ?? main}, ${hero}`;
    };

    const who = ga(c.who);
    // 팀전 승리는 한 사람의 공이 아니다(요청) — 각자가 무엇으로 싸웠는지를 나란히 말한다.
    // 흐름을 이미 말하는 초반 승리·역전에는 얹지 않는다(문장이 길어지고 앞뒤가 어긋난다).
    const team = teamPhrase(c);
    if (team && (mode === "plain" || mode === "late")) {
      // "길게 끌어"는 쓰지 않는다(지적) — 장기전이었다는 말로 바꾼다.
      const t = mode === "late" ? c.pick(["후반 ", "장기전 끝에 ", "긴 대치 끝에 "]) : "";
      const body2 = head + `${t}${team} ${c.pick(["승리", "이김"])}`;
      return withHero(body2);
    }
    if (spectacle) {
      const b2 = `${c.who}의 ${c.pick([
        `${spectacle}까지 나온 끝에 승리`,
        `${reul(spectacle)} 앞세워 승리`,
        `${spectacle} 한 방으로 승부를 냄`,
      ])}`;
      return withHero(b2);
    }
    // 조합을 빼면 "초반 승리"처럼 앙상해지므로, 그럴 땐 수식도 같이 정리한다.
    let body: string;
    if (mode === "rush") {
      body = phrase
        ? `${who} ${c.pick([`초반 ${p}승리`, `초반 ${p}그대로 끝냄`, `초반 ${p}승리를 결정지음`])}`
        : `${who} ${c.pick(["승리", "그대로 끝냄", "그대로 승리를 결정지음"])}`;
    } else if (mode === "comeback") {
      const late = c.p.wentLate ? "후반에 " : "";
      // 전반과 후반이 아예 뒤집힌 경기는 그냥 '역전'이 아니라 대역전이다(요청).
      body = c.p.swing
        ? `${who} ${c.pick([
            `초반을 완전히 내주고도 ${late}${p}대역전`,
            `전반을 내주고 ${late}${p}판을 통째로 뒤집음`,
            `일방적으로 밀리다가 ${late}${p}극적으로 역전`,
          ])}`
        : `${who} ${c.pick([`초반 열세이다가 ${late}${p}역전`, `밀리다가 ${late}${p}뒤집음`])}`;
    } else if (mode === "late") {
      body = `${who} ${c.pick([`후반 ${p}승리`, `장기전 끝에 ${p}승리`, `긴 대치 끝에 ${p}승리`])}`;
    } else {
      // 주력을 부대 단위로 뽑았으면 그 규모 자체가 그림이다(요청) — 12기를 한 부대로 센다.
      const leadKo = UNIT_KO[list(c.p.units)[0] ?? ""] ?? "";
      const squads = Math.floor(num(c.p.unitN) / 12);
      const bulk = leadKo && squads >= 2 && !cont
        ? [`${leadKo} ${squads}부대를 뽑아 승리`, `${leadKo}만 ${squads}부대 넘게 생산해 이김`]
        : [];
      body = phrase
        ? `${who} ${c.pick([`${p}승리`, `${p}이김`, `${p}승리를 결정지음`, ...bulk])}`
        : `${who} ${c.pick(["그대로 승리", "그대로 가져감"])}`;
    }

    // 맺음말은 "결국 …"으로 열어도 좋다(요청) — 앞의 흐름을 받아 마무리한다는 신호가 된다.
    // 이미 시간·흐름을 말하는 머리말(혈투 끝에 / 몇 분 만에)이 붙었으면 겹치므로 뺀다.
    // 이어받기 문구(contPhrase)가 이미 "결국"을 품고 있으면 또 붙이지 않는다.
    const close = head || body.includes("결국") ? head + body : c.pick(["", "결국 "]) + body;
    return withHero(close);
  },
};

/** 이 키를 지금 코드가 문장으로 옮길 수 있나 — 만들 때 미리 걸러내는 용도. */
export function hasSummaryTemplate(key: string): boolean {
  return key in TEMPLATES;
}

// 같은 이름이 두 번 들어오면(한 사람의 여러 수를 묶었을 때) "Rex·Rex"가 된다(지적) — 접는다.
const joinNames = (names: string[]): string =>
  [...new Set(names.filter(Boolean))].join("·");

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
  resolveName: (rawName: string) => string,
  /** 이름 → 팀 번호. 없으면 팀을 짚는 말("2팀에서는")을 쓰지 않는다. */
  teamOf?: (name: string) => 1 | 2 | undefined,
): string | null {
  if (!isReplaySummaryData(data)) return null;
  const out: string[] = [];
  // 앞 문장과 인과로 이어지는 자리를 표시해 둔다(요청: 서사·인과가 있어야 재밌다).
  // 크게 한 방 먹인 바로 다음에 같은 사람이 또 무언가를 했다면 그건 '그 기세로' 한 것이다.
  let prev: ReplaySummaryBeat | null = null;
  // 바로 앞 문장에 쓴 이음말 — 같은 말이 연달아 나오면 어색하다(지적). 다음 것으로 민다.
  let lastLink = "";
  // 바로 앞 문장의 주어 — 같은 주어가 이어지면 한 문장으로 합친다(지적).
  let lastSubject = "";
  // 그 주어의 이름(조사 없이) — 앞 문장이 "…가"로 시작했든 "…는"으로 시작했든 알아보려면
  // 이름 자체가 필요하다.
  let lastBaseWho = "";
  // 앞 문장에서 무언가를 한 사람 / 당한 사람 — 같은 사람이 역할을 바꿔 다시 나오면
  // 이름을 또 부르지 않고 이야기로 잇는다(지적).
  let lastWho: string[] = [];
  let lastWhom: string[] = [];
  // 지금 문장에 몇 마디를 이어 붙였나 — 끝없이 길어지지 않게 센다.
  let chainCount: number = 0;
  const beats = data.beats as ReplaySummaryBeat[];
  // 부정적인 맺음을 붙일 단 한 자리 — 진 편 문장 중 마지막 것(맺음말은 제외).
  let lastLostIdx = -1;
  for (let i = 0; i < beats.length; i += 1) {
    const b = beats[i];
    if (b && b.k !== "result" && !b.won && TEMPLATES[b.k]) lastLostIdx = i;
  }
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
    const baseWho = who;
    const subject = ga(baseWho);
    const prevLine = out.length > 0 ? out[out.length - 1] : "";
    // 같은 이음말이 연달아 나오면 어색하다(지적) — 앞에서 쓴 것이 걸리면 다음 것으로 민다.
    const prevBody = prevLine.replace(
      new RegExp(`^${LINK_HEAD()} `), "",
    );
    // 앞 문장이 그 사람을 주어로 세우고 시작했나 — "…의 무엇에 누구의 기지가 파괴됨"처럼
    // 소유격으로 시작한 문장에는 다음 마디를 이어 붙일 수 없다(지적).
    const prevLedBy = (name: string): boolean =>
      name !== "" && (prevBody.startsWith(`${ga(name)} `) || prevBody.startsWith(`${neun(name)} `));
    const link = (opts: string[]): string => {
      // 한 요약 안에서 "하지만 … 그러나 … 그렇지만"이 잇달아 나오면 겉돈다(지적) —
      // 앞에서 역접을 썼으면 이번엔 "반면 / 한편"처럼 다른 결의 말로 넘긴다.
      const pool = ADVERSATIVE.has(lastLink) && opts.some((o) => !ADVERSATIVE.has(o))
        ? opts.filter((o) => !ADVERSATIVE.has(o))
        : opts;
      let t = pool[seed % pool.length];
      if (t === lastLink && pool.length > 1) t = pool[(seed + 1) % pool.length];
      lastLink = t;
      return t;
    };
    const gapSec = prev && typeof prev.at === "number" && typeof b.at === "number"
      ? Math.abs(prev.at - b.at) * SECONDS_PER_FRAME
      : null;
    const linkable = !!prev && b.k !== "result" && prev.k !== "result";
    // 이 문장과 앞 문장이 각각 어느 편으로 기운 국면인가(요청: 전황이 굉장히 중요하다).
    // 0은 어느 쪽도 아니라는 뜻이라, 그런 문장 앞뒤는 반전으로 잇지 않는다.
    const tide = tideOf(b);
    const prevTide = prev ? tideOf(prev) : 0;
    // 맺음말은 앞 문장에 이어 붙이는 편이 자연스럽다(요청: "…했고 결국 이겼다",
    // "…했지만 결국 이겼다"). 앞 전황이 진 편 쪽이면 '-지만'으로 뒤집으며 받고, 같은
    // 편 쪽이면 '-고'로 그대로 받는다. 앞 문장이 이미 이어 주는 어미를 품고 있으면
    // 접속이 두 번 겹치므로 그때만 끊는다.
    const endJoinCandidate =
      b.k === "result" && out.length > 0 && chainCount === 0
      && !/지만|으나|다가/.test(prevLine)
      && !!(prevTide < 0 ? toBut(prevLine) : toAnd(prevLine));
    // 전황이 실제로 반대편으로 넘어갔나 / 같은 편으로 이어지나.
    const flipped = tide !== 0 && prevTide !== 0 && tide !== prevTide;
    // 두 일이 한 문장에 들어갈 만큼 가까운 때에 일어났나 — 시간이 벌어졌으면 무슨 관계든
    // 문장을 나눈다(지적). 시점을 모르는 문장(맺음말 등)은 이 조건에서 뺀다.
    // 시점을 모르는 문장(경기 전체를 두고 하는 말 — 총 생산량 등)은 앞말에 붙여도
    // 시간이 어긋날 일이 없으므로 '가까운 것'으로 친다.
    const closeEnough = gapSec === null || gapSec <= JOIN_MAX_SEC;
    const sameTide = tide !== 0 && tide === prevTide;
    // 앞뒤가 같은 종류의 일이면(양쪽이 서로 견제를 주고받은 것처럼) 시간이 좀 벌어져도
    // 한 문장으로 묶는 편이 낫다(요청) — 같은 이야기를 두 문장으로 끊어 놓고 "그렇지만"을
    // 붙이면 오히려 겉돈다. 다만 십수 분 떨어진 일까지 묶지는 않는다.
    const sameKind = !!prev
      && (prev.k === b.k
        // 같은 틀이 아니어도 '누가 누구에게 무엇을 했다'는 같은 결의 문장이면 비슷한
        // 이야기다(지적) — 그런 둘은 이음말로 갈라 놓지 말고 한 문장으로 잇는다.
        || ((prev.whom ?? []).length > 0 && (b.whom ?? []).length > 0))
      && (gapSec === null || gapSec <= STANDOFF_SEC);
    /** 앞 문장을 '-지만'으로 바꿔 이번 문장을 이어 붙일 수 있나. */
    const canFlipJoin = (): boolean => {
      const line = out.length > 0 ? out[out.length - 1] : "";
      if (line === "" || chainCount !== 0) return false;
      if (new RegExp(`^${LINK_HEAD()} `).test(line)) return false;
      if (/지만|으나|다가/.test(line)) return false;
      return !!toBut(line);
    };
    // 거의 같은 때에 벌어진 서로 다른 사람의 일은 한 문장으로 잇는 편이 자연스럽다
    // (요청: "브래드는 ~했고 정구는 ~했음"). 같은 사람 이야기면 주어가 겹쳐 어색해 뺀다.
    const sharesWho = (b.who ?? []).some((w) => (prev?.who ?? []).includes(w));
    let joinPrev = false;
    // 전황이 뒤집히는 자리를 한 문장으로 이을 것인가(아래 참고).
    let flipJoin = false;
    // "2팀에서는" — 팀전에서 흐름이 어느 편으로 넘어갔는지 짚는 말(요청).
    let teamTag = "";
    // 문장 앞에 붙인 이음말 — 만들어진 문장과 겹치면 도로 떼어낸다(아래 참고).
    let linkWord = "";
    // 팀전에서 흐름이 어느 편으로 넘어갔는지 짚는 말(요청: "하지만 1팀에서는 …") —
    // 앞 문장과 다른 팀일 때만 붙인다.
    // 앞 문장과 이번 문장의 주체가 서로 다른 팀인가 — 팀 표시와 '도' 붙이기에 함께 쓴다.
    const myTeam = teamOf?.(names[0] ?? "");
    const prevTeam = teamOf?.(((prev?.who ?? []).map(resolveName))[0] ?? "");
    const crossTeam = !!myTeam && !!prevTeam && myTeam !== prevTeam;
    // 앞 문장에서 맞은 쪽이 이번엔 때리는 쪽인가 — 같은 두 사람이 주고받은 이야기다.
    const headToHead =
      (b.who ?? []).some((w) => (prev?.whom ?? []).includes(w))
      || (b.whom ?? []).some((w) => (prev?.who ?? []).includes(w));
    // "1팀에서는"은 어색하다(지적) — "1팀의 누구는" 꼴로만 쓴다.
    const teamTagFor = (): string => (crossTeam ? `${myTeam}팀의 ` : "");
    // 같은 사람이 주인공인 이야기가 잇달아 나오면 문장을 나누지 말고 한 문장으로 잇는다
    // (요청: 세 문장까지는 합치기). 이음말을 앞에 붙이면 문장이 그 말로 시작해 이어 붙일
    // 수 없으므로, 이을 참이면 이음말 고르기 자체를 건너뛴다 — 아래 sameSubject가 받는다.
    const subjectRun =
      linkable && sharesWho && !flipped && closeEnough && chainCount < MAX_CHAIN
      && lastSubject === subject && prevLedBy(lastBaseWho) && !!toAnd(prevLine);
    if (subjectRun) {
      // 아무것도 붙이지 않는다.
    } else if (
      prev && b.k !== "result"
      && (prev.k === "raid-damage" || prev.k === "gang-rush")
      && sameTide
      && sharesWho
      // "그 기세로"는 바로 이어졌을 때만 쓸 수 있다 — 몇 분 뒤 일에 붙이면 거짓이 된다.
      && closeEnough
    ) {
      // 앞 문장과 주어가 같으면 이음말을 붙이는 대신 한 문장으로 잇는다(지적: 같은 이름이
      // 두 번 나오지 않게) — 이음말을 붙이면 문장이 그 말로 시작해 이어 붙일 수 없다.
      if (!(lastSubject === subject && prevLedBy(lastBaseWho) && chainCount < MAX_CHAIN)) {
        who = `${link(["그 기세로", "여세를 몰아", "그 기세를 이어간"])} ${who}`;
      }
    } else if (linkable && gapSec !== null && gapSec <= SAME_TIME_SEC) {
      if (!sharesWho && seed % 2 === 0) joinPrev = true;
      else if (flipped) {
        // 비슷한 두 문장은 "하지만 …"으로 갈라 놓지 말고 "…했지만 …했다"로 바로
        // 잇는다(지적). 못 이을 때만 대비를 뜻하는 말을 앞에 단다.
        if (canFlipJoin()) flipJoin = true;
        else {
          linkWord = link(["반면", "하지만", "그러나"]);
          teamTag = teamTagFor();
        }
      } else if (sameTide) {
        // 같은 편 이야기가 거의 같은 때에 겹쳤을 뿐이라, 동시성만 짚는다.
        linkWord = link(["그와 동시에", "한편"]);
      }
    // 시간이 많이 벌어진 자리는 반드시 짚는다 — 안 짚으면 바로 이어진 일로 읽힌다(요청).
    } else if (
      // 같은 편이 몰아치는 내용이 이어지면 문장을 나누지 말고 "…했고 …했다"로 잇는다(요청)
      // — 사람이 달라도 같은 흐름이라 한 호흡으로 읽히는 편이 낫다. 시점을 모르는 문장
      // (경기 전체를 두고 하는 말)도 여기에 들어온다.
      // 전황이 갈리지 않았고 같은 편 이야기면 잇는다 — 총 생산량처럼 어느 순간을 짚지
      // 않는 문장(tide 0)도 같은 편의 우세를 말하는 것이라 여기에 들어온다.
      linkable && !flipped && !crossTeam && !!prev!.won === !!b.won
      && !sharesWho && closeEnough && chainCount === 0
      && seed % 2 === 0 && out.length > 0 && !!toAnd(out[out.length - 1])
    ) {
      joinPrev = true;
    } else if (linkable && gapSec !== null && (flipped || gapSec > STANDOFF_SEC || seed % 3 === 0)) {
      // 전황이 한 편에서 다른 편으로 넘어가는 자리는 늘 짚어 준다(요청) — 읽는 사람이
      // 흐름이 바뀌었다는 걸 알아야 한다. 같은 편 이야기가 이어질 때만 드문드문 붙인다.
      if (flipped) {
        // 이음말을 앞에 다는 것보다 "…파괴됐지만 …파괴함"처럼 한 문장으로 잇는 편이
        // 반전이 또렷하다(지적). 앞 문장을 '-지만'으로 못 바꾸거나 이미 반전을 품고
        // 있으면 그때만 이음말을 쓴다.
        // 앞 문장이 이미 이음말로 시작하거나 반전을 품고 있으면 또 잇지 않는다 —
        // "그러나 …했지만 …"처럼 접속이 두 번 겹친다(지적).
        if ((closeEnough || sameKind) && canFlipJoin()) flipJoin = true;
        else {
          // "다른 쪽에서는"은 판이 갈라져 딴 데서 벌어진 일일 때만 맞는 말이다(지적) —
          // 같은 두 사람이 서로 주고받은 이야기면 "반대로 / 역으로 / 그와 동시에"가 맞다.
          linkWord = link(crossTeam
            ? (headToHead
              ? ["하지만", "그러나", "그렇지만", "반대로", "역으로", "그와 동시에"]
              : ["하지만", "그러나", "그렇지만", "반면", "이에 질세라", "다른 쪽에서는"])
            : ["하지만", "그러나", "그렇지만", "반면"]);
          teamTag = teamTagFor();
        }
      } else {
        // 얼마나 벌어졌느냐에 따라 말이 달라야 한다(요청: 곧이어 / 그 직후 / 잠시 후 /
        // 소강상태 후 / 한참 후 / 몇 분 후). 붙어 일어난 일에 "한참 후"를 쓰거나 십수 분
        // 뒤 일에 "곧이어"를 쓰면 그 자체가 틀린 말이 된다.
        const n = Math.round(gapSec / 60);
        const byTime =
          gapSec <= 60 ? ["곧이어", "그 직후"]
          : gapSec <= 3 * 60 ? ["잠시 후", "이어서", "곧이어"]
          : gapSec <= STANDOFF_SEC ? ["잠시 후", `${n}분 뒤`]
          : gapSec <= 10 * 60 ? [`${n}분 뒤`, `${n}분 후`, "소강상태 후"]
          : [`${n}분 뒤`, "한참 후", "소강상태 후"];
        // 같은 편이 몰아치는 흐름이고 사이가 짧으면 '쌓인다'는 말도 함께 후보에 둔다.
        linkWord = link(
          sameTide && gapSec <= 3 * 60
            ? ["여기에", "게다가", "설상가상으로", "그리고", ...byTime]
            : byTime,
        );
      }
    }
    let lead = "";
    if (mutual) lead = "서로 ";
    else if (both) {
      if (seed % 2 === 0) who = `양 팀의 ${who}`;
      else lead = "모두 ";
    }
    if (!who) continue;
    const render = (offset: number): string | null => {
      let firstPick = true;
      return tpl({
        who,
        whoList: (b.who ?? []).map(resolveName).filter(Boolean),
        who2: joinNames((b.who2 ?? []).map(resolveName)),
        whom: joinNames((b.whom ?? []).map(resolveName)),
        won: !!b.won,
        at: typeof b.at === "number" ? b.at : null,
        end: typeof data.end === "number" && data.end > 0 ? data.end : null,
        lastLost: i === lastLostIdx,
        team: teamOf?.(names[0] ?? "") ?? 0,
        p: b.p ?? {},
        pick: (opts) => {
          const t = opts[(seed + offset) % opts.length];
          if (!lead || !firstPick) return t;
          firstPick = false;
          return `${lead}${t}`;
        },
      });
    };
    let text = render(0);
    // 앞 문장의 주인공이 이번엔 당하는 쪽이면 두 문장을 잇고 싶다 — 그러려면 이 문장의
    // 주어가 그 사람이어야 한다. 틀에 그런 꼴이 있으면 그것을 고른다(지적: 당한 것도
    // 같은 사람을 주어로 이어 달라).
    const wantCut = (b.whom ?? []).length === 1
      && closeEnough && chainCount < MAX_CHAIN && out.length > 0 && lastWho.includes((b.whom ?? [])[0])
      && !(b.who ?? []).includes((b.whom ?? [])[0]);
    if (wantCut) {
      const mark = `${ga(resolveName((b.whom ?? [])[0]))} `;
      if (!text || !text.includes(mark)) {
        for (let o = 1; o <= 3; o += 1) {
          const t = render(o);
          if (t && t.includes(mark)) { text = t; break; }
        }
      }
      // 그런 꼴이 아예 없는 틀이면 만들어 준다 — "Rex가 군범에게 초반 성큰러시를 함"은
      // "군범이 Rex의 초반 성큰러시에 그대로 노출됨"과 같은 말이고, 이렇게 놓아야 앞
      // 문장에 "…늘리다가"로 이어 붙일 수 있다(요청: 원인·결과는 '-다가'로).
      // 피해를 단정하지 않는다 — 리플레이에 남은 건 '그 수를 맞았다'는 것뿐이다(지적).
      if (text && !text.includes(mark)) {
        const m = /^(\S+?)(?:가|이) (\S+?)에게 (.+?)(?:를|을) (?:함|시도함|감행함)$/.exec(text);
        if (m) text = `${mark}${m[1]}의 ${m[3]}에 그대로 노출됨`;
      }
    }
    if (!text) continue;
    // "서로"·"모두"는 주어 뒤에 와야 한다 — 틀이 주어를 문장 안에서 만드는 꼴(“정구와
    // 크리스의 3게이트 질럿 러시 한 방에 …”)에서는 이 말이 맨 앞으로 밀려 나와 어색하다
    // (지적: 서로는 없어야 됨). 문장 첫머리에 붙었으면 그냥 뗀다.
    if (lead && text.startsWith(lead)) text = text.slice(lead.length);
    // "그러나 …했지만 모자랐음"처럼 문장 자체가 이미 반전을 품고 있으면 앞의 이음말은
    // 군더더기다(지적) — 만들어진 문장을 보고 판단해 아예 붙이지 않는다.
    if (
      linkWord !== ""
      // 문장 안에 이미 이어 주는 어미가 있으면 앞의 이음말은 군더더기다(지적: 중복되는
      // 접속사가 너무 많다) — 대비를 뜻하는 말이든 같은 전황을 잇는 말이든 마찬가지다.
      && (CONTRAST_LINKS.has(linkWord) || sameTide)
      && /지만|으나|다가/.test(text)
    ) {
      linkWord = "";
      teamTag = "";
      lastLink = "";
    }
    if (linkWord) {
      // 대비를 뜻하는 이음말 뒤의 주어는 주제격이라야 읽힌다(지적: "반면 Rex는 …").
      const body = CONTRAST_LINKS.has(linkWord) ? toTopic(text) : text;
      // "2팀의 netan의 …"은 '의'가 겹쳐 어색하다(지적) — 뒤 이름이 소유격이면 "2팀 netan의".
      const tag = teamTag && /^[^\s]+의\s/.test(body) ? teamTag.replace("팀의 ", "팀 ") : teamTag;
      text = `${linkWord} ${tag}${body}`;
    }
    // 한 문장에 반전이 두 번 들어가면 어색하다(지적: "…무너졌지만 …갔으나 막힘").
    // 이어 붙일 문장이 이미 반전을 품고 있으면 잇지 않고 끊은 뒤, 이음말만 앞에 붙인다.
    if (flipJoin && /지만|으나/.test(text)) {
      // 이음말도 붙이지 않는다 — 문장이 이미 제 안에 반전을 품고 있어 그걸로 충분하다.
      flipJoin = false;
    }
    // 맺음말 앞에도 이음말을 둔다(요청) — 앞 전황을 그대로 받아 끝나면 "결국/그대로",
    // 뒤집으며 끝나면 "하지만/그러나". 시간·흐름을 이미 말하는 머리말("32분 혈투 끝에",
    // "단 5분 만에")이 붙었거나 본문이 이미 그 말로 시작하면 겹치므로 건너뛴다.
    // 앞 문장이 이미 "…경기를 뒤집기엔 역부족"처럼 진 편의 결말을 말해 버렸으면, 그 뒤에
    // 오는 맺음말은 반전이 아니라 그 흐름의 마무리다(지적) — "하지만"이 아니라 "결국/그대로".
    const alreadyConceded =
      out.length > 0
      && [...LOST_TAILS, ...RISKY_TAILS].some((t) => out[out.length - 1].endsWith(t));
    // 맺음말에 활약 한 마디가 붙어 이미 '-고'를 품고 있으면 또 잇지 않는다 — 한 문장에
    // 같은 어미가 세 번 나온다(지적: 중복되는 접속사).
    const endJoin = endJoinCandidate && !/고, |으며, /.test(text);
    if (b.k === "result" && prev && !/결국|그대로|하지만|그러나/.test(text)) {
      // 이어 붙일 참이면 '-지만'이 이미 반전을 짚으므로, 머리말은 "결국/그대로"로 받는다.
      if (prevTide < 0 && !alreadyConceded && !endJoin) {
        // 앞 전황과 반대로 끝나는 결말에는 반드시 반전을 짚는다(지적) — 시간 머리말이
        // 붙어 있어도 그 앞에 놓는다("하지만 32분 혈투 끝에 …").
        text = `${link(["하지만", "그러나"])} ${text}`;
      } else if (!/^(단 |\d)/.test(text)) {
        text = `${link(["결국", "그대로"])} ${text}`;
      }
    }
    // 앞 문장에서 무언가를 하던 사람이 이번 문장에서 당하는 쪽이면, 그건 "하다가 당함"이
    // 한 이야기다(지적) — 이름을 두 번 부르지 말고 "…도배하다가 …한 방에 무너짐"으로 잇는다.
    const victim = (b.whom ?? []).length === 1 ? (b.whom ?? [])[0] : "";
    const victimName = victim ? resolveName(victim) : "";
    const cutIn =
      !!victim && closeEnough && chainCount < MAX_CHAIN && out.length > 0 && lastWho.includes(victim)
      && !(b.who ?? []).includes(victim) && text.includes(`${ga(victimName)} `)
      // 한 문장에 이어 주는 어미가 두 번 들어가면 숨이 찬다(지적: 중복되는 접속사가
      // 너무 많다) — 앞마디가 이미 '-지만/-으나/-다가'를 품고 있으면 여기서 끊는다.
      && !/지만|으나|다가/.test(prevLine);
    // 반대로 앞 문장에서 당한 사람이 이번엔 무언가를 했다면 "하지만 다시 …"가 된다(지적).
    const actor = (b.who ?? []).length === 1 ? (b.who ?? [])[0] : "";
    // 이음말이 이미 앞에 붙었을 수도 있어(그러나/한편…) 그 자리까지 함께 걷어낸다.
    const backHead = actor
      // 선택 그룹을 한 겹 더 씌운다 — 안 그러면 뒤의 공백이 마지막 후보에만 붙는다.
      ? new RegExp(`^(?:${LINK_HEAD()} )?${escapeRe(resolveName(actor))}(?:가|이|는|은) `)
      : null;
    // 맺음말은 이미 결말이라 "다시 일어섬"을 얹을 자리가 아니다.
    // 문장이 이미 "…했지만 역부족"처럼 반전을 품고 있으면 "하지만"을 또 얹지 않는다(지적).
    // 전황이 실제로 그 사람 쪽으로 돌아섰을 때만 "다시 일어섰다"고 말한다(요청: 전황을
    // 보고 이어야 한다) — 제 수가 또 막힌 문장에 "하지만 다시"를 붙이면 거꾸로 읽힌다.
    const backUp =
      !!actor && !cutIn && closeEnough && b.k !== "result" && chainCount < MAX_CHAIN && lastWhom.includes(actor)
      && flipped && !!backHead && backHead.test(text) && !/지만|으나/.test(text);
    // 앞 문장과 주어가 같으면 주어를 두 번 부르지 않는다(지적: 주어가 반복될 경우 합침).
    // "Rex가 …이기고, …" 꼴로 앞 문장에 이어 붙이고 뒤 문장에서는 주어를 뗀다.
    // 같은 사람 이야기가 연달아 나오면 문장을 갈라 놓지 말고 하나로 잇는다(지적: 같은
    // 이름이 반복되면 이상하다) — 다만 세 마디까지만, 더 이으면 한 문장이 숨차진다.
    // 앞 문장이 실제로 그 주어로 시작해야 이어 붙일 수 있다 — "…태섭의 기지가 파괴됨"에
    // 이어 붙이면 주어를 뗀 뒷마디가 '기지가 한 일'로 읽힌다(지적).
    const sameSubject: boolean =
      closeEnough && chainCount < MAX_CHAIN && out.length > 0 && baseWho !== ""
      && lastSubject === subject && text.startsWith(`${subject} `)
      && prevLedBy(lastBaseWho);
    // 맺음말을 앞 문장에 이어 붙일 때 쓸 앞마디(위 endJoinCandidate 참고).
    const endHead: string | null = endJoin
      ? (prevTide < 0 ? toBut(prevLine) : toAnd(prevLine))
      : null;
    // 앞이 '자원부터 먼저 챙긴' 이야기면 뒤의 수는 그 결과다(요청: 째기가 무게감 있는
    // 액션과 이어지면 같이 엮어서) — 나란히 벌어진 일을 뜻하는 '-고'가 아니라 '-ㄴ 뒤'로
    // 이어야 원인과 결과로 읽힌다. 잘 풀렸든 아니든 이어지는 건 마찬가지다(요청).
    const afterCause = sameSubject && prev?.k === "greedy-build" ? toAfter(prevLine) : null;
    const chained: string | null = sameSubject
      // 이어 붙일 마디가 이미 '-고'를 품고 있으면(맺음말+활약 한 마디처럼) 앞마디는
      // '-으며'로 바꾼다 — 안 그러면 한 문장에 "…고, …고,"가 연달아 나온다(지적).
      ? (afterCause ?? (chainCount === 0 && !/고, /.test(text) ? toAnd(prevLine) : toAlso(prevLine)))
      : endHead ? endHead
      : flipJoin
        ? toBut(prevLine)
        : joinPrev && out.length > 0 && chainCount === 0 && prevLedBy(lastBaseWho)
          // 전황이 갈린 두 일을 '-고'로 이으면 나란히 일어난 것처럼 읽힌다(지적) —
          // 반대되는 정황은 '-지만'으로 이어야 대비가 산다.
          ? (flipped ? toBut(toTopic(prevLine)) : toAnd(toTopic(prevLine)))
          : null;
    if (backUp && backHead) {
      // 이름은 남긴다 — 앞 문장의 주어는 때린 쪽이라, 이름을 빼면 그 사람이 한 일로 읽힌다.
      lastLink = "하지만";
      text = text.replace(backHead, `하지만 ${neun(resolveName(actor))} 다시 `);
    }
    if (cutIn) {
      // 앞 문장이 '누군가를 상대로 성공한 일'이었다면 뒤집힌 것이라 "…했지만 반대로"가
      // 맞고(지적), 그냥 하던 일이었다면 "…하다가"가 맞다.
      const reversal = (prev?.whom ?? []).length > 0;
      const tightCause =
        prev?.k === "greedy-build" || (gapSec !== null && gapSec <= CAUSE_SEC);
      const head = reversal
        ? (toBut(prevLine) ? `${toBut(prevLine)} 반대로` : null)
        // 여기는 하던 일이 상대의 수에 끊긴 자리다 — '-다가'가 맞는 몇 안 되는 자리라
        // (지적) 그대로 쓴다. 아껴 쓰는 것은 tightCause로 자리를 좁혀서 한다.
        : tightCause ? toWhile(prevLine) : null;
      // 앞마디가 이미 '-다가'로 이어 주므로 뒤 문장 머리의 이음말은 뗀다(지적:
      // "…실패하다가 게다가 …"처럼 접속사가 두 번 나온다).
      const tail = text
        .replace(new RegExp(`^${LINK_HEAD()} `), "")
        .replace(`${ga(victimName)} `, "");
      if (head) out[out.length - 1] = `${head} ${tail}`;
      else out.push(text);
      chainCount = head ? chainCount + 1 : 0;
      lastSubject = subject;
      lastBaseWho = baseWho;
      lastWho = b.who ?? [];
      lastWhom = b.whom ?? [];
      prev = b;
      continue;
    }
    // 앞 문장에 이어 붙일 때는 뒤 문장 머리의 이음말을 뗀다 — 문장 한가운데에 "하지만"이
    // 남으면 한 문장에 접속사가 두 번 나온다(지적).
    if (chained) {
      text = text.replace(
        new RegExp(`^${LINK_HEAD()} `), "",
      );
    }
    // 전황이 뒤집히면서 주체까지 다른 팀이면 "…했지만 제롬도 …했다"가 자연스럽다(요청).
    // 맺음말에는 '도'를 붙이지 않는다 — 결말은 곁들이는 말이 아니다.
    const alsoSubject = flipped && crossTeam && b.k !== "result";
    // 팀이 갈린 반전에는 앞말을 받는 연결어를 한마디 넣어도 좋다(요청).
    const alsoLead = alsoSubject && b.k !== "result"
      ? (headToHead
        ? ["", "반대로 ", "역으로 ", myTeam ? `${myTeam}팀의 ` : ""][seed % 4]
        : ["", "이에 질세라 ", "다른 쪽에서는 ", myTeam ? `${myTeam}팀의 ` : ""][seed % 4])
      : "";
    // "…늘린 뒤"는 그 자체가 이어 주는 말이라 쉼표를 두지 않는다.
    if (chained && sameSubject) {
      const body = text.slice(subject.length + 1);
      out[out.length - 1] = afterCause ? `${chained} ${body}` : `${chained}, ${body}`;
    }
    else if (chained && (endHead || flipJoin)) {
      out[out.length - 1] = `${chained} ${alsoLead}${alsoSubject ? toAlsoSubject(text) : text}`;
    } else if (chained) {
      out[out.length - 1] = `${chained} ${alsoLead}${alsoSubject ? toAlsoSubject(text) : toTopic(text)}`;
    }
    else out.push(text);
    chainCount = chained ? chainCount + 1 : 0;
    lastSubject = subject;
    lastBaseWho = baseWho;
    lastWho = b.who ?? [];
    lastWhom = b.whom ?? [];
    prev = b;
  }
  // 마지막 그물 — 문장이 이미 '-지만/-으나/-다가/-고/-며'로 이어졌으면 그 뒤에 이음말이
  // 또 오면 안 된다(지적: 접속사가 세 번이나 나온다). 어느 경로로 붙었든 여기서 걷어낸다.
  // "…했지만 반대로 …"는 한 덩어리라 그것만 남긴다.
  const LINK = `(?:${[...CONTRAST_LINKS, ...SEQUENCE_LINKS].join("|")}|\\d+분 (?:뒤|후))`;
  // '-다가' 뒤에는 이음말이 아예 오면 안 된다(지적, 두 번째).
  const afterWhile = new RegExp(`(다가) ${LINK} `, "g");
  // 나머지 어미 뒤에는 한 마디까지만 — 두 번째부터 걷어낸다("…했지만 반대로 하지만 …").
  const twoLinks = new RegExp(`(지만|으나|았고|었고|였고|으며|하고|하며) (${LINK} )${LINK} `, "g");
  return out.length > 0
    ? out.map((l) => toPlain(l.replace(afterWhile, "$1 ").replace(twoLinks, "$1 $2"))).join(". ")
    : null;
}

/** 문장을 이름 조각과 나머지로 잘라 놓은 것 — 이름에 팀 색을 입히기 위한 것이다(요청).
 *  문장은 틀 안에서 이름을 끼워 만들기 때문에, 다 만든 뒤 이름을 찾아 자르는 편이
 *  틀마다 색을 신경 쓰는 것보다 훨씬 단순하고 빠짐없다. */
export interface SummaryPart {
  text: string;
  /** 1팀 / 2팀. 이름이 아닌 조각은 없다. */
  team?: 1 | 2;
}

/**
 * 요약을 팀 색이 입혀진 조각들로 만든다. teamOf는 '지금 보여줄 이름' → 팀 번호.
 * 이름을 못 찾거나 팀을 모르면 그냥 글자 조각으로 남는다(색만 없을 뿐 문장은 그대로다).
 */
export function renderReplaySummaryParts(
  data: ReplaySummaryData | unknown,
  resolveName: (rawName: string) => string,
  teamOf: (name: string) => 1 | 2 | undefined,
): SummaryPart[] | null {
  const text = renderReplaySummary(data, resolveName, teamOf);
  if (!text) return null;
  // 긴 이름부터 찾는다 — 짧은 이름이 긴 이름의 일부인 경우("정구"와 "정구2")를 위해서다.
  const names = [...new Set(
    (isReplaySummaryData(data) ? data.beats : [])
      .flatMap((b) => [...(b.who ?? []), ...(b.who2 ?? []), ...(b.whom ?? [])])
      .map(resolveName)
      .filter(Boolean),
  )].sort((a, b) => b.length - a.length);
  if (names.length === 0) return [{ text }];

  const parts: SummaryPart[] = [];
  let buf = "";
  for (let i = 0; i < text.length; ) {
    const hit = names.find((n) => text.startsWith(n, i));
    const team = hit ? teamOf(hit) : undefined;
    if (!hit || !team) { buf += text[i]; i += 1; continue; }
    if (buf) { parts.push({ text: buf }); buf = ""; }
    parts.push({ text: hit, team });
    i += hit.length;
  }
  if (buf) parts.push({ text: buf });
  return parts;
}
