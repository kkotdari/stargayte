import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThumbsUp } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import type { Member, MatchRequest } from "../../types";

interface MatchRequestCornerProps {
  // "들어주기"를 누르면 부모(ChallengeScreen)가 도전장 보내기 모달을 요청 작성자를 상대로 연다.
  onFulfill: (request: MatchRequest) => void;
  // 부모가 도전장 전송을 마치고 이 값을 올리면 코너가 목록을 새로 불러온다(들어준 요청이 사라짐).
  reloadSignal: number;
}

// 본문에서 @닉네임 토큰을 찾아, 지목된 회원의 닉네임은 강조 칩으로 렌더한다.
function renderText(text: string, targetNames: Set<string>) {
  // @뒤에 오는 이름(공백/문장부호 전까지)을 토큰으로 잡는다.
  const parts = text.split(/(@[^\s@]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith("@") && targetNames.has(part.slice(1))) {
      return <span key={i} className="scr-mreq-tag">{part}</span>;
    }
    return <span key={i}>{part}</span>;
  });
}

export default function MatchRequestCorner({ onFulfill, reloadSignal }: MatchRequestCornerProps) {
  const members = useAppStore((s) => s.members);
  const user = useAppStore((s) => s.user);

  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ items: MatchRequest[]; total: number; hasMore: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");
  const [tagged, setTagged] = useState<Member[]>([]);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  // @태그 후보 — 나 자신을 뺀 실제 회원. @쿼리로 닉네임/아이디 부분일치 필터.
  const candidates = useMemo(() => {
    const q = (mentionQuery ?? "").toLowerCase();
    return members
      .filter((m) => m.id !== user?.id)
      .filter((m) => !q || m.nickname.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
      .slice(0, 6);
  }, [members, user?.id, mentionQuery]);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.getMatchRequests(p);
      setData({ items: res.items, total: res.total, hasMore: res.hasMore });
    } catch {
      setErr("대결 요청을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(page); }, [page, load]);
  // 부모가 들어주기/새 요청 등으로 신호를 올리면 현재 페이지를 다시 불러온다.
  useEffect(() => { if (reloadSignal > 0) void load(page); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSignal]);

  // 입력이 바뀔 때 커서 앞의 "@쿼리"를 잡아 자동완성 드롭다운을 띄운다.
  const onTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setText(v);
    const caret = e.target.selectionStart ?? v.length;
    const before = v.slice(0, caret);
    const m = before.match(/@([^\s@]*)$/);
    setMentionQuery(m ? m[1] : null);
  };

  const pickMention = (member: Member) => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([^\s@]*)$/, `@${member.nickname} `);
    const after = text.slice(caret);
    const next = before + after;
    setText(next);
    setMentionQuery(null);
    setTagged((prev) => (prev.some((m) => m.id === member.id) ? prev : [...prev, member]));
    // 포커스/커서를 삽입 위치 뒤로.
    requestAnimationFrame(() => {
      el?.focus();
      const pos = before.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  // 본문에 아직 @닉네임이 남아있는 지목만 유효 — 태그 텍스트를 지우면 자동 해제된다.
  const activeTargets = useMemo(
    () => tagged.filter((m) => text.includes(`@${m.nickname}`)),
    [tagged, text],
  );

  const canSubmit = text.trim().length > 0 && activeTargets.length >= 2 && !submitting;

  const submit = async () => {
    if (activeTargets.length < 2) {
      setSubmitErr("@태그로 최소 두 명을 지목해주세요.");
      return;
    }
    setSubmitting(true);
    setSubmitErr(null);
    try {
      await api.createMatchRequest({
        text: text.trim(),
        targetMemberIds: activeTargets.map((m) => m.id),
      });
      setText("");
      setTagged([]);
      setComposing(false);
      setPage(0);
      await load(0);
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : "요청을 올리지 못했어요.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRecommend = async (req: MatchRequest) => {
    setBusyId(req.id);
    try {
      const updated = await api.toggleMatchRequestRecommend(req.id);
      setData((d) => d && {
        ...d,
        items: d.items.map((it) => (it.id === req.id ? updated : it)),
      });
    } catch {
      // 조용히 무시 — 다음 새로고침에 반영된다.
    } finally {
      setBusyId(null);
    }
  };

  const removeOwn = async (req: MatchRequest) => {
    setBusyId(req.id);
    try {
      await api.deleteMatchRequest(req.id);
      await load(page);
    } catch {
      // 무시
    } finally {
      setBusyId(null);
    }
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 5));

  return (
    <section className="scr-mreq-corner">
      <div className="scr-mreq-head">
        <h2 className="scr-mreq-title">대결 요청</h2>
        {!composing && (
          <button type="button" className="scr-btn scr-btn-sm scr-btn-primary scr-btn-primary-solid" onClick={() => setComposing(true)}>
            + 요청 올리기
          </button>
        )}
      </div>

      {composing && (
        <div className="scr-mreq-compose">
          <div className="scr-mreq-input-wrap">
            <textarea
              ref={inputRef}
              className="scr-input scr-mreq-input"
              rows={2}
              placeholder="@닉네임으로 상대를 지목해 대결을 요청하세요 (최소 2명)"
              value={text}
              onChange={onTextChange}
              maxLength={200}
            />
            {mentionQuery !== null && candidates.length > 0 && (
              <div className="scr-mreq-mention-drop">
                {candidates.map((m) => (
                  <button key={m.id} type="button" className="scr-mreq-mention-opt" onClick={() => pickMention(m)}>
                    <Avatar member={m} size={22} />
                    <span className="scr-mreq-mention-name">{m.nickname}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {activeTargets.length > 0 && (
            <div className="scr-mreq-tag-list">
              지목: {activeTargets.map((m) => (
                <span key={m.id} className="scr-mreq-tag">@{m.nickname}</span>
              ))}
            </div>
          )}
          {submitErr && <div className="scr-err">{submitErr}</div>}
          <div className="scr-mreq-compose-actions">
            <button type="button" className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => { setComposing(false); setText(""); setTagged([]); setSubmitErr(null); }}>
              취소
            </button>
            <button type="button" className="scr-btn scr-btn-sm scr-btn-primary scr-btn-primary-solid" disabled={!canSubmit} onClick={() => void submit()}>
              {submitting ? <Spinner size={14} /> : "요청 올리기"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="scr-empty"><Spinner size={16} /></div>
      ) : err ? (
        <div className="scr-err">{err}</div>
      ) : items.length === 0 ? (
        <div className="scr-mreq-empty">아직 올라온 대결 요청이 없어요.</div>
      ) : (
        <ul className="scr-mreq-list">
          {items.map((req) => {
            const targetNames = new Set(req.targets.map((t) => t.nickname));
            return (
              <li key={req.id} className="scr-mreq-item">
                <div className="scr-mreq-item-main">
                  <div className="scr-mreq-item-author">
                    <Avatar member={{ id: req.author.memberId, nickname: req.author.nickname, avatar: req.author.avatar }} size={24} />
                    <span className="scr-mreq-item-author-name">{req.author.nickname}</span>
                  </div>
                  <p className="scr-mreq-item-text">{renderText(req.text, targetNames)}</p>
                </div>
                <div className="scr-mreq-item-actions">
                  <button
                    type="button"
                    className={cx("scr-mreq-rec-btn", req.recommendedByMe && "scr-mreq-rec-btn-on")}
                    onClick={() => void toggleRecommend(req)}
                    disabled={busyId === req.id}
                    aria-pressed={req.recommendedByMe}
                  >
                    <ThumbsUp size={14} /> {req.recommendCount}
                  </button>
                  {req.mine ? (
                    <button type="button" className="scr-btn scr-btn-ghost scr-btn-sm scr-mreq-take-btn" onClick={() => void removeOwn(req)} disabled={busyId === req.id}>
                      내리기
                    </button>
                  ) : req.iAmTarget ? (
                    <button type="button" className="scr-btn scr-btn-sm scr-btn-primary scr-btn-primary-solid scr-mreq-take-btn" onClick={() => onFulfill(req)}>
                      들어주기
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {total > 5 && (
        <div className="scr-mreq-pager">
          <button type="button" className="scr-mreq-pager-btn" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>이전</button>
          <span className="scr-mreq-pager-info">{page + 1} / {totalPages}</span>
          <button type="button" className="scr-mreq-pager-btn" disabled={!data?.hasMore} onClick={() => setPage((p) => p + 1)}>다음</button>
        </div>
      )}
    </section>
  );
}
