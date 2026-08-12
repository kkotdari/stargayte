// 그 판에서 '무엇을 지었고 무엇을 뽑았고 무엇을 썼나'(요청: 통계의 건설·유닛·스킬 칸).
//
// 총량 하나(buildCount)로는 "많이 했다"까지밖에 못 말한다. 같은 300이라도 방어탑만 올린
// 판과 병력만 뽑은 판은 전혀 다른 경기고, 기본 유닛만 굴린 사람과 마법 유닛까지 간 사람도
// 다르다. 그래서 그 총량을 갈래별로 나눠, 그리고 이름별 원장(건물·유닛·스킬)과 공/방 단계까지
// 함께 저장한다 — 보는 쪽은 비율을 그리고 많이 나온 다섯을 세기만 하면 된다.
//
// 세는 단위는 buildCount와 같은 '커맨드'다(replayParser의 buildCount 주석 참고). 저그 라바
// 여러 마리를 한 번에 변태시키면 커맨드가 하나라 실제 수보다 적게 세지는 한계도 그대로다 —
// 어차피 비율로 읽는 값이라 갈래마다 같은 자로 재는 것이 중요하지, 절대 수가 중요하지 않다.

import type { ReplayPlayerSignals } from "./replayParser";
import { BUILDING_KO, TECH_KO, UNIT_KO } from "./replaySummaryText";
import { upgradeLevel, type UpgradeName } from "./replayTechNames";

/** 초당 프레임(다른 파일들과 같은 값) — 초반 일꾼 수를 셀 때만 쓴다. */
const SECONDS_PER_FRAME = 0.042;
/** '초반 일꾼'을 세는 선(초) — 요청: 초반 5분까지의 일꾼 생산 수. */
export const WORKER_EARLY_SEC = 5 * 60;

/** 막는 건물 — 나머지 건물은 전부 '생산'으로 본다(요청: 건물 빌드 비율은 생산/방어).
 *  크립 콜로니는 성큰·스포어가 되기 전 단계라 방어로 센다. */
export const DEFENSE_BUILDINGS = new Set([
  "Bunker", "Missile Turret",
  "Photon Cannon", "Shield Battery",
  "Creep Colony", "Sunken Colony", "Spore Colony",
]);

const WORKER_UNITS = new Set(["SCV", "Probe", "Drone"]);
/** 병력으로 세지 않는 것들 — 일꾼·보급·알·소모품. 비율을 흐리기만 한다. */
export const NOT_ARMY = new Set([
  ...WORKER_UNITS, "Larva", "Egg", "Overlord", "Cocoon", "Mutalisk Cocoon", "Lurker Egg",
  "Interceptor", "Scarab", "Spider Mine", "Scanner Sweep", "Nuclear Missile",
]);

/** 마법 유닛 — 에너지를 쓰는 것이 그 유닛의 존재 이유인 것들. 메딕·고스트는 여기 안 넣는다:
 *  메딕은 바이오닉의 한 부분이고 고스트는 사실상 핵·락다운용이라 수가 아주 적어, 넣으면
 *  '마법 비중'이 그 사람의 운영이 아니라 종족을 말하는 값이 된다. */
export const CASTER_UNITS = new Set([
  "High Templar", "Dark Archon", "Arbiter", "Science Vessel", "Defiler", "Queen",
]);
/** 기본 유닛 — 첫 생산 건물에서 바로 나오는 것들. 나머지 전투 유닛은 전부 '고급'이다
 *  (테크 건물이나 추가 건물을 하나 더 거쳐야 나오는 것들). */
const BASIC_UNITS = new Set([
  "Marine", "Firebat", "Medic", "Vulture",
  "Zealot", "Dragoon",
  "Zergling", "Hydralisk",
]);
/** 하늘에 뜨는 것 — 오버로드는 위 NOT_ARMY에서 이미 빠진다. */
export const AIR_UNITS = new Set([
  "Wraith", "Dropship", "Science Vessel", "Valkyrie", "Battlecruiser",
  "Shuttle", "Observer", "Scout", "Corsair", "Carrier", "Arbiter",
  "Mutalisk", "Guardian", "Devourer", "Scourge", "Queen",
]);

