import type { ReactNode } from "react";
import { cx } from "../../utils/format";

// 카드 인라인 폼 공통 펼침/접힘 래퍼(요청: "리벤지 신청·재도전 등 카드 인라인 폼에
// 트랜지션 — 지금보다 길고 부드럽게, 취소로 원복될 때도"). 조건부 마운트(`open && <폼/>`)는
// 닫는 순간 DOM이 사라져 접힘 애니메이션을 그릴 수 없으므로, 래퍼를 늘 마운트해 두고
// grid-template-rows 0fr↔1fr로 내용 높이를 자동 추적하며 접었다 편다(한마디 입력창
// .scr-challenge-msg-wrap과 같은 기법의 일반화). 닫힘 상태는 visibility+aria-hidden으로
// 클릭/포커스/보조기기 접근까지 막아 "없는 것"과 동일하게 동작한다.
export default function InlineCollapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={cx("scr-inline-collapse", open && "scr-inline-collapse-open")} aria-hidden={!open}>
      <div className="scr-inline-collapse-inner">{children}</div>
    </div>
  );
}
