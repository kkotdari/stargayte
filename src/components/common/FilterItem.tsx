import type { ReactNode } from "react";

interface FilterItemProps {
  label: string;
  children: ReactNode;
}

// 필터창 안 항목(알약탭 묶음/월선택/정렬버튼 등) 하나를 감싸 좌상단에 그게 뭘 고르는
// 항목인지 알려주는 작은 라벨을 붙인다 — 항목이 여러 개로 늘면서(예: 경기 화면의
// 기간+월+정렬) 라벨 없이는 눈으로 구분이 안 됐다(요청: "필터 항목 좌상단에 작게 라벨
// 표시").
export default function FilterItem({ label, children }: FilterItemProps) {
  return (
    <div className="scr-filter-item">
      <span className="scr-filter-item-label">{label}</span>
      {children}
    </div>
  );
}
