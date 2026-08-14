/* ── 모달 해시 (제거·요청: 히스토리 단순화) ──────────────────────────────────────
   모달이 열릴 때 주소 해시를 pushState로 얹고 닫힐 때 history.back()으로 되감던
   장치를 통째로 걷었다. 그 되감기가 다른 히스토리 소비자(전체 보기의 popstate 등)와
   계속 얽혀 "닫기를 눌렀는데 활동 목록으로 강제 이동" 같은 연쇄를 만들었다(고질 지적).

   이제 모달은 히스토리에 아무것도 남기지 않는다 — 닫기는 각 모달의 onClose가 직접
   한다. 뒤로가기로 모달을 닫는 기능은 함께 사라졌다(단순함이 우선이라는 결정).
   호출부의 <ModalHash …>는 그대로 두어도 아무 일도 하지 않는다 — 수십 군데를 한 번에
   걷어내는 대신 이 자리를 무해한 껍데기로 남긴다. */

export function useModalHash(_hash: string, _onClose: () => void): void {
  // 의도된 빈 몸 — 위 주석 참고.
}

/** 조건부 JSX 안에서도 쓰는 래퍼 — 이제 아무 일도 하지 않는 껍데기다(위 주석). */
export default function ModalHash(_props: { hash: string; onClose: () => void }) {
  return null;
}
