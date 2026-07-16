// 회원가입/프로필 입력 제약 — 요청: "로그인아이디 영문숫자 12글자, 비밀번호는 영문 숫자
// 기호 자유인데 최대 24글자, 닉네임은 제약없는대신 영문기준 최대 12(한글 6자)". 입력
// 자체는 막지 않고(플레이스홀더로 제약을 알려주기만 하고) 저장을 누를 때만 검사한다(요청:
// "강제 입력 불가 하지말고... 입력 자체는 막지 말아줘"). 기존에 이 제약을 벗어나는 값은
// 그대로 두고(운영자가 직접 정리) 신규 입력/수정에서만 걸린다.

export const LOGIN_ID_MAX_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 24;
// 영문 기준 16(= 한글로는 8자, 한글 1자를 2칸으로 셈하므로).
export const NICKNAME_MAX_WIDTH = 16;

const LOGIN_ID_PATTERN = /^[a-zA-Z0-9]+$/;

export function isValidLoginId(value: string): boolean {
  return value.length > 0 && value.length <= LOGIN_ID_MAX_LENGTH && LOGIN_ID_PATTERN.test(value);
}

export function isValidPasswordLength(value: string): boolean {
  return value.length <= PASSWORD_MAX_LENGTH;
}

// "영문 기준 글자 수" — 아스키(영문/숫자/기호)는 1칸, 한글 등 그 외 문자는 시각적으로
// 더 넓어 보이므로 2칸으로 셈한다.
export function displayWidth(value: string): number {
  let width = 0;
  for (const ch of value) width += /[\x00-\x7F]/.test(ch) ? 1 : 2;
  return width;
}

export function isValidNickname(value: string): boolean {
  return value.length > 0 && displayWidth(value) <= NICKNAME_MAX_WIDTH;
}

// 배틀태그 — "이름#숫자" 형식(예: Nickname#0000)인지만 확인한다. 이름 부분의 글자 종류나
// 길이는 제약하지 않고, "#" 뒤에 숫자가 붙어 있는지만 정규식으로 검사한다.
const BATTLETAG_PATTERN = /^.+#\d+$/;

export function isValidBattletag(value: string): boolean {
  return BATTLETAG_PATTERN.test(value.trim());
}
