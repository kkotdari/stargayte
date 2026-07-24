import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Send, MessageSquarePlus } from "lucide-react";
import { cx } from "../utils/format";
import Avatar from "../components/common/Avatar";
import OptionalDateTimeFields from "../components/common/OptionalDateTimeFields";
import { Spinner } from "../components/common/Feedback";
import KakaoShareButton from "../components/common/KakaoShareButton";
import MemberPickBlock from "../components/common/MemberPickBlock";
import { useAppStore } from "../store/appStore";
import { api } from "../api/client";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { DEFAULT_CHALLENGE_TIME } from "../utils/date";
import type { KakaoShareContent } from "../utils/kakaoShare";
import type { Challenge } from "../types";

// 상대는 최대 4명까지 지목할 수 있고(팀전), 내 팀은 본인 자동 포함이라 "본인 제외"
// 최대 3명(본인 포함 4명)까지 넣을 수 있다 — 서버의 max_length(target 4 / own 3)와 같다.
// 경기 유형(개인전/팀전)을 따로 고르지 않는다(요청: "너 나와 유형 제거하고 자동으로 판단함") —
// 실제 경기 유형은 서버와 똑같은 규칙으로 인원수만 보고 정해진다(상대1·팀0 → 1:1, 그 외 팀전).
const MAX_TARGETS = 4;
const MAX_OWN_TEAM = 3;

interface ChallengeFormModalProps {
  onClose: () => void;
  onCreated: (challenge: Challenge) => void;
  // 너 나와! 신청 "들어주기"로 열 때 — 요청 작성자를 상대로 미리 채워 넣는다.
  presetTargetIds?: string[];
  // 너 나와! 신청 "들어주기"로 만드는 도전장이면 true — 서버가 "요청너 나와" 표식을 남긴다.
  fromMatchRequest?: boolean;
  // 랭킹 목록의 종이비행기 버튼처럼 "바로 그 상대"로 연 경우 — 상대를 presetTargetIds
  // 그대로 고정해서 더/빼기가 아예 안 되게 하고(요청: "상대팀에도 딱 그 상대만 고정 x
  // 버튼도 없어야되고 추가버튼도 없어야돼"), 팀전 구성("내 팀") 자체를 이 흐름에서는
  // 안 쓰므로 그 영역도 통째로 뺀다(요청: "우리팀 추가 영역 삭제").
  lockTarget?: boolean;
}

