import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { UserPlus } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { Spinner } from "../../components/common/Feedback";

const REMEMBER_ID_KEY = "stargayte:rememberedId";

interface LoginFormProps {
  onSignup: () => void;
}

export default function LoginForm({ onSignup }: LoginFormProps) {
  const login = useAppStore((s) => s.login);
  const [id, setId] = useState(() => localStorage.getItem(REMEMBER_ID_KEY) ?? "");
  const [pw, setPw] = useState("");
  const [rememberId, setRememberId] = useState(() => !!localStorage.getItem(REMEMBER_ID_KEY));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);

  // 아이디에서 엔터 -> 비밀번호 칸으로 포커스 이동만 (제출 아님). 비밀번호에서 엔터는 그대로 폼 제출.
  const handleIdKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    pwRef.current?.focus();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!id || !pw) { setErr("아이디와 비밀번호를 입력해 주세요."); return; }
    setErr(""); setBusy(true);
    try {
      await login(id, pw);
      if (rememberId) localStorage.setItem(REMEMBER_ID_KEY, id);
      else localStorage.removeItem(REMEMBER_ID_KEY);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "로그인에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="scr-form" onSubmit={submit}>
      <input
        className="scr-input"
        value={id}
        onChange={(e) => setId(e.target.value)}
        onKeyDown={handleIdKeyDown}
        placeholder="아이디"
      />
      <input
        ref={pwRef}
        className="scr-input"
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="비밀번호"
      />
      <label className="scr-checkbox-field scr-auth-remember">
        <input type="checkbox" checked={rememberId} onChange={(e) => setRememberId(e.target.checked)} />
        아이디 저장
      </label>
      {err && <div className="scr-err">{err}</div>}
      <button type="submit" className="scr-btn scr-btn-primary scr-auth-submit" disabled={busy}>
        {busy ? <Spinner /> : "로그인"}
      </button>
      <button type="button" className="scr-link-btn scr-auth-signup-link" onClick={onSignup} aria-label="회원가입">
        <UserPlus size={18} />
      </button>
    </form>
  );
}
