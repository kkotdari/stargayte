import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ClipboardList } from "lucide-react";
import { Spinner } from "./Feedback";
import ConfirmDialog from "./ConfirmDialog";
import ReplayReviewModal from "../../modals/ReplayReviewModal";
import { useAppStore } from "../../store/appStore";
import { cx } from "../../utils/format";
import { buildReplayDrafts, hasComputerSlot, resolveUnmatchedAsUnregistered, validateReplayDraft } from "../../utils/replayDraft";
import type { ReplayDraft } from "../../utils/replayDraft";
import type { MatchResult, NewMatch } from "../../types";

// 한 번에 분석·등록하는 파일 묶음 크기 — 리플레이 하나당 첨부파일을 통째로 data URL로
// 들고 있어서(등록 payload에 그대로 실려 간다), 폴더에 수백 개가 있으면 전부 한꺼번에
// 만들다가 메모리가 터진다. 묶음 단위로 만들고 등록하고 버린다. 중복확인 API가 한 번에
// 받는 최대 개수(50)보다 작아야 한다는 제약도 이 값이 함께 만족시킨다.
const CHUNK_SIZE = 10;

// 배치가 자동으로 처리하지 못한 리플레이를 나중에 검토 화면으로 넘기려면 그 드래프트(첨부
// data URL 포함)를 계속 들고 있어야 한다 — 수백 개가 실패하는 상황에서 전부 붙잡고 있으면
// 메모리가 터지므로 앞쪽 일부만 남긴다(검토 화면도 그만큼을 한 번에 넘겨보는 용도다).
const MAX_MANUAL_DRAFTS = 20;

// 이 배치가 등록 대상으로 삼을 경기 종류 — 폴더엔 1:1과 팀전이 섞여 있어서, 무엇을 담글지
// 먼저 고르게 한다.
type BatchMode = "solo" | "team" | "all";

const MODE_OPTIONS: { value: BatchMode; label: string }[] = [
  { value: "solo", label: "일대일만" },
  { value: "team", label: "팀전만" },
  { value: "all", label: "전체" },
];

// 파일 하나가 어떻게 처리됐는지 — 등록됐든 걸러졌든 실패했든 전부 남겨서 목록으로 보여준다.
// "왜 몇 개밖에 안 등록됐지?"에 답하려면 등록된 것만 세서는 알 수 없다.
type Outcome = "registered" | "duplicate" | "skipped" | "failed";

interface FileResult {
  fileName: string;
  outcome: Outcome;
  // 걸러지거나 실패한 이유 — 등록된 파일은 비어 있다.
  reason: string;
  // 리플레이 실제 시작 일시(가능하면 분 단위까지) — 분석 자체가 실패한 파일은 "-".
  when: string;
  // "몇 대 몇"으로 잡혔는지(관전자 등 미매칭 인원 포함) — 분석 실패 시 "-".
  teamSize: string;
  // 조작량이 적어 관전자로 의심되는 사람이 있었는지.
  suspected: boolean;
}

const OUTCOME_LABEL: Record<Outcome, string> = {
  registered: "등록", duplicate: "중복", skipped: "제외", failed: "실패",
};

interface BatchProgress {
  total: number;
  results: FileResult[];
}

const EMPTY_PROGRESS: BatchProgress = { total: 0, results: [] };

function countOf(results: FileResult[], outcome: Outcome): number {
  return results.filter((r) => r.outcome === outcome).length;
}

