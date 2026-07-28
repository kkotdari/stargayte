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

interface Ctx {
  /** 이름들을 이미 합쳐 놓은 것("조조" 또는 "조조·유비"). */
  who: string;
  who2: string;
  /** 당한 쪽 — 없으면 빈 문자열이고, 그때는 대상을 뺀 표현을 쓴다. */
  whom: string;
  won: boolean;
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
const LOST_TAILS = [
  "그러나 경기는 내줌", "결국 승부는 상대 쪽으로 넘어감", "그러나 판을 가져오지는 못함",
  "결국 흐름은 상대에게 넘어감",
];
const tail = (c: Ctx): string => (c.won ? "" : `, ${c.pick(LOST_TAILS)}`);

/** 한 일만 말하는 흔한 꼴 — 이긴 쪽/진 쪽 모두 같은 표현을 쓰고, 진 쪽에만 결과를 덧붙인다. */
const act = (actions: string[]): Tpl => (c) => `${ga(c.who)} ${c.pick(actions)}${tail(c)}`;

const TEMPLATES: Record<string, Tpl> = {
  // ── 전술(replayTactics) ──
  "zling-rush": (c) => {
    const n = num(c.p.drones);
    const build = n > 0 ? `${n}드론 저글링 러시` : "초반 저글링 러시";
    const at = targetPhrase(c);
    return `${ga(c.who)} ${at}${c.pick([
      `${build}를 감`, `빠른 ${build}를 시도함`, `${build}를 준비함`,
    ])}${tail(c)}`;
  },
  moka: act([
    "저글링·울트라에 다크스웜을 얹은 목동 저그로 감", "울트라까지 모아 목동 저그를 운용함",
    "다크스웜 아래로 저글링·울트라를 모음",
  ]),
  swarm: act([
    "다크스웜을 깔고 들어감", "다크스웜 아래로 병력을 밀어 넣음", "다크스웜을 뿌리며 붙음",
  ]),
  devourer: act([
    "디바우러와 뮤탈을 섞어 공중을 노림", "뮤탈에 디바우러를 붙임", "디바우러를 섞어 제공권을 노림",
  ]),
  lurker: act([
    "러커로 길목을 조임", "러커를 심어 길을 막음", "러커 조이기로 나감",
  ]),
  bionic: (c) =>
    `${ga(c.who)} ${c.pick(
      c.p.tank
        ? ["마린·메딕에 탱크까지 붙인 바이오닉으로 감", "탱크를 붙인 바이오닉으로 공격함"]
        : ["마린·메딕 바이오닉으로 감", "마린·메딕을 모아 바이오닉을 운용함"]
    )}${tail(c)}`,
  mech: act([
    "탱크와 골리앗을 앞세운 메카닉으로 감", "메카닉으로 자리를 잡고 나감", "메카닉을 운용함",
  ]),
  valkyrie: act([
    "발키리를 띄워 오버로드를 노림", "발키리를 모아 제공권을 노림",
  ]),
  dropship: (c) => {
    const of = victimPhrase(c);
    return `${ga(c.who)} ${c.pick([
      `드랍십을 계속 돌려 ${of}병력을 떨굼`, `드랍 견제로 ${of}피해를 줌`,
    ])}${tail(c)}`;
  },
  "zealot-rush": (c) => {
    const g = num(c.p.gates, 2);
    const label = g === 2 ? "투게이트" : `${g}게이트`;
    const at = targetPhrase(c);
    return `${ga(c.who)} ${at}${c.pick([
      `${label} 질럿 러시를 감`, `빠른 ${label} 질럿 러시를 시도함`, `${label}에서 질럿을 모아 나감`,
    ])}${tail(c)}`;
  },
  "cannon-rush": (c) => {
    const at = targetPhrase(c);
    return `${ga(c.who)} ${at}${c.pick([
      "초반 포토러쉬를 감", "빠른 포토러쉬를 시도함", "일찌감치 포토를 박기 시작함",
    ])}${tail(c)}`;
  },
  recall: act([
    "아비터를 띄우고 리콜까지 씀", "리콜로 병력을 뒤로 넘김", "아비터 리콜을 꺼냄",
  ]),
  // 리버 드랍 — 셔틀에 리버를 태워 일꾼을 지지는 그림(요청).
  "shuttle-reaver": (c) => {
    const of = victimPhrase(c);
    return `${ga(c.who)} ${c.pick([
      `${of}리버 드랍을 감행함`, `리버 드랍으로 ${of}피해를 줌`, `셔틀에 리버를 태워 ${of}떨굼`,
    ])}${tail(c)}`;
  },
  // 하이템플러 드랍 — 스톰 한 방에 일꾼이 녹는다(요청).
  "templar-drop": (c) => {
    const of = victimPhrase(c);
    return `${ga(c.who)} ${c.pick([
      `${of}하이템플러 드랍을 감행함`, `템플러 드랍으로 ${of}스톰을 뿌림`, `${of}하이템플러를 떨궈 피해를 줌`,
    ])}${tail(c)}`;
  },
  // 러커/히드라 드랍 — 저그는 오버로드 수송 업그레이드가 곧 드랍 의도다(요청).
  "zerg-drop": (c) => {
    const kind = c.p.lurker ? "러커 드랍" : "히드라 드랍";
    const of = victimPhrase(c);
    return `${ga(c.who)} ${c.pick([
      `오버로드에 태운 ${kind}을 ${of}감행함`, `${kind}으로 ${of}피해를 줌`,
    ])}${tail(c)}`;
  },
  shuttle: (c) => {
    const of = victimPhrase(c);
    return `${ga(c.who)} ${c.pick([
      `${of}셔틀 드랍을 감행함`, `셔틀 견제로 ${of}피해를 줌`,
    ])}${tail(c)}`;
  },
  // ── 전황(replaySummary) ──
  // 진 편의 머리 문장 — 무엇으로 맞섰고 왜 안 됐나.
  stand: (c) => {
    const mode = str(c.p.mode);
    const phrase = unitPhrase(list(c.p.units));
    if (mode === "spectacle") {
      const u = UNIT_KO[str(c.p.unit)];
      if (!u) return null;
      return `${neun(c.who)} ${c.pick([`${u}까지 꺼냈지만 판을 뒤집지 못함`, `${u}까지 갔지만 늦었음`])}`;
    }
    if (mode === "nothing") {
      return `${neun(c.who)} ${c.pick(["제대로 싸워보지 못하고 무너짐", "손 쓸 새도 없이 무너짐", "허무하게 당함"])}`;
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
    ])}`;
  },
  defense: (c) => {
    const unit = UNIT_KO[str(c.p.unit)];
    const def = DEFENSE_KO[str(c.p.def)];
    if (!unit || !def) return null;
    const n = num(c.p.n);
    // 방어 건물이 많으면 개수 자체가 전황이다(요청) — 그럴 땐 몇 개까지 박았는지 말한다.
    const heavy = num(c.p.total) >= 6;
    const withWhat = heavy
      ? `${def} ${n}개까지 박고 ${ro(unit)}`
      : ro(`${wa(unit)} ${def}`);
    // 지어 놓은 건 확실하지만 그게 막아냈는지는 리플레이에 없다(지적) — 갖춘 데까지만 말한다.
    return `${ga(c.who)} ${withWhat} ${c.pick(
      heavy ? ["웅크림", "걸어 잠금"] : ["수비를 갖춤", "방어 라인을 세움", "막아섬"]
    )}${tail(c)}`;
  },
  expand: (c) => {
    const kind = EXPANSION_KO[str(c.p.kind)];
    const n = num(c.p.n);
    if (!kind || n <= 0) return null;
    const label = `${n}${kind}`;
    return `${ga(c.who)} ${c.pick([
      `${label}까지 늘림`, `${label}까지 돌림`, `${label}까지 벌림`,
    ])}${tail(c)}`;
  },
  tech: (c) => {
    const t = TECH_KO[str(c.p.tech)];
    if (!t) return null;
    return `${ga(c.who)} ${c.pick([
      `${t}까지 꺼내 씀`, `${reul(t)} 확보함`, `${reul(t)} 올려 씀`,
    ])}${tail(c)}`;
  },
  allin: (c) =>
    `${ga(c.who)} ${c.pick(["일꾼을 거의 안 뽑고 병력만 짜낸 올인", "일꾼을 접고 병력만 뽑은 올인"])}`,
  fallen: (c) =>
    `${ga(c.who)} ${c.pick(
      c.p.team
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
      return `${ga(c.who)} ${at}${c.pick([
        "몰래 배럭 파이어뱃 러쉬를 감", "몰래 배럭에서 파이어뱃을 모아 나감",
      ])}${tail(c)}`;
    }
    return `${ga(c.who)} ${at}${c.pick([
      "몰래 배럭을 올림", "몰래 배럭을 시도함", "이른 시간에 몰래 배럭을 올림",
    ])}${tail(c)}`;
  },
  // 성큰러쉬 — 내 기지가 아닌 곳에 초반부터 성큰을 박는 올인(요청). 해처리는 펴지 않는다.
  "sunken-rush": (c) => {
    const at = targetPhrase(c);
    return `${ga(c.who)} ${at}${c.pick([
      "성큰러쉬를 감", "빠른 성큰러쉬를 시도함", "일찌감치 성큰을 박기 시작함",
    ])}${tail(c)}`;
  },
  // 센터 포토 — 가운데를 포토로 걸어 잠그는 그림(요청).
  "center-photon": act([
    "센터에 포토를 박음", "센터를 포토로 걸어 잠금",
  ]),
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
    return `${ga(c.who)} ${at}${c.pick([
      "팩토리를 올려 탱크 방어를 받쳐줌", "팩토리를 펴고 탱크를 뽑음",
    ])}${tail(c)}`;
  },
  // 입구 방어(요청) — 리플레이에 지형이 없어 램프 자체는 알 수 없다. '본진 안이면서 상대
  // 쪽으로 나가 있는 자리'까지가 확실한 근거라, 문장도 딱 그만큼만 말한다.
  "front-defense": (c) => {
    const def = DEFENSE_KO[str(c.p.b)];
    if (!def) return null;
    const n = num(c.p.n, 2);
    return `${ga(c.who)} ${c.pick([
      `입구 쪽에 ${def}를 ${n}개 세움`, `본진 앞을 ${def} ${n}개로 막아 세움`,
      `${def} ${n}개를 진출로 쪽에 붙임`,
    ])}${tail(c)}`;
  },

  // 커널(나이더스 커널) — 뚫어 놓고 병력을 실어 나르는 플레이(요청). 건물 하나로 확실하다.
  nydus: (c) => {
    const at = targetPhrase(c);
    return `${ga(c.who)} ${c.pick([
      `커널을 뚫어 ${at}병력을 실어 나름`, `${at}커널을 뚫음`,
    ])}${tail(c)}`;
  },

  // 셋방살이(요청) — 제 기지에는 건물이 거의 없고 아군 기지에 살림을 차린 것.
  lodging: (c) => {
    const host = c.who2 ? `${c.who2}의 기지에 ` : "아군 기지에 ";
    return `${ga(c.who)} ${host}${c.pick([
      "살림을 차리고 셋방살이를 함", "눌러앉아 셋방살이를 함", "건물을 옮겨 얹혀삶",
    ])}${tail(c)}`;
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
  gg: (c) => `${ga(c.who)} ${c.pick(["GG를 침", "GG 치고 나감", "일찌감치 GG"])}`,

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
    // 앞 문장에서 같은 사람이 같은 유닛으로 한 일을 말했으면 여기서 이어받는다(요청).
    // 초반에 끝난 경기는 빼둔다 — "초반 계속해서"는 말이 겹친다.
    const cont = c.p.cont && mode !== "rush" ? c.pick(["계속해서 ", "그대로 이어서 "]) : "";
    const p = phrase ? `${cont}${phrase} ` : cont;
    const lead = str(c.p.lead);
    const min = num(c.p.leadMin);
    let head = "";
    if (lead === "epic") head = `${c.pick([`${min}분 혈투 끝에`, `${min}분을 끌고 간 끝에`])} `;
    else if (lead === "rush") head = `${c.pick([`${min}분 만에`, `단 ${min}분 만에`])} `;
    else if (lead === "spectacle") {
      const sp = SPECTACLE_UNITS[str(c.p.leadUnit)];
      if (sp) head = `${sp} `;
    }
    const who = ga(c.who);
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
      body = phrase
        ? `${who} ${c.pick([`${p}승리`, `${p}이김`])}`
        : `${who} ${c.pick(["그대로 승리", "그대로 가져감"])}`;
    }

    // 팀전에서 특히 활약한 사람 한 마디 — 그 사람을 특징짓는 유닛과 역할로 말한다.
    const heroUnit = UNIT_KO[str(c.p.heroUnit)];
    const role = UNIT_ROLE[str(c.p.heroUnit)];
    const hero =
      c.who2 && heroUnit && role
        ? `${c.who2}의 ${ro(`${heroUnit} ${role}`)} ${ROLE_TAIL[role] ?? "승기를 잡음"}`
        : null;
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
  for (const b of data.beats as ReplaySummaryBeat[]) {
    const tpl = TEMPLATES[b?.k];
    if (!tpl) continue;
    // 양쪽이 같은 짓을 했으면 한 문장으로 묶는다(요청) — 모든 전술 틀이 `${ga(who)} ${동작}`
    // 꼴이라, 이름을 '와/과'로 잇고 동작 앞에 '서로'만 붙이면 어느 틀이든 그대로 읽힌다.
    const mutual = b.p?.mutual === true;
    const who = mutual
      ? joinPair((b.who ?? []).map(resolveName))
      : joinNames((b.who ?? []).map(resolveName));
    if (!who) continue;
    const seed = variantSeed(b);
    let firstPick = true;
    const text = tpl({
      who,
      who2: joinNames((b.who2 ?? []).map(resolveName)),
      whom: joinNames((b.whom ?? []).map(resolveName)),
      won: !!b.won,
      p: b.p ?? {},
      pick: (opts) => {
        const t = opts[seed % opts.length];
        if (!mutual || !firstPick) return t;
        firstPick = false;
        return `서로 ${t}`;
      },
    });
    if (text) out.push(text);
  }
  return out.length > 0 ? out.join(". ") : null;
}
