// 한글 조사(받침에 따라 갈리는 것들). 리플레이 요약 문장을 만드는 쪽에서 여러 모듈이
// 함께 쓰므로 따로 뺐다.
//
// 한글 음절 코드 = 0xAC00 + (초성*21 + 중성)*28 + 종성 이므로, 마지막 글자에서 % 28 이
// 곧 종성(받침) 인덱스다. 0이면 받침이 없다.
//
// 게임 아이디는 영문도 많다. 영문은 코드로 받침을 셀 수 없지만 읽는 소리는 정해져 있어서,
// l·m·n·r로 끝나면 그 소리가 그대로 받침이 된다(요청) — Miracle→미라클'이', Sean→션'은'.
// 나머지 자음은 한국어로 읽을 때 뒤에 모음이 붙어(트·크·스·프) 받침이 되지 않으므로
// 받침 없음으로 둔다.

/** 영문으로 끝나는 이름 중 소리가 받침으로 남는 것들. */
const EN_FINAL_CONSONANT = /[lmnr]$/i;

/** 마지막 글자의 종성 인덱스. 판단할 수 없으면 null. */
function jongseong(word: string): number | null {
  const ch = word.charCodeAt(word.length - 1);
  if (Number.isNaN(ch)) return null;
  if (ch >= 0xac00 && ch <= 0xd7a3) return (ch - 0xac00) % 28;
  // 영문 이름 — 받침으로 읽히는 끝소리만 '받침 있음'으로 친다. ㄹ은 '~로'가 붙어야 해서
  // 종성 인덱스 8(ㄹ)로 돌려준다.
  if (EN_FINAL_CONSONANT.test(word)) return /l$/i.test(word) ? 8 : 4;
  return null;
}

/** ~로 / ~으로 (받침이 없거나 ㄹ이면 "로"). */
export function ro(w: string): string {
  const j = jongseong(w);
  return j === null || j === 0 || j === 8 ? `${w}로` : `${w}으로`;
}

/** ~와 / ~과 */
export function wa(w: string): string {
  const j = jongseong(w);
  return j === null || j === 0 ? `${w}와` : `${w}과`;
}

/** ~가 / ~이 */
export function ga(w: string): string {
  const j = jongseong(w);
  return j === null || j === 0 ? `${w}가` : `${w}이`;
}

/** ~는 / ~은 */
export function neun(w: string): string {
  const j = jongseong(w);
  return j === null || j === 0 ? `${w}는` : `${w}은`;
}

/** ~를 / ~을 */
export function reul(w: string): string {
  const j = jongseong(w);
  return j === null || j === 0 ? `${w}를` : `${w}을`;
}
