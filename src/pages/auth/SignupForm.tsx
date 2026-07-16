import { useState, useRef, type FormEvent, type ChangeEvent } from "react";
import { Camera, CheckCircle2, Trash2 } from "lucide-react";
import { api } from "../../api/client";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import AvatarCropModal from "../../components/common/AvatarCropModal";
import { cx } from "../../utils/format";
import { isValidBattletag, isValidLoginId, isValidNickname, isValidPasswordLength, LOGIN_ID_MAX_LENGTH, NICKNAME_MAX_WIDTH, PASSWORD_MAX_LENGTH } from "../../utils/textLimits";

interface SignupFormProps {
  onDone: () => void;
}

export default function SignupForm({ onDone }: SignupFormProps) {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [nickname, setNickname] = useState("");
  const [tag, setTag] = useState("");
  const [insta, setInsta] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [approved, setApproved] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    // 같은 파일을 삭제 후 다시 선택해도 change 이벤트가 발생하도록 매번 값을 비워둔다.
    e.target.value = "";
    if (!f) return;
    setCropFile(f);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!id || !pw || !pw2 || !nickname || !tag) {
      setErr("필수 항목(*)을 모두 입력해 주세요.");
      return;
    }
    if (pw !== pw2) { setErr("비밀번호와 비밀번호 확인이 일치하지 않아요."); return; }
    if (!isValidLoginId(id)) { setErr(`아이디는 영문/숫자만, 최대 ${LOGIN_ID_MAX_LENGTH}자로 입력해 주세요.`); return; }
    if (!isValidPasswordLength(pw)) { setErr(`비밀번호는 최대 ${PASSWORD_MAX_LENGTH}자까지예요.`); return; }
    if (!isValidNickname(nickname)) { setErr(`닉네임은 영문 기준 최대 ${NICKNAME_MAX_WIDTH}자(한글 ${NICKNAME_MAX_WIDTH / 2}자)까지예요.`); return; }
    if (!isValidBattletag(tag)) { setErr("배틀태그는 \"이름#숫자\" 형식으로 입력해 주세요. (예: Nickname#0000)"); return; }
    setErr(""); setBusy(true);
    try {
      const { user } = await api.signup({ id, password: pw, nickname, battletag: tag, replayAliases: [], insta, avatar });
      setApproved(user.status === "active");
      setDone(true);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "가입에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="scr-form">
        <div className="scr-success">
          <CheckCircle2 size={16} />
          {approved
            ? "가입이 완료됐어요. 방금 만든 아이디로 로그인할 수 있어요."
            : "가입 신청이 접수됐어요. 운영자가 승인하면 로그인할 수 있어요."}
        </div>
        <button className="scr-btn scr-btn-ghost" onClick={onDone}>로그인 화면으로</button>
      </div>
    );
  }

  return (
    <form className="scr-form" onSubmit={submit}>
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

      <input className="scr-input" value={id} onChange={(e) => setId(e.target.value)} placeholder="사용할 아이디 (영문/숫자, 최대 12자) *" />
      <input className="scr-input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="비밀번호 (최대 24자) *" />
      <input className="scr-input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="비밀번호 확인 *" />
      <input className="scr-input" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="닉네임 (최대 한글 8자/영문·숫자·기호 16자) *" />
      <input className="scr-input" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="배틀태그 (Nickname#0000) *" />
      <input className="scr-input" value={insta} onChange={(e) => setInsta(e.target.value)} placeholder="인스타 닉네임 (선택, nickname)" />

      {err && <div className="scr-err">{err}</div>}
      <button type="submit" className="scr-btn scr-btn-primary" disabled={busy}>
        {busy ? <><Spinner /> 처리 중...</> : "가입하기"}
      </button>

      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onDone={(dataUrl) => { setAvatar(dataUrl); setCropFile(null); }}
        />
      )}
    </form>
  );
}
