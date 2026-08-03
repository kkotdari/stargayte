import { useState } from "react";
import { X, Calendar, CalendarPlus } from "lucide-react";
import { cx } from "../../utils/format";
import { DATE_INPUT_MIN, DATE_INPUT_MAX, shortDate, isValidDateStr } from "../../utils/date";

// 네이티브 달력 표시기를 CSS로 숨겼으므로, 데스크톱에서 입력칸을 눌렀을 때 피커가 열리게
// showPicker를 직접 호출한다(모바일은 인풋 포커스만으로 네이티브 피커가 열려 이 호출이
// 없어도/실패해도 무방하다 — 미지원·이미 열림은 조용히 무시).
export function openPicker(e: React.MouseEvent<HTMLInputElement>) {
  const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
  try { el.showPicker?.(); } catch { /* 미지원 또는 이미 열림 */ }
}

/** "언제" 칸 글자 수 상한 — 백엔드 스키마(max_length=30)와 같은 값이어야 한다. */
export const TIME_NOTE_MAX = 30;
/** "언제" 칸 안내문 — 도전장 쓰기/수락과 일시 수정 팝업이 모두 이 부품을 쓴다. */
export const TIME_NOTE_PLACEHOLDER = "예) 그날 봐서, 아무도 몰래";

interface OptionalDateTimeFieldsProps {
  dateStr: string;
  onDateChange: (value: string) => void;
  /** "언제"를 사람 말로 적어 두는 자리(요청) — 빈 문자열이면 안 적은 것. */
  noteStr: string;
  onNoteChange: (value: string) => void;
  // 이미 값이 정해져 온(요청자가 지정한) 칸은 응답자가 못 바꾸게 잠근다(요청: "이미 입력되어
  // 온 값은 수정불가 상태로 노출"). 날짜만 잠그고 "언제"는 열어둘 수도 있다(요청: "날짜가
  // 입력되었어도 시간은 별도로 입력 가능").
  dateLocked?: boolean;
  noteLocked?: boolean;
  // 날짜가 비어 있어도 되는 상태에서, 호출부가 에러 테두리를 얹고 싶을 때.
  invalid?: boolean;
}

