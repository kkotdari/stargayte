// 통계 표와 회원 프로필의 닉네임에 붙는 칭호 한 줄(요청) — "물량퀸", "옆탱의 여왕",
// "공포의 독거미 부대", "닥치고 캐리어"처럼 그 사람이 어떻게 게임하는지를 한마디로 부르는 말.
//
// 규칙 하나만 지킨다: 칭호는 반드시 그 사람의 기록에서 나와야 한다. 무작위로 돌리거나
// 돌아가며 나눠 주면 재미는 잠깐이고 그다음부터는 아무도 안 읽는 글자가 된다 — 읽는 사람이
// "왜 저게 붙었지?" 하고 표를 다시 보게 만드는 것이 이 줄의 값어치다.
//
// 재료는 셋이다.
//   1) 전술 — 리플레이 요약이 자막으로 말하던 그 사실 그대로다(요청: 자막에서 강조되는
//      옆탱·센포 같은 것들을 칭호에도). 서버가 요약의 문장 틀 키를 사람별로 세어 준다.
//   2) 맵 — 유독 잘하는 맵이 있으면 "○○의 지배자"(요청).
//   3) 수치 — 물량·APM·공중 비중처럼 표에 이미 있는 값들.
//
// 뽑는 차례는 두 단계다.
//   왕관: 아래 TITLES를 위에서부터 훑어 그 값의 1등에게 하나씩. 한 칭호는 한 사람만,
//         한 사람은 한 칭호만. 위쪽에 있을수록 '그 사람다움'을 많이 말하는 칭호다.
//   특징: 왕관을 못 받은 사람은 남과 견주지 않고 제 기록에서 가장 튀는 것(많이 뽑은
//         유닛, 많이 쓴 마법)으로 짓는다 — 이름이 들어가는 말이라 사람마다 저절로 갈린다.
// 둘 다 못 잡으면 전적만 보고 무난한 말 하나를 준다. 한 판도 안 뛴 사람은 아예 안 붙인다 —
// 없는 사실로 별명을 지을 수는 없다.

import { PER_WINDOW_SECONDS, type BuildMix } from "./replayBuildMix";
import { BUILDING_KO, TECH_KO, UNIT_KO } from "./replaySummaryText";
import type { MemberStats } from "../types";

/** 칭호를 붙일 최소 경기 수 — 한두 판으로 무엇의 "왕"을 부를 수는 없다. */
const MIN_PLAYS = 3;
/** 승률만은 더 본다 — 3판 3승이 곧 "정점"이 되면 그 칭호는 아무 말도 안 하는 것과 같다. */
const MIN_PLAYS_RATE = 8;
/** 유형 칭호(개인전·팀전 퀸)는 그 유형에서만 세는 판수라 더 많이 본다 — 팀전 몇 판으로
 *  "팀전 퀸"이 되면 정작 팀전을 도맡아 뛴 사람이 그 말을 못 듣는다. */
const MIN_PLAYS_MODE = 12;
/* 좋은 칭호일수록 뛴 판이 있어야 한다(요청: 경기를 많이 안 했는데 재밌는 칭호를 가져가면
   안 된다) — 세 판 나와서 그중 한 판에 포토러시를 한 사람이 "포토러시의 퀸"이 되면, 그
   칭호는 클럽에서 그 사람을 부르는 말이 아니라 우연히 찍힌 도장이 된다.
   급마다 다르게 잡는 이유는 급 자체가 '얼마나 그 사람다운가'의 눈금이라서다. */
const MIN_PLAYS_TIER: Record<number, number> = { 1: 10, 2: 4 };
/** 유닛·건물 이름으로 불리려면 그 이름을 쓰는 사람들의 한가운데보다 이만큼은 앞서야 한다
 *  (지적: 회원들 간 상대 우위를 봐야 한다) — 클럽 전체가 질럿을 6할씩 쓰면 6할은 그냥 그
 *  종족의 기본값이지 그 사람의 색이 아니다. */
const NAME_EDGE = 1.15;
/** 수치 칭호는 겨룰 사람이 이만큼은 있어야 뜻이 선다 — 둘 중 1등은 1등이 아니다. */
const MIN_POOL = 3;
/** 수치 칭호의 1등 값이 무리 한가운데보다 이만큼은 커야 왕관이다. 다들 비슷한데 소수점이
 *  조금 컸을 뿐인 1등에 "끝판왕"을 씌우면, 그 표의 모든 칭호가 같이 거짓말이 된다.
 *
 *  1.15 → 1.06(지적: 칭호가 너무 안 나온다). APM·승률·분당 생산처럼 사람 사이가 촘촘한
 *  값에서는 1등이 한가운데의 1.15배까지 벌어지는 일이 드물어, 그 칭호들이 통째로 잠겨
 *  있었다. 6%면 "고만고만한 1등"은 여전히 걸러지면서 실제로 앞선 사람은 통과한다. */
const CROWN_EDGE = 1.06;

export interface EpithetSubject {
  id: string;
  stats: MemberStats;
  /* (삭제) solo / team — 유형별 전적. 칭호를 내전(팀전) 기록으로만 매기게 되면서(요청)
     위 stats가 곧 팀전이라, "개인전 퀸"은 잴 값이 없어졌고 "팀전 퀸"은 전체 승률과 같은
     수가 됐다(같은 사실을 두 이름으로 부르는 셈이다). 두 칭호와 함께 걷었다. */
  /** 종족별 전적 — 종족 칭호("저그의 절대군주")가 쓰는 값(요청: 종족 강자).
   *  통계 응답의 byRace 그대로다. 안 넘어오면 그 칭호만 안 나간다. */
  races?: Partial<Record<string, MemberStats>>;
  /* (삭제) rise — 이번 달 레이팅 상승("떠오르는 샛별"). 레이팅은 이제 래더(일대일)에만
     있는 값이고 칭호는 내전 기록으로만 매기므로(요청), 이 화면의 어느 수와도 잣대가 맞지
     않는다. */
}

/** 칭호 한 벌 — 부르는 말과 그 근거. 근거를 함께 두는 이유는 이 줄이 "기록에서 나온 말"이라고
 *  주장하면서 정작 그 기록을 볼 길이 없으면, 읽는 사람에게는 그냥 무작위 문구와 같기 때문이다
 *  (지적: "왜 이 칭호가 나오지?"). 화면은 이 문장을 툴팁(title)으로 단다. */
export interface Epithet {
  label: string;
  why: string;
}

/** 주요시간대 1분당 값 — 총합은 오래 뛴 사람이 늘 크다(MemberStatRow의 perMin과 같은 자). */
function perMin(total: number, seconds: number | null | undefined): number | null {
  return seconds && seconds > 0 ? (total / seconds) * PER_WINDOW_SECONDS : null;
}

/** 두 갈래의 비율 — 표본이 너무 적으면(min) 비율이 우연이라 안 센다. */
function share(a: number, b: number, min: number): number | null {
  const total = a + b;
  return total >= min ? a / total : null;
}

/** 전술 횟수 — 여러 키를 한 칭호로 묶을 때가 있다(드랍은 종족마다 키가 다르다). */
function did(s: MemberStats, ...keys: string[]): number | null {
  const t = s.tactics;
  if (!t) return null;
  const n = keys.reduce((sum, k) => sum + (t[k] ?? 0), 0);
  return n > 0 ? n : null;
}

