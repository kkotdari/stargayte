import { useState } from "react";
import { CalendarDays, Check, ExternalLink, MoreHorizontal, Paperclip, X } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import { cx } from "../../utils/format";
import { formatWhen } from "../../utils/date";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import type { Schedule } from "../../types";
import { ActivityCard } from "./ActivityCard";
import { formatBytes } from "../../modals/ScheduleFormModal";

/** 이 일정의 "언제" 한 줄 — 날짜는 늘 있고 시각은 있을 때만 붙는다.
 *
 *  날짜 표기는 앱의 유일한 꼴(formatWhen)을 그대로 쓴다 — "오늘"·"이번주 토요일"처럼
 *  사람이 부르는 말로 나온다. 시각을 안 정했으면 그 자리에 "시간 미정"을 적는다: 빈칸으로
 *  두면 "몇 시인지 아직 안 정했다"와 "적는 걸 깜빡했다"가 같은 그림이 된다. */
function whenText(schedule: Schedule): string {
  const day = formatWhen(schedule.scheduledDate);
  return schedule.scheduledTime ? `${day} ${schedule.scheduledTime}` : `${day} · 시간 미정`;
}

/** 일정 카드의 케밥 — 올린 사람(또는 운영자)만 고치고 지운다. */
function ScheduleActionsMenu({ schedule, canEdit, onEdit, onDeleted }: {
  schedule: Schedule;
  canEdit: boolean;
  onEdit: () => void;
  onDeleted: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!canEdit) return null;

  const remove = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.deleteSchedule(schedule.id);
      onDeleted(schedule.id);
      setConfirmOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scr-activity-chal-menu">
      <button
        type="button" className="scr-activity-post-menu-btn scr-activity-kebab-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="더보기" aria-haspopup="menu" aria-expanded={open}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          {/* 백드롭 클릭은 '메뉴 닫기'에서 끝나야 한다 — 안 끊으면 그 클릭이 카드 본체까지
              올라가 줄 펼침/접힘까지 같이 눌린다(너 나와 케밥과 같은 이유). */}
          <div
            className="scr-activity-add-backdrop"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            aria-hidden
          />
          <div className="scr-menu-pop-drop scr-activity-chal-menu-drop" role="menu">
            <button
              type="button" role="menuitem" className="scr-menu-pop-opt"
              onClick={() => { setOpen(false); onEdit(); }}
            >
              수정
            </button>
            <button
              type="button" role="menuitem"
              className={cx("scr-menu-pop-opt", "scr-activity-post-menu-opt-danger")}
              onClick={() => { setOpen(false); setConfirmOpen(true); }}
            >
              삭제
            </button>
          </div>
        </>
      )}
      {confirmOpen && (
        <ConfirmDialog
          title="일정 삭제"
          message="이 일정을 삭제할까요? 달린 댓글과 첨부파일도 함께 사라져요."
          confirmLabel={busy ? "삭제 중..." : "삭제"}
          error={err}
          onConfirm={() => void remove()}
          onCancel={() => { setConfirmOpen(false); setErr(null); }}
        />
      )}
    </div>
  );
}

/** 참가표시 — 손을 든 사람만 명단에 선다(요청: "참가표시").
 *
 *  세 갈래가 아니라 두 버튼이다: 갈지 안 갈지. 다시 누르면 표시를 거둬 '아직 답 안 함'으로
 *  돌아간다 — 마음을 바꾸는 길을 따로 만들지 않아도 같은 버튼이 그 일을 한다. */
