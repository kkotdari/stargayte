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

/** 이긴 쪽/진 쪽 표현이 짝을 이루는 흔한 꼴 — 각각 여러 개를 두고 하나를 고른다. */
const pair = (won: string[], lost: string[]): Tpl => (c) =>
  `${ga(c.who)} ${c.pick(c.won ? won : lost)}`;

const TEMPLATES: Record<string, Tpl> = {
  // ── 전술(replayTactics) ──
  "zling-rush": (c) => {
    const n = num(c.p.drones);
    const build = n > 0 ? `${n}드론 저글링 러시` : "초반 저글링 러시";
    return `${ga(c.who)} ${c.pick(
      c.won
        ? [`${build}로 초반부터 몰아침`, `${build}로 시작하자마자 밀어붙임`, `${build} 한 방에 끝냄`]
        : [`${build}를 갔지만 막힘`, `${build}로 몰아쳤지만 통하지 않음`, `${build}를 갔다가 되레 굳어버림`]
    )}`;
  },
  moka: pair(
    ["저글링·울트라에 다크스웜을 얹은 목동 저그로 밀어붙임", "목동 저그 한 방을 굴려 밀고 나감",
     "다크스웜 아래로 저글링·울트라를 쏟아부음"],
    ["목동 저그로 버텨봤지만 무너짐", "목동 저그까지 갔지만 역부족", "울트라를 모았지만 흐름을 못 돌림"]
  ),
  swarm: pair(
    ["다크스웜으로 진영을 덮고 들어감", "다크스웜 아래로 병력을 밀어 넣음", "다크스웜으로 총알을 지우고 붙음"],
    ["다크스웜까지 깔았지만 역부족", "다크스웜을 깔아봤지만 소용없었음"]
  ),
  devourer: pair(
    ["디바우러와 뮤탈을 섞어 하늘을 잡음", "뮤탈에 디바우러를 붙여 공중을 굳힘", "디바우러를 섞어 제공권을 가져감"],
    ["디바우러 뮤탈로 공중을 노렸지만 통하지 않음", "공중을 노렸지만 디바우러가 늦었음"]
  ),
  lurker: pair(
    ["러커로 길목을 조여 숨통을 끊음", "러커를 심어 나올 구멍을 없앰", "러커 조이기로 발을 묶음"],
    ["러커로 조여봤지만 풀림", "러커로 길을 막았지만 뚫림"]
  ),
  bionic: (c) =>
    `${ga(c.who)} ${c.pick(
      c.won
        ? c.p.tank
          ? ["마린·메딕에 탱크까지 붙인 바이오닉 한 방으로 밀고 나감", "탱크를 붙인 바이오닉으로 한 줄씩 밀어 올림"]
          : ["마린·메딕 바이오닉으로 조여 들어감", "마린·메딕을 모아 그대로 밀어붙임"]
        : ["바이오닉으로 몰아쳤지만 뚫지 못함", "바이오닉 한 방을 굴렸지만 막힘"]
    )}`,
  mech: pair(
    ["탱크와 골리앗을 앞세운 메카닉으로 한 걸음씩 밀고 나감", "메카닉으로 자리를 잡고 조금씩 전진함"],
    ["메카닉으로 자리를 잡았지만 무너짐", "메카닉을 굴렸지만 밀림"]
  ),
  valkyrie: pair(
    ["발키리를 띄워 오버로드 사냥에 나섬", "발키리로 오버로드부터 걷어냄"],
    ["발키리로 하늘을 노렸지만 소용없었음", "발키리를 띄웠지만 늦었음"]
  ),
  dropship: pair(
    ["드랍십을 계속 돌려 뒤를 흔듦", "드랍십으로 본진을 쉴 새 없이 두드림"],
    ["드랍십으로 흔들어봤지만 판을 못 바꿈", "드랍 견제를 돌렸지만 번번이 걷힘"]
  ),
  "sneak-rax": pair(
    ["본진에서 한참 떨어진 자리에 몰래 배럭을 올려 허를 찌름", "몰래 배럭으로 허를 찌름"],
    ["몰래 배럭을 시도했지만 들킴", "몰래 배럭을 올렸다가 일찍 들통남"]
  ),
  "zealot-rush": (c) => {
    const g = num(c.p.gates, 2);
    const label = g === 2 ? "투게이트" : `${g}게이트`;
    return `${ga(c.who)} ${c.pick(
      c.won
        ? [`${label} 질럿 러시로 초반을 잡음`, `${label}에서 질럿을 쏟아부어 초반을 가져감`]
        : [`${label} 질럿 러시를 갔지만 막힘`, `${label} 질럿 러시로 밀었지만 걷힘`]
    )}`;
  },
  "cannon-rush": pair(
    ["초반 포토 러시로 시작부터 흔들어 놓음", "포토 러시로 상대 앞마당을 헤집음"],
    ["초반 포토 러시를 갔다가 도로 손해만 봄", "포토 러시로 찔렀다가 되레 뒤처짐"]
  ),
  recall: pair(
    ["아비터 리콜로 뒤를 통째로 파고듦", "리콜로 본진 한복판에 병력을 떨굼"],
    ["아비터 리콜까지 꺼냈지만 판을 못 뒤집음", "리콜을 썼지만 되돌리기엔 늦었음"]
  ),
  "shuttle-reaver": pair(
    ["셔틀 리버로 쉴 새 없이 찔러 넣음", "셔틀에 리버를 태워 계속 헤집음"],
    ["셔틀 리버로 찔러봤지만 막힘", "리버로 헤집었지만 번번이 잡힘"]
  ),
  shuttle: pair(
    ["셔틀을 돌려 뒤를 흔듦", "셔틀 견제로 시선을 뺏음"],
    ["셔틀로 흔들어봤지만 판을 못 바꿈", "셔틀 견제를 돌렸지만 안 통함"]
  ),
  "center-photon": pair(
    ["센터에 포토를 박아 길을 끊음", "센터를 포토로 걸어 잠금"],
    ["센터에 포토를 박았지만 지켜내지 못함", "센터 포토를 박았다가 도로 뽑힘"]
  ),
  center: (c) =>
    c.won
      ? `${ga(c.who)} ${c.pick(["센터에 건물을 늘려 판을 넓힘", "센터를 먹고 판을 키움"])}`
      : `${reul(c.who)} ${c.pick(["센터로 밀고 나갔지만 되레 본진이 비었음", "센터를 욕심내다 본진이 헐거워짐"])}`,

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
      return `${neun(c.who)} ${c.pick(["제대로 싸워보지 못하고 무너짐", "손 쓸 새도 없이 무너짐"])}`;
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
    const withWhat = ro(`${wa(unit)} ${def}`);
    return `${ga(c.who)} ${withWhat} ${c.pick(
      c.won ? ["막아냄", "버텨냄", "걸어 잠금"] : ["막아섰지만 실패", "버텼지만 뚫림", "막아봤지만 무너짐"]
    )}`;
  },
  expand: (c) => {
    const kind = EXPANSION_KO[str(c.p.kind)];
    const n = num(c.p.n);
    if (!kind || n <= 0) return null;
    const label = `${n}${kind}`;
    return `${ga(c.who)} ${c.pick(
      c.won
        ? [`${label}까지 늘려 판을 벌림`, `${label}까지 돌리며 앞서 나감`]
        : [`${label}까지 늘렸지만 병력에서 밀림`, `${label}까지 벌렸지만 지켜내지 못함`]
    )}`;
  },
  tech: (c) => {
    const t = TECH_KO[str(c.p.tech)];
    if (!t) return null;
    return `${ga(c.who)} ${c.pick(
      c.won
        ? [`${t}까지 꺼내 씀`, `${ro(t)} 싸움을 유리하게 끌고 감`]
        : [`${t}까지 썼지만 흐름을 되돌리지 못함`, `${reul(t)} 꺼냈지만 늦었음`]
    )}`;
  },
  allin: (c) =>
    `${ga(c.who)} ${c.pick(["일꾼을 거의 안 뽑고 병력만 짜낸 올인", "일꾼을 접고 병력만 뽑은 올인"])}`,
  fallen: (c) =>
    `${ga(c.who)} ${c.pick(
      c.p.team
        ? ["먼저 무너지며 전열이 갈림", "먼저 정리되며 한 명이 빠짐"]
        : ["일찍 손을 놓음", "일찍 무너짐"]
    )}`,

  // ── 맺음말 ──
  result: (c) => {
    const phrase = c.p.units ? unitPhrase(list(c.p.units)) : "";
    const p = phrase ? `${phrase} ` : "";
    const mode = str(c.p.mode);
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
    const seed = variantSeed(b);
    const text = tpl({
      who,
      who2: joinNames((b.who2 ?? []).map(resolveName)),
      won: !!b.won,
      p: b.p ?? {},
      pick: (opts) => opts[seed % opts.length],
    });
    if (text) out.push(text);
  }
  return out.length > 0 ? out.join(". ") : null;
}
