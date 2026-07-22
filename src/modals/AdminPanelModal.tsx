import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Spinner } from "../components/common/Feedback";
import Select from "../components/common/Select";
import ConfirmDialog from "../components/common/ConfirmDialog";
import ReplayBatchButton from "../components/common/ReplayBatchButton";
import VersionManageModal from "./VersionManageModal";
import { api } from "../api/client";
import { useAppStore } from "../store/appStore";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { cx } from "../utils/format";
import { versionNumber } from "../utils/appVersion";
import { playCreak } from "../utils/sfx";

interface AdminPanelModalProps {
  isAdmin: boolean;
  onClose: () => void;
}

// 실수로 눌러도 바로 전환되지 않도록 거는 최소한의 잠금 — 어떤 문구도 없이 숫자
// 비밀번호만 입력받는다(퀴즈 문구를 없애면서 뭘 묻는지 힌트조차 안 준다). 정답 자체는
// 코드에 두지 않고 서버(env_vars.admin_panel_password)에 물어봐서 맞는지만 확인한다 —
// 코드 배포 없이 DB에서 바로 비밀번호를 바꿀 수 있다.

// 메인 로고를 3번 연달아 눌러야만 뜨는 숨겨진 제어판 — 트리거(로고 탭)도, 통과(비밀번호)도
// 회원 누구나 할 수 있다. 다만 실제로 앱 버전을 바꾸는 등의 관리 기능은 운영자만 쓸 수 있다
// (예전엔 회원용 "미리보기"가 있었지만 제거됐다).
export default function AdminPanelModal({ isAdmin, onClose }: AdminPanelModalProps) {
  useLockBodyScroll();
  // 숨겨진 제어판이 열리는 순간 낡은 경첩이 삐걱이는 "끼익" 소리(요청) — 로고 3연타라는
  // 사용자 제스처 직후라 자동재생 정책에 막히지 않는다. 마운트 때 한 번만.
  useEffect(() => { playCreak(); }, []);
  const appVersion = useAppStore((s) => s.appVersion);
  const appVersions = useAppStore((s) => s.appVersions);
  const setAppVersion = useAppStore((s) => s.setAppVersion);
  const noticeEnabled = useAppStore((s) => s.noticeEnabled);
  const setNoticeEnabled = useAppStore((s) => s.setNoticeEnabled);
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  // PC에서만 열자마자 비밀번호 칸에 포커스를 준다(요청) — 마우스(fine pointer)가 있는
  // 기기에서만. 모바일/터치에선 모달이 뜨자마자 키보드가 튀어나오는 걸 막으려 포커스를
  // 주지 않는다(이 코드베이스 전반의 원칙).
  const passwordRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      passwordRef.current?.focus();
    }
  }, []);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // "버전 관리" 모달 — 버전 추가/삭제와 버전별 안내 내용 편집을 담는다.
  const [versionManageOpen, setVersionManageOpen] = useState(false);
  const [togglingNotice, setTogglingNotice] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // 등록된 리플레이(.rep) 전체를 날짜별 폴더 zip으로 받는다 — 인증 헤더가 필요해 blob으로
  // 받아 클라이언트에서 임시 링크로 저장 트리거한다.
  const downloadReplays = async () => {
    setDownloading(true);
    setErr("");
    try {
      const blob = await api.downloadReplayArchive();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "replays.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "리플레이를 다운로드하지 못했어요.");
    } finally {
      setDownloading(false);
    }
  };

  // 모든 경기기록 삭제 — 되돌릴 수 없는 파괴적 작업이라, "삭제"를 직접 입력해야 실행된다.
  const deleteAllMatches = async () => {
    const typed = window.prompt(
      '모든 경기기록을 삭제합니다. 첨부 리플레이까지 지워지고 되돌릴 수 없어요.\n삭제하려면 "삭제"를 입력하세요.',
    );
    if (typed !== "삭제") return;
    setBusy(true);
    setErr("");
    try {
      const { deleted } = await api.deleteAllMatches();
      window.alert(`${deleted}건의 경기기록을 삭제했어요.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "삭제하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const currentNumber = versionNumber(appVersion);

  const unlock = async () => {
    setChecking(true);
    setErr("");
    try {
      const ok = await api.verifyAdminPanelPassword(password);
      if (ok) setUnlocked(true);
      else setErr("비밀번호가 올바르지 않아요.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "확인에 실패했어요.");
    } finally {
      setChecking(false);
    }
  };

  // "현재 버전 설정" — 등록된 버전 중 하나로 활성 버전을 바꾼다(예전 배포/롤백을 하나로 합침).
  // 바꾸면 모두에게 즉시 반영되고, 회원들은 다음 접속 때 버전 안내 팝업을 다시 보게 된다.
  const [versionPickerOpen, setVersionPickerOpen] = useState(false);
  const [confirmSetVersion, setConfirmSetVersion] = useState<string | null>(null);
  const [pickValue, setPickValue] = useState("");

  // 현재 버전을 뺀 '고를 수 있는' 버전들 — 현재 버전으로 다시 설정하는 건 의미가 없어 제외한다.
  // 드롭다운은 최신 버전이 위로 오도록 역순(내림차순)으로 노출한다. appVersions는 오름차순이라,
  // filter가 만든 새 배열을 그대로 뒤집는다(원본은 건드리지 않음).
  const pickableVersions = appVersions
    .filter((v) => versionNumber(v.number) !== currentNumber)
    .reverse();

  const openVersionPicker = () => {
    setPickValue(pickableVersions[0]?.number ?? "");
    setVersionPickerOpen(true);
  };

  const setVersion = async (number: string) => {
    setBusy(true);
    setErr("");
    try {
      await setAppVersion(number);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "버전 설정에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

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

  return createPortal(
    // 바깥(딤 처리된 배경)을 눌러도 안 닫히게 한다 — 숨겨진 화면이라 실수로 바깥을
    // 눌러 닫히면 다시 로고를 여러 번 눌러 찾아 들어와야 해서 번거롭다. 닫기는 모달
    // 헤더의 공통 X 버튼 하나로만(취소/닫기 같은 별도 버튼을 body에 두지 않는다).
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm scr-admin-panel-modal">
        <div className="scr-modal-head">
          <span>숨겨진 제어판</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          {!unlocked ? (
            <>
              {/* 입력창 위 큰 자물쇠 — 무엇을 묻는지 문구 없이도 '잠금 해제' 맥락을 준다(요청). */}
              <div className="scr-admin-panel-lock" aria-hidden>🔒</div>
              <label className="scr-field">
                {/* 무엇을 묻는지조차 힌트를 주지 않는다 — 라벨/문구 없이 숫자 비밀번호
                    입력칸 하나만 보여준다. 숫자 전용이라 모바일에서도 숫자 키패드가
                    뜨도록 inputMode를 지정하고, type="password"로 입력값을 가린다.
                    autoFocus는 안 준다 — 모바일에서 모달이 뜨자마자 키보드가 튀어나오는
                    걸 막는다(이 코드베이스 전반의 원칙). */}
                <input
                  ref={passwordRef}
                  type="password"
                  inputMode="numeric"
                  className="scr-input scr-admin-panel-password-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void unlock(); }}
                  disabled={checking}
                />
              </label>
              {err && <div className="scr-err">{err}</div>}
              {/* 닫기는 모달 헤더의 공통 X 버튼 하나로 충분하다 — 취소/확인 두 버튼 대신
                  큼직한 입력 버튼 하나만 둔다. */}
              <button
                type="button" className="scr-btn scr-btn-primary scr-admin-panel-quiz-submit-btn"
                onClick={() => void unlock()} disabled={checking}
              >
                {checking ? <Spinner /> : "입력"}
              </button>
            </>
          ) : (
            <>
              {/* 버전관리 — 소제목(현재 버전 표시 포함) + 버튼들. 관리 기능은 전부 운영자
                  전용이라 회원에겐 버튼을 노출하지 않는다(현재 버전 표시만 본다). */}
              <div className="scr-admin-panel-section-title">
                버전관리 <span className="scr-admin-panel-section-title-dim">(현재버전 : {currentNumber})</span>
              </div>
              {isAdmin ? (
                <>
                  <div className="scr-admin-panel-grid">
                    {/* 현재 버전 설정 — 등록된 버전 중에서 골라 활성 버전을 바꾼다(모두에게
                        즉시 반영·안내 팝업 재노출이라 -danger 톤 + 확인창). */}
                    <button
                      type="button" className="scr-admin-panel-phys-btn scr-admin-panel-phys-btn-danger"
                      onClick={openVersionPicker} disabled={busy}
                    >
                      {busy ? <Spinner /> : "현재 버전 설정"}
                    </button>
                    {/* 버전 관리 — 버전 추가/삭제 + 버전별 안내 내용 편집 모달. */}
                    <button
                      type="button" className="scr-admin-panel-phys-btn"
                      onClick={() => setVersionManageOpen(true)}
                    >
                      버전 관리
                    </button>
                  </div>

                  {/* 버전 안내 표시 토글 — 예전엔 "버전 안내 설정" 모달 안에 있었지만 제어판
                      본체로 옮겼다(요청). 켜져 있어야만 버전이 바뀐 뒤 안내 팝업이 뜬다. */}
                  <div className="scr-notice-toggle-row scr-admin-panel-notice-toggle">
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
                </>
              ) : (
                <div className="scr-admin-panel-member-note">관리 기능은 운영자만 사용할 수 있어요.</div>
              )}

              {isAdmin && (
                <>
                  {err && <div className="scr-err">{err}</div>}
                  {/* 경기관리 — 되돌릴 수 없거나 모두에게 즉시 반영되는 기능만 빨간 톤
                      (-danger). 단순 조회(다운로드)를 뺀 나머지는 전부 실행 전 확인창을
                      거친다(요청: "관리자 버튼들은 다 컨펌창 있어야돼(단순 조회는
                      제외)"). */}
                  <div className="scr-admin-panel-section-title">경기관리</div>
                  <div className="scr-admin-panel-grid">
                    {/* 모든 경기기록 삭제 — 되돌릴 수 없는 파괴적 작업이라 빨간 버튼으로.
                        (window.prompt로 "삭제" 직접 입력하는 확인창이 이미 있다.) */}
                    <button
                      type="button" className="scr-admin-panel-phys-btn scr-admin-panel-phys-btn-danger"
                      onClick={deleteAllMatches} disabled={busy}
                    >
                      {busy ? <Spinner /> : "배치삭제"}
                    </button>
                    {/* 등록된 리플레이 전체를 zip으로 백업 다운로드(운영자) — 읽기 전용이라
                        확인창 없이 바로 받는다. */}
                    <button
                      type="button" className="scr-admin-panel-phys-btn"
                      onClick={downloadReplays} disabled={downloading}
                    >
                      {downloading ? <Spinner /> : "배치다운로드"}
                    </button>
                    {/* 리플레이 폴더 일괄 등록 — 버튼을 누르면 바로 폴더 선택창이 뜬다. 바로 옆
                        칸에 "결과 보기"를 예약해두려고 마지막에 둔다(그 칸이 항상 비어 있어야
                        결과 보기가 나타나도 레이아웃이 안 흔들린다). */}
                    <ReplayBatchButton />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {confirmSetVersion && (
        <ConfirmDialog
          title={`현재 버전을 ${confirmSetVersion}(으)로 바꿀까요?`}
          message="모든 사용자에게 즉시 반영되고, 회원들은 다음 접속 시 버전 안내를 다시 보게 됩니다."
          confirmLabel="설정"
          onConfirm={() => {
            const next = confirmSetVersion;
            setConfirmSetVersion(null);
            void setVersion(next);
          }}
          onCancel={() => setConfirmSetVersion(null)}
        />
      )}

      {versionManageOpen && (
        <VersionManageModal onClose={() => setVersionManageOpen(false)} />
      )}

      {versionPickerOpen && (
        <div className="scr-modal-overlay" onClick={() => setVersionPickerOpen(false)}>
          <div
            className="scr-modal scr-modal-sm scr-admin-panel-version-popup"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="scr-modal-head">
              <span>현재 버전 설정</span>
              <button className="scr-icon-btn" onClick={() => setVersionPickerOpen(false)} aria-label="닫기"><X size={14} /></button>
            </div>
            <div className="scr-modal-body">
              {/* 등록된 버전 중에서 드롭다운으로 고른다 — 현재 버전은 다시 설정할 이유가 없어
                  후보에서 뺀다. */}
              {pickableVersions.length === 0 ? (
                <div className="scr-version-pick-empty">고를 수 있는 다른 버전이 없어요.</div>
              ) : (
                <>
                  <Select
                    value={pickValue}
                    options={pickableVersions.map((v) => ({ value: v.number, label: `${v.number} 버전` }))}
                    onChange={setPickValue}
                    className="scr-version-pick-select"
                  />
                  <button
                    type="button"
                    className="scr-btn scr-btn-primary scr-version-pick-confirm"
                    onClick={() => { setConfirmSetVersion(pickValue); setVersionPickerOpen(false); }}
                    disabled={!pickValue}
                  >
                    설정
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