function ScheduleAttend({ schedule, myId, onChanged }: {
  schedule: Schedule;
  myId: string | undefined;
  onChanged: (s: Schedule) => void;
}) {
  const memberOf = useAppStore((s) => s.memberOf);
  const [busy, setBusy] = useState(false);
  const mine = schedule.attendees.find((a) => a.memberId === myId)?.response ?? null;
  const going = schedule.attendees.filter((a) => a.response === "going");
  const notGoing = schedule.attendees.filter((a) => a.response === "notGoing");

  const press = async (value: "going" | "notGoing") => {
    if (busy || !myId) return;
    setBusy(true);
    try {
      // 같은 버튼을 다시 누르면 표시를 거둔다.
      onChanged(await api.attendSchedule(schedule.id, mine === value ? null : value));
    } catch {
      /* 조용히 실패 — 다음 목록 갱신 때 서버 값이 그대로 다시 온다. */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scr-schedule-attend">
      <div className="scr-schedule-attend-btns">
        <button
          type="button"
          className={cx("scr-schedule-attend-btn", mine === "going" && "scr-schedule-attend-btn-on")}
          onClick={() => void press("going")} disabled={busy || !myId}
        >
          <Check size={13} aria-hidden /> 참가
        </button>
        <button
          type="button"
          className={cx("scr-schedule-attend-btn", mine === "notGoing" && "scr-schedule-attend-btn-off")}
          onClick={() => void press("notGoing")} disabled={busy || !myId}
        >
          <X size={13} aria-hidden /> 불참
        </button>
      </div>
      {/* 손든 사람 — 프사를 늘어놓고 그 수만 적는다. 아무도 안 눌렀으면 줄 자체가 없다:
          "0명"을 적어 두면 아직 아무도 안 본 일정이 텅 빈 모임처럼 읽힌다. */}
      {going.length > 0 && (
        <div className="scr-schedule-attend-row">
          <span className="scr-schedule-attend-count">참가 {going.length}</span>
          <div className="scr-schedule-attend-faces">
            {going.map((a) => (
              <span className="scr-schedule-attend-face" key={a.memberId} title={a.nickname}>
                <Avatar member={memberOf(a.memberId)} size={24} />
              </span>
            ))}
          </div>
        </div>
      )}
      {notGoing.length > 0 && (
        <div className="scr-schedule-attend-row scr-schedule-attend-row-off">
          <span className="scr-schedule-attend-count">불참 {notGoing.length}</span>
          <div className="scr-schedule-attend-faces">
            {notGoing.map((a) => (
              <span className="scr-schedule-attend-face" key={a.memberId} title={a.nickname}>
                <Avatar member={memberOf(a.memberId)} size={24} />
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 모임 일정 카드 — 등록 모달과 같은 것을 같은 차례로, 다만 칸이 아니라 글로 보여준다
 *  (요청: "등록/수정에 쓰는 모달과 비슷한 구조인데 텍스트 형식으로 보여준다 생각하면 될듯").
 *
 *  그래서 배치를 따로 궁리하지 않았다. 제목 → 일시 → 내용 → 링크 → 첨부 → 참가표시 →
 *  댓글, 폼에 적은 순서 그대로다. 안 적은 칸은 통째로 사라진다 — 빈 라벨만 남으면 카드가
 *  "안 채운 폼"처럼 보인다. */
export default function ScheduleCard({
  schedule, timeText, dateLabel, myId, canEdit, onEdit, onChanged, onDeleted, footer,
}: {
  schedule: Schedule;
  timeText?: React.ReactNode;
  dateLabel?: string;
  myId: string | undefined;
  canEdit: boolean;
  onEdit: () => void;
  onChanged: (s: Schedule) => void;
  onDeleted: (id: number) => void;
  footer?: React.ReactNode;
}) {
  return (
    <ActivityCard
      dateLabel={dateLabel}
      icon={<CalendarDays size={16} aria-hidden />}
      label="일정"
      timeText={timeText}
      actions={
        <ScheduleActionsMenu
          schedule={schedule} canEdit={canEdit} onEdit={onEdit} onDeleted={onDeleted}
        />
      }
      comment={footer}
    >
      <div className="scr-schedule-card">
        <h3 className="scr-schedule-title">{schedule.title}</h3>
        <div className="scr-schedule-when-line">{whenText(schedule)}</div>

        {schedule.content && <p className="scr-schedule-content">{schedule.content}</p>}

        {schedule.linkUrl && (
          <a
            className="scr-schedule-link"
            href={schedule.linkUrl} target="_blank" rel="noreferrer noopener"
          >
            <ExternalLink size={13} aria-hidden />
            <span className="scr-schedule-link-text">{schedule.linkUrl}</span>
          </a>
        )}

        {schedule.files.length > 0 && (
          <ul className="scr-schedule-files">
            {schedule.files.map((f) => (
              <li key={f.url}>
                {/* download를 붙여도 다른 출처(파일 서버)면 브라우저가 무시하고 그냥 연다 —
                    그래도 붙여 두면 같은 출처로 옮겼을 때 이름이 살아난다. */}
                <a className="scr-schedule-file-link" href={f.url} download={f.name} target="_blank" rel="noreferrer noopener">
                  <Paperclip size={13} aria-hidden />
                  <span className="scr-schedule-file-link-name">{f.name}</span>
                  <span className="scr-schedule-file-size">{formatBytes(f.size)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}

        <ScheduleAttend schedule={schedule} myId={myId} onChanged={onChanged} />

        {/* 올린 사람 — 맨 아래 한 줄이다. 누가 올렸나는 무엇을 언제 하는지보다 나중에
            읽히는 정보라, 위로 올리면 제목과 일시 사이를 가로막는다. */}
        <div className="scr-schedule-by">— {schedule.createdBy.nickname}</div>
      </div>
    </ActivityCard>
  );
}
