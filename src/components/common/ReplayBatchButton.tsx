import { useRef, useState } from "react";
import { Spinner } from "./Feedback";
import ConfirmDialog from "./ConfirmDialog";
import ReplayReviewModal from "../../modals/ReplayReviewModal";
import { useAppStore } from "../../store/appStore";
import { buildReplayDrafts, hasComputerSlot, resolveUnmatchedAsUnregistered, shortMatchHint, validateReplayDraft } from "../../utils/replayDraft";
import type { ReplayDraft } from "../../utils/replayDraft";
import type { GameOutcome, NewGameResult } from "../../types";

// 한 번에 분석·등록하는 파일 묶음 크기 — 리플레이 하나당 첨부파일을 통째로 data URL로
// 들고 있어서(등록 payload에 그대로 실려 간다), 폴더에 수백 개가 있으면 전부 한꺼번에
// 만들다가 메모리가 터진다. 묶음 단위로 만들고 등록하고 버린다.
//
// 상한은 중복확인 API가 한 번에 받는 개수다 — 서버 스키마가 gameStartedAt 목록을
// max_length=50으로 못 박고 있어서(matches/schemas.py의 DuplicateCheckRequest) 이보다
// 크면 그 요청이 422로 떨어진다. 그래서 딱 그 값까지만 쓴다.
//
// 메모리는 이 크기에서 문제가 안 된다: .rep 한 개가 대체로 100~200KB이고 data URL로
// 1.33배가 되니 50개라도 10MB 남짓이다.
const CHUNK_SIZE = 50;

// 배치가 자동으로 처리하지 못한 리플레이를 나중에 검토 화면으로 넘기려면 그 드래프트(첨부
// data URL 포함)를 계속 들고 있어야 한다 — 수백 개가 실패하는 상황에서 전부 붙잡고 있으면
// 메모리가 터지므로 앞쪽 일부만 남긴다(검토 화면도 그만큼을 한 번에 넘겨보는 용도다).
const MAX_MANUAL_DRAFTS = 20;

/* 한 번 돌린 결과 — 파일 한 줄씩 남기던 로그는 걷어냈다(요청: 배치등록도 결과창을 없애고
   경기 재분석처럼 진행 상황만 보여주기). 남길 것은 '몇 개를 어떻게 처리했나'뿐이라
   숫자만 센다. 무엇이 왜 실패했는지는 끝난 뒤 검토 화면이 그 리플레이째로 보여준다. */
interface BatchTally {
  total: number;
  done: number;
  registered: number;
  duplicate: number;
  skipped: number;
  failed: number;
}

const EMPTY_TALLY: BatchTally = { total: 0, done: 0, registered: 0, duplicate: 0, skipped: 0, failed: 0 };