function median(vals: number[]): number {
  const s = [...vals].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ── 유독 잘하는 맵 ──────────────────────────────────────────────────────────── */
/** 한 맵을 '잘한다'고 부르려면 이만큼은 뛰어야 한다 — 두 판 다 이겼다고 지배자는 아니다. */
const MAP_MIN_PLAYS = 6;
/** 그리고 이만큼은 이겨야 한다 — 60 → 70%(요청: 종족 칭호처럼 진짜 승률이 높은 경우만).
 *  6할은 '그 맵에서 좀 낫다'는 뜻이지 그 맵의 주인이라는 말은 아니다. */
const MAP_MIN_RATE = 0.7;

/* 맵 이름 뒤에 붙는 말(요청: 맵 이름 뒤에 붙여서 재밌게) — "헌터의 여주인", "빨무의
   안주인", "투혼의 황녀"처럼 맵마다 다른 말이 붙는다. 고르는 자는 맵 이름이다: 같은 맵은
   늘 같은 말이라 조회할 때마다 바뀌지 않고, 맵이 다르면 저절로 갈린다. */
const MAP_SAYS = ["여주인", "안주인", "황녀", "터줏대감", "지배자", "여왕"];

function mapPhrase(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `${name}의 ${MAP_SAYS[h % MAP_SAYS.length]}`;
}

/** 그 사람이 가장 잘하는 맵과 그 승수. 문턱을 못 넘으면 null.
 *  값(승수)으로 겨루는 이유: 승률만 보면 딱 문턱만큼 뛴 사람이 늘 이긴다. */
function bestMap(s: MemberStats): { name: string; wins: number } | null {
  let best: { name: string; wins: number } | null = null;
  for (const [name, record] of Object.entries(s.maps ?? {})) {
    const [plays, wins] = record;
    if (plays < MAP_MIN_PLAYS || wins / plays < MAP_MIN_RATE) continue;
    if (!best || wins > best.wins) best = { name, wins };
  }
  return best;
}

/* ── 칭호 표 ──────────────────────────────────────────────────────────────────
   위에 있을수록 먼저 나간다. 차례를 이렇게 잡은 이유:

     전술 → 맵 → 스타일(무엇을 어떻게 뽑나) → 양(얼마나 했나)

   전술이 맨 위인 것은 그것이 '그 판에서 실제로 벌인 일'이라 사람을 가장 많이 말해 주기
   때문이다(요청: 자막에서 강조되는 것들). 게임 수·APM 같은 양은 누구나 시간을 들이면
   올라가는 값이라 맨 뒤에 둔다.

   전술·맵 칭호는 겨룰 사람 수(MIN_POOL)도, 한가운데와의 차이(CROWN_EDGE)도 안 따진다 —
   성큰러시를 한 사람이 클럽에 혼자뿐이라면 그게 바로 그 사람의 칭호다. 대신 min으로
   "한 번은 우연"을 걸러 낸다. */
interface Title {
  /** 화면에 적히는 말. name이 있는 줄은 {n} 자리에 그 이름이 들어간다. */
  label: string;
  /** 클수록 이 칭호에 가깝다. null이면 후보 아님. */
  /** 두 번째 인자는 그 회원의 한 벌 전체다 — 유형별 전적처럼 MemberStats 바깥에 있는 값을
   *  보는 칭호만 쓴다(개인전·팀전 퀸). 나머지는 첫 인자만 보면 된다. */
  value: (s: MemberStats, of: EpithetSubject) => number | null;
  /** 1등이라도 이 값은 넘어야 씌운다.
   *
   *  이 문턱을 value 안에서 걸면 안 된다(초기 구현의 버그): 문턱에 못 미치는 사람을 null로
   *  떨어뜨리면 후보 수가 줄어 pool을 못 넘기고, 그러면 공중 비중 89%짜리 한 명이 있어도
   *  "하늘의 여전사"가 아예 안 나간다. 겨룰 사람이 몇인가와 1등이 그럴 만한가는 서로 다른
   *  질문이라 따로 물어야 한다. */
  min?: number;
  /** 그 사람 판수의 이만큼에서는 나왔어야 한다 — 유닛 이름을 단 칭호에 건다(지적: 캐리어·
   *  배틀 같은 것은 경기 수 대비 최소 비율을 봐야 한다).
   *
   *  전술 칭호의 값은 '그 수가 나온 판의 수'라, 스무 판 뛰고 한 판에서 캐리어를 갔다고
   *  "캐리어를 모으는 여인"이라 부르면 그 말이 그 사람을 가리키지 못한다. 드문 수(핵·리콜)는
   *  이 문턱을 안 건다 — 거기서는 한 번이 곧 이야기다. */
  minPlaysShare?: number;
  /** 후보가 이만큼은 돼야 매긴다(기본 MIN_POOL). 전술·맵은 1. */
  pool?: number;
  /** 1등이 한가운데의 몇 배는 돼야 하나(기본 CROWN_EDGE). 전술·맵은 1(안 따짐). */
  edge?: number;
  /** {n}에 꽂을 이름 — 맵 칭호처럼 말 자체에 그 사람의 값이 들어가는 경우. */
  name?: (s: MemberStats, of: EpithetSubject) => string | null;
  /** 툴팁에 적을 근거의 앞머리("자막에 잡힌 횟수" 등)와 단위. */
  why?: string;
  unit?: string;
  /** 칭호끼리 겨룰 때의 무게 — 없으면 표의 차례대로 나간다. */
  weight?: number;
  /** 그 값의 1등에게는 급·무게를 제치고 무조건 준다(요청: 참여수 1위는 개근의 여왕이 맞다).
   *
   *  칭호는 대개 "무엇을 했나"라 드문 쪽이 이기지만, 몇 가지는 순위 그 자체가 곧 이야기다 —
   *  클럽에서 제일 많이 나온 사람을 두고 다른 말로 부르면, 정작 그 사실을 아무도 안 부르게
   *  된다(그 사람의 1위는 다른 누구도 대신 가질 수 없는 자리다). 2등에게는 안 물려준다:
   *  1위라서 주는 칭호라 2등이 받는 순간 뜻이 사라진다. */
  sticky?: boolean;
  /** 칭호의 급(요청: 클래스가 다른 것) — 1급은 드물어서 그 자체로 표식이 되는 것들,
   *  2급은 나머지(흔한 전술·운영·수치)다.
   *
   *  급은 '무조건 먼저'가 아니라 점수에 곱하는 웃돈이다(TIER_BOOST). 한때 급을 절대 우선으로
   *  뒀더니 칭호가 사람을 설명하지 못하게 됐다(지적: 급을 넣고 나서 설명이 잘 안 맞는다) —
   *  포토러시를 딱 한 번 해 본 사람이 스무 번 드랍한 사람의 이야기를 덮어 버리는 식이었다.
   *  드묾은 값어치이지 거부권이 아니다: 웃돈으로 두면 드문 한 번이 흔한 한 번을 이기면서도,
   *  압도적인 되풀이는 여전히 제 몫을 한다. */
  tier?: number;
  /** 무게에 무엇을 곱할까.
   *
   *  "count"(전술)는 횟수 그대로다 — 포토러시 세 번은 한 번의 세 배다.
   *  "lead"(수치)는 무리 한가운데 대비 몇 배인가다(요청: 게임수·승률도 포인트다). APM 300과
   *  게임수 90은 한 자로 견줄 수가 없지만, "남들의 몇 배인가"로 바꾸면 견줄 수 있다 —
   *  압도적인 개근이 어중간한 전술 한 번보다 앞서고, 고만고만한 1등은 뒤로 간다. */
  scale?: "count" | "lead";
}

/* 전술 칭호끼리는 표의 차례가 아니라 무게로 겨룬다(요청: 드랍보다 포토·성큰러시가 우위,
   다만 무조건은 아니고 가중치로) — 한 사람이 여러 칭호에 걸렸을 때 위에 적힌 것이 무조건
   이기면, 드랍 스무 번이 포토러시 한 번에 늘 지거나 그 반대가 된다. 무게 × 횟수가 큰 쪽이
   그 사람의 칭호가 된다: 드문 수는 한 번으로도 이기고, 흔한 수는 쌓이면 이긴다.

   값은 "이 한 번이 얼마나 드문가"다. 1이 예사로 나오는 일(드랍 한 번, 저글링 러시 한 번),
   3 언저리가 아무나 안 하는 일(포토·성큰러시, 커널, 리콜), 그 위가 판을 통째로 말하는 일
   (핵)이다. 여기 없는 칭호는 1이다. */
/** 급마다 점수에 곱하는 웃돈(Title.tier 주석) — 1급 한 번은 2급 세 번쯤의 값어치다. */
const TIER_BOOST: Record<number, number> = { 1: 3, 2: 1 };

/* 1급 전술 — 아무나 못 하고, 한 번으로도 그 사람의 표식이 되는 것들.
   표의 열쇠는 칭호 이름이 아니라 전술 키다(요청으로 이름이 자주 바뀐다) — 이름으로 걸면
   문구를 다듬을 때마다 이 표와 어긋나 무게가 조용히 1로 떨어진다(실제로 그럴 뻔했다). */
const TIER1_KEYS = new Set([
  "Nuclear Strike", "cannon-rush", "sunken-rush", "mind-control",
  "nydus", "recall", "infested", "swarm", "sneak-rax", "ally-help",
]);

const TACTIC_WEIGHT: Record<string, number> = {
  "Nuclear Strike": 8,

  /* 경기 운영이 맨 위다(요청: 단순 기술·유닛보다 운영이 먼저) — 어떤 틀로 판을 굴렸나
     (바이오닉·메카닉·목동 저그·빠른 테크), 어디를 잠갔나(조이기), 어떻게 벌었나(째기·확장)는
     그 사람이 게임을 보는 눈이다. 무엇을 뽑았나(캐리어·러커·가디언)는 그 눈이 고른 결과이지
     눈 자체가 아니라, 한 단계 아래에 둔다. */
  bionic: 6, mech: 6, moka: 6, "fast-tech": 6, "center-tank": 6,
  "greedy-paid": 4, expand: 4, "greedy-build": 3.5,
  "worker-gap": 3, "prod-gap": 3, "long-run": 3,

  "cannon-rush": 3.5, "sunken-rush": 3.5, "mind-control": 3.5,
  nydus: 3, recall: 3, infested: 3, swarm: 3,
  /* 밀리고도 끝까지 앉아 있던 이야기 — 판이 기운 뒤에야 나오는 장면이라 흔치 않고,
     그 한 번이 그 판을 통째로 말한다. */
  lodging: 5, relocate: 5, "no-elim": 5,

  /* 전술은 유닛보다 위다(요청, 다시 확인) — 견제·러시·잠그기는 '무엇을 뽑았나'가 아니라
     '어디를 언제 쳤나'라, 같은 유닛으로도 하는 사람과 안 하는 사람이 갈린다. */
  "center-photon": 3, "sneak-rax": 3, "side-tank": 3,
  "harass-workers": 3, "harass-long": 3, dropship: 3, "base-raid": 3,
  "cloak-wraith": 2.5, "duel-rush": 2.5, "valk-hunt": 2.5,
  "wall-in": 2, "ally-cannon": 2,
  /* 주력 유닛으로 부르는 것들 — 그 유닛을 뽑았다는 사실만 말하므로 맨 아래다. 같은 유닛이라도
     그것으로 무엇을 했는지(드랍·사냥·조이기)는 위쪽에 제 칭호가 따로 있다. */
  carrier: 1.5, lurker: 1.5, bc: 1.5, guardian: 1.2, valkyrie: 1.2,
  /* 헬프는 다시 올린다(요청) — 흔하다는 이유로 1.5까지 내렸었는데, 흔한 것과 값어치 없는
     것은 다른 말이다. 제 살림을 놔두고 남의 집으로 병력을 돌리는 일은 제 판을 걸고 하는
     선택이고, 클럽에서 그 사람을 부를 때 실제로 쓰는 말이기도 하다. */
  "ally-help": 4,
  "lift-off": 1.2, fallen: 1,
};

/* 근거 문장에 적을 '그 수의 이름'(요청: "자막에 잡힌 횟수 3회" 말고 무엇이 몇 번인지
   구체적으로) — 칭호는 멋을 부린 말이라 그것만으로는 무엇을 세었는지가 안 남는다.
   "커널 개통사"와 "경기 요약에 커널 3번"이 나란히 있어야 읽는 사람이 둘을 이어 붙인다.
   이름은 자막에서 부르는 말을 그대로 쓴다. */
const TACTIC_NOUN: Record<string, string> = {
  "ally-help": "헬프", "ally-cannon": "아군 기지 포토", "wall-in": "입구막기",
  "center-tank": "센터 탱크 조이기", "harass-workers": "일꾼 견제", "harass-long": "끈질긴 견제",
  dropship: "드랍", "base-raid": "본진 급습", nydus: "커널", recall: "리콜",
  "mind-control": "마인드컨트롤", carrier: "캐리어", lurker: "러커",
  "cloak-wraith": "클로킹 레이스", muta: "뮤탈 견제", "valk-hunt": "발키리로 오버로드 사냥",
  "sneak-rax": "몰래 배럭", "zling-rush": "저글링 러시", "zealot-rush": "질럿 러시",
  "duel-rush": "맞러시", "gang-rush": "협공", swarm: "다크스웜", infested: "감염된 테란",
  guardian: "가디언", bc: "배틀크루저", valkyrie: "발키리", moka: "목동 저그",
  "side-tank": "옆탱", "center-photon": "센터 포토", "cannon-rush": "포토러시",
  "sunken-rush": "성큰러시", "front-defense": "입구 방어", mech: "메카닉 진출",
  bionic: "바이오닉", "fast-tech": "빠른 테크", "hold-off": "공세 막아냄", counter: "역공",
  breakthrough: "방어선 돌파", allin: "올인", "greedy-paid": "통한 째기", "greedy-build": "째기",
  expand: "확장", "worker-gap": "일꾼 격차", "prod-gap": "생산 격차", "mass-army": "대군",
  "upgrade-signature": "업그레이드", "long-run": "장기전", "late-hold": "후반 수비",
  revival: "재기", relocate: "이사", lodging: "셋방살이", "no-elim": "노엘",
  fallen: "먼저 탈락", "lift-off": "건물 띄우기",
};

/* 최소 횟수를 1로 둔다(지적: 전술 칭호가 잘 안 나온다) — 2를 기본으로 두던 것은 "한 번은
   우연"을 거르려던 것인데, 여기 있는 수들은 대부분 우연히 나오지 않는다(옆탱·센포·드랍은
   그러려고 해야 나온다). 게다가 칭호는 내전 기록으로만 매기므로 한 사람이 같은 수를 두 번
   보이기가 생각보다 어렵다 — 문턱이 실제로 막고 있던 것은 우연이 아니라 대부분의 칭호였다. */
/* 유닛 이름을 그대로 단 칭호들 — 그 유닛으로 갔다는 판이 제 판의 이만큼은 돼야 한다(지적:
   한 판 몰아 뽑기로는 안 된다). 0.15에서 내렸다(지적: 스무 판 중 서너 판은 너무 높다) —
   종족을 바꿔 가며 하는 사람은 캐리어를 갈 수 있는 판 자체가 제 판의 일부뿐이라, 전체 판수로
   재면 프로토스를 절반만 하는 사람은 아무리 캐리어를 가도 이 문턱을 못 넘는다.
   0.07이면 스무 판에 한두 판 — "가끔 간다"와 "한 번 가 봤다"를 가르는 선이다. */
const UNIT_TACTIC_SHARE = 0.07;
const UNIT_TACTICS = new Set(["carrier", "bc", "guardian", "valkyrie", "lurker", "muta"]);

const tactic = (label: string, keys: string[], min = 1): Title => ({
  label, value: (s) => did(s, ...keys), pool: 1, edge: 1, min,
  why: `경기 요약에 ${TACTIC_NOUN[keys[0]] ?? "이 수"}`, unit: "번",
  ...(UNIT_TACTICS.has(keys[0]) ? { minPlaysShare: UNIT_TACTIC_SHARE } : {}),
  weight: TACTIC_WEIGHT[keys[0]] ?? 1, scale: "count",
  tier: TIER1_KEYS.has(keys[0]) ? 1 : 2,
});
/** 어지간해선 두 번 나오기 어려운 것들 — 한 번으로도 그 사람의 표식이 된다. */
const rare = (label: string, keys: string[]): Title => tactic(label, keys, 1);
/** 기술 사용 횟수로 매기는 왕관 — 자막의 문장 틀에는 없지만 그 자체로 이야기가 되는 것.
 *  핵이 그렇다: 요약은 핵을 따로 문장으로 세우지 않아 전술 키가 없고, 기술 원장(skills)에만
 *  남는다. 그렇다고 아래 '특징' 단계로 미루면, 한 번 뚫어 본 커널보다 뒷자리가 된다(지적). */
const spell = (label: string, key: string, min = 1): Title => ({
  label,
  value: (s) => {
    const n = s.buildMix?.skills?.[key] ?? 0;
    return n > 0 ? n : null;
  },
  pool: 1, edge: 1, min, why: `경기에서 ${TECH_KO[key] ?? "이 기술"} 사용`, unit: "번",
  weight: TACTIC_WEIGHT[key] ?? 1, scale: "count", tier: TIER1_KEYS.has(key) ? 1 : 2,
});

const TITLES: Title[] = [
  /* 핵은 이 표에서 가장 앞이다(지적: 핵을 쐈는데 빠른 테크가 나온다) — 한 판에 한 번
     떨어질까 말까 한 것이고, 떨어뜨리려면 고스트를 뽑아 살려 두고 상대 진영까지 데려가
     지목한 뒤 그 자리를 버텨야 한다. 아래 어떤 칭호도 이만큼 드물지 않다.
     (버섯구름 배달부 → 핵 투하 전문가 → 핵보유국 → 엄청난 핵 마스터를 거쳐 온 이름이다.) */
  spell("핵 버튼의 주인", "Nuclear Strike"),

  /* ── 사람 노릇(요청: 꼭 넣을 것) ────────────────────────────────────────────
     맨 위에 둔다 — 혼자 잘하는 것보다 판을 함께 굴린 쪽이 먼저 불릴 자격이 있다.
     헬프(ally-help)는 제 살림을 놔두고 남의 집으로 병력을 돌린 대목이라, 이기고 지는
     것과 상관없이 그 사람이 어떤 사람인지를 가장 잘 말해 준다. */
  tactic("든든한 헬프 퀸", ["ally-help"]),
  tactic("동맹의 수호신", ["ally-cannon"]),
  /* 입구막기는 '막았다'가 아니라 '막아 놓고 뒤에서 컸다'가 값어치다(판정도 발전까지 함께
     본다 — replayTactics의 WALL_IN_GROW_MIN). 그래서 칭호도 막은 쪽이 아니라 그다음을
     부른다. "후반 도모 퀸"에서 바꿨다(지적: 개성적이지 않다) — 그 말은 어느 운영에나 붙는
     설명이라, 정작 이 수의 그림(문을 잠가 놓고 뒤에서 살림을 불린다)이 안 보였다. */
  tactic("성벽을 쌓는 여인", ["wall-in"]),
  /* 조이기(요청) — 센터에 탱크를 박아 길목을 잠근 대목이다. 자막에서도 "중앙을 걸어
     잠그고 그 자리를 내주지 않았다"로 말하는 그 수다. */
  tactic("조이기의 달인", ["center-tank"]),
  /* 일꾼 견제는 위로 올린다(요청: 일꾼 견제도 강화) — 상대 일꾼을 잡는 일은 병력을 뽑아
     쌓아 두는 것과 달리 그 순간 손이 가야만 되는 것이고, 그 판의 자원 곡선을 실제로
     꺾어 놓는다. 그래서 다른 어떤 전술보다 그 사람의 성향을 잘 말한다. */
  tactic("집요한 일꾼 사냥꾼", ["harass-workers"], 1),
  tactic("지긋지긋한 견제러", ["harass-long"], 1),
  /* 드랍도 같은 무리로 올린다(요청: 견제도 가중치 높이기) — 병력을 실어 상대 뒤로 넘기는
     일은 앞마당에 병력을 세워 두는 것과 달리 판을 두 곳에서 동시에 굴려야 한다.
     종족마다 키가 달라 하나로 묶는다: 그래야 "드랍 잘하는 사람"이라는 한 말이 된다. */
  tactic("드랍의 여신", ["dropship", "shuttle", "zerg-drop", "templar-drop", "shuttle-reaver"], 1),

  /* ── 운영(요청: 전략운영은 가중치를 좀 높여도 된다) ─────────────────────────
     한 유닛을 많이 뽑은 것과 달리, 이쪽은 그 판을 어떤 틀로 굴렸나다. 바이오닉·메카닉·
     목동 저그는 유닛 이름이 아니라 운영 이름이라, 그 말 하나로 그 사람의 판이 그려진다.
     그래서 단일 유닛 칭호(캐리어·저글링 같은 것)보다 위에 둔다. */
  tactic("바이오닉의 권위자", ["bionic"]),
  tactic("메카닉을 호령하는 자", ["mech"]),
  {
    /* 목동 저그(요청: 멋진데 안 나온다) — 자막이 이 그림을 짚으려면 한 판에서 저글링 12기·
       울트라 3기·다크스웜이 다 나와야 해서(replayTactics의 moka), 그 조건을 넘긴 판이 적으면
       칭호도 안 나온다. 그래서 자막이 짚은 판이 없으면 그 사람이 그 기간에 뽑은 것으로 대신
       본다 — 울트라와 디파일러를 함께 굴렸다면 그 판들이 곧 목동 저그다.
       값은 둘 중 큰 쪽이라, 자막이 짚은 사람이 늘 앞선다. */
    label: "공포의 목동저그", weight: 6, pool: 1, edge: 1, scale: "count",
    why: "목동 저그", unit: "번",
    value: (s) => {
      const byBeat = did(s, "moka") ?? 0;
      const m = s.buildMix;
      const ultra = m?.units?.Ultralisk ?? 0;
      const defiler = m?.units?.Defiler ?? 0;
      const ling = m?.units?.Zergling ?? 0;
      // 셋을 다 굴렸을 때만 — 울트라만 몇 기 뽑은 것은 목동이 아니다.
      const byUnit = ultra >= 2 && defiler >= 1 && ling >= 20 ? Math.min(ultra, defiler) : 0;
      const n = Math.max(byBeat, byUnit);
      return n > 0 ? n : null;
    },
  },

  // ── 전술(리플레이 자막이 말하던 그 사실) ────────────────────────────────────
  tactic("옆탱의 여왕", ["side-tank"]),
  /* 한 번으로도 자격이 있다 — 남의 집 앞에 건물을 박는 것은 손이 미끄러져서 되는 일이
     아니다(다른 전술의 기본 문턱 2회는 "한 번은 우연"을 거르려는 것이다). */
  tactic("포토러시의 퀸", ["cannon-rush"], 1),
  tactic("성큰러시의 절대자", ["sunken-rush"], 1),
  tactic("센포의 지배자", ["center-photon"]),
  tactic("남의 집 헤집기 장인", ["base-raid"]),
  /* 나이더스 커널이다(버로우가 아니다). "땅굴"이라 부르니 버로우 이야기로 읽힌다는 지적 —
     자막이 이 수를 부르는 이름(커널)을 그대로 쓴다. */
  rare("커널 개통사", ["nydus"]),
  rare("리콜의 마술사", ["recall"]),
  rare("정신을 훔치는 마인드 컨트롤러", ["mind-control"]),
  tactic("캐리어를 모으는 여인", ["carrier"]),
  tactic("공포의 독거미 부대", ["lurker"]),
  /* 안 보이는 것으로만 치는 사람(요청: 다크·레이스·아비터를 다 잘 쓴 경우만) —
     "보이지 않는 손" → "안 보이는 레이스"를 거쳐 온 자리다. 유닛 하나로는 안 준다(요청:
     하나만 써서는 안 됨): 다크만 뽑는 프로토스는 흔하고, 그건 이미 유닛 칭호가 말한다.
     셋을 다 굴렸다는 것은 종족을 넘나들며 '안 보이는 것'이라는 한 가지 수를 계속 골랐다는
     뜻이라, 그 자체가 그 사람의 취향이다. 값은 셋을 합친 수 — 많이 굴린 쪽이 임자다. */
  {
    label: "보이지 않는 공격", weight: 5, pool: 1, edge: 1, tier: 1, scale: "count",
    why: "다크·레이스·아비터", unit: "기",
    value: (s) => {
      const m = s.buildMix;
      if (!m) return null;
      const dark = m.units?.["Dark Templar"] ?? 0;
      const wraith = m.units?.Wraith ?? 0;
      const arbiter = m.units?.Arbiter ?? 0;
      // 셋 다 있어야 한다 — 하나라도 비면 그 사람의 수가 아니라 그 판의 종족이 한 일이다.
      return dark > 0 && wraith > 0 && arbiter > 0 ? dark + wraith + arbiter : null;
    },
  },
  tactic("하늘을 나는 뮤탈 조련사", ["muta"]),
  tactic("무자비한 오버로드 사냥꾼", ["valk-hunt"]),
  tactic("몰래 배럭의 대가", ["sneak-rax"]),
  tactic("끝없는 저글링 폭풍", ["zling-rush"]),
  tactic("질럿 돌격대장", ["zealot-rush"]),
  tactic("맞러시 승부사", ["duel-rush"]),
  /* (삭제) 협공의 선봉(gang-rush) — 뺐다(요청). 팀전에서 둘이 함께 들이치는 것은 그 판의
     기본 진행에 가까워, 두 번 세 번 쌓여도 그 사람을 말해 주지 않는다. 무게를 두 번 내려
     봤지만 결국 다른 칭호가 없는 사람에게만 붙는 자리가 됐다 — 그런 칭호는 없느니만 못하다. */
  rare("다크스웜의 여신", ["swarm"]),
  rare("감염술사", ["infested"]),
  tactic("가디언 함대 사령관", ["guardian"]),
  tactic("배틀 퀸", ["bc"]),
  tactic("발키리 지휘관", ["valkyrie"]),
  /* (삭제) 우리 집 문지기(front-defense) — 뺐다(지적: 입구는 막으라고 있는 것). 제 입구를
     지키는 일은 누구나 매 판 하는 것이라, 잘했다는 뜻도 그 사람답다는 뜻도 안 된다.
     같은 방어라도 '밀려온 공세를 막아냈다'(hold-off)는 남는다 — 그건 실제로 벌어진 일이다. */

  /* ── 판을 어떻게 끌고 갔나 ──────────────────────────────────────────────────
     여기부터는 '무엇을 뽑았나'가 아니라 '어떤 판을 만들었나'다. 지는 쪽으로 읽히는 키
     (rush-backfire·greedy-punished·fallen 같은 것)는 아예 안 쓴다 — 칭호는 놀리는
     자리가 아니다. 반대로 밀리고도 버틴 이야기(revival·relocate·lodging·lift-off)는
     쓴다: 그건 진 이야기가 아니라 끝까지 앉아 있었다는 이야기다. */
  /* (삭제) 한타의 지배자·소모전의 화신·눈치 싸움의 강자·한 방 병력의 주인 — 뺐다(지적:
     의미가 구체적이지 않다). 넷 다 "큰 싸움이 있었다"·"오래 버텼다"처럼 어느 판에나 붙는
     말이라, 그 사람이 무엇을 했는지가 안 남는다. 칭호는 읽는 사람이 "왜 저게 붙었지?" 하고
     표를 다시 보게 만드는 값이어야 하는데, 이런 말은 다시 봐도 짚을 것이 없다. */
  tactic("맷집 퀸", ["hold-off"]),
  tactic("받아치기의 정석", ["counter"]),
  tactic("벽을 부수는 자", ["breakthrough"]),
  tactic("물러섬 없는 올인의 화신", ["allin"]),
  tactic("째기의 달인", ["greedy-paid"]),
  /* 빠른 테크는 아래로 내렸다(지적: 그렇게 중요하진 않다) — 고급 유닛으로 곧장 올라간
     것은 흔한 선택이고, 그 자체로 판이 갈리지도 않는다. 문구도 "테크의 연금술사"에서
     바꿨다(지적: 무슨 말인지 모르겠다) — 빗대지 말고 한 일을 그대로 적는다. */
  tactic("빠른 테크 신봉자", ["fast-tech"]),
  /* "배짱의 화신"이었는데 무슨 뜻인지 안 읽힌다는 지적 — 이 키(greedy-build)는 병력 건물
     없이 자원부터 올린 '째기'다. 그 판에서 쓰는 말을 그대로 쓰면 설명이 필요 없다.
     통한 째기(greedy-paid)는 위의 "째기의 달인"이고, 이쪽은 그냥 늘 그렇게 시작하는 사람이다. */
  tactic("일단 째고 본다", ["greedy-build"]),
  tactic("멀티 부동산왕", ["expand"]),
  /* 상대보다 일꾼을 훨씬 많이 굴린 대목(worker-gap) — 자원을 많이 캤다는 말이다. */
  tactic("자원 부자", ["worker-gap"]),
  tactic("쉼 없는 생산 공장장", ["prod-gap"]),
  /* (삭제) 병력 사재기 — 뺐다(요청). "많이 모았다"는 시간을 들이면 누구나 닿는 값이고,
     그 병력으로 무엇을 했는지는 말해 주지 않는다. 물량 자체는 '물량퀸'이 이미 잰다. */
  tactic("업그레이드 여제", ["upgrade-signature"]),
  tactic("지구전의 화신", ["long-run"]),
  tactic("끝까지 버티는 사람", ["late-hold", "late-defense", "stand"]),
  rare("좀비 모드", ["revival"]),
  rare("역마살 퀸", ["relocate"]),
  /* 본진을 잃고 아군 기지에 얹혀산 대목(lodging) — 흔치 않은 데다 그 판을 통째로 말하는
     그림이라 무게를 높였다(요청). 진 이야기가 아니라 끝까지 앉아 있었다는 이야기다. */
  rare("셋방살이 전문가", ["lodging"]),
  /* (삭제) 건물 띄우기(lift-off)로 짓던 "공중부양 마스터" — 뺐다(지적). 이 키는 자리를
     다 내주고 건물만 띄워 쫓겨 다닌 대목이라, 버틴 이야기로 넣었지만 칭호로 굳으면
     "집을 잃은 사람"이라는 딱지로 읽힌다. 자막에서 한 번 지나가는 말과, 이름 아래
     늘 붙어 있는 말은 무게가 다르다. */
  rare("노엘을 외치는 자", ["no-elim"]),
  /* (삭제) 프로를 닮았다는 이야기(pro-like) — 뺐다(지적: 별로 의미가 안 된다).
     자막에서는 "○○ 못지않은 △△"처럼 누구를 닮았는지가 함께 나와야 뜻이 서는 말인데,
     칭호가 세는 것은 문장 틀 키뿐이라 그 이름이 빠진다. 이름 없는 "프로 스타일"은
     아무 말도 안 하는 칭호다. */

  // ── 맵 ─────────────────────────────────────────────────────────────────────
  {
    // 말 전체를 name이 만든다(위 mapPhrase) — 맵마다 다른 꼬리가 붙어야 해서다.
    label: "{n}",
    pool: 1, edge: 1, weight: 2.5, why: "그 맵 승수", unit: "승",
    value: (s) => bestMap(s)?.wins ?? null,
    name: (s) => { const best = bestMap(s); return best ? mapPhrase(best.name) : null; },
  },

  // ── 스타일(무엇을 어떻게 뽑나) ─────────────────────────────────────────────
  /* ── 손과 운영에서 더 뽑아낸 것들(요청: 경기 운영에서 더 줄 수 있는 걸 만들어 보라) ──
     전술 요약이 없는 사람도 지표는 있다. 아래 셋은 이미 저장된 값을 다르게 읽은 것뿐이라
     새 재료가 필요 없고, 그런데도 "그 사람이 게임을 어떻게 다루나"를 말해 준다. */
  {
    /* 헛치지 않는 손 — 유효APM ÷ APM. 같은 APM이라도 큐가 찬 건물을 또 누르거나 같은 명령을
       연타하면 유효 쪽이 뚝 떨어진다(replayParser의 IneffKind 주석). 빠른 손과 깔끔한 손은
       다른 말이고, 이 값은 뒤쪽만 잰다. */
    label: "군더더기 없는 손", weight: 2.5, min: 0.72, why: "APM 중 유효타", unit: "",
    value: (s) => (s.avgApm && s.avgEapm && s.avgApm > 0 ? s.avgEapm / s.avgApm : null),
  },
  {
    /* 커맨드 중 얼마나가 실제 생산이었나 — 손을 움직인 만큼 무언가가 나온 사람이다.
       '많이 눌렀다'(커맨드)와 '많이 만들었다'(생산)는 다른 값이라, 그 비가 곧 운영의 결이다. */
    label: "누른 만큼 뽑는 사람", weight: 2.5, min: 0.35, why: "커맨드 중 생산", unit: "",
    value: (s) => (s.avgCmd && s.avgBuild && s.avgCmd > 0 ? s.avgBuild / s.avgCmd : null),
  },
  {
    /* 기본 유닛만으로 미는 사람 — 고급 유닛으로 올라가는 대신 싼 것을 계속 쏟아붓는 운영이다.
       '고급 유닛 수집가'의 반대편이라, 둘이 함께 있어야 이 축이 뜻을 갖는다. */
    label: "기본기의 사람", weight: 2, min: 0.8, why: "병력 중 기본 유닛", unit: "",
    value: (s) => (s.buildMix ? share(s.buildMix.uBasic, s.buildMix.uAdv + s.buildMix.uCaster, 30) : null),
  },
  {
    /* 하늘을 아예 안 쓰는 사람 — 지상만으로 푼다. 공중 비중 1위('하늘의 여전사')와 짝이다. */
    label: "땅에서 사는 사람", weight: 2, min: 0.97, why: "병력 중 지상", unit: "",
    value: (s) => (s.buildMix ? share(s.buildMix.uGround, s.buildMix.uAir, 30) : null),
  },
  { label: "물량퀸", weight: 2.5, why: "분당 뽑은 기수", unit: "기", value: (s) => (s.buildMix ? perMin(s.buildMix.coreUnit, s.mixSeconds) : null) },
  { label: "번개같은 손놀림", weight: 2.5, why: "APM", unit: "", value: (s) => s.avgApm },
  {
    label: "하늘의 여전사", weight: 2, why: "병력 중 공중 비중", unit: "",
    // 공중 비중은 30%를 넘어야 '탄다'고 할 수 있다 — 드랍십 한 기로 하늘을 지배할 수는 없다.
    value: (s) => (s.buildMix ? share(s.buildMix.uAir, s.buildMix.uGround, 20) : null),
    min: 0.3,
  },
  {
    label: "마법의 화신", weight: 2, why: "병력 중 마법 유닛 비중", unit: "",
    // 마법 유닛은 원래 수가 적다 — 5%만 넘어도 그 판을 마법으로 푼 사람이다.
    value: (s) => (s.buildMix ? share(s.buildMix.uCaster, s.buildMix.uBasic + s.buildMix.uAdv, 20) : null),
    min: 0.05,
  },
  {
    label: "고급 유닛 수집가", weight: 1.5, why: "병력 중 고급 유닛 비중", unit: "",
    value: (s) => (s.buildMix ? share(s.buildMix.uAdv, s.buildMix.uBasic, 30) : null),
    min: 0.45,
  },
  {
    /* 방어 건물을 거의 안 짓는 사람(요청: 방어타워 적은 것 → 파워 공격러) — '차가운 철옹성의
       여왕'의 반대편이다. 낮은 값을 1등으로 뽑을 방법이 없어(이 표는 큰 쪽이 이긴다) 값을
       뒤집어 '생산 건물 비중'으로 잰다: 같은 사실을 반대에서 부른 것이라 뜻은 그대로다. */
    label: "파워 공격러", weight: 2, min: 0.95, why: "건물 중 생산 건물", unit: "",
    value: (s) => (s.buildMix ? share(s.buildMix.bProd, s.buildMix.bDef, 20) : null),
  },
  {
    /* 방어 건물(포토·성큰·터렛·벙커)을 유독 많이 올린 사람(요청: 철옹성 퀸).
       "철벽의 수호자" → "방어탑 사랑꾼"을 거쳐 온 이름이다 — 재는 것은 '잘 막았다'가 아니라
       '지은 건물 중 방어 건물의 비중'이고, 막아냈는지 아닌지는 리플레이가 말해 주지 않는다. */
    label: "차가운 철옹성의 여왕", weight: 1.5, why: "건물 중 방어 건물 비중", unit: "",
    value: (s) => (s.buildMix ? share(s.buildMix.bDef, s.buildMix.bProd, 20) : null),
    min: 0.12,
  },
  /* 무게를 2 → 1.2로 내렸다(요청) — 초반 일꾼은 그 판의 빌드가 정하는 값에 가깝다.
     같은 종족·같은 빌드면 누구나 비슷하게 나오므로, 1등이라고 그 사람을 말해 주는 몫이
     다른 칭호들보다 작다. */
  { label: "일꾼 뽑기 퀸", weight: 1.2, why: "초반 5분 일꾼", unit: "기", value: (s) => s.avgWorker5 },
  /* 건물을 제일 많이 올린 사람(요청: 심시티 퀸) — "쉴 새 없이 짓는 자"에서 바꿨다. 재는 값은 그대로 분당 지은 채수다. */
  { label: "심시티 퀸", weight: 1.5, why: "분당 지은 채수", unit: "채", value: (s) => (s.buildMix ? perMin(s.buildMix.coreBuild, s.mixSeconds) : null) },
  {
    label: "풀업 신봉자", weight: 1.5, why: "공/방 평균 단계", unit: "",
    value: (s) => {
      const m = s.buildMix;
      if (!m) return null;
      const n = Object.values(m.upCounts ?? {}).reduce((a, b) => a + b, 0);
      if (n <= 0) return null;
      return Object.values(m.ups ?? {}).reduce((a, b) => a + b, 0) / n;
    },
  },

  /* ── 위로상(요청: 좋은 칭호는 한 사람에게 몰리니 중·하위권을 위한 자리도) ────────────
     무게를 낮게 둔다(1 안팎) — 왕관을 받을 만한 사람에게는 절대 안 붙고, 아무것도 못 받은
     사람에게만 남는 자리다. 그래도 사실에서 나온 말이라 놀림이 아니라 그 사람의 이야기다. */
  /* 건물을 띄워 옮겨 다닌 사람(요청: 하울의 움직이는 성) — 한때 "공중부양 마스터"로 넣었다가
     "집을 잃은 사람"이라는 딱지로 읽혀 걷어냈던 자리다. 같은 사실도 부르는 말이 달라지면
     이야기가 된다: 쫓겨 다닌 것이 아니라 성을 끌고 다닌 것이다. 무게는 위로상 급이다. */
  rare("하울의 움직이는 성", ["lift-off"]),
  {
    /* 먼저 판에서 사라진 횟수 — 리플레이에 남는 탈락(Leave Game)이라 짐작이 아니다.
       지는 이야기지만 놀리는 말은 아니다: 팀전에서 제일 먼저 노려지는 자리는 대개 잘하는
       사람이거나 앞에 선 사람이다. */
    label: "비련의 여조연", weight: 1, pool: 1, edge: 1, scale: "count",
    why: "경기 요약에 먼저 탈락", unit: "번",
    value: (s) => did(s, "fallen"),
  },
  {
    /* 종족을 두루 쓰는 사람 — 한 종족만 파는 사람이 대부분이라 그 자체가 특징이다.
       값은 '충분히 뛴 종족의 수'이고, 같으면 그중 가장 적게 쓴 종족의 판수로 갈린다:
       세 종족을 고르게 굴린 사람이 한 종족에 치우친 사람보다 앞선다. */
    label: "팔색조 퀸", weight: 1.2, pool: 1, edge: 1, min: 2, scale: "count",
    why: "고루 쓴 종족", unit: "개",
    value: (_s, of) => {
      const played = Object.values(of.races ?? {})
        .map((st) => st?.plays ?? 0)
        .filter((n) => n >= MIN_PLAYS_MODE);
      if (played.length < 2) return null;
      // 종족 수가 같으면 가장 적게 쓴 종족의 판수가 크는 쪽이 이긴다(0.001은 그 잣대의 자리).
      return played.length + Math.min(...played) * 0.001;
    },
  },

  /* (삭제) 기록 퀸 — 등록한 경기 수는 통계 응답에 없는 값이라 서버를 고쳐야 했는데,
     그 한 칭호 때문에 API를 늘리지 않기로 했다(요청). 다시 넣으려면 서버가 회원별
     '등록한 경기 수'를 세어 내려 주기만 하면 된다. */
  /* (삭제) 도장깨기 전문가(개인전 판수) · 떠오르는 샛별(이번 달 레이팅 상승) — 칭호를
     내전 기록으로만 매기면서(요청) 둘 다 잴 값이 없어졌다. 개인전 판수는 이 잣대 밖이고,
     레이팅은 래더에만 있다. */

  /* 종족 강자(요청) — 그 종족으로 가장 잘 이긴 사람. 유형(개인전·팀전)과 같은 생각이다:
     전체 승률은 종족이 섞인 값이라 "무엇을 잘하는가"는 안 말해 준다. 이름이 말에 들어가므로
     종족마다 임자가 따로 선다(위 winners 주석). */
  {
    /* 맵 칭호와 같은 조건이다 — 사람마다 다른 칭호라 '겨룰 사람 수'도 '한가운데와의 차이'도
       따질 것이 없다(pool 1, edge 1). 한때 기본값을 그대로 뒀더니, 종족 승률이 무리
       한가운데의 1.15배를 못 넘는다는 이유로 아무에게도 안 나갔다. 문턱은 그 종족으로
       충분히 뛰었나(MIN_PLAYS_MODE) 하나면 된다. */
    // 승률 70% 이상만(요청: 진짜 승률이 높은 경우만) — 그 종족으로 열두 판을 뛰고도 승률이
    // 반반이면 "절대군주"라는 말이 거짓이 된다.
    label: "{n}", weight: 4, pool: 1, edge: 1, min: 70, why: "그 종족 승률", unit: "%",
    value: (_s, of) => bestRace(of)?.rate ?? null,
    name: (_s, of) => { const best = bestRace(of); return best ? racePhrase(best.race) : null; },
  },

  /* (삭제) 개인전의 여왕 · 팀전의 절대 퀸 — 두 유형을 가르던 칭호들이다. 이제 칭호가 보는
     기록 자체가 내전(팀전) 하나라, 앞의 것은 잴 값이 없고 뒤의 것은 아래 전체 승률 칭호와
     같은 수를 다른 이름으로 부르는 꼴이 된다. */

  // ── 양(얼마나 했나) ────────────────────────────────────────────────────────
  /* 종족·유형 안 가리고 전체 승률이 높은 사람(요청: 종족 무관 승률 70% → 승리의 여신).
     "승률의 정점"에서 이름과 문턱을 함께 바꿨다 — 1등이라도 5할대면 정점이라 부를 수 없고,
     7할을 넘긴 사람이 여럿이어도 그중 가장 높은 한 사람만 이 말을 듣는다. */
  {
    label: "승리의 여신", weight: 3.5, min: 70, why: "승률", unit: "%",
    value: (s) => (s.plays >= MIN_PLAYS_RATE ? s.winRate : null),
  },
  { label: "BEST 수집가", weight: 3, why: "BEST PLAYER", unit: "회", value: (s) => (s.bests > 0 ? s.bests : null) },
  { label: "쉬지 않는 손가락", weight: 2, why: "분당 커맨드", unit: "", value: (s) => s.avgCmd },
  { label: "우리 클랜 NPC", weight: 3, sticky: true, why: "경기 수", unit: "판", value: (s) => s.plays },
];

/* ── 특징 ──────────────────────────────────────────────────────────────────────
   왕관을 못 받은 사람은 남과 견주지 않고 제 기록에서만 뽑는다 — 무리에서 1등이 아니어도
   "이 사람 하면 저것"은 있다. 이름(럴커·스톰)이 들어가는 말이라 사람마다 저절로 달라진다. */

/** 한국어 받침 — 조사(은/는)를 고른다. 유닛·기술 이름은 사전(UNIT_KO 등)이 한국어로 옮긴
 *  값이라 여기서 한글만 보면 된다. */
function hasFinal(word: string): boolean {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}
const sub = (w: string) => (hasFinal(w) ? "은" : "는");
const ga = (w: string) => (hasFinal(w) ? "이" : "가");

/* 종족마다 부르는 말이 따로다(요청: 저그의 절대군주 · 프로토스의 전설 · 테란의 영웅) —
   셋뿐이라 표 하나면 되고, 그편이 종족의 색을 살린다. 여기 없는 값은 무난한 말로 받는다. */
const RACE_SAYS: Record<string, string> = {
  저그: "저그의 절대군주",
  프로토스: "프로토스의 전설",
  테란: "테란의 영웅",
};
const racePhrase = (race: string): string => RACE_SAYS[race] ?? `${race}${sub(race)} 나의 것`;

/** 그 사람이 가장 잘 이긴 종족과 그 승률 — 그 종족으로 충분히 뛴 경우만(MIN_PLAYS_MODE).
 *  여럿 하는 사람도 가장 잘한 하나만 본다: 셋을 다 부르면 그건 칭호가 아니라 표다. */
function bestRace(of: EpithetSubject): { race: string; rate: number } | null {
  let best: { race: string; rate: number } | null = null;
  for (const [race, st] of Object.entries(of.races ?? {})) {
    if (!st || st.plays < MIN_PLAYS_MODE) continue;
    if (!best || st.winRate > best.rate) best = { race, rate: st.winRate };
  }
  return best;
}

/* "~를 부르는 자"는 뺐다(지적: 뜻이 명확하지 않다) — 부른다는 말이 '많이 쓴다'인지 '불러
   낸다'인지 읽는 사람마다 갈렸다. 대신 무엇을 했는지가 바로 읽히는 말만 남긴다. */
/* 그냥 "많이 뽑았다"는 재미가 없다(지적) — 수가 아니라 그 사람의 고집으로 읽히는 말만
   남긴다. "닥치고 ○○"·"○○ 없인 못 산다"처럼 한 유닛만 파는 그림이 이 자리의 웃음이다. */
const UNIT_SAYS: ((n: string) => string)[] = [
  (n) => `닥치고 ${n}`,
  (n) => `공포의 ${n} 부대`,
  (n) => `난 ${n}만 뽑는다`,
  (n) => `${n} 없인 못 산다`,
  (n) => `${n} 중독`,
  (n) => `${n}${sub(n)} 내 운명`,
  (n) => `${n}밖에 몰라`,
  (n) => `${n}${sub(n)} 나의 것`,
  (n) => `${n} 하나로 간다`,
];
const SKILL_SAYS: ((n: string) => string)[] = [
  (n) => `${n} 한 방의 여왕`,
  (n) => `${n}의 대가`,
  (n) => `${n} 장인`,
];
/* 마법은 이름을 되풀이하는 대신 '그게 화면에서 무슨 짓을 하는지'로 부른다(요청: "스톰
   장인"이 아니라 "번개 전문가"). "○○의 대가/장인" 같은 문틀은 어느 기술에 붙여도 말이
   되지만 그래서 아무 말도 안 한다 — 여기 있는 마법은 늘 이쪽을 먼저 쓰고, 위 문틀은
   여기 없는 기술이 아주 많이 쌓였을 때만 나온다(SKILL_PLAIN_MIN). */
/* (삭제) 컨슘의 "마나 흡혈귀", 다크스웜의 "모래폭풍 술사" — 뺐다(지적: 의미가 안 와닿는다).
   둘 다 그 마법이 하는 일을 빗대기만 한 말이라, 그 마법을 아는 사람에게도 무슨 소린지
   한 번 더 생각해야 읽혔다. 빗댄 말은 그 그림이 곧바로 떠오를 때만 값어치가 있다
   (번개·지뢰밭·버섯구름처럼). 다크스웜은 어차피 제 칭호가 따로 있다(다크스웜의 여신). */
const SPELL_SPECIAL: Record<string, string[]> = {
  스톰: ["사이오닉 스톰의 여왕", "사이오닉 스톰 마스터"],
  /* 리콜은 사전에 없어서 아예 안 불렸다(지적: 스톰보다 리콜이 나와야 하는데 안 나온다) —
     사전에 없는 기술은 "○○의 대가" 문틀로 가는데 그 문턱이 30점이라, 무게 3인 리콜은
     열 번을 써야 겨우 닿았다. 왕관("리콜의 마술사")은 1등 한 사람만 가져가므로, 그 뒤의
     사람에게는 이 자리가 유일한 길이다. */
  리콜: ["리콜의 여왕", "리콜을 지배하는 자"],
  마인드컨트롤: ["남의 병력을 빼앗는 자"],
  플레이그: ["역병을 뿌리는 자", "전염병 살포반"],
  이레디에이트: ["치명적인 가스 퀸"],
  락다운: ["묶어 놓고 패기", "락다운 저격수"],
  EMP: ["실드를 지우는 자"],
  야마토: ["야마토 한 발", "전함 포격수"],
  마인: ["지뢰밭 설계자", "밟으면 터진다"],
  브루들링: ["브루들링 저격수"],
  인스네어: ["발목 잡기 장인"],
  스테이시스: ["시간을 멈추는 자"],
  할루시네이션: ["허깨비 부대장", "분신술사"],
  마엘스트롬: ["얼려 놓고 패기"],
  "옵티컬 플레어": ["눈을 멀게 하는 자"],
  핵: ["핵 배달부"],
  "디스럽션 웹": ["거미줄 설계자"],
  리스토레이션: ["응급처치반"],
};
/* 마법마다 '한 번 쓰는 것이 얼마나 어려운가'(요청: 기술도 어려운 것에 가중치를) — 횟수에
   이 값을 곱한 점수로 그 사람의 대표 마법을 고른다.

   횟수만 보면 스톰만 주구장창 나온다(지적). 스톰은 프로토스가 한 판에 열 번도 쓰는 흔한
   마법이라, 어느 프로토스를 세워도 1위가 스톰이다. 반대로 핵·마엘스트롬·디스럽션 웹은
   판마다 한두 번 나올까 말까 한 것이라, 그 사람이 그걸 썼다는 사실 자체가 이야기다.
   그래서 기준선(1.0)을 스톰에 두고, 드물수록 값을 올린다. 마인은 벌처가 지나가며 뿌리는
   것에 가까워 1 아래다 — 200개를 깔아도 "마인 잘 쓰는 사람"이라는 뜻은 아니다. */
const SPELL_WEIGHT: Record<string, number> = {
  /* 늘 누르는 쪽은 더 내린다(요청: 스톰·이레디에이트처럼 그냥 많이 쓰는 기술) — 마법이라도
     그 종족의 기본 조작에 가까우면 많이 썼다는 말이 "그 종족을 오래 했다"밖에 안 된다.
     기준선(1.0)은 이제 이 무리다. */
  마인: 0.4,
  스톰: 1, 이레디에이트: 1, 다크스웜: 1, 컨슘: 1,
  플레이그: 2, 인스네어: 2, EMP: 2, 락다운: 2,
  브루들링: 5,
  "옵티컬 플레어": 6, 리스토레이션: 6, 할루시네이션: 6,
  야마토: 8, 스테이시스: 8,
  마엘스트롬: 10, "디스럽션 웹": 10,
  /* 드문 쪽 끝은 흔한 쪽과 열 배 넘게 벌린다(지적: 스톰보다 리콜이 나와야 하는데 안 나온다).
     한 기간에 프로토스는 스톰을 서른 번쯤 뿌리지만 리콜은 두어 번이다 — 무게 차가 그 빈도
     차를 못 넘으면 아무리 드문 마법도 흔한 마법의 횟수에 늘 묻힌다. 리콜 한 번이 스톰
     열다섯 번과 같다는 뜻이고, 실제로 그 한 번이 그 사람을 더 말해 준다(아비터를 살려
     상대 진영까지 데려가야 나오는 장면이다). */
  리콜: 15,
  /* 핵은 마인드컨트롤과 같은 꼭대기다. 한때 12까지 올렸는데, 그건 "핵이 칭호에 안 나오는
     것이 가중치 탓"이라는 짐작에서 나온 값이었다 — 실제 원인은 파싱이었다(아래 참고).
     원인을 찾은 뒤 제자리로 되돌린다: 값을 사실이 아니라 증상에 맞춰 두면, 나중에 그
     값을 읽는 사람이 "핵이 마인드컨트롤보다 두 배 어렵다"는 뜻으로 잘못 읽는다. */
  마인드컨트롤: 15, 핵: 20,
};
const SPELL_WEIGHT_DEFAULT = 2;
/** 대표 마법으로 부르려면 이 점수(횟수 × 가중치)는 넘어야 한다 — 핵 두 방이면 되고,
 *  마인은 스물다섯 개를 깔아야 한다. */
const SKILL_MIN_SCORE = 8;
/** 유닛보다 먼저 부를 만큼 드문 마법인가(요청: 기술 사용은 뒤로 내리고 다른 개성을 앞에).
 *
 *  마법을 통째로 뒤로 미루면 리콜·핵처럼 그 한 번이 곧 이야기인 것까지 같이 묻힌다. 그래서
 *  줄을 하나 긋는다: 이 점수를 넘는 드문 마법만 앞줄에 서고(리콜 두 번·마엘스트롬 세 번),
 *  스톰처럼 늘 누르는 것은 유닛·건물이 할 말을 다 한 뒤에야 차례가 온다. */
const SKILL_RARE_SCORE = 30;
/** 사전에 없는 기술로 "○○의 대가"를 부르려면 이만큼(요청: 그런 칭호는 재미가 없으니 빈도를
 *  낮춘다) — 흔한 마법을 다섯 번 쓴 것은 그냥 그 종족을 했다는 뜻에 가깝다. */
const SKILL_PLAIN_SCORE = 30;

/** 그 사람의 대표 마법 — 횟수가 아니라 위 가중치를 곱한 점수로 고른다. */
function topSpell(d: Record<string, number> | undefined) {
  const merged: Record<string, number> = {};
  for (const [key, v] of Object.entries(d ?? {})) {
    const name = SPELL_KO[key];
    if (!name || !(v > 0)) continue;
    merged[name] = (merged[name] ?? 0) + v;
  }
  const scored = Object.entries(merged).map(([name, count]) => ({
    name, count, score: count * (SPELL_WEIGHT[name] ?? SPELL_WEIGHT_DEFAULT),
  }));
  return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))[0] ?? null;
}

