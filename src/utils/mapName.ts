// 맵 이름을 화면에 보여줄 때만 특수문자를 지운다(요청) — DB에는 원본 맵 이름을 그대로 저장하고,
// 표시(기록실 경기목록·경기 상세)와 리플레이 파일명에서만 정리한다.
// "특수문자"는 색상코드(제어문자)나 기호류를 말하고, ()[].-_~<> 같은 일반 문장 기호는 특수문자가
// 아니므로 그대로 둔다(요청). 즉 글자(모든 언어)·숫자·공백·밑줄과 이 문장기호만 남긴다.
// (백엔드 build_replay_display_name의 맵 정리 규칙과 동일하게 맞춘다.)
const MAP_SPECIAL = /[^\p{L}\p{N}_\s()[\].<>~-]/gu;

export function cleanMapName(mapName: string | null | undefined): string {
  if (!mapName) return "";
  return mapName.replace(MAP_SPECIAL, "").replace(/\s+/g, " ").trim();
}
