import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "../components/common/Feedback";
import OptionalDateTimeFields from "../components/common/OptionalDateTimeFields";
import KakaoShareButton from "../components/common/KakaoShareButton";
import { api } from "../api/client";
import { useAppStore } from "../store/appStore";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { formatChallengeSchedule } from "../utils/date";
import { playMailChime } from "../utils/sfx";
import type { KakaoShareContent } from "../utils/kakaoShare";
import type { Challenge } from "../types";

interface ChallengeInboxModalProps {
  challenges: Challenge[];
  onClose: () => void;
}

// 다음 접속 때 뜨는 도전장 팝업 — 한 번에 하나씩만 보여주고, 응답하거나 닫으면 큐의
// 다음 도전장으로 넘어간다. 전부 처리되면 onClose로 부모가 닫는다.
export default function ChallengeInboxModal({ challenges, onClose }: ChallengeInboxModalProps) {
  useLockBodyScroll();
  // 편지지 제목("야 OO, 나와!")에 쓸 받는 사람(나) 닉네임.
  const user = useAppStore((s) => s.user);
  // 도전장 팝업이 뜨는 순간 우편 알림음(요청) — 마운트 때 한 번. 자동재생이 막힌 상황
  // (새로고침 복원 등 최근 제스처 없음)에선 조용히 무시된다.
  useEffect(() => { playMailChime(); }, []);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 오류가 어느 입력칸 것인지 — 그 칸에 에러 테두리(scr-input-invalid)를 함께 준다.
  // 남은 입력은 일정(날짜/시간)뿐이라 일정 오류만 있다.
  const [errField, setErrField] = useState<"schedule" | "">("");
  // 처음엔 편지봉투(envelope)만 보여준다 — 잠깐 대기했다가 흔들리고(요청: "약간만 대기했다가
  // 쉐이킹"), 흔들림이 끝나면 "열기/버리기" 버튼이 뜬다(요청: "버튼 다시 살릴게 버튼은
  // 열기/버리기"). 열기를 누르면 "letter"(편지지: 제목/내용/응답 폼)로 넘어가고, 버리기를
  // 누르면 응답 없이 다음 도전장으로 넘긴다(고민중과 같은 취급 — 다음 접속 때 다시 뜬다).
  // "accepted"는 승락 성공 뒤 뜨는 확인창 — 카카오톡 공유 버튼을 보여준다(요청). 확인을
  // 누르면 다음 도전장으로 넘어간다(advance).
  const [stage, setStage] = useState<"envelope" | "letter" | "accepted">("envelope");
  // 봉투 흔들림이 끝난 뒤에만 열기/버리기 버튼을 띄운다.
  const [envReady, setEnvReady] = useState(false);
  // 요청자가 "시간 지정"을 끄고 보낸(scheduledAt 없음) 도전장은 "상대가 정해도 된다"는
  // 뜻이다 — 승락하는 이 시점에 상대가 직접 정하게 한다(요청: "도전자/상대 모두 시간을
  // 지정하지 않았는데 수락이 된 경우가 있네 이러면 안되는데" — 안 그러면 시간이 영원히
  // 안 채워진 채 박제된다).
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");

  const current = challenges[idx];

  // 봉투가 뜨면 잠깐 대기(0.4s) 후 흔들리고(CSS animation-delay), 흔들림(0.6s×3회 = 1.8s)이
  // 끝나는 ≈2.2초 뒤에 열기/버리기 버튼을 띄운다. idx가 바뀌어 새 봉투가 뜰 때마다 버튼을
  // 다시 숨겼다가(setEnvReady(false)) 같은 타이밍으로 재노출한다.
  useEffect(() => {
    if (!current || stage !== "envelope") return;
    setEnvReady(false);
    const t = window.setTimeout(() => setEnvReady(true), 2200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idx가 바뀌면 stage도 항상 "envelope"로 함께 리셋되므로 stage만으로 충분
  }, [stage, idx]);

  if (!current) { onClose(); return null; }

  const needsSchedule = current.scheduledAt === null;

  const advance = () => {
    setStage("envelope");
    setDateStr("");
    setTimeStr("");
    setErr("");
    setErrField("");
    if (idx + 1 >= challenges.length) onClose();
    else setIdx((i) => i + 1);
  };

  // 승락 시에도 일시는 필수가 아니다(요청: "승락시에도 일시 미선택 가능이야") — 둘 다
  // 비워두면 그냥 미정인 채로 승락되고, 날짜만/시간만처럼 절반만 채운 경우만 막는다
  // (그 상태로 보내면 뜻이 애매해서).
  const scheduleIncomplete = needsSchedule && (dateStr.length > 0) !== (timeStr.length > 0);
  const canAccept = !scheduleIncomplete;

  const respond = async (response: "accepted" | "rejected") => {
    if (response === "accepted" && !canAccept) {
      setErr("날짜와 시간을 둘 다 정하거나, 둘 다 비워두세요.");
      setErrField("schedule");
      return;
    }
    setErr("");
    setErrField("");
    setBusy(true);
    try {
      const scheduledAt = response === "accepted" && needsSchedule && dateStr && timeStr
        ? new Date(`${dateStr}T${timeStr}`).toISOString()
        : undefined;
      await api.respondToChallenge(current.id, response, scheduledAt);
      // 승락은 확인창(카카오 공유)으로, 거절은 곧바로 다음 도전장으로.
      if (response === "accepted") setStage("accepted");
      else advance();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "응답하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 편지봉투 "버리기" — 열어보지 않고 사유 없이 완전히 폐기(휴지통)로 보낸다(요청: "완전히
  // 휴지통행이고 사유 없음"). 응답은 'discarded'(버림)로 기록돼 거절(rejected)과 구분 표시된다.
  // 성공하면 다음 도전장으로 넘어간다.
  const discard = async () => {
    setBusy(true);
    try {
      await api.respondToChallenge(current.id, "discarded");
      advance();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "버리지 못했어요.");
      setBusy(false);
    }
  };

  // 팀전(0102)이면 양 팀을 한눈에 확인할 수 있게 나눠 보여준다(요청: "팀전의 경우 상대팀원과
  // 우리팀 확인하기 좋게"). 상대팀(도전한 쪽) = 도전자(createdBy) + 그 팀원(ownMembers),
  // 우리팀(지목된 쪽) = targets(나 포함).
  const isTeamMatch = current.matchType === "0102";
  const opposingTeam = [current.createdBy.nickname, ...current.ownMembers.map((m) => m.nickname)];
  const ourTeam = current.targets.map((t) => t.nickname);
  // 편지봉투 위 문구와 편지지 제목을 다르게 둔다(요청).
  const envelopeTitle = `${current.createdBy.nickname}님에게 호출당함`;
  const letterTitle = `${user?.nickname ?? "너"} 너 나와!`;

  // 승락 확인창 — 최종 확정된 일시(요청자가 안 정했으면 내가 방금 고른 값)로 공유 내용을 만든다.
  const acceptedWhen = current.scheduledAt
    ? formatChallengeSchedule(current.scheduledAt)
    : dateStr && timeStr
      ? formatChallengeSchedule(new Date(`${dateStr}T${timeStr}`).toISOString())
      : formatChallengeSchedule(null);
  const shareAccept = (): KakaoShareContent => {
    const caller = current.createdBy.nickname;
    const me = user?.nickname ?? "";
    const matchup = isTeamMatch ? `${opposingTeam.join(", ")} vs ${ourTeam.join(", ")}` : `${caller} vs ${me}`;
    return {
      title: "대결 수락!",
      description: `${matchup} · ${acceptedWhen}`,
      imageUrl: `${window.location.origin}/images/items/nawa2.jpg`,
      link: `${window.location.origin}/?sv=challenge&sid=${current.id}`,
      fallbackText: `[스타게이트] ${me}님이 ${caller}님의 호출을 수락했어요!\n${matchup}\n일시: ${acceptedWhen}`,
    };
  };

  return createPortal(
    <div className="scr-modal-overlay">
      {/* 편지지(letter) — 봉투와는 완전히 별개인 카드다(요청: "봉투랑 편지지는 별도 모달").
          봉투가 사라지는 순간 그 자리에 애니메이션 없이 그냥 나타난다(요청: "편지지 확대
          페이드인 제거 그냥 나오기"). */}
      {stage === "letter" && (
        <div className="scr-modal scr-modal-sm scr-challenge-inbox-modal">
          <div className="scr-challenge-inbox-title">{letterTitle}</div>
          {/* 편지지 상단에 nawa2 이미지를 크게, 원형으로 크롭하고 가장자리를 그라데이션으로
              흐려서 배치한다(요청). */}
          <img src="/images/items/nawa2.jpg" alt="" className="scr-challenge-inbox-hero" />
          <div className="scr-modal-body scr-challenge-inbox-body">
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
                정할 수 있다 — 다만 필수는 아니다(요청: "승락시에도 일시 미선택
                가능이야"). 둘 다 비워두면 여전히 미정인 채로 승락되고, 날짜/시간을
                절반만 채운 경우만 막는다. 거절할 땐 필요 없으니 항상 보여준다. */}
            {needsSchedule && (
              <OptionalDateTimeFields
                dateStr={dateStr}
                onDateChange={(v) => {
                  setDateStr(v);
                  if (errField === "schedule") { setErr(""); setErrField(""); }
                }}
                timeStr={timeStr}
                onTimeChange={(v) => {
                  setTimeStr(v);
                  if (errField === "schedule") { setErr(""); setErrField(""); }
                }}
                invalid={errField === "schedule"}
              />
            )}

            {/* 일정을 안 정하고 승락을 누르면 여기 오류가 뜬다 — 뜰 때 아래 버튼 줄이
                크게 밀리지 않게 작은 한 줄 자리만 미리 예약하고, 박스/테두리 없이 작은 글씨만
                띄운다(요청: "예약공간을 12정도로 하고 그만한 글씨만 띄우자(테두리 없이)"). */}
            <div className="scr-challenge-inbox-err-slot" aria-live="polite">
              {err && <span className="scr-challenge-inbox-err-text">{err}</span>}
            </div>

            <div className="scr-form-actions">
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

      {/* 승락 확인창 — 수락하고 나면 이 카드로 바뀌어 카카오톡 공유를 권한다(요청). */}
      {stage === "accepted" && (
        <div className="scr-modal scr-modal-sm scr-challenge-inbox-modal">
          <div className="scr-modal-body scr-challenge-sent">
            <img src="/images/items/nawa2.jpg" alt="" className="scr-challenge-sent-hero" />
            <div className="scr-challenge-sent-title">대결 수락!</div>
            <div className="scr-challenge-sent-desc">{acceptedWhen}에 만나요. 카카오톡으로도 알려줄까요?</div>
            <div className="scr-form-actions scr-challenge-sent-actions">
              <KakaoShareButton variant="full" content={shareAccept} />
              <button type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid" onClick={advance}>확인</button>
            </div>
          </div>
        </div>
      )}

      {/* 편지봉투 — 편지지 카드와 한 몸이 아니라(요청) 오버레이 위에 겹치는 별도 레이어다.
          패널 배경은 투명(요청: "편지봉투 패널 배경은 투명알지?")이라 배경이 투명한 봉투
          그림 + 제목 + 버튼만 스크림 위에 뜬다. 잠깐 대기 후 흔들리고, 흔들림이 끝나면
          열기/버리기 버튼이 나타난다. */}
      {stage === "envelope" && (
        // key로 도전장마다 봉투를 새로 마운트해 흔들림 애니메이션이 매번 다시 재생되게 한다
        // (버리기로 envelope→envelope 넘어갈 때도 확실히 replay).
        <div key={current.id} className="scr-challenge-envelope-layer">
          <div className="scr-challenge-envelope-inner">
            <div className="scr-challenge-inbox-title">{envelopeTitle}</div>
            <div className="scr-challenge-envelope scr-challenge-envelope-full scr-challenge-envelope-shake">
              <img src="/images/items/envelope.png" alt="" className="scr-challenge-envelope-img" />
            </div>
            {/* 열기/버리기 — 흔들림이 끝나면(envReady) 페이드 인으로 나타난다. 단, 처음부터
                이 자리를(높이를) 항상 차지하게 두어(조건부 렌더 대신 클래스 토글), 버튼이
                생길 때 봉투가 위로 밀려 올라가지 않고 제자리에 있고 버튼만 아래에 스르륵
                떠오르게 한다(요청). 준비 전엔 클릭도 막는다(pointer-events/disabled). */}
            <div
              className={`scr-challenge-envelope-actions${envReady ? " scr-challenge-envelope-actions-ready" : ""}`}
              aria-hidden={!envReady}
            >
              <button
                type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-challenge-envelope-open"
                onClick={() => setStage("letter")} disabled={busy || !envReady}
              >
                열기
              </button>
              <button
                type="button" className="scr-btn scr-btn-ghost scr-challenge-envelope-discard"
                onClick={discard} disabled={busy || !envReady}
              >
                버리기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
