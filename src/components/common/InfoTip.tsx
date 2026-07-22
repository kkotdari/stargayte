import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

// 작은 정보 아이콘(ⓘ) — 탭/클릭하면 설명 말풍선을 띄운다. 통계표 컬럼 헤더처럼 가로
// 스크롤·sticky가 걸린 좁은 칸 안에서도 안 잘리게, 말풍선은 body로 포털해서 fixed 좌표로
// 아이콘 아래에 띄운다. 화면 어디를 탭하거나 스크롤하면 닫힌다. 정렬 버튼 안에 들어가도
// 정렬이 같이 눌리지 않게 클릭 전파를 막는다(모바일 우선이라 hover가 아니라 탭 토글).
// 지금 열려 있는 툴팁을 닫는 콜백 — 아이콘 클릭이 stopPropagation으로 document 클릭
// 리스너에 안 닿아, 다른 툴팁을 열어도 기존 툴팁이 안 닫히던 문제(지적됨)를 이 모듈
// 레벨 클로저 하나로 해결한다: 새 툴팁이 열릴 때 직전 것을 직접 닫는다.
let closeOpenTip: (() => void) | null = null;

export default function InfoTip({ text, label }: { text: string; label?: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const open = pos !== null;

  const toggle = (e: { stopPropagation: () => void; preventDefault: () => void }) => {
    e.stopPropagation();
    e.preventDefault();
    if (open) { setPos(null); closeOpenTip = null; return; }
    closeOpenTip?.(); // 다른 툴팁이 열려 있으면 먼저 닫는다(요청: 동시에 하나만).
    const r = ref.current?.getBoundingClientRect();
    if (r) {
      setPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
      closeOpenTip = () => setPos(null);
    }
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    // 아이콘 자체 클릭은 stopPropagation로 여기 안 닿으므로, 바깥 클릭이면 닫힌다.
    document.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      className="scr-infotip"
      role="button"
      tabIndex={0}
      aria-label={label ? `${label} 설명 보기` : "설명 보기"}
      onClick={toggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggle(e); }}
    >
      <Info size={12} />
      {open && pos && createPortal(
        <span
          className="scr-infotip-bubble"
          role="tooltip"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          {text}
        </span>,
        document.body,
      )}
    </span>
  );
}
