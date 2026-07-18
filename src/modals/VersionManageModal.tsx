import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Trash2 } from "lucide-react";
import { Spinner } from "../components/common/Feedback";
import Select from "../components/common/Select";
import ConfirmDialog from "../components/common/ConfirmDialog";
import AppUpdateNoticeModal from "./AppUpdateNoticeModal";
import { useAppStore, parseNoticeLines } from "../store/appStore";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { versionNumber } from "../utils/appVersion";

interface VersionManageModalProps {
  onClose: () => void;
}

// 숫자 버전 형식(정수 또는 소수 한 단계, 예: "4" "3.1") — 서버 AppVersion 패턴과 같다. 여기서
// 먼저 걸러 헛된 요청을 막고, 서버가 중복·형식을 한 번 더 검증한다.
const VERSION_PATTERN = /^[1-9][0-9]*(\.[0-9]+)?$/;

// 제어판의 "버전 관리" — 제어판보다 작은 모달로, (1) 새 버전 등록/삭제, (2) 버전을 골라 그
// 버전의 안내 내용(한 줄에 한 항목)을 편집하는 두 부분으로 이뤄진다. 버전 안내 표시 여부
// (전역 토글)는 이제 이 모달이 아니라 제어판 본체에 있다(요청). 현재 활성 버전은 삭제할 수
// 없고(서버·버튼 모두 막음), 편집 중인 안내가 어떻게 보일지는 "미리보기"로 확인한다.
export default function VersionManageModal({ onClose }: VersionManageModalProps) {
  useLockBodyScroll();
  const appVersion = useAppStore((s) => s.appVersion);
  const appVersions = useAppStore((s) => s.appVersions);
  const addVersion = useAppStore((s) => s.addVersion);
  const deleteVersion = useAppStore((s) => s.deleteVersion);
  const saveVersionNotes = useAppStore((s) => s.saveVersionNotes);

  const activeNumber = versionNumber(appVersion);

  // 처음엔 현재 활성 버전을 골라둔다(관리자가 방금 배포한 버전의 안내를 가장 먼저 손보게 된다).
  const [selected, setSelected] = useState(() => {
    const active = appVersions.find((v) => versionNumber(v.number) === activeNumber);
    return active?.number ?? appVersions[0]?.number ?? "";
  });
  const selectedEntry = useMemo(
    () => appVersions.find((v) => v.number === selected),
    [appVersions, selected],
  );
  const storedNotes = selectedEntry?.notes ?? "";

  const [draft, setDraft] = useState(storedNotes);
  const [savingNotes, setSavingNotes] = useState(false);
  const [err, setErr] = useState("");
  const [previewing, setPreviewing] = useState(false);

  // 새 버전 추가 입력.
  const [newNumber, setNewNumber] = useState("");
  const [adding, setAdding] = useState(false);
  // 삭제 확인 — 삭제할 버전 번호(null이면 확인창 닫힘).
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 고른 버전이 바뀌면(또는 그 버전의 저장된 내용이 갱신되면) 편집칸을 그 값으로 되돌린다.
  useEffect(() => { setDraft(storedNotes); }, [storedNotes]);
  // 선택한 버전이 목록에서 사라지면(방금 삭제) 활성 버전(없으면 첫 버전)으로 되돌린다.
  useEffect(() => {
    if (selected && !appVersions.some((v) => v.number === selected)) {
      const active = appVersions.find((v) => versionNumber(v.number) === activeNumber);
      setSelected(active?.number ?? appVersions[0]?.number ?? "");
    }
  }, [appVersions, selected, activeNumber]);

  const dirty = draft !== storedNotes;
  const selectedIsActive = versionNumber(selected) === activeNumber;
  const canDelete = !!selected && !selectedIsActive && appVersions.length > 1;

  // 추가 가능 여부 — 형식이 맞고, 이미 등록된 번호가 아닐 때만.
  const trimmedNew = newNumber.trim();
  const newIsValid = VERSION_PATTERN.test(trimmedNew);
  const newIsDuplicate = newIsValid
    && appVersions.some((v) => versionNumber(v.number) === Number(trimmedNew));
  const canAdd = newIsValid && !newIsDuplicate;

  const add = async () => {
    if (!canAdd) return;
    setAdding(true);
    setErr("");
    try {
      await addVersion(trimmedNew);
      setSelected(trimmedNew); // 방금 추가한 버전을 골라 바로 안내를 편집하게 한다.
      setNewNumber("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "버전을 추가하지 못했어요.");
    } finally {
      setAdding(false);
    }
  };

  const doDelete = async (number: string) => {
    setDeleting(true);
    setErr("");
    try {
      await deleteVersion(number);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "버전을 삭제하지 못했어요.");
    } finally {
      setDeleting(false);
    }
  };

  const saveNotes = async () => {
    if (!selected) return;
    setSavingNotes(true);
    setErr("");
    try {
      await saveVersionNotes(selected, draft);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장하지 못했어요.");
    } finally {
      setSavingNotes(false);
    }
  };

  return createPortal(
    // 바깥을 눌러도 안 닫히게 한다(제어판과 같은 원칙) — 닫기는 헤더의 X 버튼으로만.
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm scr-notice-settings-modal">
        <div className="scr-modal-head">
          <span>버전 관리</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          {/* (1) 새 버전 등록 — 자유 숫자 입력(형식/중복은 서버가 한 번 더 검증). */}
          <div className="scr-notice-edit-label">새 버전 등록</div>
          <div className="scr-version-add-row">
            <input
              className="scr-input scr-version-add-input"
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
              placeholder="예: 4 또는 3.1"
              inputMode="decimal"
            />
            <button
              type="button"
              className="scr-btn scr-btn-primary scr-version-add-btn"
              onClick={() => void add()}
              disabled={!canAdd || adding}
            >
              {adding ? <Spinner /> : "추가"}
            </button>
          </div>
          {trimmedNew !== "" && !newIsValid && (
            <div className="scr-version-add-hint">숫자(정수 또는 소수 한 자리)로 입력해주세요.</div>
          )}
          {newIsDuplicate && (
            <div className="scr-version-add-hint">이미 등록된 버전이에요.</div>
          )}

          <div className="scr-notice-settings-divider" />

          {/* (2) 버전 선택부(+삭제) + 안내 내용 편집부. */}
          <div className="scr-notice-edit-label">버전별 안내 내용</div>
          <div className="scr-version-pick-row">
            <Select
              value={selected}
              options={[...appVersions].reverse().map((v) => ({ value: v.number, label: `${v.number} 버전` }))}
              onChange={setSelected}
              className="scr-notice-version-select"
            />
            {/* 현재 활성 버전은 지울 수 없다 — 지우면 아무도 없는 버전을 가리키게 된다(서버도 막음). */}
            <button
              type="button"
              className="scr-version-delete-btn"
              onClick={() => setConfirmDelete(selected)}
              disabled={!canDelete || deleting}
              aria-label="이 버전 삭제"
              title={selectedIsActive ? "현재 활성 버전은 삭제할 수 없어요." : "이 버전 삭제"}
            >
              {deleting ? <Spinner size={14} /> : <Trash2 size={16} />}
            </button>
          </div>

          <textarea
            className="scr-input scr-notice-edit-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="한 줄에 한 항목씩 적어주세요. 비워두면 이 버전은 안내를 띄우지 않아요."
            rows={5}
          />

          {err && <div className="scr-err">{err}</div>}

          <div className="scr-notice-edit-actions">
            <button
              type="button"
              className="scr-btn scr-btn-ghost"
              onClick={() => setPreviewing(true)}
              disabled={parseNoticeLines(draft).length === 0}
            >
              미리보기
            </button>
            <button
              type="button"
              className="scr-btn scr-btn-primary"
              onClick={() => void saveNotes()}
              disabled={savingNotes || !dirty}
            >
              {savingNotes ? <Spinner /> : "저장"}
            </button>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`${confirmDelete} 버전을 삭제할까요?`}
          message="등록 목록에서 사라지고, 이 버전의 안내 내용도 함께 지워집니다."
          confirmLabel="삭제"
          onConfirm={() => {
            const next = confirmDelete;
            setConfirmDelete(null);
            void doDelete(next);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {previewing && (
        <AppUpdateNoticeModal notes={parseNoticeLines(draft)} onClose={() => setPreviewing(false)} />
      )}
    </div>,
    document.body,
  );
}
