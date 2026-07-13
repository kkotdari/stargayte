import { Plus, X } from "lucide-react";

interface ReplayAliasesFieldProps {
  rows: string[];
  onChange: (rows: string[]) => void;
  // 가입 화면처럼 최소 1개가 필수인 맥락에서만 라벨에 "*"를 붙인다(회원상세/내 정보수정은
  // 이미 등록된 회원이라 선택 사항).
  required?: boolean;
}

const MAX_ALIASES = 3;

// 게임아이디(리플레이 매칭용) 입력값을 실제로 저장하기 전에 다듬는다(공백 제거,
// 중복/빈 항목 제외) — 부모가 다른 필드들과 한 "저장" 버튼으로 함께 저장할 때 이 함수로
// 정리한 값을 비교/전송에 쓴다.
export function cleanReplayAliases(rows: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  rows.forEach((raw) => {
    const v = raw.trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  return out;
}

// 게임아이디(리플레이 매칭용) 최대 3개 편집 — 입력칸 + 버튼으로 추가/삭제만 하는 순수
// 컨트롤드 컴포넌트다. 이 필드만 따로 저장하지 않고, 부모(회원상세/내 정보수정)의 다른
// 필드들과 함께 부모의 "저장" 버튼 한 번으로 같이 저장한다.
export default function ReplayAliasesField({ rows, onChange, required = false }: ReplayAliasesFieldProps) {
  const setRow = (i: number, v: string) => onChange(rows.map((r, idx) => (idx === i ? v : r)));
  const addRow = () => { if (rows.length < MAX_ALIASES) onChange([...rows, ""]); };
  const removeRow = (i: number) => onChange(rows.length <= 1 ? [""] : rows.filter((_, idx) => idx !== i));

  return (
    <div className="scr-field">
      <div className="scr-replay-alias-head">
        <span className="scr-label">게임아이디{required ? " *" : ""} (리플레이 매칭용, 최대 3개)</span>
        <button
          type="button"
          className="scr-icon-btn scr-replay-alias-add-btn"
          onClick={addRow}
          disabled={rows.length >= MAX_ALIASES}
          aria-label="게임아이디 추가"
        >
          <Plus size={13} />
        </button>
      </div>
      <div className="scr-replay-alias-rows">
        {rows.map((row, i) => (
          <div key={i} className="scr-replay-alias-row">
            <input
              className="scr-input scr-input-sm"
              value={row}
              onChange={(e) => setRow(i, e.target.value)}
              placeholder={`게임아이디 ${i + 1}`}
            />
            <button
              type="button"
              className="scr-chip-x scr-replay-alias-clear"
              onClick={() => removeRow(i)}
              aria-label="이 게임아이디 삭제"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
