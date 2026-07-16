import { useEffect, useState } from "react";
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
  // 처음엔 편지봉투만 보여주고, 잠시 뒤 자동으로 편지지(제목/내용/응답 폼)로 넘어간다
  // (요청: "열어보기 버튼 제거하고 자동으로 열리게"). 연출은 세 단계 — "envelope"
  // 동안 봉투가 좌우로 흔들리다가, "opening"에서 빠르게 확대되며 동시에 페이드아웃되고,
  // "letter"의 편지지는 그 뒤에서 확대되며 페이드인 등장한다(요청: "봉투 좌우로
  // 흔들리기 -> 봉투 빠르게 확대되면서 동시에 페이드아웃 -> 편지지 모달 뒤에서
  // 확대되면서 페이드인되면서 등장"). 아래 useEffect 두 개가 각 단계를 정해진 시간만큼만
  // 유지하고 다음 단계로 넘긴다.
  const [stage, setStage] = useState<"envelope" | "opening" | "letter">("envelope");
  const [message, setMessage] = useState("");
  // 요청자가 "시간 지정"을 끄고 보낸(scheduledAt 없음) 도전장은 "상대가 정해도 된다"는
  // 뜻이다 — 승락하는 이 시점에 상대가 직접 정하게 한다(요청: "도전자/상대 모두 시간을
  // 지정하지 않았는데 수락이 된 경우가 있네 이러면 안되는데" — 안 그러면 시간이 영원히
  // 안 채워진 채 박제된다).
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");

  const current = challenges[idx];

  // 봉투를 충분히 보여준 뒤 자동으로 "opening"(터지는 연출)으로, 그 연출이 끝나면
  // "letter"로 넘어간다. idx가 바뀌어 새 봉투(stage="envelope")가 뜰 때마다 다시 돈다.
  // 누가 보냈는지(봉투 위 제목)를 읽을 시간을 넉넉히 주려고 먼저 1.2초 가만히 있다가
  // 흔들린다(요청: "누가 보낸건지 볼 시간이 짧아서 쉐이킹 전 1.2초 정지"). CSS 쪽 흔들림
  // animation-delay(1.2s) + 느려진 지속시간(0.9s) = 2.1초에 맞춰 "opening"으로 넘긴다.
  useEffect(() => {
    if (!current || stage !== "envelope") return;
    const t = window.setTimeout(() => setStage("opening"), 2100);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idx가 바뀌면 stage도 항상 "envelope"로 함께 리셋되므로 stage만으로 충분
  }, [stage, idx]);
  useEffect(() => {
    if (stage !== "opening") return;
    // 흔들림이 끝난 뒤 0.2초 멈췄다가 확대(CSS animation-delay)되므로, 그 멈춤(.2s) +
    // 확대·페이드아웃 지속시간(.45s)을 다 채운 뒤에 편지지로 넘어간다.
    const t = window.setTimeout(() => setStage("letter"), 650);
    return () => window.clearTimeout(t);
  }, [stage]);

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
  // 우리팀(지목된 쪽) = targets(나 포함) — 그중 나는 "(나)"로 표시해 바로 알아보게 한다.
  const isTeamMatch = current.matchType === "0102";
  const opposingTeam = [current.createdBy.nickname, ...current.ownMembers.map((m) => m.nickname)];
  const ourTeam = current.targets.map((t) => (t.memberId === myId ? `${t.nickname} (나)` : t.nickname));
  const title = `${current.createdBy.nickname}님에게서 도전장이 도착했어요`;

  return createPortal(
    <div className="scr-modal-overlay">
      {/* 편지지(letter) — 봉투와는 완전히 별개인 카드다(요청: "봉투랑 편지지는 별도 모달").
          봉투가 터지는 "opening"부터 그 뒤에서 카드째 확대되며 페이드인 등장하고(-emerge),
          봉투가 사라진 뒤에도 그대로 남는다. */}
      {stage !== "envelope" && (
        <div className={cx("scr-modal scr-modal-sm scr-challenge-inbox-modal", stage === "opening" && "scr-challenge-inbox-emerge")}>
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
          카드 배경 없이 봉투 사진 + 제목만 스크림 위에 떠서, envelope에서 좌우로 흔들리다
          opening에서 터지듯(확대+페이드아웃) 사라지며 뒤의 편지지를 드러낸다. */}
      {stage !== "letter" && (
        <div className={cx("scr-challenge-envelope-layer", stage === "opening" && "scr-challenge-envelope-layer-opening")}>
          {/* opening에서는 제목+봉투를 통째로 하나처럼 확대·페이드아웃시켜(inner에 burst)
              봉투가 완전히 터져 사라지며 뒤의 편지지(자기 제목 포함)가 드러나게 한다. */}
          <div className="scr-challenge-envelope-inner">
            <div className="scr-challenge-inbox-title">{title}</div>
            <div className={cx("scr-challenge-envelope scr-challenge-envelope-full", stage === "envelope" && "scr-challenge-envelope-shake")}>
              <img src="/images/bg/letter.jpg" alt="" className="scr-challenge-envelope-img" />
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