/* 마법으로 안 치는 것들(지적: 버로우는 기술로 보기 힘들다) — 원장(techUses)에는 '쓴 기술'이
   전부 들어오지만, 칭호가 부를 만한 것은 '그걸 잘 써서 판을 바꾸는' 마법뿐이다. 버로우·
   시즈모드·스팀팩은 그 종족이면 누구나 늘 누르는 조작이라, 많이 썼다는 말이 곧 "그 종족을
   오래 했다"밖에 안 된다. 럴커(럴커 애스펙트)는 쓴 것이 아니라 변태 연구이고, 클로킹은
   이미 '보이지 않는 손'(cloak-wraith)이 제 칭호로 말한다. */
const NOT_A_SPELL = new Set([
  "Burrowing", "Tank Siege Mode", "Stim Packs", "Lurker Aspect",
  "Cloaking Field", "Personnel Cloaking",
]);
const SPELL_KO: Record<string, string> = Object.fromEntries(
  Object.entries(TECH_KO).filter(([key]) => !NOT_A_SPELL.has(key)),
);
const BUILD_SAYS: ((n: string) => string)[] = [
  (n) => `${n} 애호가`,
  (n) => `${n}의 여주인`,
];

/** 원장에서 많이 나온 순 목록(이름·수·비중) — 이름은 한국어 사전을 거친 뒤에 합친다.
 *  탱크처럼 영문명 둘이 한국어 하나인 경우가 있어 먼저 세면 제 몫이 갈린다.
 *
 *  1등 하나만 보지 않는 이유(지적: 다들 "묵묵히 한 판 더"만 나온다): 그 이름의 임자가 이미
 *  딴 칭호를 받았으면 이 사람은 아무 말도 못 듣는다. 두세 번째까지 훑으면 "히드라가 병력의
 *  28%"처럼 여전히 사실인 다른 말이 남아 있다. */