/** 한 사람의 그 경기 생산 구성. 값은 전부 커맨드 수이고, 보는 쪽은 비율로 읽는다. */
export interface BuildMix {
  /** 건물 — 생산(테크·확장 포함) / 방어. */
  bProd: number;
  bDef: number;
  /** 병력 — 기본 / 고급 / 마법. */
  uBasic: number;
  uAdv: number;
  uCaster: number;
  /** 병력 — 지상 / 공중. */
  uGround: number;
  uAir: number;
  /** 초반(WORKER_EARLY_SEC)까지 뽑은 일꾼 수 — 비율이 아니라 그냥 수다(요청). */
  worker5: number;
  /** 전투(교전) 원장 — 갈래별 [붙은 수/이긴 수]다(요청: 그 전투 하나하나에서 이겼냐).
   *  판정은 replayBattles가 게임 단위로 하고(사람 혼자서는 못 가른다 — 상대 명령이 필요
   *  하다) 파서가 여기 실어 준다. 좌표를 못 읽은 판·옛 기록에는 없다(재분석이 채운다). */
  btGround?: number;
  btGroundWon?: number;
  btAir?: number;
  btAirWon?: number;
  btMagic?: number;
  btMagicWon?: number;
  /** 공/방/실드 업그레이드가 몇 단계까지 올라갔나(0~3). 종족마다 이름이 다르지만 부르는
   *  이름은 '지상/공중'과 '공/방' 넷이라, 종족 이름을 지우고 그 넷으로만 담는다(요청:
   *  종족 무관). 테란처럼 지상이 보병·메카닉 둘로 갈리는 종족은 높은 쪽을 그 판의 지상
   *  단계로 본다 — '얼마나 올렸나'를 말하는 값이라 낮은 쪽에 끌려 내려가면 뜻이 어긋난다.
   *  실드는 프로토스에만 있어 나머지 종족은 늘 0이다. */
  upGw: number;
  upGa: number;
  upAw: number;
  upAa: number;
  upSh: number;
  /** 업그레이드 줄별 단계(0~3) — 그 판에서 고른 종족의 줄만 담는다(아래 UP_BY_RACE).
   *
   *  위 다섯 자리(upGw…)는 종족을 지운 값이라 뜻이 어긋난다(지적) — 브루드워는 종족마다
   *  줄이 다르다: 테란은 지상이 보병·메카닉 둘로 갈리고 함선 줄이 따로 있으며 실드가
   *  아예 없다. 저그는 지상 공격이 근접·원거리로 갈리지만 방어(갑각)는 하나다. 다섯 자리는
   *  그것들을 max로 뭉개서, 보병 3업 + 메카닉 0업이 그냥 "지상 3"이 됐다.
   *  그래서 줄을 그대로 담는다 — 화면은 고른 종족의 줄만 골라 그린다. */
  ups: Record<string, number>;
  /** 줄마다 '그 줄이 실린 경기 수' — 집계에서만 채워진다(경기 하나짜리 값에는 빈 사전).
   *  줄이 종족마다 달라 분모도 줄마다 따로여야 한다: 하나로 세면 종족이 섞인 기간에 한
   *  줄의 평균이 다른 종족 경기 수만큼 눌린다. */
  upCounts: Record<string, number>;
  /** 건물별 건설 커맨드 수(screp 영문명) — 통계 '건설' 칸의 Top5. 파일런·서플라이는 뺀다
   *  (요청) — 보급을 대는 건물이라 어느 판에서나 압도적 1위가 돼 목록이 늘 같아진다. */
  buildings: Record<string, number>;
  /** 유닛별 생산 커맨드 수(screp 영문명) — 통계 '유닛' 칸이 여기서 Top5를 뽑는다. 일꾼·
   *  보급·알은 빼고, 이름을 아는 유닛(UNIT_KO)만 남긴다 — UMS 맵의 영웅 유닛까지 새어
   *  들어오면 목록이 엉망이 되고, 어차피 한국어 표기를 모르면 보여줄 수도 없다. */
  units: Record<string, number>;
  /** 실제로 '쓴' 마법·기술별 횟수(screp 영문명) — 통계 '스킬' 칸의 Top5. 연구만 하고 안
   *  쓴 기술은 0이라 여기 안 들어온다(signals.techUses가 사용 증거만 센다). */
  skills: Record<string, number>;
  /** 이긴 판에서만 센 마법 원장 — 칭호가 보는 값이다(요청: 기술도 이긴 판만 센다). 통계
   *  화면의 Top5는 위 skills(승패 무관)를 그대로 쓴다. 서버가 기간 합계를 낼 때만 채운다. */
  skillsWon?: Record<string, number>;
  /** 위 세 원장의 '이름별 총 경기시간(초)' — 그 이름이 한 번이라도 나온 경기들의 길이 합.
   *
   *  집계(기간 합계)에서만 채워지고 경기 하나짜리 값에서는 비어 있다 — 서버가 합칠 때
   *  세는 편이 payload도 가볍다.
   *
   *  왜 필요한가: 총합만으로는 "오래 뛰어서 큰 수"와 "한 판에 많이 써서 큰 수"가 구분되지
   *  않는다. 그래서 10분당 값으로 환산해 보여주는데(요청), 전체 경기시간으로 나누면 이번엔
   *  그 기술을 안 쓴 판의 시간까지 분모에 들어가 프로토스만 쓰는 기술의 값이 종족 비율만큼
   *  깎인다 — 그 이름이 실제로 나온 판의 시간만 분모로 쓴다. */
  buildingSecs: Record<string, number>;
  unitSecs: Record<string, number>;
  skillSecs: Record<string, number>;
  /** 이 경기의 '주요시간대' 길이(초) — 아래 두 구간 커맨드 수(coreBuild·coreUnit·coreCmd)를
   *  되돌릴 분모다(요청: 분당 건설수·생산수는 주요시간대 기준).
   *
   *  왜 경기 전체가 아닌가: 초반은 누구나 정해진 빌드를 따라가는 구간이라 사람 사이 차이가
   *  거의 없고, 끝은 이미 기울어 한쪽이 손을 놓은 구간이라 값이 바닥으로 끌려간다. 둘 다
   *  분모에는 들어가면서 분자에는 별로 안 들어와, 오래 끈 판일수록 모든 지표가 낮아졌다.
   *  구간이 CORE_MIN_SEC보다 짧으면(=짧은 경기) 아예 null이라 집계에서 자동으로 빠진다.
   *
   *  분자도 같은 구간 것만 센다 — 한쪽만 좁히면 그게 바로 값이 부푸는 길이다. */
  coreSeconds: number | null;
  /** 그 구간 안의 생산 커맨드 수 — '커맨드' 칸도 같은 자로 재기 위한 값이다. */
  coreCmd: number;
  /* 주요시간대 안에서만 센 건물·유닛 커맨드 수 — 도넛 옆에 적는 "분당 몇 채/몇 기"가 이
     값을 coreSeconds로 나눈 것이다(요청: 분당 지표는 주요시간대가 맞다).
     위 도넛·Top5용 수들과 따로 두는 이유: 그쪽은 경기 전체로 세야 한다(요청) — 마법처럼
     드문 사건은 주요시간대만 보면 대부분 잘려 나가 목록이 비고, 구성비도 초·후반을 뺀
     반쪽 그림이 된다. 반면 '분당 얼마나 찍었나'는 초반의 정해진 빌드와 끝난 뒤 정리 구간이
     끼면 값이 눌리므로 주요시간대라야 한다. 자를 둘로 나눠 각자 맞는 구간을 쓴다. */
  coreBuild: number;
  coreUnit: number;
}

