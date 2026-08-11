import { ga, ira, neun, reul, ro, wa } from "./korean";
import {
  isReplaySummaryData, pickedSummary, sceneWindowSec,
  type ReplaySummaryBeat, type ReplaySummaryData,
} from "./replaySummaryData";
import { SIGNATURE_UPGRADE_KO, TECH_USE_PHRASE } from "./replayTechNames";

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
  /* 파서가 짚어 주는 묶음 이름(replayParser의 orderPositions.by) — 마린·메딕·파이어뱃은
     한 부대로 같이 움직여 하나로 잡히고, 탱크는 시즈/언시즈 커맨드로 짚이므로 모드 없는
     이름으로 온다. 위의 "Siege Tank (Tank Mode)"와 같은 것이라 같은 말로 옮긴다. */
  Bionic: "바이오닉", "Siege Tank": "탱크",
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

/** 이 중 무엇을 앞세울 것인가 — 클수록 먼저 말한다(TECH_RANK와 같은 뜻).
 *
 *  예전에는 '많이 뽑은 순'으로 골랐다. 그런데 핵은 한 경기에 한두 발이고 아비터·울트라는
 *  여남은 기씩 나오므로, 핵이 있는 경기에서도 늘 아비터가 이겼다 — 정작 그 판에서 유일하게
 *  드문 일이 밀려나는 정렬이었다(지적: 핵 쏜 게 요약에 안 나온다). 수가 아니라 '얼마나 드문
 *  일인가'로 고른다. */
export const SPECTACLE_RANK: Record<string, number> = {
  "Nuclear Missile": 9,
  Battlecruiser: 6, Carrier: 6, "Dark Archon": 6,
  Guardian: 5,
  Arbiter: 4, Ultralisk: 3,
};

// 연구로 잡히는 기술 전부. 예전엔 절반쯤만 적혀 있었고, 그나마 "Cloaking"은 screp에 없는
// 이름이라 늘 빈손이었다(지적) — 레이스 클로킹의 실제 이름은 "Cloaking Field"다.
export const TECH_KO: Record<string, string> = {
  // 테란
  "Stim Packs": "스팀팩", Lockdown: "락다운", "EMP Shockwave": "EMP",
  "Spider Mines": "마인", "Tank Siege Mode": "시즈모드", Irradiate: "이레디에이트",
  "Yamato Gun": "야마토", "Cloaking Field": "레이스 클로킹",
  "Personnel Cloaking": "고스트 클로킹", Restoration: "리스토레이션",
  "Optical Flare": "옵티컬 플레어",
  // 저그
  Burrowing: "버로우", "Lurker Aspect": "럴커", Plague: "플레이그", Consume: "컨슘",
  Ensnare: "인스네어", "Spawn Broodlings": "브루들링", "Dark Swarm": "다크스웜",
  // 프로토스
  "Psionic Storm": "스톰", Recall: "리콜", "Stasis Field": "스테이시스",
  Hallucination: "할루시네이션", "Disruption Web": "디스럽션 웹",
  "Mind Control": "마인드컨트롤", Maelstrom: "마엘스트롬",
  // 종족 구분 밖 — 핵은 연구가 아니라 고스트의 명령이다(replayTechNames의 TECH_NAMES 주석).
  "Nuclear Strike": "핵",
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
  "Robotics Facility": "로보틱스", Hatchery: "해처리",
};

/** 문장에 쓸 만한 건물 이름 — 여기 없는 건물은 그냥 '건물'이라고만 말한다. */
export const BUILDING_KO: Record<string, string> = {
  ...DEFENSE_KO, ...PRODUCTION_KO,
  Pylon: "파일런", "Supply Depot": "서플라이", "Creep Colony": "크립 콜로니",
  Forge: "포지", Academy: "아카데미", Armory: "아머리", Observatory: "옵저버토리",
  // 저그 유저들은 에볼루션 챔버를 "챔버"라고 부른다(요청) — 앞자리를 줄인 "에볼루션"은
  // 이 바닥에서 안 쓰는 말이라 낯설게 걸린다.
  "Evolution Chamber": "챔버", "Spawning Pool": "스포닝풀",
  "Nydus Canal": "나이더스", "Engineering Bay": "엔지니어링 베이", Refinery: "리파이너리",
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
  // 하이템플러는 "견제"가 아니라 "마법"이다(지적) — 스톰을 일꾼에 썼는지 병력에
  // 썼는지 알 수 없으니 견제라고 못 박지 않는다.
  "High Templar": "마법", "Dark Templar": "견제", Reaver: "견제", Mutalisk: "견제",
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
function teamPhrase(c: Ctx, held: boolean): string {
  const names = c.whoList;
  const leads = list(c.p.teamUnits);
  // teamUnits가 있다는 것 자체가 '편 전체가 끝낸 판'이라는 표시다 — 유닛 이름은 더 이상
  // 안 쓰지만, 이 문장을 세울지 말지는 여전히 여기서 갈린다.
  if (leads.length < 2 || names.length !== leads.length) return "";

  /* 유닛 이름은 이 문장에서 뺐다(요청: 자막에서 빼고 화살표에 캡션으로) — 넷이 저마다
     조합을 갖고 싸운 판에서 이 한 문장이 유닛 일곱 개를 늘어놓는 줄이 됐다("정구·석주가
     마린 탱크 조합으로, 형거긴안돼요·수달이가 질럿 드라군 조합으로 몰아붙여…"). 같은
     그림에서 화살표마다 그 사람이 무엇을 몰고 갔는지가 이미 이름표로 붙어 있으니, 글은
     '누가'만 말하면 된다. 그래서 같은 주력끼리 묶던 무리 짓기도 필요가 없어졌다. */
  // "4인 팀"은 쓰지 않는 말이다(지적) — 로스터에 있는 그대로 "1팀/2팀"이라 부른다.
  // 팀 번호를 모르면(옛 데이터) 이름을 늘어놓는 쪽으로 물러선다.
  /* 렌더러가 c.team을 늘 0으로 넘기는 자리가 있어 팀 번호를 이름으로 되묻는다(clash의
     teamWord와 같은 방법) — 안 되물으면 넷이 다 나와 "carol·Cheol·dave·carol이"가 된다. */
  const team = c.team ? `${c.team}팀` : (() => {
    const t = names.map((n) => c.teamOfName(n)).find((v) => v !== undefined);
    return t ? `${t}팀` : "";
  })();
  /* 제 집에서 막아 낸 판은 방향이 반대다(지적: "격전지가 2팀 렉스의 본진이면 2팀이
     몰아쳤다기보다는 정구가 렉스를 공격했으나 2팀이 함께 막아냈다가 맞아"). 마지막
     싸움터가 이긴 편의 집이면 맺음말도 그렇게 서야 한다 — 같은 장면을 글은 공격으로,
     그림은 제 집에서 맞부딪는 것으로 그리면 둘이 정반대가 된다. */
  if (held) {
    /* 막아 낸 갈래는 그 자체로 맺는다 — 뒤에 "판을 정리함"을 이으면 "막아 내 판을
       정리했다"처럼 두 마디가 겉돈다. 부르는 쪽이 이 값에 아무것도 안 붙인다. */
    const guard = names.length >= 3 && team
      ? c.pick([`${team}이 함께 막아 냄`, `${team}이 힘을 모아 지켜 냄`])
      : (() => {
        const w = names.length <= 2 ? names.join("·")
          : `${names.slice(0, 2).join("·")} 외 ${names.length - 2}명`;
        return c.pick([`${ga(w)} 함께 막아 냄`, `${ga(w)} 나란히 버텨 냄`]);
      })();
    // 누가 쳐들어왔는지를 아는 판은 그 이름부터 세운다 — 막아 냈다는 말은 상대가 있어야
    // 그림이 된다. 못 짚었으면(옛 요약) 막아 냈다는 말만 남긴다.
    return c.whom ? `${ga(c.whom)} 몰아쳤지만 ${guard}` : guard;
  }
  if (names.length >= 3 && team) {
    return c.pick([`${team}이 힘을 모아`, `${team}이 함께 밀어붙여`, `${team}이 한꺼번에 몰아붙여`]);
  }
  const who = names.length <= 2 ? names.join("·")
    : `${names.slice(0, 2).join("·")} 외 ${names.length - 2}명`;
  return c.pick([`${ga(who)} 함께 몰아붙여`, `${ga(who)} 나란히 밀어붙여`, `${ga(who)} 한꺼번에 몰아붙여`]);
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
  /** 이 문장이 어떤 beat인가 — 결과 꼬리를 붙일지 가르는 데 쓴다(아래 done). */
  k: string;
  /** 이름들을 이미 합쳐 놓은 것("조조" 또는 "조조·유비"). */
  who: string;
  /** 합치기 전의 이름들 — 팀 승리를 "유비의 마린, 관우의 저글링"으로 말할 때 쓴다. */
  whoList: string[];
  who2: string;
  /** 당한 쪽 — 없으면 빈 문자열이고, 그때는 대상을 뺀 표현을 쓴다. */
  whom: string;
  /** 그 일을 만든 상대 — who도 whom도 아닌 제3의 이름이다(이사를 만든 사람 등).
   *  못 짚었으면 빈 문자열이고, 그때는 이름 없이도 성립하는 표현을 쓴다. */
  by: string;
  /** 이 편을 넘어선 상대 — 진 편의 맺음말이 "누구를 막기엔 늦었다"까지 가게 하는 이름이다
   *  (지적). by와 마찬가지로 whom이 아니다: 이 사람은 당한 쪽이 아니라 이긴 쪽이다. */
  foe: string;
  won: boolean;
  /** 일어난 프레임 — 초반 일은 결과를 덧붙이지 않고 그때 일만 말한다(지적). */
  at: number | null;
  /** 경기 전체 길이(프레임). '초반'을 경기 길이에 대비해 재는 데만 쓴다. */
  end: number | null;
  /** 진 편 문장 중 마지막인가 — 부정적인 맺음은 경기당 한 번만 쓴다(지적). */
  lastLost: boolean;
  /** 일대일인가 — 개인전에서는 "1팀이", "양 팀이" 같은 팀 용어를 쓰지 않는다(요청). */
  duel: boolean;
  /** 이 사람들이 속한 팀 번호 — 팀 전체를 부를 때 "1팀"이라 말하기 위한 것이다(지적:
   *  "4인 팀"은 이상한 말). 팀을 모르면 0이고, 그때는 이름을 늘어놓는다. */
  team: 0 | 1 | 2;
  p: Record<string, unknown>;
  /** p에 실린 원본 게임 아이디 목록을 지금의 닉네임으로 푼다 — who/whom과 달리 p 값은
   *  미리 풀어 두지 않는다(어떤 키가 이름인지는 문장마다 다르다). */
  names: (v: unknown) => string[];
  /** 그 닉네임이 몇 팀인가 — 사람이 너무 많아 이름을 다 부를 수 없을 때 "1팀/2팀"으로
   *  뭉뚱그리는 데 쓴다(요청). 팀을 모르면 undefined. */
  teamOfName: (name: string) => 1 | 2 | undefined;
  /** 이 문장이 가리키는 자리(p.xy)가 주어(who) 편의 집이었나 — 맺음말이 "몰아붙여"라고
   *  말해도 되는지를 가른다(지적: "아군 기지에 몰아붙일 일이 없잖아").
   *
   *  판정을 여기서 하는 까닭은 그려 낼 때 이미 재료가 다 있어서다: 요약에는 사람마다
   *  본진 자리(bases)가 실려 있고 맺음말에는 마지막 싸움터(p.xy)가 실려 있다. 분석 단계의
   *  표시(p.held)에 기대면 이미 등록된 경기는 재분석해야 바뀌는데, 실제로 여러 번 재분석
   *  해도 그 표시가 안 붙는 판이 있었다(신고). 그리는 쪽에서 재면 재분석이 필요 없고
   *  판정이 하나라 어긋날 일도 없다. */
  atHome: boolean;
  /** 여러 표현 중 하나를 고른다 — 같은 경기는 늘 같은 것이 나온다(아래 variantSeed 참고). */
  pick: (opts: string[]) => string;
}

const num = (v: unknown, fallback = 0): number => (typeof v === "number" ? v : fallback);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
/** 숫자 목록 — list는 문자열만 걸러 내므로 수를 실은 값(물량 조합의 기수 등)에는 이쪽을 쓴다. */
const numList = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x) => typeof x === "number") : []);

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
// 이 값과 아래 JOIN_MAX_SEC는 '중반(5~10분)' 기준이고, 실제로는 그 시각의 배율을 곱해
// 쓴다(sceneWindowSec — 요청: 초반엔 자잘하게, 후반으로 갈수록 크게).
const SAME_TIME_SEC = 45;
// 이만큼이나 벌어졌으면 그 사이는 정말로 대치였다고 말해도 된다(요청: "한동안의 대치 후").
const STANDOFF_SEC = 5 * 60;
// 두 일을 한 문장으로 합칠 수 있는 최대 시간 차(지적: 시간 차이가 제일 우선) — 이보다
// 벌어지면 인과가 아무리 그럴듯해도 각각 제 문장으로 둔다.
/* 3분 → 1분(요청: 문장 합치기는 최대한 금지하고, 사건의 시간이 유의미하게 차이 나면
   스냅을 나눈다). 한 문장에 묶이려면 사실상 같은 순간이어야 한다. */
/** 이 안에 찍었으면 '서둘러 올렸다'고 말할 수 있는 분 — 속업·사업은 대개 그 뒤에 나온다. */
const EARLY_UPGRADE_MIN = 8;
const JOIN_MAX_SEC = 60;
/** '-다가'로 이을 수 있는 사이 — 이 어미는 하던 일이 그 일 때문에 끊겼다는 뜻이라,
 *  정말 밀접한 인과관계가 아니면 쓰면 안 된다(지적). 몇 분 떨어진 두 일을 이걸로 묶으면
 *  없는 인과를 지어내는 셈이다. 다만 '자원부터 먼저 챙겼다'처럼 한동안 이어지는 상태는
 *  시간이 좀 벌어져도 뒤의 일과 곧바로 이어진다. */
const CAUSE_SEC = 90;
// 대비를 뜻하는 이음말 — 이 뒤에는 주어를 주제격("Rex는")으로 세운다(지적).
/** 곧이곧대로 뒤집는 말들 — 잇달아 쓰면 같은 말을 반복하는 꼴이 된다(지적). */
const ADVERSATIVE = new Set(["하지만", "그러나", "그렇지만"]);
/** 이음말을 '결'로 묶는다 — 낱말이 달라도 같은 결이면 연달아 쓰지 않는다(지적:
 *  "6분 후 … 9분 뒤"처럼 시간 표현이 이어지면 같은 말이 두 번 나온 것으로 들린다). */
const CONTRAST_FAMILY = new Set([...ADVERSATIVE, "반면", "반대로", "역으로"]);
function linkFamily(t: string): string {
  if (t === "") return "";
  if (CONTRAST_FAMILY.has(t)) return "역접";
  if (/^\d+분 (뒤|후)$/.test(t) || t === "소강상태 후" || t === "한참 후" || t === "잠시 후") return "시간";
  return t;
}
const CONTRAST_LINKS = new Set(["한편", "그와 동시에", "반면", "그러나", "하지만", "그렇지만", "이에 질세라", "다른 쪽에서는", "반대로", "역으로"]);
// 판이 여러 곳에서 동시에 벌어진다는 전제를 깔고 있는 이음말 — 일대일에서는 쓰지 않는다
// (지적). 두 사람뿐인 경기에 '다른 쪽'도, 딴 데서 벌어지는 '한편'도 없다.
const TEAM_ONLY_LINKS = new Set(["한편", "다른 쪽에서는"]);
// 시간 순서를 짚는 이음말 — 위 대비 이음말과 함께 문장 앞머리를 알아보는 데 쓴다.
/** 서로 바꿔 써도 뜻이 같은 역접 이음말 — 잇달아 같은 말이 나올 때 갈아 끼운다.
 *  '한편'·'다른 쪽에서는'(일대일에서 못 쓰는 말)과 '그와 동시에'(동시성이라 반전을 지운다)는
 *  뜻이 달라 여기 넣지 않는다. */
const ADVERSATIVE_ALTS = ["하지만", "그러나", "그렇지만", "반면", "반대로", "역으로"];
/** 덧붙이는 이음말끼리도 마찬가지 — 시간을 짚는 말은 사실이라 여기 없다. */
const ADDITIVE_ALTS = ["여기에", "그리고", "게다가"];
const SEQUENCE_LINKS = ["이어서", "곧이어", "그 직후", "잠시 후", "한참 후", "소강상태 후", "그 후", "한동안의 대치 후", "그 기세로", "여세를 몰아", "그 기세를 이어간", "여기에", "게다가", "설상가상으로", "그리고", "결국", "그러는 사이"];

/** 서로 다른 두 편을 '견주는' 이음말 — 주어가 앞 문장과 같은 사람인 자리에는 쓸 수 없다
 *  (지적: "Sohee_Min이 러시를 했다 → 반면 Sohee_Min이 타격을 입었다"처럼 제 자신과 대비하는
 *  문장이 된다). 그런 자리에서는 곧이곧대로 뒤집는 말(하지만·그러나·그렇지만)만 맞다. */
const COMPARATIVE_LINKS = new Set(["반면", "반대로", "역으로", "이에 질세라", "다른 쪽에서는"]);

/** 큰 사건에 달면 곁가지처럼 읽히는 가벼운 이음말(지적: 궤멸 같은 큰 사건에 '한편'이 붙는다).
 *  '한편'은 딴 데서 벌어지는 소식을 곁들일 때 쓰는 말이라, 누가 무너진 자리에는 어울리지
 *  않는다. 이 자리에서는 결말을 향하는 말로 받는다. */
const WEAK_LINKS = new Set(["한편", "그와 동시에", "여기에", "그리고", "게다가", "다른 쪽에서는"]);
const HEAVY_BEATS = new Set(["fallen", "gg", "no-elim", "relocate", "lift-off", "lodging", "rush-backfire"]);
const HEAVY_LINKS = ["결국", "그러는 사이"];
// 정규식에 이름을 그대로 넣기 전에 특수문자를 막는다 — 닉네임에 무엇이 들어올지 모른다.
const escapeRe = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 어느 편에도 기울지 않는 문장들 — 대치·소모전·손 빠르기·총 생산량처럼 '그 순간 누가
// 유리한가'를 말하지 않는 것들이다.
const NEUTRAL_BEATS = new Set([
  "standoff", "attrition", "fast-hands", "power-unit", "mass-army", "expand", "prod-gap",
  // '앞서고도 안 들어갔다'는 그 편이 잘한 것도 못한 것도 아니라 흐름 설명이다 — 앞뒤
  // 문장을 "하지만"으로 잇지 않는다.
  "idle-lead",
  "worker-gap", "tech", "vision", "no-detect", "revival", "clash",
  // 째기(greedy-build)도 여기다 — 자원을 먼저 챙긴 것은 공격이 아니라 준비라서, 그 뒤에
  // 상대의 러시가 오면 "하지만"이 아니라 "~했고"로 이어야 맞다(지적: 째기는 공격이 아니라
  // 하지만이 붙는 게 어색하다). 째기가 실제로 응징당한 경우는 greedy-punished가 따로 말한다.
  "greedy-build",
  // 입구막기도 같다 — 앞을 잠그고 크는 것은 준비지 공격이 아니라, 뒤에 상대의 수가
  // 이어져도 "하지만"이 아니라 "~했고"로 받아야 맞다.
  "wall-in",
]);
// 한 사람의 일이지만 국면은 상대 쪽으로 기우는 문장들 — 제 수가 역풍을 맞았거나 당한 것.
// 진 편의 맺음(stand)도 여기다: "…로 맞섰지만 역부족"은 그 사람 이야기이면서 국면은
// 이미 상대 쪽으로 넘어갔다는 말이라, 그 뒤에 오는 맺음말은 반전이 아니라 마무리다
// (지적: "밀렸다" 다음에 이긴 쪽이 나오는데 "하지만"이 붙음 — "결국/그대로"가 맞다).
const AGAINST_ACTOR = new Set([
  "rush-backfire", "greedy-punished", "fallen", "lodging", "relocate", "lift-off", "gg", "stand",
  // 얻어맞고 나서야 방어를 올린 것도 그 사람의 일이지만 국면은 상대 쪽이다.
  "late-defense",
  // 노엘을 외친 것도 마찬가지 — 사실상 손을 든 말이다.
  "no-elim",
]);
// 문장 앞에 붙는 이음말을 알아보는 조각 — 고정된 말들에 더해 "8분 뒤"처럼 그때그때
// 만들어지는 시간 표현도 함께 본다(요청: 시간이 많이 벌어지면 몇 분 후라고 적기).
const LINK_HEAD = () => `(?:${[...CONTRAST_LINKS, ...SEQUENCE_LINKS].join("|")}|\\d+분 (?:뒤|후))`;
// 한 문장에 이어 붙일 수 있는 마디 수 — 이보다 길어지면 읽다가 숨이 찬다.
/* 한 문장에 이어 붙일 마디 수 — 0으로 두면 이어 붙이기가 사실상 꺼진다(요청: 문장 이어
   붙이기를 최소화하고 최대한 나눠서 스냅을 만들 것). 자막 한 장에 한 장면이 오는 편이
   읽기도 쉽고, 미니맵도 그 장면의 화살표만 보여줄 수 있다 — 두 마디가 한 스냅에 묶이면
   화살표도 두 장면이 겹쳐 그려진다.
   완전히 0으로 막지는 않는다: 같은 사람이 곧바로 이어서 한 일("…하고 곧바로 …")은 한
   문장으로 읽는 편이 자연스럽고, 그건 어차피 같은 사람의 같은 자리 이야기라 미니맵도
   헷갈리지 않는다. */
const MAX_CHAIN = 0;
/* 자막 한 장에 담을 글자 수의 목표(요청: 문장이 너무 장황하고 긴 것들은 간략화) — 자막은
   그림 위에 얹혀 다음 장면으로 넘어가기 전까지만 보이는 글이라, 길면 다 읽기 전에 지나간다.
   딱 잘라 버리는 값이 아니라 '문장을 더 길게 만드는 선택'을 그만두는 선이다: 앞 문장에 이어
   붙일지, 활약 한 마디를 덧붙일지, 꾸밈말을 얹을지를 여기서 가른다. 실측한 자막을 길이순으로
   늘어놓고 잡은 값이다 — 이보다 긴 문장은 PC에서도 두 줄이 된다. */
const MAX_LINE = 46;
/** 다른 문장과 한 스냅으로 합치지 않는 이야기들 — 저마다 제 그림(화살표·이모지)을 가진
 *  결말 장면이라, 합치면 요청한 장면 하나가 사라진다. */