function topList(d: Record<string, number> | undefined, ko: Record<string, string>, n = 3) {
  const merged: Record<string, number> = {};
  let total = 0;
  for (const [key, v] of Object.entries(d ?? {})) {
    const name = ko[key];
    if (!name || !(v > 0)) continue;
    merged[name] = (merged[name] ?? 0) + v;
    total += v;
  }
  if (total <= 0) return [];
  return Object.entries(merged)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name, count]) => ({ name, count, share: count / total }));
}

/** 같은 글자가 표에 두 번 서지 않도록 문틀을 하나씩 밀어 가며 고른다 — 두 사람이 똑같이
 *  럴커를 모아도 한 명은 "공포의 럴커 부대", 다른 한 명은 "닥치고 럴커"가 된다.
 *  시작 자리는 회원 id로 정해 조회할 때마다 말이 바뀌지 않게 한다. */
function pick(says: ((n: string) => string)[], name: string, seed: number, used: Set<string>): string | null {
  for (let i = 0; i < says.length; i++) {
    const text = says[(seed + i) % says.length](name);
    if (!used.has(text)) return text;
  }
  return null;
}

function seedOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/* 한 마법·한 유닛은 한 사람만(지적: 같은 스톰이 여러 명한테 붙는다) — 문틀만 갈아 "스톰의
   여왕"과 "스톰 마스터"로 나눠 줘 봤지만, 표에서는 결국 스톰 이야기가 두 줄이 된다.
   칭호가 그 사람을 가리키려면 그 재료를 나눠 갖지 말아야 한다. 이름을 먼저 집은 사람이
   가져가고, 나머지는 제 다음 재료(유닛 → 건물 → 전적)로 내려간다. */
