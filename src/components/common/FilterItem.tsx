import type { ReactNode } from "react";

interface FilterItemProps {
  // 알약탭/월선택/날짜선택/정렬버튼처럼 내용만 봐도 뭘 고르는 항목인지 뻔한 경우엔
  // 라벨 없이 쓴다(요청: "기간 필터에서 날짜 표시 옆에는 굳이 라벨이 있을 필요는
  // 없을듯" + "정렬도 라벨 불필요") — 반대로 헷갈리는 항목(예: 회원 화면의 "상태")은
  // 계속 라벨을 넘겨 쓴다.
  label?: string;
  children: ReactNode;
}

// 필터창 안 항목(알약탭 묶음/월선택/정렬버튼 등) 하나를 감싼다 — 항목이 여러 개로
// 늘면서(예: 경기 화면의 기간+월+정렬) 구분이 안 되는 경우에만 좌상단에 작은 라벨을
// 붙인다(요청: "필터 항목 좌상단에 작게 라벨 표시").
export default function FilterItem({ label, children }: FilterItemProps) {
  return (
    <div className="scr-filter-item">
      {label && <span className="scr-filter-item-label">{label}</span>}
      {children}
    </div>
  );
}
