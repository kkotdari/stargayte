import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useAppStore } from "../../store/appStore";
import { Spinner } from "../../components/common/Feedback";

const REMEMBER_ID_KEY = "stargayte:rememberedId";

export default function LoginForm() {
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
      <button type="submit" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-auth-submit" disabled={busy}>
        {/* 스피너만 갈아끼우면 버튼이 줄어든다(지적) — 버튼 높이는 min-height가 아니라 글자
            줄 높이가 정하는데, 14px 아이콘만 남으면 그 줄이 사라져 min-height까지 내려앉는다.
            글자를 같이 두면 줄 높이가 그대로라 크기가 안 변한다. */}
        {busy ? <><Spinner /> 로그인 중</> : "로그인"}
      </button>
    </form>
  );
}
