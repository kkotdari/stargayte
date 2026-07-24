import { X } from "lucide-react";
import { DATE_INPUT_MIN, DATE_INPUT_MAX } from "../../utils/date";

interface OptionalDateTimeFieldsProps {
  dateStr: string;
  onDateChange: (value: string) => void;
  timeStr: string;
  onTimeChange: (value: string) => void;
  // 날짜/시간 둘 다 비어 있어도 되는 상태에서, 절반만 채운 값처럼 뜻이 애매한 경우
  // 호출부가 에러 테두리를 얹고 싶을 때(요청: "사유에 에러 테두리도 넣어줘야지"의 연장).
  invalid?: boolean;
}

// 도전장 쓰기/수락/리벤지 공용 — 날짜/시간 둘 다 처음부터 보여준다. 예전엔 각각 별도
// 체크박스로 켜야 입력칸이 나타났는데, 어차피 전부 선택 사항이라 굳이 한 단계를 더
// 거칠 필요가 없다(요청: "날짜 선택, 시간 선택 체크박스 제거하고 처음부터 둘다 노출").
// 시간은 날짜 없이는 의미가 없으므로 날짜를 고르기 전까지는 비활성화해 둔다 — 비활성
// 상태가 시각적으로도 드러나야 한다(요청: "시간은 날짜 선택전엔 비활성화 표시").
export default function OptionalDateTimeFields({
  dateStr, onDateChange, timeStr, onTimeChange, invalid = false,
}: OptionalDateTimeFieldsProps) {
  const cls = `scr-input${invalid ? " scr-input-invalid" : ""}`;

  // 날짜/시간을 각각 한 "칸"으로: 칸 안에 [라벨] 위, [입력] 아래로 쌓는다. 값이 있으면
  // 입력칸 위에 지우기(×) 버튼을 얹어 다시 "미정"으로 되돌릴 수 있게 한다(요청: "이미 입력한
  // 시간/날짜 삭제 버튼 필요").
  return (
    <div className="scr-datetime-cols">
      <div className="scr-datetime-col">
        <label className="scr-field scr-datetime-input">
          <span className="scr-label">날짜</span>
          <span className="scr-datetime-input-wrap">
            <input
              type="date" className={cls} value={dateStr}
              min={DATE_INPUT_MIN} max={DATE_INPUT_MAX}
              onChange={(e) => {
                const v = e.target.value;
                onDateChange(v);
                // 날짜를 지우면 시간도 비운다. 날짜를 골라도 시간은 자동으로 채우지 않는다 —
                // 시간 칸을 비워두면 그게 곧 "시간 미정"(날짜만 지정)이다(요청).
                if (!v) onTimeChange("");
              }}
            />
            {dateStr && (
              <button
                type="button" className="scr-datetime-clear" aria-label="날짜 지우기"
                // 날짜를 지우면 시간도 함께 비운다(시간은 날짜 없이 의미가 없다).
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onDateChange(""); onTimeChange(""); }}
              >
                <X size={12} />
              </button>
            )}
          </span>
        </label>
      </div>
      <div className="scr-datetime-col">
        <label className="scr-field scr-datetime-input">
          <span className="scr-label">시간</span>
          <span className="scr-datetime-input-wrap">
            <input
              type="time" className={cls} value={timeStr}
              // 시간을 정하려고 빈 칸을 누르면 21시로 시작한다(요청: "선택 UI를 눌렀을 때 값이
              // 없으면 21시로 선택된 상태로 열림"). 안 누르면 빈 채로 남아 "시간 미정"이 된다.
              onFocus={() => { if (dateStr && !timeStr) onTimeChange("21:00"); }}
              onChange={(e) => onTimeChange(e.target.value)}
              disabled={!dateStr}
            />
            {dateStr && timeStr && (
              <button
                type="button" className="scr-datetime-clear" aria-label="시간 지우기"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onTimeChange("")}
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
