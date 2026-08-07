import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "../components/common/Feedback";
import OptionalDateTimeFields from "../components/common/OptionalDateTimeFields";
import KakaoShareButton from "../components/common/KakaoShareButton";
import ActivityComments from "../pages/activity/ActivityComments";
import { ChallengeLetter, ChallengeWhen } from "../components/challenge/ChallengeLetter";
import { api } from "../api/client";
import { useAppStore } from "../store/appStore";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { formatWhen } from "../utils/date";
import { playMailChime } from "../utils/sfx";
import { shareThumb, type KakaoShareContent } from "../utils/kakaoShare";
import type { Challenge } from "../types";

interface ChallengeInboxModalProps {
  challenges: Challenge[];
  onClose: () => void;
  // 공유 화면(SharePage)에서 재사용할 때, 응답 버튼 없이 읽기만 하는 사람(대상이 아닌 사람)이
  // 누를 마무리 버튼 문구. 기본 "닫기". 공유 화면에선 "스타게이트로"를 넘긴다.
  closeLabel?: string;
  // 카톡 공유 링크로 열렸을 때(SharePage) 뒤에 깔 흰 벽지 배경("너 나와~" 반복). 앱 안에서
  // 뜨는 평소 인박스 팝업에선 앱 배경을 그대로 두므로 false(기본).
  shareBackdrop?: boolean;
  /** 편지봉투를 건너뛰고 편지지부터 보여주나 — 공유로 열린 화면은 늘 이쪽이다(요청:
   *  "너 나와 공유에서 편지봉투씬을 다 제거… 어떤 경우라도 편지지만 바로"). 봉투를 흔들어
   *  궁금증을 만드는 것은 인박스에서 제 편지를 받아 보는 사람의 몫이고, 링크를 타고 온
   *  사람에게는 이미 카카오톡 카드가 그 몫을 했다. */
  skipEnvelope?: boolean;
  /** 응답 공유(?sv=challengeReply)로 열렸나 — 그러면 이 화면이 말하는 것은 호출이 아니라
   *  '그 호출에 누가 어떻게 답했나'다(요청: "응답은 응답을 한 내용을 보여줘야 되는데").
   *  봉투 문구가 "OO님의 응답"이 되고, 편지지에는 응답 상태와 응답자의 한마디가 크게 선다.
   *  읽기 전용이라 응답 버튼은 나오지 않는다 — 이미 끝난 이야기다. */
  reply?: boolean;
}