/* ── 주요시간대 ────────────────────────────────────────────────────────────────
   초반 4분과 마지막 1분을 뺀 가운데 구간. 앞을 4분으로 자른 건 브루드워에서 그때까지가
   대체로 '정해진 빌드'라 사람 사이에 차이가 안 생기는 구간이기 때문이고, 뒤를 1분 자른
   건 결과가 이미 정해진 뒤의 정리 구간을 빼기 위해서다.
   남는 구간이 3분 미만이면 값을 안 낸다 — 8분도 안 되는 판에서 '주요시간대'라고 부를 만한
   구간이 없고, 짧은 판이 통계에 끼어드는 문제도 여기서 함께 막힌다(요청: 짧은 경기는
   자동으로 안 들어가겠지). */
const CORE_HEAD_SEC = 240;
const CORE_TAIL_SEC = 60;
const CORE_MIN_SEC = 180;

/** 그 경기의 주요시간대 — 프레임 구간과 길이(초). 낼 수 없으면 null. */
export function coreWindowOf(totalFrames: number | null | undefined):
  { from: number; to: number; seconds: number } | null {
  if (!totalFrames || totalFrames <= 0) return null;
  const from = CORE_HEAD_SEC / SECONDS_PER_FRAME;
  const to = totalFrames - CORE_TAIL_SEC / SECONDS_PER_FRAME;
  const seconds = (to - from) * SECONDS_PER_FRAME;
  return seconds >= CORE_MIN_SEC ? { from, to, seconds: Math.round(seconds) } : null;
}

