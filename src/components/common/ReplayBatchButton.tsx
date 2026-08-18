import { useRef, useState } from "react";
import { Spinner } from "./Feedback";
import ConfirmDialog from "./ConfirmDialog";
import ReplayReviewModal from "../../modals/ReplayReviewModal";
import { useAppStore } from "../../store/appStore";
import { buildReplayDrafts } from "../../utils/replayDraft";
import type { ReplayDraft } from "../../utils/replayDraft";

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
  failed: number;
}

const EMPTY_TALLY: BatchTally = { total: 0, done: 0, registered: 0, duplicate: 0, failed: 0 };

// 제어판의 운영자 전용 버튼 — 누르면 바로 폴더 선택창이 뜨고, 고른 폴더의 하위(재귀)
// 전체에서 리플레이(.rep)를 찾아 자동으로 등록한다(요청: 버튼 하나로).
//
// 리플레이를 사람이 훑어보는 검토 화면(ReplayReviewModal)과 달리 여기서는 사람이 개입하지 않는다:
// 이 버튼은 '읽어 오기'까지만 한다(요청) — 고른 파일을 전부 분석해 검토창으로 넘기고,
// 무엇을 등록할지는 거기서 정한다. 예전에는 깨끗한 것만 여기서 조용히 등록되고 나머지만
// 검토창으로 넘어가, 방금 무엇이 들어갔는지 사람이 볼 방법이 없었다.
export default function ReplayBatchButton() {
  const members = useAppStore((s) => s.members);

  const [tally, setTally] = useState<BatchTally>(EMPTY_TALLY);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");
  // 폴더를 고른 직후 브라우저가 실제로 뭘 넘겨줬는지 — 진행이 아예 시작되지 않는 경우를
  // 구분하려면 이게 있어야 한다.
  const [pickedNote, setPickedNote] = useState("");
  // 배치가 처리하지 못한 리플레이들 — 끝난 뒤 검토 화면(ReplayReviewModal)으로 넘겨
  // 사람이 직접 승패/팀을 채워 등록한다. 묶음 단위로 통째로 던져진 실패는 드래프트 자체가
  // 없어서 여기 못 들어온다(파일을 다시 골라 돌리는 수밖에 없다).
  const [manualDrafts, setManualDrafts] = useState<ReplayDraft[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);

  // 중단 요청은 렌더와 무관하게 실행 중인 루프가 즉시 읽어야 해서 ref로 둔다.
  const abortRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /* 방금 연 선택창이 '폴더' 모드였나 — input의 webkitdirectory 속성을 갈아 끼우므로
     어느 모드로 열었는지 기억해 둔다. 이제 고른 즉시 등록이 시작되지 않고 담기기만
     하므로(아래 addFiles), 확인창은 '등록 시작'을 누를 때 한 번만 선다. */
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
  /* 파일이든 폴더든 고를 수 있게 한다(요청: "배치등록은 파일/폴더 선택 가능하게 해주고
     폴더 선택시 하위폴더 모두 포함은 그대로. 파일과 폴더 동시 선택도 가능").

     브라우저의 파일 선택창은 둘을 한 번에 못 고른다 — <input webkitdirectory>는 폴더만,
     그냥 <input multiple>은 파일만이다. 표준이 그렇게 갈라져 있다. 그래서 셋을 함께 둔다.
       ① 파일 고르기 — .rep 여러 개
       ② 폴더 고르기 — 하위 폴더까지 재귀(webkitdirectory가 원래 그렇게 준다)
       ③ 끌어다 놓기 — **파일과 폴더를 섞어서** 한 번에. 이것만이 동시 선택을 할 수 있다.
     그리고 고른 것을 바로 돌리지 않고 쌓아 둔다 — 파일을 고르고 폴더를 또 고르면 합쳐진다.
     그래야 창을 여러 번 열어서라도 섞을 수 있다. */
  const openPicker = (mode: "file" | "dir") => {
    const el = inputRef.current;
    if (!el) return;
    dirModeRef.current = mode === "dir";
    if (mode === "dir") {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
      el.removeAttribute("accept");
    } else {
      el.removeAttribute("webkitdirectory");
      el.removeAttribute("directory");
      el.setAttribute("accept", ".rep,application/octet-stream");
    }
    el.click();
  };

  /* 끌어다 놓기는 걷었다(요청: "끌어다 놓기는 제거") — 파일·폴더를 섞어 넣는
     유일한 길이었지만, 화면에서 큰 자리를 차지하면서 실제로는 버튼 두 개(파일 고르기·
     폴더 고르기)로 다 되는 일이었다. 재귀 훑기(readEntry)와 드롭 처리도 함께 지운다. */

  // 폴더를 고르면 바로 시작한다 — 브라우저가 폴더 업로드를 물어보는 창이 이미 앞에 있어서
  // 우리 확인창까지 세우면 확인이 두 번이 된다(지적). 다만 그 창은 폴더 업로드에만 뜨는
  // 것이라, 파일을 직접 고르는 모바일에서는 아무 확인 없이 등록이 시작됐다(지적) —
  // 그쪽에서만 우리 확인창을 한 번 세운다.
  /* 고른 것을 바로 돌리지 않고 담아 둔다 — 파일을 고르고 폴더를 또 고르면 합쳐진다.
     같은 파일을 두 번 고르면 한 번만 센다(이름+크기+수정시각으로 가른다). */
  const [staged, setStaged] = useState<File[]>([]);
  const addFiles = (incoming: File[]) => {
    const reps = incoming.filter((f) => f.name.toLowerCase().endsWith(".rep"));
    setErr("");
    if (reps.length === 0) {
      setPickedNote(`파일 ${incoming.length}개를 봤지만 리플레이(.rep)가 없어요.`);
      return;
    }
    setStaged((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}|${f.size}|${f.lastModified}`));
      const merged = [...prev];
      for (const f of reps) {
        const k = `${f.name}|${f.size}|${f.lastModified}`;
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(f);
      }
      setPickedNote(`리플레이(.rep) ${merged.length}개 담김 — 더 고르거나 '등록 시작'을 누르세요.`);
      return merged;
    });
  };

  const runBatch = (fileList: FileList | null) => {
    // input.files는 살아있는(live) FileList라, 값을 비우면 이미 잡아둔 이 참조의 내용까지
    // 같이 비워질 수 있다 — 반드시 배열로 먼저 복사해두고 그다음에 input을 비운다(같은
    // 폴더를 다시 골랐을 때도 change가 뜨게 하려면 비워둬야 한다).
    const picked = fileList ? [...fileList] : [];
    if (inputRef.current) inputRef.current.value = "";
    if (picked.length === 0) {
      setPickedNote("고른 것이 없어요 (선택을 취소했거나 빈 폴더예요).");
      return;
    }
    addFiles(picked);
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
    const record = (outcome: "registered" | "duplicate" | "failed") => {
      done.done += 1;
      done[outcome] += 1;
      setTally({ ...done });
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

        /* 등록은 여기서 하지 않는다(요청: 검토창에서 모든 리플레이를 목록으로 보고,
           손볼 것이 남아 있으면 등록 불가) — 배치는 '읽어 오기'까지만 하고, 무엇을 등록할지는
           검토창 한 곳에서 정한다. 예전에는 깨끗한 것만 조용히 등록되고 나머지만 검토창으로
           넘어와, 방금 무엇이 들어갔는지 사람이 볼 방법이 없었다. */
        for (const draft of drafts) {
          if (abortRef.current) break;
          record(draft.parseError ? "failed"
            : draft.excludeReason === "duplicate" ? "duplicate" : "registered");
          setManualDrafts((prev) => (prev.length >= MAX_MANUAL_DRAFTS ? prev : [...prev, draft]));
        }
      }
      /* 중단했을 때만 알린다 — 끝까지 다 읽었으면 바로 검토창이 열리므로, 그 앞에 알림을
         한 겹 더 세우면 같은 말을 두 번 하는 셈이다. */
      const left = done.total - done.done;
      if (left > 0) window.alert(`배치를 중단했어요 (${left}개 남음).`);
      /* 다 읽었으면 곧바로 검토창을 연다 — 이 버튼은 이제 '읽어 오기'까지만 하므로,
         읽고 나서 아무것도 안 열리면 방금 한 일이 어디로 갔는지 알 수 없다. */
      setReviewOpen(true);
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
          <>
            <button type="button" className="scr-btn scr-btn-primary" onClick={() => openPicker("file")}>
              파일 고르기
            </button>
            <button type="button" className="scr-btn scr-btn-primary" onClick={() => openPicker("dir")}>
              폴더 고르기
            </button>
            {staged.length > 0 && (
              <>
                <button
                  type="button" className="scr-btn scr-btn-primary"
                  onClick={() => { setPendingFiles(staged); }}
                >
                  등록 시작 ({staged.length})
                </button>
                <button
                  type="button" className="scr-btn"
                  onClick={() => { setStaged([]); setPickedNote(""); }}
                >
                  비우기
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* 진행이 아예 시작되지 않은 경우(리플레이를 하나도 못 찾음)에만 브라우저가 뭘 넘겨줬는지
          보여준다 — 돌기 시작하면 버튼 안의 숫자가 그 자리를 대신한다. */}
      {pickedNote && tally.total === 0 && <div className="scr-admin-panel-batch-counts">{pickedNote}</div>}

      {err && <div className="scr-err">{err}</div>}

      {/* 검토창을 닫았다가 다시 열 수 있는 입구 — 읽어 온 것은 그대로 들고 있으므로
          파일을 다시 고를 필요가 없다. */}
      {pendingReview && (
        <button
          type="button"
          className="scr-btn scr-btn-primary scr-admin-panel-batch-review"
          onClick={() => setReviewOpen(true)}
        >
          읽어 온 {manualDrafts.length}개 다시 열기
        </button>
      )}

      {pendingFiles && (
        <ConfirmDialog
          title={`리플레이 ${pendingFiles.length}개를 읽어 올까요?`}
          message="고른 리플레이를 하나씩 분석해 검토창에 늘어놓습니다. 등록할지 뺄지는 그 창에서 정합니다."
          confirmLabel="읽어 오기"
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