// 다음 접속 때 뜨는 도전장 팝업 — 한 번에 하나씩만 보여주고, 응답하거나 닫으면 큐의
// 다음 도전장으로 넘어간다. 전부 처리되면 onClose로 부모가 닫는다. 공유 링크가 여는 화면
// (SharePage)에서도 그대로 재사용한다 — 그쪽은 봉투 없이 편지지부터 열고(skipEnvelope),
// 지목된 대상(targets)만 거절/승락/고민중 버튼을 볼 수 있고, 대상이 아니면 읽기 전용으로만
// 보여준다(요청).
export default function ChallengeInboxModal({
  challenges, onClose, closeLabel = "닫기", shareBackdrop = false, reply = false,
  skipEnvelope = false,
}: ChallengeInboxModalProps) {
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
  // 인박스에서는 편지봉투(envelope)부터 보여준다 — 잠깐 대기했다가 흔들리고(요청: "약간만
  // 대기했다가 쉐이킹"), 흔들림이 끝나면 "열기" 버튼이 뜬다. 열기를 누르면 "letter"(편지지:
  // 제목/내용/응답 폼)로 넘어간다. 공유로 열린 화면은 봉투 없이 곧장 편지지다(skipEnvelope).
  // "responded"는 승락/거절 성공 뒤 뜨는 확인창 — 카카오톡 공유 버튼을 보여준다(요청: 수락
  // 뿐 아니라 거절도 공유 가능). 확인을 누르면 다음 도전장으로 넘어간다(advance).
  const first = skipEnvelope ? "letter" : "envelope";
  const [stage, setStage] = useState<"envelope" | "letter" | "responded">(first);
  // 방금 보낸 응답 종류 — 확인창 제목/공유 문구를 수락/거절에 맞춰 바꾼다.
  const [respondedAs, setRespondedAs] = useState<"accepted" | "rejected" | null>(null);
  // 봉투 흔들림이 끝난 뒤에만 열기 버튼을 띄운다.
  const [envReady, setEnvReady] = useState(false);
  // 요청자가 "시간 지정"을 끄고 보낸(scheduledAt 없음) 도전장은 "상대가 정해도 된다"는
  // 뜻이다 — 승락하는 이 시점에 상대가 직접 정하게 한다(요청: "도전자/상대 모두 시간을
  // 지정하지 않았는데 수락이 된 경우가 있네 이러면 안되는데" — 안 그러면 시간이 영원히
  // 안 채워진 채 박제된다).
  const [dateStr, setDateStr] = useState("");
  const [noteStr, setNoteStr] = useState("");

  const current = challenges[idx];

  // 봉투가 뜨면 잠깐 대기(0.4s) 후 흔들리고(CSS animation-delay), 흔들림(0.6s×3회 = 1.8s)이
  // 끝나는 ≈2.2초 뒤에 열기 버튼을 띄운다. idx가 바뀌어 새 봉투가 뜰 때마다 버튼을
  // 다시 숨겼다가(setEnvReady(false)) 같은 타이밍으로 재노출한다.
  useEffect(() => {
    if (!current || stage !== "envelope") return;
    setEnvReady(false);
    const t = window.setTimeout(() => setEnvReady(true), 2200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idx가 바뀌면 stage도 항상 "envelope"로 함께 리셋되므로 stage만으로 충분
  }, [stage, idx]);

  if (!current) { onClose(); return null; }

  // 요청자가 이미 정해서 온 값은 응답자가 못 바꾸게 잠근다(요청). 날짜만 정하고 "언제"는
  // 비운 도전장이면 날짜는 잠긴 채 "언제"만 응답자가 덧붙일 수 있다(요청).
  const dateLocked = current.scheduledDate !== null;
  const noteLocked = current.scheduledTimeNote.trim() !== "";

  /* 응답 공유에서 이야기의 주인공은 답한 사람이다 — 아직 답 안 한 사람(pending)은 뺀다.
     팀전이라 여럿이 답했으면 한마디를 남긴 사람을 먼저 세운다: 할 말이 있는 쪽이 보여줄
     것이 많고, 이 화면이 크게 띄우려는 것이 바로 그 한마디다. */
  const responder = !reply ? null
    : (current.targets.find((t) => t.response !== "pending" && t.responseMessage.trim())
      ?? current.targets.find((t) => t.response !== "pending")
      ?? null);
  const replyKind = responder?.response ?? null;
  /** 버림은 열어 볼 편지가 없다 — 그 사실 한 줄로 끝낸다. 버리기 기능은 없앴지만(요청)
   *  예전에 버려진 기록은 그대로 남아 있어, 그것을 여는 공유 링크를 위해 이 갈래는 둔다. */
  const replyDiscarded = reply && replyKind === "discarded";

  // 지목된 대상(targets)만 응답 버튼을 볼 수 있다(요청: "대상만 거절/수락/고민중 버튼").
  // 인박스 팝업은 애초에 pending-for-me(나=대상)만 오므로 항상 true, 공유 화면에선 링크를
  // 연 사람이 대상인지에 따라 갈린다. 응답 공유는 이미 끝난 이야기라 늘 읽기 전용이다.
  const canRespond = !reply && !!user && current.targets.some((t) => t.memberId === user.id);

  const advance = () => {
    setStage(first);
    setRespondedAs(null);
    setDateStr("");
    setNoteStr("");
    setErr("");
    setErrField("");
    if (idx + 1 >= challenges.length) onClose();
    else setIdx((i) => i + 1);
  };

  // 승락 시에도 일시는 필수가 아니다(요청: "승락시에도 일시 미선택 가능이야"). 이제 날짜만
  // 정하고 시간은 비워두는 것도 허용하므로(요청: "시간은 나중에 결정") 막을 조합이 없다 —
  // 날짜 없이 시간만 넣는 건 시간 입력이 날짜 전엔 비활성화라 애초에 불가능하다.
  const canAccept = true;

  const respond = async (response: "accepted" | "rejected") => {
    setErr("");
    setErrField("");
    setBusy(true);
    try {
      // 확정 일정 = 이미 정해져 온 값(잠김)이 있으면 그걸, 없으면 응답자가 입력한 값.
      // 날짜가 없으면 "언제"도 버린다 — 가리킬 날이 없다.
      let schedule: { scheduledDate: string | null; scheduledTimeNote: string } | undefined;
      if (response === "accepted") {
        const finalDate = current.scheduledDate ?? (dateStr || null);
        const note = current.scheduledTimeNote.trim() || (finalDate ? noteStr.trim() : "");
        schedule = { scheduledDate: finalDate, scheduledTimeNote: note };
      }
      await api.respondToChallenge(current.id, response, schedule);
      // 승락/거절 모두 확인창(카카오 공유)으로 넘어간다(요청).
      setRespondedAs(response);
      setStage("responded");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "응답하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 편지봉투 위 문구 — 누가 지목됐는지는 감추고 "누구님의 호출"만 보여 궁금증을 유발한다
  // (요청). 지목 대상은 열어야(편지지) 드러난다.
  const envelopeTitle = reply && responder
    ? `${responder.nickname}님의 응답`
    : `${current.createdBy.nickname}님의 호출`;
  /* 부른 사람이 올린 편지지 배경 사진(요청) — 있으면 편지지의 유리 패널 대신 이 사진이
     깔린다. 사진 위에는 테마에 맞는 얇은 막을 한 겹 덮고 글자마다 반대색 테두리를
     두르는데(요청: "글자들이 잘 보이도록 편지지색에 반대되는 흰/검 테두리"), 어떤 사진이
     올라올지 모르니 그 둘이 없으면 밝은 사진에서 흰 글자가 통째로 사라진다. */
  const backdrop = current.backdropUrl;
  const letterStyle = backdrop
    ? ({ "--letter-photo": `url("${backdrop}")` } as CSSProperties)
    : undefined;

  // 응답 확인창 — 최종 확정된 일시(요청자가 안 정했으면 내가 방금 고른 값)로 공유 내용을 만든다.
  const acceptedEffDate = current.scheduledDate ?? (dateStr || null);
  const acceptedEffNote = current.scheduledTimeNote.trim() || (acceptedEffDate ? noteStr.trim() : "");
  const acceptedWhen = formatWhen(acceptedEffDate)
    + (acceptedEffNote ? ` ${acceptedEffNote}` : "");
  const respondedTitle = respondedAs === "rejected" ? "대결 거절" : "대결 수락!";
  const respondedDesc = respondedAs === "rejected"
    ? "호출을 거절했어요."
    : `${acceptedWhen}에 만나요.`;
  // 공유 카드는 "누가 누구의 호출에 응답했다"까지만 말한다(요청) — 수락인지 거절인지도,
  // 대진도, 정해진 일시도 내지 않는다. 그걸 카드에 적으면 링크를 열어 볼 이유가 사라진다
  // (호출 공유가 지목 상대를 감추는 것과 같은 이유). 그래서 수락/거절이 같은 문구다.
  const shareResponded = (): KakaoShareContent => {
    const caller = current.createdBy.nickname || "누군가";
    const me = user?.nickname || "누군가";
    return {
      title: `${me}님이 ${caller}님의 호출에 응답했어요`,
      description: "수락일까요, 거절일까요? 👀 탭해서 확인하기",
      ...shareThumb("challengeReply"),
      // 호출 공유와 다른 주소다(지적: 응답 공유가 호출 공유랑 똑같은 것으로 연결됨) —
      // 같은 도전장이라도 보여줄 이야기가 다르다.
      link: `${window.location.origin}/?sv=challengeReply&sid=${current.id}`,
      fallbackText: `[스타게이트] ${me}님이 ${caller}님의 호출에 응답했어요! 열어서 확인해보세요.`,
    };
  };

  /* 이 호출에 달린 댓글 — 활동 목록의 그것과 같은 하나다(요청: "활동 댓글하고 같은 거").
     편지지·버림·응답 확인 장면마다 이 덩어리를 하나씩 두므로, 어디서 달아도 같은 자리에
     쌓이고 인박스·활동 목록에서도 그대로 보인다. 앞으로 들어올 일정·리그 공유도 카드
     모양이 무엇이든 이 줄만 얹으면 된다(요청).
     편지봉투에는 안 붙인다(요청) — 아직 열지도 않은 편지에 댓글창부터 나오면 봉투가
     감춰 두려던 것(누가 누구를 불렀나)이 댓글로 새기도 하고, 봉투는 '열기' 하나만
     남기는 장면이다.

     모달 안이라 overModal을 켠다 — 모바일 댓글 시트가 이 모달(z-index:100) 위로 올라와야
     한다. 클릭이 바깥으로 새지 않게 감싸는 것은 컴포넌트가 이미 한다. */
  const comments = (
    <div className="scr-challenge-scene-comments">
      <ActivityComments targetType="challenge" targetId={current.id} overModal />
    </div>
  );

  return createPortal(
    <div className={`scr-modal-overlay${shareBackdrop ? " scr-challenge-share" : ""}`}>
      {/* 카톡 공유로 열렸을 때만 뒤에 흰 벽지("너 나와~" 반복)를 깐다(요청). 봉투/편지지보다
          아래(z-index 없음)에 위치해 배경으로만 보인다. */}
      {shareBackdrop && <div className="scr-challenge-share-bg" aria-hidden="true" />}

      {/* 버림은 열어 볼 편지가 없다(요청: "버림의 경우 편지봉투 씬 없이 OO님이 편지를 버림
          나오고 끝") — 봉투를 흔들어 놓고 열어 봤자 안에 답이 없으니, 그 사실 한 장으로
          끝낸다. 아래 봉투·편지지 갈래는 통째로 건너뛴다. */}
      {replyDiscarded && responder && (
        <div className="scr-modal scr-modal-sm scr-challenge-inbox-modal scr-challenge-letter scr-challenge-discarded">
          <div className="scr-modal-body scr-challenge-inbox-body">
            <div className="scr-challenge-discarded-art" aria-hidden="true">🗑️</div>
            <div className="scr-challenge-discarded-title">
              {responder.nickname}님이 편지를 버림
            </div>
          </div>
          <div className="scr-form-actions scr-challenge-letter-actions">
            <button type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid" onClick={advance}>
              {closeLabel}
            </button>
          </div>
          {comments}
        </div>
      )}
      {/* 편지지(letter) — 봉투와는 완전히 별개인 카드다(요청: "봉투랑 편지지는 별도 모달").
          봉투가 사라지는 순간 그 자리에 애니메이션 없이 그냥 나타난다(요청: "편지지 확대
          페이드인 제거 그냥 나오기"). */}
      {!replyDiscarded && stage === "letter" && (
        <div
          className={`scr-modal scr-modal-sm scr-challenge-inbox-modal scr-challenge-letter${
            backdrop ? " scr-challenge-letter-photo" : ""}`}
          style={letterStyle}
        >
          {/* 배경 사진 — 유리 패널(.scr-modal::before)보다 위, 내용보다 아래에 깔린다.
              둘은 같은 z-index:-1이라 DOM 순서로 앞뒤가 갈린다: ::before가 항상 첫 자식
              이므로 이 칸은 반드시 첫 '진짜' 자식이어야 사진이 유리 위에 얹힌다. */}
          {backdrop && <div className="scr-challenge-letter-bg" aria-hidden="true" />}
          {/* 편지지 한 통 — From. / 제목·일시·한마디 / To.(요청: 카드·공유·인박스가 같은
              양식). 일시는 이 편지의 용건이라 한마디보다 위다(요청). */}
          <ChallengeLetter
            challenge={current}
            when={canRespond ? null : <ChallengeWhen challenge={current} />}
            schedule={canRespond ? (
              /* 응답자에겐 입력칸으로 보여준다(요청: "텍스트가 아니라 인풋창 그대로").
                 이미 정해져 온 값은 잠긴 칸으로, 비어 있는 쪽은 지금 채울 수 있다.
                 구경하는 사람에겐 입력이 의미 없어 글로만 보여준다. */
              <OptionalDateTimeFields
                dateStr={dateLocked ? current.scheduledDate! : dateStr}
                onDateChange={(v) => {
                  setDateStr(v);
                  if (errField === "schedule") { setErr(""); setErrField(""); }
                }}
                noteStr={noteLocked ? current.scheduledTimeNote : noteStr}
                onNoteChange={(v) => {
                  setNoteStr(v);
                  if (errField === "schedule") { setErr(""); setErrField(""); }
                }}
                dateLocked={dateLocked}
                noteLocked={noteLocked}
                invalid={errField === "schedule"}
              />
            ) : null}
            foot={(
              /* 일정을 안 정하고 승락을 누르면 여기 오류가 뜬다 — 뜰 때 아래 버튼 줄이
                 크게 밀리지 않게 작은 한 줄 자리만 미리 예약하고, 박스/테두리 없이
                 작은 글씨만 띄운다(요청). */
              <div className="scr-challenge-inbox-err-slot" aria-live="polite">
                {err && <span className="scr-challenge-inbox-err-text">{err}</span>}
              </div>
            )}
          />

          {/* 버튼 — 맨 아래(To. 아바타 아래, 요청). 지목된 대상만 응답 버튼을 보고, 대상이
              아니면(공유 링크 구경) 마무리 버튼 하나만. */}
          {canRespond ? (
            <div className="scr-form-actions scr-challenge-letter-actions">
              <button
                className="scr-btn scr-challenge-reject-btn" onClick={() => respond("rejected")}
                disabled={busy}
              >
                {busy ? <Spinner /> : "거절"}
              </button>
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
          ) : (
            <div className="scr-form-actions scr-challenge-letter-actions">
              <button type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid" onClick={advance}>
                {closeLabel}
              </button>
            </div>
          )}
          {comments}
        </div>
      )}

      {/* 응답 확인창 — 승락/거절하고 나면 이 카드로 바뀌어 카카오톡 공유를 권한다(요청). */}
      {stage === "responded" && (
        <div className="scr-modal scr-modal-sm scr-challenge-inbox-modal">
          <div className="scr-modal-body scr-challenge-sent">
            <div className="scr-challenge-sent-title">{respondedTitle}</div>
            <div className="scr-challenge-sent-desc">{respondedDesc}</div>
            <div className="scr-form-actions scr-challenge-sent-actions">
              <KakaoShareButton variant="full" iconOnly content={shareResponded} />
              <button type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid" onClick={advance}>확인</button>
            </div>
          </div>
          {comments}
        </div>
      )}

      {/* 편지봉투 — 편지지 카드와 한 몸이 아니라(요청) 오버레이 위에 겹치는 별도 레이어다.
          패널 배경은 투명(요청: "편지봉투 패널 배경은 투명알지?")이라 배경이 투명한 봉투
          그림 + 제목 + 버튼만 스크림 위에 뜬다. 잠깐 대기 후 흔들리고, 흔들림이 끝나면
          열기 버튼이 나타난다. 버리기는 없앴다(요청: "버리기 기능은 이제 없는 걸로"). */}
      {!replyDiscarded && stage === "envelope" && (
        // key로 도전장마다 봉투를 새로 마운트해 흔들림 애니메이션이 매번 다시 재생되게 한다
        // (다음 도전장으로 넘어갈 때도 확실히 replay).
        <div key={current.id} className="scr-challenge-envelope-layer">
          <div className="scr-challenge-envelope-inner">
            <div className="scr-challenge-inbox-title">{envelopeTitle}</div>
            <div className="scr-challenge-envelope scr-challenge-envelope-full scr-challenge-envelope-shake">
              <img src="/images/challenge/challenge_envelope.png" alt="" className="scr-challenge-envelope-img" />
            </div>
            {/* 열기 — 흔들림이 끝나면(envReady) 페이드 인으로 나타난다. 단, 처음부터
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
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
