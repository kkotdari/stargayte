import { useState } from "react";

interface OptionalDateTimeFieldsProps {
  dateStr: string;
  onDateChange: (value: string) => void;
  timeStr: string;
  onTimeChange: (value: string) => void;
  // 시간 체크박스를 처음 켤 때 채워 넣는 기본 시각(요청: "기본 시간 오후 10시").
  defaultTime?: string;
}

// 도전장 쓰기/수락 공용 — 날짜와 시간을 각각 독립된 체크박스로 켠다(요청: "날짜 선택
// 체크박스 노출되고 체크하면 날짜 선택창이 나타남. 날짜를 선택하면 시간 선택 체크박스가
// 노출되고 체크하면 시간 선택창이 나타남"). 시간은 날짜 없이는 의미가 없으므로, 시간
// 체크박스 자체가 날짜를 실제로 고른 뒤에만 나타난다 — 날짜 체크를 끄거나 값을 지우면
// 시간도 함께 꺼지고 지워진다.
export default function OptionalDateTimeFields({
  dateStr, onDateChange, timeStr, onTimeChange, defaultTime = "22:00",
}: OptionalDateTimeFieldsProps) {
  const [dateEnabled, setDateEnabled] = useState(dateStr.length > 0);
  const [timeEnabled, setTimeEnabled] = useState(timeStr.length > 0);

  const toggleDate = (checked: boolean) => {
    setDateEnabled(checked);
    if (!checked) {
      onDateChange("");
      setTimeEnabled(false);
      onTimeChange("");
    }
  };
  const toggleTime = (checked: boolean) => {
    setTimeEnabled(checked);
    onTimeChange(checked ? (timeStr || defaultTime) : "");
  };

  return (
    <>
      <label className="scr-checkbox-field">
        <input type="checkbox" checked={dateEnabled} onChange={(e) => toggleDate(e.target.checked)} />
        날짜 선택
      </label>
      {dateEnabled && (
        <label className="scr-field">
          <span className="scr-label">날짜</span>
          <input
            type="date" className="scr-input" value={dateStr}
            onChange={(e) => onDateChange(e.target.value)}
          />
        </label>
      )}
      {dateEnabled && dateStr && (
        <label className="scr-checkbox-field">
          <input type="checkbox" checked={timeEnabled} onChange={(e) => toggleTime(e.target.checked)} />
          시간 선택
        </label>
      )}
      {dateEnabled && dateStr && timeEnabled && (
        <label className="scr-field">
          <span className="scr-label">시간</span>
          <input
            type="time" className="scr-input" value={timeStr}
            onChange={(e) => onTimeChange(e.target.value)}
          />
        </label>
      )}
    </>
  );
}