/** 새 값 하나. 상수를 spread 해서 쓰면 사전들이 같은 객체를 공유하므로 함수로 낸다. */
export function emptyBuildMix(): BuildMix {
  return {
    bProd: 0, bDef: 0, uBasic: 0, uAdv: 0, uCaster: 0, uGround: 0, uAir: 0, worker5: 0,
    upGw: 0, upGa: 0, upAw: 0, upAa: 0, upSh: 0, ups: {}, upCounts: {},
    buildings: {}, units: {}, skills: {},
    buildingSecs: {}, unitSecs: {}, skillSecs: {},
    coreSeconds: null, coreCmd: 0, coreBuild: 0, coreUnit: 0,
  };
}

/* 공/방/실드 — 종족별 이름을 '지상 공격 / 지상 방어 / 공중 공격 / 공중 방어 / 실드'
   다섯 자리로 모은다. 한 자리에 이름이 여럿이면 그중 가장 높이 올라간 것을 쓴다. */
const UP_LINES: Record<"upGw" | "upGa" | "upAw" | "upAa" | "upSh", UpgradeName[]> = {
  upGw: ["Terran Infantry Weapons", "Terran Vehicle Weapons",
         "Zerg Melee Attacks", "Zerg Missile Attacks", "Protoss Ground Weapons"],
  upGa: ["Terran Infantry Armor", "Terran Vehicle Plating", "Zerg Carapace", "Protoss Ground Armor"],
  upAw: ["Terran Ship Weapons", "Zerg Flyer Attacks", "Protoss Air Weapons"],
  upAa: ["Terran Ship Plating", "Zerg Flyer Carapace", "Protoss Air Armor"],
  upSh: ["Protoss Plasma Shields"],
};

/* 종족별 업그레이드 줄 — 키는 저장·조회 내내 그대로 쓰는 짧은 이름이고, 값은 screp의
   업그레이드 이름이다. 한 판에는 그 사람이 고른 종족의 줄만 담긴다(0단계도 담는다 —
   "안 올렸다"도 평균에 들어가야 하는 사실이라, 빼면 평균이 위로 뜬다).

   줄이 종족마다 다른 만큼 화면도 종족마다 다른 표를 그린다(요청). 눈여겨볼 두 곳:
   저그는 근접·원거리가 갑각(zCara) 하나를 나눠 쓰고, 프로토스는 실드가 지상·공중 공통이다
   — 그래서 그 둘은 표에서 따로 한 줄로 뗀다(같은 값을 두 줄에 적으면 따로인 줄 오해한다). */
export const UP_BY_RACE: Record<"테란" | "저그" | "프로토스", Record<string, UpgradeName>> = {
  테란: {
    tInfW: "Terran Infantry Weapons", tInfA: "Terran Infantry Armor",
    tVehW: "Terran Vehicle Weapons", tVehP: "Terran Vehicle Plating",
    tShipW: "Terran Ship Weapons", tShipP: "Terran Ship Plating",
  },
  저그: {
    zMelee: "Zerg Melee Attacks", zMissile: "Zerg Missile Attacks", zCara: "Zerg Carapace",
    zFlyW: "Zerg Flyer Attacks", zFlyA: "Zerg Flyer Carapace",
  },
  프로토스: {
    pGrdW: "Protoss Ground Weapons", pGrdA: "Protoss Ground Armor",
    pAirW: "Protoss Air Weapons", pAirA: "Protoss Air Armor",
    pShield: "Protoss Plasma Shields",
  },
};

/** 보급을 대는 건물 — 어느 판에서나 가장 많이 지어서 Top5의 1위를 늘 독차지한다(요청: 제외).
 *  저그 오버로드는 유닛이라 애초에 건물 목록에 없다. */
const SUPPLY_BUILDINGS = new Set(["Pylon", "Supply Depot"]);