// "MM.DD HH:MM" — 로그 한 줄에 넣기엔 ISO 문자열이 너무 길어서 압축한다. 분석 자체가
// 실패해 실제 시작 시각을 모르면(gameStartedAt null) 리플레이 날짜(date)만이라도 보여준다.
function formatWhen(gameStartedAt: string | null, date: string): string {
  if (!gameStartedAt) return date || "-";
  const d = new Date(gameStartedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 로그 한 줄에 필요한 부가 정보 — 분석 자체가 실패한 드래프트(parseError)는 팀 구성을
// 알 수 없으니 "-"로 둔다.
function draftMeta(d: ReplayDraft): { when: string; teamSize: string; suspected: boolean } {
  if (d.parseError) return { when: "-", teamSize: "-", suspected: false };
  return {
    when: formatWhen(d.gameStartedAt, d.date),
    teamSize: `${d.team1.length + d.unmatchedTeam1.length}:${d.team2.length + d.unmatchedTeam2.length}`,
    suspected: d.guessedObservers.length > 0,
  };
}

// 숨겨진 제어판의 운영자 전용 버튼 — 누르면 무엇을 등록할지(일대일만/팀전만/전체) 고르는
// 선택지가 펼쳐지고, 하나를 고르면 바로 폴더 선택창이 뜬다. 고른 폴더의 하위(재귀) 전체에서
// 리플레이(.rep)를 찾아 조건에 맞는 경기만 자동으로 등록한다.
//
// 리플레이를 사람이 훑어보는 검토 화면(ReplayReviewModal)과 달리 여기서는 사람이 개입하지 않는다:
// 배틀태그로 회원을 못 찾은 선수는 전부 "비회원" 슬롯으로 채워 넣고(나중에 유저 매핑
// 관리 화면에서 실제 회원으로 연결하면 된다), 이미 등록된 경기는 건너뛴다. 승패도 리플레이가
// 판별한 값을 그대로 쓰되, 판별하지 못한 경기는 조용히 틀린 기록을 남기느니 실패로 남기고
// 넘어간다(그 경기만 검토 화면에서 직접 등록하면 된다).
export default function ReplayBatchButton() {
  const members = useAppStore((s) => s.members);
  const addMatch = useAppStore((s) => s.addMatch);

  const [progress, setProgress] = useState<BatchProgress>(EMPTY_PROGRESS);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [excludeComputer, setExcludeComputer] = useState(false);
  const [err, setErr] = useState("");
  // 폴더를 고른 직후 브라우저가 실제로 뭘 넘겨줬는지 — 진행이 아예 시작되지 않는 경우를
  // 구분하려면 이게 있어야 한다.
  const [pickedNote, setPickedNote] = useState("");
  // 배치가 처리하지 못한 리플레이들 — 끝난 뒤 검토 화면(ReplayReviewModal)으로 넘겨
  // 사람이 직접 승패/팀을 채워 등록한다. 묶음 단위로 통째로 던져진 실패는 드래프트 자체가
  // 없어서 여기 못 들어온다(파일을 다시 골라 돌리는 수밖에 없다).
  const [manualDrafts, setManualDrafts] = useState<ReplayDraft[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  // 진행률/로그를 제어판 모달 안에 그대로 쌓지 않고 별도의 창(모달)으로 띄운다(요청:
  // "배치 등록시 별도 창에 결과 나오게, 모달 내에 스크린 만들 필요 없이") — 로그가
  // 길어질수록 제어판 모달의 본문(.scr-admin-panel-modal .scr-modal-body)이 늘어나면서
  // 그 위에 겹치는 CSS 버그(translateY로 인한 닫기 버튼 클릭 안 됨)까지 있었어서, 아예
  // 분리하는 쪽이 근본적으로 더 안전하다. 배치가 시작되면 자동으로 뜨고, 닫아도(X) 배치
  // 자체는 계속 진행된다 — 다시 보고 싶으면 트리거 버튼 옆에 뜨는 "결과 보기"로 재오픈.
  const [resultsOpen, setResultsOpen] = useState(false);
  // 폴더를 고른 뒤 실제 등록 실행 전 확인창 대상 — 확인 전까지는 실행하지 않는다.
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);

  // 중단 요청과 고른 옵션들은 렌더와 무관하게 실행 중인 루프가 즉시 읽어야 해서 ref로 둔다.
  const abortRef = useRef(false);
  const modeRef = useRef<BatchMode>("solo");
  const excludeComputerRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // 데스크톱은 <input webkitdirectory>로 폴더 하위 전체를 재귀적으로 훑고(폴더 순회 구현
  // 불필요), 모바일은 폴더 선택 자체가 없어 .rep 파일 여러 개를 직접 고르게 한다(요청:
  // 모바일에서도 배치등록 오픈). 어느 모드든 아래 runBatch가 .rep만 걸러 처리하므로 동일하게
  // 동작한다. React가 모르는 표준 밖 속성(webkitdirectory)이라 ref로 직접 심는다.
  const setDirInput = (el: HTMLInputElement | null) => {
    inputRef.current = el;
  };
  // 폴더 선택창을 열기 직전, 지금이 모바일인지(폴더 선택 불가)에 따라 input 속성을 맞춘다.
  const openPicker = () => {
    const el = inputRef.current;
    if (!el) return;
    const mobile = window.matchMedia("(max-width: 480px)").matches;
    if (mobile) {
      el.removeAttribute("webkitdirectory");
      el.removeAttribute("directory");
      el.setAttribute("accept", ".rep,application/octet-stream");
    } else {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
      el.removeAttribute("accept");
    }
    el.click();
  };

  const results = progress.results;
  // 새 줄이 찍힐 때마다 로그 끝(가장 최근 줄)이 보이게 따라 내린다 — 터미널 로그처럼.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [results.length]);

  const start = (mode: BatchMode) => {
    modeRef.current = mode;
    excludeComputerRef.current = excludeComputer;
    setMenuOpen(false);
    openPicker();
  };

  // 폴더 선택까지만 처리하고, 실제 등록 실행은 확인창을 거친 뒤(executeBatch)에만
  // 시작한다 — 관리자 기능은 전부 실행 전 확인이 있어야 한다(요청: "관리자 버튼들은
  // 다 컨펌창 있어야돼(단순 조회는 제외)"). 이 배치는 경기 기록을 실제로 만드는
  // 쓰기 작업이라 대상이다.
  const runBatch = (fileList: FileList | null) => {
    // input.files는 살아있는(live) FileList라, 값을 비우면 이미 잡아둔 이 참조의 내용까지
    // 같이 비워질 수 있다 — 반드시 배열로 먼저 복사해두고 그다음에 input을 비운다(같은
    // 폴더를 다시 골랐을 때도 change가 뜨게 하려면 비워둬야 한다).
    const picked = fileList ? [...fileList] : [];
    if (inputRef.current) inputRef.current.value = "";

    const files = picked.filter((f) => f.name.toLowerCase().endsWith(".rep"));
    // 폴더를 골랐는데 아무 일도 안 일어나면 어디서 막혔는지 알 수가 없다 — 브라우저가 넘겨준
    // 파일 수와 그중 리플레이 수를 항상 먼저 남긴다.
    setPickedNote(`파일 ${picked.length}개 · 리플레이(.rep) ${files.length}개를 찾았어요.`);
    if (files.length === 0) {
      setStarted(true);
      setErr(picked.length === 0
        ? "브라우저가 폴더 안의 파일을 넘겨주지 않았어요 (선택을 취소했거나 빈 폴더예요)."
        : "고른 폴더 안에 리플레이(.rep) 파일이 없어요.");
      setProgress(EMPTY_PROGRESS);
      return;
    }
    setPendingFiles(files);
  };

  const executeBatch = async (files: File[]) => {
    setPendingFiles(null);
    setStarted(true);
    setResultsOpen(true);

    const mode = modeRef.current;
    abortRef.current = false;
    setErr("");
    setRunning(true);
    setProgress({ total: files.length, results: [] });
    setManualDrafts([]);

    const record = (
      fileName: string, outcome: Outcome, reason = "",
      meta: { when: string; teamSize: string; suspected: boolean } = { when: "-", teamSize: "-", suspected: false },
    ) => {
      setProgress((p) => ({ ...p, results: [...p.results, { fileName, outcome, reason, ...meta }] }));
    };
    // 실패한 리플레이는 검토 화면으로 넘길 수 있게 드래프트를 붙잡아둔다.
    const fail = (draft: ReplayDraft, reason: string) => {
      record(draft.fileName, "failed", reason, draftMeta(draft));
      setManualDrafts((prev) => (prev.length >= MAX_MANUAL_DRAFTS ? prev : [...prev, draft]));
    };

    try {
      for (let start = 0; start < files.length; start += CHUNK_SIZE) {
        if (abortRef.current) break;
        const chunk = files.slice(start, start + CHUNK_SIZE);

        // buildReplayDrafts가 파싱 + 알려진 이름 자동분류 + 중복확인까지 한 번에 해준다
        // (리플레이 검토 모달이 쓰는 것과 완전히 같은 경로 — 여기서 다시 구현하지 않는다).
        // 중복확인은 서버 왕복이라 한 번 실패하면 그 묶음 전체가 통째로 던져진다 — 예전엔
        // 그게 배치 전체를 멈춰버려서, 초반 몇 개만 등록되고 조용히 끝났다. 묶음 단위로
        // 붙잡아서 그 파일들만 실패로 남기고 다음 묶음을 계속 간다.
        let drafts;
        try {
          drafts = await buildReplayDrafts(chunk, members);
        } catch (e) {
          const reason = e instanceof Error ? e.message : "리플레이를 분석하지 못했어요.";
          chunk.forEach((f) => record(f.name, "failed", reason));
          continue;
        }

        for (const draft of drafts) {
          if (abortRef.current) break;

          if (draft.parseError) { fail(draft, draft.parseError); continue; }
          if (draft.excludeReason === "duplicate") {
            record(draft.fileName, "duplicate", "이미 등록된 경기예요.", draftMeta(draft));
            continue;
          }

          // 컴퓨터(AI)가 한 자리라도 낀 경기는 클럽 전적으로 치기 애매해서 통째로 뺀다.
          if (excludeComputerRef.current && hasComputerSlot(draft)) {
            record(draft.fileName, "skipped", "컴퓨터가 낀 경기예요.", draftMeta(draft));
            continue;
          }

          const isSolo = draft.matchType === "0101";
          if ((mode === "solo" && !isSolo) || (mode === "team" && isSolo)) {
            // 몇 대 몇으로 잡혔는지는 로그 줄의 별도 칸(teamSize)에 이미 나오므로 사유
            // 문구에는 굳이 다시 안 넣는다.
            record(draft.fileName, "skipped", "이번 대상이 아니에요.", draftMeta(draft));
            continue;
          }
          if (draft.winnerSide === null) {
            fail(draft, "승자를 판별하지 못했어요 — 직접 등록해 주세요.");
            continue;
          }
          // 일부 UMS 맵은 관전 슬롯이 섞이면 screp이 팀을 아예 못 나눈다 — team1에 전원이
          // 몰리고 team2가 비어있는 상태이므로 자동 등록하지 않고 사람이 직접 편을 가르게 한다.
          if (draft.teamSplitUncertain) {
            fail(draft, "팀을 자동으로 나누지 못했어요(맵 자체의 한계) — 직접 편을 갈라 등록해 주세요.");
            continue;
          }
          // 조작량이 적어 관전자로 의심되는 사람이 있는 경기 — 초반에 나간 실제 참가자일
          // 수도 있으니(로스터에는 그대로 남아있다) 자동 등록하지 않고 사람 눈을 반드시
          // 한 번 거치게 한다.
          if (draft.guessedObservers.length > 0) {
            fail(draft, `관전자로 의심되는 사람이 있어요 (${draft.guessedObservers.join(", ")}) — 확인이 필요해요.`);
            continue;
          }

          const filled = resolveUnmatchedAsUnregistered(draft);
          const problem = validateReplayDraft(filled);
          if (problem) { fail(draft, problem); continue; }

          const payload: NewMatch = {
            // winnerSide가 null인 드래프트는 위에서 이미 실패로 걸렀으므로 승패는 항상 채워져 있다.
            date: filled.date, team1: filled.team1, team2: filled.team2, result: filled.result as MatchResult,
            matchType: filled.matchType, replay: filled.replay,
            mapName: filled.mapName || null, gameStartedAt: filled.gameStartedAt,
            durationSeconds: filled.durationSeconds,
          };
          try {
            await addMatch(payload);
            record(filled.fileName, "registered", "", draftMeta(filled));
          } catch (e) {
            fail(draft, e instanceof Error ? e.message : "등록에 실패했어요.");
          }
        }
      }
    } catch (e) {
      // 여기까지 올라오는 건 위에서 안 잡은 예상 밖의 예외뿐이다 — 그냥 두면 배치가 아무
      // 메시지도 없이 조용히 끝나버려 무슨 일이 있었는지 알 길이 없다.
      setErr(e instanceof Error ? `배치가 중단됐어요: ${e.message}` : "배치가 예기치 않게 중단됐어요.");
    } finally {
      setRunning(false);
    }
  };

  const { total } = progress;
  const processed = results.length;
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
  const finished = started && !running && total > 0;

  return (
    <div className="scr-admin-panel-batch">
      <input
        ref={setDirInput}
        type="file"
        multiple
        hidden
        onChange={(e) => runBatch(e.target.files)}
      />
      <button
        type="button"
        className="scr-admin-panel-phys-btn"
        onClick={() => (running ? (abortRef.current = true) : setMenuOpen((v) => !v))}
      >
        {running ? <><Spinner /> 중단</> : "배치등록"}
      </button>

      {/* 무엇을 담글지 먼저 고른다 — 대상 버튼을 고르는 즉시 폴더 선택창이 뜨므로, 함께 걸
          옵션(컴퓨터 제외)은 반드시 그 버튼들보다 위에 있어야 한다. */}
      {menuOpen && !running && (
        <div className="scr-admin-panel-batch-menu">
          <label className="scr-checkbox-field scr-admin-panel-batch-option">
            <input
              type="checkbox"
              checked={excludeComputer}
              onChange={(e) => setExcludeComputer(e.target.checked)}
            />
            컴퓨터 낀 경기 제외
          </label>
          <div className="scr-admin-panel-batch-modes">
            {MODE_OPTIONS.map((o) => (
              <button key={o.value} type="button" className="scr-btn scr-admin-panel-batch-mode" onClick={() => start(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 진행이 아예 시작되지 않은 경우(리플레이를 하나도 못 찾음)에만 브라우저가 뭘 넘겨줬는지
          보여준다 — 정상 실행 중에는 결과 창의 카운터가 같은 정보를 더 자세히 담고 있어 중복이다. */}
      {pickedNote && total === 0 && <div className="scr-admin-panel-batch-counts">{pickedNote}</div>}

      {err && <div className="scr-err">{err}</div>}

      {/* 배치등록 버튼 바로 옆 칸을 항상 비워 예약해두고(그리드 셀 하나), 진행 중/완료됐는데
          결과 창을 닫아둔 경우에만 그 자리에 "결과 보기"를 렌더한다(요청) — 자리 자체는 늘
          있으므로 나타났다 사라져도 다른 버튼이 들썩이지 않는다. */}
      <div className="scr-admin-panel-results-slot">
        {started && total > 0 && !resultsOpen && (
          <button
            type="button"
            className="scr-admin-panel-results-reopen"
            onClick={() => setResultsOpen(true)}
          >
            <ClipboardList size={13} /> 결과 보기 ({processed}/{total})
          </button>
        )}
      </div>

      {/* 진행률/로그를 별도 창(모달)으로 — 제어판 모달 본문 안에 그대로 쌓지 않는다(요청:
          "배치 등록시 별도 창에 결과 나오게 해줘 모달 내에 스크린 만들필요 없이"). 배치가
          시작되면 자동으로 뜨고, X로 닫아도 배치 자체는 백그라운드에서 계속 진행된다. */}
      {resultsOpen && started && total > 0 && createPortal(
        <div className="scr-modal-overlay" onClick={() => setResultsOpen(false)}>
          <div className="scr-modal scr-modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="scr-modal-head">
              <span>배치 등록 결과</span>
              <button className="scr-icon-btn" onClick={() => setResultsOpen(false)} aria-label="닫기"><X size={14} /></button>
            </div>
            <div className="scr-modal-body scr-admin-panel-batch-modal-body">
              <div className="scr-rank-bar-track scr-admin-panel-batch-bar">
                <div className="scr-rank-bar-fill scr-rank-bar-fill-plays" style={{ width: `${percent}%` }} />
              </div>
              <div className="scr-mono scr-admin-panel-batch-counts">
                {processed}/{total} · 등록 {countOf(results, "registered")} · 중복 {countOf(results, "duplicate")}
                {" "}· 제외 {countOf(results, "skipped")} · 실패 {countOf(results, "failed")}
              </div>

              {/* 배치가 자동으로 처리하지 못한 것들(승자 미판별, 종족 미인식 등)은 사람이 직접
                  채워야 한다 — 다 끝난 뒤 그 리플레이만 모아 검토 화면으로 넘긴다. */}
              {finished && manualDrafts.length > 0 && (
                <button type="button" className="scr-btn scr-admin-panel-batch-review" onClick={() => setReviewOpen(true)}>
                  실패한 {manualDrafts.length}개 직접 등록
                </button>
              )}

              {/* 진짜 터미널 로그처럼 — 꾸밈 없이 코딩폰트로 한 줄에 한 파일씩, 상태/일시/몇 대
                  몇인지/관전자 의심 여부/파일명/사유를 나란히 보여준다. */}
              {results.length > 0 && (
                <div className="scr-admin-panel-batch-log" ref={logRef}>
                  {results.map((r, i) => (
                    <div key={`${r.fileName}-${i}`} className={cx("scr-admin-panel-batch-log-line", `scr-admin-panel-batch-log-line-${r.outcome}`)}>
                      <span className="scr-admin-panel-batch-log-tag">{OUTCOME_LABEL[r.outcome]}</span>
                      <span className="scr-admin-panel-batch-log-when">{r.when}</span>
                      <span className="scr-admin-panel-batch-log-size">{r.teamSize}</span>
                      <span className="scr-admin-panel-batch-log-flag">{r.suspected ? "관전자?" : ""}</span>
                      <span className="scr-admin-panel-batch-log-name">{r.fileName}</span>
                      {r.reason && <span className="scr-admin-panel-batch-log-reason">{r.reason}</span>}
                    </div>
                  ))}
                  {finished && (
                    <div className="scr-admin-panel-batch-log-end">
                      {processed < total ? `-- 중단됨 (${total - processed}개 남음) --` : "-- 배치 등록 완료 --"}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {pendingFiles && (
        <ConfirmDialog
          title={`리플레이 ${pendingFiles.length}개를 분석해 자동 등록할까요?`}
          message="분석 결과에 따라 경기 기록이 실제로 만들어집니다."
          confirmLabel="등록 시작"
          onConfirm={() => void executeBatch(pendingFiles)}
          onCancel={() => setPendingFiles(null)}
        />
      )}

      {reviewOpen && (
        <ReplayReviewModal
          drafts={manualDrafts}
          truncated={countOf(results, "failed") > manualDrafts.length}
          onClose={() => setReviewOpen(false)}
          onSaved={() => setReviewOpen(false)}
          // 검토 화면에서 하나씩 등록될 때마다 로그의 그 줄을 "실패"에서 "등록"으로 고쳐 찍는다 —
          // 안 그러면 다 처리하고 나서도 로그엔 여전히 실패로 남아 무엇이 남았는지 알 수 없다.
          // 같은 파일명이 여러 폴더에 있을 수 있어 아직 실패로 남은 첫 줄 하나만 바꾼다.
          onRegistered={(fileName) => {
            setProgress((p) => {
              const idx = p.results.findIndex((r) => r.fileName === fileName && r.outcome === "failed");
              if (idx === -1) return p;
              const next = [...p.results];
              next[idx] = { ...next[idx], outcome: "registered", reason: "" };
              return { ...p, results: next };
            });
            setManualDrafts((prev) => prev.filter((d) => d.fileName !== fileName));
          }}
        />
      )}
    </div>
  );
}
