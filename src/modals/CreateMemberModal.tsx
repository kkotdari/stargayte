import { useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { Camera, Trash2, X } from "lucide-react";
import Avatar from "../components/common/Avatar";
import ReplayAliasesField, { cleanReplayAliases } from "../components/common/ReplayAliasesField";
import { Spinner } from "../components/common/Feedback";
import AvatarCropModal from "../components/common/AvatarCropModal";
import { useAppStore } from "../store/appStore";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { cx } from "../utils/format";
import { isValidBattletag, isValidLoginId, isValidNickname, isValidPasswordLength, LOGIN_ID_MAX_LENGTH, NICKNAME_MAX_WIDTH, PASSWORD_MAX_LENGTH } from "../utils/textLimits";

interface CreateMemberModalProps {
  onClose: () => void;
}

// 운영자가 회원 화면에서 회원을 바로 생성 — 가입 신청/승인 절차 없이 즉시
// active로 만들어진다. 필드 구성은 SignupForm과 거의 같지만, 게임아이디는 선택이다
// (운영자가 대신 만들어주는 계정이라 아직 실제 플레이 이름을 모를 수 있다).
export default function CreateMemberModal({ onClose }: CreateMemberModalProps) {
  useLockBodyScroll();
  const createMemberByAdmin = useAppStore((s) => s.createMemberByAdmin);

  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [nickname, setNickname] = useState("");
  const [tag, setTag] = useState("");
  const [replayAliases, setReplayAliases] = useState<string[]>([""]);
  const [insta, setInsta] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setCropFile(f);
  };

  const submit = async () => {
    if (!id || !pw || !nickname || !tag) { setErr("필수 항목(*)을 모두 입력해 주세요."); return; }
    if (!isValidLoginId(id)) { setErr(`아이디는 영문/숫자만, 최대 ${LOGIN_ID_MAX_LENGTH}자로 입력해 주세요.`); return; }
    if (!isValidPasswordLength(pw)) { setErr(`비밀번호는 최대 ${PASSWORD_MAX_LENGTH}자까지예요.`); return; }
    if (!isValidNickname(nickname)) { setErr(`닉네임은 영문 기준 최대 ${NICKNAME_MAX_WIDTH}자(한글 ${NICKNAME_MAX_WIDTH / 2}자)까지예요.`); return; }
    if (!isValidBattletag(tag)) { setErr("배틀태그는 \"이름#숫자\" 형식으로 입력해 주세요. (예: Nickname#0000)"); return; }
    setErr("");
    setBusy(true);
    try {
      await createMemberByAdmin({
        id, password: pw, nickname, battletag: tag,
        replayAliases: cleanReplayAliases(replayAliases),
        insta, avatar,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "회원 생성에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-profile">
        <div className="scr-modal-head">
          <span>회원 생성</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          <p className="scr-hint scr-hint-left">
            여기서 만든 회원은 승인 절차 없이 바로 로그인할 수 있어요.
          </p>

          <div className="scr-avatar-pick">
            <div className="scr-avatar-pick-media">
              <Avatar member={{ id: id || "new", nickname: nickname || "?", avatar }} size={56} />
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
          </div>

          <label className="scr-field">
            <span className="scr-label">아이디 *</span>
            <input className="scr-input" value={id} onChange={(e) => setId(e.target.value)} placeholder="영문/숫자, 최대 12자" />
          </label>
          <label className="scr-field">
            <span className="scr-label">비밀번호 *</span>
            <input className="scr-input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="최대 24자" />
          </label>
          <label className="scr-field">
            <span className="scr-label">닉네임 *</span>
            <input className="scr-input" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="최대 한글 8자/영문·숫자·기호 16자" />
          </label>
          <label className="scr-field">
            <span className="scr-label">배틀태그 *</span>
            <input className="scr-input" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Nickname#0000" />
          </label>
          <ReplayAliasesField rows={replayAliases} onChange={setReplayAliases} />
          <label className="scr-field">
            <span className="scr-label">인스타 닉네임 (선택)</span>
            <input className="scr-input" value={insta} onChange={(e) => setInsta(e.target.value)} placeholder="nickname" />
          </label>

          {err && <div className="scr-err">{err}</div>}

          <div className="scr-form-actions">
            <button type="button" className="scr-btn scr-btn-ghost" onClick={onClose}>취소</button>
            <button type="button" className="scr-btn scr-btn-primary" onClick={submit} disabled={busy}>
              {busy ? <><Spinner /> 생성 중...</> : "생성"}
            </button>
          </div>
        </div>
      </div>

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