/** 이름 → 그 이름을 가장 많이 쓴 사람의 id. 마법·유닛·건물 이름마다 임자를 미리 정해 둔다.
 *
 *  임자가 딴 칭호를 받아 이 이름을 안 쓰게 되면 그 이름은 그냥 안 나간다(지적: 더 많이 쓴
 *  사람이 있는데 다른 사람이 이어받는다) — 왕관에서 물려주기를 없앤 것과 같은 이유다.
 *  "스톰의 여왕"이 두 번째로 많이 쓴 사람에게 붙으면 그 말이 거짓이 된다. */
function ownersOf(
  pool: EpithetSubject[], of: (m: BuildMix) => Record<string, number> | undefined,
  ko: Record<string, string>, by: "count" | "share" | "perPlay" = "count",
): Map<string, NameStat> {
  const all = new Map<string, { id: string; v: number }[]>();
  for (const p of pool) {
    const m = p.stats.buildMix;
    if (!m) continue;
    const merged: Record<string, number> = {};
    let total = 0;
    for (const [key, v] of Object.entries(of(m) ?? {})) {
      const name = ko[key];
      if (!name || !(v > 0)) continue;
      merged[name] = (merged[name] ?? 0) + v;
      total += v;
    }
    for (const [name, count] of Object.entries(merged)) {
      /* 유닛·건물은 '많이 뽑은 사람'이 아니라 '그 비중이 가장 큰 사람'이 임자다(지적: 질럿
         칭호가 네 명한테 붙었다) — 칭호가 말하는 값이 비중이라("질럿이 병력의 78%"), 임자도
         같은 자로 정해야 그 말이 한 사람 것이 된다. */
      /* perPlay는 '판당 몇 채'다(지적: 게이트는 비중이 아니라 절대 개수도 중요하다) —
         건물은 비중으로만 보면 게이트 세 채만 지은 사람이 "건물의 100%"가 되어 임자가 된다.
         총량으로 보면 이번엔 많이 뛴 사람이 늘 이기므로, 판수로 나눠 한 판의 그림으로 만든다. */
      const plays = p.stats.mixPlays ?? 0;
      const v = by === "share" ? (total > 0 ? count / total : 0)
        : by === "perPlay" ? (plays > 0 ? count / plays : 0)
          : count;
      (all.get(name) ?? all.set(name, []).get(name)!).push({ id: p.id, v });
    }
  }
  const out = new Map<string, NameStat>();
  for (const [name, rows] of all) {
    // 같은 값이면 id로 갈라 조회할 때마다 임자가 바뀌지 않게 한다.
    const top = [...rows].sort((a, b) => b.v - a.v || a.id.localeCompare(b.id))[0];
    out.set(name, { id: top.id, med: median(rows.map((r) => r.v)), top: top.v });
  }
  return out;
}

