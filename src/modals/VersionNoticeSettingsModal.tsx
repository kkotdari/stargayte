import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Spinner } from "../components/common/Feedback";
import AppUpdateNoticeModal from "./AppUpdateNoticeModal";
import { useAppStore, parseNoticeLines } from "../store/appStore";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { versionNumber } from "../utils/appVersion";
import { cx } from "../utils/format";

interface VersionNoticeSettingsModalProps {
  onClose: () => void;
}

// 관리자 패널의 "버전 안내 설정" — 제어판보다 작은 모달로, (1) 버전 안내를 띄울지 말지
// 전역 토글, (2) 버전을 골라 그 버전의 안내 내용(한 줄에 한 항목)을 편집하는 두 부분으로
// 이뤄진다. 내용은 서버(app_versions.notes)에 저장되고, 표시 여부 토글은 즉시 서버에
// 반영한다. 편집 중인 내용이 실제로 어떻게 보일지는 "미리보기"로 확인할 수 있다.
export default function VersionNoticeSettingsModal({ onClose }: VersionNoticeSettingsModalProps) {
  useLockBodyScroll();
  const appVersion = useAppStore((s) => s.appVersion);
  const appVersions = useAppStore((s) => s.appVersions);
  const noticeEnabled = useAppStore((s) => s.noticeEnabled);
  const setNoticeEnabled = useAppStore((s) => s.setNoticeEnabled);
  const saveVersionNotes = useAppStore((s) => s.saveVersionNotes);

  // 처음엔 현재 활성 버전을 골라둔다(관리자가 방금 배포한 버전의 안내를 가장 먼저 손보게 된다).
  const [selected, setSelected] = useState(() => {
    const active = appVersions.find((v) => versionNumber(v.number) === versionNumber(appVersion));
    return active?.number ?? appVersions[0]?.number ?? "";
  });
  const selectedEntry = useMemo(
    () => appVersions.find((v) => v.number === selected),
    [appVersions, selected],
  );
  const storedNotes = selectedEntry?.notes ?? "";

  const [draft, setDraft] = useState(storedNotes);
  const [savingNotes, setSavingNotes] = useState(false);
  const [togglingNotice, setTogglingNotice] = useState(false);
  const [err, setErr] = useState("");
  const [previewing, setPreviewing] = useState(false);

  // 고른 버전이 바뀌면(또는 그 버전의 저장된 내용이 갱신되면) 편집칸을 그 값으로 되돌린다.
  useEffect(() => { setDraft(storedNotes); }, [storedNotes]);

  const dirty = draft !== storedNotes;

  const toggleNotice = async () => {
    setTogglingNotice(true);
    setErr("");
    try {
      await setNoticeEnabled(!noticeEnabled);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "설정을 바꾸지 못했어요.");
    } finally {
      setTogglingNotice(false);
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
          <span>버전 안내 설정</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          {/* (1) 전역 표시 토글 — 켜져 있어야만 버전이 바뀐 뒤 안내 모달이 뜬다. */}
          <div className="scr-notice-toggle-row">
            <div className="scr-notice-toggle-label">
              <span className="scr-notice-toggle-title">버전 안내 표시</span>
              <span className="scr-notice-toggle-desc">
                {noticeEnabled ? "새 버전 접속 시 안내를 띄웁니다." : "안내를 띄우지 않습니다."}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={noticeEnabled}
              className={cx("scr-notice-switch", noticeEnabled && "scr-notice-switch-on")}
              onClick={() => void toggleNotice()}
              disabled={togglingNotice}
            >
              <span className="scr-notice-switch-knob" />
            </button>
          </div>

          <div className="scr-notice-settings-divider" />

          {/* (2) 버전 선택부 + 내용 편집부 — 버전을 고르면 그 버전의 안내 내용을 편집한다. */}
          <div className="scr-notice-edit-label">버전별 안내 내용</div>
          <div className="scr-notice-version-tabs">
            {appVersions.map((v) => (
              <button
                key={v.number}
                type="button"
                className={cx("scr-notice-version-tab", v.number === selected && "scr-notice-version-tab-active")}
                onClick={() => setSelected(v.number)}
              >
                {v.number}
              </button>
            ))}
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

      {previewing && (
        <AppUpdateNoticeModal notes={parseNoticeLines(draft)} onClose={() => setPreviewing(false)} />
      )}
    </div>,
    document.body,
  );
}
