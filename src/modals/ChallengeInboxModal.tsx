import { useState } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "../components/common/Feedback";
import { api } from "../api/client";
import { useAppStore } from "../store/appStore";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { formatChallengeSchedule } from "../utils/date";
import { MATCH_TYPE_INFO } from "../constants/matchTypes";
import { cx } from "../utils/format";
import type { Challenge } from "../types";

interface ChallengeInboxModalProps {
  challenges: Challenge[];
  onClose: () => void;
}

// 다음 접속 때 뜨는 도전장 팝업 — 한 번에 하나씩만 보여주고, 응답하거나 닫으면 큐의
// 다음 도전장으로 넘어간다. 전부 처리되면 onClose로 부모가 닫는다.
export default function ChallengeInboxModal({ challenges, onClose }: ChallengeInboxModalProps) {
  useLockBodyScroll();
  const myId = useAppStore((s) => s.user?.id);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 처음엔 편지봉투만 보여주고, 누르면 편지지(제목/내용/응답 폼)로 넘어간다(요청:
  // "인박스 편지봉투만 처음에 나오고 편지지로 이동").
  const [stage, setStage] = useState<"envelope" | "letter">("envelope");
  const [message, setMessage] = useState("");
  // 요청자가 "시간 지정"을 끄고 보낸(scheduledAt 없음) 도전장은 "상대가 정해도 된다"는
  // 뜻이다 — 승락하는 이 시점에 상대가 직접 정하게 한다(요청: "도전자/상대 모두 시간을
  // 지정하지 않았는데 수락이 된 경우가 있네 이러면 안되는데" — 안 그러면 시간이 영원히
  // 안 채워진 채 박제된다).
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");

  const current = challenges[idx];
  if (!current) { onClose(); return null; }

  const needsSchedule = current.scheduledAt === null;

  const advance = () => {
    setStage("envelope");
    setMessage("");
    setDateStr("");
    setTimeStr("");
    setErr("");
    if (idx + 1 >= challenges.length) onClose();
    else setIdx((i) => i + 1);
  };

  // 편지지에서 한마디는 거절할 때만 필수다(요청: "승락시에는 메시지 필수 아니게 변경
  // 거절일때는 필수") — 거절 버튼만 막아두고, 혹시라도 뚫려 눌리는 경우를 대비해
  // 핸들러 안에서도 한 번 더 확인한다. 승락은 메시지가 비어 있어도 그대로 보낸다.
  const trimmedMessage = message.trim();
  const canReject = trimmedMessage.length > 0;
  const canAccept = !needsSchedule || (dateStr.length > 0 && timeStr.length > 0);

  const respond = async (response: "accepted" | "rejected") => {
    if (response === "rejected" && !canReject) {
      setErr("거절 사유를 입력해 주세요.");
      return;
    }
    if (response === "accepted" && !canAccept) {
      setErr("날짜와 시간을 정해 주세요.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const scheduledAt = response === "accepted" && needsSchedule
        ? new Date(`${dateStr}T${timeStr}`).toISOString()
        : undefined;
      await api.respondToChallenge(current.id, response, trimmedMessage || undefined, scheduledAt);
      advance();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "응답하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // "함께" 줄은 팀전(2명 이상 지목)에서 나 말고 같이 지목된 상대가 있을 때만 보여준다 —
  // 1:1이면 이미 상대가 나 하나뿐이라 중복이고, 나 자신의 이름만 나오면 어색하다.
  const others = current.targets.filter((t) => t.memberId !== myId).map((t) => t.nickname);
  const title = `${current.createdBy.nickname}님에게서 도전장이 도착했어요`;

  return createPortal(
    <div className="scr-modal-overlay">
      {/* 봉투만 보이는 단계에서는 모달의 기본 유리판 배경/그림자를 지워서(요청: "모달창
          배경은 안보이고 편지봉투 이미지만 보이게") 정말 봉투 사진 + 제목만 떠 있는
          것처럼 보이게 한다 — 편지지를 열면(letter 단계) 원래의 카드 배경으로 되돌아온다. */}
      <div className={cx("scr-modal scr-modal-sm scr-challenge-inbox-modal", stage === "envelope" && "scr-challenge-inbox-modal-envelope")}>
        <div className="scr-challenge-inbox-title">{title}</div>

        {stage === "envelope" ? (
          <button
            type="button"
            className="scr-challenge-envelope scr-challenge-envelope-button scr-challenge-envelope-full"
            onClick={() => setStage("letter")}
          >
            {/* 열어보기 안내는 사진 위에 겹치지 않고 사진 아래 별도 줄로 배치한다(요청:
                "도전장 열어보기 버튼은 이미지상이 아닌 이미지 하단에 따로 배치"). */}
            <img src="/images/bg/letter.jpg" alt="" className="scr-challenge-envelope-img" />
            <span className="scr-challenge-envelope-hint">눌러서 열어보기</span>
          </button>
        ) : (
          <>
            {/* 편지지를 연 뒤에는 봉투 이미지를 다시 안 보여준다(요청: "편지 열면
                편지봉투 이미지는 없어도 됨") — 대신 재미 요소였던 nawa 이미지를 구석
                장식이 아니라 상단에 크게, 동그랗게 크롭하고 가장자리를 그라데이션으로
                흐려서 배치한다(요청: "nawa 이미지는 상단에 크게 배치" + "nawa 이미지
                동그랗게 크롭 & 가장자리 그라데이션 처리"). */}
            <img src="/images/items/nawa.jpg" alt="" className="scr-challenge-inbox-hero" />
            <div className="scr-modal-body scr-challenge-inbox-body">
              {current.message && (
                <p className="scr-challenge-inbox-message">"{current.message}"</p>
              )}
              {others.length > 0 && (
                <div className="scr-challenge-inbox-row">
                  <span className="scr-label">함께</span>
                  <span>{others.join(", ")}</span>
                </div>
              )}
              <div className="scr-challenge-inbox-row">
                <span className="scr-label">종류</span>
                <span>{MATCH_TYPE_INFO[current.matchType]}</span>
              </div>
              <div className="scr-challenge-inbox-row">
                <span className="scr-label">일시</span>
                <span>{formatChallengeSchedule(current.scheduledAt)}</span>
              </div>

              {/* 요청자가 시간을 안 정했으면(needsSchedule) 상대인 내가 승락하며 직접
                  정한다 — 안 그러면 시간이 영원히 안 채워진 채 승락 상태로 박제된다
                  (요청: "도전자/상대 모두 시간을 지정하지 않았는데 수락이 된 경우가
                  있네 이러면 안되는데"). 거절할 땐 필요 없으니 항상 보여준다. */}
              {needsSchedule && (
                <label className="scr-field">
                  <span className="scr-label">일시 정하기 (승락 시 필수)</span>
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
                <span className="scr-label">한마디 (거절 시 필수)</span>
                <input
                  type="text" className="scr-input" value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="예: 네가 감히! / 좋아요, 그날 봐요"
                  maxLength={60}
                />
              </label>

              {err && <div className="scr-err">{err}</div>}

              <div className="scr-form-actions">
                <button
                  className="scr-btn scr-challenge-reject-btn" onClick={() => respond("rejected")}
                  disabled={busy || !canReject}
                >
                  {busy ? <Spinner /> : "거절"}
                </button>
                <button
                  className="scr-btn scr-challenge-accept-btn" onClick={() => respond("accepted")}
                  disabled={busy || !canAccept}
                >
                  {busy ? <><Spinner /> 처리 중...</> : "승락"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
