import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "../components/common/Feedback";
import { api } from "../api/client";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { formatChallengeSchedule } from "../utils/date";
import type { Challenge } from "../types";

interface ChallengeInboxModalProps {
  challenges: Challenge[];
  onClose: () => void;
}

// 다음 접속 때 뜨는 도전장 팝업 — 한 번에 하나씩만 보여주고, 응답하거나 닫으면 큐의
// 다음 도전장으로 넘어간다. 전부 처리되면 onClose로 부모가 닫는다.
export default function ChallengeInboxModal({ challenges, onClose }: ChallengeInboxModalProps) {
  useLockBodyScroll();
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 처음엔 편지봉투만 보여주고, 잠시 뒤 자동으로 편지지(제목/내용/응답 폼)로 넘어간다
  // (요청: "열어보기 버튼 제거하고 자동으로 열리게"). 연출은 두 단계 — "envelope"
  // 동안 봉투가 좌우로 흔들리다가, 흔들림이 끝나면 봉투는 페이드아웃 없이 그냥 사라지고
  // (요청: "편지봉투 페이드아웃 제거 그냥 사라지기") "letter"의 편지지가 그 뒤에서
  // 확대되며 페이드인 등장한다. 아래 useEffect가 봉투 단계를 정해진 시간만큼 유지하고
  // 다음 단계로 넘긴다.
  const [stage, setStage] = useState<"envelope" | "letter">("envelope");
  const [message, setMessage] = useState("");
  // 요청자가 "시간 지정"을 끄고 보낸(scheduledAt 없음) 도전장은 "상대가 정해도 된다"는
  // 뜻이다 — 승락하는 이 시점에 상대가 직접 정하게 한다(요청: "도전자/상대 모두 시간을
  // 지정하지 않았는데 수락이 된 경우가 있네 이러면 안되는데" — 안 그러면 시간이 영원히
  // 안 채워진 채 박제된다).
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");

  const current = challenges[idx];

  // 봉투를 충분히 보여준 뒤 자동으로 "letter"로 넘어간다(봉투는 그냥 사라지고 편지지가
  // 등장). idx가 바뀌어 새 봉투(stage="envelope")가 뜰 때마다 다시 돈다. 누가 보냈는지
  // (봉투 위 제목)를 읽을 시간을 넉넉히 주려고 먼저 2.4초 가만히 있다가 흔들린다(요청:
  // "홀드 시간을 두배로" — 1.2s → 2.4s). CSS 쪽 흔들림 animation-delay(2.4s) + 지속시간
  // (0.75s, 요청: "쉐이킹은 살짝 더 빠르게") = 3.15초에 맞춰 "letter"로 넘긴다.
  useEffect(() => {
    if (!current || stage !== "envelope") return;
    const t = window.setTimeout(() => setStage("letter"), 3150);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idx가 바뀌면 stage도 항상 "envelope"로 함께 리셋되므로 stage만으로 충분
  }, [stage, idx]);

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

  // 팀전(0102)이면 양 팀을 한눈에 확인할 수 있게 나눠 보여준다(요청: "팀전의 경우 상대팀원과
  // 우리팀 확인하기 좋게"). 상대팀(도전한 쪽) = 도전자(createdBy) + 그 팀원(ownMembers),
  // 우리팀(지목된 쪽) = targets(나 포함).
  const isTeamMatch = current.matchType === "0102";
  const opposingTeam = [current.createdBy.nickname, ...current.ownMembers.map((m) => m.nickname)];
  const ourTeam = current.targets.map((t) => t.nickname);
  const title = `${current.createdBy.nickname}님에게서 도전장이 도착했어요`;

  return createPortal(
    <div className="scr-modal-overlay">
      {/* 편지지(letter) — 봉투와는 완전히 별개인 카드다(요청: "봉투랑 편지지는 별도 모달").
          봉투가 사라지는 순간 그 자리에 애니메이션 없이 그냥 나타난다(요청: "편지지 확대
          페이드인 제거 그냥 나오기"). */}
      {stage === "letter" && (
        <div className="scr-modal scr-modal-sm scr-challenge-inbox-modal">
          <div className="scr-challenge-inbox-title">{title}</div>
          {/* 편지지 상단에 nawa 이미지를 크게, 동그랗게 크롭하고 가장자리를 그라데이션으로
              흐려서 배치한다. */}
          <img src="/images/items/nawa.jpg" alt="" className="scr-challenge-inbox-hero" />
          <div className="scr-modal-body scr-challenge-inbox-body">
            {current.message && (
              <p className="scr-challenge-inbox-message">"{current.message}"</p>
            )}
            {isTeamMatch && (
              <>
                <div className="scr-challenge-inbox-row scr-challenge-inbox-team-row">
                  <span className="scr-label scr-challenge-team-label scr-challenge-team-label-them">상대팀</span>
                  <span className="scr-challenge-team-names">{opposingTeam.join(", ")}</span>
                </div>
                <div className="scr-challenge-inbox-row scr-challenge-inbox-team-row">
                  <span className="scr-label scr-challenge-team-label scr-challenge-team-label-us">우리팀</span>
                  <span className="scr-challenge-team-names">{ourTeam.join(", ")}</span>
                </div>
              </>
            )}
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

            {/* 거절 사유(한마디) 없이 거절을 누르면 여기 오류가 뜬다 — 뜰 때 아래 버튼 줄이
                밀리지 않도록 자리를 미리 예약해 둔다(요청: "메시지없이 거절할때 오류 메시지
                노출(미리 공간 예약)"). */}
            <div className="scr-challenge-inbox-err-slot" aria-live="polite">
              {err && <div className="scr-err">{err}</div>}
            </div>

            <div className="scr-form-actions">
              {/* 예전엔 한마디가 없으면 거절 버튼 자체를 비활성화했는데(요청: "거절일때는
                  필수"), 눌러도 반응이 없어 왜 안 되는지 알기 어려웠다 — 이제 버튼은 열어두고
                  누르면 위 슬롯에 "거절 사유를 입력해 주세요." 오류를 띄운다(요청). */}
              <button
                className="scr-btn scr-challenge-reject-btn" onClick={() => respond("rejected")}
                disabled={busy}
              >
                {busy ? <Spinner /> : "거절"}
              </button>
              {/* 수락도 거절도 아직 — 아무 응답도 안 보내고 그냥 다음(또는 닫기)으로
                  넘어간다(요청: "수락/거절 말고 고민중 버튼 추가(그냥 아무것도
                  안하는거)"). 응답이 안 남으므로 다음 접속 때 이 도전장이 다시 뜬다. */}
              <button
                type="button" className="scr-btn scr-btn-ghost" onClick={advance}
                disabled={busy}
              >
                고민중
              </button>
              <button
                className="scr-btn scr-challenge-accept-btn" onClick={() => respond("accepted")}
                disabled={busy || !canAccept}
              >
                {busy ? <><Spinner /> 처리 중...</> : "승락"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 편지봉투 — 편지지 카드와 한 몸이 아니라(요청) 오버레이 위에 겹치는 별도 레이어다.
          카드 배경 없이 봉투 사진 + 제목만 스크림 위에 떠서 envelope에서 좌우로 흔들리다,
          흔들림이 끝나면 페이드아웃 없이 그냥 언마운트되어 사라진다(요청). */}
      {stage === "envelope" && (
        <div className="scr-challenge-envelope-layer">
          <div className="scr-challenge-envelope-inner">
            <div className="scr-challenge-inbox-title">{title}</div>
            <div className="scr-challenge-envelope scr-challenge-envelope-full scr-challenge-envelope-shake">
              <img src="/images/bg/letter.jpg" alt="" className="scr-challenge-envelope-img" />
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