/** 이름 하나에 대한 무리 전체의 그림 — 임자와, 그 무리의 한가운데 값. */
interface NameStat {
  /** 그 이름을 가장 크게 쓰는 사람. */
  id: string;
  /** 그 이름을 쓰는 사람들의 한가운데 값 — '상대적으로 앞서는가'를 재는 기준선이다. */
  med: number;
  /** 1등 값 — 지금은 안 쓰지만 근거 문장을 늘릴 때 필요하다. */
  top: number;
}

interface NameOwners {
  spell: Map<string, NameStat>;
  unit: Map<string, NameStat>;
  build: Map<string, NameStat>;
}

function signature(
  id: string, s: MemberStats, used: Set<string>, owners: NameOwners,
): Epithet | null {
  const seed = seedOf(id);
  const m = s.buildMix;
  if (m) {
    /* 마법을 유닛보다 먼저 본다(지적: 단순히 많이 뽑은 유닛은 재미가 없다) — 스톰·리콜처럼
       쓰기 어려운 것은 한 번만 나와도 그 사람 이야기가 되지만, 많이 뽑은 유닛은 대개 그
       종족의 주력이라 종족이 같으면 다 같은 말이 된다.
       비중을 안 따지는 것도 그래서다 — 가장 많이 쓴 것 하나면 충분하다. */
    const skill = topSpell(m.skills);
    /** 마법 한 줄 만들기 — 사전에 있으면 그 말을, 없으면 문틀을(아주 많이 쌓였을 때만). */
    const skillLine = (): Epithet | null => {
      if (!skill || owners.spell.get(skill.name)?.id !== id || skill.score < SKILL_MIN_SCORE) return null;
      const special = SPELL_SPECIAL[skill.name];
      const t = (special && pick(special.map((label) => () => label), skill.name, seed, used))
        || (skill.score >= SKILL_PLAIN_SCORE ? pick(SKILL_SAYS, skill.name, seed, used) : null);
      return t ? { label: t, why: `경기에서 ${skill.name} ${skill.count}번` } : null;
    };
    // 드문 마법만 유닛보다 앞이다(SKILL_RARE_SCORE) — 나머지는 아래에서 마지막으로 본다.
    if (skill && owners.spell.get(skill.name)?.id === id && skill.score >= SKILL_RARE_SCORE) {
      const t = skillLine();
      if (t) return t;
    }
    /* 병력의 3분의 1을 한 유닛이 차지하면 그건 주력이 아니라 고집이다 — 4분의 1에서 올렸다:
       그 정도는 어느 종족에나 있는 주력 비중이라 "닥치고 ○○"이라 부를 만한 그림이 아니다.
       일꾼·보급은 애초에 이 원장에 없다(replayBuildMix) — 그래서 이 비율이 곧 병력 구성이다. */
    for (const unit of topList(m.units, UNIT_KO)) {
      /* 임자(그 유닛 비중이 가장 큰 사람)만 그 이름으로 불린다(지적: 질럿이 네 명). 한때
         "비중 50% 넘으면 임자가 아니어도"라는 예외를 뒀는데, 프로토스 넷이 다 질럿 절반을
         넘겨 그 예외가 곧 규칙이 됐다. 문틀을 달리해도 표에서는 결국 질럿 이야기가 네 줄이다. */
      /* 임자이면서, 무리 한가운데보다 확실히 앞서야 한다(지적: 제 기록 안에서 비중이 높다고
         줄 것이 아니라 회원들 간 상대 우위를 봐야 한다) — 다들 질럿이 6할인 클럽에서 6할은
         평범한 값이고, 그 안에서 8할인 사람만 "질럿밖에 몰라"라 부를 수 있다. */
      const own = owners.unit.get(unit.name);
      if (!own || own.id !== id || unit.share < own.med * NAME_EDGE) continue;
      // 두 번째·세 번째 유닛은 비중이 낮게 마련이라 문턱도 낮춘다 — 그래도 넷 중 하나는
      // 되어야 "그 유닛으로 푸는 사람"이라 부를 수 있다.
      /* 판당 몇 기는 뽑았어야 한다(지적) — 비중만 보면 한 판에서 몰아 뽑은 사람도 통과한다.
         스무 판에 스무 기면 판당 한 기라, 그 유닛으로 판을 푼다고 말하기 어렵다. */
      const perPlay = (s.mixPlays ?? 0) > 0 ? unit.count / (s.mixPlays as number) : 0;
      if (unit.count < 10 || perPlay < 2) continue;
      if (unit.share < (unit === topList(m.units, UNIT_KO)[0] ? 0.33 : 0.25)) continue;
      const t = pick(UNIT_SAYS, unit.name, seed, used);
      if (t) return { label: t, why: `${unit.name}${ga(unit.name)} 병력의 ${Math.round(unit.share * 100)}%` };
    }
    /* 건물은 마지막이다 — 종족이 정해지면 짓는 것도 대체로 정해져서, 유닛·마법만큼 그
       사람을 가르지 못한다. */
    for (const build of topList(m.buildings, BUILDING_KO)) {
      const ownB = owners.build.get(build.name);
      // 건물은 판당 몇 채로 잰다(위 perPlay 주석) — 비중만 보면 몇 채 안 지은 사람이 임자가 된다.
      const perPlay = (s.mixPlays ?? 0) > 0 ? build.count / (s.mixPlays as number) : 0;
      if (!ownB || ownB.id !== id || perPlay < ownB.med * NAME_EDGE) continue;
      if (build.count < 10) continue;
      const t = pick(BUILD_SAYS, build.name, seed, used);
      if (t) return { label: t, why: `${build.name}${ga(build.name)} 판당 ${perPlay.toFixed(1)}채` };
    }
    // 흔한 마법은 여기까지 와서야 차례다(요청: 기술 사용은 아래로) — 유닛·건물이 할 말을
    // 다 했는데도 부를 것이 없을 때만 "스톰 마스터"가 된다.
    const late = skillLine();
    if (late) return late;
  }
  /* 전적만 보고 지어 주던 말들("묵묵히 한 판 더", "다음 판의 주인공" 등)은 통째로 걷었다
     (요청: 그냥 주는 칭호보다 차라리 칭호 없음). 누구에게나 해당하는 말은 그 사람을 가리키지
     못하고, 표에 여러 줄이 그런 말로 서면 정작 진짜 칭호까지 그저 그런 장식으로 읽힌다.
     여기까지 와서 부를 것이 없으면 화면이 그 자리를 "칭호 없음"으로 적는다. */
  return null;
}

