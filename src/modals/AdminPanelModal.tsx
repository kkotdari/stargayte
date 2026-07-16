import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Spinner } from "../components/common/Feedback";
import ReplayBatchButton from "../components/common/ReplayBatchButton";
import AppUpdateNoticeModal from "./AppUpdateNoticeModal";
import { api } from "../api/client";
import { useAppStore } from "../store/appStore";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { cx } from "../utils/format";
import { versionNumber } from "../utils/appVersion";
import { parseReplayFile } from "../utils/replayParser";

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

  // ===== 리플레이 재연결 복구 도구(일회성) — 0013 마이그레이션이 match_attachments를
  // 백업 없이 드롭하면서, 스토리지엔 남아있지만 DB 연결이 끊긴 예전 리플레이들이 생겼다.
  // 서버가 준 orphan 파일 목록을 하나씩 받아 기존(이미 프론트에 있는) 리플레이 파서로
  // 시작시각을 다시 뽑아내고, 그 시각과 정확히 일치하는 기존 경기에 재연결한다. 복구가
  // 끝나면 이 상태/함수/버튼/로그를 통째로 지워도 된다 — 대충 만든 일회성 도구다. */
  const [relinking, setRelinking] = useState(false);
  const [relinkLog, setRelinkLog] = useState<string[]>([]);
  const runRelink = async () => {
    setRelinking(true);
    setRelinkLog([]);
    const log = (line: string) => setRelinkLog((prev) => [...prev, line]);
    try {
      const files = await api.listOrphanedReplays();
      log(`orphan 파일 ${files.length}개 발견.`);
      for (const f of files) {
        const name = f.path.split("/").pop() || f.path;
        try {
          const res = await fetch(f.url);
          if (!res.ok) { log(`[실패] ${name} — 다운로드 못함`); continue; }
          const blob = await res.blob();
          const file = new File([blob], name);
          const parsed = await parseReplayFile(file);
          if (!parsed.gameStartedAt) { log(`[건너뜀] ${name} — 시작시각을 못 읽음`); continue; }
          const linked = await api.relinkReplay(f.path, parsed.gameStartedAt);
          log(`[연결됨] ${name} → 경기 ${linked.matchNo}`);
        } catch (e) {
          log(`[실패] ${name} — ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
        }
      }
      log("-- 끝 --");
    } catch (e) {
      log(`[중단] ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setRelinking(false);
    }
  };

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
              <div className={cx("scr-admin-panel-preview", !isAdmin && "scr-admin-panel-preview-solo")}>
                <div className="scr-admin-panel-preview-row">
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
                  <button
                    type="button" className="scr-btn scr-admin-panel-preview-btn"
                    onClick={startPreview}
                  >
                    버전 보기
                  </button>
                </div>
                {/* 실제 버전/배포와 무관하게, 첫 접속 때 뜨는 업데이트 안내 모달의 내용만
                    미리 확인해본다 — 배포 전에 문구를 눈으로 검토하기 위한 용도. */}
                <button
                  type="button" className="scr-btn scr-btn-ghost scr-admin-panel-update-preview-btn"
                  onClick={() => setPreviewingUpdateNotice(true)}
                >
                  업데이트 안내 미리보기
                </button>
              </div>
              {isAdmin && (
                <>
                  <div className="scr-admin-panel-version">
                    <span className="scr-admin-panel-version-cur">{appVersion}</span>
                  </div>
                  {err && <div className="scr-err">{err}</div>}
                  <div className="scr-admin-panel-deploy-actions">
                    <button
                      type="button" className="scr-btn scr-admin-panel-rollback-btn"
                      onClick={() => changeVersion(currentNumber - 1)} disabled={busy || currentNumber <= 1}
                    >
                      {busy ? <Spinner /> : `롤백 (v${currentNumber - 1})`}
                    </button>
                    <button
                      type="button" className="scr-btn scr-admin-panel-submit-btn"
                      onClick={() => changeVersion(currentNumber + 1)} disabled={busy}
                    >
                      {busy ? <Spinner /> : `배포 (v${currentNumber + 1})`}
                    </button>
                  </div>
                  {/* 리플레이 폴더 일괄 등록 — 버튼을 누르면 바로 폴더 선택창이 뜬다.
                      운영자만 쓰는 데이터 적재용이라 버전 전환 아래에 조용히 둔다. */}
                  <ReplayBatchButton />
                  {/* 등록된 리플레이 전체를 zip으로 백업 다운로드(운영자). */}
                  <button
                    type="button" className="scr-btn scr-btn-ghost scr-admin-panel-replay-download-btn"
                    onClick={downloadReplays} disabled={downloading}
                  >
                    {downloading ? <Spinner /> : "리플레이 전체 다운로드"}
                  </button>
                  {/* 리플레이 재연결 복구(일회성 도구) — 0013 마이그레이션으로 끊긴
                      예전 리플레이를 다시 찾아 기존 경기에 붙인다. 복구 끝나면 버튼째로
                      지워도 된다. */}
                  <button
                    type="button" className="scr-btn scr-btn-ghost"
                    onClick={runRelink} disabled={relinking}
                  >
                    {relinking ? <Spinner /> : "리플레이 재연결(복구)"}
                  </button>
                  {relinkLog.length > 0 && (
                    <div style={{
                      maxHeight: 220, overflowY: "auto", fontSize: 12, fontFamily: "monospace",
                      whiteSpace: "pre-wrap", background: "rgba(0,0,0,0.25)", padding: 8, borderRadius: 6,
                    }}>
                      {relinkLog.join("\n")}
                    </div>
                  )}
                  {/* 모든 경기기록 삭제 — 되돌릴 수 없는 파괴적 작업이라 눈에 띄게 경고색으로. */}
                  <button
                    type="button" className="scr-btn scr-admin-panel-delete-all-btn"
                    onClick={deleteAllMatches} disabled={busy}
                  >
                    {busy ? <Spinner /> : "모든 경기기록 삭제"}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {previewingUpdateNotice && (
        <AppUpdateNoticeModal onClose={() => setPreviewingUpdateNotice(false)} />
      )}
    </div>,
    document.body,
  );
}
