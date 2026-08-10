import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { swallowNextClick } from "../../utils/bodyScrollLock";

// 작은 정보 아이콘(ⓘ) — 탭/클릭하면 설명 말풍선을 띄운다. 통계표 컬럼 헤더처럼 가로
// 스크롤·sticky가 걸린 좁은 칸 안에서도 안 잘리게, 말풍선은 body로 포털해서 fixed 좌표로
// 아이콘 아래에 띄운다. 화면 어디를 탭하거나 스크롤하면 닫힌다. 정렬 버튼 안에 들어가도
// 정렬이 같이 눌리지 않게 클릭 전파를 막는다(모바일 우선이라 hover가 아니라 탭 토글).
// 지금 열려 있는 툴팁을 닫는 콜백 — 아이콘 클릭이 stopPropagation으로 document 클릭
// 리스너에 안 닿아, 다른 툴팁을 열어도 기존 툴팁이 안 닫히던 문제(지적됨)를 이 모듈
// 레벨 클로저 하나로 해결한다: 새 툴팁이 열릴 때 직전 것을 직접 닫는다.
let closeOpenTip: (() => void) | null = null;

// size — 트리거 아이콘(ⓘ) 크기. 통계 헤더처럼 크게 쓰고 싶은 자리만 넘긴다(기본 12).
// trigger — 아이콘 대신 글자로 부르고 싶을 때(요청: 통계 제목 옆은 ⓘ가 아니라 "도움말").
//   표 헤더처럼 자리가 없는 곳은 그대로 아이콘이고, 제목 옆처럼 자리가 있는 곳은 글자가
//   무엇을 여는 버튼인지 그 자체로 말한다.
// triggerClassName — 트리거의 겉모습을 부르는 쪽이 통째로 정하고 싶을 때(통계 표의 칭호).
//   그런 자리는 이미 제 글자 규칙(크기·줄바꿈·정렬)을 갖고 있어서 여기 기본 꾸밈
//   (.scr-infotip의 inline-flex·muted·opacity)을 얹으면 그쪽이 어긋난다. 말풍선을 띄우는
//   일과 트리거가 어떻게 생겼는가는 서로 상관이 없으므로, 겉모습만 갈아 끼우게 열어 둔다.
/** 말풍선이 화면 가장자리에서 남길 최소 여백. */
const EDGE = 8;

export default function InfoTip(
  { text, label, size = 12, trigger, triggerClassName }:
  { text: string; label?: string; size?: number; trigger?: string; triggerClassName?: string },
) {
  // anchor는 아이콘의 자리 — 말풍선을 위로 뒤집을지 정하려면 아이콘의 위/아래가 다 필요하다.
  const [pos, setPos] = useState<{ top: number; left: number; anchorTop: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const open = pos !== null;

  const toggle = (e: { stopPropagation: () => void; preventDefault: () => void }) => {
    e.stopPropagation();
    e.preventDefault();
    if (open) { setPos(null); closeOpenTip = null; return; }
    closeOpenTip?.(); // 다른 툴팁이 열려 있으면 먼저 닫는다(요청: 동시에 하나만).
    const r = ref.current?.getBoundingClientRect();
    if (r) {
      setPos({ top: r.bottom + 6, left: r.left + r.width / 2, anchorTop: r.top });
      closeOpenTip = () => setPos(null);
    }
  };

  /* 말풍선을 화면 안으로 밀어 넣는다(지적: 화면 밖에 열린다) — 아이콘 중앙에 맞춰 띄우기만
     하면, 아이콘이 화면 왼쪽 끝에 있을 때(통계 제목 옆처럼) 폭의 절반이 왼쪽 밖으로 나간다.
     가로는 양옆 여백을 남기도록 좌우로 밀고, 세로는 아래로 넘칠 때만 아이콘 위로 뒤집는다.
     그린 뒤에 재야 실제 크기를 알 수 있어서 layout effect다(그려지기 전에 자리를 잡아
     한 프레임도 어긋난 자리에 안 보인다). */
  useLayoutEffect(() => {
    if (!open || !pos) return;
    const el = bubbleRef.current;
    if (!el) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    const half = w / 2;
    const left = Math.min(Math.max(pos.left, EDGE + half), window.innerWidth - EDGE - half);
    const flip = pos.top + h > window.innerHeight - EDGE;
    const top = flip ? Math.max(EDGE, pos.anchorTop - 6 - h) : pos.top;
    if (Math.abs(left - pos.left) > 0.5 || Math.abs(top - pos.top) > 0.5) {
      setPos({ ...pos, left, top });
    }
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    // 바깥 탭은 "툴팁 닫기" 전용(지적: 주변부 터치가 배경 요소를 활성화하면 안 됨) —
    // pointerdown 캡처에서 닫으면서 그 제스처를 삼키고, 리스너가 내려간 뒤 도착하는
    // click은 swallowNextClick이 마저 삼킨다. 아이콘/말풍선 안은 그대로 통과.
    const closeIfOutside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      e.preventDefault();
      e.stopPropagation();
      swallowNextClick();
      setPos(null);
    };
    const close = () => setPos(null);
    document.addEventListener("pointerdown", closeIfOutside, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      className={triggerClassName ?? `scr-infotip${trigger ? " scr-infotip-text" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={label ? `${label} 설명 보기` : "설명 보기"}
      onClick={toggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggle(e); }}
    >
      {trigger ? trigger : <Info size={size} />}
      {open && pos && createPortal(
        <span
          ref={bubbleRef}
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
