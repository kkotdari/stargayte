import { ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "../../utils/format";

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

// 페이지 번호를 다 나열하지 않고, 현재 페이지 주변 + 처음/끝만 보여주고 나머지는 "…"로 줄인다
function buildPageList(page: number, totalPages: number): (number | "…")[] {
  const pages = new Set<number>([1, totalPages, page, page - 1, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const result: (number | "…")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) result.push("…");
    result.push(p);
  });
  return result;
}

// 회원 화면/로그인 이력처럼 한 화면에 다 보여주기엔 많은 목록 공용 페이지네이션
export default function Pagination({ page, totalPages, onChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="scr-pagination">
      <button
        type="button"
        className="scr-pagination-btn scr-pagination-nav"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label="이전 페이지"
      >
        <ChevronLeft size={14} />
      </button>
      {buildPageList(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span key={`ellipsis-${i}`} className="scr-pagination-ellipsis">…</span>
        ) : (
          <button
            type="button"
            key={p}
            className={cx("scr-pagination-btn", p === page && "scr-pagination-btn-active")}
            onClick={() => onChange(p)}
            aria-current={p === page || undefined}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        className="scr-pagination-btn scr-pagination-nav"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="다음 페이지"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
