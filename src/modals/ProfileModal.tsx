import { useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { X, Camera, Trash2 } from "lucide-react";
import Avatar from "../components/common/Avatar";
import { Spinner } from "../components/common/Feedback";
import ConfirmDialog from "../components/common/ConfirmDialog";
import AvatarCropModal from "../components/common/AvatarCropModal";
import ChangePasswordModal from "./ChangePasswordModal";
import { useAppStore } from "../store/appStore";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { cx } from "../utils/format";
import { isValidBattletag, isValidLoginId, isValidNickname, LOGIN_ID_MAX_LENGTH, NICKNAME_MAX_WIDTH } from "../utils/textLimits";

interface ProfileModalProps {
  onClose: () => void;
}

export default function ProfileModal({ onClose }: ProfileModalProps) {
  useLockBodyScroll();
  const user = useAppStore((s) => s.user);
  const updateProfile = useAppStore((s) => s.updateProfile);
  const withdraw = useAppStore((s) => s.withdraw);

  const [id, setId] = useState(user?.id ?? "");
  const [nickname, setNickname] = useState(user?.nickname ?? "");
  const [battletag, setBattletag] = useState(user?.battletag ?? "");
  const [insta, setInsta] = useState(user?.insta ?? "");
  const [avatar, setAvatar] = useState<string | null>(user?.avatar ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 처음 연 상태와 비교해 수정한 내용이 있는지 판단 (있으면 닫을 때 확인)
  const initialSnapshot = useRef(JSON.stringify({
    id: user?.id ?? "",
    nickname: user?.nickname ?? "",
    battletag: user?.battletag ?? "",
    insta: user?.insta ?? "",
    avatar: user?.avatar ?? null,
  })).current;
  const isDirty = JSON.stringify({ id, nickname, battletag, insta, avatar }) !== initialSnapshot;

  const requestClose = () => {
    if (isDirty) setConfirmCloseOpen(true);
    else onClose();
  };

  if (!user) return null;

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    // 같은 파일을 삭제 후 다시 선택해도 change 이벤트가 발생하도록 매번 값을 비워둔다.
    e.target.value = "";
    if (!f) return;
    setCropFile(f);
  };

  const save = async () => {
    if (!id || !nickname || !battletag) {
      setErr("아이디, 닉네임, 배틀태그는 비워둘 수 없어요.");
      return;
    }
    if (!isValidLoginId(id)) { setErr(`아이디는 영문/숫자만, 최대 ${LOGIN_ID_MAX_LENGTH}자로 입력해 주세요.`); return; }
    if (!isValidNickname(nickname)) { setErr(`닉네임은 영문 기준 최대 ${NICKNAME_MAX_WIDTH}자(한글 ${NICKNAME_MAX_WIDTH / 2}자)까지예요.`); return; }
    if (!isValidBattletag(battletag)) { setErr("배틀태그는 \"이름#숫자\" 형식으로 입력해 주세요. (예: Nickname#0000)"); return; }
    setErr("");
    setBusy(true);
    try {
      await updateProfile({ id, nickname, battletag, insta, avatar });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  const doWithdraw = async () => {
    setWithdrawing(true);
    try {
      await withdraw();
      // withdraw() 성공 시 store 의 user 가 비워져 자동으로 로그인 화면으로 돌아간다.
    } catch (e) {
      setErr(e instanceof Error ? e.message : "탈퇴에 실패했어요.");
      setConfirmWithdraw(false);
    } finally {
      setWithdrawing(false);
    }
  };

  return createPortal(
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-profile">
        <div className="scr-modal-head">
          <span>내 정보 수정</span>
          <button className="scr-icon-btn" onClick={requestClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          <div className="scr-avatar-pick">
            <div className="scr-avatar-pick-media">
              <Avatar member={{ id, nickname, avatar }} size={64} />
            </div>
            <div className="scr-avatar-pick-actions">
              <button
                type="button"
                className="scr-icon-btn scr-avatar-pick-btn"
                onClick={() => fileRef.current?.click()}
                aria-label="사진 변경"
              >
                <Camera size={14} />
              </button>
              <button
                type="button"
                className={cx("scr-icon-btn", "scr-icon-btn-danger", "scr-avatar-pick-btn", !avatar && "scr-avatar-pick-btn-hidden")}
                onClick={() => setAvatar(null)}
                aria-label="사진 삭제"
                tabIndex={avatar ? 0 : -1}
              >
                <Trash2 size={14} />
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} />
            </div>
            <label className="scr-field scr-avatar-pick-id">
              <span className="scr-label">아이디</span>
              <input className="scr-input" value={id} onChange={(e) => setId(e.target.value)} placeholder="영문/숫자, 최대 12자" />
            </label>
          </div>

          <label className="scr-field">
            <span className="scr-label">닉네임</span>
            <input className="scr-input" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="최대 한글 8자/영문·숫자·기호 16자" />
          </label>
          <label className="scr-field">
            <span className="scr-label">배틀태그</span>
            <input className="scr-input" value={battletag} onChange={(e) => setBattletag(e.target.value)} placeholder="Nickname#0000" />
          </label>

          <label className="scr-field">
            <span className="scr-label">인스타 닉네임 (선택)</span>
            <input className="scr-input" value={insta} onChange={(e) => setInsta(e.target.value)} placeholder="nickname" />
          </label>

          <div className="scr-field">
            <span className="scr-label">비밀번호</span>
            <div className="scr-field-actions">
              <button type="button" className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => setPasswordModalOpen(true)}>
                비밀번호 변경
              </button>
            </div>
          </div>

          {err && <div className="scr-err">{err}</div>}

          <div className="scr-profile-danger">
            <button type="button" className="scr-link-danger" onClick={() => setConfirmWithdraw(true)}>
              회원 탈퇴
            </button>
          </div>

          <div className="scr-form-actions">
            <button className="scr-btn scr-btn-ghost" onClick={requestClose}>취소</button>
            <button className="scr-btn scr-btn-primary" onClick={save} disabled={busy}>
              {busy ? <><Spinner /> 저장 중...</> : "저장"}
            </button>
          </div>
        </div>
      </div>

      {confirmCloseOpen && (
        <ConfirmDialog
          title="수정이 취소됩니다."
          message=""
          confirmLabel="닫기"
          cancelLabel="계속 수정"
          onConfirm={onClose}
          onCancel={() => setConfirmCloseOpen(false)}
        />
      )}

      {confirmWithdraw && (
        <ConfirmDialog
          title="정말 탈퇴하시겠어요?"
          message="탈퇴하면 이 아이디로 다시 로그인할 수 없어요. 지금까지의 경기결과는 그대로 남아요."
          confirmLabel={withdrawing ? "처리 중..." : "탈퇴하기"}
          cancelLabel="취소"
          onConfirm={doWithdraw}
          onCancel={() => setConfirmWithdraw(false)}
        />
      )}

      {passwordModalOpen && <ChangePasswordModal onClose={() => setPasswordModalOpen(false)} />}

      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onDone={(dataUrl) => { setAvatar(dataUrl); setCropFile(null); }}
        />
      )}

    </div>,
    document.body,
  );
}
