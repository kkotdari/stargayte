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
export const EXPANSION_KO: Record<string, string> = {
  Hatchery: "해처리", Nexus: "넥서스", "Command Center": "커맨드",
};

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
  const ko = units.map((u) => UNIT_KO[u]).filter(Boolean);
  if (ko.length === 0) return "";
  if (ko.length === 1) return ro(ko[0]);
  return `${wa(ko[0])} ${ko[1]} 조합으로`;
}

interface Ctx {
  /** 이름들을 이미 합쳐 놓은 것("조조" 또는 "조조·유비"). */
  who: string;
  who2: string;
  won: boolean;
  p: Record<string, unknown>;
}

const num = (v: unknown, fallback = 0): number => (typeof v === "number" ? v : fallback);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

type Tpl = (c: Ctx) => string | null;

/** 이긴 쪽/진 쪽 문구가 짝을 이루는 흔한 꼴을 짧게 쓰기 위한 헬퍼. */
const pair = (won: string, lost: string): Tpl => (c) =>
  `${ga(c.who)} ${c.won ? won : lost}`;

const TEMPLATES: Record<string, Tpl> = {
  // ── 전술(replayTactics) ──
  "zling-rush": (c) => {
    const n = num(c.p.drones);
    const build = n > 0 ? `${n}드론 저글링 러시` : "초반 저글링 러시";
    return `${ga(c.who)} ${c.won ? `${build}로 초반부터 몰아침` : `${build}를 갔지만 막힘`}`;
  },
  moka: pair("저글링·울트라에 다크스웜을 얹은 목동 저그로 밀어붙임", "목동 저그로 버텨봤지만 무너짐"),
  swarm: pair("다크스웜으로 진영을 덮고 들어감", "다크스웜까지 깔았지만 역부족"),
  devourer: pair("디바우러와 뮤탈을 섞어 하늘을 잡음", "디바우러 뮤탈로 공중을 노렸지만 통하지 않음"),
  lurker: pair("러커로 길목을 조여 숨통을 끊음", "러커로 조여봤지만 풀림"),
  bionic: (c) =>
    `${ga(c.who)} ${
      c.won
        ? c.p.tank
          ? "마린·메딕에 탱크까지 붙인 바이오닉 한 방으로 밀고 나감"
          : "마린·메딕 바이오닉으로 조여 들어감"
        : "바이오닉으로 몰아쳤지만 뚫지 못함"
    }`,
  mech: pair("탱크와 골리앗을 앞세운 메카닉으로 한 걸음씩 밀고 나감", "메카닉으로 자리를 잡았지만 무너짐"),
  valkyrie: pair("발키리를 띄워 오버로드 사냥에 나섬", "발키리로 하늘을 노렸지만 소용없었음"),
  dropship: pair("드랍십을 계속 돌려 뒤를 흔듦", "드랍십으로 흔들어봤지만 판을 못 바꿈"),
  "sneak-rax": pair("본진에서 한참 떨어진 자리에 몰래 배럭을 올려 허를 찌름", "몰래 배럭을 시도했지만 들킴"),
  "zealot-rush": (c) => {
    const g = num(c.p.gates, 2);
    const label = g === 2 ? "투게이트" : `${g}게이트`;
    return `${ga(c.who)} ${label} 질럿 러시${c.won ? "로 초반을 잡음" : "를 갔지만 막힘"}`;
  },
  "cannon-rush": pair("초반 포토 러시로 시작부터 흔들어 놓음", "초반 포토 러시를 갔다가 도로 손해만 봄"),
  recall: pair("아비터 리콜로 뒤를 통째로 파고듦", "아비터 리콜까지 꺼냈지만 판을 못 뒤집음"),
  "shuttle-reaver": pair("셔틀 리버로 쉴 새 없이 찔러 넣음", "셔틀 리버로 찔러봤지만 막힘"),
  shuttle: pair("셔틀을 돌려 뒤를 흔듦", "셔틀로 흔들어봤지만 판을 못 바꿈"),
  "center-photon": pair("센터에 포토를 박아 길을 끊음", "센터에 포토를 박았지만 지켜내지 못함"),
  center: (c) =>
    c.won
      ? `${ga(c.who)} 센터에 건물을 늘려 판을 넓힘`
      : `${reul(c.who)} 센터로 밀고 나갔지만 되레 본진이 비었음`,

  // ── 전황(replaySummary) ──
  // 진 편의 머리 문장 — 무엇으로 맞섰고 왜 안 됐나.
  stand: (c) => {
    const mode = str(c.p.mode);
    const phrase = unitPhrase(list(c.p.units));
    if (mode === "spectacle") {
      const u = UNIT_KO[str(c.p.unit)];
      return u ? `${neun(c.who)} ${u}까지 꺼냈지만 판을 뒤집지 못함` : null;
    }
    if (mode === "nothing") return `${neun(c.who)} 제대로 싸워보지 못하고 무너짐`;
    if (!phrase) return null;
    if (mode === "pressed") return `${neun(c.who)} 초반을 잡고 흔들었지만 ${phrase} 굳히지 못함`;
    if (mode === "late") return `${neun(c.who)} ${phrase} 후반을 노렸지만 역부족`;
    return `${neun(c.who)} ${phrase} 맞섰지만 역부족`;
  },
  defense: (c) => {
    const unit = UNIT_KO[str(c.p.unit)];
    const def = DEFENSE_KO[str(c.p.def)];
    if (!unit || !def) return null;
    const withWhat = ro(`${wa(unit)} ${def}`);
    return `${ga(c.who)} ${withWhat} ${c.won ? "막아냄" : "막아섰지만 실패"}`;
  },
  expand: (c) => {
    const kind = EXPANSION_KO[str(c.p.kind)];
    const n = num(c.p.n);
    if (!kind || n <= 0) return null;
    return `${ga(c.who)} ${n}${kind}까지 늘${c.won ? "려 판을 벌림" : "렸지만 병력에서 밀림"}`;
  },
  tech: (c) => {
    const t = TECH_KO[str(c.p.tech)];
    if (!t) return null;
    return `${ga(c.who)} ${t}까지 ${c.won ? "꺼내 씀" : "썼지만 흐름을 되돌리지 못함"}`;
  },
  allin: (c) => `${ga(c.who)} 일꾼을 거의 안 뽑고 병력만 짜낸 올인`,
  fallen: (c) =>
    `${ga(c.who)} ${c.p.team ? "먼저 무너지며 전열이 갈림" : "일찍 손을 놓음"}`,

  // ── 맺음말 ──
  result: (c) => {
    const phrase = c.p.units ? unitPhrase(list(c.p.units)) : "";
    const p = phrase ? `${phrase} ` : "";
    const mode = str(c.p.mode);
    const lead = str(c.p.lead);
    let head = "";
    if (lead === "epic") head = `${num(c.p.leadMin)}분 혈투 끝에 `;
    else if (lead === "rush") head = `${num(c.p.leadMin)}분 만에 `;
    else if (lead === "spectacle") {
      const s = SPECTACLE_UNITS[str(c.p.leadUnit)];
      if (s) head = `${s} `;
    }
    const who = ga(c.who);
    let body: string;
    // 조합을 빼면 "초반 승리"처럼 앙상해지므로, 그럴 땐 수식도 같이 정리한다.
    if (mode === "rush") body = phrase ? `${who} 초반 ${p}승리` : `${who} 승리`;
    else if (mode === "comeback") body = `${who} 초반 열세이다가 ${c.p.wentLate ? "후반에 " : ""}${p}역전`;
    else if (mode === "late") body = `${who} 후반 ${p}승리`;
    else body = phrase ? `${who} ${p}승리` : `${who} 그대로 승리`;

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
    const who = joinNames((b.who ?? []).map(resolveName));
    if (!who) continue;
    const text = tpl({
      who,
      who2: joinNames((b.who2 ?? []).map(resolveName)),
      won: !!b.won,
      p: b.p ?? {},
    });
    if (text) out.push(text);
  }
  return out.length > 0 ? out.join(". ") : null;
}
