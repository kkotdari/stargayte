import { X, Calendar, Clock } from "lucide-react";
import { cx } from "../../utils/format";
import { DATE_INPUT_MIN, DATE_INPUT_MAX } from "../../utils/date";

// 네이티브 달력/시계 표시기를 CSS로 숨겼으므로, 데스크톱에서 입력칸을 눌렀을 때 피커가 열리게
// showPicker를 직접 호출한다(모바일은 인풋 포커스만으로 네이티브 피커가 열려 이 호출이
// 없어도/실패해도 무방하다 — 미지원·이미 열림은 조용히 무시).
export function openPicker(e: React.MouseEvent<HTMLInputElement>) {
  const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
  try { el.showPicker?.(); } catch { /* 미지원 또는 이미 열림 */ }
}

interface OptionalDateTimeFieldsProps {
  dateStr: string;
  onDateChange: (value: string) => void;
  timeStr: string;
  onTimeChange: (value: string) => void;
  // 이미 값이 정해져 온(요청자가 지정한) 칸은 응답자가 못 바꾸게 잠근다(요청: "이미 입력되어
  // 온 값은 수정불가 상태로 노출"). 날짜만 잠그고 시간은 열어둘 수도 있다(요청: "날짜가
  // 입력되었어도 시간은 별도로 입력 가능"). 잠긴 칸도 텍스트가 아니라 입력칸 모양 그대로 보인다.
  dateLocked?: boolean;
  timeLocked?: boolean;
  // 날짜/시간 둘 다 비어 있어도 되는 상태에서, 절반만 채운 값처럼 뜻이 애매한 경우
  // 호출부가 에러 테두리를 얹고 싶을 때(요청: "사유에 에러 테두리도 넣어줘야지"의 연장).
  invalid?: boolean;
}

// 도전장 쓰기/수락/리벤지 공용 — 날짜/시간 둘 다 처음부터 입력칸으로 보여준다(요청: "일자
// 시간은 텍스트가 아니라 인풋창 그대로 표출"). 시간은 날짜 없이는 의미가 없으므로 날짜가
// 비어 있으면 비활성화한다(요청: "시간만 입력은 못함"). 이미 정해져 온 값은 잠가서
// 수정 불가로 보여준다(요청).
export default function OptionalDateTimeFields({
  dateStr, onDateChange, timeStr, onTimeChange,
  dateLocked = false, timeLocked = false, invalid = false,
}: OptionalDateTimeFieldsProps) {
  const cls = `scr-input${invalid ? " scr-input-invalid" : ""}`;

  // 빈 시간 칸을 열면 21시로 시작한다(요청). 네이티브 시간 피커는 "열리는 순간"의 입력값을
  // 스냅하므로, onFocus에서 React 상태만 21:00으로 바꿔선 갱신이 비동기라 늦어 현재시각으로
  // 열린다 — pointerdown 시점에 DOM 값을 즉시 21:00으로 박고 상태도 함께 맞춰, 피커가 21시에
  // 열리게 한다. 날짜가 없으면 시간은 의미 없으니 손대지 않는다.
  const primeDefaultTime = (el: HTMLInputElement) => {
    if (dateStr && !timeStr) { el.value = "21:00"; onTimeChange("21:00"); }
  };

  return (
    <div className="scr-datetime-cols">
      <div className="scr-datetime-col">
        <label className="scr-field scr-datetime-input">
          <span className="scr-label">날짜 <span className="scr-label-optional">(선택)</span></span>
          <span className="scr-datetime-input-wrap">
            <input
              type="date" className={cx(cls, dateLocked && "scr-datetime-locked")} value={dateStr}
              min={DATE_INPUT_MIN} max={DATE_INPUT_MAX}
              readOnly={dateLocked} tabIndex={dateLocked ? -1 : undefined}
              onClick={dateLocked ? undefined : openPicker}
              onChange={dateLocked ? undefined : (e) => {
                const v = e.target.value;
                onDateChange(v);
                // 날짜를 지우면 시간도 비운다. 날짜를 골라도 시간은 자동으로 채우지 않는다 —
                // 시간 칸을 비워두면 그게 곧 "시간 미정"(날짜만 지정)이다(요청).
                if (!v) onTimeChange("");
              }}
            />
            {/* 스왑(요청): 맨 오른쪽 한 자리에서 — 값이 없으면 달력 아이콘(장식용,
                pointer-events:none이라 인풋을 눌러 피커를 연다), 값이 있으면 지우기 ×로 바뀐다.
                잠긴 칸(수정 불가)은 아무것도 두지 않는다. */}
            {!dateLocked && (dateStr ? (
              <button
                type="button" className="scr-datetime-clear" aria-label="날짜 지우기"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDateChange(""); onTimeChange(""); }}
              >
                <X size={12} />
              </button>
            ) : (
              <span className="scr-datetime-picker-icon" aria-hidden="true"><Calendar size={15} /></span>
            ))}
          </span>
        </label>
      </div>
      <div className="scr-datetime-col">
        <label className="scr-field scr-datetime-input">
          <span className="scr-label">시간 <span className="scr-label-optional">(선택)</span></span>
          <span className="scr-datetime-input-wrap">
            <input
              type="time" className={cx(cls, timeLocked && "scr-datetime-locked")} value={timeStr}
              readOnly={timeLocked} tabIndex={timeLocked ? -1 : undefined}
              // 빈 시간 칸을 누르면 21시로 시작(요청). pointerdown에서 미리 값을 박아야 네이티브
              // 피커가 21시에 열린다. 안 누르면 빈 채로 남아 "시간 미정"이 된다.
              onPointerDown={timeLocked ? undefined : (e) => primeDefaultTime(e.currentTarget)}
              onFocus={timeLocked ? undefined : (e) => primeDefaultTime(e.currentTarget)}
              onClick={timeLocked ? undefined : openPicker}
              onChange={timeLocked ? undefined : (e) => onTimeChange(e.target.value)}
              disabled={!timeLocked && !dateStr}
            />
            {!timeLocked && (timeStr ? (
              <button
                type="button" className="scr-datetime-clear" aria-label="시간 지우기"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTimeChange(""); }}
              >
                <X size={12} />
              </button>
            ) : (
              <span className="scr-datetime-picker-icon" aria-hidden="true"><Clock size={15} /></span>
            ))}
          </span>
        </label>
      </div>
    </div>
  );
}
