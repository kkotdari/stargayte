import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Select from "../components/common/Select";
import Avatar from "../components/common/Avatar";
import { Spinner } from "../components/common/Feedback";
import { useAppStore } from "../store/appStore";
import { api } from "../api/client";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import type { Challenge, Member } from "../types";

// 상대는 최대 4명까지 지목할 수 있고(팀전), 내 팀은 본인 자동 포함이라 "본인 제외"
// 최대 3명(본인 포함 4명)까지 넣을 수 있다 — 서버의 max_length(target 4 / own 3)와 같다.
// 폼 맨 위 라디오로 개인전/팀전을 먼저 고르고, 개인전이면 상대 1명·팀 없음으로 제한한다.
// 실제 경기 유형은 서버가 인원수로 정한다(상대1·팀0 → 1:1, 그 외 팀전).
const MAX_TARGETS = 4;
const MAX_OWN_TEAM = 3;

interface ChallengeFormModalProps {
  onClose: () => void;
  onCreated: (challenge: Challenge) => void;
  // 대결 요청 "들어주기"로 열 때 — 요청 작성자를 상대로 미리 채워 넣는다.
  presetTargetIds?: string[];
}

// 상대 지목/내 팀 공용 지목 블록 — 확정된 지목은 이름 칩으로, "+ 추가"는 누르는 순간
// 그 자리가 회원 드롭다운으로 바뀌었다가 고르면 다시 칩으로 접힌다. 빈 드롭다운을
// 여러 개 미리 늘어놓지 않는다(ChallengeFormModal 원래 UI 패턴 그대로).
function MemberPickBlock({
  label, ids, setIds, max, options, memberById, addLabel,
}: {
  label: string;
  ids: string[];
  setIds: (next: string[]) => void;
  max: number;
  // 이미 어느 쪽에든 선택된 회원은 빠진, 지금 고를 수 있는 후보만 넘어온다 —
  // 자기 자신/중복/양 팀 겹침이 애초에 목록에 안 떠서 즉시 피드백이 된다.
  options: { value: string; label: string }[];
  memberById: Map<string, Member>;
  addLabel: string;
}) {
  const [picking, setPicking] = useState(false);
  const pick = (id: string) => { setIds([...ids, id]); setPicking(false); };
  const remove = (id: string) => setIds(ids.filter((v) => v !== id));

  return (
    <div className="scr-field">
      <span className="scr-label">{label}</span>
      <div className="scr-challenge-target-slots">
        {ids.map((id) => {
          const m = memberById.get(id);
          return (
            <div key={id} className="scr-challenge-target-picked">
              {m && <Avatar member={m} size={20} />}
              <span>{m?.nickname ?? id}</span>
              <button
                type="button" className="scr-icon-btn scr-challenge-target-remove"
                onClick={() => remove(id)} aria-label="지목 취소"
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
        {ids.length < max && (
          picking ? (
            <div className="scr-challenge-target-slot">
              {/* "+ 추가"를 누르는 순간 이 Select로 바뀌므로, 한 번 더 누를 필요 없이
                  회원 목록이 바로 펼쳐진 채 시작한다(요청: "+추가 버튼 누르면 자동으로
                  회원 목록 드롭다운 펼치기"). 버튼 기반 드롭다운이라 모바일 키보드는
                  뜨지 않는다. */}
              <Select
                value="" options={options} onChange={pick}
                placeholder="회원 선택"
                className="scr-challenge-target-select"
                defaultOpen
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
              {addLabel}
            </button>
          )
        )}
      </div>
    </div>
  );
}

// "너 나와!" 도전장 작성 — 상대 지목(최대 4명)/내 팀(선택, 최대 3명)/일시(선택, 날짜만도
// 가능)/한마디. 상대가 응답할 때는 이 시간을 바꿀 수 없고 수락/거절만 가능하다 — 거절되면
// 요청자가 재신청하면서 시간/메모를 고칠 수 있다.
export default function ChallengeFormModal({ onClose, onCreated, presetTargetIds }: ChallengeFormModalProps) {
  useLockBodyScroll();
  const members = useAppStore((s) => s.members);
  const user = useAppStore((s) => s.user);

  // 시작할 때 개인전(1:1)인지 팀전인지 먼저 고른다(요청: "팀전인지 개인전인지 체크하고
  // 시작 — 라디오 버튼"). 개인전이면 상대는 1명, 내 팀 구성은 없다. 팀전이면 내 팀을
  // 짜고 상대도 여럿 지목할 수 있다. 실제 match_type은 서버가 인원수로 정하지만(개인전=
  // 상대1·팀원0 → 0101), 폼이 인원 제약을 이 선택에 맞춰 그 결과가 선택과 일치하게 한다.
  // 대결 요청 들어주기로 열렸으면 그 작성자를 상대로 미리 채운다(보통 1명 → 1:1).
  const preset = presetTargetIds ?? [];
  const [mode, setMode] = useState<"solo" | "team">(preset.length > 1 ? "team" : "solo");
  const [targetIds, setTargetIds] = useState<string[]>(preset);
  const [ownTeamIds, setOwnTeamIds] = useState<string[]>([]);

  // 개인전으로 바꾸면 상대는 1명으로 줄이고 내 팀은 비운다(그래야 서버가 0101로 정한다).
  const switchMode = (next: "solo" | "team") => {
    setMode(next);
    if (next === "solo") {
      setTargetIds((ids) => ids.slice(0, 1));
      setOwnTeamIds([]);
    }
  };
  // 일시를 아예 자유 입력으로 두던 걸 체크박스로 명시화한다 — 체크하면 그때부턴 "정한다"는
  // 뜻이라 날짜/시간 둘 다 채워야만 보낼 수 있고, 체크를 안 하면(기본값) "시간은 상대방이
  // 정해도 된다"는 뜻이라 날짜/시간 입력 자체를 막는 대신 최소한 무슨 대화인지는 알 수
  // 있게 한마디를 필수로 받는다.
  const [timeSpecified, setTimeSpecified] = useState(false);
  const [dateStr, setDateStr] = useState("");
  // 기본 시간은 오후 10시(22:00) — 밤 경기가 많아 기본값으로 세팅해둔다(요청: "도전장
  // 보낼때 기본 시간 오후 10시").
  const [timeStr, setTimeStr] = useState("22:00");
  const [message, setMessage] = useState("");
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
      .map((m) => ({ value: m.id, label: `${m.nickname} (${m.battletag})` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [activeMembers, chosen],
  );

  // 개인전은 상대 정확히 1명. 팀전은 상대 1명 이상이되, 실제로 팀 구성이 되도록(서버가
  // 0102로 정하도록) 내 팀원이 있거나 상대가 2명 이상이어야 한다.
  const rosterOk = mode === "solo"
    ? targetIds.length === 1
    : targetIds.length >= 1 && (ownTeamIds.length >= 1 || targetIds.length >= 2);
  const canSubmit = rosterOk
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
        targetMemberIds: targetIds,
        ownTeamMemberIds: ownTeamIds,
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
          {/* 맨 위에서 개인전/팀전을 먼저 고른다(요청: "팀전인지 개인전인지 체크하고
              시작 — 라디오 버튼", "맨위에서 체크"). 선택에 따라 아래 폼 구성이 바뀐다. */}
          <div className="scr-field">
            <span className="scr-label">경기 유형</span>
            <div className="scr-challenge-mode-radios">
              <label className="scr-checkbox-field">
                <input
                  type="radio" name="challenge-mode" checked={mode === "solo"}
                  onChange={() => switchMode("solo")}
                />
                개인전 (1:1)
              </label>
              <label className="scr-checkbox-field">
                <input
                  type="radio" name="challenge-mode" checked={mode === "team"}
                  onChange={() => switchMode("team")}
                />
                팀전
              </label>
            </div>
          </div>

          {/* 내 팀/상대 지목은 <label>이 아니라 <div>다 — <label>로 감싸면 칩/버튼처럼
              "제어 대상이 아닌" 부분을 클릭했을 때 브라우저가 그 라벨의 첫 폼 컨트롤(첫
              칩의 X 버튼)에 자동으로 클릭을 한 번 더 쏴서 방금 지목한 사람이 사라지는
              버그가 있었다(MemberPickBlock 내부도 <div>로 감싼 이유). */}
          {/* 내 팀 구성은 팀전에서만 — 개인전은 나 혼자다. 내 팀이 위, 상대가 아래(요청:
              "도전장 보내기에서 우리팀이 위에"). 본인은 자동 포함이라 여기엔 "본인 제외
              나머지 팀원"만 넣는다. */}
          {mode === "team" && (
            <MemberPickBlock
              label="내 팀 (선택)"
              ids={ownTeamIds}
              setIds={setOwnTeamIds}
              max={MAX_OWN_TEAM}
              options={memberOptions}
              memberById={memberById}
              addLabel="+ 팀원 추가"
            />
          )}

          <MemberPickBlock
            label={mode === "solo" ? "상대" : "상대 지목"}
            ids={targetIds}
            setIds={setTargetIds}
            max={mode === "solo" ? 1 : MAX_TARGETS}
            options={memberOptions}
            memberById={memberById}
            addLabel={mode === "solo" ? "+ 상대 선택" : "+ 상대 추가"}
          />

          <label className="scr-checkbox-field">
            <input
              type="checkbox" checked={timeSpecified}
              onChange={(e) => setTimeSpecified(e.target.checked)}
            />
            시간 지정 <span className="scr-hint">(미선택시 상대방이 시간 지정함)</span>
          </label>

          {/* 체크를 껐다 켜도 입력값은 그대로 남아있는다 — disabled로 흐리게 두는 대신 아예
              숨긴다(state는 그대로 dateStr/timeStr에 남아있어 다시 켜면 그 값 그대로 보인다). */}
          {timeSpecified && (
            <label className="scr-field">
              <span className="scr-label">일시</span>
              <div className="scr-challenge-datetime">
                <input
                  type="date" className="scr-input" value={dateStr}
                  onChange={(e) => { setDateStr(e.target.value); if (!e.target.value) setTimeStr("22:00"); }}
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
