import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { attachPopover } from "../../utils/popover";
import { cx } from "../../utils/format";

interface ReplayLocationHintProps {
  className?: string;
}

// "등록하기" 버튼 왼쪽에 두는 "리플레이 위치 확인" 링크 텍스트 — 누르면 오늘 플레이한
// 리플레이 파일이 보통 어디 있는지(Windows/Mac 기본 경로) 팝오버로 보여준다. 수기등록이
// 없어져 이 자리가 비면서, 아이콘 배지 대신 링크 텍스트로 바꿨다(요청).
export default function ReplayLocationHint({ className }: ReplayLocationHintProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !anchorRef.current || !popRef.current) return;
    return attachPopover(anchorRef.current, popRef.current, { growFromAnchor: true, maxWidth: 320 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // 포커스가 트리거/팝오버 바깥의 다른 요소로 이동하면(탭 이동 등 클릭이 아닌 경우 포함)
  // 곧바로 닫는다 — 달력 팝오버(DateField 등)와 같은 원칙.
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={cx("scr-replay-loc-trigger", className)}
        ref={anchorRef}
        onClick={() => setOpen((v) => !v)}
        title="리플레이는 어디에?"
      >
        리플레이는 어디에?
      </button>
      {open && createPortal(
        <div className="scr-replay-loc-pop" ref={popRef}>
          <div className="scr-replay-loc-row">
            <span className="scr-replay-loc-os">Windows</span>
            <span className="scr-mono">문서\StarCraft\Maps\Replays\AutoSave\원하는날짜</span>
          </div>
          <div className="scr-replay-loc-row">
            <span className="scr-replay-loc-os">Mac</span>
            <span className="scr-mono">~/Library/Application Support/Blizzard/StarCraft/Maps/Replays/AutoSave/원하는날짜</span>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