/** 많이 나온 순 Top N. 이름은 영문 키로 저장돼 있으므로 부르는 쪽이 한국어 표기 사전을
 *  넘긴다 — 표기를 고치면 이미 등록된 경기도 다음 조회부터 새 표기로 읽히게 하기 위해서다
 *  (요약 문장이 저장된 문장 대신 저장된 사실을 두는 것과 같은 이유).
 *
 *  옮긴 뒤에 합치는 것이 중요하다: 탱크는 시즈/언시즈 두 영문명으로 오지만 한국어로는 둘 다
 *  "탱크"라, 먼저 순위를 매기면 "탱크"가 두 줄로 선다.
 *
 *  같은 수면 이름순으로 갈라 순서가 조회마다 흔들리지 않게 한다. */
export function topEntries(
  d: Record<string, number> | undefined, ko: Record<string, string>, n: number,
  secs?: Record<string, number>, exclude?: Set<string>,
): TopEntry[] {
  const merged: Record<string, number> = {};
  const mergedSecs: Record<string, number> = {};
  // 서버가 아직 이 갈래를 안 내려주는 사이(프론트만 먼저 배포된 순간)에도 칸이 깨지지
  // 않아야 한다 — 없으면 그냥 빈 목록이다.
  for (const [key, v] of Object.entries(d ?? {})) {
    if (exclude?.has(key)) continue;
    const name = ko[key];
    if (!name || !(v > 0)) continue;
    merged[name] = (merged[name] ?? 0) + v;
    const sv = secs?.[key];
    if (typeof sv === "number" && sv > 0) mergedSecs[name] = (mergedSecs[name] ?? 0) + sv;
  }
  /* 탱크처럼 영문명 둘이 한국어 하나로 합쳐지는 이름은 시간도 함께 더해진다 — 한 판에서
     시즈/언시즈가 둘 다 나오면 그 판 길이가 두 번 들어가 값이 실제보다 낮게 나온다. 이름이
     갈리는 것은 탱크뿐이고 보수적으로 잡히는 쪽이라 그대로 둔다.
     순위는 10분당 값이 아니라 총합으로 매긴다 — 한 판에만 잠깐 쓴 것이 10분당으로는 커 보여
     상위로 올라오면 "많이 뽑은 다섯"이라는 목록의 뜻이 어긋난다. */
  return Object.entries(merged)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name, count]) => ({
      name,
      perMin: mergedSecs[name] > 0 ? (count / mergedSecs[name]) * PER_WINDOW_SECONDS : null,
    }));
}

/** 이름 → 그 목록에서 몇 번째였나(1부터) — Top5 옆의 전달 대비 순위 화살표에 쓴다(요청).
 *
 *  topEntries와 같은 순서를 매기되 자르지 않는다: 지난달 6위였던 것이 이번 달 3위로 올라온
 *  경우, Top5만 들고 견주면 그 사실을 알 수가 없어 '새로 등장'으로 보인다. 값은 목록에
 *  실제로 실린 것만 담기므로, 여기 없는 이름은 지난달에 아예 안 나온 것이다. */
export function topRanks(
  d: Record<string, number> | undefined, ko: Record<string, string>,
): Map<string, number> {
  const merged: Record<string, number> = {};
  for (const [key, v] of Object.entries(d ?? {})) {
    const name = ko[key];
    if (!name || !(v > 0)) continue;
    merged[name] = (merged[name] ?? 0) + v;
  }
  const out = new Map<string, number>();
  Object.entries(merged)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .forEach(([name], i) => out.set(name, i + 1));
  return out;
}

/** 1분(초) — 주요시간대 합계를 이 길이로 환산한다(요청: 모든 시간관련 지표를 주요시간대
 *  1분당으로, 단위 표시는 "단위/분"). 예전에는 10분이었는데, 경기 전체를 분모로 쓸 때는
 *  분당 값이 너무 잘아 자릿수 차이가 안 읽혔다 — 주요시간대만 세면 값 자체가 커져서
 *  분당으로도 충분히 갈린다(서버의 PER_WINDOW_SECONDS와 같은 값). */
export const PER_WINDOW_SECONDS = 60;

/** 목록 한 줄 — 이름과 분당 값. 주요시간대를 못 잡은 경기뿐이면(짧은 판·옛 응답) null이라
 *  화면이 그 줄의 수를 뺀다. */
export interface TopEntry { name: string; perMin: number | null }