// 도전장 쓰기/수락/리벤지 공용 — 정하는 것은 날짜뿐이다(요청: 시간 필드 삭제). 시각을
// 못 박는 대신 "언제"를 한마디처럼 적을 수 있는데, 그 칸은 처음부터 펼쳐 두지 않고
// "언제" 버튼을 눌러야 나온다(요청) — 대부분은 날짜만 정하고 말기 때문이다.
//
// 날짜와 "언제"는 서로 상관없이 따로 적는다(요청: "둘은 이제 상관없이 별도로 입력가능").
// 예전엔 날짜가 없으면 "언제"를 못 열게 막고 날짜를 지우면 "언제"까지 비웠는데, 그래서
// 날짜를 안 적은 사람 눈에는 버튼이 그냥 안 눌리는 것으로만 보였다(지적).
//
// 배치는 세로 한 줄씩이다(요청). 날짜 칸 아래에 "언제" 버튼이 신청 메시지 버튼과
// 같은 아이콘+라벨 알약으로 앉으므로, 호출부에서 그 다음에 오는 신청 메시지 버튼과
// 자연스럽게 위아래로 짝이 된다.
export default function OptionalDateTimeFields({
  dateStr, onDateChange, noteStr, onNoteChange,
  dateLocked = false, noteLocked = false, invalid = false,
}: OptionalDateTimeFieldsProps) {
  const cls = `scr-input${invalid ? " scr-input-invalid" : ""}`;
  // 이미 적힌 값이 있으면(수정/응답 화면) 접어 둘 이유가 없으므로 펼친 채로 시작한다.
  const [noteOpen, setNoteOpen] = useState(noteStr.length > 0);
  // 잠긴 칸(요청자가 이미 적어 보낸 값)은 접을 수 없다 — 읽을 값이 있으니 늘 보여준다.
  const showNote = noteLocked || noteOpen || noteStr.length > 0;
  // 잠긴 칸이 하나라도 있으면 지금 화면은 '응답'이다 — 잠금은 요청자가 정해서 보낸 값을
  // 응답자가 못 바꾸게 할 때만 걸린다(도전장 쓰기·일시 수정 팝업은 아무것도 안 잠근다).
  // 그때는 "(선택)"이 거짓말이 된다(고를 수 있는 게 아니라 이미 정해진 값이다) — 라벨을
  // 이름만 남기고, 대신 지금 못 바꾸는 이유를 한 줄로 알려 준다(요청).
  const locked = dateLocked || noteLocked;
  const optional = locked ? null : <span className="scr-label-optional">(선택)</span>;

  return (
    <div className="scr-datetime-stack">
      <label className="scr-field scr-datetime-input">
        <span className="scr-label">날짜{optional && <> {optional}</>}</span>
        <span className="scr-datetime-input-wrap">
          {/* 잠긴 칸은 type=date가 아니라 읽기 전용 텍스트다 — 네이티브 날짜 칸의 표기는
              브라우저 로케일이 정해서 "08/03/2026"처럼 이 앱에서 쓰지 않는 꼴이 나온다
              (지적: 날짜 표기법이 이상하다). 고칠 수 없는 값이라 피커도 필요 없으니,
              앱이 날짜를 적는 유일한 꼴(shortDate — "8월 3일")로 그냥 적는다.
              생김새는 클래스가 같아 그대로다. */}
          {dateLocked ? (
            <input
              type="text" className={cx(cls, "scr-datetime-locked")} readOnly tabIndex={-1}
              value={isValidDateStr(dateStr) ? shortDate(dateStr) : dateStr}
            />
          ) : (
            <input
              type="date" className={cls} value={dateStr}
              min={DATE_INPUT_MIN} max={DATE_INPUT_MAX}
              onClick={openPicker}
              onChange={(e) => onDateChange(e.target.value)}
            />
          )}
          {/* 스왑(요청): 맨 오른쪽 한 자리에서 — 값이 없으면 달력 아이콘(장식용,
              pointer-events:none이라 인풋을 눌러 피커를 연다), 값이 있으면 지우기 ×로 바뀐다.
              잠긴 칸(수정 불가)은 아무것도 두지 않는다. */}
          {!dateLocked && (dateStr ? (
            <button
              type="button" className="scr-datetime-clear" aria-label="날짜 지우기"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.preventDefault(); e.stopPropagation();
                onDateChange("");
              }}
            >
              <X size={12} />
            </button>
          ) : (
            <span className="scr-datetime-picker-icon" aria-hidden="true"><Calendar size={15} /></span>
          ))}
        </span>
      </label>
      {showNote ? (
        <label className="scr-field scr-datetime-input">
          <span className="scr-label">언제{optional && <> {optional}</>}</span>
          <span className="scr-datetime-input-wrap">
            <input
              type="text" className={cx(cls, noteLocked && "scr-datetime-locked")} value={noteStr}
              placeholder={noteLocked ? "" : TIME_NOTE_PLACEHOLDER}
              maxLength={TIME_NOTE_MAX}
              readOnly={noteLocked} tabIndex={noteLocked ? -1 : undefined}
              onChange={noteLocked ? undefined : (e) => onNoteChange(e.target.value)}
            />
            {!noteLocked && noteStr && (
              <button
                type="button" className="scr-datetime-clear" aria-label="언제 지우기"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  onNoteChange(""); setNoteOpen(false);
                }}
              >
                <X size={12} />
              </button>
            )}
          </span>
        </label>
      ) : (
        <button
          type="button" className="scr-challenge-msg-toggle scr-datetime-note-add"
          onClick={() => setNoteOpen(true)}
        >
          <CalendarPlus size={13} aria-hidden />
          언제
        </button>
      )}
      {/* 잠긴 칸을 보고 "왜 못 고치지?" 하고 멈추지 않게, 수락한 뒤에 고칠 수 있다는 것을
          알려 준다(요청) — 실제로 성사된 뒤에는 시각 옆 연필로 일시 수정 팝업이 열린다
          (ChallengeTimeEditModal). */}
      {locked && (
        <p className="scr-datetime-locked-note">날짜와 언제는 수락 후 변경 가능</p>
      )}
    </div>
  );
}