// 제어판의 운영자 전용 버튼 — 누르면 바로 폴더 선택창이 뜨고, 고른 폴더의 하위(재귀)
// 전체에서 리플레이(.rep)를 찾아 자동으로 등록한다(요청: 버튼 하나로).
//
// 리플레이를 사람이 훑어보는 검토 화면(ReplayReviewModal)과 달리 여기서는 사람이 개입하지 않는다:
// 배틀태그로 회원을 못 찾은 선수는 전부 "비회원" 슬롯으로 채워 넣고(나중에 유저 매핑
// 관리 화면에서 실제 회원으로 연결하면 된다), 이미 등록된 경기는 건너뛴다. 승패도 리플레이가
// 판별한 값을 그대로 쓰되, 판별하지 못한 경기는 조용히 틀린 기록을 남기느니 실패로 남기고
// 넘어간다 — 그런 것들만 모아 끝난 뒤 검토 화면을 자동으로 연다.
export default function ReplayBatchButton() {
  const members = useAppStore((s) => s.members);
  const addGameResult = useAppStore((s) => s.addGameResult);

  const [tally, setTally] = useState<BatchTally>(EMPTY_TALLY);
  const [running, setRunning] = useState(false);
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

  // 중단 요청과 고른 옵션들은 렌더와 무관하게 실행 중인 루프가 즉시 읽어야 해서 ref로 둔다.
  const abortRef = useRef(false);
  const excludeComputerRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // 방금 연 선택창이 '폴더' 모드였나 — 폴더 업로드는 브라우저가 "N개 파일을 업로드합니다,
  // 이 사이트를 신뢰하는 경우에만…"을 스스로 물어본다. 파일 여러 개를 고르는 모바일에는
  // 그 확인이 없어서 고르는 즉시 등록이 시작됐다(지적) — 그때만 우리 확인창을 세운다.
  const dirModeRef = useRef(true);
  // 확인을 기다리는 파일들(모바일 전용). null이면 확인창이 닫혀 있다.
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);

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
    dirModeRef.current = !mobile;
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

  const start = () => {
    excludeComputerRef.current = excludeComputer;
    openPicker();
  };

  // 폴더를 고르면 바로 시작한다 — 브라우저가 폴더 업로드를 물어보는 창이 이미 앞에 있어서
  // 우리 확인창까지 세우면 확인이 두 번이 된다(지적). 다만 그 창은 폴더 업로드에만 뜨는
  // 것이라, 파일을 직접 고르는 모바일에서는 아무 확인 없이 등록이 시작됐다(지적) —
  // 그쪽에서만 우리 확인창을 한 번 세운다.
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
      setErr(picked.length === 0
        ? "브라우저가 폴더 안의 파일을 넘겨주지 않았어요 (선택을 취소했거나 빈 폴더예요)."
        : "고른 폴더 안에 리플레이(.rep) 파일이 없어요.");
      setTally(EMPTY_TALLY);
      return;
    }
    if (!dirModeRef.current) { setPendingFiles(files); return; }
    void executeBatch(files);
  };

  const executeBatch = async (files: File[]) => {
    abortRef.current = false;
    setErr("");
    setRunning(true);
    setTally({ ...EMPTY_TALLY, total: files.length });
    setManualDrafts([]);

    /* 진행 숫자는 버튼 안에서만 흐른다(요청) — 화면에 남기는 것은 '몇 개째인가'뿐이고,
       무엇을 어떻게 처리했는지는 끝난 뒤 한 번에 알린다. */
    const done: BatchTally = { ...EMPTY_TALLY, total: files.length };
    const record = (outcome: "registered" | "duplicate" | "skipped" | "failed") => {
      done.done += 1;
      done[outcome] += 1;
      setTally({ ...done });
    };
    // 실패한 리플레이는 검토 화면으로 넘길 수 있게 드래프트를 붙잡아둔다.
    const fail = (draft: ReplayDraft) => {
      record("failed");
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
        } catch {
          chunk.forEach(() => record("failed"));
          continue;
        }

        for (const draft of drafts) {
          if (abortRef.current) break;

          if (draft.parseError) { fail(draft); continue; }
          if (draft.excludeReason === "duplicate") { record("duplicate"); continue; }

          // 컴퓨터(AI)가 한 자리라도 낀 경기는 클럽 전적으로 치기 애매해서 통째로 뺀다.
          if (excludeComputerRef.current && hasComputerSlot(draft)) { record("skipped"); continue; }

          // 아래 넷은 전부 '사람이 봐야 하는' 경우다 — 승자를 못 가렸거나, 맵 한계로 팀이
          // 안 갈렸거나, 관전자로 의심되는 사람이 있거나, 2분도 안 되는 판이거나.
          // 조용히 틀린 기록을 남기지 않고 검토 화면으로 넘긴다.
          if (draft.winnerSide === null) { fail(draft); continue; }
          if (draft.teamSplitUncertain) { fail(draft); continue; }
          if (draft.guessedObservers.length > 0) { fail(draft); continue; }
          if (shortMatchHint(draft)) { fail(draft); continue; }

          const filled = resolveUnmatchedAsUnregistered(draft);
          if (validateReplayDraft(filled)) { fail(draft); continue; }

          const payload: NewGameResult = {
            // winnerSide가 null인 드래프트는 위에서 이미 실패로 걸렀으므로 승패는 항상 채워져 있다.
            date: filled.date, team1: filled.team1, team2: filled.team2, result: filled.result as GameOutcome,
            matchType: filled.matchType, replay: filled.replay,
            mapName: filled.mapName || null, gameStartedAt: filled.gameStartedAt,
            durationSeconds: filled.durationSeconds,
            summaryData: filled.summaryData,
            mapData: filled.mapGrid,
          };
          try {
            await addGameResult(payload);
            record("registered");
          } catch {
            fail(draft);
          }
        }
      }
      /* 끝나면 한 번에 알린다(요청: 경기 재분석처럼) — 도는 동안 로그를 지켜볼 필요가
         없어진 만큼, 무엇이 어떻게 됐는지는 여기서 한 줄로 말해야 한다. */
      const left = done.total - done.done;
      window.alert(
        `${left > 0 ? `배치를 중단했어요 (${left}개 남음).\n` : ""}`
        + `등록 ${done.registered} · 중복 ${done.duplicate} · 제외 ${done.skipped} · 실패 ${done.failed}`
        + `${done.failed > 0 ? "\n실패한 것은 이어서 직접 등록할 수 있어요." : ""}`,
      );
    } catch (e) {
      // 여기까지 올라오는 건 위에서 안 잡은 예상 밖의 예외뿐이다 — 그냥 두면 배치가 아무
      // 메시지도 없이 조용히 끝나버려 무슨 일이 있었는지 알 길이 없다.
      setErr(e instanceof Error ? `배치가 중단됐어요: ${e.message}` : "배치가 예기치 않게 중단됐어요.");
    } finally {
      setRunning(false);
    }
  };

  /* 자동으로 처리하지 못한 리플레이가 있으면 검토 화면을 이어서 연다 — 예전에는 결과
     창 안의 "실패한 N개 직접 등록" 버튼이 그 입구였는데, 그 창을 없앴으므로(요청) 알림을
     닫는 순간 바로 이어지게 한다. 붙잡아 둔 드래프트가 있을 때만이다. */
  const pendingReview = !running && manualDrafts.length > 0 && !reviewOpen;

  return (
    <div className="scr-admin-panel-batch">
      <input
        ref={setDirInput}
        type="file"
        multiple
        hidden
        onChange={(e) => runBatch(e.target.files)}
      />
      {/* 버튼 하나로 줄이고 켜고 끄는 스위치는 없앴다(요청). 누르면 바로 폴더(모바일은
          파일) 선택창이 뜨고, 고른 것 중 리플레이를 전부(일대일·팀전 가리지 않고)
          담근다. 도는 중에는 같은 자리에 진행 숫자가 흐르고, 누르면 중단이다(요청:
          경기 재분석처럼 진행 상황만 버튼 안에서). */}
      <div className="scr-admin-panel-batch-row">
        {running ? (
          <button
            type="button"
            className="scr-btn scr-btn-primary"
            onClick={() => { abortRef.current = true; }}
          >
            <Spinner /> {tally.done}/{tally.total} · 중단
          </button>
        ) : (
          <button type="button" className="scr-btn scr-btn-primary" onClick={start}>
            배치등록
          </button>
        )}
      </div>

      {/* 함께 걸 옵션 — 버튼을 누르는 즉시 선택창이 뜨므로 반드시 버튼보다 위에 보여야
          한다고 봤지만, 버튼이 하나로 줄어 줄 아래에 붙여도 먼저 눈에 들어온다. */}
      {!running && (
        <label className="scr-checkbox-field scr-admin-panel-batch-option">
          <input
            type="checkbox"
            checked={excludeComputer}
            onChange={(e) => setExcludeComputer(e.target.checked)}
          />
          컴퓨터 낀 경기 제외
        </label>
      )}

      {/* 진행이 아예 시작되지 않은 경우(리플레이를 하나도 못 찾음)에만 브라우저가 뭘 넘겨줬는지
          보여준다 — 돌기 시작하면 버튼 안의 숫자가 그 자리를 대신한다. */}
      {pickedNote && tally.total === 0 && <div className="scr-admin-panel-batch-counts">{pickedNote}</div>}

      {err && <div className="scr-err">{err}</div>}

      {/* 자동으로 처리하지 못한 것들(승자 미판별·팀 미분리·관전자 의심 등)은 사람이 직접
          채워야 한다 — 다 끝난 뒤 그 리플레이만 모아 이 버튼 하나로 넘어간다. */}
      {pendingReview && (
        <button
          type="button"
          className="scr-btn scr-btn-primary scr-admin-panel-batch-review"
          onClick={() => setReviewOpen(true)}
        >
          직접 등록할 {manualDrafts.length}개 열기
        </button>
      )}

      {pendingFiles && (
        <ConfirmDialog
          title={`리플레이 ${pendingFiles.length}개를 등록할까요?`}
          message="고른 리플레이를 하나씩 분석해 자동으로 등록합니다. 이미 등록된 경기는 건너뛰고, 자동으로 처리하지 못한 것은 끝난 뒤 직접 등록할 수 있어요."
          confirmLabel="등록"
          className="scr-admin-panel-batch-confirm"
          onConfirm={() => { const f = pendingFiles; setPendingFiles(null); void executeBatch(f); }}
          onCancel={() => setPendingFiles(null)}
        />
      )}

      {reviewOpen && (
        <ReplayReviewModal
          drafts={manualDrafts}
          truncated={tally.failed > manualDrafts.length}
          onClose={() => setReviewOpen(false)}
          onSaved={() => setReviewOpen(false)}
          // 등록된 것은 목록에서 지운다 — 남은 수가 곧 아직 손대야 할 수다.
          onRegistered={(fileName) => {
            setManualDrafts((prev) => prev.filter((d) => d.fileName !== fileName));
          }}
        />
      )}
    </div>
  );
}
