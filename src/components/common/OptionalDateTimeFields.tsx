import { useState } from "react";
import { X, Calendar, Plus } from "lucide-react";
import { cx } from "../../utils/format";
import { DATE_INPUT_MIN, DATE_INPUT_MAX } from "../../utils/date";

// 네이티브 달력 표시기를 CSS로 숨겼으므로, 데스크톱에서 입력칸을 눌렀을 때 피커가 열리게
// showPicker를 직접 호출한다(모바일은 인풋 포커스만으로 네이티브 피커가 열려 이 호출이
// 없어도/실패해도 무방하다 — 미지원·이미 열림은 조용히 무시).
export function openPicker(e: React.MouseEvent<HTMLInputElement>) {
  const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
  try { el.showPicker?.(); } catch { /* 미지원 또는 이미 열림 */ }
}

/** "언제" 칸 글자 수 상한 — 백엔드 스키마(max_length=30)와 같은 값이어야 한다. */
export const TIME_NOTE_MAX = 30;
/** "언제" 칸 안내문 — 인라인 수정 폼(ChallengeTimeHeadEdit)도 같은 문구를 쓴다. */
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
// "언제 추가하기"를 눌러야 나온다(요청) — 대부분은 날짜만 정하고 말기 때문이다.
// 날짜 없이 "언제"만 적는 건 뜻이 없어 날짜가 비어 있으면 추가 자체를 막는다.
export default function OptionalDateTimeFields({
  dateStr, onDateChange, noteStr, onNoteChange,
  dateLocked = false, noteLocked = false, invalid = false,
}: OptionalDateTimeFieldsProps) {
  const cls = `scr-input${invalid ? " scr-input-invalid" : ""}`;
  // 이미 적힌 값이 있으면(수정/응답 화면) 접어 둘 이유가 없으므로 펼친 채로 시작한다.
  const [noteOpen, setNoteOpen] = useState(noteStr.length > 0);
  const showNote = noteOpen || noteStr.length > 0;

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
                // 날짜를 지우면 "언제"도 함께 비운다 — 날짜 없는 "그날 봐서"는 가리킬 날이 없다.
                if (!v) { onNoteChange(""); setNoteOpen(false); }
              }}
            />
            {/* 스왑(요청): 맨 오른쪽 한 자리에서 — 값이 없으면 달력 아이콘(장식용,
                pointer-events:none이라 인풋을 눌러 피커를 연다), 값이 있으면 지우기 ×로 바뀐다.
                잠긴 칸(수정 불가)은 아무것도 두지 않는다. */}
            {!dateLocked && (dateStr ? (
              <button
                type="button" className="scr-datetime-clear" aria-label="날짜 지우기"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  onDateChange(""); onNoteChange(""); setNoteOpen(false);
                }}
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
        {showNote ? (
          <label className="scr-field scr-datetime-input">
            <span className="scr-label">언제 <span className="scr-label-optional">(선택)</span></span>
            <span className="scr-datetime-input-wrap">
              <input
                type="text" className={cx(cls, noteLocked && "scr-datetime-locked")} value={noteStr}
                placeholder={noteLocked ? "" : TIME_NOTE_PLACEHOLDER}
                maxLength={TIME_NOTE_MAX}
                readOnly={noteLocked} tabIndex={noteLocked ? -1 : undefined}
                onChange={noteLocked ? undefined : (e) => onNoteChange(e.target.value)}
                disabled={!noteLocked && !dateStr}
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
          // 날짜가 없으면 누를 수 없다 — 위 onChange가 날짜를 지울 때 이 칸도 함께 접는다.
          <button
            type="button" className="scr-btn scr-btn-ghost scr-datetime-note-add"
            onClick={() => setNoteOpen(true)} disabled={!dateStr || noteLocked}
          >
            <Plus size={14} aria-hidden />
            언제 추가하기
          </button>
        )}
      </div>
    </div>
  );
}
