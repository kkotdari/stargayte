import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, UserPlus, Send } from "lucide-react";
import Select from "../components/common/Select";
import Avatar from "../components/common/Avatar";
import OptionalDateTimeFields from "../components/common/OptionalDateTimeFields";
import { Spinner } from "../components/common/Feedback";
import { useAppStore } from "../store/appStore";
import { api } from "../api/client";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import type { Challenge, Member } from "../types";

// 상대는 최대 4명까지 지목할 수 있고(팀전), 내 팀은 본인 자동 포함이라 "본인 제외"
// 최대 3명(본인 포함 4명)까지 넣을 수 있다 — 서버의 max_length(target 4 / own 3)와 같다.
// 경기 유형(개인전/팀전)을 따로 고르지 않는다(요청: "너 나와 유형 제거하고 자동으로 판단함") —
// 실제 경기 유형은 서버와 똑같은 규칙으로 인원수만 보고 정해진다(상대1·팀0 → 1:1, 그 외 팀전).
const MAX_TARGETS = 4;
const MAX_OWN_TEAM = 3;

interface ChallengeFormModalProps {
  onClose: () => void;
  onCreated: (challenge: Challenge) => void;
  // 너 나와 신청 "들어주기"로 열 때 — 요청 작성자를 상대로 미리 채워 넣는다.
  presetTargetIds?: string[];
  // 너 나와 신청 "들어주기"로 만드는 도전장이면 true — 서버가 "요청너 나와" 표식을 남긴다.
  fromMatchRequest?: boolean;
  // 랭킹 목록의 종이비행기 버튼처럼 "바로 그 상대"로 연 경우 — 상대를 presetTargetIds
  // 그대로 고정해서 더/빼기가 아예 안 되게 하고(요청: "상대팀에도 딱 그 상대만 고정 x
  // 버튼도 없어야되고 추가버튼도 없어야돼"), 팀전 구성("내 팀") 자체를 이 흐름에서는
  // 안 쓰므로 그 영역도 통째로 뺀다(요청: "우리팀 추가 영역 삭제").
  lockTarget?: boolean;
}

