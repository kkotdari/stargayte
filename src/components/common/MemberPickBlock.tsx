import { useState } from "react";
import { X, UserPlus } from "lucide-react";
import Select from "./Select";
import Avatar from "./Avatar";
import type { Member } from "../../types";

// 상대 지목/내 팀 공용 지목 블록 — 확정된 지목은 이름 칩으로, "+ 추가"는 누르는 순간
// 그 자리가 회원 드롭다운으로 바뀌었다가 고르면 다시 칩으로 접힌다. 빈 드롭다운을
// 여러 개 미리 늘어놓지 않는다(ChallengeFormModal 원래 UI 패턴 그대로 — 리그 팀
// 로스터 편집에도 같은 "다른 팀에 이미 있으면 후보에서 제외" 패턴으로 재사용한다).
export default function MemberPickBlock({
  label, hint, ids, setIds, max, options, memberById, addLabel, addAriaLabel, locked = false, required = false, addTone,
}: {
  label: string;
  // 추가 버튼 색 — 동료="blue", 상대="red"(요청: 유치하게 알록달록).
  addTone?: "blue" | "red";
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
            type="button"
            className={`scr-challenge-add-target scr-challenge-add-target-inline${addTone ? ` scr-challenge-add-target-${addTone}` : ""}`}
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
