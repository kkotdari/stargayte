import { useState } from "react";
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

interface AdminPanelModalProps {
  isAdmin: boolean;
  onClose: () => void;
}

// 실수로 눌러도 바로 전환되지 않도록 거는 최소한의 잠금 — 어떤 문구도 없이 숫자
// 비밀번호만 입력받는다(퀴즈 문구를 없애면서 뭘 묻는지 힌트조차 안 준다). 정답 자체는
// 코드에 두지 않고 서버(env_vars.admin_panel_password)에 물어봐서 맞는지만 확인한다 —
// 코드 배포 없이 DB에서 바로 비밀번호를 바꿀 수 있다.

// 메인 로고를 3번 연달아 눌러야만 뜨는 숨겨진 제어판 — 트리거(로고 탭)도, 통과(비밀번호)도
// 회원 누구나 할 수 있다. 다만 실제로 앱 버전을 바꾸는 "배포(+1)/롤백(-1)"은 운영자만 할
// 수 있고, 일반 회원은 통과해도 이 브라우저 탭에서만 켜지는 "N버전 미리보기"만 쓸 수 있다.
export default function AdminPanelModal({ isAdmin, onClose }: AdminPanelModalProps) {
  useLockBodyScroll();
  const appVersion = useAppStore((s) => s.appVersion);
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
  const [previewInput, setPreviewInput] = useState(String(currentNumber + 1));

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

  // 미리보기 입력칸 위/아래 삼각형 화살표로 값을 1씩 올리고 내린다 — 브라우저 기본
  // number 스피너(위아래 화살표가 인풋 오른쪽에 붙는 모양)는 CSS로 숨기고 대신 이걸 쓴다.
  const stepPreview = (delta: number) => {
    const n = Number(previewInput);
    const base = Number.isInteger(n) && n >= 1 ? n : currentNumber;
    setPreviewInput(String(Math.max(1, base + delta)));
  };

  const startPreview = () => {
    const n = Number(previewInput);
    if (!Number.isInteger(n) || n < 1) {
      setErr("1 이상의 정수를 입력하세요.");
      return;
    }
    setPreviewVersion(n);
    onClose();
  };

  // 배포(+1)/롤백(-1) — 항상 지금 버전 기준 한 단계씩만 움직인다(임의 버전으로 바로
  // 점프하는 건 미리보기로만 가능하다). v1 아래로는 못 내려간다.
  const changeVersion = async (next: number) => {
    setBusy(true);
    setErr("");
    try {
      await setAppVersion(`v${next}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "전환에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 관리자 기능 버튼은(단순 조회 제외) 실행 전 확인창을 거친다(요청: "관리자 버튼들은
  // 다 컨펌창 있어야돼(단순 조회는 제외)"). 배포/롤백은 모든 사용자에게 즉시 반영되는
  // 실제 버전 전환이라 대상이고, 리플레이 다운로드는 읽기 전용이라 제외한다.
  const [confirmVersionAction, setConfirmVersionAction] = useState<"rollback" | "deploy" | null>(null);
  // "버전보기"를 누르면 뜨는 별도 팝업 — 몇 번 버전을 미리볼지 여기서 고른다(요청:
  // "버전 입력창을 없애고 버전보기 누르면 팝업으로 버전 선택").
  const [versionPreviewOpen, setVersionPreviewOpen] = useState(false);

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
              {/* 버전관리 — 소제목(현재 버전 표시 포함) + 2열 그리드(요청: "가로로
                  두개씩 배치(버튼 폭 늘리기)"). 버전 선택 스테퍼를 이 칸 안에 같이
                  넣었더니 그 줄만 다른 버튼보다 키가 커졌다(실제로 지적받은 문제) —
                  "버전보기"는 다른 버튼들과 똑같은 버튼으로 두고, 누르면 뜨는 별도
                  팝업에서 번호를 고르게 한다. */}
              <div className={cx("scr-admin-panel-preview", !isAdmin && "scr-admin-panel-preview-solo")}>
                <div className="scr-admin-panel-section-title">
                  버전관리 <span className="scr-admin-panel-section-title-dim">(현재버전 : {currentNumber})</span>
                </div>
                <div className="scr-admin-panel-grid">
                  <button
                    type="button" className="scr-admin-panel-phys-btn"
                    onClick={() => setVersionPreviewOpen(true)}
                  >
                    버전보기
                  </button>
                  <button
                    type="button" className="scr-admin-panel-phys-btn"
                    onClick={() => setPreviewingUpdateNotice(true)}
                  >
                    안내미리보기
                  </button>
                  {/* 배포/롤백은 운영자만 — 같은 그리드 안에 이어 붙이면 열 구성이
                      그대로 유지된 채(2열) 자연스럽게 다음 줄로 넘어간다. */}
                  {isAdmin && (
                    <>
                      <button
                        type="button" className="scr-admin-panel-phys-btn scr-admin-panel-phys-btn-danger"
                        onClick={() => setConfirmVersionAction("deploy")} disabled={busy}
                      >
                        {busy ? <Spinner /> : "배포"}
                      </button>
                      <button
                        type="button" className="scr-admin-panel-phys-btn"
                        onClick={() => setConfirmVersionAction("rollback")} disabled={busy || currentNumber <= 1}
                      >
                        {busy ? <Spinner /> : "롤백"}
                      </button>
                    </>
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

      {confirmVersionAction && (
        <ConfirmDialog
          title={confirmVersionAction === "deploy"
            ? `v${currentNumber + 1}로 배포할까요?`
            : `v${currentNumber - 1}로 롤백할까요?`}
          message="모든 사용자에게 즉시 반영됩니다."
          confirmLabel={confirmVersionAction === "deploy" ? "배포" : "롤백"}
          onConfirm={() => {
            const next = confirmVersionAction === "deploy" ? currentNumber + 1 : currentNumber - 1;
            setConfirmVersionAction(null);
            changeVersion(next);
          }}
          onCancel={() => setConfirmVersionAction(null)}
        />
      )}

      {previewingUpdateNotice && (
        <AppUpdateNoticeModal onClose={() => setPreviewingUpdateNotice(false)} />
      )}

      {versionPreviewOpen && (
        <div className="scr-modal-overlay" onClick={() => setVersionPreviewOpen(false)}>
          <div
            className="scr-modal scr-modal-sm scr-admin-panel-version-popup"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="scr-modal-head">
              <span>미리볼 버전</span>
              <button className="scr-icon-btn" onClick={() => setVersionPreviewOpen(false)} aria-label="닫기"><X size={14} /></button>
            </div>
            <div className="scr-modal-body">
              <div className="scr-admin-panel-preview-stepper">
                <button
                  type="button" className="scr-admin-panel-preview-arrow"
                  onClick={() => stepPreview(1)} aria-label="미리보기 버전 올리기"
                >
                  <svg width="20" height="13" viewBox="0 0 20 13" aria-hidden="true">
                    <polygon points="10,0 20,13 0,13" fill="#fff" stroke="#000" strokeWidth="1.3" strokeLinejoin="round" />
                  </svg>
                </button>
                <input
                  type="number" min={1} inputMode="numeric"
                  className="scr-input scr-admin-panel-preview-input"
                  value={previewInput}
                  onChange={(e) => setPreviewInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") startPreview(); }}
                />
                <button
                  type="button" className="scr-admin-panel-preview-arrow"
                  onClick={() => stepPreview(-1)} aria-label="미리보기 버전 내리기"
                >
                  <svg width="20" height="13" viewBox="0 0 20 13" aria-hidden="true" style={{ transform: "rotate(180deg)" }}>
                    <polygon points="10,0 20,13 0,13" fill="#fff" stroke="#000" strokeWidth="1.3" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              {err && <div className="scr-err">{err}</div>}
              <button type="button" className="scr-btn scr-btn-primary" onClick={startPreview}>
                미리보기 시작
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
