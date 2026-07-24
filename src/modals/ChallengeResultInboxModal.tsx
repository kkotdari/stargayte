import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "../components/common/Feedback";
import Avatar, { type AvatarMember } from "../components/common/Avatar";
import { api } from "../api/client";
import { useAppStore } from "../store/appStore";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { DATE_INPUT_MIN, DATE_INPUT_MAX, gameNow, pad } from "../utils/date";
import { MATCH_TYPE_INFO } from "../constants/matchTypes";
import type { Challenge, ChallengeResult } from "../types";

interface ChallengeResultInboxModalProps {
  challenges: Challenge[];
  onClose: () => void;
}

// 다음 접속 때 뜨는 "결과 입력" 팝업 — 예정 일시가 지났는데 아직 결과가 안 들어온, 내가
// 참가한 확정 너 나와를 한 번에 하나씩 보여주고(요청: "결과 입력할게 여러개면 팝업도 여러개
// 뜨나?" → 큐로 하나씩) 승리팀을 눌러 바로 결과를 입력하게 한다. 초대(편지지)
// 팝업(ChallengeInboxModal)과 UI 패턴을 맞춘다. "봤는지"는 초대 팝업과 같은 원리로 서버
// (challenge_participants.result_notified)가 기억한다 — 조회 즉시 "봤음"이 되므로 여기
// 담겨 넘어온 목록 자체가 이미 "아직 안 본 것"뿐이고, 이 팝업에서 입력하든 넘기든 다시는
// 자동으로 안 뜬다(너 나와 화면에서는 결과가 입력될 때까지 계속 "결과 입력" 버튼이 뜬다).
export default function ChallengeResultInboxModal({ challenges, onClose }: ChallengeResultInboxModalProps) {
  useLockBodyScroll();
  const memberOf = useAppStore((s) => s.memberOf);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // 결과 입력 시엔 실제 대결 날짜/시간을 무조건 함께 넣는다(요청). 큐에서 항목이 바뀔 때마다
  // 이미 정해진 일시가 있으면 그걸로, 없으면 오늘 + 21시로 미리 채운다.
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");
  const current = challenges[idx];
  useEffect(() => {
    if (!current) return;
    const now = gameNow();
    setDateStr(current.scheduledDate ?? `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
    setTimeStr(current.scheduledTime ?? "21:00");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 큐 항목(idx)이 바뀔 때만 다시 채운다
  }, [idx]);
  if (!current) { onClose(); return null; }

  const advance = () => {
    setErr("");
    if (idx + 1 >= challenges.length) onClose();
    else setIdx((i) => i + 1);
  };

  const submit = async (winnerSide: ChallengeResult) => {
    if (!dateStr || !timeStr) { setErr("실제 대결 날짜와 시간을 입력하세요."); return; }
    setErr("");
    setBusy(true);
    try {
      await api.enterChallengeResult(current.id, winnerSide, dateStr, timeStr);
      advance();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "결과를 입력하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 도전자 본인은 응답 객체에 프사가 없어(닉네임만) 로컬 회원 목록에서 프사를 찾아 채운다 —
  // 지목된 상대/내 팀원은 서버가 프사까지 내려주니 그대로 쓴다.
  const creatorMembers: AvatarMember[] = [
    { id: current.createdBy.id, nickname: current.createdBy.nickname, avatar: memberOf(current.createdBy.id)?.avatar ?? null },
    ...current.ownMembers.map((m) => ({ id: m.memberId, nickname: m.nickname, avatar: m.avatar })),
  ];
  const targetMembers: AvatarMember[] = current.targets.map((t) => ({ id: t.memberId, nickname: t.nickname, avatar: t.avatar }));

  return createPortal(
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm scr-challenge-inbox-modal">
        <div className="scr-challenge-inbox-title">지난 너 나와! 결과를 입력해 주세요</div>
        <div className="scr-modal-body scr-challenge-inbox-body">
          {/* 어떤 경기인지 구분할 수 있게 종류/일시를 함께 보여준다. */}
          <div className="scr-challenge-inbox-row">
            <span className="scr-label">종류</span>
            <span>{MATCH_TYPE_INFO[current.matchType]}</span>
          </div>
          {/* 실제 대결 날짜/시간을 무조건 입력한다(요청). 시간 칸은 빈 채로 누르면 21시로 열린다. */}
          <div className="scr-challenge-inbox-row">
            <span className="scr-label">일시</span>
            <div className="scr-challenge-time-edit-row scr-challenge-result-when">
              <input
                type="date" className="scr-input scr-challenge-time-edit-input"
                value={dateStr} min={DATE_INPUT_MIN} max={DATE_INPUT_MAX}
                onChange={(e) => setDateStr(e.target.value)}
              />
              <input
                type="time" className="scr-input scr-challenge-time-edit-input"
                value={timeStr}
                onFocus={() => { if (!timeStr) setTimeStr("21:00"); }}
                onChange={(e) => setTimeStr(e.target.value)}
              />
            </div>
          </div>

          {err && <div className="scr-err">{err}</div>}

          <p className="scr-challenge-inbox-message">승리한 팀을 눌러주세요 — 먼저 입력하는 쪽이 그대로 인정돼요.</p>

          {/* 구성원을 프사와 함께 보여주고 팀 카드를 눌러 승리팀을 고른다. */}
          <div className="scr-challenge-result-teams">
            <button
              type="button" className="scr-challenge-result-team" onClick={() => submit("creator")}
              disabled={busy}
            >
              <span className="scr-challenge-result-team-label">도전자편</span>
              <span className="scr-challenge-result-team-members">
                {creatorMembers.map((p) => (
                  <span key={p.id} className="scr-challenge-result-member">
                    <Avatar member={p} size={20} />
                    <span className="scr-challenge-result-member-name">{p.nickname}</span>
                  </span>
                ))}
              </span>
              <span className="scr-challenge-result-team-win">승리</span>
            </button>
            <button
              type="button" className="scr-challenge-result-team" onClick={() => submit("target")}
              disabled={busy}
            >
              <span className="scr-challenge-result-team-label">상대편</span>
              <span className="scr-challenge-result-team-members">
                {targetMembers.map((p) => (
                  <span key={p.id} className="scr-challenge-result-member">
                    <Avatar member={p} size={20} />
                    <span className="scr-challenge-result-member-name">{p.nickname}</span>
                  </span>
                ))}
              </span>
              <span className="scr-challenge-result-team-win">승리</span>
            </button>
          </div>

          {/* 무승부는 완료로 남고, 미실시(not_held)는 폐기(휴지통)로 간다. */}
          <div className="scr-form-actions">
            <button className="scr-btn scr-btn-ghost" onClick={() => submit("draw")} disabled={busy}>무승부</button>
            <button className="scr-btn scr-btn-ghost" onClick={() => submit("not_held")} disabled={busy}>미실시</button>
          </div>
          {/* 지금 입력하기 애매하면 나중에 — 다음 접속 때 다시 팝업으로 뜬다. */}
          <div className="scr-form-actions">
            <button className="scr-btn scr-btn-ghost" onClick={advance} disabled={busy}>나중에</button>
          </div>
          {busy && <div className="scr-challenge-result-busy"><Spinner /></div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