// 상대 지목/내 팀 공용 지목 블록 — 확정된 지목은 이름 칩으로, "+ 추가"는 누르는 순간
// 그 자리가 회원 드롭다운으로 바뀌었다가 고르면 다시 칩으로 접힌다. 빈 드롭다운을
// 여러 개 미리 늘어놓지 않는다(ChallengeFormModal 원래 UI 패턴 그대로).
function MemberPickBlock({
  label, hint, ids, setIds, max, options, memberById, addLabel, addAriaLabel, locked = false, required = false,
}: {
  label: string;
  // 라벨 옆에 옅게 붙는 보조 설명(요청: "우리팀 추가 옆에 팀전일 때만 추가 라고 명시").
  hint?: string;
  // 필수 항목이면 라벨 옆에 *를 붙인다(요청: "필수인곳(상대)에만 * 표시").
  required?: boolean;
  ids: string[];
  setIds: (next: string[]) => void;
  max: number;
  // 이미 어느 쪽에든 선택된 회원은 빠진, 지금 고를 수 있는 후보만 넘어온다 —
  // 자기 자신/중복/양 팀 겹침이 애초에 목록에 안 떠서 즉시 피드백이 된다.
  options: { value: string; label: string; avatar?: React.ReactNode }[];
  memberById: Map<string, Member>;
  // "내 팀" 쪽은 위에 이미 "(팀전일 때만 추가)" 힌트가 있어 아이콘 옆 글자가 중복이라
  // 빈 문자열로 비워 아이콘만 남긴다(요청: "선수추가라는 글자는 없애기") — 그래도
  // 스크린리더용 이름은 필요해 별도로 addAriaLabel을 받는다.
  addLabel: string;
  addAriaLabel: string;
  // 랭킹 목록에서 "바로 그 상대"로 열었을 때 — 이미 채워진 지목을 빼거나(X) 더
  // 추가할 수 없게 완전히 고정한다(요청: "상대팀에도 딱 그 상대만 고정 x 버튼도
  // 없어야되고 추가버튼도 없어야돼").
  locked?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const pick = (id: string) => { setIds([...ids, id]); setPicking(false); };
  const remove = (id: string) => setIds(ids.filter((v) => v !== id));

  const canAdd = !locked && ids.length < max;
  return (
    <div className="scr-field">
      {/* 타이틀 줄에 "선수 추가" 버튼을 인라인으로 얹는다(요청: "선수 추가 버튼을 동료/상대
          타이틀 옆에 인라인 배치해서 열이 늘어나지 않게") — 지목 슬롯이 비어 있어도 추가
          버튼이 별도 행을 차지하지 않아 블록 높이가 안 늘어난다. */}
      <div className="scr-challenge-pick-head">
        <span className="scr-label">
          {label}
          {required && <span className="scr-req-mark" aria-hidden="true">*</span>}
          {hint && <span className="scr-hint">{hint}</span>}
        </span>
        {canAdd && !picking && (
          <button
            type="button" className="scr-challenge-add-target scr-challenge-add-target-inline"
            onClick={() => setPicking(true)} aria-label={addAriaLabel}
          >
            <UserPlus size={15} />{addLabel}
          </button>
        )}
      </div>
      {(ids.length > 0 || picking) && (
        <div className="scr-challenge-target-slots">
          {ids.map((id) => {
            const m = memberById.get(id);
            return (
              <div key={id} className="scr-challenge-target-picked">
                {m && <Avatar member={m} size={20} />}
                <span className="scr-challenge-target-picked-name">{m?.nickname ?? id}</span>
                {!locked && (
                  <button
                    type="button" className="scr-icon-btn scr-challenge-target-remove"
                    onClick={() => remove(id)} aria-label="지목 취소"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            );
          })}
          {picking && (
            <div className="scr-challenge-target-slot">
              {/* "+ 추가"를 누르는 순간 이 Select로 바뀌므로, 한 번 더 누를 필요 없이
                  회원 목록이 바로 펼쳐진 채 시작한다(요청: "+추가 버튼 누르면 자동으로
                  회원 목록 드롭다운 펼치기"). 버튼 기반 드롭다운이라 모바일 키보드는
                  뜨지 않는다. */}
              <Select
                value="" options={options} onChange={pick}
                placeholder="유저 선택"
                className="scr-challenge-target-select"
                defaultOpen
                onOpenChange={(open) => { if (!open) setPicking(false); }}
              />
              <button
                type="button" className="scr-icon-btn scr-challenge-target-remove"
                onClick={() => setPicking(false)} aria-label="추가 취소"
              >
                <X size={13} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// "너 나와!" 도전장 작성 — 상대 지목(최대 4명)/내 팀(선택, 최대 3명)/일시(선택, 날짜만도
// 가능)/한마디. 상대가 응답할 때는 이 시간을 바꿀 수 없고 수락/거절만 가능하다 — 거절되면
// 요청자가 재신청하면서 시간/메모를 고칠 수 있다.
export default function ChallengeFormModal({ onClose, onCreated, presetTargetIds, fromMatchRequest, lockTarget }: ChallengeFormModalProps) {
  useLockBodyScroll();
  const members = useAppStore((s) => s.members);
  const user = useAppStore((s) => s.user);

  // 너 나와 신청 들어주기로 열렸으면 그 작성자를 상대로 미리 채운다.
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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
      // 시간은 안 정했으면 기본 시간(22:00)으로 채운다.
      const scheduledAt = dateStr ? new Date(`${dateStr}T${timeStr || "22:00"}`).toISOString() : null;
      const challenge = await api.createChallenge({
        targetMemberIds: targetIds,
        ownTeamMemberIds: ownTeamIds,
        scheduledAt,
        fromMatchRequest,
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
            locked={lockTarget}
          />

          <OptionalDateTimeFields
            dateStr={dateStr} onDateChange={setDateStr}
            timeStr={timeStr} onTimeChange={setTimeStr}
          />

          {err && <div className="scr-err">{err}</div>}

          <div className="scr-form-actions">
            <button className="scr-btn scr-btn-ghost" onClick={onClose}>취소</button>
            {/* 상대(필수)를 지정하면 비활성→핑크로 또렷하게 활성화돼 바로 눈에 띈다(요청).
                비활성 상태는 .scr-btn:disabled의 옅은 처리로 자연히 흐려진다. */}
            <button className="scr-btn scr-challenge-accept-btn scr-challenge-submit-btn" onClick={submit} disabled={!canSubmit || busy}>
              {busy ? <><Spinner /> 신청하는 중...</> : <><Send size={14} /> 신청</>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
