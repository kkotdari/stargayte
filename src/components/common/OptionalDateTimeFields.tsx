import { X } from "lucide-react";
import { cx } from "../../utils/format";
import { DATE_INPUT_MIN, DATE_INPUT_MAX } from "../../utils/date";

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
              onChange={dateLocked ? undefined : (e) => {
                const v = e.target.value;
                onDateChange(v);
                // 날짜를 지우면 시간도 비운다. 날짜를 골라도 시간은 자동으로 채우지 않는다 —
                // 시간 칸을 비워두면 그게 곧 "시간 미정"(날짜만 지정)이다(요청).
                if (!v) onTimeChange("");
              }}
            />
            {/* 잠긴 칸엔 지우기 버튼을 두지 않는다(수정 불가). 편집 가능한 칸만 자리를 예약하고
                (data-empty로 숨김만) 값이 있으면 ×로 다시 "미정"으로 되돌릴 수 있다(요청). */}
            {!dateLocked && (
              <button
                type="button" className="scr-datetime-clear" aria-label="날짜 지우기"
                data-empty={dateStr ? undefined : "1"} tabIndex={dateStr ? 0 : -1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDateChange(""); onTimeChange(""); }}
              >
                <X size={12} />
              </button>
            )}
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
              // 시간을 정하려고 빈 칸을 누르면 21시로 시작한다(요청: "선택 UI를 눌렀을 때 값이
              // 없으면 21시로 선택된 상태로 열림"). 안 누르면 빈 채로 남아 "시간 미정"이 된다.
              onFocus={timeLocked ? undefined : () => { if (dateStr && !timeStr) onTimeChange("21:00"); }}
              onChange={timeLocked ? undefined : (e) => onTimeChange(e.target.value)}
              disabled={!timeLocked && !dateStr}
            />
            {!timeLocked && (
              <button
                type="button" className="scr-datetime-clear" aria-label="시간 지우기"
                data-empty={dateStr && timeStr ? undefined : "1"} tabIndex={dateStr && timeStr ? 0 : -1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTimeChange(""); }}
              >
                <X size={12} />
              </button>
            )}
          </span>
        </label>
      </div>
    </div>
  );
}