// "너 나와!" 도전장 작성 — 상대 지목(최대 4명)/내 팀(선택, 최대 3명)/일시(선택, 날짜만도
// 가능)/한마디. 상대가 응답할 때는 이 시간을 바꿀 수 없고 수락/거절만 가능하다 — 거절되면
// 요청자가 재신청하면서 시간/메모를 고칠 수 있다.
export default function ChallengeFormModal({ onClose, onCreated, presetTargetIds, fromMatchRequest, lockTarget }: ChallengeFormModalProps) {
  useLockBodyScroll();
  const members = useAppStore((s) => s.members);
  const user = useAppStore((s) => s.user);

  // 너 나와! 신청 들어주기로 열렸으면 그 작성자를 상대로 미리 채운다.
  const preset = presetTargetIds ?? [];
  const [targetIds, setTargetIds] = useState<string[]>(preset);
  const [ownTeamIds, setOwnTeamIds] = useState<string[]>([]);

  // 날짜/시간 둘 다 처음부터 보여준다(요청: "날짜 선택, 시간 선택 체크박스 제거하고
  // 처음부터 둘다 노출하되 라벨에 선택 붙어있으니 괜춘") — 둘 다 필수는 아니고, 날짜
  // 없이 시간만 있는 조합은 UI상 애초에 나올 수 없다(시간 입력이 날짜를 고른 뒤에만
  // 활성화된다). 날짜만 정하고 시간은 안 정하면(=상대가 시간을 정해도 됨) 제출 시
  // 기본 시간(22:00)으로 채운다.
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");
  // 호출 한마디(선택) — 아이콘 버튼을 눌러야 입력창이 트랜지션으로 열린다(요청).
  const [message, setMessage] = useState("");
  const [messageOpen, setMessageOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 호출을 보내고 나면(성공) 이 확인창으로 넘어가 카카오톡 공유 버튼을 보여준다(요청). 여기서
  // 확인/닫기를 누를 때 비로소 onCreated로 목록을 갱신하고 모달을 닫는다(그 전에 onCreated를
  // 부르면 호출부에 따라 모달이 즉시 언마운트돼 확인창을 못 보여준다).
  const [sentChallenge, setSentChallenge] = useState<Challenge | null>(null);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const activeMembers = useMemo(
    () => members.filter((m) => m.status === "active" && m.id !== user?.id),
    [members, user?.id],
  );
  // 상대/내 팀 어느 쪽에든 이미 고른 회원은 후보에서 뺀다 — 같은 회원을 두 번 지목하거나
  // 양 팀에 동시에 넣는 걸 목록 단계에서부터 막는다(서버도 검증하지만 여기서 즉시 피드백).
  const chosen = useMemo(() => new Set([...targetIds, ...ownTeamIds]), [targetIds, ownTeamIds]);
  const memberOptions = useMemo(
    () => activeMembers
      .filter((m) => !chosen.has(m.id))
      .map((m) => ({ value: m.id, label: `${m.nickname} (${m.battletag})`, avatar: <Avatar member={m} size={20} /> }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [activeMembers, chosen],
  );

  // 경기 유형을 따로 안 골라도, 상대를 1명 이상만 지목하면 항상 유효한 조합이 된다 —
  // 상대 1명·내 팀 0명이면 서버가 1:1로, 그 외(상대 2명 이상이거나 내 팀이 있으면)
  // 팀전으로 자동 판단한다(요청: "너 나와 유형 제거하고 자동으로 판단함").
  const canSubmit = targetIds.length >= 1;

  // 모달 타이틀은 지목한 상대 이름을 넣어 "누구누구 호출하기"로(요청). 아직 안 골랐으면
  // 그냥 "호출하기", 여럿이면 "OO 외 N명 호출하기".
  const targetNames = targetIds.map((id) => memberById.get(id)?.nickname).filter(Boolean) as string[];
  const titleName = targetNames.length === 0
    ? ""
    : targetNames.length === 1
      ? targetNames[0]
      : `${targetNames[0]} 외 ${targetNames.length - 1}명`;
  const modalTitle = titleName ? `${titleName} 호출하기` : "호출하기";

  const submit = async () => {
    if (!canSubmit) return;
    setErr("");
    setBusy(true);
    try {
      // 날짜를 아예 안 정하면(기본값) 상대방이 정하기로 한 것이므로 null. 날짜만 정하고
      // 시간은 안 정했으면 기본 시간(21시)으로 채운다(요청).
      const scheduledAt = dateStr ? new Date(`${dateStr}T${timeStr || DEFAULT_CHALLENGE_TIME}`).toISOString() : null;
      const challenge = await api.createChallenge({
        targetMemberIds: targetIds,
        ownTeamMemberIds: ownTeamIds,
        scheduledAt,
        message: message.trim(),
        fromMatchRequest,
      });
      // 바로 닫지 않고 확인창(카카오 공유)으로 넘어간다.
      setSentChallenge(challenge);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "도전장을 보내지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 확인창에서 확인/닫기 — 이때 목록 갱신(onCreated) 후 모달을 닫는다.
  const finish = () => {
    if (sentChallenge) onCreated(sentChallenge);
    onClose();
  };

  // 호출 완료 확인창의 카카오톡 공유 내용.
  const shareCall = (challenge: Challenge): KakaoShareContent => {
    const caller = user?.nickname ?? "";
    // 미리보기에서 지목 대상("X 너 나와!")은 감추고 "OO님의 호출"만 노출해 궁금증을 유발한다
    // (요청) — 누가 호출됐는지는 링크를 열어 편지지에서 확인한다.
    // 카톡 카드 이미지는 nawa2 대신 보낸 사람(호출자) 아바타로(요청). 단 카톡은 이미지를
    // 서버에서 가져가므로 data URL 아바타는 못 쓴다 — http(s) 주소일 때만 쓰고, 아니면
    // (data URL·아바타 없음) 기존 nawa2로 폴백한다.
    const avatar = user?.avatar;
    const imageUrl = avatar && /^https?:\/\//.test(avatar)
      ? avatar
      : `${window.location.origin}/images/items/nawa2.jpg`;
    return {
      title: `${caller ? `${caller}님` : "누군가"}의 호출`,
      description: "누가 호출됐을까요? 👀 탭해서 확인하기",
      imageUrl,
      link: `${window.location.origin}/?sv=challenge&sid=${challenge.id}`,
      fallbackText: `[스타게이트] ${caller ? `${caller}님` : "누군가"}의 호출이 도착했어요! 열어서 확인해보세요.`,
    };
  };

  // 호출 완료 확인창 — 보내고 나면 이 화면으로 바뀌어 카카오톡 공유를 권한다(요청).
  if (sentChallenge) {
    return createPortal(
      <div className="scr-modal-overlay">
        <div className="scr-modal scr-modal-sm scr-challenge-form-modal">
          <div className="scr-modal-head">
            <span>호출 완료</span>
            <button className="scr-icon-btn" onClick={finish} aria-label="닫기"><X size={14} /></button>
          </div>
          <div className="scr-modal-body scr-challenge-sent">
            <div className="scr-challenge-sent-title">
              {sentChallenge.targets.map((t) => t.nickname).join(", ")} 너 나와!
            </div>
            <div className="scr-challenge-sent-desc">호출을 보냈어요.</div>
            <div className="scr-form-actions scr-challenge-sent-actions">
              <KakaoShareButton variant="full" content={() => shareCall(sentChallenge)} />
              <button className="scr-btn scr-btn-primary scr-btn-primary-solid" onClick={finish}>확인</button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm scr-challenge-form-modal">
        <div className="scr-modal-head">
          <span>{modalTitle}</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          {/* 경기 유형(개인전/팀전) 선택은 없앴다(요청: "너 나와 유형 제거하고 자동으로
              판단함") — 상대/내 팀 인원수만으로 서버가 자동으로 정한다. 내 팀/상대
              지목은 <label>이 아니라 <div>다 — <label>로 감싸면 칩/버튼처럼 "제어
              대상이 아닌" 부분을 클릭했을 때 브라우저가 그 라벨의 첫 폼 컨트롤(첫 칩의
              X 버튼)에 자동으로 클릭을 한 번 더 쏴서 방금 지목한 사람이 사라지는 버그가
              있었다(MemberPickBlock 내부도 <div>로 감싼 이유). 내 팀이 위, 상대가
              아래(요청: "도전장 보내기에서 우리팀이 위에"). 본인은 자동 포함이라
              여기엔 "본인 제외 나머지 팀원"만 넣는다. */}
          {!lockTarget && (
            <MemberPickBlock
              label="동료"
              hint="(팀전일 때만 추가)"
              ids={ownTeamIds}
              setIds={setOwnTeamIds}
              max={MAX_OWN_TEAM}
              options={memberOptions}
              memberById={memberById}
              addLabel=""
              addAriaLabel="선수 추가"
              addTone="blue"
            />
          )}

          <MemberPickBlock
            label="상대"
            required
            ids={targetIds}
            setIds={setTargetIds}
            max={MAX_TARGETS}
            options={memberOptions}
            memberById={memberById}
            addLabel=""
            addAriaLabel="상대 추가"
            addTone="red"
            locked={lockTarget}
          />

          <OptionalDateTimeFields
            dateStr={dateStr} onDateChange={setDateStr}
            timeStr={timeStr} onTimeChange={setTimeStr}
          />

          {/* 호출 한마디(선택) — 아이콘 버튼을 누르면 입력창이 높이 트랜지션으로 열린다(요청). */}
          <div className="scr-challenge-msg">
            <button
              type="button"
              className={cx("scr-challenge-msg-toggle", messageOpen && "scr-challenge-msg-toggle-on")}
              onClick={() => setMessageOpen((v) => !v)}
              aria-expanded={messageOpen}
            >
              <MessageSquarePlus size={14} /> 신청 메시지{message.trim() && !messageOpen ? ` · ${message.trim()}` : ""}
            </button>
            <div className={cx("scr-challenge-msg-wrap", messageOpen && "scr-challenge-msg-wrap-open")}>
              <div className="scr-challenge-msg-inner">
                <input
                  className="scr-input"
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, 50))}
                  placeholder="신청 메시지 (선택, 최대 50자)"
                  maxLength={50}
                />
              </div>
            </div>
          </div>

          {err && <div className="scr-err">{err}</div>}

          <div className="scr-form-actions">
            <button className="scr-btn scr-btn-ghost" onClick={onClose}>취소</button>
            {/* 상대(필수)를 지정하면 비활성→핑크로 또렷하게 활성화돼 바로 눈에 띈다(요청).
                비활성 상태는 .scr-btn:disabled의 옅은 처리로 자연히 흐려진다. */}
            <button className="scr-btn scr-challenge-call-btn scr-challenge-submit-btn" onClick={submit} disabled={!canSubmit || busy}>
              {busy ? <><Spinner /> 호출하는 중...</> : <><Send size={14} /> 호출</>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
