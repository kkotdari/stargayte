import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Spinner } from "../components/common/Feedback";
import ConfirmDialog from "../components/common/ConfirmDialog";
import ReplayBatchButton from "../components/common/ReplayBatchButton";
import AppUpdateNoticeModal from "./AppUpdateNoticeModal";
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
// 회원 누구나 할 수 있다. 다만 실제로 앱 버전을 바꾸는 "배포"는 운영자만 할 수 있고, 일반
// 회원은 통과해도 이 브라우저 탭에서만 켜지는 "미리보기"만 쓸 수 있다.
export default function AdminPanelModal({ isAdmin, onClose }: AdminPanelModalProps) {
  useLockBodyScroll();
  // 숨겨진 제어판이 열리는 순간 낡은 경첩이 삐걱이는 "끼익" 소리(요청) — 로고 3연타라는
  // 사용자 제스처 직후라 자동재생 정책에 막히지 않는다. 마운트 때 한 번만.
  useEffect(() => { playCreak(); }, []);
  const appVersion = useAppStore((s) => s.appVersion);
  const appVersions = useAppStore((s) => s.appVersions);
  const previewVersion = useAppStore((s) => s.previewVersion);
  const setAppVersion = useAppStore((s) => s.setAppVersion);
  const setPreviewVersion = useAppStore((s) => s.setPreviewVersion);
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // 실제 버전을 바꾸지 않고, 첫 접속 업데이트 안내 모달(AppUpdateNoticeModal)의 내용/모양만
  // 미리 확인해보는 용도 — 배포 전에 문구를 눈으로 검토할 수 있게 한다.
  const [previewingUpdateNotice, setPreviewingUpdateNotice] = useState(false);
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

  // 버전 선택 팝업 — 미리보기와 배포가 같은 목록(등록된 버전)을 쓴다(요청: "버전 선택 팝업은
  // 미리보기랑 배포에 같이"). 어느 동작으로 열렸는지만 mode로 구분한다. null이면 닫힘.
  const [versionPickerMode, setVersionPickerMode] = useState<"preview" | "deploy" | null>(null);
  // 배포는 모두에게 즉시 반영되는 실제 전환이라, 버전을 고른 뒤 확인창을 한 번 더 거친다.
  const [confirmDeployVersion, setConfirmDeployVersion] = useState<string | null>(null);

  // 팝업에서 버전 하나를 고르면 — 미리보기면 이 탭에서만 그 버전으로 둘러보게 켜고(패널을
  // 닫아 바로 확인), 배포면 확인창으로 넘긴다. 현재 버전은 팝업에서 못 고르게 막아둔다.
  const pickVersion = (number: string) => {
    if (versionPickerMode === "preview") {
      setPreviewVersion(versionNumber(number));
      setVersionPickerMode(null);
      onClose();
    } else {
      setConfirmDeployVersion(number);
      setVersionPickerMode(null);
    }
  };

  const deploy = async (number: string) => {
    setBusy(true);
    setErr("");
    try {
      await setAppVersion(number);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "배포에 실패했어요.");
    } finally {
      setBusy(false);
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
              <label className="scr-field">
                {/* 무엇을 묻는지조차 힌트를 주지 않는다 — 라벨/문구 없이 숫자 비밀번호
                    입력칸 하나만 보여준다. 숫자 전용이라 모바일에서도 숫자 키패드가
                    뜨도록 inputMode를 지정하고, type="password"로 입력값을 가린다.
                    autoFocus는 안 준다 — 모바일에서 모달이 뜨자마자 키보드가 튀어나오는
                    걸 막는다(이 코드베이스 전반의 원칙). */}
                <input
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
              {/* 버전관리 — 소제목(현재 버전 표시 포함) + 2열 그리드. 배포/롤백을 배포
                  하나로 합치고(요청), 누르면 등록된 버전 중에서 고르는 팝업을 연다.
                  미리보기도 같은 팝업을 쓴다. 미리보기 중일 때만 "미리보기 종료" 버튼이
                  생긴다(요청: "미리보기 중에는 평소에 없던 미리보기 종료 버튼 활성화"). */}
              <div className={cx("scr-admin-panel-preview", !isAdmin && "scr-admin-panel-preview-solo")}>
                <div className="scr-admin-panel-section-title">
                  버전관리 <span className="scr-admin-panel-section-title-dim">(현재버전 : {currentNumber})</span>
                </div>
                <div className="scr-admin-panel-grid">
                  <button
                    type="button" className="scr-admin-panel-phys-btn"
                    onClick={() => setVersionPickerMode("preview")}
                  >
                    미리보기
                  </button>
                  <button
                    type="button" className="scr-admin-panel-phys-btn"
                    onClick={() => setPreviewingUpdateNotice(true)}
                  >
                    안내미리보기
                  </button>
                  {/* 배포는 운영자만 — 같은 그리드 안에 이어 붙이면 2열 구성이 유지된 채
                      다음 줄로 넘어간다. */}
                  {isAdmin && (
                    <button
                      type="button" className="scr-admin-panel-phys-btn scr-admin-panel-phys-btn-danger"
                      onClick={() => setVersionPickerMode("deploy")} disabled={busy}
                    >
                      {busy ? <Spinner /> : "배포"}
                    </button>
                  )}
                  {/* 미리보기 중일 때만 나타나는 종료 버튼 — 회원/운영자 모두 쓸 수 있다. */}
                  {previewVersion !== null && (
                    <button
                      type="button" className="scr-admin-panel-phys-btn"
                      onClick={() => setPreviewVersion(null)}
                    >
                      미리보기 종료
                    </button>
                  )}
                </div>
              </div>
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
                    {/* 리플레이 폴더 일괄 등록 — 버튼을 누르면 바로 폴더 선택창이 뜬다. */}
                    <ReplayBatchButton />
                    {/* 등록된 리플레이 전체를 zip으로 백업 다운로드(운영자) — 읽기 전용이라
                        확인창 없이 바로 받는다. */}
                    <button
                      type="button" className="scr-admin-panel-phys-btn"
                      onClick={downloadReplays} disabled={downloading}
                    >
                      {downloading ? <Spinner /> : "배치다운로드"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {confirmDeployVersion && (
        <ConfirmDialog
          title={`${confirmDeployVersion} 버전으로 배포할까요?`}
          message="모든 사용자에게 즉시 반영됩니다."
          confirmLabel="배포"
          onConfirm={() => {
            const next = confirmDeployVersion;
            setConfirmDeployVersion(null);
            deploy(next);
          }}
          onCancel={() => setConfirmDeployVersion(null)}
        />
      )}

      {previewingUpdateNotice && (
        <AppUpdateNoticeModal onClose={() => setPreviewingUpdateNotice(false)} />
      )}

      {versionPickerMode && (
        <div className="scr-modal-overlay" onClick={() => setVersionPickerMode(null)}>
          <div
            className="scr-modal scr-modal-sm scr-admin-panel-version-popup"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="scr-modal-head">
              <span>{versionPickerMode === "deploy" ? "배포할 버전" : "미리볼 버전"}</span>
              <button className="scr-icon-btn" onClick={() => setVersionPickerMode(null)} aria-label="닫기"><X size={14} /></button>
            </div>
            <div className="scr-modal-body">
              {/* 등록된 버전만 나열한다(요청) — 현재 버전은 고를 수 없어(요청: "현재 버전으로는
                  불가") 비활성 + "현재" 표시로 어디에 있는지만 보여준다. */}
              <div className="scr-version-pick-list">
                {appVersions.map((v) => {
                  const isCurrent = versionNumber(v.number) === currentNumber;
                  return (
                    <button
                      key={v.number}
                      type="button"
                      className={cx("scr-version-pick-item", isCurrent && "scr-version-pick-item-current")}
                      disabled={isCurrent}
                      onClick={() => pickVersion(v.number)}
                    >
                      <span className="scr-version-pick-num">{v.number}</span>
                      {isCurrent && <span className="scr-version-pick-tag">현재</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