const NO_JOIN_KEYS = new Set(["hold-off", "counter"]);
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
  // 세게 맺는 말도 함께 둔다(요청) — 이 꼬리가 붙는 자리는 경기 끝 무렵의 진 편 문장이라
  // "그대로 끝장남"이 사실과 어긋나지 않는다.
  "그대로 끝장남", "거기서 끝났음", "그대로 무너졌음",
  // "망했다" 계열과 "할 수 있는 게 없었다"(요청: 그 표현이 재밌으니 살려 줘) — 세기만
  // 놓고 보면 위의 "그대로 끝장남"과 같은 자리라, 이 꼬리가 붙는 조건 그대로 쓸 수 있다.
  "그대로 망했음", "크게 망했음", "할 수 있는 게 없었음",
];
// 도박수(초반 올인)가 안 됐을 때만 쓰는 맺음 — 성공 여부를 단정하지 않는 선에서
// "실패함" "큰 피해는 못 줌"까지만 말한다(지적: 독이 됐다·발목을 잡았다는 지나치다).
// 다만 "망함" 계열은 되살린다(요청) — 도박수가 안 됐다는 건 리플레이가 말해 주는 사실이고,
// 그걸 세게 부르는 것은 없는 사실을 지어내는 것과 다르다.
const RISKY_TAILS = [
  "실패함", "큰 피해는 못 줌", "끝내 통하지 않음", "소용없었음",
  "그대로 실패함", "별다른 소득이 없었음", "완전히 헛수고가 됨",
  "그대로 망함", "크게 망함", "할 수 있는 게 없었음",
];

