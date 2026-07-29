import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { cx } from "../../utils/format";
import { attachPopover } from "../../utils/popover";

export interface SelectOption {
  value: string;
  label: string;
  // 모바일 등 좁은 공간에서 label 대신 보여줄 축약 표시 (예: 종족 한 글자)
  shortLabel?: string;
  // 회원 선택처럼 옵션 앞에 프사를 붙이고 싶을 때(요청: "도전장 드롭다운에 아바타가
  // 없는데 똑같이 추가해줘") — <Avatar .../> 를 그대로 넘긴다.
  avatar?: React.ReactNode;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  size?: "md" | "sm";
  // 기본은 드롭다운 폭이 트리거와 정확히 같다(matchAnchor). 트리거 자체가 아주 좁게 고정된
  // 곳(예: 모바일 종족 칩 — 28px, 상단바 "내 화면"처럼 라벨 길이에 맞춰 좁아지는 트리거)
  // 에서는 그대로면 "프로토스" 같은 옵션 글자가 트리거보다 훨씬 넓어서 드롭다운이 다 잘려
  // 안 보인다. 그런 곳만 이 값을 줘서, 트리거 폭보다는 좁아지지 않으면서 실제 옵션 내용
  // (가장 긴 라벨) 크기에 맞게 자연스럽게 넓어지고(growToContent), 이 값은 그 상한으로만
  // 쓰인다 — 옵션이 짧으면 그만큼 좁게, 길어도 이 값을 넘어서진 않는다.
  minDropWidth?: number;
  disabled?: boolean;
  // 마운트되자마자 드롭다운을 펼친 채로 시작한다 — "+ 추가"를 누르면 그 자리가 이
  // Select로 바뀌는 흐름(도전장 폼의 상대/팀원 지목)에서, 한 번 더 눌러야 목록이
  // 열리는 단계를 없앤다. 인풋이 아니라 버튼 기반 드롭다운이라 모바일 가상 키보드는
  // 뜨지 않는다.
  defaultOpen?: boolean;
  // 열림/닫힘이 바뀔 때마다 알려준다 — defaultOpen으로 열어둔 채 시작하는 곳(도전장
  // 폼의 상대/팀원 지목)에서, 값을 안 고르고 바깥을 클릭/포커스 이동으로 닫힐 때도
  // 그 사실을 알아야 "선택 대기" 자리를 도로 접을 수 있다(요청: "너 나와! 신청 드롭다운
  // 포커싱을 잃어도 안없어지는 문제") — 지금까진 내부 open 상태만 닫힐 뿐 부모는
  // 몰라서, 빈 트리거+취소 버튼 자리가 계속 남아 있었다.
  onOpenChange?: (open: boolean) => void;
}

/*
  커스텀 셀렉트 박스
  - OS 기본 UI 대신 앱 테마에 맞춘 드롭다운
  - 키보드: Enter/Space 로 열기, 화살표로 이동, Enter 로 선택, Esc 로 닫기
  - 드롭다운은 body에 포털링하고 위치는 Floating UI(attachPopover)에 맡긴다. 모달 본문처럼
    overflow: hidden/auto 인 스크롤 영역 안에서 트리거가 열리면, 포털링하지 않을 경우 그
    영역의 overflow에 잘려 드롭다운이 화면 중간에서 잘려 보이는 문제가 있었다. 단, 모달
    안의 트리거라면 뷰포트가 아니라 그 모달 카드 영역을 경계로 삼아서, 반대로 모달
    밖(어두운 배경 위)으로 삐져나가 붕 떠 보이지 않게 한다.
*/
export default function Select({
  value, options, onChange, placeholder = "선택", className, size = "md", minDropWidth, disabled = false,
  defaultOpen = false, onOpenChange,
}: SelectProps) {
  const [open, setOpen] = useState(defaultOpen && !disabled);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => { onOpenChangeRef.current?.(open); }, [open]);
  const [activeIdx, setActiveIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  // 위치 계산/추적을 Floating UI에 맡긴다 — 스크롤/리사이즈에 따른 흔들림·지연·오작동을
  // 직접 다루려다 계속 문제가 재발해서, 이 문제를 이미 다듬어 놓은 라이브러리로 옮겼다.
  useEffect(() => {
    if (!open || !ref.current || !dropRef.current) return;
    return minDropWidth
      ? attachPopover(ref.current, dropRef.current, { growToContent: true, maxWidth: minDropWidth })
      : attachPopover(ref.current, dropRef.current, { matchAnchor: true });
  }, [open, minDropWidth]);

  // 바깥을 누르면 닫되, 그 첫 클릭 자체는 "삼켜서"(dismiss-only) 아래 요소(햄버거 버튼
   // 등)가 함께 눌리지 않게 한다(요청: 종족 드롭다운 열림 중 ① 햄버거 누르면 서랍이 같이
   // 열림 ② 다른 곳 누르면 그 클릭이 함께 적용됨 — 둘 다 "바깥 클릭이 dismiss로 소비되지
   // 않던" 같은 원인). 열려 있을 때만 문서 리스너를 달고, 캡처 단계에서 pointerdown을
   // 가로채 전파를 끊은 뒤 뒤따르는 click 한 번을 캡처에서 한 번만 삼킨다.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (dropRef.current?.contains(t)) return;
      setOpen(false);
      e.preventDefault();
      e.stopPropagation();
      const swallowClick = (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
        document.removeEventListener("click", swallowClick, true);
      };
      document.addEventListener("click", swallowClick, true);
      // 클릭 없이 끝나는 상호작용(드래그/취소) 대비 — 곧 정리한다.
      window.setTimeout(() => document.removeEventListener("click", swallowClick, true), 400);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === value);
      setActiveIdx(idx >= 0 ? idx : 0);
    }
  }, [open, value, options]);

  const commit = (v: string) => { onChange(v); setOpen(false); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
      e.preventDefault(); setOpen(true); return;
    }
    if (!open) return;
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, options.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); const o = options[activeIdx]; if (o) commit(o.value); }
  };

  return (
    <div className={cx("scr-cselect", size === "sm" && "scr-cselect-sm", className)} ref={ref}>
      <button
        type="button"
        className={cx("scr-cselect-trigger", open && "scr-cselect-open")}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        disabled={disabled}
      >
        <span className={cx("scr-cselect-value", !selected && "scr-cselect-placeholder")}>
          {selected ? (
            <>
              {/* 옵션에 프사가 있으면 트리거(선택된 값)에도 같이 보여준다 — 개인리그 대진
                  수정 드롭다운이 읽기전용 카드(아바타+이름)와 같은 모양이 되게(요청). */}
              {selected.avatar}
              <span className="scr-cselect-value-full">{selected.label}</span>
              {selected.shortLabel && (
                <span className="scr-cselect-value-short">{selected.shortLabel}</span>
              )}
            </>
          ) : (
            placeholder
          )}
        </span>
        <ChevronDown size={14} className="scr-cselect-caret" />
      </button>

      {open && createPortal(
        <div className={cx("scr-cselect-drop", "scr-scroll", className)} ref={dropRef}>
          {options.map((o, i) => (
            <button
              type="button"
              key={o.value}
              className={cx(
                "scr-cselect-opt",
                o.value === value && "scr-cselect-opt-selected",
                i === activeIdx && "scr-cselect-opt-active",
              )}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(o.value)}
            >
              {o.avatar}
              <span className="scr-cselect-opt-label">{o.label}</span>
              {o.value === value && <Check size={13} />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
