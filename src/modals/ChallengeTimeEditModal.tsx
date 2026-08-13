import { useState } from "react";
import ModalHash from "../utils/modalHash";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Spinner } from "../components/common/Feedback";
import OptionalDateTimeFields from "../components/common/OptionalDateTimeFields";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { api } from "../api/client";
import type { Challenge } from "../types";

// 성사된 너 나와의 예정 일시를 고치는 팝업(요청: "너나와 날짜 수정은 인라인 폐기하고 팝업으로").
//
// 예전에는 시각 옆에서 바로 펼쳐지는 인라인 폼이었다. 그 자리는 한 줄뿐이라 날짜·"언제"·
// 취소·확인 넷을 억지로 밀어 넣어야 했고(좁은 화면에선 입력칸이 50px까지 줄었다), 제목과
// 시각이 한 줄을 나눠 쓰게 된 뒤로는 그 줄에 폼까지 얹을 자리가 아예 없었다. 팝업으로 옮기면
// 도전장 쓰기·수락과 같은 입력 부품(OptionalDateTimeFields)을 그대로 쓸 수 있어, 세 화면의
// 날짜/"언제" 입력이 생김새도 규칙도 같아진다.
//
// 날짜와 "언제"는 서로 상관없이 따로 적는다(요청) — 날짜를 비우면 일정 전체가 미정으로
// 돌아가지만, 날짜 없이 "언제"만 적어 두는 것도 된다("그날 봐서" 같은 말이 곧 일정인 경우).
export default function ChallengeTimeEditModal({
  challenge, onClose, onUpdated,
}: {
  challenge: Challenge;
  onClose: () => void;
  onUpdated: (updated: Challenge) => void;
}) {
  useLockBodyScroll(true, onClose);
  // 저장된 값을 그대로 열어 편집한다 — 안 적혀 있으면 빈 칸으로 연다.
  const [dateStr, setDateStr] = useState(challenge.scheduledDate ?? "");
  const [noteStr, setNoteStr] = useState(challenge.scheduledTimeNote);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setErr("");
    setBusy(true);
    try {
      const updated = await api.rescheduleChallenge(challenge.id, dateStr || null, noteStr.trim());
      onUpdated(updated);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "일정을 바꾸지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="scr-modal-overlay" onClick={onClose}>
      <ModalHash hash={`callout-time-${challenge.id}`} onClose={onClose} />
      <div className="scr-modal scr-modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span>일시 수정</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body">
          <OptionalDateTimeFields
            dateStr={dateStr} onDateChange={setDateStr}
            noteStr={noteStr} onNoteChange={setNoteStr}
          />
          {err && <div className="scr-err">{err}</div>}
        </div>
        <div className="scr-form-actions">
          <button className="scr-btn scr-btn-ghost" onClick={onClose} disabled={busy}>취소</button>
          <button className="scr-btn scr-btn-primary" onClick={save} disabled={busy}>
            {busy ? <><Spinner /> 저장 중...</> : "저장"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