/** 커맨드 스트림에서 모은 재료(signals)로 그 경기의 구성을 낸다. 재료가 없으면 null. */
export function buildMixOf(
  s: ReplayPlayerSignals | null | undefined, totalFrames?: number | null,
  /** 그 판에서 고른 종족 — 업그레이드 줄이 종족마다 달라, 이 값이 있어야 어느 줄을
   *  담을지 정할 수 있다(위 UP_BY_RACE). 모르면 줄별 값은 비운다. */
  race?: string | null,
): BuildMix | null {
  if (!s) return null;
  const out = emptyBuildMix();
  /* 도넛·Top5에 들어갈 수는 경기 전체로 센다(요청) — 주요시간대만 보면 마법처럼 드문
     사건이 대부분 잘려 목록이 비고, 구성비도 초·후반을 뺀 반쪽 그림이 된다.
     주요시간대는 '분당 얼마나 찍었나'에만 쓴다(아래 coreBuild·coreUnit·coreCmd) —
     초반의 정해진 빌드와 끝난 뒤 정리 구간이 분모에 끼면 그 값이 눌리기 때문이다.
     못 잡는 경기(길이를 모르거나 너무 짧은 판)는 coreSeconds가 null이라 분당 집계에서
     빠진다. 프레임 목록이 없는 옛 재료에서는 총합으로 돌아간다 — 없는 걸 0으로 세면 그
     사람의 기록이 통째로 사라진다. */
  const core = coreWindowOf(totalFrames);
  const inCore = (f: number) => !core || (f >= core.from && f <= core.to);
  const countIn = (frames: number[] | undefined, total: number) =>
    (frames ? frames.filter(inCore).length : total);

  for (const [b, total] of Object.entries(s.buildingCounts)) {
    const n = total;
    if (n <= 0) continue;
    if (DEFENSE_BUILDINGS.has(b)) out.bDef += n; else out.bProd += n;
    if (BUILDING_KO[b] && !SUPPLY_BUILDINGS.has(b)) out.buildings[b] = (out.buildings[b] ?? 0) + n;
  }
  for (const [line, names] of Object.entries(UP_LINES) as [keyof typeof UP_LINES, UpgradeName[]][]) {
    // 업그레이드 단계는 '얼마나 올렸나'라 구간과 무관하다 — 시간당으로 환산하는 값이 아니다.
    out[line] = Math.max(...names.map((u) => upgradeLevel(s, u)));
  }
  /* 줄별 값 — 그 판의 종족 줄만, 0단계도 그대로 담는다. 위 다섯 자리와 달리 뭉개지 않아서
     "보병은 3업인데 메카닉은 안 갔다"가 그대로 남는다. */
  const lines = race ? UP_BY_RACE[race as keyof typeof UP_BY_RACE] : undefined;
  if (lines) {
    for (const [key, name] of Object.entries(lines)) out.ups[key] = upgradeLevel(s, name);
  }
  for (const [u, total] of Object.entries(s.unitCounts)) {
    if (NOT_ARMY.has(u)) continue;
    const n = total;
    if (n <= 0) continue;
    if (CASTER_UNITS.has(u)) out.uCaster += n;
    else if (BASIC_UNITS.has(u)) out.uBasic += n;
    else out.uAdv += n;
    if (AIR_UNITS.has(u)) out.uAir += n; else out.uGround += n;
    if (UNIT_KO[u]) out.units[u] = (out.units[u] ?? 0) + n;
  }
  for (const [t, total] of Object.entries(s.techUses)) {
    if (TECH_KO[t] && total > 0) out.skills[t] = (out.skills[t] ?? 0) + total;
  }
  /* 초반 일꾼만은 정의 자체가 '초반 5분'이라 주요시간대와 무관하게 경기 앞쪽에서 센다. */
  const early = WORKER_EARLY_SEC / SECONDS_PER_FRAME;
  for (const u of WORKER_UNITS) {
    out.worker5 += (s.unitFrames[u] ?? []).filter((f) => f <= early).length;
  }
  out.coreSeconds = core ? core.seconds : null;
  /* '생산 커맨드'는 유닛+건물 생산 커맨드의 합이다(buildCount와 같은 정의) — 여기서는
     주요시간대 것만 센 값이라 커맨드 칸도 다른 칸과 같은 자로 읽힌다. */
  out.coreBuild = Object.entries(s.buildingCounts)
    .reduce((n, [b, t]) => n + countIn(s.buildingFrames[b], t), 0);
  out.coreUnit = Object.entries(s.unitCounts)
    .reduce((n, [u, t]) => n + countIn(s.unitFrames[u], t), 0);
  out.coreCmd = out.coreBuild + out.coreUnit;
  return out;
}
