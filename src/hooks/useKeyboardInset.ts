import { useEffect, useState } from "react";

// 모바일 키보드가 뜬 만큼(px)을 돌려준다 — visualViewport가 줄어든 만큼을 키보드 높이로
// 본다. SearchFilterBar(키보드 위로 검색창을 띄우는 용도)와 MobileTabBar(키보드가 뜨면
// 탭바를 자동으로 숨기는 용도, 요청: "키보드 활성화시 자동으로 탭바 숨기기")가 함께
// 쓴다 — 원래 SearchFilterBar 안에만 있던 로직을 공용으로 뺐다.
export function useKeyboardInset(): number {
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    // 120px 문턱을 "키보드가 떴다"고 볼지 말지 판단할 때만 쓰고, 일단 뜬 뒤로는(engaged)
    // 문턱과 무관하게 실제 inset 값을 그대로 계속 따라간다 — 전엔 닫히는 도중 inset이
    // 120 밑으로 내려가는 순간 바로 0으로 뚝 떨어져서, 키보드는 아직 다 안 내려갔는데
    // 검색창만 먼저 원위치로 내려와버렸다(실제로 지적받은 문제 — "키보드보다 검색창이
    // 먼저 내려와서 정신없는 문제"). 진짜로 0까지 다 닫혔을 때만 engaged를 끈다.
    // vv.offsetTop은 뺀다 — 키보드가 뜬 채로 목록을 스크롤하면 iOS가 포커스된 입력을
    // 보여주려고 비주얼 뷰포트를 위아래로 미세하게 패닝하면서 이 값이 스크롤할 때마다
    // 흔들리는데, 그걸 그대로 inset에 반영하면 스크롤할 때마다 필터/검색창이 덩달아
    // 위아래로 튀었다(실제로 지적받은 문제). 키보드 높이 자체는 offsetTop과 무관하게
    // innerHeight-vv.height만으로 구해지고, 'scroll' 이벤트도 같은 이유로 안 듣는다 —
    // 키보드 높이가 실제로 바뀔 때(resize)만 다시 계산한다.
    // 그래도 간헐적으로 필터/검색창만 아주 위로 튀는 문제가 남아있었다(실제로 지적받은
    // 문제 — "탭바는 정상 위치인데 필터랑 검색창만 저 위로 올라감") — 탭바는 이 JS
    // 계산과 무관한 순수 flex 레이아웃이라 멀쩡했던 반면, 이 인풋은 resize 이벤트가
    // 연달아 여러 번(키보드 애니메이션 도중 중간값들) 올 때마다 매번 즉시 반영해서, 그
    // 중간값이 실제보다 크게 튀면 그대로 화면에 반영됐다. 아래 두 가지로 방어한다:
    // (1) 이벤트가 잠깐 멎을 때까지 기다렸다가(짧은 디바운스) 마지막 값만 반영,
    // (2) 그래도 비정상적으로 큰 값(화면 높이의 60% 초과)은 키보드 높이일 수 없으니
    // 그대로 믿지 않고 화면 높이 기준으로 상한을 둔다.
    let engaged = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const commit = () => {
      const raw = Math.max(0, window.innerHeight - vv.height);
      const inset = Math.min(raw, window.innerHeight * 0.6);
      if (!engaged && inset > 120) engaged = true;
      if (!engaged) return;
      setKeyboardInset(inset);
      if (inset <= 0) engaged = false;
    };
    const onResize = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(commit, 100);
    };
    vv.addEventListener("resize", onResize);
    commit();
    return () => {
      vv.removeEventListener("resize", onResize);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, []);

  return keyboardInset;
}
