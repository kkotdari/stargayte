// 한글 조사(받침에 따라 갈리는 것들). 리플레이 요약 문장을 만드는 쪽에서 여러 모듈이
// 함께 쓰므로 따로 뺐다.
//
// 한글 음절 코드 = 0xAC00 + (초성*21 + 중성)*28 + 종성 이므로, 마지막 글자에서 % 28 이
// 곧 종성(받침) 인덱스다. 0이면 받침이 없다.

function jongseong(word: string): number | null {
  const ch = word.charCodeAt(word.length - 1);
  if (Number.isNaN(ch) || ch < 0xac00 || ch > 0xd7a3) return null; // 한글이 아니면 판단 불가
  return (ch - 0xac00) % 28;
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