// 진 편 문장은 "…뚫음, 경기는 내줌"처럼 끊어 붙이는 것보다 "…뚫었으나 경기는 내줌"으로
// 이어야 자연스럽다(지적). 한 일은 전부 명사형('-ㅁ')으로 써 두었으므로, 그 끝만 과거
// 연결형으로 바꾼다. 불규칙이 많아 규칙으로 만들지 않고 실제로 쓰는 끝만 적어 둔다 —
// 표에 없는 끝이 나오면 이어 붙이지 않고 쉼표로 두어, 틀린 말이 나오는 일은 없다.
const CONNECTIVE: [string, string][] = [
  // 긴 것부터 — 먼저 걸리는 것이 이긴다("밀어붙임"이 "임"보다 앞에 있어야 한다).
  ["승부를 걸음", "승부를 걸었으나"], ["막아섬", "막아섰으나"], ["얹혀삶", "얹혀살았으나"], ["붙어삶", "붙어살았으나"],
  ["되살아남", "되살아났으나"], ["물러남", "물러났으나"], ["끝남", "끝났으나"],
  // "망했다/끝장났다" 계열(요청: 그런 표현을 많이 써 줘, 재밌다) — 여기 등록해 두지 않으면
  // 문장을 이어 붙이거나 평서형('-다')으로 펴지 못하고 명사형 그대로 남는다.
  ["끝장남", "끝장났으나"], ["거덜남", "거덜났으나"], ["나가떨어짐", "나가떨어졌으나"],
  // "망함"은 아래 "함"→"했으나" 규칙보다 먼저 걸려야 "망했으나"가 된다(그 규칙에 걸려도
  // 결과가 같지만, 뜻이 다른 낱말이 우연히 맞아떨어지는 데 기대지 않는다).
  ["크게 망함", "크게 망했으나"], ["망함", "망했으나"],
  ["밀어붙임", "밀어붙였으나"], ["파고듦", "파고들었으나"], ["흔듦", "흔들었으나"],
  ["감행함", "감행했으나"], ["뒤집음", "뒤집었으나"], ["헤집음", "헤집었으나"],
  ["놓음", "놓았으나"], ["둠", "두었으나"], ["막음", "막았으나"], ["잡음", "잡았으나"], ["뽑음", "뽑았으나"],
  ["넣음", "넣었으나"], ["끊음", "끊었으나"], ["뚫음", "뚫었으나"], ["지음", "지었으나"],
  ["모음", "모았으나"], ["잠금", "잠갔으나"], ["나름", "날랐으나"], ["담음", "담았으나"],
  ["무너짐", "무너졌으나"], ["지워짐", "지워졌으나"], ["빠짐", "빠졌으나"],
  // 피해를 말하는 맺음들 — "김"(→겼으나) 규칙에 잘못 걸리지 않게 "시킴"을 먼저 둔다.
  // "지킴"도 "김"(→겼으나) 규칙에 안 걸린다(끝 글자가 '킴'이다) — 표에 없으면 명사형이
  // 그대로 남아 "…그 자리를 지킴"으로 나온다(실측). 교전 문장이 여러 번 나오게 되면서
  // 자주 눈에 띄어 채운다.
  ["시킴", "시켰으나"], ["지킴", "지켰으나"], ["입음", "입었으나"],
  ["탈락", "탈락했으나"], ["실패", "실패했으나"], ["말았음", "말았으나"],
  // 여기부터는 끝 한 글자로 가르는 것들.
  ["함", "했으나"], ["줌", "줬으나"], ["씀", "썼으나"], ["섬", "섰으나"],
  ["춤", "췄으나"], ["굼", "궜으나"], ["김", "겼으나"], ["움", "웠으나"],
  ["림", "렸으나"], ["힘", "혔으나"], ["침", "쳤으나"], ["댐", "댔으나"],
  ["냄", "냈으나"], ["됨", "됐으나"], ["옴", "왔으나"], ["임", "였으나"],
  ["듦", "들었으나"], ["걺", "걸었으나"], ["봄", "봤으나"], ["폄", "폈으나"], ["삶", "살았으나"],
  ["바쁨", "바빴으나"], ["찌름", "찔렀으나"], ["덮음", "덮었으나"], ["붙음", "붙었으나"],
  ["읽음", "읽었으나"],
  ["쏟아부음", "쏟아부었으나"], ["숨음", "숨었으나"], ["숨김", "숨겼으나"],
  ["깜", "깠으나"], ["감", "갔으나"], ["끔", "끌었으나"],
  ["버팀", "버텼으나"], ["않음", "않았으나"], ["짐", "졌으나"],
  /* 실측으로 찾은 남은 명사형들 — 172판의 문장 끝을 훑어 아직 평서형으로 안 펴지는
     것들을 그대로 채웠다(끝이 ㅁ·ㄻ인데 표에 없으면 "…훑음"처럼 명사형이 그대로 나간다). */
  ["찍음", "찍었으나"], ["걸음", "걸었으나"], ["훑음", "훑었으나"],
  ["묶음", "묶었으나"], ["휘저음", "휘저었으나"], ["깎음", "깎았으나"],
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

/** 문장 첫머리의 "(1팀의 )이름+조사 "를 잡는 정규식.
 *
 *  이름을 정규식으로 추측하지 않고 그대로 박아 넣는 게 핵심이다. 예전엔 '공백 아닌 덩어리
 *  + 조사 + 공백'으로 찾았는데, 띄어쓰기가 있는 닉네임은 그 한가운데가 걸렸다 — 실제로
 *  "홍탑(최고가 되고"가 "홍탑(최고는 되고"로 이름 자체가 망가졌고(지적), 이름이 깨지면
 *  뒤에서 이름을 찾아 팀 색을 입히는 일까지 통째로 실패했다. */
const subjectHead = (name: string, particles: string): RegExp =>
  new RegExp(`^(\\d+팀의 |양 팀의 )?${escapeRe(name)}(?:${particles})(\\s)`);

/** 문장 첫머리의 주어에 '도'를 붙인다 — "제롬이 " → "제롬도 ". 전황이 뒤집히면서
 *  주체까지 다른 팀으로 넘어갈 때, 앞말을 받아 "…했지만 제롬도 …했다"로 읽히게 한다(요청). */
function toAlsoSubject(sentence: string, name: string): string {
  if (!name) return sentence;
  return sentence.replace(
    subjectHead(name, "가|이|는|은"),
    (_m, team: string | undefined, sp: string) => `${team ?? ""}${name}도${sp}`,
  );
}

/** 문장 첫머리의 주격("브래드가")을 주제격("브래드는")으로 바꾼다 — 두 사람의 일을 한
 *  문장에 나란히 놓을 때는 "브래드는 …했고 정구는 …했음"이라야 대비가 읽힌다(요청). */
function toTopic(sentence: string, name: string): string {
  if (!name) return sentence;
  // 앞에 "1팀의 "처럼 팀 표시가 붙어 있어도 그 뒤의 이름을 주제격으로 바꾼다(요청).
  return sentence.replace(
    subjectHead(name, "가|이"),
    (_m, team: string | undefined, sp: string) => `${team ?? ""}${neun(name)}${sp}`,
  );
}

/** 한 일 + (진 편이면) 결과 한 마디. 이어 붙일 수 있으면 "…뚫었으나 경기는 내줌"으로,
 *  못 이으면 쉼표로 둔다. */
const done = (c: Ctx, action: string, risky = false): string => {
  if (c.won) return action;
  // "…했으나 역부족" 같은 부정적인 맺음은 경기당 딱 한 번, 진 편의 마지막 문장에만 붙인다
  // (지적) — 문장마다 붙으면 같은 말이 반복돼 읽는 맛이 없다.
  if (!c.lastLost) return action;
  /* 이미 그 사람이 당한 이야기(응징·궤멸·이사 등)에는 결과 꼬리를 붙이지 않는다 —
     "…팍규의 공격에 노출됐으나 크게 망했다"처럼 나쁜 일 둘을 역접('-으나')으로 잇게 되어
     인과가 깨진다(지적: 문장 인과관계가 이해가 안 되고 하나로 합치면 안 되는 문장).
     그런 문장은 이미 제 결말을 말하고 있어 덧붙일 것이 없다. */
  if (AGAINST_ACTOR.has(c.k)) return action;
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
/** 유닛 이름 앞에 업그레이드 딱지를 붙인다 — "속업 저글링", "사업 히드라"(요청: 업그레이드는
 *  그 유닛이 나올 때 같이 덧붙여도 된다). 딱지는 replaySummary가 p.up에 실어 주고, 그
 *  사람이 그 문장의 시점 이전에 실제로 찍은 것만 온다. 없으면 유닛 이름 그대로다. */
function unitWithUp(c: Ctx, key?: unknown): string {
  const ko = UNIT_KO[str(key === undefined ? c.p.unit : key)];
  if (!ko) return "";
  const up = str(c.p.up);
  return up ? `${up} ${ko}` : ko;
}

const act = (actions: string[]): Tpl => (c) => `${ga(c.who)} ${done(c, c.pick(actions))}`;

/** 건물을 지은 자리 이름(replayTactics의 BuildSpot) → 문장에 붙일 우리말. 뒤에 전술 이름이
 *  바로 오므로 끝에 공백을 둔다. 모르는 값·자리를 못 가린 경우는 빈 문자열이다.
 *
 *  '상대 본진'과 '상대 입구 앞'을 가르는 것이 핵심이다 — 앞을 막은 것과 안에 박은 것은
 *  전혀 다른 수다. 내 기지·내 입구는 방어이고, 아군 기지·입구는 옆을 받쳐 준 것이다. */
/*  꼴이 중요하다. 이 말은 "누구의 ○○○ 포토러시"처럼 소유격 뒤에 그대로 들어가므로
 *  '~에'로 끝나면 조사가 겹쳐 무너진다(실제로 "Sohee_Min의 상대 입구 앞에 포토러시 한
 *  방에"가 나왔다) — 전술 이름을 꾸미는 관형형으로 둔다. */
const SPOT_KO: Record<string, string> = {
  myBase: "내 기지에 지은 ", myFront: "입구를 막은 ",
  allyBase: "아군 기지에 지은 ", allyFront: "아군 입구를 막은 ",
  enemyBase: "상대 본진에 박은 ", enemyFront: "상대 입구를 막은 ",
  mid: "센터에 지은 ",
};
const spotWord = (v: unknown): string => (typeof v === "string" ? SPOT_KO[v] ?? "" : "");

/** 전술을 문장 안에서 부를 이름 — "3게이트 질럿 러시로 …"처럼 다른 문장에 끼워 넣을 때 쓴다.
 *  여기 없는 키는 '들이친 수'가 아니라는 뜻이라, 피해 문장 자체가 만들어지지 않는다. */
/** 일꾼을 노리고 가는 드랍들 — 이 수로 크게 타격을 줬다면 갈린 것은 십중팔구 일꾼이다. */
const WORKER_DROP_KEYS = new Set(["templar-drop", "shuttle-reaver", "shuttle"]);
/** 급습 문장에 유닛 수를 적기 시작하는 선 — 이보다 적으면 '모아서 갔다'가 아니라 견제다. */
const RAID_UNIT_SHOW = 5;
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
    // 자리 이름을 앞에 붙인다(요청: 내 입구/기지인지 아군 입구/기지인지 상대 입구 앞인지
    // 상대 본진인지 센터인지 다 파악해야 한다) — 같은 포토러시도 상대 입구를 막은 것과 본진
    // 한복판에 박은 것은 전혀 다른 이야기다. 자리를 못 가린 옛 데이터는 이름만 나온다.
    case "cannon-rush": return `${spotWord(p.spot)}포토러시`;
    case "sunken-rush": return `${spotWord(p.spot)}성큰러시`;
    case "sneak-rax": return `${spotWord(p.spot)}${p.firebat ? "몰래 배럭 파이어뱃 러시" : "몰래 배럭"}`;
    case "shuttle-reaver": return "리버 드랍";
    case "templar-drop": return "하이템플러 드랍";
    case "zerg-drop": return p.lurker ? "러커 드랍" : "히드라 드랍";
    case "dropship": return "드랍십 견제";
    case "shuttle": return "셔틀 견제";
    case "nydus": return "커널";
    case "recall": return "아비터 리콜";
    // '한 방'은 올인 러시에나 어울리는 말이다(지적) — 바이오닉은 모아서 밀고 나가는
    // 병력이라 그렇게 부르지 않는다.
    case "bionic": return "바이오닉 병력";
    case "mech": return "메카닉 진출";
    case "moka": return "목동 저그";
    case "muta": return "뮤탈 견제";
    /* 이름 없는 급습(replayTactics의 raidOn) — 무엇으로 갔는지가 곧 이름이다. 유닛을
       못 짚었으면 "본진 급습"으로만 부른다. */
    case "base-raid": {
      const unit = UNIT_KO[str(p.unit)] ?? "";
      if (!unit) return "본진 급습";
      // 몇 기를 모아 갔는지가 곧 그 수의 크기다(요청) — 한두 기는 견제라 수를 안 적는다.
      const n = num(p.n);
      return n >= RAID_UNIT_SHOW ? `${unit} ${n}기 급습` : `${unit} 급습`;
    }
    case "fast-tech": {
      const unit = UNIT_KO[str(p.unit)] ?? "";
      return unit ? `패스트 ${unit}` : "";
    }
    case "cloak-wraith": return "클로킹 레이스";
    case "guardian": return "가디언";
    case "bc": return "배틀크루저";
    case "carrier": return "캐리어";
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
  // 양쪽이 똑같이 한 일(서로 흩어 지었다 / 서로 몰래 배럭)은 어느 편으로도 기울지 않는다.
  // 그런데 beat에는 한쪽의 won만 남아서, 그대로 쓰면 그 앞뒤가 "하지만"으로 이어졌다.
  if (b.p?.bothSides === true || b.p?.mutual === true) return 0;
  const mine = b.won ? 1 : -1;
  return (AGAINST_ACTOR.has(b.k) ? -mine : mine) as -1 | 1;
}

/** 여럿을 늘어놓을 때 쓰는 꼴 — "A의 바이오닉 한 방과 B의 3게이트 질럿 러시"는 어색하다.
 *  목록 안에서는 '한 방'을 떼고 병력으로 부른다(요청: 누구의 바이오닉 병력으로).
 *  지금은 이름 자체에 '한 방'이 거의 안 붙지만(위 tacticLabel 주석), 남은 것들을 위해 둔다. */
const listForm = (label: string): string => label.replace(/ 한 방$/, " 병력");

const TEMPLATES: Record<string, Tpl> = {
  // 들이친 수와 그 결과를 한 문장으로(요청) — 그 타이밍에 상대 생산이 끊긴 게 근거다.
  // 결과는 비유(생산이 뚝 끊김·살림을 흔듦) 대신 피해 자체로 말한다(요청: 큰 타격을
  // 입힘·많은 타격을 줌·기지를 대파함처럼 객관적으로).
  "raid-damage": (c) => {
    const label = tacticLabel(str(c.p.k), c.p);
    if (!label) return null;
    // 당한 쪽이 그때 방어 건물을 거의 안 갖고 있었으면 그 사실을 함께 말한다(지적:
    // 포토를 안 지었다가 당했는데 그 내용이 안 나온다). 이 필드가 없던 시절의 요약은
    // 이 대목을 그냥 건너뛴다.
    // 한때는 이름을 꾸몄는데("포토 2개뿐이던 Sohee_Min이") 두 가지가 걸렸다(지적):
    //  ① "포토 2개뿐인 상태에서 …에 당했다"가 훨씬 자연스럽다.
    //  ② 앞 문장에 이어 붙이며 주어("Sohee_Min이 ")를 지우는 자리(아래 cutIn)에서 꾸밈말만
    //     남아 "포토 2개뿐이던 버티지 못했다"가 됐다.
    // 그래서 이름에서 떼어 문장 앞마디로 세운다.
    const vdef = DEFENSE_KO[str(c.p.vdef)];
    let thinAt = !vdef || !("vdefN" in c.p) ? ""
      : num(c.p.vdefN) === 0
        ? `${vdef} 하나 없는 상태에서 `
        : `${vdef} ${num(c.p.vdefN)}개뿐인 상태에서 `;
    const of = c.whom ? `${c.whom}의 ` : "상대 ";
    const foe = c.whom ? c.whom : "상대";
    /** 앞마디를 쓸 때는 어순이 '앞마디 → 당한 사람 → 서술부'로 고정된다(지적: 누가
     *  얇았는지가 문장 한참 뒤에 가서야 나오고, 주어도 사람이 아니라 '팍규의 생산'이
     *  됐다). 앞마디 바로 뒤에 다른 사람이 오면 포토가 없던 쪽이 그 사람으로 읽히므로
     *  자리를 바꿀 수 없다. thinTails는 당한 쪽을 주어로 세웠을 때의 서술부다.
     *  앞마디가 없으면 예전처럼 당한 쪽이 주어인 꼴과 때린 쪽이 주어인 꼴을 섞어 고른다. */
    const say = (thinTails: string[], victimLed: string[], actorLed: string[] = []) => (
      thinAt
        ? done(c, `${thinAt}${ga(foe)} ${c.pick(thinTails)}`)
        : done(c, c.pick([...victimLed, ...actorLed]))
    );
    // 이 수를 낸 사람 말고도 같이 덮친 사람이 있었으면 이름을 함께 부른다(지적: 한 사람한테만
    // 당한 게 아니다). 자리(이동·공격 명령이 그 사람 진영에 몰렸나)로 짚은 사람들이다.
    const also = num(c.p.gang) >= 2 && c.who2 ? `${c.who2}까지 달려들어 ` : "";
    /* 앞마디("성큰 1개뿐인 상태에서")와 협공("bob까지 달려들어")은 둘 다 곁가지다 — 둘이
       겹치면 본줄기까지 세 마디가 되어 자막이 예순 자를 넘는다(실측). 그때는 그 장면의
       그림에 더 가까운 협공을 남기고 앞마디를 접는다. */
    if (also && thinAt.length + also.length > MAX_LINE / 3) thinAt = "";
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
        // 실제로 탈락한 게 아니면 '무너짐/버티지 못함'은 과하다(지적: 무너진 정도는
        // 아니고 타격을 받은 정도였다) — 확인된 건 그 무렵 크게 얻어맞았다는 것뿐이라
        // 거기까지만 말한다. 실제로 이 자리에서 얻어맞고도 45분 뒤에 이긴 경기가 있었다.
        return c.p.out
          ? say(
            [`${all}에 ${when}무너짐`, `${all}에 ${when}그대로 쓰러짐`,
              `${all}에 ${when}크게 실패함`, `${all}에 ${when}그대로 끝장남`],
            [`${all}에 ${ga(foe)} ${when}무너짐`, `${all}에 ${when}${ga(foe)} 그대로 쓰러짐`],
            [`${ro(all)} ${when}${reul(foe)} 엘리시킴`, `${ro(all)} ${when}${reul(foe)} 끝냄`],
          )
          : say(
            [`${all}에 ${when}큰 타격을 입음`, `${all}에 ${when}많은 타격을 입음`, `${all}에 ${when}적잖은 피해를 입음`],
            [
              `${all}에 ${ga(foe)} ${when}큰 타격을 입음`,
              `${all}에 ${when}${ga(foe)} 많은 타격을 입음`,
              `${all}에 ${ga(foe)} ${when}적잖은 피해를 입음`,
            ],
            [`${ro(all)} ${when}${foe}에게 큰 타격을 줌`, `${ro(all)} ${when}${foe}에게 많은 타격을 줌`],
          );
      }
    }
    // 당한 사람을 못 짚었으면 피해까지 말하지 않는다(지적) — 무슨 수를 갔다는 것만 말한다.
    if (!c.whom) return `${ga(c.who)} ${done(c, `${reul(label)} 감행함`)}`;
    // "Rex가 리버 드랍 한 방에"가 아니라 "Rex의 리버 드랍 한 방에"라야 읽힌다(지적) —
    // 그런 꼴은 주어까지 문장 안에서 만든다.
    const mine = `${c.who}의 ${label}`;
    // '한 방'은 올인 러시에만 붙인다(지적) — 드랍·견제·운영에 붙이면 한 번에 끝낸 것처럼
    // 읽힌다. 러시로 끝나는 이름(3게이트 질럿 러시 등)만 그 말을 달고, 나머지는 그냥 '-에'.
    const blow = /러시$/.test(label) ? `${mine} 한 방에` : `${mine}에`;
    // 뒤에 그 사람이 한 행동이 오는 문장('…로 무엇을 파괴함')은 주격으로 세운다(지적:
    // "조조의 바이오닉 한 방으로 …파괴함"이 아니라 "조조는 바이오닉 한 방으로 …파괴함").
    // 소유격은 당한 쪽이 주어인 '-에' 꼴(아래 blow)에만 남긴다.
    const by = `${ga(c.who)} ${label}`;
    /* 본진 건물이 날아간 것(요청: 빠른무한에서는 본진 뚝배기가 날아가면 자원 수급이
       끊겨서 가장 큰 사건이다) — 확인한 근거가 '제 시작 자리에 넥서스·커맨드를 다시
       지었다'이므로, 다시 지어야 했다는 사실까지 그대로 말한다. 탈락·빈사보다 먼저
       본다: 그보다 구체적이고 확실한 이야기다. */
    if (c.p.hall) {
      const m = num(c.p.outMin) || num(c.p.hitMin);
      const when = m > 0 ? `${m}분 만에 ` : "";
      return say(
        [`${blow} ${also}${when}뚝배기가 깨져 다시 지어야 했음`,
          `${blow} ${also}${when}뚝배기째 날아가 새로 올려야 했음`],
        [`${blow} ${also}${when}${of}뚝배기가 깨져 다시 지어야 했음`],
        [`${ro(by)} ${also}${when}${of}뚝배기를 깨버림`],
      );
    }
    /* 하이템플러·리버·셔틀 드랍은 일꾼을 노리고 가는 수다(요청: 하이템플러나 리버로 일꾼
       견제한 내용이 더 나와야 한다) — 같은 '큰 타격'이라도 이 수는 무엇이 갈렸는지가
       분명하니 그렇게 말한다. 탈락까지 간 경우는 그쪽 문구가 더 큰 이야기라 안 건드린다. */
    if (!c.p.out && WORKER_DROP_KEYS.has(str(c.p.k))) {
      return say(
        [`${blow} ${also}일꾼 줄이 통째로 지워짐`, `${blow} ${also}일꾼이 크게 줄어듦`],
        [`${blow} ${also}${of}일꾼이 크게 줄어듦`, `${blow} ${also}${of}일꾼 줄이 지워짐`],
        [`${ro(by)} ${also}${of}일꾼을 잡음`, `${ro(by)} ${also}${of}일꾼을 줄임`],
      );
    }
    // 여럿이 함께 덮친 그림 — 누가 무슨 수를 냈는지(blow)에 나머지 이름을 이어 붙인다.
    // 이 꼴 하나로 탈락·빈사·생산 정지를 다 덮으므로 아래 갈래보다 먼저 본다.
    if (also) {
      const m = num(c.p.outMin) || num(c.p.hitMin);
      const when = m > 0 ? `${m}분 만에 ` : "";
      return c.p.out
        ? say(
          [`${blow} ${also}${when}무너짐`, `${blow} ${also}${when}그대로 쓰러짐`,
            `${blow} ${also}${when}그대로 끝장남`, `${blow} ${also}${when}크게 실패함`],
          [`${blow} ${also}${when}${ga(foe)} 무너짐`],
          [`${blow} ${also}${when}${reul(foe)} 판에서 지움`, `${blow} ${also}${when}${reul(foe)} 끝냄`],
        )
        // 탈락이 아니면 '버티지 못함'까지 가지 않는다(위 ks 갈래와 같은 이유).
        : say(
          [`${blow} ${also}${when}큰 타격을 입음`, `${blow} ${also}${when}많은 타격을 입음`],
          [`${blow} ${also}${when}${ga(foe)} 큰 타격을 입음`, `${blow} ${also}${when}${ga(foe)} 많은 타격을 입음`],
        );
    }
    // 초반 올인에 초반부터 무너진 그림(요청) — 몇 분 만이었는지가 곧 이야기다.
    if (c.p.early && !c.p.out) {
      const m = num(c.p.hitMin);
      const when = m > 0 ? `${m}분 만에 ` : "";
      return say(
        [`${blow} ${when}빈사 상태가 됨`, `${blow} ${when}병력이 거의 전멸함`,
          `${blow} ${when}기지가 대파됨`, `${blow} ${when}기지가 쑥대밭이 됨`,
          `${blow} ${when}거덜남`],
        [`${blow} ${when}${ga(foe)} 빈사 상태가 됨`, `${blow} ${when}${of}기지가 대파됨`],
        [`${ro(by)} ${when}${of}병력을 거의 전멸시킴`, `${ro(by)} ${when}${of}기지를 거의 파괴함`],
      );
    }
    // 그 창 안에 실제로 탈락했으면(Leave Game) 짐작이 아니라 사실이다 — 그렇게 말한다.
    if (c.p.out) {
      /* "N분경"은 안 적는다(요청) — 자막 맨 앞에 시각이 늘 붙으므로 같은 말이 두 번이다. */
      const when = "";
      return say(
        [`${blow} ${when}엘리당함`, `${blow} ${when}그대로 무너짐`],
        [`${blow} ${when}${ga(foe)} 엘리당함`],
        [`${ro(by)} ${when}${reul(foe)} 엘리시킴`, `${ro(by)} ${when}${reul(foe)} 끝냄`],
      );
    }
    // 어디를 쳤나(어택 지정 좌표로 확인될 때만) — 탈락시킨 게 아니라 타격만 준 경우에
    // 장면을 더 자세히 만든다(지적: 어택/무브 좌표를 구분해도 문장이 안 자세해진 것
    // 같다). 확인 안 되면(c.p.zone 없음) 예전 그대로 아무 말도 붙지 않는다.
    const zoneNoun = c.p.zone === "main" ? "본진" : c.p.zone === "multi" ? "멀티" : "";
    const zoneAt = zoneNoun ? `${zoneNoun}에서 ` : "";
    // 그 사람이 한 행동을 말하는 문장은 주격으로(위 by 참고), 당한 쪽이 주어인 '-에' 꼴만
    // 소유격으로 둔다.
    return say(
      [`${blow} ${zoneAt}큰 타격을 입음`, `${blow} ${zoneAt}많은 타격을 입음`, `${blow} ${zoneAt}적잖은 피해를 입음`],
      [`${ro(mine)} ${ga(foe)} ${zoneAt}큰 타격을 입음`, `${blow} ${ga(foe)} ${zoneAt}많은 타격을 입음`],
      [`${ro(by)} ${zoneNoun ? `${foe}의 ${zoneNoun}에 ` : `${foe}에게 `}큰 타격을 줌`,
        `${ro(by)} ${zoneNoun ? `${foe}의 ${zoneNoun}에 ` : `${foe}에게 `}많은 타격을 줌`],
    );
  },

  // ── 전술(replayTactics) ──
  "zling-rush": (c) => {
    const n = num(c.p.drones);
    const build = n > 0 ? `${n}드론 저글링 러시` : "초반 저글링 러시";
    // 몇 기로 달렸나(요청: 초반 러시에서는 유닛 기수도 중요하다) — zealot-rush 주석 참고.
    const lings = num(c.p.n, 0);
    // 올인 표현은 '러시'를 갈아 끼운다 — "…저글링 러시 올인러시"가 되면 말이 겹친다.
    const allin = build.replace(/러시$/, "올인 러시");
    const at = targetPhrase(c);
    return `${ga(c.who)} ${at}${done(c, c.pick([
      ...(lings >= 6 ? [`${build}를 저글링 ${lings}기로 감행함`, `저글링 ${lings}기로 ${reul(build)} 감행함`] : []),
      `${reul(build)} 함`, `빠른 ${reul(build)} 함`, `과감한 ${reul(allin)} 함`,
      `${ira(build)} 날카로운 전략을 꺼냄`, `날카로운 ${reul(build)} 감행함`,
      // 깎아내리는 말은 졌거나, 이겼더라도 한 종류만 주야장천 뽑았을 때만(지적). '무지성'
      // 같은 부정적 어휘 대신 '일편단심'처럼 긍정적인 어휘를 쓴다(지적).
      ...(c.won && !c.p.solo ? [] : [`일편단심 ${reul(build)} 함`]),
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
    "발키리를 뽑음", "발키리로 공중을 잡음",
  ]),
  // 드랍이 있었다는 것까지만 — "피해를 줌"은 확인된 게 아니다(지적: 드랍으로 피해를 줌도
  // 가정이니 고쳐 달라). 실제로 상대가 흔들렸으면 그건 raid-damage/harass-workers가
  // 생산 급감·일꾼 재생산이라는 별도 근거를 갖고 따로 말한다.
  dropship: (c) => {
    const of = victimPhrase(c);
    return `${ga(c.who)} ${done(c, c.pick([
      `드랍십을 계속 돌려 ${of}병력을 떨굼`, `드랍십으로 ${of}거듭 파고듦`,
    ]))}`;
  },
  /* 이름 없는 급습(replayTactics의 raidOn) — 여태 문장이 아예 없었다. 대개 raid-damage에
     묶여 그쪽 문장의 이름표로만 쓰이는데, 상대 생산이 안 끊겨 묶일 곳이 없으면 홀로
     남는다. 그러면 미니맵에 화살표만 뜨고 자막이 통째로 비었다(지적: 첫 문장이 안 나옴). */
  "base-raid": (c) => {
    // "조조의 진영으로 " — 1:1이 아니면 누구 집인지 알 수 없어 "상대 진영으로"가 된다.
    const of = c.whom ? `${c.whom}의 진영으로 ` : "상대 진영으로 ";
    const unit = UNIT_KO[str(c.p.unit)] ?? "";
    const n = num(c.p.n, 0);
    if (unit && n >= RAID_UNIT_SHOW) {
      return `${ga(c.who)} ${done(c, c.pick([
        `${unit} ${n}기를 몰고 ${of}들이침`,
        `${of}${unit} ${n}기를 몰아넣음`,
      ]))}`;
    }
    return `${ga(c.who)} ${done(c, c.pick([
      ...(unit ? [`${reul(unit)} 몰고 ${of}들이침`] : []),
      `${of}병력을 몰아 들이침`, `${of}치고 들어감`,
    ]))}`;
  },
  "zealot-rush": (c) => {
    const g = num(c.p.gates, 2);
    const label = g === 2 ? "투게이트" : `${g}게이트`;
    const at = targetPhrase(c);
    /* 몇 기로 달렸나 — 초반 러시에서는 게이트 수만큼이나 이게 이야기다(요청). 첫 질럿이
       나온 뒤 러시가 나가는 창 안에 뽑은 수라, 초반이라 죽은 병력이 거의 없어 실제로
       달려간 규모에 가깝다. 옛 요약에는 이 값이 없어 예전 문장 그대로다. */
    const n = num(c.p.n, 0);
    // 질럿 러시는 도박이 아니라 정석이다(지적) — 실패했다고 "끝내 통하지 않음"으로 맺지 않는다.
    // 한 유닛만 뽑고 달린 경우에만 '일편단심'을 붙인다(지적: 무지성 같은 부정적 어휘 대신
    // 긍정적인 어휘를 쓴다).
    return `${ga(c.who)} ${at}${done(c, c.pick([
      ...(n >= 4 ? [`${label}에서 질럿 ${n}기로 러시를 함`, `질럿 ${n}기를 모아 ${label} 러시를 감행함`] : []),
      `${label} 질럿 러시를 함`, `빠른 ${label} 질럿 러시를 함`,
      ...(g >= 3 ? [`${label} 질럿 올인 러시를 함`] : []),
      ...(c.p.solo ? [`일편단심 ${label} 질럿 러시를 함`] : []),
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
  //
  // 누구에게 떨궜는지는 늘 있다 — 리콜은 타겟을 확정하지 못하면 아예 beat가 되지 않기
  // 때문이다(요청: 타겟 없는 리콜은 재미가 없으니 확정 못 하면 이야기에서 뺀다.
  // replayTactics의 foeTurfAt). 그래서 여기서는 '어디에 떨궜나'를 늘 말한다.
  //
  // 같은 진입에서 두 번 이상 부른 것은 p.n으로, 그 판의 몇 번째 리콜인지는 p.nth로 온다
  // (요청: 리콜을 여러 번 하면 여러 번 나오게) — 두 번째 리콜을 첫 번째와 똑같은 말로
  // 하면 같은 문장이 두 번 나온 것처럼 읽힌다.
  recall: (c) => {
    const of = victimPhrase(c);
    const n = num(c.p.n, 1);
    const nth = num(c.p.nth, 0);
    /* 상대 동네가 아니라 '싸우고 있는 자리'에 부은 리콜(p.fight) — 제 진영을 지키러
       불러들인 것이거나 한복판 싸움에 병력을 쏟아 넣은 것이다. 그 자리에서 누구와
       무엇으로 엉켜 있었는지가 곧 이 리콜의 뜻이라(replayTactics의 fightersAt),
       "상대 진영에 떨궜다"고 말하면 방향이 정반대인 문장이 된다. */
    if (c.p.fight === true && c.whom) {
      const vs = list(c.p.vs).map((u) => UNIT_KO[u] ?? "").filter(Boolean);
      const foe = vs.length > 0 ? `${c.whom}의 ${vs.join("·")}` : c.whom;
      // "또 한 번 리콜을 3번 이어 붙여"는 말이 겹친다 — 몇 번째 리콜인지와 몇 번을 이어
      // 붙였는지는 둘 다 수를 말하는 자리라, 한 문장에 하나만 쓴다.
      const again = nth < 2 ? "" : n >= 2 ? "이번엔 " : "또 한 번 ";
      const how = n >= 2 ? `리콜을 ${n}번 이어 붙여 ` : "리콜로 ";
      return `${ga(c.who)} ${done(c, c.pick([
        `${wa(foe)} 엉킨 자리에 ${again}${how}병력을 쏟아부음`,
        `${wa(foe)} 맞붙은 싸움터에 ${again}${how}병력을 통째로 실어 나름`,
        `${again}${how}${wa(foe)} 붙은 자리에 병력을 몰아넣음`,
      ]))}`;
    }
    if (n >= 2) {
      return `${ga(c.who)} ${done(c, c.pick([
        `아비터 리콜을 ${n}번 이어 붙여 ${of}병력을 쏟아부음`,
        `${of}리콜을 ${n}번 연달아 떨궈 병력을 몰아넣음`,
      ]))}`;
    }
    if (nth >= 2) {
      const ord = nth === 2 ? "두 번째" : nth === 3 ? "세 번째" : `${nth}번째`;
      return `${ga(c.who)} ${done(c, c.pick([
        `${ord} 리콜로 ${of}또 병력을 떨굼`,
        `${of}${ord} 리콜을 꽂아 넣음`,
        `또 한 번 리콜로 ${of}파고듦`,
      ]))}`;
    }
    return `${ga(c.who)} ${done(c, c.pick([
      `아비터 리콜로 ${of}병력을 통째로 떨굼`, `아비터 리콜로 ${of}파고듦`,
      `과감한 아비터 리콜로 ${of}판을 흔듦`,
      `리콜 한 방으로 ${of}전황을 뒤집으려 함`,
    ]))}`;
  },
  // 리버 드랍 — 셔틀에 리버를 태워 일꾼을 지지는 그림(요청).
  // 리버 드랍도 '떨궜다'까지만 말한다 — 스캐럽이 일꾼 줄에 떨어졌는지 병력에 떨어졌는지는
  // 리플레이에 안 남는다(하이템플러 드랍과 같은 이유). 일꾼을 잡았다는 말은 상대가 그 뒤에
  // 일꾼을 몰아 뽑았을 때(harass-workers 비트)만 쓴다 — 거긴 근거가 따로 있다.
  // 예전 문구의 "…의 진영에 일꾼을 잡아냄"은 조사도 틀렸다(에 + 목적어).
  "shuttle-reaver": (c) => {
    const of = victimPhrase(c);
    return `${ga(c.who)} ${done(c, c.pick([
      `${of}리버 드랍을 감행함`, `셔틀에 리버를 태워 ${of}스캐럽을 떨굼`,
      `리버 드랍으로 ${of}파고듦`,
    ]))}`;
  },
  // 하이템플러 드랍 — 셔틀에 템플러를 태워 떨궜다는 것까지만 말한다. 그 스톰이 일꾼
  // 줄에 떨어졌는지 한복판 병력에 떨어졌는지는 리플레이에 안 남는다(지적) — 예전에는
  // "일꾼을 섬멸함", "자원 줄을 끊음"까지 말했는데 그건 근거가 없는 묘사였다.
  "templar-drop": (c) => {
    const of = victimPhrase(c);
    return `${ga(c.who)} ${done(c, c.pick([
      `${of}하이템플러 드랍을 감행함`, `셔틀에 템플러를 태워 ${of}떨굼`,
      `템플러 드랍으로 ${of}스톰을 뿌림`,
    ]))}`;
  },
  // 러커/히드라 드랍 — 저그는 오버로드 수송 업그레이드가 곧 드랍 의도다(요청).
  "zerg-drop": (c) => {
    const kind = c.p.lurker ? "러커 드랍" : "히드라 드랍";
    const of = victimPhrase(c);
    return `${ga(c.who)} ${done(c, c.pick([
      `오버로드에 태운 ${kind}을 ${of}감행함`, `${kind}으로 ${of}파고듦`,
    ]))}`;
  },
  shuttle: (c) => {
    const of = victimPhrase(c);
    return `${ga(c.who)} ${done(c, c.pick([
      `${of}셔틀 드랍을 감행함`, `셔틀을 돌려 ${of}거듭 떨굼`,
    ]))}`;
  },
  // ── 전황(replaySummary) ──
  // 진 편의 머리 문장 — 무엇으로 맞섰고 왜 안 됐나.
  stand: (c) => {
    const mode = str(c.p.mode);
    const phrase = unitPhrase(list(c.p.units));
    /* 무엇에 늦었나 — "아비터까지 갔지만 늦었다"는 무엇에 늦었다는 건지 없는 문장이었다
       (지적: "뽑았지만 누구를 막기에 늦었는지가 없네"). 넘어선 상대와 그 사람의 주력을
       실어 두었으니(replaySummary의 stand 비트), 그것으로 "○○의 △△를 막기엔"까지 간다.
       이름을 못 짚은 경기에서는 빈 문자열이라 예전 문장 그대로 나온다. */
    const foeKo = list(c.p.foeUnits).map((u) => UNIT_KO[u]).filter(Boolean);
    const foeArmy = foeKo.length >= 2 ? `${foeKo[0]}·${foeKo[1]}` : foeKo[0] ?? "";
    const wall = !c.foe ? "" : foeArmy ? `${c.foe}의 ${foeArmy}` : c.foe;
    /** "…를 막기엔" — 막을 대상이 없으면 빈 문자열이라 뒷말이 그대로 이어진다. */
    const block = wall ? `${reul(wall)} 막기엔 ` : "";
    if (mode === "spectacle") {
      const u = unitWithUp(c);
      if (!u) return null;
      // 몇 기까지 갔는지가 곧 그림이다(요청) — 한 부대면 그렇게 말한다.
      const n = num(c.p.n);
      const amount = n >= 12 ? "한 부대" : n >= 4 ? `${n}기` : "";
      // 넘어선 상대를 짚을 수 있으면 후보를 통째로 그쪽으로 바꾼다 — 섞어 두면 제비뽑기가
      // 여전히 "늦었음"만 남은 문장을 골라, 고쳐도 안 고쳐진 것처럼 보인다.
      return `${neun(c.who)} ${c.pick(wall ? [
        ...(amount ? [`${reul(u)} ${amount} 뽑고도 ${block}모자랐음`] : []),
        `${u}까지 꺼냈지만 ${block}늦었음`,
        `${u}까지 갔지만 ${block}모자랐음`,
      ] : [
        ...(amount ? [`${reul(u)} ${amount} 뽑았으나 실패함`, `${reul(u)} ${amount}나 뽑고도 소용없었음`] : []),
        `${u} 등의 고급 유닛을 사용해 전투에 임했으나 판을 뒤집지 못함`,
        `${u}까지 꺼냈지만 판을 뒤집지 못함`,
        `${u}까지 갔지만 늦었음`,
      ])}`;
    }
    if (mode === "nothing") {
      return `${neun(c.who)} ${c.pick([
        "제대로 싸워보지 못하고 무너짐", "손 쓸 새도 없이 무너짐", "그대로 당함",
        "싸워보지도 못하고 끝남", "시작하자마자 정리됨",
        // 요청: "할 수 있는 게 없었다"·"크게 망했다" 표현이 재밌으니 살려 줄 것.
        // 아무것도 못 해보고 끝난 자리라 이 말이 가장 정확하기도 하다.
        "할 수 있는 게 아무것도 없었음", "손도 못 써보고 크게 망함",
      ])}`;
    }
    if (!phrase) return null;
    if (mode === "pressed") {
      return `${neun(c.who)} ${c.pick(wall ? [
        `초반 경기를 주도했지만 ${phrase} ${reul(wall)} 넘지는 못함`,
        `초반 주도권을 쥐고도 ${phrase} ${reul(wall)} 넘어서지는 못함`,
      ] : [
        // "초반을 잡고 흔들었지만 … 굳히지 못했다"는 목적어가 없어 무엇을 굳히려던 건지
        // 붕 떴다(요청) — 무엇을 주도했고 무엇을 못 굳혔는지 둘 다 채운다.
        `초반 경기를 주도했지만 ${phrase} 승부를 굳히지는 못함`,
        `초반 주도권을 쥐고도 ${phrase} 승부를 마무리하지는 못함`,
      ])}`;
    }
    if (mode === "late") {
      return `${neun(c.who)} ${c.pick(wall ? [
        `${phrase} 후반을 노렸지만 ${block}늦었음`,
        `${phrase} 길게 갔지만 ${block}모자랐음`,
      ] : [
        `${phrase} 후반을 노렸지만 역부족`, `${phrase} 길게 갔지만 미치지 못함`,
      ])}`;
    }
    /* 공격한 쪽을 앞에 세운다(요청: 공격자가 앞, 수비자가 뒤라야 자연스럽다) —
       "○○의 히드라 공격을 △△가 탱크·벌처로 막아 봤지만 역부족이었다". 넘어선 상대와
       그 주력을 아는 경기에서만 이렇게 쓰고(wall), 모르면 아래 예전 문장 그대로다. */
    if (wall) {
      return c.pick([
        `${reul(wall)} ${neun(c.who)} ${phrase} 막아 봤지만 역부족`,
        `${wall} 공격을 ${neun(c.who)} ${phrase} 받아 냈지만 끝내 모자랐음`,
        `${reul(wall)} ${neun(c.who)} ${phrase} 끝까지 막았지만 넘지 못함`,
        ...(c.p.team ? [`${reul(wall)} ${neun(c.who)} ${phrase} 팀원과 함께 막아섰으나 역부족`] : []),
      ]);
    }
    return `${neun(c.who)} ${c.pick(wall ? [
      `${phrase} 맞섰지만 ${block}역부족`,
    ] : [
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
  // 공/방 업그레이드(요청: 최대한 활용) — "지상 3-3"처럼 그 판의 굳히기를 말한다.
  // 3-3은 '풀업'이라 부르고, 그보다 낮으면 숫자를 그대로 읽는다.
  upgrade: (c) => {
    const line = str(c.p.line);
    const w = num(c.p.w, 0);
    const a = num(c.p.a, 0);
    if (!line || w + a === 0) return null;
    const full = w >= 3 && a >= 3;
    return `${ga(c.who)} ${done(c, c.pick(full ? [
      `${line} 풀업(3-3)까지 올림`,
      `${line} 업그레이드를 끝까지 올려 굳힘`,
      `${line} 3-3을 찍고 힘으로 밀어붙임`,
    ] : [
      `${line} ${w}-${a}까지 올림`,
      `${line} 업그레이드를 ${w}-${a}로 앞세움`,
    ]), true)}`;
  },

  // 상징 업그레이드(요청) — 저글링 속업·드라군 사업처럼 이름만 대도 그림이 그려지는 것.
  "upgrade-signature": (c) => {
    const ko = SIGNATURE_UPGRADE_KO[str(c.p.upgrade) as keyof typeof SIGNATURE_UPGRADE_KO];
    if (!ko) return null;
    /* 속업·사업은 다들 하므로 '언제' 했는지가 곧 그 판의 빌드다(요청). 다만 몇 분인지를
       문장 안에 적지는 않는다 — 자막은 이미 "[14분]"으로 시작하고 앞에 "5분 뒤" 같은
       이음말까지 붙어서, 시각이 한 줄에 세 번 나온다(실측: "5분 뒤 …가 14분에 템플러
       에너지업부터 챙겼다"). 대신 이르게 찍었을 때만 그 사실을 말로 표시한다. */
    const early = num(c.p.min, 0) > 0 && num(c.p.min, 0) <= EARLY_UPGRADE_MIN;
    /* "~부터 챙겼다"는 안 쓴다(요청) — 업그레이드는 '완료했다/했다'로 담백하게 말한다.
       이르게 찍었다는 사실은 '일찍'이라는 말 하나로 족하다(요청: "일찌감치 마쳤다"가 아니라
       그냥 "완료했다"). 서둘러·일찌감치·남보다 먼저 같은 꾸밈은 걷었다. */
    return `${ga(c.who)} ${done(c, c.pick(early ? [
      `${reul(ko)} 일찍 완료함`, `${reul(ko)} 완료함`,
    ] : [
      `${reul(ko)} 완료함`, `${reul(ko)} 함`,
    ]), true)}`;
  },

  // 기술 — 연구가 아니라 '실제로 쓴' 것만 온다(replaySummary의 topUsedTech). 그래서 몇 번
  // 썼는지도 말할 수 있다 — 한 번 찔러 본 것과 계속 퍼부은 것은 전혀 다른 이야기다.
  tech: (c) => {
    const t = TECH_KO[str(c.p.tech)];
    if (!t) return null;
    // 이 값이 없는 옛 요약도 있다 — 사용 횟수를 세기 전에 저장된 것들이라, 그때는 횟수를
    // 말하지 않고 예전처럼 "꺼내 썼다"까지만 간다("0번 썼다"가 나가면 안 된다).
    const n = num(c.p.n, 0);
    /* 어디에 떨어졌나(요청: 어디에 뿌렸는지, 방어인지 공격인지가 표시되지 않는다) —
       replaySummary의 withCastPlace가 실어 준다. 옛 요약과 한곳에 안 몰린 판에는 없고,
       그때는 예전처럼 자리 없이 횟수만 말한다. */
    const placeRaw = c.p.place;
    /* 그 자리에서 누구와 엉켜 있었나(p.fight) — 마법은 혼자 쓰는 게 아니다(지적: 스톰을
       지진 경우 거의 100% 적과 교전 중인데 혼자 쓴 것처럼 묘사된다). 상대 이름은 whom으로,
       그 사람이 그 자리에서 움직인 병력은 p.vs로 온다(replaySummary의 fightersAt).
       자리 이름이 곧 그 상대의 기지면 이름을 두 번 부르지 않는다 — "조조의 기지에서
       조조의 히드라와"가 되면 안 된다. */
    /* 맞붙었다고 말하려면 '누구와'가 있어야 한다 — 상대가 자기 자신으로 실려 온 판이
       있었고(실측: "제 진영에서 맞붙어 스톰을 7번 뿌렸다"), 그러면 이름을 못 불러 그냥
       "맞붙어"만 남는데 그림에는 화살표가 하나뿐이라 자막과 어긋난다(지적: 교전이고
       자막도 교전인데 화살표가 하나만 있다). 상대를 못 짚으면 그 말을 아예 안 쓴다. */
    const fight = c.p.fight === true && !!c.whom && c.whom !== c.who;
    const vs = list(c.p.vs).map((u) => UNIT_KO[u] ?? "").filter(Boolean);
    const foeIsHost = fight && typeof placeRaw === "string" && c.names([placeRaw])[0] === c.whom;
    /** 맞붙은 상대를 부르는 말 — 이름만 부른다(요청: 자막에는 유닛 나열을 자제하고
     *  화살표에 싣는 쪽으로). 무엇과 붙었는지는 화살표 이름표가 말하고, 자막은 '누구와
     *  맞붙어 무엇을 몇 번 썼나'만 말한다. 그 기지가 이미 그 사람 이름을 말했으면 두 번
     *  부르지 않는다. */
    void vs;
    const foeWord = !fight || foeIsHost ? "" : (c.whom ?? "");
    const met = !fight ? "" : foeWord ? `${wa(foeWord)} 맞붙어 ` : "맞붙어 ";
    const spot = ((): string => {
      if (typeof placeRaw !== "string") return "";
      if (placeRaw === "") return "센터에서 ";
      const owner = c.names([placeRaw])[0];
      if (!owner) return "";
      /* 제 기지에서 마법을 썼다는 건 상대가 그 안까지 들어왔다는 뜻이다 — '지키며'로
         뭉뚱그리면 공격받았다는 사실이 문장에서 사라진다(지적: 사실상 공격당한 건데
         이상하다. 공격자 우선 원칙에도 안 맞는다). 누가 들어왔는지 알면 그 사람을
         앞세우고, 그 자리에 상대가 있었는지까지는 모르는 판에서는 자리만 말한다. */
      if (owner === c.who) return fight && foeWord ? "제 진영에 들어온 " : "제 진영에서 ";
      // 맞붙은 이야기를 할 때는 그 기지가 싸움터라는 뜻이라 '에'가 아니라 '에서'다.
      if (fight) return `${owner}의 기지에서 `;
      return c.p.def === true ? `${owner}의 기지를 지키며 ` : `${owner}의 기지에 `;
    })();
    const where = spot + met;
    /* 서로 같은 마법을 주고받은 싸움(p.vsN — replaySummary의 mergeSpellDuels) — 하이템플러
       둘이 스톰을 27번·24번 뿌린 대목을 양쪽에서 한 문장씩 말하면 같은 장면이 두 번 나온다.
       한 문장으로 합치고 두 수를 나란히 놓는다. */
    const vsN = num(c.p.vsN, 0);
    if (fight && vsN > 0) {
      const who2 = foeWord ? `${wa(foeWord)} ` : "";
      return `${ga(c.who)} ${spot}${who2}${done(c, c.pick([
        `${reul(t)} ${n}번·${vsN}번 주고받으며 맞붙음`,
        `${t} 싸움을 ${n}번 대 ${vsN}번으로 주고받음`,
        `${reul(t)} 서로 ${n}번·${vsN}번 퍼부으며 맞섬`,
      ]), true)}`;
    }
    // 시즈·마인처럼 '쓴다'는 말이 어색한 것들은 제 말투가 따로 있다(TECH_USE_PHRASE).
    const own = n >= 1 ? TECH_USE_PHRASE[str(c.p.tech) as keyof typeof TECH_USE_PHRASE] : undefined;
    if (own && own.length > 0) {
      /* 자리를 말할 때는 "머리 위로"처럼 자리를 겸하는 수식이 겹치므로 첫 표현(가장 담백한
         것)으로 고정한다 — "조조의 기지에 머리 위로 스톰을 21번 떨궜다"가 되면 안 된다. */
      const phrase = (where ? own[0] : c.pick(own)).replace("{n}", String(n));
      return `${ga(c.who)} ${where}${done(c, phrase, true)}`;
    }
    if (n === 1) {
      return `${ga(c.who)} ${where}${done(c, c.pick([
        `${reul(t)} 딱 한 번 써 봄`, `${reul(t)} 한 번 꺼내 봄`,
      ]), true)}`;
    }
    if (n >= 8) {
      return `${ga(c.who)} ${where}${done(c, c.pick([
        `${reul(t)} ${n}번이나 쏟아부음`, `${t}만 ${n}번을 쓰며 밀어붙임`,
      ]), true)}`;
    }
    if (n >= 2) {
      return `${ga(c.who)} ${where}${done(c, c.pick([
        `${reul(t)} ${n}번 씀`, `${t}까지 꺼내 씀`, `${reul(t)} 확보해 씀`,
      ]), true)}`;
    }
    return `${ga(c.who)} ${done(c, c.pick([
      `${t}까지 꺼내 씀`, `${reul(t)} 확보해 씀`,
    ]), true)}`;
  },
  allin: (c) =>
    `${ga(c.who)} ${c.pick(["일꾼을 거의 안 뽑고 병력만 짜낸 올인", "일꾼을 접고 병력만 뽑은 올인"])}`,
  // 탈락이 리플레이에 그대로 적혀 있으면(Leave Game) 짐작 없이 단정해 말한다(요청).
  fallen: (c) => {
    // 무너질 때 방어 건물을 몇 개나 지어 뒀는지(요청) — 그 수 자체가 그림이다.
    // 리플레이에 남아 있는 건 '지었다'까지라 막아냈는지는 말하지 않고, 모자랐다는
    // 느낌은 수가 대신 말하게 둔다. 이 필드가 없던 시절의 요약은 이 대목을 건너뛴다.
    const def = DEFENSE_KO[str(c.p.def)];
    const n = num(c.p.defN);
    const guard =
      !("defN" in c.p) || !def ? ""
        // 하나도 안 지었으면 그것도 사실이다(요청) — 무엇이 없었는지까지 짚어야 뜻이 산다.
        : n === 0 ? `${c.pick([`${def} 하나 없이`, `${def} 없이`, `${def} 한 개도 없이`])} `
          // 무너지기 직전에야 첫 채를 올렸으면 '미리 갖춘 것'이 아니라 '급히 올린 것'이다
          // (요청) — 같은 개수라도 이야기가 전혀 다르다.
          : c.p.panic === true
            ? `${c.pick([
              `무너지기 직전에야 ${def} ${n}개를 부랴부랴 올렸지만`,
              `뒤늦게 ${def} ${n}개를 급히 세웠지만`,
              `${def} ${n}개를 부랴부랴 올렸지만 이미 늦어`,
            ])} `
            : n <= 2 ? `${c.pick([`${def} ${n}개뿐인 채로`, `${reul(def)} ${n}개밖에 못 두고`])} `
              : `${c.pick([`${def} ${n}개와 함께 버텼지만`, `${def} ${n}개를 세워 두고도`])} `;
    // 누가 밀어붙여 무너뜨렸는지(지적: 해골이 뜨기 전에 아무 히스토리가 없다) — 이름이
    // 잡히면 그것만으로도 앞뒤가 이어진다. 방어 건물 문구가 이미 "…지었지만"처럼 접속으로
    // 끝나 있으면 그 뒤에 다시 "○○에게 밀려"를 붙이면 겹치므로, 이름은 문장 맨 앞에 둔다.
    const push = c.by
      ? c.pick([`${c.by}에게 밀려 `, `${c.by}의 공세에 `, `${c.by}에게 두들겨 맞고 `])
      : "";
    return `${ga(c.who)} ${push}${guard}${c.pick(
      // "망했다" 계열도 함께 둔다(요청) — 탈락이 리플레이에 그대로 적혀 있는 자리라
      // 세게 불러도 사실과 어긋나지 않는다.
      c.p.out
        ? c.p.team
          ? ["먼저 엘리당함", "제일 먼저 탈락하며 한 명이 빠짐", "먼저 지워짐", "먼저 끝장남",
            "먼저 크게 망함"]
          : ["엘리당함", "탈락함", "그대로 끝장남", "크게 실패함", "그대로 크게 망함"]
        : c.p.team
          ? ["먼저 무너지며 한 축이 빠짐", "먼저 정리되며 한 명이 빠짐", "먼저 나가떨어짐",
            "먼저 망함"]
          : ["일찍 손을 놓음", "일찍 무너짐", "먼저 정리됨", "일찍 실패함", "일찍 망함"]
    )}`;
  },

  // 한 대 맞은 무렵에 방어 건물을 한꺼번에 올린 대목(요청: 초반 러시에 크게 얻어맞을 만큼
  // 맞았는데 포토를 추가한 내용이 안 나온다). 판정 기준은 '몇 개가 있느냐'가 아니라
  // '여러 개를 늘린 시점'이다 — 한두 개는 원래 짓는 수라 근거가 못 된다(지적).
  //
  // 증설이 먼저면(warned) 오는 걸 보고 지은 것이고, 타격이 먼저면 맞고 나서야 지은 것이다
  // (지적: 오히려 예감하고 먼저 짓는 쪽이 흔하다). 둘은 같은 사건의 앞뒤라 한 자리에 두되
  // 문장은 갈라 쓴다.
  //
  // 늘 그렇듯 그게 막아냈는지는 리플레이에 없다. 지었다는 사실과 그 시점까지만 말한다 —
  // 그래서 warned 쪽도 "막지 못했다"가 아니라 "그래도 큰 타격을 입었다"까지만 간다.
  "late-defense": (c) => {
    const def = DEFENSE_KO[str(c.p.def)];
    const n = num(c.p.n);
    if (!def || n <= 0) return null;
    // 맞은 얘기는 다른 문장이 이미 했다 — 여기서는 지은 것만 말한다(quiet).
    if (c.p.quiet === true) {
      return `${ga(c.who)} ${done(c, c.p.warned === true
        ? c.pick([
          `공격을 예감하고 ${def} ${n}개를 몰아 지음`,
          `${def} ${n}개를 급히 올려 진영을 조임`,
        ])
        : c.pick([
          `뒤늦게야 ${def} ${n}개를 부랴부랴 늘림`,
          `뒤늦게 ${def} ${n}개를 몰아 지음`,
        ]))}`;
    }
    if (c.p.warned === true) {
      return `${ga(c.who)} ${done(c, c.pick([
        `${def} ${n}개를 급히 올렸지만 그대로 큰 타격을 입음`,
        `공격을 예감하고 ${def} ${n}개를 몰아 지었지만 그대로 많은 타격을 입음`,
        `${def} ${n}개를 부랴부랴 세우고도 적잖은 피해를 입음`,
      ]))}`;
    }
    return `${ga(c.who)} ${done(c, c.pick([
      `큰 타격을 입고 나서야 ${def} ${n}개를 몰아 지음`,
      `얻어맞은 뒤에야 ${def} ${n}개를 한꺼번에 올림`,
      `한 대 맞고 나서야 ${def} ${n}개를 부랴부랴 늘림`,
    ]))}`;
  },

  // 일꾼 생산 격차 — 커맨드로 센 '뽑은 수'다(살아남은 수가 아니다). 그래도 한쪽이 한참
  // 적게 뽑았다면 그만큼 경제가 눌렸다는 뜻이라, 승부의 밑바탕을 말해준다(요청).
  // 중반부터 끝까지 한 유닛을 계속 뽑은 것(요청) — 그걸로 경기를 끌고 갔다는 뜻이다.
  // 그 유닛이 맺음말이나 진 편 문장에 또 나와도 괜찮다(요청). 다만 여기서 말하는 건
  // 언제부터 언제까지 계속 뽑았나까지다 — 그게 살아남아 싸웠는지는 리플레이에 없다.
  "long-run": (c) => {
    const unit = unitWithUp(c);
    if (!unit) return null;
    const from = num(c.p.from);
    const to = num(c.p.to);
    const n = num(c.p.n);
    return `${ga(c.who)} ${done(c, c.pick([
      `${from}분부터 ${to}분까지 ${reul(unit)} 놓지 않고 뽑으며 끌고 감`,
      `${from}분부터 경기 끝까지 ${unit} 생산을 이어가 ${n}기를 뽑음`,
      `중반부터 끝까지 ${reul(unit)} 계속 찍어 내 ${n}기를 모음`,
    ]))}`;
  },

  "worker-gap": (c) => {
    const n = num(c.p.n);
    const foe = num(c.p.foe);
    if (n <= 0 || foe <= 0) return null;
    // 이 수도 누계다 — 잡혀 죽은 일꾼이 빠지지 않으므로 "N기를 굴렸다"가 아니라
    // "N기를 뽑았다"로 말한다(위 carrier 주석과 같은 이유).
    return `${ga(c.who)} ${c.pick(
      c.won
        ? [`일꾼을 ${n}기 뽑아 ${foe}기에 그친 상대를 경제로 눌렀음`,
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
  // 센터에 방어 건물을 박아 가운데를 걸어 잠그는 그림(요청) — 수가 많으면 '도배',
  // 적으면 그냥 깔았다는 데까지만. 포토뿐 아니라 성큰·터렛도 같은 수다(요청: 터렛도
  // 포토·성큰처럼 맥락 적용) — 무엇으로 잠갔는지는 p.b가 말한다. 옛 요약에는 그 값이
  // 없고 그때는 포토만 잡았으므로 기본값이 포토다.
  /* 중앙 장악(요청: 시즈한 좌표로 어디를 장악했는지도 알 수 있지 않나) — 탱크를 센터에
     박고 오래 눌러앉은 그림이다. 근거는 시즈를 누른 선택으로 주인이 짚인 탱크의 이동·공격
     명령이 센터에 몰린 것과, 그 명령이 이어진 시간뿐이다(replayTactics의 tankHold) —
     그래서 "몇 기로"나 "무엇을 잡았다"는 말하지 않고 '그 자리를 그만큼 붙잡고 있었다'까지만
     말한다. */
  "center-tank": (c) => {
    const min = num(c.p.min, 0);
    const held = min >= 2 ? `${min}분 동안 ` : "";
    return `${ga(c.who)} ${done(c, c.pick([
      `센터에 탱크를 박아 ${held}중앙을 걸어 잠금`,
      `중앙에 시즈를 펴고 ${held}그 자리를 내주지 않음`,
      `탱크로 센터를 눌러앉아 ${held}길목을 막음`,
    ]))}`;
  },

  "center-photon": (c) => {
    const n = num(c.p.n, 2);
    const b = DEFENSE_KO[str(c.p.b)] ?? "포토";
    // 센포는 길목 하나로 판이 갈리는 수다(요청) — '막다/고립시키다' 쪽 표현도 함께 쓴다.
    // 어미는 CONNECTIVE 표에 있는 것만(잠금·끊음·막음·놓음·함) — 없으면 "…고립시킴."처럼
    // 명사형이 그대로 남는다.
    const foe = c.whom ? reul(c.whom) : "상대를";
    return `${ga(c.who)} ${done(c, c.pick(
      n >= 6
        ? [
          `${b} ${n}개를 지어서 센터를 장악함`,
          `센터에 ${reul(b)} 도배함`,
          `${b} ${n}개로 센터 길목을 아예 틀어막음`,
          `센터를 ${ro(b)} 도배해 ${foe} 가둬 놓음`,
        ]
        : [
          `${b} ${n}개를 지어서 센터를 걸어 잠금`,
          `센터에 ${reul(b)} 지어 길을 끊음`,
          `센터 길목에 ${reul(b)} 박아 진출로를 막음`,
          `센터를 ${ro(b)} 끊어 ${foe} 막음`,
          `${ro(b)} 길목을 잠가 ${foe} 제 자리에 묶어 놓음`,
        ]
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
    /* 아군 진출로에 세운 옆탱(요청) — 남의 집 앞까지 탱크를 끌고 가 지켜 주는 것이라
       "기지 가장자리에 탱크를 세웠다"로는 그 이야기가 통째로 사라진다(지적: "브래드가
       군범 기지에서 7시를 옆탱으로 견제한 내용도 없다"). 누구의 앞인지(who2)와 그 앞이
       어느 쪽을 보고 선 것인지(whom)를 함께 말한다. */
    if (str(c.p.at) === "allyFront" && c.who2) {
      // 옆탱은 남의 집 '진출로'가 아니라 상대와 맞닿은 '벽 쪽'에 세우는 것이다(지적).
      const foe = c.whom ? `${c.whom} 쪽을 ` : "길목을 ";
      return `${ga(c.who)} ${c.who2}의 기지 벽 쪽에 탱크를 세워 ${done(c, c.pick([
        `${foe}막음`, `${foe}견제함`,
      ]))}`;
    }
    if (str(c.p.at) === "front") {
      // 팩토리를 어디에 지었나가 아니라 탱크를 어디에 세워 뒀나다(지적: 팩토리 위치랑
      // 옆탱은 상관없다) — 판정도 탱크에게 내린 이동 명령으로 한다(replayTactics의 tankPark).
      return `${ga(c.who)} ${done(c, c.pick([
        "상대와 맞닿은 옆구리에 탱크를 박아 둠",
        "기지 가장자리에 탱크를 세워 옆을 걸어 잠금",
        "상대 쪽 길목에 탱크를 자리 잡아 둠",
      ]))}`;
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
      `본진 앞을 ${def} ${n}개로 막음`,
      `진출로 쪽에 ${def} ${n}개를 지어 막음`,
    ]))}`;
  },
  /* 입구막기(요청: "본진 입구를 막고 발전한거도 좋은 묘사 포인트임") — 이 수의 값어치는
     막았다는 사실이 아니라 '막아 놓고 뒤에서 컸다'는 데 있으므로(그래서 판정도 발전까지
     함께 본다) 문장도 반드시 둘을 같이 말한다. 몇 분에 잠갔는지가 있으면 앞에 붙인다 —
     입구막기는 타이밍이 곧 내용이다.

     무엇으로 막았는지도 부른다(요청: 배럭·서플·벙커 / 게이트웨이·포토 / 해처리·성큰) —
     같은 '입구막기'라도 배럭에 벙커를 얹은 것과 해처리에 성큰을 붙인 것은 그림이 전혀
     다르다. 판정 쪽이 가장 많이 쓴 두 종류를 p.bs에 콤마로 실어 보낸다. */
  "wall-in": (c) => {
    /* "N분경"은 안 적는다(요청) — 자막 맨 앞의 시각이 이미 그 말을 한다. */
    const when = "";
    const kinds = str(c.p.bs).split(",").map((b) => BUILDING_KO[b]).filter(Boolean);
    // 이름을 못 부르는 건물뿐이면 그냥 "건물"이라고만 한다 — 근거 없는 이름은 안 붙인다.
    const what = kinds.length >= 2 ? `${wa(kinds[0])} ${kinds[1]}` : kinds.length === 1 ? kinds[0] : "건물";
    /* "마음 놓고", "안전하게", "조용히" 같은 말은 뺐다(지적: 맘 놓고 발전했다는 표현이
       어색하다 — 입구를 단단히 막고 발전·생산을 한 것이다). 리플레이가 말해 주는 것은
       '입구를 무엇으로 막았나'와 '그 뒤로 확장·생산을 이어갔다'까지고, 그 사람이 마음을
       놓았는지 조마조마했는지는 어디에도 안 적혀 있다. */
    return `${ga(c.who)} ${when}${done(c, c.pick([
      `본진 입구를 ${ro(what)} 막고 발전함`,
      `입구를 ${ro(what)} 막고 자원을 챙김`,
      `본진 앞을 ${ro(what)} 막고 테크를 탐`,
      `입구를 ${ro(what)} 막아 두고 확장에 투자함`,
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

  // 그 판에서 가장 크게 부딪친 대목(요청) — 마법과 공격 명령이 한때 한곳에 몰린 자리다.
  // 자리 이름(place)은 누군가의 기지면 그 이름, 센터면 빈 문자열, 모르면 아예 없다.
  clash: (c) => {
    const where = c.who2 ? `${c.who2}의 기지에서 `
      : str(c.p.place) === "mid" ? "센터에서 " : "";
    /* 무엇이 부딪쳤나(요청: 어떤 병력으로 무엇을 했는지) — 그 창 안에서 실제로 명령을 받은
       유닛들이다(replaySummary의 forceAt). "양 팀 병력이 크게 싸웠다"는 그 판의 절정을
       말하면서 정작 무엇이 맞붙었는지를 안 말해, 어느 경기에서나 똑같이 읽혔다. */
    // 한 종류만 짚었을 때는 그 이름을 앞세우지 않는다 — 어느 편 것인지 모르는 채로
    // "히드라가 뒤엉켜 맞붙었다"가 되면 한쪽만 싸운 것처럼 읽힌다. 둘 이상일 때만 부른다.
    const force = list(c.p.force).map((u) => UNIT_KO[u] ?? "").filter(Boolean);
    const named = force.length >= 2;
    /* 실제로 몇 사람이 얽혔나(replaySummary의 biggestClash) — "양 팀 병력이"는 여럿이
       뒤엉킨 난전에나 쓸 말이라, 둘이 붙은 싸움에 붙이면 사실과 다르다(지적). 옛 요약에는
       이 값이 없으니 그때는 예전처럼 말한다. */
    const people = num(c.p.people, 0);
    const pair = people === 2 && c.whoList.length === 2;
    /* 편별 병력(지적: 난전에서 엉켜 싸운 유닛을 뭉뚱그려 말하니 어느 편 것인지 구분이
       안 된다) — forceA는 whoList[0] 쪽, forceB는 whoList[1] 쪽이다(replaySummary가 그
       순서로 싣는다). 둘 다 있어야 '나란히 놓고 견주는' 문장이 되므로 한쪽이 비면 안 쓴다.
       난전에서는 대표 한 사람의 것이 아니라 그 편 전체의 병력이라 "○○ 쪽의"로 부른다. */
    const koOf = (v: unknown) => list(v).map((u) => UNIT_KO[u] ?? "").filter(Boolean);
    const fa = koOf(c.p.forceA);
    const fb = koOf(c.p.forceB);
    const split = fa.length > 0 && fb.length > 0 && c.whoList.length === 2;
    /* 둘이 붙은 싸움이면 이름을 부른다 — 그게 가장 정확하고, 그림(화살표)과도 맞는다.
       유닛 나열은 걷어냈다(요청: 자막에는 유닛 나열을 자제하고 화살표에 싣는 쪽으로) —
       "○○ 쪽의 히드라·러커와 △△ 쪽의 탱크"는 화살표 기둥의 이름표가 이미 그대로
       말하고 있고, 자막에서는 그 줄만 길어졌다. 이름을 못 부르는 자리(양쪽 대표를 못
       뽑은 옛 요약 등)에서만 무엇이 뒤엉켰는지로 대신한다. */
    const both = pair || split
      ? ga(c.who)
      : named ? ga(listForm(force.join("·")))
        : c.duel ? "둘의 병력이" : "양 팀 병력이";
    /* 그 싸움에서 실제로 터진 마법(요청: 다양한 세부 기술 사용 진술) — 마법 좌표에 시각이
       함께 남아 있어 몇 번 터졌는지까지 셀 수 있다. 큰 싸움의 그림은 대개 이것이 만든다. */
    const tech = TECH_KO[str(c.p.tech)];
    const techN = num(c.p.techN, 0);
    /* 마법 이야기는 앞에 얹는다 — 문장을 평서형('-다')으로 펴는 일은 맨 끝의 명사형('-ㅁ')을
       보고 이루어지므로, 뒤에 붙이면 정작 본절이 "크게 부딪침"인 채로 남는다(실측). */
    /* "…이 12번 터지는 가운데"는 그것만으로 열아홉 자다 — 참가자 이름까지 부르는 난전
       문장에 얹으면 자막이 여든 자를 넘는다(실측). 같은 사실을 절반 길이로 말한다. */
    const spell = tech && techN >= 2 ? `${tech} ${techN}번 속에 ` : "";
    /* 큰 교전은 한 판에 여러 번 나올 수 있다(요청: 큰 교전이 여러 번이면 여러 번 나오는 게
       맞다) — 그때 둘째부터는 "그 판의 가장 큰 싸움"이라고 말할 수 없다. 가장 큰 것은
       하나뿐이라, 그 말이 두 문장에 나오면 둘 중 하나는 거짓이 된다. nth가 없으면(옛
       요약과 그 판의 절정) 예전 표현 그대로다. */
    const notPeak = num(c.p.nth, 0) >= 2;
    const says = (xs: string[]): string[] => {
      const kept = notPeak ? xs.filter((s) => !s.includes("가장 큰")) : xs;
      return kept.length > 0 ? kept : ["한판 크게 붙음"];
    };
    /* 둘이 붙은 싸움이 한쪽의 기지에서 벌어졌으면 "양 팀 병력이"가 아니라 누가 누구를
       쳤는지로 말한다(지적: 팍규 본진에서 팍규와 태섭이 싸운 건데 "양 팀 병력이 한데 엉켜
       크게 싸웠다"로 나온다 — 그건 여럿이 얽혔을 때 쓰는 말이다). who는 양쪽에서 가장 많이
       찍은 사람을 하나씩 뽑은 것이라(replaySummary의 biggestClash), 그 둘 중 하나가 그
       기지의 주인이면 나머지 하나가 쳐들어간 사람이다 — 둘은 반드시 다른 편이다.
       기지 주인이 싸운 당사자가 아닐 때(제3자의 앞마당에서 붙은 경우)는 예전 표현 그대로다. */
    /* 여럿이 얽힌 대난전은 무엇으로 싸웠나보다 누가 붙었나가 이야기다(요청: "가장 큰 싸움이
       벌어진 경우 유닛보다는 상당 부분 참여를 한 플레이어 누구누구가 참여했다를 다 나열").
       일곱이 얽힌 판에서 양쪽 대표 한 사람씩만 부르니 1:1처럼 읽혔다(지적한 스크린샷).
       한쪽만 여럿이어도 그대로 부른다 — 편별 인원이 다른 것 자체가 그 싸움의 그림이다. */
    const pa = c.names(c.p.partsA);
    const pb = c.names(c.p.partsB);
    const roster = pa.length > 0 && pb.length > 0 && pa.length + pb.length >= 3;
    /* 넷을 넘으면 이름을 다 부르지 않고 팀으로 뭉뚱그린다(요청) — 일곱 명을 늘어놓으면
       자막이 대여섯 줄이 되어 지도를 통째로 가린다. 팀 번호를 모르는 판(기록이 팀을 안
       가른 경우)에서는 "양 팀"으로 물러선다. */
    /* 사람 수가 아니라 '이름이 차지하는 길이'로 가른다 — 넷이어도 긴 닉네임 넷이면 그것만
       스물두 자다(실측: "carol과 carol·bob·forge_saygay가"). 수로만 재던 때는 그 줄이 그대로
       통과해 자막이 일흔 자가 됐다. */
    const lumped = pa.length + pb.length > 4
      || pa.join("·").length + pb.join("·").length > 16;
    const teamWord = (names: string[]): string => {
      const t = names.map((n) => c.teamOfName(n)).find((v) => v !== undefined);
      return t ? `${t}팀` : "";
    };
    const [la, lb] = [teamWord(pa), teamWord(pb)];
    /* 팀 번호를 모르는 기록에서는 팀으로 부를 수가 없다 — 그때는 대표 하나만 부르고 나머지는
       수로 줄인다(맺음말 verdict가 이미 쓰는 방식). 이름을 다 부르는 것보다 훨씬 짧고,
       "누가 얼마나 얽혔나"는 그대로 남는다. */
    const few = (names: string[]): string =>
      (names.length <= 1 ? names.join("") : `${names[0]} 외 ${names.length - 1}명`);
    const sideA = lumped ? (la && lb ? la : few(pa)) : pa.join("·");
    const sideB = lumped ? (la && lb ? lb : few(pb)) : pb.join("·");
    /* 그 싸움을 누가 이겼나(요청) — 리플레이에 전사자 수는 없다. 아는 것은 싸움이 끝난
       뒤 그 자리에 누가 남아 계속 명령을 내렸나뿐이라(replaySummary의 CLASH_AFTER_SEC),
       딱 그만큼만 "자리를 지켰다"로 말한다. 어느 쪽도 못 지켰으면 비긴 것으로 둔다. */
    const hold = str(c.p.hold);
    const holderSide = hold === "a" ? sideA : hold === "b" ? sideB : "";
    // 팀으로 뭉뚱그린 문장에서는 "1팀이"로 끝난다 — "1팀 쪽이"는 겹말이다.
    const holder = holderSide
      ? (lumped && la && lb ? holderSide : `${holderSide.split("·")[0]} 쪽`) : "";
    /* "그 자리를 지켰다"는 안 쓴다(지적: 그런 표현은 안 쓴다) — 싸움의 결과는 그냥 이겼다고
       말하는 것이 우리 말투다. 근거는 그대로 '싸움이 끝난 뒤 그 자리에 남아 명령을 이어간
       쪽'이고(replaySummary의 CLASH_AFTER_SEC), 그걸 부르는 말만 바꾼다. */
    /* 열세를 딛고 이긴 싸움(요청: "잘 싸운 전투 가려내서 … 누가 잘 싸웠다는 내용 추가") —
       요약이 규모까지 재서 실어 준다(replaySummary의 wellFought). 미니맵 체력바가 쓰는
       것과 같은 값이라, 바가 짧은 쪽이 이긴 장면과 자막이 같은 사실을 말한다.
       배수는 두 배부터만 말한다 — "1.2배 병력을 상대로"는 열세라 부를 만한 차이가 아니고,
       그 자리는 이미 '적은 병력으로'가 말하고 있다. */
    const well = c.p.well === true && !!holder;
    const odds = num(c.p.odds, 0);
    const gap = well && odds >= 2 ? `${Math.round(odds)}배 가까운 병력을 상대로 ` : "";
    const outcome = well && holder
      ? c.pick([
        `${gap}${ga(holder)} 잘 싸워 이김`,
        `${gap}${ga(holder)} 적은 병력으로 전투를 잘함`,
        `${gap}${ga(holder)} 열세를 딛고 싸움을 가져감`,
      ])
      : holder
      ? c.pick([
        `${ga(holder)} 전투를 이김`,
        `${ga(holder)} 싸움을 가져감`,
        `${ga(holder)} 우세했음`,
        `${ga(holder)} 병력을 남기고 이김`,
      ])
      /* "서로 물러섬" · "크게 갈림"은 쓰지 않는다(지적: 교전 문장이 어색하다) — 리플레이가
         실제로 아는 건 "그 자리를 지킨 쪽이 없다"뿐인데, 물러섰다는 말은 안 본 움직임을
         지어내는 것이고 '갈리다'는 병력 손실을 뜻하는 은어라 문장체와 겉돈다. 아는 그대로
         "승부가 나지 않았다"와, 그 자리에 병력을 부어 넣은 사실만 말한다. */
      /* "승부가 나지 않았다"도 안 쓴다(요청) — 결말이 없었다는 말이 아니라 팽팽했다는
         말이라야 그 장면이 읽힌다. */
      /* 승부가 안 난 싸움도 좋은 말로 쓴다(요청: "병력만 소모했다"·"갈렸다" 같은 부정적
         표현은 빼고) — 어느 쪽도 물러서지 않았다는 뜻이지 아무 일도 없었다는 뜻이 아니다. */
      : c.pick([
        "용호상박의 전투를 벌임",
        "팽팽하게 맞섬",
        "양보 없이 싸움",
        "일진일퇴의 공방을 벌임",
      ]);
    if (roster) {
      /* 누군가의 기지에서 벌어진 싸움은 '누가 치고 누가 도우러 왔나'로 말한다(지적:
         "○○의 기지에서 A와 B가 맞붙어"는 누가 쳐들어간 건지가 안 보인다. 정구가 공격하고
         크리스·군범이 도우러 온 것인데 서로 마주 선 것처럼 읽힌다).
         집주인의 편이 곧 막은 쪽이다 — 편을 아는 기록에서만 이렇게 쓰고, 모르면 아래 예전
         표현으로 물러선다. */
      const ownerTeam = c.who2 ? c.teamOfName(c.who2) : undefined;
      const teamA = pa.map((n) => c.teamOfName(n)).find((v) => v !== undefined);
      const teamB = pb.map((n) => c.teamOfName(n)).find((v) => v !== undefined);
      const aIsRaider = ownerTeam !== undefined && teamA !== undefined && teamB !== undefined
        && teamA !== teamB ? teamA !== ownerTeam : undefined;
      if (c.who2 && aIsRaider !== undefined) {
        const atk = aIsRaider ? sideA : sideB;
        const def = aIsRaider ? sideB : sideA;
        const atkHeld = hold === (aIsRaider ? "a" : "b");
        const defHeld = hold === (aIsRaider ? "b" : "a");
        /* '헬프'는 남을 도우러 간 사람에게만 쓴다(지적: "곰세마리는 자기 자신이 공격당했으니
           헬프를 간 게 아님" — "정구가 곰세마리의 기지를 치고 Rex·곰세마리가 헬프에 나섰고"로
           나왔다). 막은 무리에 집주인이 끼어 있으면 그건 제 집을 지킨 것이지 도우러 온 것이
           아니다. 팀으로 뭉뚱그린 문장도 마찬가지다 — 그 팀이 곧 집주인의 편이라 집주인이
           그 안에 들어 있다. 막았다·수비했다는 집주인에게도 도우러 온 사람에게도 참이라,
           가릴 수 없을 때는 그쪽으로 물러선다. */
        const defNames = aIsRaider ? pb : pa;
        const helpOnly = !lumped && !!c.who2 && !defNames.includes(c.who2);
        // 도우러 온 쪽이 막아 냈으면 "…지만"이 아니라 "…" 로 이어야 앞뒤가 맞는다.
        const joined = atkHeld
          ? c.pick(helpOnly
            ? ["헬프에 나섰지만", "막아섰지만", "수비에 나섰지만"]
            : ["막아섰지만", "수비에 나섰지만", "맞섰지만"])
          : c.pick(helpOnly
            ? ["헬프에 나섰고", "막아섰고", "수비에 나섰고"]
            : ["막아섰고", "수비에 나섰고", "맞섰고"]);
        const tail = atkHeld
          ? c.pick([`${ga(atk)} 전투를 이김`, `${ga(atk)} 싸움을 가져감`, `${ga(atk)} 우세했음`])
          : defHeld
            ? c.pick([`${ga(def)} 막아 냄`, `${ga(def)} 끝내 걷어 냄`, `${ga(def)} 지켜 냄`])
            : c.pick([
              "용호상박의 전투를 벌임", "팽팽한 전투를 함", "일진일퇴의 공방을 벌임",
            ]);
        const mk = (sp: string) =>
          `${sp}${ga(atk)} ${c.who2}의 기지를 치고 ${ga(def)} ${joined} ${done(c, tail)}`;
        const one = mk(spell);
        return spell && one.length > MAX_LINE ? mk("") : one;
      }
      /* 자리·마법·참가자·결과가 다 들어가면 자막이 두 줄을 넘긴다(실측 87자). 넷 중 마법은
         곁가지라(그 그림은 이모지가 이미 말한다) 넘칠 때 그것부터 접는다. c.pick은 같은
         beat에 늘 같은 것을 고르므로 두 번 불러도 표현이 흔들리지 않는다. */
      const build = (sp: string) => `${where}${sp}${wa(sideA)} ${ga(sideB)} ${c.pick([
        "한데 싸웠고", "맞붙었고", "정면으로 부딪쳤고",
      ])} ${done(c, outcome)}`;
      const full = build(spell);
      return spell && full.length > MAX_LINE ? build("") : full;
    }
    const owner = c.who2;
    const raider = owner ? c.whoList.find((n) => n !== owner) : undefined;
    if (pair && owner && raider && c.whoList.includes(owner)) {
      /* 이제 병력을 편별로 알고 있으니(forceA/forceB) 각자 무엇으로 싸웠는지까지 말한다 —
         "태섭이 히드라·러커를 몰고 팍규의 기지를 덮쳐 팍규의 질럿과 크게 붙었다".
         편별 목록이 없는 옛 요약에서는 양쪽 것이 섞인 목록뿐이라 누구 것이라고 말할 수
         없으므로, 예전처럼 '무엇이 뒤엉켰나'로만 얹는다(관형형이라 뒤에 명사가 와야 한다). */
      const raiderIsA = c.whoList[0] === raider;
      const rf = split ? (raiderIsA ? fa : fb) : [];
      const of = split ? (raiderIsA ? fb : fa) : [];
      /* 무엇을 몰고 갔고 무엇과 붙었는지는 화살표 이름표가 말한다(요청: 자막에는 유닛
         나열을 자제) — 자막은 '누가 누구 집을 들이쳐 크게 붙었나'만 말한다. */
      void rf; void of;
      return `${spell}${ga(raider)} ${done(c, c.pick(says([
        `${owner}의 기지를 덮쳐 크게 붙음`,
        `${owner}의 본진까지 밀고 들어가 그 판의 가장 큰 싸움을 벌임`,
        `${owner}의 기지를 들이쳐 한판 크게 붙음`,
      ])))}`;
    }
    // 여기서도 넘치면 마법 꾸밈부터 접는다(위 roster와 같은 규칙).
    const plain = (sp: string) => `${where}${sp}${both} ${done(c, c.pick(says(
      named
        ? ["뒤엉켜 크게 부딪침", "맞부딪쳐 그 판의 가장 큰 싸움을 벌임",
          "정면으로 맞붙음", "한데 뒤엉켜 한판 크게 붙음"]
        : ["크게 부딪침", "정면으로 맞붙음", "한데 엉켜 크게 싸움", "가장 큰 싸움을 벌임"],
    )))}`;
    const plainFull = plain(spell);
    return spell && plainFull.length > MAX_LINE ? plain("") : plainFull;
  },

  /* 제 집에서 막아 냄 — 마지막 싸움이 이긴 편의 기지에서 벌어진 판의 첫 대목이다(요청:
     결론 전투 장소가 이긴 팀 본진인 경우 "정리했다"가 어색하다. 방어에 성공하고 그 후
     역공하는 스냅까지 있어야 한다). 리플레이가 말해 주는 것은 '그 싸움이 그 집에서
     벌어졌고 그 뒤 판이 끝났다'까지라, 무엇을 몇 기 잡았는지는 말하지 않는다. */
  "hold-off": (c) => `${ga(c.who)} ${done(c, c.pick([
    `제 기지까지 밀린 ${c.whom ?? "상대"}의 공세를 막아 냄`,
    `본진 앞까지 온 ${c.whom ?? "상대"}를 걷어 냄`,
    `제 집에서 ${reul(c.whom ?? "상대")} 받아쳐 막아 냄`,
  ]))}`,

  /* 막아 낸 뒤의 역공 — 그 싸움 뒤에 이긴 편이 상대 진영에 실제로 어택을 찍은 대목이다
     (replaySummary의 homeStand). 근거는 그 좌표뿐이라 '넘어가서 두들겼다'까지만 말한다. */
  counter: (c) => `${ga(c.who)} ${done(c, c.pick([
    `그대로 넘어가 ${c.whom ?? "상대"}의 기지를 두들김`,
    `곧바로 역공에 나서 ${reul(c.whom ?? "상대")} 밀어붙임`,
    `막아 낸 기세로 ${c.whom ?? "상대"}의 진영으로 넘어감`,
  ]))}`,

  // 이사(요청) — 주로 건물을 짓는 자리가 통째로 바뀐 것. 본진이 밀려 다른 곳에서 다시
  // 시작하는 그림이라, 그 자체로 판이 기운 신호다. 여러 번 옮기면 그때마다 한 문장이다.
  /* 이사는 '누가 밀고 들어와서' 간 것이다(지적: 이사하기 전에 그 사람이 타격을 입은
     내용이 아예 없었다) — 이제 그 이름을 자리로 짚어 두므로(replaySummary의 moveBy) 한
     문장 안에서 원인과 결과가 같이 읽힌다. 못 짚은 판에서는 예전 표현 그대로다. */
  relocate: (c) => (c.by
    ? `${ga(c.who)} ${done(c, c.pick([
      `${c.by}에게 본진을 내주고 다른 곳에 살림을 폄`,
      `${c.by}의 공세에 본진을 접고 멀티에서 다시 시작함`,
      `${c.by}에게 밀려 터를 옮겨 새 기지에서 판을 다시 폄`,
      `${c.by}에게 본진을 두들겨 맞고 다른 자리로 살림을 옮김`,
    ]))}`
    : `${ga(c.who)} ${done(c, c.pick([
      "본진을 버리고 다른 곳에 살림을 폄",
      "본진을 접고 멀티에서 다시 시작함",
      "터를 옮겨 새 기지에서 판을 다시 폄",
      "본진을 포기하고 다른 자리로 살림을 옮김",
    ]))}`),

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
  // 그래서 진 쪽에는 도박수와 같은 맺음(실패함·소용없었음)을 붙인다.
  //
  // n은 '한때 함께 떠 있던 수'에 가까운 값(창 단위 최대)이다 — 자세한 이유는
  // replayTactics의 windowPeak 주석에 있다. 경기 내내 뽑은 누계는 말하지 않는다(요청).
  bc: (c) => {
    const n = num(c.p.n, 3);
    return `${ga(c.who)} ${done(c, c.pick([
      `배틀크루저를 ${n}기까지 띄움`,
      `끝내 배틀크루저까지 올림`,
      `배틀크루저 ${n}기로 하늘로 밀고 나감`,
    ]), true)}`;
  },

  // 캐리어(요청) — 배틀크루저·목동과 같은 자리. 위 bc와 마찬가지로 n은 누계가 아니라
  // 창 단위 최대다: 캐리어는 6서플이라 동시 보유 상한이 서른셋인데, 스타게이트 열두 개로
  // 십여 분 이어 뽑은 경기의 누계(69기)를 그대로 말하면 있지도 않았던 함대가 된다(지적).
  carrier: (c) => {
    const n = num(c.p.n, 4);
    return `${ga(c.who)} ${done(c, c.pick([
      `캐리어를 ${n}기까지 띄움`,
      `캐리어 ${n}기를 띄워 올림`,
      `캐리어 ${n}기로 승부를 걺`,
      // 수가 적을 때만 '끝내 올렸다'로 말한다 — 열 기 넘게 띄운 경기에서 수를 빼면
      // 정작 그 경기의 그림이 사라진다.
      ...(n < 8 ? ["끝내 캐리어까지 올림"] : []),
    ]), true)}`;
  },

  // 가디언(요청) — 뮤탈을 변태시켜 지상을 두들기는 그림. 드물게 나와서 그 자체가 이야기다.
  guardian: (c) => {
    const n = num(c.p.n, 4);
    return `${ga(c.who)} ${done(c, c.pick([
      `가디언 ${n}기를 띄워 지상을 두들김`,
      `뮤탈을 가디언으로 변태시켜 밀고 들어감`,
      `가디언을 띄움`,
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
    return `${head}, ${neun(foe)} 막히고 ${ga(c.who)} ${when}${c.pick([
      `${foe}에게 큰 타격을 줌`, `${foe}에게 많은 타격을 줌`, `${foe}의 기지를 대파함`,
    ])}`;
  },

  // 초반 올인이 막히고 역으로 무너진 경우(요청) — 러시가 실패한 것만 말하는 것보다,
  // 그 뒤에 제 살림이 무너진 것까지 이어야 이야기가 된다.
  "rush-backfire": (c) => {
    const label = tacticLabel(str(c.p.k), c.p) || "초반 러시";
    // 러시가 막힌 뒤에 오는 건 '살림이 무너짐'이 아니라 테크·발전에서의 손해다(지적).
    const opts = [
      `${reul(label)} 갔으나 막힘`,
      // 바깥에서 이미 "○○가"를 붙이므로 여기서 또 주격을 쓰면 "조조가 저글링 러시가
      // 실패했다"가 된다(주격 두 번) — 전술은 목적격으로 받는다.
      `${reul(label)} 갔다가 실패함`,
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
    /* 문턱이 '이 판 한 사람 몫'에 따라 움직이면서(replayTactics의 MUTA_MASS_SHARE) 한
       부대가 안 되는 뮤탈도 이야기가 된다 — 헌터 13분 판의 15기처럼. 그런 수를 부대로
       말하면 "1부대"·"0부대"가 되어 말이 안 되니, 두 부대부터만 부대로 센다. */
    const squads = num(c.p.squads, 0);
    const q = squads >= 2 ? `${squads}부대` : `${num(c.p.n, 12)}기`;
    /* '사방'은 근거가 있을 때만 쓴다(지적: "사방을 찔렀으면 사방에 이모지가 있어야 할 듯").
       p.spotN은 그 사람이 실제로 헤집은 자리 수이고(replaySummary의 sortieSpots), 미니맵은
       바로 그 자리마다 화살표를 하나씩 긋는다. 그림에 화살표가 하나뿐인데 글만 사방이라고
       하면 둘 중 하나가 거짓말이 되므로, 세 곳부터 사방·두 곳은 두 곳·한 곳은 방향을 아예
       말하지 않는다. 옛 요약에는 이 값이 없어 그때는 방향을 안 말하는 쪽으로 간다. */
    const n = num(c.p.spotN, 0);
    if (n >= 3) {
      return `${ga(c.who)} ${done(c, c.pick([
        `뮤탈 ${q}를 굴리며 사방을 찌름`,
        `${q} 뮤탈로 여기저기를 헤집음`,
        `뮤탈 ${q}로 ${n}곳을 번갈아 두들김`,
      ]))}`;
    }
    if (n === 2) {
      return `${ga(c.who)} ${done(c, c.pick([
        `뮤탈 ${q}를 굴리며 두 곳을 번갈아 찌름`,
        `${q} 뮤탈로 두 군데를 헤집음`,
      ]))}`;
    }
    return `${ga(c.who)} ${done(c, c.pick([
      `뮤탈을 ${q}까지 모아 흔듦`,
      `${q} 뮤탈로 하늘을 뒤덮음`,
      `뮤탈 ${q}를 모아 몰고 다님`,
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
      `${ga(c.who)} ${ro(label)} ${foe}일꾼을 계속 잡음`,
      `${ga(c.who)} ${ro(label)} ${foe}일꾼을 잡음`,
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
      `${ro(label)} ${foe}일꾼을 ${span}잡아댐`,
      `${span}${ro(label)} ${foe}일꾼을 계속 잡음`,
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
      "다 밀리고도 다시 일어섬",
      "끝난 줄 알았던 자리에서 되살아남",
      "생산을 다시 시작함",
    ]))}`,

  // 팽팽한 대치(요청) — 주어가 없는 문장이다. 양쪽 얘기라 누구를 앞세울 수 없다.
  standoff: (c) => {
    const m = num(c.p.min);
    if (m <= 0) return null;
    return c.pick([
      `${m}분 동안 팽팽하게 대치함`,
      `${c.duel ? "둘이" : "양 팀이"} ${m}분 가까이 팽팽하게 맞섬`,
      `${m}분 내내 승부가 기울지 않음`,
      `${m}분을 서로 밀고 밀리며 버팀`,
    ]);
  },

  // 양쪽 다 병력을 거의 보태지 않은 채 한참 이어진 구간(요청: "45분 중 절반을 캐리어와
  // 골리앗이 서로 노려보며 버텼는데 그게 전혀 안 나온다"). 뽑은 수가 적어 주력 조합
  // 싸움에서 밀리는 조합이라도 이 한 줄로는 남는다.
  //
  // 문장에 "그 병력이 살아 있었다"는 뜻이 새어 들어가지 않게 조심한다 — 리플레이에는
  // 유닛의 생사가 안 적혀 있어서 무엇이 남아 있었는지는 알 수 없다(지적). '갖춰 놓고
  // 더 보태지 않았다'까지만 말한다.
  "late-hold": (c) => {
    const m = num(c.p.min);
    const mine = UNIT_KO[str(c.p.mine)] ?? "";
    const theirs = UNIT_KO[str(c.p.theirs)] ?? "";
    if (m <= 0 || !mine || !theirs) return null;
    const both = c.p.duel === true ? "둘 다" : "양쪽 다";
    return c.pick([
      `${both} ${reul(mine)} ${wa(theirs)} 갖춰 놓은 뒤로는 병력을 더 보태지 않은 채 ${m}분을 버팀`,
      `${ro(`${mine} 대 ${theirs}`)} 자리를 잡은 뒤 ${both} 생산을 접다시피 하고 ${m}분을 끌었음`,
      `${m}분 동안 ${both} 병력을 거의 안 보탠 채 ${mine} 대 ${theirs} 구도로 버팀`,
    ]);
  },

  // 맵 곳곳에 건물을 흩뿌리며 버틴 경기(요청: "둘은 계속해서 맵 구석구석에 건물을 지으며
  // 도망다니며 버텼어"). 근거는 건물 좌표뿐이라 '어디에 얼마나 벌려 지었나'까지만 말한다 —
  // 도망 다녔는지 밀려난 건지는 좌표로 알 수 없으므로 단정하지 않는다.
  //
  // 시야(요청) — 오버로드·옵저버를 뿌려 판을 읽는 플레이.
  vision: (c) => {
    /* 스캔은 띄워 두는 눈이 아니라 그때그때 여는 눈이라 말이 다르다(요청: 스캔·오버로드·
       옵저버로 여기저기 정찰한 것도 묘사 포인트) — 몇 번 뿌렸는지와, 그중 상대의 집을
       몇 곳이나 열어 봤는지를 말한다. 근거는 스캔을 쓴 좌표 그대로다(replaySummary). */
    if (str(c.p.unit) === "Scanner Sweep") {
      const n = num(c.p.n, 0);
      const spots = num(c.p.spots, 0);
      if (n <= 0) return null;
      return `${ga(c.who)} ${done(c, c.pick([
        ...(spots >= 2 ? [`스캔을 ${n}번 뿌려 상대 기지 ${spots}곳을 들여다봄`] : []),
        `스캔을 ${n}번 뿌려 여기저기 정찰함`,
        `스캔 ${n}번으로 상대의 움직임을 훑음`,
      ]))}`;
    }
    const u = unitWithUp(c);
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
  /* 여럿이 붙어 한 사람을 먼저 끊은 것 — 한 일만 말한다. 예전에는 진 편일 때
     "먼저 끊고도 끝내 밀림"처럼 경기 결과까지 한 문장에 넣었는데, 그건 초반에 벌어진
     이 사건과 한참 뒤의 결말을 한 호흡에 묶는 것이라 인과가 안 읽힌다(지적: 문장
     인과관계가 이해가 안 되고 하나로 합치면 안 되는 문장). 결과 꼬리는 done()이
     '진 편의 마지막 문장이면서 끝 무렵의 일'일 때만 붙인다 — 이 수는 정의상 초반이라
     거기 걸리지 않는다. */
  "gang-rush": (c) => {
    const n = num(c.p.n, 2);
    const cnt = n === 2 ? "둘이서" : `${n}명이서`;
    const whom = c.whom ? `${reul(c.whom)} ` : "";
    return `${ga(c.who)} ${cnt} ${done(c, c.pick([
      `초반부터 몰아쳐 ${whom}먼저 무너뜨림`,
      `함께 붙어 ${whom}일찍 정리함`,
      `초반에 달라붙어 ${whom}그대로 지워버림`,
    ]))}`;
  },

  // 채팅에서 잡은 항복 선언(요청) — 승부가 어디서 끝났는지 말해주는 유일한 '사람의 말'이다.
  gg: (c) =>
    c.p.all
      ? `${c.whoList.join("·")}${c.duel ? "가" : " 팀이"} ${c.pick(["결국 GG 선언", "결국 GG를 치고 물러남", "결국 GG 치고 끝냄"])}`
      : `${ga(c.who)} ${c.pick(["결국 GG 선언", "GG를 침", "GG 치고 나감", "일찍 GG", "손 놓고 GG"])}`,

  /* 노엘(노엘리) — "다 부수지 말고 그냥 끝내 달라". 외친 것만으로도 사실상 끝난 것이지만,
     그러고도 끝내 다 털린 경우(p.out)가 이 판의 웃음 포인트다(요청). */
  "no-elim": (c) => (c.p.out === true
    ? `${ga(c.who)} ${c.pick([
      "노엘을 외쳤지만 끝내 엘리당함",
      "노엘을 외쳤는데도 끝내 싹 털림",
      "노엘을 외쳤으나 받아들여지지 않음",
    ])}`
    : `${ga(c.who)} ${c.pick(["노엘을 외침", "노엘을 부름", "노엘 한마디로 손을 듦"])}`),

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

  /* 병력을 늦게까지 안 뽑고 째다가 어떻게 됐나 — 얻어맞았으면 그 이야기가 되고, 무사히
     넘겼으면 그 뒤의 물량이 이야기가 된다.
     한때는 '째다'를 피해 "자원부터 챙기다가"로 풀어 썼는데, 이 판에서 쓰는 말이 따로 있는
     데도 굳이 설명체로 바꿔 부를 이유가 없다(요청: 그 표현들을 걷어내고 '째기'로). */
  "greedy-punished": (c) => {
    const m = num(c.p.min);
    const when = m > 0 ? `${m}분까지 ` : "";
    // 때린 사람은 by다(whom이 아니다) — replaySummary의 greedy-punished 주석 참고.
    const foe = c.by ? `${c.by}의 ` : c.whom ? `${c.whom}의 ` : "상대의 ";
    return `${ga(c.who)} ${done(c, c.pick([
      `무리하게 째다가 ${foe}공격에 노출됨`,
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
      `${ga(c.who)} 초반에 쨌던 것이 ${unit} 물량으로 돌아옴`,
      `${ga(c.who)} 초반을 무사히 넘기고 ${unit} 물량이 폭발함`,
      `${ga(c.who)} ${when}일꾼부터 채운 뒤 ${reul(unit)} 쏟아냄`,
      `${ga(c.who)} 쨌던 만큼 ${unit} 물량으로 밀어붙임`,
      `그 사이 조용히 몸집을 불린 ${ga(c.who)} ${unit} 물량을 뽑아냄`,
    ]));
  },

  /* 패스트 OO(요청) — 보통 나오는 때보다 이르게 뽑아 상대가 준비하기 전에 들이대는 수.
     이건 '전략'이라고 부른다(요청: "패스트 드라군 전략을 시도했다 / 전략을 썼다 / 전략으로
     갔다" 같은 말이 좋다) — "타이밍을 크게 당겼다"는 표현은 안 쓴다. 업그레이드 이름은
     떼고 유닛만 부른다(요청: 그냥 패스트 드라군): "패스트 사업 드라군 전략"은 이름이 너무
     길어지고, 이 문장이 말하려는 것은 무슨 업그레이드를 했나가 아니라 그 유닛으로 일찍
     갔다는 빌드 자체다. 업그레이드는 제 문장(upgrade-signature)이 따로 말한다. */
  "fast-tech": (c) => {
    const unit = UNIT_KO[str(c.p.unit)];
    if (!unit) return null;
    const fast = `패스트 ${unit}`;
    // "패스트 드라군 전략을 썼다"처럼 '전략'까지 붙여 부른다(요청의 말 그대로).
    const build = `${fast} 전략`;
    const m = num(c.p.min);
    const when = m > 0 ? `${m}분 만에 ` : "";
    const at = targetPhrase(c);
    /* 어디로 갔는지 모르면 갔다고 말하지 않는다(지적: "일찍 뽑아서 어딜 갔는지가 없네").
       예전에는 목표가 없어도 "상대가 준비하기 전에 들이댐"·"승부를 걸음"·"허를 찌름"이
       나왔는데, 그건 리플레이에 없는 이야기다 — 확인된 건 그 유닛이 이르게 나왔다는 것뿐이다.
       그럴 때는 무슨 전략이었나만 말하고 끝낸다. */
    if (!c.whom) {
      return `${ga(c.who)} ${done(c, c.pick([
        `${reul(build)} 시도함`, `${reul(build)} 씀`, `${ro(build)} 감`,
        `${when}${reul(unit)} 뽑는 ${reul(build)} 씀`,
      ]))}`;
    }
    // 언제 닿았는지까지 알면 그것도 말한다(withStrike의 landMin) — 뽑은 때와 부딪친 때가
    // 벌어져 있을수록 "일찍 뽑아 그 병력이 어디로 갔나"가 또렷해진다.
    const land = num(c.p.landMin);
    if (land > 0 && land > m) {
      return `${ga(c.who)} ${done(c, c.pick([
        `${when}${reul(unit)} 뽑아 ${land}분에 ${reul(c.whom)} 덮침`,
        `${when}${reul(unit)} 확보해 ${land}분에 ${c.whom}에게 들이댐`,
        `${ira(fast)} ${land}분에 ${reul(c.whom)} 찌름`,
      ]))}`;
    }
    return `${ga(c.who)} ${at}${done(c, c.pick([
      `${ro(build)} 승부를 걸음`,
      `${reul(build)} 시도함`,
      `${when}${reul(unit)} 뽑아 상대가 준비하기 전에 들이댐`,
      `${reul(build)} 씀`,
    ]))}`;
  },
  // 파워 OO(요청) — 한 유닛만 압도적으로 뽑아 그 물량으로 밀어붙이는 그림.
  "power-unit": (c) => {
    const unit = unitWithUp(c);
    if (!unit) return null;
    const n = num(c.p.n);
    // 이 수는 그 순간의 병력이 아니라 경기 내내 뽑은 총량이다 — 그렇게 말해야 정확하다(지적).
    // 다만 한 번에 몰아 뽑은 게 아니라 나눠 뽑았으면(burst < n) 총량만 말하면 안 된다
    // (지적: "연속적으로 뽑은 게 아니라 나눠져서 뽑은 거라 따로 계산돼야 함"). 그 문장이
    // 놓이는 자리도 가장 큰 묶음의 시점이므로, 문장도 그 묶음을 말해야 앞뒤가 맞는다.
    /* 병력의 절반을 훌쩍 넘겨 '그것만 뽑은' 경우와, 다른 병력도 함께 굴리면서 그 유닛을
       유독 많이 뽑은 경우는 다른 말이라야 한다(지적: 탱크를 135기나 뽑았는데 아무 말도
       없다 — 그 사람은 마린·골리앗도 함께 굴렸다). '만'과 '하나로'는 앞의 경우에만 쓰고,
       이쪽은 총량을 말한다 — 나눠 뽑은 묶음(burst)이 아니라 '그 판에서 그 유닛을 몇 기나
       굴렸나'가 이 이야기의 전부다. */
    if (c.p.solo === true) {
      return `${ga(c.who)} ${done(c, c.pick([
        `${reul(unit)} 총 ${n}기나 뽑아내며 물량으로 몰아침`,
        `${reul(unit)} ${n}기까지 뽑음`,
        `경기 내내 ${reul(unit)} ${n}기나 굴림`,
      ]))}`;
    }
    const burst = num(c.p.burst);
    if (burst > 0) {
      return `${ga(c.who)} ${done(c, c.pick([
        `${reul(unit)} ${burst}기 충원함`,
        `${reul(unit)} ${burst}기 더 추가함`,
        `${reul(unit)} 한 번에 ${burst}기까지 몰아 뽑음`,
      ]))}`;
    }
    return `${ga(c.who)} ${done(c, c.pick([
      `${ro(`파워 ${unit}`)} 밀어붙임`,
      `${unit}만 경기 내내 총 ${n}기를 뽑아 물량으로 승부함`,
      `${reul(unit)} 총 ${n}기나 뽑아내며 물량으로 몰아침`,
      `경기 내내 ${unit} 물량을 많이 뽑아냄`,
      `${unit} 물량으로 밀어붙임`,
    ]))}`;
  },
  /* 물량(요청: "프로토스들의 질럿 드라군 물량 이야기도 없네") — 위 '파워 OO'는 한 유닛이
     병력의 절반을 훌쩍 넘겨야 나오는데, 사람들이 물량이라 부르는 그림은 대개 두 유닛의
     조합이다(실측: 질럿 521 + 드라군 504로 둘이 94%인데 각각은 48%·46%라 아무 말도 안
     나왔다). 여기서는 '분당 몇 기'를 근거로 삼는다 — 총량은 경기 길이에 끌려다닌다. */
  "mass-army": (c) => {
    const units = list(c.p.units).map((u) => UNIT_KO[u] ?? "").filter(Boolean);
    const ns = numList(c.p.ns);
    const n = num(c.p.n);
    const rate = num(c.p.rate);
    if (units.length === 2 && ns.length === 2) {
      const both = units.join("·");
      return `${ga(c.who)} ${done(c, c.pick([
        `${both}을 각각 ${ns[0]}기·${ns[1]}기까지 찍어내며 물량으로 밀어붙임`,
        `${both} 물량을 분당 ${rate}기꼴로 쏟아냄`,
        `쉬지 않고 ${both}만 뽑아 총 ${n}기를 굴림`,
      ]))}`;
    }
    return `${ga(c.who)} ${done(c, c.pick([
      `병력을 분당 ${rate}기꼴로 찍어내며 물량으로 밀어붙임`,
      `경기 내내 총 ${n}기를 뽑아 물량으로 몰아침`,
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
      `${c.duel ? "둘이" : "양 팀이"} ${m}분 동안 병력 ${n}기를 쏟아부은 소모전이었음`,
      `쉼 없이 병력을 주고받은 소모전으로 흘러감`,
      `${m}분 내내 병력을 계속 부딪친 소모전이 이어짐`,
    ]);
  },

  /* 병력이 앞선 채로 흘려보낸 대목(요청) — 한쪽이 훨씬 많이 뽑아 놓고도 들어가지 않았고,
     그 사이 상대가 확장을 늘렸으면 그것까지 붙인다. 이 문장이 말하는 건 '한 일'이 아니라
     '안 한 일'이라, 주어는 사람보다 편이 어울린다 — 팀전이면 팀으로 뭉뚱그린다(문장이
     길어지는 것도 막는다). 개인전이면 그냥 그 사람 이름이다. */
  "idle-lead": (c) => {
    const ratio = num(c.p.ratio);
    const much = ratio >= 2 ? "두 배가 넘는 병력을" : "훨씬 많은 병력을";
    /* 그 사이 상대가 무엇을 했나 — 테크 하나로만 말한다(요청).
       한동안 "멀티를 N개 더 늘림 / N군데 더 폄"으로 그 수를 셌는데, 그 말 자체가 어색해서
       통째로 뺐다(요청: 완전 삭제) — 이 앱의 다른 문장들도 확장을 셀 때는 "5해처리"처럼
       건물로 말하지 '멀티 몇 개'라고 하지 않는다(위 PRODUCTION_KO 주석). 요약은 그 수(exp)를
       여전히 세어 두지만 문장에서는 안 쓴다.
       옛 요약에는 tech가 없어 0으로 떨어지고, 그때는 '타이밍을 흘려보냄'만 말한다. */
    const tech = Number(c.p.tech ?? 0);
    /** 팀전이면 "1팀/2팀", 개인전이거나 팀을 모르면 이름 그대로. */
    const team = (names: string[], fallback: string): string => {
      if (c.duel || names.length === 0) return fallback;
      const t = names.map((n) => c.teamOfName(n)).find((v) => v !== undefined);
      return t ? `${t}팀` : fallback;
    };
    const foeNames = (c.whom ?? "").split("·").filter(Boolean);
    const me = team(c.whoList, c.who);
    const foe = team(foeNames, c.whom || "상대");
    /** 그 틈에 상대가 한 일 — 바깥 문장이 이미 "…동안 / …사이 / 그 틈에"로 때를 말하므로
     *  여기서 또 "그 사이"를 붙이지 않는다(한 문장에 같은 말이 두 번이 된다). */
    const gain = tech > 0 ? c.pick([
      `${ga(foe)} 테크를 탐`,
      `${ga(foe)} 테크를 한 단계 올림`,
    ]) : "";
    return `${ga(me)} ${done(c, gain ? c.pick([
      `${much} 쌓아 두고도 들어가지 않는 사이 ${gain}`,
      `${much} 세워만 두는 동안 ${gain}`,
      `${much} 뽑아 놓고도 밀지 않았고, 그 틈에 ${gain}`,
    ]) : c.pick([
      `${much} 쌓아 두고도 들어가지 않고 타이밍을 흘려보냄`,
      `${much} 끝내 쓰지 못하고 때를 놓침`,
      `${much} 뽑아 놓고도 밀 때를 잡지 못함`,
    ]))}`;
  },

  // 아군 기지에 포토를 깔아 주는 것 — 제 이득이 아니라 팀을 위한 수라 따로 말한다(요청).
  /* 아군이 맞는 동안 그 진영으로 병력을 보낸 것(요청: 아군 헬프) — 자리로만 아는 일이라
     "도우러 갔다"까지만 말하고 막아 줬는지는 말하지 않는다. */
  "ally-help": (c) => {
    const who = c.whom ? c.whom : "아군";
    return `${ga(c.who)} ${done(c, c.pick([
      `${reul(who)} 도우러 병력을 보냄`,
      `${who}의 진영으로 지원을 감`,
      `${reul(who)} 구하러 병력을 돌림`,
      `${who} 쪽으로 병력을 붙여 줌`,
    ]))}`;
  },

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
  // 이걸 부르는 말은 "째기"다(요청: 째기 표현 복구) — 한때 "먼저 올리는 전략"으로 풀어 썼는데,
  // 이 판에서 쓰는 말이 따로 있는데 굳이 설명체로 바꿔 부를 이유가 없다.
  "greedy-build": (c) => {
    const kind = str(c.p.kind);
    const what = kind === "hatch" ? "해처리" : kind === "nexus" ? "투넥서스" : "투커맨드";
    /* 말은 '초반 째기'로 고정한다(요청: "자원을 앞세웠다. 자원부터 모았다. 해처리로 쨌다.
       이런 표현 제거하고 초반 째기를 시도했다. 이런 자연스러운 문장을 사용해줘").
       무엇으로 쨌는지는 목적어가 아니라 곁가지로 붙인다 — "해처리로 쨌다"처럼 건물을
       조사로 받으면 이 판에서 쓰지 않는 말투가 된다. */
    return `${ga(c.who)} ${done(c, c.pick([
      "초반 째기를 시도함",
      `${reul(what)} 늘리며 초반 째기를 시도함`,
      "초반부터 째고 들어감",
    ]))}`;
  },

  // 잘한 사람의 그림을 옛 프로게이머에 빗대는 한 마디(요청).
  "pro-like": (c) => {
    const pro = str(c.p.pro);
    const style = str(c.p.style);
    if (!pro || !style) return null;
    const at = c.whom ? `${reul(c.whom)} 상대로 ` : "";
    /* 세 표현 다 style을 목적어로 받는다 — 한때 "박성준 못지않은 공격적인 저그였다"처럼
       그 말 자체를 서술어로 세웠는데, style은 "바이오닉 운영"·"폭풍 저글링"처럼 사람이
       아니라 '그림'을 부르는 말이라 '~였다'로 받으면 사람이 그 그림이 되어 버린다
       (지적: 문장이 어색하다). */
    return `${ga(c.who)} ${at}${done(c, c.pick([
      `마치 ${pro}처럼 ${reul(style)} 펼쳐 보임`,
      `${reul(pro)} 떠올리게 하는 ${reul(style)} 선보임`,
      `${pro} 못지않은 ${reul(style)} 보여줌`,
    ]))}`;
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
    // 조합이 둘이면 이어받기 문구("계속된 질럿 공격으로")를 안 쓴다 — 한 유닛만 부르는
    // 꼴이라 나머지 하나가 문장에서 사라진다(지적: 캐리어가 안 나온다).
    const cont = c.p.cont && mode === "plain" && units.length < 2;
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
      /* 맺음말은 그 자체로 이미 한 문장이다 — 거기에 활약 한 마디를 또 이으면 "결국 35분을
         끌고 간 끝에 …가 나란히 밀어붙여 판을 정리했고, …가 하이템플러 물량으로 경기를
         캐리했다"처럼 여든 자가 된다(실측). 자리가 남을 때만 붙인다. */
      if (!hero || main.length + hero.length + 2 > MAX_LINE) return main;
      // 앞마디를 연결형으로 바꿔야 "…뒤집었고, 조조가 …"처럼 읽힌다 — 명사형 그대로 두면
      // 문장 한가운데에 '-ㅁ'이 남는다.
      return `${toAnd(main) ?? main}, ${hero}`;
    };

    const who = ga(c.who);
    // 팀전 승리는 한 사람의 공이 아니다(요청) — 각자가 무엇으로 싸웠는지를 나란히 말한다.
    // 흐름을 이미 말하는 초반 승리·역전에는 얹지 않는다(문장이 길어지고 앞뒤가 어긋난다).
    // 경기력 차이가 심했으면 결론에서 그렇게 말한다(요청) — 국면을 늘어놓는 대신 한 줄로.
    if (c.p.oneSided) {
      const meLabel = c.team ? `${c.team}팀` : c.who;
      return withHero(head + c.pick([
        `${ga(meLabel)} 압도한 경기였음`,
        `${p}${ga(meLabel)} 처음부터 끝까지 몰아붙인 일방적인 경기였음`,
        `처음부터 끝까지 ${ga(meLabel)} 끌고 간 일방적인 경기였음`,
      ]));
    }
    // 역전패한 경기는 진 편 입장에서 맺어도 좋다(요청) — 초반을 쥐고 있던 쪽의 이야기라
    // 그쪽을 주어로 세우는 편이 경기의 아쉬움이 더 살아난다.
    if (mode === "comeback" && c.whom) {
      const foeTeam = c.team === 1 ? 2 : c.team === 2 ? 1 : 0;
      const foeLabel = foeTeam ? `${foeTeam}팀` : c.whom;
      const meLabel = c.team ? `${c.team}팀` : c.who;
      const by = phrase ? `${meLabel}의 ${phrase.replace(/으?로$/, "")}에 ` : `${meLabel}의 뒷심에 `;
      return withHero(c.pick([
        `${neun(foeLabel)} 초반 승기를 잡았지만 ${by}끝내 버티지 못함`,
        `${neun(foeLabel)} 앞서가다 ${by}아쉽게 무너짐`,
        `${neun(foeLabel)} 다 잡았던 경기를 ${by}내주고 말았음`,
      ]));
    }
    // 분석 단계의 표시(p.held)와 그릴 때 재는 값(atHome) 중 하나만 맞아도 '제 집'이다 —
    // 저장된 표시가 없는 옛 경기도 그림만 보고 바로 갈린다(위 atHomeOf 주석).
    const teamHeld = c.p.held === true || c.atHome;
    const team = teamPhrase(c, teamHeld);
    if (team && (mode === "plain" || mode === "late")) {
      // "길게 끌어"는 쓰지 않는다(지적) — 장기전이었다는 말로 바꾼다.
      const t = mode === "late" ? c.pick(["후반 ", "장기전 끝에 ", "긴 대치 끝에 "]) : "";
      // 막아 낸 갈래는 teamPhrase가 이미 맺어 놓았다(위 주석).
      const body2 = head + (teamHeld ? `${t}${team}` : `${t}${team} ${c.pick(["경기를 끝냄", "GG를 받아냄"])}`);
      return withHero(body2);
    }
    if (spectacle) {
      const b2 = `${c.who}의 ${c.pick([
        `${spectacle}까지 나온 끝에 승부가 갈림`,
        `${reul(spectacle)} 앞세워 몰아붙임`,
        `${reul(spectacle)} 꺼내 승부를 냄`,
      ])}`;
      return withHero(b2);
    }
    // 조합을 빼면 "초반 승리"처럼 앙상해지므로, 그럴 땐 수식도 같이 정리한다.
    let body: string;
    if (mode === "rush") {
      body = phrase
        ? `${who} ${c.pick([`초반 ${p}그대로 끝냄`, `초반 ${p}경기를 끝냄`, `초반 ${p}GG를 받아냄`])}`
        : `${who} ${c.pick(["그대로 끝냄", "초반에 그대로 GG를 받아냄"])}`;
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
      body = `${who} ${c.pick([
        `후반 ${p}경기를 끝냄`, `장기전 끝에 ${p}GG를 받아냄`, `긴 대치 끝에 ${p}경기를 끝냄`,
      ])}`;
    } else {
      // 주력을 부대 단위로 뽑았으면 그 규모 자체가 그림이다(요청) — 12기를 한 부대로 센다.
      const leadKo = UNIT_KO[list(c.p.units)[0] ?? ""] ?? "";
      const squads = Math.floor(num(c.p.unitN) / 12);
      // 조합이 둘이면 '질럿만 10부대' 식으로 한 유닛만 부르지 않는다(위 cont와 같은 이유).
      const bulk = leadKo && squads >= 2 && !cont && units.length < 2
        ? [`${leadKo} ${squads}부대를 뽑아 밀어붙임`, `${leadKo}만 ${squads}부대 넘게 뽑아 몰아붙임`]
        : [];
      /* 제 집에서 막아 내고 끝낸 판은 "몰아붙였다"가 아니다(지적: 결론 전투 장소가 이긴
         팀 본진인 경우가 많은데 "정리했다"는 말이 어색하다) — 앞에 막아 냄·역공 스냅이
         따로 서 있으므로(replaySummary의 homeStand) 맺음말은 그 둘을 받아 맺는다. */
      const held = c.p.held === true || c.atHome;
      body = held
        ? `${who} ${c.pick([
          `${p}받아쳐 경기를 끝냄`, `막아 낸 기세 그대로 ${p}GG를 받아냄`, `${p}되받아치며 끝냄`,
        ])}`
        : phrase
          ? `${who} ${c.pick([`${p}몰아붙임`, `${p}경기를 끝냄`, `${p}GG를 받아냄`, ...bulk])}`
          : `${who} ${c.pick(["그대로 굳힘", "그대로 GG를 받아냄"])}`;
    }

    // 맺음말은 "결국 …"으로 열어도 좋다(요청) — 앞의 흐름을 받아 마무리한다는 신호가 된다.
    // 이미 시간·흐름을 말하는 머리말(혈투 끝에 / 몇 분 만에)이 붙었으면 겹치므로 뺀다.
    // 이어받기 문구(contPhrase)가 이미 "결국"을 품고 있으면 또 붙이지 않는다.
    const close = head || body.includes("결국") ? head + body : c.pick(["", "결국 "]) + body;
    return withHero(close);
  },

  /* 승패만 말하는 마지막 한 줄(요청: 결론 스텝을 결론 전투 내용과 승패로 나누고, 승패는
     시작 스냅처럼 누가 이겼는지만 표시하는 스냅으로 고정) — 시작의 "게임 시작!"과 짝이
     되는 자리라 경기마다 표현을 바꾸지 않는다. 무엇으로 어떻게 끝냈는지는 바로 앞 맺음말이
     이미 말했고, 여기서는 트로피만 얹는다.

     팀전은 팀 번호로 부른다. 팀을 모르는 기록이면 이름을 늘어놓되, 여럿이면 대표 둘까지만
     부르고 나머지는 수로 줄인다 — 여덟 명 이름이 한 줄에 늘어서면 시작 스냅과 달리
     자막이 지도를 가린다. */
  verdict: (c) => {
    // 팀 번호는 이름으로 되묻는다 — 렌더러가 c.team을 늘 0으로 넘기기 때문이다(clash의
    // teamWord와 같은 방법).
    const team = c.whoList.map((n) => c.teamOfName(n)).find((v) => v !== undefined);
    if (!c.duel && team) return `${team}팀 승리!`;
    const names = c.whoList;
    if (names.length === 0) return null;
    if (names.length <= 2) return `${names.join("·")} 승리!`;
    return `${names.slice(0, 2).join("·")} 외 ${names.length - 2}명 승리!`;
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
  const r = renderLines(data, resolveName, teamOf);
  return r ? r.lines.join(". ") : null;
}

/** 문장 하나와 그 문장이 담고 있는 beat들. 타임라인이 문장 단위로 움직이므로(요청: 요약
 *  문장 하나당 스냅 하나) 문단을 이어 붙이기 전 단계가 필요하다 — 한 문장에 여러 beat가
 *  들어가는 일이 흔해서(같은 사람 이야기를 "…했고 …했다"로 잇는다), 문장을 다 만든 뒤
 *  마침표로 자르는 것으로는 어느 beat가 어느 문장인지 되찾을 수 없다. */
interface RenderedLines {
  lines: string[];
  /** lines와 같은 길이 — 각 문장에 담긴 beat 첨자들(넣은 순서 = 시간순). */
  lineBeats: number[][];
}

function renderLines(
  raw: ReplaySummaryData | unknown,
  resolveName: (rawName: string) => string,
  teamOf?: (name: string) => 1 | 2 | undefined,
): RenderedLines | null {
  if (!isReplaySummaryData(raw)) return null;
  /* 저장된 비트에는 자막에 안 실을 것까지 다 들어 있다(요청: 모든 것을 저장하고 보여줄 때만
     선별) — 여기서 한 겹 걷어낸다. 돌려주는 첨자는 '원래 자리번호'다: 미니맵·타임라인이
     그 번호로 저장된 비트를 다시 찾아가므로, 추린 목록 안의 번호를 주면 엉뚱한 장면을
     가리킨다. */
  const { data, map: beatIndex } = pickedSummary(raw);
  // 개인전에서는 팀 용어("1팀의 …", "양 팀이 …")를 아예 쓰지 않는다(요청).
  const duel = data.duel === true;

  /* 그 자리가 주어 편의 집이었나 — 맺음말이 "몰아붙여"라고 말해도 되는지를 가른다.
     제 집에서 벌어진 싸움을 두고 몰아붙였다고 할 수는 없다(지적: "격전지가 이긴 편 본진인
     게 중요한 게 아니라, 아군 기지에 몰아붙일 일이 없잖아").

     재는 법은 "그 자리가 한복판보다 어느 집에 더 가까운가" 하나다. 가장 가까운 집까지의
     거리를 본진들의 한가운데(=맵 한복판)까지의 거리와 견주기만 하면 된다 — 문턱도 반경도
     없어서 맵 크기·본진 간격·인원수에 흔들리지 않는다.

     앞서 두 번 헛짚었다. 반경(마당)으로 자르니 본진 코앞의 싸움을 '아무의 집도 아님'으로
     놓쳤고, 그다음엔 '두 번째로 가까운 집보다 절반 이하'로 바꿨는데 그것도 놓쳤다 —
     신고된 판을 캡처에서 재 보니 렉스까지 22타일·그다음 집까지 31.6타일(비 0.70)이라
     절반 기준에 걸렸다. 본진이 한 줄로 늘어선 맵에서는 제 집 앞이어도 이웃집이 그리
     멀지 않다. 한복판과 견주면 그 판은 22 대 65.5로 명확히 갈린다.

     센터 싸움은 반대로 한복판이 훨씬 가까워 어느 집 자리도 아니게 된다(그게 목적이다). */
  const bases = data.bases ?? {};
  const atHomeOf = (b: ReplaySummaryBeat): boolean => {
    const raw_xy = b.p?.xy;
    if (!Array.isArray(raw_xy) || raw_xy.length !== 2) return false;
    // 좁힌 타입이 map 콜백까지 따라오지 않아(배열 첨자 접근이라) 지역 숫자로 꺼내 둔다.
    const [ax, ay] = raw_xy;
    if (typeof ax !== "number" || typeof ay !== "number") return false;
    const spots = Object.entries(bases);
    if (spots.length < 2) return false;
    const nearest = spots
      .map(([raw, h]) => ({ raw, d: Math.hypot(ax - h[0], ay - h[1]) }))
      .sort((x, y) => x.d - y.d)[0];
    if (!nearest) return false;
    // 본진들의 한가운데 = 그 맵의 한복판. 시작 지점은 맵에 고르게 흩어져 있으므로 이만한
    // 근사가 없고, 무엇보다 이 요약이 이미 들고 있는 값만으로 구해진다.
    const mx = spots.reduce((n, [, h]) => n + h[0], 0) / spots.length;
    const my = spots.reduce((n, [, h]) => n + h[1], 0) / spots.length;
    if (nearest.d >= Math.hypot(ax - mx, ay - my)) return false;
    return (b.who ?? []).includes(nearest.raw);
  };
  const out: string[] = [];
  // out과 나란히 가는 '이 문장은 어느 beat들로 만들어졌나'. 아래 문장을 새로 놓는 자리와
  // 앞 문장에 이어 붙이는 자리가 여러 군데라, 그 두 가지를 함께 처리하는 자리를 하나 둔다.
  const lineBeats: number[][] = [];
  /** 문장을 새로 놓거나(joined=false) 앞 문장을 바꿔 쓴다(joined=true). */
  const put = (line: string, joined: boolean, beatIdx: number): void => {
    if (joined && out.length > 0) {
      out[out.length - 1] = line;
      lineBeats[lineBeats.length - 1].push(beatIndex[beatIdx] ?? beatIdx);
    } else {
      out.push(line);
      lineBeats.push([beatIndex[beatIdx] ?? beatIdx]);
    }
  };
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
    // 앞 문장이 쓴 이음말 — link()가 이번 문장 것으로 덮어쓰기 전에 붙잡아 둔다.
    // 아래 alsoLead가 같은 말을 또 고르지 않게 하는 데 쓴다(지적: '반대로'가 연속).
    const linkBefore = lastLink;
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
    /** 후보에서 못 쓰는 말을 걷어낸다 — 다 걷히면 원래 후보를 그대로 둔다(틀린 말을
     *  피하려다 이음말 자체가 사라지는 것보다는 낫다). */
    const without = (opts: string[], bad: (o: string) => boolean): string[] =>
      (opts.filter((o) => !bad(o)).length > 0 ? opts.filter((o) => !bad(o)) : opts);
    const link = (rawOpts: string[]): string => {
      // 일대일에는 '다른 쪽'이 없다(지적) — 판이 여러 곳에서 동시에 벌어진다는 말은 둘이
      // 붙은 경기에서 쓸 수 없다. 후보에서 통째로 뺀다(다 빠지면 원래대로 둔다).
      let opts = duel ? without(rawOpts, (o) => TEAM_ONLY_LINKS.has(o)) : rawOpts;
      // 주어가 앞 문장과 같은 사람이면 '견주는' 말은 쓸 수 없다(지적: 같은 사람인데 "반면"이
      // 붙는다) — 제 자신과 대비하는 문장이 된다. COMPARATIVE_LINKS 주석 참고.
      if (sharesWho) opts = without(opts, (o) => COMPARATIVE_LINKS.has(o));
      // 무너짐·GG·이사 같은 큰 사건은 '한편'으로 곁들일 일이 아니다(지적). 가벼운 말밖에
      // 남지 않으면 결말을 향하는 말로 갈아 끼운다.
      if (HEAVY_BEATS.has(b.k)) {
        opts = opts.some((o) => !WEAK_LINKS.has(o))
          ? opts.filter((o) => !WEAK_LINKS.has(o))
          : HEAVY_LINKS;
      }
      // 같은 '결'의 이음말이 잇달아 나오면 겉돈다(지적: 접속사 남발) — "하지만 … 그러나"도,
      // "6분 후 … 9분 뒤"도 읽는 사람에겐 같은 말이 두 번 나온 것으로 들린다. 낱말이
      // 아니라 결(역접/시간/그 밖)로 묶어 앞에서 쓴 결을 피한다.
      const bad = linkFamily(lastLink);
      const pool = opts.filter((o) => linkFamily(o) !== bad);
      // 후보가 전부 같은 결이면(반전 자리처럼 역접 말고는 쓸 게 없는 경우) 결을 피할 수는
      // 없다 — 그때라도 바로 앞과 같은 낱말만은 피한다.
      const use = pool.length > 0 ? pool : opts;
      let t = use[seed % use.length];
      if (t === lastLink && use.length > 1) t = use[(seed + 1) % use.length];
      lastLink = t;
      return t;
    };
    const gapSec = prev && typeof prev.at === "number" && typeof b.at === "number"
      ? Math.abs(prev.at - b.at) * SECONDS_PER_FRAME
      : null;
    /* 두 일을 '같은 때'로 볼 창 — 시간대마다 다르다(요청: 초반엔 자잘하게, 후반엔 크게.
       replaySummaryData의 scenePace 주석에 실측이 있다). 초반에는 다음 장면이 30~40초
       만에 또 오므로 60초 창이 서로 다른 일을 한 문장에 묶고, 후반에는 몇 분씩 비어 있어
       한 장면이 여러 문장으로 쪼개진다. */
    const joinMax = sceneWindowSec(JOIN_MAX_SEC, b.at);
    const sameTimeMax = sceneWindowSec(SAME_TIME_SEC, b.at);
    const linkable = !!prev && b.k !== "result" && prev.k !== "result";
    // 이 문장과 앞 문장이 각각 어느 편으로 기운 국면인가(요청: 전황이 굉장히 중요하다).
    // 0은 어느 쪽도 아니라는 뜻이라, 그런 문장 앞뒤는 반전으로 잇지 않는다.
    const tide = tideOf(b);
    const prevTide = prev ? tideOf(prev) : 0;
    // 맺음말은 앞 문장에 이어 붙이는 편이 자연스럽다(요청: "…했고 결국 이겼다",
    // "…했지만 결국 이겼다"). 앞 전황이 진 편 쪽이면 '-지만'으로 뒤집으며 받고, 같은
    // 편 쪽이면 '-고'로 그대로 받는다. 앞 문장이 이미 이어 주는 어미를 품고 있으면
    // 접속이 두 번 겹치므로 그때만 끊는다.
    // 맺음말은 앞 문장에 붙이지 않는다(요청: 결론 문장은 무조건 나눠서 스냅으로 나오게).
    // 예전에는 "…했고 결국 이겼다"처럼 이어 붙이는 편이 자연스러워 그렇게 뒀는데, 그러면
    // 맺음말이 앞 장면과 같은 스냅에 묶여 미니맵에서도 그 장면 화살표와 함께 지나가 버린다.
    // 끊어 두면 아래에서 "결국/그대로/하지만" 머리말이 붙어 문장 자체는 그대로 이어 읽힌다.
    const endJoinCandidate = false;
    void toAnd;
    void toBut;
    void prevLine;
    // 앞 문장과 이번 문장의 주체가 서로 다른 팀인가 — 팀 표시와 '도' 붙이기, 그리고
    // 반전으로 이을지 말지에 함께 쓴다.
    const myTeam = teamOf?.(names[0] ?? "");
    const prevTeam = teamOf?.(((prev?.who ?? []).map(resolveName))[0] ?? "");
    const crossTeam = !!myTeam && !!prevTeam && myTeam !== prevTeam;
    const sameTeam = !!myTeam && !!prevTeam && myTeam === prevTeam;
    // 전황이 실제로 반대편으로 넘어갔나 / 같은 편으로 이어지나.
    //
    // 주인공이 같은 편인데 전황만 갈렸다면, 진짜 반전은 '제 수가 역풍을 맞은' 문장
    // (rush-backfire·greedy-punished 등)이 끼었을 때뿐이다. 그게 아니면 반전이 아닌데도
    // "하지만"이 붙어 같은 편끼리 대립하는 것처럼 읽힌다(지적).
    const backfire = AGAINST_ACTOR.has(b.k) || (!!prev && AGAINST_ACTOR.has(prev.k));
    const flipped = tide !== 0 && prevTide !== 0 && tide !== prevTide
      && !(sameTeam && !backfire);
    // 두 일이 한 문장에 들어갈 만큼 가까운 때에 일어났나 — 시간이 벌어졌으면 무슨 관계든
    // 문장을 나눈다(지적). 시점을 모르는 문장(맺음말 등)은 이 조건에서 뺀다.
    // 시점을 모르는 문장(경기 전체를 두고 하는 말 — 총 생산량 등)은 앞말에 붙여도
    // 시간이 어긋날 일이 없으므로 '가까운 것'으로 친다.
    const closeEnough = gapSec === null || gapSec <= joinMax;
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
    /** 앞 문장에 이번 문장을 이어 붙일 수 있나 — 앞 문장이 이미 이음말로 시작하거나
     *  제 안에 이어 주는 어미를 품고 있으면 안 된다(접속이 두 번 겹친다). */
    const canJoin = (): boolean => {
      const line = out.length > 0 ? out[out.length - 1] : "";
      if (line === "" || chainCount !== 0) return false;
      /* 결말 장면(막아 냄·역공)은 다른 문장과 한 스냅으로 합치지 않는다(요청: 방어에
         성공하고 그 후 역공하는 스냅까지 있어야 한다) — 합쳐 버리면 요청한 두 장면이
         자막 한 줄이 되고 미니맵도 두 그림을 겹쳐 그린다. 이음말은 그대로 붙는다. */
      if (NO_JOIN_KEYS.has(b.k) || (prev ? NO_JOIN_KEYS.has(prev.k) : false)) return false;
      // 시간이 벌어진 두 일은 무슨 관계든 각자 제 스냅을 갖는다(요청).
      if (!closeEnough) return false;
      if (new RegExp(`^${LINK_HEAD()} `).test(line)) return false;
      return !/지만|으나|다가/.test(line);
    };
    /** 앞 문장을 '-지만'으로 바꿔 이번 문장을 이어 붙일 수 있나. */
    const canFlipJoin = (): boolean => canJoin() && !!toBut(out[out.length - 1]);
    /** 대등한 두 이야기를 '-고'로 이어 붙일 수 있나(요청) — 앞 문장이 그 사람을 주어로
     *  세우고 시작해야 뒷마디가 제자리를 찾는다. */
    const canAndJoin = (): boolean =>
      canJoin() && !!toAnd(out[out.length - 1]) && prevLedBy(lastBaseWho);
    // 거의 같은 때에 벌어진 서로 다른 사람의 일은 한 문장으로 잇는 편이 자연스럽다
    // (요청: "브래드는 ~했고 정구는 ~했음"). 같은 사람 이야기면 주어가 겹쳐 어색해 뺀다.
    const sharesWho = (b.who ?? []).some((w) => (prev?.who ?? []).includes(w));
    let joinPrev = false;
    // 전황이 뒤집히는 자리를 한 문장으로 이을 것인가(아래 참고).
    let flipJoin = false;
    // 앞 문장에서 맞은 쪽이 이번엔 때리는 쪽인가 — 같은 두 사람이 주고받은 이야기다.
    const headToHead =
      (b.who ?? []).some((w) => (prev?.whom ?? []).includes(w))
      || (b.whom ?? []).some((w) => (prev?.who ?? []).includes(w));
    // 같은 사람이 주인공인 이야기가 잇달아 나오면 문장을 나누지 말고 한 문장으로 잇는다
    // (요청: 세 문장까지는 합치기). 이음말을 앞에 붙이면 문장이 그 말로 시작해 이어 붙일
    // 수 없으므로, 이을 참이면 이음말 고르기 자체를 건너뛴다 — 아래 sameSubject가 받는다.
    const subjectRun =
      linkable && sharesWho && !flipped && closeEnough && chainCount < MAX_CHAIN
      && lastSubject === subject && prevLedBy(lastBaseWho) && !!toAnd(prevLine);
    if (subjectRun) {
      // 아무것도 붙이지 않는다.
    /* (삭제) "그 기세로 / 여세를 몰아 / 그 기세를 이어간" — 크게 한 방 먹인 바로 다음에
       같은 사람이 또 무언가를 한 자리에 달던 말. 이것도 앞뒤를 잇는 군더더기라 함께
       걷어냈다(요청). 22판에서 딱 한 번 걸렸는데 그 한 번이 하필 주어가 문장 가운데
       오는 틀이라 "[Jeong9]의 오버로드가 그 기세를 이어간 Taschen_Ever의 발키리에…"로
       엉뚱한 자리에 붙었다. */
    } else if (linkable && gapSec !== null && gapSec <= sameTimeMax) {
      // 주어가 다른데도 절반 확률로 이어 붙이던 자리를 껐다(요청: 최대한 나눠서 스냅으로) —
      // 서로 다른 사람의 서로 다른 장면이 한 스냅에 묶이면 미니맵 화살표도 겹쳐 그려진다.
      if (flipped) {
        // 맞불(양쪽이 똑같은 짓)은 반전이 아니다 — mirrored 주석 참고.
        // 반전은 "…했지만 …했다"로 바로 잇는다(지적). 못 이으면 그냥 끊는다 — 앞에
        // 다는 역접 이음말은 이제 안 쓴다(요청).
        if (canFlipJoin()) flipJoin = true;
      } else if (sameTide) {
        // 대등한 두 이야기는 "…했고 …했다"로 바로 잇는다(요청). 못 이을 때만 동시성을
        // 짚는 말을 앞에 단다.
        if (canAndJoin()) joinPrev = true;
      }
    // 째기(greedy-build) 다음은 늘 나란히 잇는다 — 째기는 공격이 아니라 준비이고 한동안
    // 이어지는 상태라, 그 뒤에 상대의 수가 와도 반전이 아니다(지적: "째기는 공격은 아니라
    // 하지만이 붙는게 어색해"). 위 SAME_TIME_SEC(45초)로는 못 잡는다 — 실제 리플레이에서
    // 째기와 상대의 11드론 러시가 2분 남짓 떨어져 있었다. 못 이을 때만 동시성을 짚는 말로 받는다.
    } else if (linkable && prev!.k === "greedy-build" && closeEnough) {
      if (canAndJoin()) joinPrev = true;
    // 시간이 많이 벌어진 자리는 반드시 짚는다 — 안 짚으면 바로 이어진 일로 읽힌다(요청).
    } else if (
      // 같은 편이 몰아치는 내용이 이어지면 문장을 나누지 말고 "…했고 …했다"로 잇는다(요청)
      // — 사람이 달라도 같은 흐름이라 한 호흡으로 읽히는 편이 낫다. 시점을 모르는 문장
      // (경기 전체를 두고 하는 말)도 여기에 들어온다.
      // 전황이 갈리지 않았고 같은 편 이야기면 잇는다 — 총 생산량처럼 어느 순간을 짚지
      // 않는 문장(tide 0)도 같은 편의 우세를 말하는 것이라 여기에 들어온다.
      // 예전에는 같은 편 이야기가 이어지면(또는 절반 확률로) 한 문장으로 묶었다. 이제는
      // 같은 사람의 이야기일 때만 잇는다(요청: 이어 붙이기 최소화) — 사람이 다르면 장면도
      // 다른 자리에서 벌어진 일이라 미니맵이 두 장면을 한 번에 그려야 했다.
      linkable && !flipped && !crossTeam && !!prev!.won === !!b.won
      && sharesWho && closeEnough && sameTide && canAndJoin()
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
      }
    }
    /* (삭제) 리듬 보정 — 이음말이 잇달으면 덜어 내고, 밋밋하게 두 문장이 지나가면 한
       마디 채워 넣던 규칙. 문장 앞에 다는 이음말 자체를 안 쓰기로 해서(요청) 조절할
       대상이 없어졌다. */
    let lead = "";
    if (mutual) lead = "서로 ";
    else if (both) {
      // 개인전에는 '팀'이 없다(요청) — "양 팀의"를 빼고 '둘 다'로 말한다.
      if (seed % 2 === 0 && !duel) who = `양 팀의 ${who}`;
      else lead = duel ? "둘 다 " : "모두 ";
    }
    if (!who) continue;
    const render = (offset: number): string | null => {
      let firstPick = true;
      return tpl({
        k: b.k,
        who,
        whoList: (b.who ?? []).map(resolveName).filter(Boolean),
        who2: joinNames((b.who2 ?? []).map(resolveName)),
        whom: joinNames((b.whom ?? []).map(resolveName)),
        by: typeof b.p?.by === "string" ? resolveName(b.p.by) : "",
        foe: typeof b.p?.foe === "string" ? resolveName(b.p.foe) : "",
        won: !!b.won,
        at: typeof b.at === "number" ? b.at : null,
        end: typeof data.end === "number" && data.end > 0 ? data.end : null,
        lastLost: i === lastLostIdx,
        duel,
        // 0 = 팀 번호를 쓰지 않는다(위 teamTagFor 참고) — teamPhrase가 팀 번호 대신
        // 이름을 늘어놓는 쪽으로 물러선다.
        team: 0,
        p: b.p ?? {},
        names: (v) => list(v).map(resolveName).filter(Boolean),
        teamOfName: (name) => teamOf?.(name),
        atHome: atHomeOf(b),
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
    /* 승패 한 줄은 언제나 홀로 선다(요청: 시작 스냅처럼 고정) — 이음말도 안 붙이고, 앞
       문장에 이어 붙이지도 않는다. 스냅 하나가 통째로 "누가 이겼나"만 말하는 자리다. */
    if (b.k === "verdict") { put(text, false, i); continue; }
    // "서로"·"모두"는 주어 뒤에 와야 한다 — 틀이 주어를 문장 안에서 만드는 꼴(“정구와
    // 크리스의 3게이트 질럿 러시 한 방에 …”)에서는 이 말이 맨 앞으로 밀려 나와 어색하다
    // (지적: 서로는 없어야 됨). 문장 첫머리에 붙었으면 그냥 뗀다.
    if (lead && text.startsWith(lead)) text = text.slice(lead.length);
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
    // 맺음말 자신이 이미 이어 주는 어미를 품고 있으면(역전패를 진 편 입장에서 말하는
    // "…잡았지만 …GG" 같은 꼴) 앞 문장에 또 잇지도, 이음말을 앞에 달지도 않는다.
    const endSelfLinked = /지만|으나|다가/.test(text);
    const endJoin = endJoinCandidate && !/고, |으며, /.test(text) && !endSelfLinked;
    if (b.k === "result" && prev && !endSelfLinked && !/결국|그대로|하지만|그러나/.test(text)) {
      // 이어 붙일 참이면 '-지만'이 이미 반전을 짚으므로, 머리말은 "결국/그대로"로 받는다.
      if (prevTide < 0 && !alreadyConceded && !endJoin) {
        // 앞 전황과 반대로 끝나는 결말에는 반드시 반전을 짚는다(지적) — 시간 머리말이
        // 붙어 있어도 그 앞에 놓는다("하지만 32분 혈투 끝에 …").
        text = `${link(["하지만", "그러나"])} ${text}`;
      } else if (!/^단 /.test(text)) {
        // 흐름을 그대로 받아 끝나는 자리는 반드시 짚는다(지적) — 안 짚으면 앞 문장과
        // 맺음말이 무관한 두 사실처럼 뚝 끊겨 읽힌다. 다만 "그대로 45분 혈투 끝에"는
        // 어색하니, 시간 머리말이 붙은 맺음말은 "결국"으로만 받는다.
        text = `${/^\d/.test(text) ? "결국" : link(["결국", "그대로"])} ${text}`;
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
    /* 두 마디를 한 문장으로 이으면 그만큼 길어진다 — 앞뒤가 저마다 마흔 자면 이은 문장은
       여든 자다(실측: "…일꾼을 먼저 채우다 …공격에 노출됐고 …는 병력을 너무 늦추다 …그대로
       무너졌다"). 자리가 남을 때만 잇는다: 넘치면 그냥 두 문장으로 놓아도 뜻은 그대로고,
       스냅도 둘로 갈려 그림이 오히려 또렷해진다. */
    const roomToJoin = prevLine.length + text.length <= MAX_LINE;
    const chained: string | null = !roomToJoin ? null : sameSubject
      // 이어 붙일 마디가 이미 '-고'를 품고 있으면(맺음말+활약 한 마디처럼) 앞마디는
      // '-으며'로 바꾼다 — 안 그러면 한 문장에 "…고, …고,"가 연달아 나온다(지적).
      ? (afterCause ?? (chainCount === 0 && !/고, /.test(text) ? toAnd(prevLine) : toAlso(prevLine)))
      : endHead ? endHead
      : flipJoin
        ? toBut(prevLine)
        : joinPrev && out.length > 0 && chainCount === 0 && prevLedBy(lastBaseWho)
          // 전황이 갈린 두 일을 '-고'로 이으면 나란히 일어난 것처럼 읽힌다(지적) —
          // 반대되는 정황은 '-지만'으로 이어야 대비가 산다.
          ? (flipped ? toBut(toTopic(prevLine, lastBaseWho)) : toAnd(toTopic(prevLine, lastBaseWho)))
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
      // 여기서 잇는 것도 문장을 길게 만드는 선택이다 — 위 roomToJoin과 같은 선을 본다.
      const head = !roomToJoin ? null
        : reversal
          ? (toBut(prevLine) ? `${toBut(prevLine)} 반대로` : null)
          // 여기는 하던 일이 상대의 수에 끊긴 자리다 — '-다가'가 맞는 몇 안 되는 자리라
          // (지적) 그대로 쓴다. 아껴 쓰는 것은 tightCause로 자리를 좁혀서 한다.
          : tightCause ? toWhile(prevLine) : null;
      // 앞마디가 이미 '-다가'로 이어 주므로 뒤 문장 머리의 이음말은 뗀다(지적:
      // "…실패하다가 게다가 …"처럼 접속사가 두 번 나온다).
      const tail = text
        .replace(new RegExp(`^${LINK_HEAD()} `), "")
        .replace(`${ga(victimName)} `, "");
      if (head) {
        put(`${head} ${tail}`, true, i);
        // 이 앞마디가 "…했지만 반대로"였으면 그 말을 방금 쓴 것으로 남긴다 — 안 남기면
        // 다음 문장이 또 '반대로'를 골라 "…반대로 …했다. 반대로 …"가 된다(지적).
        if (reversal) lastLink = "반대로";
      } else put(text, false, i);
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
      // 앞 문장과 주어가 같으면 이름을 두 번 부르지 않는다(지적: "A는 …했고 A는 …했다").
      // 조사는 문장마다 달라질 수 있어(가/이/는/은) 이름만 보고 뗀다. 개인전이 아닌 both
      // 문장은 이름 앞에 "양 팀의 "가 붙어 있을 수 있어(위 who 조립부 참고) 그 자리도
      // 함께 걷어낸다 — 안 그러면 그 앞머리만 못 지워 "…했고, 양 팀의 A가 …"처럼 주어가
      // 중복으로 남는다(지적: 반복되는 주어를 생략 안 하는 오류가 가끔 있다).
      if (baseWho !== "" && lastBaseWho === baseWho) {
        text = text.replace(new RegExp(`^(?:양 팀의 )?${escapeRe(baseWho)}(?:가|이|는|은) `), "");
      }
    }
    // 전황이 뒤집히면서 주체까지 다른 팀이면 "…했지만 제롬도 …했다"가 자연스럽다(요청).
    // 맺음말에는 '도'를 붙이지 않는다 — 결말은 곁들이는 말이 아니다.
    const alsoSubject = flipped && crossTeam && b.k !== "result";
    // 팀이 갈린 반전에는 앞말을 받는 연결어를 한마디 넣어도 좋다(요청).
    // 일대일에는 '다른 쪽'이 없다(지적) — 그 자리는 대신 '반대로'가 받는다.
    const alsoLeadPool = alsoSubject && b.k !== "result"
      ? (headToHead
        ? ["", "반대로 ", "역으로 "]
        : ["", "이에 질세라 ", duel ? "반대로 " : "다른 쪽에서는 "])
      : [];
    let alsoLead = alsoLeadPool.length > 0 ? alsoLeadPool[seed % alsoLeadPool.length] : "";
    // 앞 문장이 쓴 말을 또 쓰면 "…반대로 …했다. 반대로 …"가 된다(지적) — 한 칸 민다.
    // 이 자리는 link()를 거치지 않아 그 안의 중복 회피가 안 걸린다.
    if (alsoLead.trim() && alsoLead.trim() === linkBefore) {
      alsoLead = alsoLeadPool[(seed + 1) % alsoLeadPool.length];
    }
    // 고른 말도 '방금 쓴 이음말'로 남겨야 다음 문장이 피해 간다.
    if (CONTRAST_LINKS.has(alsoLead.trim())) lastLink = alsoLead.trim();
    // "…늘린 뒤"는 그 자체가 이어 주는 말이라 쉼표를 두지 않는다.
    if (chained && sameSubject) {
      const body = text.slice(subject.length + 1);
      put(afterCause ? `${chained} ${body}` : `${chained}, ${body}`, true, i);
    }
    else if (chained && (endHead || flipJoin)) {
      put(`${chained} ${alsoLead}${alsoSubject ? toAlsoSubject(text, baseWho) : text}`, true, i);
    } else if (chained) {
      put(`${chained} ${alsoLead}${alsoSubject ? toAlsoSubject(text, baseWho) : toTopic(text, baseWho)}`, true, i);
    }
    else put(text, false, i);
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
  // 붙어 있는 두 문장이 같은 이음말을 쓰면 겉돈다(지적: "…했지만 반대로 …했다. 반대로
  // …팀의 누구는"). 이음말이 붙는 자리가 여러 군데라(link()를 안 거치는 곳도 있다) 마지막에
  // 한 번 더 훑어, 뒤 문장의 머리말만 같은 결의 다른 말로 바꾼다 — 통째로 빼면 반전이
  // 지워질 수 있어 바꾸기만 한다. 시간을 짚는 말("3분 뒤", "소강상태 후")은 뜻이 곧 사실이라
  // 손대지 않는다.
  const HEAD_RE = new RegExp(`^(${LINK}) `);
  for (let i = 1; i < out.length; i += 1) {
    const m = HEAD_RE.exec(out[i]);
    if (!m) continue;
    const head = m[1];
    if (!out[i - 1].includes(head)) continue;
    const alts = ADVERSATIVE_ALTS.includes(head) ? ADVERSATIVE_ALTS
      : ADDITIVE_ALTS.includes(head) ? ADDITIVE_ALTS
        : null;
    if (!alts) continue;
    const alt = alts.find((w) => w !== head && !out[i - 1].includes(w));
    if (alt) out[i] = out[i].replace(HEAD_RE, `${alt} `);
  }
  /* '견주는' 이음말(반면·반대로·역으로·이에 질세라)은 서로 다른 두 사람을 나란히 놓고
     견줄 때만 맞는 말이다(지적: 같은 사람 이야기가 이어지는데 "반면"이 붙는다 —
     "Sohee_Min이 러시를 했다 / 반면 … Sohee_Min이 타격을 입었다"). 그런데 문장의 주어가
     누구인지는 beat의 who로 알 수 없다: 피해 문장은 당한 사람(whom)을 앞에 세우기 때문이다.
     그래서 다 만들어진 문장에서 맨 먼저 나오는 이름을 직접 읽어 견준다. 같은 사람이면
     곧이곧대로 뒤집는 말로 갈아 끼운다(반전 자체는 지우지 않는다). */
  const allNames = [...new Set(
    beats
      .flatMap((b) => [
        ...(b.who ?? []), ...(b.who2 ?? []), ...(b.whom ?? []),
        ...(typeof b.p?.by === "string" ? [b.p.by] : []),
        ...(typeof b.p?.foe === "string" ? [b.p.foe] : []),
        /* 큰 싸움에 이름이 불린 참가자들(지적: 군범에 팀 색이 안 입혀진다) — 이 사람들은
           who/whom에는 없고 partsA·partsB에만 있어서, 문장에는 이름이 나오는데 색을 입힐
           목록에는 빠져 있었다. 그래서 같은 문장 안에서 크리스는 색이 있고 군범은 없었다. */
        ...(Array.isArray(b.p?.partsA) ? (b.p.partsA as unknown[]).filter((x): x is string => typeof x === "string") : []),
        ...(Array.isArray(b.p?.partsB) ? (b.p.partsB as unknown[]).filter((x): x is string => typeof x === "string") : []),
      ])
      .map(resolveName)
      .filter(Boolean),
  )];
  const leadName = (line: string): string => {
    let best = "";
    let at = Infinity;
    for (const n of allNames) {
      const i = line.indexOf(n);
      // 같은 자리에서 시작하면 긴 이름이 이긴다("정구"와 "정구2").
      if (i >= 0 && (i < at || (i === at && n.length > best.length))) { at = i; best = n; }
    }
    return best;
  };
  for (let i = 1; i < out.length; i += 1) {
    const m = HEAD_RE.exec(out[i]);
    if (!m || !COMPARATIVE_LINKS.has(m[1])) continue;
    const lead = leadName(out[i]);
    if (!lead || lead !== leadName(out[i - 1])) continue;
    const alt = ADVERSATIVE_ALTS
      .find((w) => !COMPARATIVE_LINKS.has(w) && !out[i - 1].includes(w)) ?? "하지만";
    out[i] = out[i].replace(HEAD_RE, `${alt} `);
  }
  if (out.length === 0) return null;
  const lines = out.map((l) => toPlain(l.replace(afterWhile, "$1 ").replace(twoLinks, "$1 $2")));
  return { lines, lineBeats };
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
  const sentences = renderReplaySummarySentences(data, resolveName, teamOf);
  if (!sentences) return null;
  // 문단으로 이어 붙일 때 문장 사이는 ". " — 문장 단위로 자르기 전과 글자가 똑같아야 한다.
  return sentences.flatMap((s, i) => (i === 0 ? s.parts : [{ text: ". " }, ...s.parts]));
}

/** 요약 문장 하나 — 타임라인의 스냅 하나에 대응한다(요청: 요약 문장 하나당 스냅 하나). */
export interface ReplaySummarySentence {
  /** 팀 색이 입혀진 조각들(위 SummaryPart). */
  parts: SummaryPart[];
  /** 이 문장에 담긴 beat 첨자들 — 한 문장에 여럿이 들어가는 일이 흔하다. */
  beats: number[];
  /** 이 문장이 말하는 시점(프레임) — 담긴 beat 중 가장 이른 것. 시점을 모르는 문장
   *  (경기 전체를 두고 하는 말·맺음말)은 null이고, 그때 스냅은 타임라인의 끝에 놓인다. */
  at: number | null;
}

/**
 * 요약을 문장 단위로 만든다 — 문장마다 팀 색 조각과 그 문장을 만든 beat들이 함께 온다.
 * 미니맵 타임라인이 이걸 쓴다: 스냅을 고르면 그 문장에 하이라이트가 가고, 그 문장의
 * beat들이 가리키는 사람·자리가 미니맵에 뜬다.
 */
export function renderReplaySummarySentences(
  data: ReplaySummaryData | unknown,
  resolveName: (rawName: string) => string,
  teamOf: (name: string) => 1 | 2 | undefined,
): ReplaySummarySentence[] | null {
  const r = renderLines(data, resolveName, teamOf);
  if (!r) return null;
  const beats = isReplaySummaryData(data) ? data.beats : [];
  // 긴 이름부터 찾는다 — 짧은 이름이 긴 이름의 일부인 경우("정구"와 "정구2")를 위해서다.
  const names = [...new Set(
    beats
      // p.by(이사·궤멸을 만든 사람)·p.foe(진 편을 넘어선 사람)도 문장에 이름으로 나오므로
      // 같이 색을 입힌다.
      .flatMap((b) => [
        ...(b.who ?? []), ...(b.who2 ?? []), ...(b.whom ?? []),
        ...(typeof b.p?.by === "string" ? [b.p.by] : []),
        ...(typeof b.p?.foe === "string" ? [b.p.foe] : []),
      ])
      .map(resolveName)
      .filter(Boolean),
  )].sort((a, b) => b.length - a.length);

  return r.lines.map((line, i) => {
    const idx = r.lineBeats[i] ?? [];
    const ats = idx
      .map((n) => beats[n]?.at)
      .filter((v): v is number => typeof v === "number");
    return {
      parts: splitNames(line, names, teamOf),
      beats: idx,
      at: ats.length > 0 ? Math.min(...ats) : null,
    };
  });
}

/** 문장을 이름 조각과 나머지로 자른다 — 이름에 팀 색을 입히기 위한 것이다. */
function splitNames(
  text: string, names: string[], teamOf: (name: string) => 1 | 2 | undefined,
): SummaryPart[] {
  const parts: SummaryPart[] = [];
  let buf = "";
  const flush = () => { if (buf) { parts.push({ text: buf }); buf = ""; } };
  for (let i = 0; i < text.length; ) {
    const hit = names.find((n) => text.startsWith(n, i));
    const team = hit ? teamOf(hit) : undefined;
    if (hit && team) {
      flush();
      parts.push({ text: hit, team });
      i += hit.length;
      continue;
    }
    // (삭제) 예전엔 "1팀 / 2팀"이라는 말에도 팀 색을 입혔다 — 이제 그 말 자체를 문장에
    // 쓰지 않으므로(위 teamTagFor) 색을 입힐 자리가 없다.
    buf += text[i];
    i += 1;
  }
  flush();
  return parts;
}