/** 회원 → 칭호. 왕관은 넘겨받은 무리 안에서만 매기므로, 부르는 쪽이 '검색에 걸린 목록'이
 *  아니라 '그 조건의 회원 전체'를 넘겨야 한다(메달과 같은 원칙) — 이름을 검색했다고 칭호가
 *  옮겨 다니면 그건 기록이 아니라 화면 효과다. */
export function epithetsOf(pool: EpithetSubject[]): Map<string, Epithet> {
  const out = new Map<string, Epithet>();
  const used = new Set<string>();
  const ranked = pool.filter((p) => p.stats.plays >= MIN_PLAYS);

  /** 임자가 정해진 칭호 하나 — 아직 나눠 주기 전의 '자격'이다. */
  interface Claim {
    title: Title;
    id: string;
    label: string;
    raw: number;
    /** 겨룰 점수(무게 × 횟수 또는 무게 × 한가운데 대비 배수). 무게가 없으면 0이라 표 차례로 간다. */
    score: number;
    order: number;
    /** 이 사람이 그 값의 1등인가 — 근거 문장과 아래 sticky 판정에 쓴다. */
    first: boolean;
    /** 나눠 줄 때의 급 — sticky 칭호의 1등만 0급으로 앞당겨진다(Title.sticky 주석). */
    rank: number;
  }
  const claims: Claim[] = [];
  TITLES.forEach((title, order) => {
    // 급마다 뛴 판 문턱이 다르다(MIN_PLAYS_TIER) — 못 넘긴 사람은 후보에서 아예 빠진다.
    const need = MIN_PLAYS_TIER[title.tier ?? 2] ?? MIN_PLAYS;
    const vals = ranked
      .filter((p) => p.stats.plays >= need)
      .map((p) => ({ id: p.id, v: title.value(p.stats, p), stats: p.stats, of: p }))
      // 판수 대비 문턱(Title.minPlaysShare) — 그 사람 판의 몇 할에서는 나왔어야 한다.
      .filter((x) => title.minPlaysShare === undefined
        || (x.v ?? 0) >= x.stats.plays * title.minPlaysShare)
      .filter((x): x is { id: string; v: number; stats: MemberStats; of: EpithetSubject } =>
        x.v !== null && x.v > 0);
    if (vals.length < (title.pool ?? MIN_POOL)) return;
    const top = Math.max(...vals.map((x) => x.v));
    if (title.min !== undefined && top < title.min) return;
    /* 이름이 들어가는 칭호는 사람마다 임자가 따로 서므로(아래 winners) 문턱도 사람마다
       걸어야 한다(요청: 종족별 승률 퀸은 진짜 승률이 높은 경우만) — 1등 값만 보고 통과시키면
       그 아래 사람들이 문턱을 한참 밑돌아도 함께 딸려 나간다. */
    if (title.name && title.min !== undefined) {
      const kept = vals.filter((x) => x.v >= title.min!);
      vals.length = 0;
      vals.push(...kept);
      if (vals.length === 0) return;
    }
    const med = median(vals.map((x) => x.v));
    if (top < med * (title.edge ?? CROWN_EDGE)) return;
    /* 1등에게만 준다(지적: 포토러시가 더 많은 사람이 있는데 그다음 사람이 퀸이 됐다).
       한때는 1등이 다른 칭호를 가져가면 다음 사람에게 물려줬는데, 그러면 "퀸"·"절대자"처럼
       1위를 뜻하는 말이 1위가 아닌 사람에게 붙는다 — 그 말이 거짓이 되는 순간 나머지 칭호도
       같이 못 믿을 말이 된다. 임자가 다른 칭호로 가면 이 칭호는 그냥 안 나간다.
       공동 1위는 그대로 후보이고, 그중 먼저 걸린 한 사람이 가져간다. */
    /* 이름이 말에 들어가는 칭호(맵·종족)는 사람마다 다른 칭호다 — "헌터스의 여주인"과
       "투혼의 황녀"는 서로 겨룰 일이 없다. 그래서 1등만 뽑지 않고 문턱을 넘은 사람 모두가
       후보다(지적: 맵 칭호가 한 명한테만 나왔다). 나머지 칭호는 그대로 1등에게만 간다. */
    const winners = title.name ? vals : vals.filter((x) => x.v === top);
    // 2등 값 — 1위가 얼마나 벌렸나(아래 leadBonus). 뒤가 아무도 없으면 null.
    const belows = vals.map((x) => x.v).filter((v) => v < top);
    const second = belows.length ? Math.max(...belows) : null;
    // 그 무리의 절반이 넘게 걸리면 그건 특징이 아니라 평균이다(수치 칭호에만 해당한다 —
    // 전술은 여럿이 같은 횟수인 것이 흔하고, 그래도 '한 칭호는 한 사람'은 아래에서 지킨다).
    if ((title.pool ?? MIN_POOL) > 1 && winners.length > vals.length / 2) return;
    for (const w of winners) {
      const label = title.name
        ? title.label.replace("{n}", title.name(w.stats, w.of) ?? "")
        : title.label;
      if (!label || label.includes("{n}")) continue;
      // 전술은 횟수 그대로, 수치는 '한가운데의 몇 배'로 바꿔 곱한다(Title.scale 주석).
      const base = title.scale === "count" ? w.v : (med > 0 ? w.v / med : 1);
      const boost = TIER_BOOST[title.tier ?? 2] ?? 1;
      /* 1위라는 사실 자체에 웃돈을 얹는다(요청) — 다만 '겨우 1위'와 '독보적 1위'는 다른
         말이라, 2등과 얼마나 벌렸는지로 크기를 정한다. 뒤가 없으면(혼자만 한 일) 최대다.
         이 웃돈이 있어야 어중간한 여러 칭호가 아니라 그 사람이 확실히 앞서는 하나가
         고른다 — 압도적인 자리는 그 사람을 부르는 말로 제일 알맞다. */
      const gap = second === null ? 1 : (second > 0 ? Math.min(1, (top - second) / second) : 1);
      const leadBonus = 1 + gap;
      claims.push({
        title, id: w.id, label, raw: w.v,
        score: (title.weight ?? 0) * base * boost * leadBonus, order,
        // sticky만 절대 우선이다(참여수 1위) — 나머지는 급을 웃돈으로 받아 점수로 겨룬다.
        first: w.v === top, rank: title.sticky ? 0 : 1,
      });
    }
  });

  /* 나눠 주는 차례: 점수(무게 × 횟수 또는 배수 × 급 웃돈)가 큰 것부터, 같으면 표 차례다.
     딱 하나, 참여수 1위(sticky)만 그 앞에 선다.
     한 사람은 한 칭호, 한 칭호는 한 사람 — 먼저 걸린 쪽이 가져간다.
     맵 칭호(name이 있는 줄)만은 사람마다 맵 이름이 달라 서로 다른 칭호로 친다. */
  claims.sort((a, b) =>
    (a.rank - b.rank)
    || (b.score - a.score) || (a.order - b.order) || a.id.localeCompare(b.id));
  for (const c of claims) {
    if (out.has(c.id) || used.has(c.label)) continue;
    /* 근거를 함께 남긴다(지적: "왜 이 칭호가 나오지?") — 칭호는 기록에서 나온다고 말은
       하는데 정작 그 기록을 볼 길이 없었다. 화면은 이 문장을 툴팁·글자로 보여 준다.
       수는 소수점을 안 적는다: 비율 칭호(0.42)까지 그대로 적으면 무슨 값인지 되레 헷갈린다. */
    const shown = c.raw >= 10 || Number.isInteger(c.raw)
      ? `${Math.round(c.raw)}`
      : `${Math.round(c.raw * 100)}%`;
    out.set(c.id, {
      label: c.label,
      // 꼬리는 무엇을 잰 값이냐에 따라 다르다 — 횟수는 '최다', 승률·비중은 '1위'가 맞는 말이다.
      why: `${c.title.why ?? "기록"} ${shown}${c.title.unit ?? ""}`
        + (c.first ? (c.title.scale === "count" ? " — 클럽 최다" : " — 클럽 1위") : ""),
    });
    used.add(c.label);
  }

  /* 이름마다 임자를 먼저 정한다(위 ownersOf) — 가장 많이 쓴 사람만 그 이름으로 불리고,
     그 사람이 딴 칭호를 받았으면 그 이름은 아무에게도 안 간다. */
  const owners: NameOwners = {
    spell: ownersOf(pool, (m) => m.skills, SPELL_KO),
    unit: ownersOf(pool, (m) => m.units, UNIT_KO, "share"),
    build: ownersOf(pool, (m) => m.buildings, BUILDING_KO, "perPlay"),
  };
  for (const p of pool) {
    if (out.has(p.id) || p.stats.plays < MIN_PLAYS) continue;
    const found = signature(p.id, p.stats, used, owners);
    if (!found) continue;
    out.set(p.id, found);
    used.add(found.label);
  }
  return out;
}
