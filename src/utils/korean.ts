// 한글 조사(받침에 따라 갈리는 것들). 리플레이 요약 문장을 만드는 쪽에서 여러 모듈이
// 함께 쓰므로 따로 뺐다.
//
// 한글 음절 코드 = 0xAC00 + (초성*21 + 중성)*28 + 종성 이므로, 마지막 글자에서 % 28 이
// 곧 종성(받침) 인덱스다. 0이면 받침이 없다.
//
// 게임 아이디는 영문도 많다. 영문은 코드로 받침을 셀 수 없지만 한국어로 읽는 소리는
// 대체로 정해져 있어서, 그 소리의 끝을 보고 가른다(요청).
//
//   l  → ㄹ   Bill 빌, Cool 쿨
//   m  → ㅁ   Sam 샘, Storm 스톰
//   n  → ㄴ   Sean 션, Kwon 권
//   ng → ㅇ   Flying 플라잉
//
// 두 가지를 따로 봐준다.
//   - 끝의 묵음 e는 떼고 본다: Miracle 미라클, Nine 나인, Game 게임 — 글자는 e로 끝나도
//     소리는 앞 자음이 받침이 된다.
//   - r은 받침으로 치지 않는다: Boxer 박서, Winner 위너, Star 스타. 철자만 보고 r을 받침에
//     넣으면 오히려 대부분 틀린다.
// 나머지 자음은 한국어로 읽을 때 뒤에 모음이 붙어(트·크·스·프) 받침이 되지 않는다.

/** 영문 이름의 끝소리가 받침으로 남는지 — 남으면 그 종성 인덱스, 아니면 null. */
function enJongseong(word: string): number | null {
  let w = word.toLowerCase();
  // 묵음 e는 l·m·n 뒤에서만 뗀다 — Fire(파이어)처럼 r 뒤는 어차피 받침이 아니다.
  if (/[lmn]e$/.test(w)) w = w.slice(0, -1);
  if (/ng$/.test(w)) return 21; // ㅇ
  if (/l$/.test(w)) return 8;   // ㄹ
  if (/m$/.test(w)) return 16;  // ㅁ
  if (/n$/.test(w)) return 4;   // ㄴ
  // 숫자로 끝나는 아이디 — 읽는 법이 갈리지 않는 것만 본다. 1·7은 원/일, 세븐/칠 어느 쪽으로
  // 읽어도 받침이 있다. 3·6·8·9·0은 읽기에 따라 갈려(삼/쓰리, 팔/에이트) 건드리지 않고,
  // 2·4·5는 어느 쪽도 받침이 없어 기본값 그대로면 된다.
  if (/[17]$/.test(w)) return 8;
  return null;
}

/** 마지막 글자의 종성 인덱스. 판단할 수 없으면 null. */
function jongseong(word: string): number | null {
  const ch = word.charCodeAt(word.length - 1);
  if (Number.isNaN(ch)) return null;
  if (ch >= 0xac00 && ch <= 0xd7a3) return (ch - 0xac00) % 28;
  return enJongseong(word);
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

/** ~라는 / ~이라는 */
export function ira(w: string): string {
  const j = jongseong(w);
  return j === null || j === 0 ? `${w}라는` : `${w}이라는`;
}
