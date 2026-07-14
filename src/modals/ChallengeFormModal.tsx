import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Select from "../components/common/Select";
import { Spinner } from "../components/common/Feedback";
import { useAppStore } from "../store/appStore";
import { api } from "../api/client";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import type { Challenge } from "../types";

interface ChallengeFormModalProps {
  onClose: () => void;
  onCreated: (challenge: Challenge) => void;
}

// 오픈 시점엔 1명만 지목할 수 있다(1:1만) — 서버는 이미 팀전(우리팀 구성)까지 받아주지만,
// 이 폼은 UI 단에서만 1:1로 좁혀둔다. 나중에 팀전을 다시 열면 예전처럼 우리팀 피커를
// 되살리면 된다(ChallengeCreatePayload.ownTeamMemberIds는 그대로 남아있다).
const MAX_TARGETS = 1;

// "너 나와!" 도전장 작성 — 최대한 간단히: 상대 지목(1명, 회원만)/일시(선택, 날짜만도
// 가능)/한마디(선택)뿐이다. 상대가 응답할 때는 이 시간을 바꿀 수 없고 수락/거절만
// 가능하다 — 거절되면 요청자가 재신청하면서 시간/메모를 고칠 수 있다.
export default function ChallengeFormModal({ onClose, onCreated }: ChallengeFormModalProps) {
  useLockBodyScroll();
  const members = useAppStore((s) => s.members);
  const user = useAppStore((s) => s.user);

  // 확정된 지목은 이름만 보여주는 칩으로, "+ 상대 추가"는 누르는 순간 그 자리가 회원
  // 고르는 드롭다운으로 바뀌었다가 고르면 다시 칩으로 접힌다 — 빈 드롭다운을 여러 개
  // 미리 늘어놓지 않는다.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  // 일시를 아예 자유 입력으로 두던 걸 체크박스로 명시화한다(요청: "'시간 지정'
  // 체크박스 로직 구현") — 체크하면 그때부턴 "정한다"는 뜻이라 날짜/시간 둘 다
  // 채워야만 보낼 수 있고, 체크를 안 하면(기본값) "시간은 상대방이 정해도 된다"는
  // 뜻이라 날짜/시간 입력 자체를 막는 대신 최소한 무슨 대화인지는 알 수 있게
  // 한마디를 필수로 받는다.
  const [timeSpecified, setTimeSpecified] = useState(false);
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const activeMembers = useMemo(
    () => members.filter((m) => m.status === "active" && m.id !== user?.id),
    [members, user?.id],
  );
  const memberOptions = useMemo(
    () => activeMembers
      .filter((m) => !selectedIds.includes(m.id))
      .map((m) => ({ value: m.id, label: `${m.nickname} (${m.battletag})` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [activeMembers, selectedIds],
  );

  const pickMember = (id: string) => {
    setSelectedIds((prev) => [...prev, id]);
    setPicking(false);
  };
  const removeMember = (id: string) => setSelectedIds((prev) => prev.filter((v) => v !== id));

  const canSubmit = selectedIds.length > 0
    && (!timeSpecified || (dateStr.length > 0 && timeStr.length > 0))
    && message.trim().length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setErr("");
    setBusy(true);
    try {
      // 시간을 지정 안 하면(기본값) 상대방이 정하기로 한 것이므로 아예 null로 보낸다 —
      // 지정했으면 canSubmit이 이미 날짜/시간 둘 다 채워졌음을 보장한다.
      const scheduledAt = timeSpecified ? new Date(`${dateStr}T${timeStr}`).toISOString() : null;
      const challenge = await api.createChallenge({
        targetMemberIds: selectedIds,
        scheduledAt,
        message,
      });
      onCreated(challenge);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "도전장을 보내지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm scr-challenge-form-modal">
        <div className="scr-modal-head">
          <span>도전장 보내기</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          {/* <label>이 아니라 <div>다 — <label>로 감싼 영역 안의 "제어 대상이 아닌" 부분을
              클릭하면 브라우저가 그 라벨의 첫 번째 폼 컨트롤(labelable element)에 자동으로
              한 번 더 "클릭"을 대신 쏴준다(레이블-폼 연결의 표준 동작). 이 필드는 버튼/칩이
              여러 개 든 복합 위젯이라 특정 입력 하나를 라벨링하는 게 아닌데, <label>로
              감쌌더니 상대 이름(칩)이나 "+ 상대 추가"를 눌러도 그 자동 클릭이 항상 첫
              번째 칩의 제거(X) 버튼에 꽂혀 방금 지목한 사람이 사라지는 버그가 있었다. */}
          <div className="scr-field">
            <span className="scr-label">상대 지목</span>
            <div className="scr-challenge-target-slots">
              {selectedIds.map((id) => {
                const m = memberById.get(id);
                return (
                  <div key={id} className="scr-challenge-target-picked">
                    <span>{m?.nickname ?? id}</span>
                    <button
                      type="button" className="scr-icon-btn scr-challenge-target-remove"
                      onClick={() => removeMember(id)} aria-label="지목 취소"
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
              {selectedIds.length < MAX_TARGETS && (
                picking ? (
                  <div className="scr-challenge-target-slot">
                    <Select
                      value="" options={memberOptions} onChange={pickMember}
                      placeholder="회원 선택"
                      className="scr-challenge-target-select"
                    />
                    <button
                      type="button" className="scr-icon-btn scr-challenge-target-remove"
                      onClick={() => setPicking(false)} aria-label="추가 취소"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <button type="button" className="scr-challenge-add-target" onClick={() => setPicking(true)}>
                    + 상대 추가
                  </button>
                )
              )}
            </div>
          </div>

          <label className="scr-checkbox-field">
            <input
              type="checkbox" checked={timeSpecified}
              onChange={(e) => setTimeSpecified(e.target.checked)}
            />
            시간 지정 <span className="scr-hint">(미선택시 상대방이 시간 지정함)</span>
          </label>

          {/* 체크를 껐다 켜도 입력값은 그대로 남아있는다(요청: "체크 해제했을때 인풋값은
              지우지 않고 화면에서만 숨겼다가 다시 체크하면 보이게") — disabled로 흐리게
              두는 대신 아예 숨긴다(state는 그대로 dateStr/timeStr에 남아있어 다시 켜면
              그 값 그대로 다시 보인다). */}
          {timeSpecified && (
            <label className="scr-field">
              <span className="scr-label">일시</span>
              <div className="scr-challenge-datetime">
                <input
                  type="date" className="scr-input" value={dateStr}
                  onChange={(e) => { setDateStr(e.target.value); if (!e.target.value) setTimeStr(""); }}
                />
                <input
                  type="time" className="scr-input" value={timeStr}
                  onChange={(e) => setTimeStr(e.target.value)}
                  disabled={!dateStr}
                />
              </div>
            </label>
          )}

          <label className="scr-field">
            <span className="scr-label">한마디</span>
            <input
              type="text" className="scr-input" value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="예: 한판 하실래요?"
              maxLength={60}
            />
          </label>

          {err && <div className="scr-err">{err}</div>}

          <div className="scr-form-actions">
            <button className="scr-btn scr-btn-ghost" onClick={onClose}>취소</button>
            <button className="scr-btn scr-btn-primary" onClick={submit} disabled={!canSubmit || busy}>
              {busy ? <><Spinner /> 보내는 중...</> : "🕊️ 보내기"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
