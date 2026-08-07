import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, CalendarPlus, Paperclip, Clock } from "lucide-react";
import { cx } from "../utils/format";
import { Spinner } from "../components/common/Feedback";
import { openPicker } from "../components/common/OptionalDateTimeFields";
import { DATE_INPUT_MIN, DATE_INPUT_MAX, todayStr } from "../utils/date";
import { api } from "../api/client";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import type { Schedule, ScheduleFile } from "../types";

// 서버 스키마(schedules/schemas.py)와 같은 값이어야 한다 — 여기서만 막으면 API를 직접
// 부르는 길로 넘어오고, 서버에서만 막으면 다 적고 나서야 퇴짜를 맞는다.
const TITLE_MAX = 60;
const CONTENT_MAX = 2000;
const LINK_MAX = 500;
const MAX_FILES = 5;
/** 파일 한 개의 상한(바이트) — base64로 부풀면 서버의 data URL 상한(11,000,000자)에
 *  아슬아슬하게 못 미치는 값이다. */
const FILE_MAX_BYTES = 8 * 1024 * 1024;

/** 폼이 들고 있는 파일 한 개 — 이미 올라가 있는 것(url)과 방금 고른 것(data)이 섞인다. */
type DraftFile = ScheduleFile | { name: string; data: string; size: number };
const isNew = (f: DraftFile): f is { name: string; data: string; size: number } => "data" in f;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("파일을 읽지 못했어요."));
    r.readAsDataURL(file);
  });
}

