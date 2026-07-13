import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

// 라이트 테마(흰 배경 + 검은 글씨 토글) — 로그인 화면과 로그인 후 헤더가 각자 독립적으로
// 켜고 끌 수 있는 같은 설정을 공유한다. html에 filter를 걸면 프사 같은 이미지까지 통째로
// 무채색이 돼버려서, 대신 .scr-light-theme 클래스로 테마 변수만 라이트 팔레트 값으로
// 바꿔치기한다(global.css 참고) — 이미지나 변수를 안 쓰는 색은 그대로 남는다.
const LIGHT_THEME_KEY = "scr-light-theme";

function applyLightTheme(on: boolean): void {
  document.documentElement.classList.toggle("scr-light-theme", on);
  localStorage.setItem(LIGHT_THEME_KEY, on ? "1" : "0");
}

// 새로고침해도, 로그인/로그아웃을 거쳐도 유지되도록 localStorage에 저장한다 — 대부분
// 한 사람이 로그인 화면과 로그인 후 화면을 오가며 쓰므로, 두 화면이 같은 테마 선택을
// 공유한다(로그아웃한다고 되돌리지 않는다). 로그인 화면(AuthScreen)과 헤더 둘 다 이
// 훅으로 마운트되는 즉시 저장된 값을 읽어와 이어서 쓴다.
export function useLightTheme(): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [on, setOn] = useState(() => localStorage.getItem(LIGHT_THEME_KEY) === "1");
  useEffect(() => { applyLightTheme(on); }, [on]);
  return [on, setOn];
}
