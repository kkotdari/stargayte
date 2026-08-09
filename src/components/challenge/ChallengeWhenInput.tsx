import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "../../utils/format";
import { formatWhen, DATE_INPUT_MIN, DATE_INPUT_MAX } from "../../utils/date";
import { openPicker, TIME_NOTE_MAX, TIME_NOTE_PLACEHOLDER } from "../common/OptionalDateTimeFields";
import { attachPopover } from "../../utils/popover";
import type { Challenge } from "../../types";

/* 인박스 편지지의 일시 — 제목 줄 한 자리에서 '보여주기'와 '적기'를 겸한다(요청: "인박스에서
   날짜·언제를 밑에 중복 표시하지 말고 맨 위에만 표시하고, 아직 입력 안 된 경우 날짜 입력 ·
   언제 입력 버튼을 띄워 팝오버로 입력되게").

   여태 응답자는 같은 값을 두 번 봤다 — 제목 옆에 글로 한 번, 그 아래 입력칸으로 또 한 번.
   편지 한 통에 같은 사실이 두 자리를 차지하면 어느 쪽이 진짜인지부터 헷갈린다. 자리를
   하나로 합치고, 아직 안 정해진 칸만 버튼으로 남겨 누르면 그 자리에서 적게 한다.

   팝오버인 이유: 이 줄은 제목 옆이라 인풋을 그대로 눕힐 자리가 없고, 칸을 펼치면 줄 높이가
   눌렀나 안 눌렀나에 따라 달라져 편지지가 흔들린다. 팝오버는 흐름 밖에 떠서 그 둘을 다
   피한다(자리 계산은 Floating UI에 맡긴다 — utils/popover 주석 참고). */

/** 값 하나를 적는 팝오버 한 칸 — 트리거(버튼)와 그 안의 입력칸. */
function WhenPop({ label, filled, children }: {
  /** 아직 안 적었을 때 버튼에 쓸 말("날짜 입력"). */
  label: string;
  /** 이미 적혀 있으면 그 값을 트리거에 그대로 보여준다 — 눌러서 고칠 수 있다. */
  filled?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !ref.current || !popRef.current) return;
    return attachPopover(ref.current, popRef.current, { maxWidth: 232 });
  }, [open]);

  // 바깥을 누르면 닫는다 — Select와 같은 방식이되, 여기서는 그 클릭을 삼키지 않는다.
  // 이 팝오버는 편지지 위에 뜨는데 그 아래가 카드 펼침/접힘이라, 클릭을 삼키면 "닫으려고
  // 눌렀는데 아무 일도 안 일어나는" 한 박자가 생긴다.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  return (
    <div className="scr-when-pop" ref={ref}>
      <button
        type="button"
        className={cx("scr-when-pop-trigger", filled && "scr-when-pop-filled", open && "scr-when-pop-open")}
        onClick={() => setOpen((v) => !v)}
      >
        {filled || label}
      </button>
      {open && createPortal(
        <div className="scr-when-pop-panel" ref={popRef}>
          {children(() => setOpen(false))}
        </div>,
        document.body,
      )}
    </div>
  );
}

export default function ChallengeWhenInput({
  challenge, dateStr, onDateChange, noteStr, onNoteChange, dateLocked, noteLocked, invalid,
}: {
  challenge: Challenge;
  dateStr: string;
  onDateChange: (v: string) => void;
  noteStr: string;
  onNoteChange: (v: string) => void;
  /** 부른 사람이 정해서 보낸 값 — 응답자는 못 바꾼다(요청). 글로만 보여준다. */
  dateLocked: boolean;
  noteLocked: boolean;
  /** 일정을 안 정하고 승락을 눌렀을 때 — 아직 빈 버튼에 테두리로 알린다. */
  invalid?: boolean;
}) {
  const date = dateLocked ? (challenge.scheduledDate ?? "") : dateStr;
  const note = (noteLocked ? challenge.scheduledTimeNote : noteStr).trim();

  return (
    <div className={cx("scr-challenge-when", invalid && "scr-challenge-when-invalid")}>
      {/* 잠긴 값(부른 사람이 정해서 보낸 것)만 글이고, 내가 적을 수 있는 자리는 값이
          채워진 뒤에도 계속 버튼이다 — 적는 도중에 버튼이 글로 바뀌면 그 순간 팝오버가
          통째로 사라져 한 글자 치고 나면 입력칸을 잃는다(실측). 채워진 뒤에는 버튼이
          그 값을 그대로 입고 있어, 다시 누르면 고칠 수 있다. */}
      {dateLocked ? (
        <span className="scr-challenge-when-value">{formatWhen(date, { empty: "일정 미정" })}</span>
      ) : (
        <WhenPop label="날짜 입력" filled={dateStr ? formatWhen(dateStr, { empty: "" }) : undefined}>
          {(close) => (
            <input
              type="date" className="scr-input" autoFocus
              value={dateStr} min={DATE_INPUT_MIN} max={DATE_INPUT_MAX}
              onClick={openPicker}
              onChange={(e) => { onDateChange(e.target.value); if (e.target.value) close(); }}
            />
          )}
        </WhenPop>
      )}
      {/* 가운뎃점은 양쪽에 무언가 서 있을 때만 — 한쪽이 비면 점만 덩그러니 남는다. */}
      <span className="scr-challenge-when-sep" aria-hidden>·</span>
      {noteLocked ? (
        <span className="scr-challenge-when-value">{note}</span>
      ) : (
        <WhenPop label="언제 입력" filled={note || undefined}>
          {(close) => (
            <input
              type="text" className="scr-input" autoFocus
              value={noteStr} maxLength={TIME_NOTE_MAX} placeholder={TIME_NOTE_PLACEHOLDER}
              onChange={(e) => onNoteChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") close(); }}
            />
          )}
        </WhenPop>
      )}
    </div>
  );
}