export function formatBytes(n: number): string {
  if (n <= 0) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/** 모임 일정 등록·수정(요청: "일정 등록 … 너나와처럼 모달창(모바일 전체 모달)").
 *
 *  담는 것은 여섯 가지다 — 제목*·일시*(시각은 선택)·내용·링크·파일첨부, 그리고 올린 뒤에
 *  붙는 참가표시와 댓글(그 둘은 카드에서 한다). 너 나와의 호출 폼과 달리 사람을 지목하지
 *  않는다: 일정은 답이 없어도 그날 열린다.
 *
 *  등록과 수정이 같은 창이다 — 폼이 둘이면 칸을 하나 더할 때마다 두 곳을 고쳐야 하고,
 *  실제로 두 화면이 조금씩 달라지는 것도 늘 그 자리에서 시작한다. */
export default function ScheduleFormModal({ initial, onClose, onSaved }: {
  /** 수정이면 고칠 일정, 등록이면 없음. */
  initial?: Schedule | null;
  onClose: () => void;
  onSaved: (schedule: Schedule) => void;
}) {
  useLockBodyScroll();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [dateStr, setDateStr] = useState(initial?.scheduledDate ?? todayStr());
  const [timeStr, setTimeStr] = useState(initial?.scheduledTime ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [linkUrl, setLinkUrl] = useState(initial?.linkUrl ?? "");
  const [files, setFiles] = useState<DraftFile[]>(initial?.files ?? []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // 필수는 둘뿐이다(요청) — 제목과 날짜. 시각은 안 정해도 그날의 일로 선다.
  const canSubmit = title.trim().length > 0 && !!dateStr;

  const pickFiles = async (chosen: FileList | null) => {
    if (!chosen || chosen.length === 0) return;
    setErr("");
    const room = MAX_FILES - files.length;
    if (room <= 0) {
      setErr(`첨부는 ${MAX_FILES}개까지예요.`);
      return;
    }
    const taking = [...chosen].slice(0, room);
    const tooBig = taking.find((f) => f.size > FILE_MAX_BYTES);
    if (tooBig) {
      setErr(`${tooBig.name}은(는) 너무 커요(${formatBytes(FILE_MAX_BYTES)}까지).`);
      return;
    }
    try {
      const read = await Promise.all(taking.map(async (f) => ({
        name: f.name, data: await readAsDataUrl(f), size: f.size,
      })));
      setFiles((prev) => [...prev, ...read]);
      if (chosen.length > room) setErr(`첨부는 ${MAX_FILES}개까지라 ${room}개만 담았어요.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "파일을 읽지 못했어요.");
    } finally {
      // 같은 파일을 다시 골라도 change가 뜨게 값을 비운다.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const submit = async () => {
    if (!canSubmit || busy) return;
    setErr("");
    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        scheduledDate: dateStr,
        // 빈 문자열은 "안 정함"이다 — 그대로 보내면 서버가 시각으로 읽으려다 퇴짜를 놓는다.
        scheduledTime: timeStr || null,
        content: content.trim(),
        linkUrl: linkUrl.trim(),
        // 그대로 두는 파일은 url만, 새로 고른 파일은 data만 — 서버가 그 둘을 갈라 읽는다.
        files: files.map((f) => (isNew(f) ? { name: f.name, data: f.data } : f)),
      };
      const saved = initial
        ? await api.updateSchedule(initial.id, payload)
        : await api.createSchedule(payload);
      onSaved(saved);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "일정을 저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm scr-schedule-form-modal">
        <div className="scr-modal-head">
          <span>{initial ? "일정 수정" : "일정 등록"}</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          <label className="scr-field">
            <span className="scr-label">제목</span>
            <input
              className="scr-input"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
              placeholder="무슨 모임인가요?"
              maxLength={TITLE_MAX}
              autoFocus
            />
          </label>

          {/* 날짜는 필수, 시각은 선택(요청: "일정 일시(시간은 선택)도 필수값") — 한 줄에
              나란히 둔다. 둘이 한 가지 질문("언제")의 앞뒤라, 위아래로 떼어 놓으면 시각
              칸이 별개의 항목처럼 읽힌다. */}
          <div className="scr-field scr-schedule-when">
            <span className="scr-label">일시</span>
            <div className="scr-schedule-when-row">
              <span className="scr-datetime-input-wrap scr-schedule-when-date">
                <input
                  type="date" className="scr-input" value={dateStr}
                  min={DATE_INPUT_MIN} max={DATE_INPUT_MAX}
                  onClick={openPicker}
                  onChange={(e) => setDateStr(e.target.value)}
                />
              </span>
              <span className="scr-datetime-input-wrap scr-schedule-when-time">
                <input
                  type="time" className="scr-input" value={timeStr}
                  onClick={openPicker}
                  onChange={(e) => setTimeStr(e.target.value)}
                />
                {timeStr ? (
                  <button
                    type="button" className="scr-datetime-clear" aria-label="시간 지우기"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTimeStr(""); }}
                  >
                    <X size={12} />
                  </button>
                ) : (
                  <span className="scr-datetime-picker-icon" aria-hidden="true"><Clock size={15} /></span>
                )}
              </span>
            </div>
          </div>

          <label className="scr-field">
            <span className="scr-label">내용 <span className="scr-label-optional">(선택)</span></span>
            <textarea
              className="scr-input scr-schedule-content-input"
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, CONTENT_MAX))}
              placeholder="장소, 준비물, 그 밖에 알릴 것"
              rows={4}
            />
          </label>

          <label className="scr-field">
            <span className="scr-label">링크 <span className="scr-label-optional">(선택)</span></span>
            <input
              className="scr-input" type="url" inputMode="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value.slice(0, LINK_MAX))}
              placeholder="https://"
            />
          </label>

          <div className="scr-field">
            <span className="scr-label">
              파일첨부 <span className="scr-label-optional">(선택)</span>
            </span>
            <input
              ref={fileInputRef} type="file" multiple hidden
              onChange={(e) => void pickFiles(e.target.files)}
            />
            <button
              type="button"
              className="scr-challenge-msg-toggle scr-schedule-file-add"
              onClick={() => fileInputRef.current?.click()}
              disabled={files.length >= MAX_FILES}
            >
              <Paperclip size={14} /> 파일 고르기
            </button>
            {files.length > 0 && (
              <ul className="scr-schedule-file-list">
                {files.map((f, i) => (
                  <li className="scr-schedule-file" key={isNew(f) ? `n${i}` : f.url}>
                    <span className="scr-schedule-file-name">{f.name}</span>
                    <span className="scr-schedule-file-size">{formatBytes(f.size)}</span>
                    <button
                      type="button" className="scr-icon-btn scr-schedule-file-drop"
                      aria-label={`${f.name} 빼기`}
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {err && <div className="scr-err">{err}</div>}
        </div>

        <div className="scr-form-actions">
          <button className="scr-btn scr-btn-ghost" onClick={onClose}>취소</button>
          <button
            className={cx("scr-btn scr-btn-primary scr-btn-primary-solid")}
            onClick={submit} disabled={!canSubmit || busy}
          >
            {busy ? <><Spinner /> 저장하는 중...</> : <><CalendarPlus size={14} /> {initial ? "저장" : "등록"}</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
