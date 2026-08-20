import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import Select from "../../components/common/Select";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import ReplayBatchButton from "../../components/common/ReplayBatchButton";
import VersionManageModal from "../../modals/VersionManageModal";
import { api } from "../../api/client";
import { parseReplayFile } from "../../utils/replayParser";
import { createSummaryPool, runLanes } from "../../utils/replaySummaryPool";
import { useAppStore } from "../../store/appStore";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import { cx } from "../../utils/format";
import { versionNumber } from "../../utils/appVersion";
import { playCreak } from "../../utils/sfx";

interface AdminPanelScreenProps {
  isAdmin: boolean;
}

// 실수로 눌러도 바로 전환되지 않도록 거는 최소한의 잠금 — 어떤 문구도 없이 숫자
// 비밀번호만 입력받는다(퀴즈 문구를 없애면서 뭘 묻는지 힌트조차 안 준다). 정답 자체는
// 코드에 두지 않고 서버(env_vars.admin_panel_password)에 물어봐서 맞는지만 확인한다 —
// 코드 배포 없이 DB에서 바로 비밀번호를 바꿀 수 있다.

// 운영 메뉴의 "제어판" 화면 — 모달이 아니라 정식 화면이다(요청). 들어오면 비밀번호부터
// 묻고, 통과해야 관리 기능이 보인다. 실제로 앱 버전을 바꾸는 등의 기능은 운영자만 쓸 수 있다
// (예전엔 회원용 "미리보기"가 있었지만 제거됐다).
export default function AdminPanelScreen({ isAdmin }: AdminPanelScreenProps) {
  // 제어판에 들어서는 순간 낡은 경첩이 삐걱이는 "끼익" 소리(요청). 마운트 때 한 번만.
  useEffect(() => { playCreak(); }, []);
  const appVersion = useAppStore((s) => s.appVersion);
  const appVersions = useAppStore((s) => s.appVersions);
  const setAppVersion = useAppStore((s) => s.setAppVersion);
  const noticeEnabled = useAppStore((s) => s.noticeEnabled);
  const setNoticeEnabled = useAppStore((s) => s.setNoticeEnabled);

  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // "버전 관리" 모달 — 버전 추가/삭제와 버전별 안내 내용 편집을 담는다.
  const [versionManageOpen, setVersionManageOpen] = useState(false);
  const [togglingNotice, setTogglingNotice] = useState(false);
  const [downloading, setDownloading] = useState(false);
  /* 경기 재분석 — 이미 등록된 경기의 리플레이를 다시 읽어, 리플레이에서 나오는 값을 전부
     새로 써 넣는다(요청). 파서와 규칙으로 뽑아내는 파생 데이터라 그쪽이 좋아지면 옛 경기도
     함께 좋아져야 하는데, 지금까지는 리플레이를 다시 올리는 수밖에 없었다. 진행 상황은
     버튼 안의 숫자로만 보여준다. */
  const [redo, setRedo] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [confirmRedo, setConfirmRedo] = useState(false);

  // 등록된 리플레이(.rep) 전체를 날짜별 폴더 zip으로 받는다 — 인증 헤더가 필요해 blob으로
  // 받아 클라이언트에서 임시 링크로 저장 트리거한다.
  const downloadReplays = async () => {
    setDownloading(true);
    setErr("");
    try {
      const blob = await api.downloadReplayArchive();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "replays.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "리플레이를 다운로드하지 못했어요.");
    } finally {
      setDownloading(false);
    }
  };

  // 모든 경기기록 삭제 — 되돌릴 수 없는 파괴적 작업이라, "삭제"를 직접 입력해야 실행된다.
  const deleteAllGameResults = async () => {
    const typed = window.prompt(
      '모든 경기기록을 삭제합니다. 첨부 리플레이까지 지워지고 되돌릴 수 없어요.\n삭제하려면 "삭제"를 입력하세요.',
    );
    if (typed !== "삭제") return;
    setBusy(true);
    setErr("");
    try {
      const { deleted } = await api.deleteAllGameResults();
      window.alert(`${deleted}건의 경기기록을 삭제했어요.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "삭제하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  /* 등록된 경기를 리플레이로 다시 분석해 그 결과를 갈아 끼운다 — 리플레이가 붙은 경기만
     대상이고, 분석에 실패한 건은 건드리지 않고 세기만 한다(그 경기는 예전 값 그대로다).

     갈아 끼우는 것은 '리플레이가 말해 주는 값'뿐이다(요청: 요약뿐 아니라 다른 모든 데이터를
     재분석하되, 등록자·등록시간처럼 절대 바뀌면 안 되는 것은 그대로) — 요약·지형 격자에
     더해 맵 이름·실제 시작 시각·경기 길이, 사람별 지표(종족·APM·EAPM·커맨드·생산·생산
     구성)다. 사람이 정한 것은 아예 안 보낸다: 등록자·등록 시각·경기번호·날짜·분류·승패·
     회원 연결·첨부 리플레이. 파서가 좋아지면 옛 경기의 이 값들도 같이 낡기 때문에, 요약만
     고쳐서는 반쪽이었다(실제로 생산 구성·초반 일꾼 수는 옛 경기에 아예 없다). */
  //
  // 예전에는 경기 하나마다 '내려받기 → 파싱 → 올리기'를 한 줄로 세워 놓고 그걸 화면 쪽에서
  // 돌렸다. 파싱 한 번이 실측 252ms(+요약 23ms)라 그동안 화면이 통째로 멈췄고, 기다림
  // (내려받기·올리기)과 계산(파싱)이 번갈아 노는 바람에 경기 수만큼 그대로 곱해졌다
  // (지적: 너무 느려서 못 쓰겠다. 배치 등록보다는 빨라야 하지 않나).
  //
  // 이제 두 가지를 함께 고친다.
  //   ① 파싱은 일꾼(Web Worker) 여럿에게 나눠 준다 — 코어 수만큼 실제로 나란히 돈다.
  //   ② 갈래를 일꾼보다 조금 더 많이 굴린다 — 한쪽이 파싱하는 동안 다른 쪽은 내려받는다.
  // 화면이 안 멈추는 것은 덤이 아니라 요점이다: 진행 숫자가 실제로 흐르고 중단도 눌린다.
  //
  // 배치 등록과 견주면 이쪽은 '내려받기'가 한 번 더 있다 — 배치는 이미 손에 든 파일을 읽지만
  // 재분석은 서버에서 리플레이(한 개 128KB)를 받아 와야 한다. 그 몫만큼은 구조적으로 더 든다.
  const reanalyzeGames = async (only?: number[]) => {
    setErr("");
    setRedo({ done: 0, total: 0, failed: 0 });
    let done = 0;
    let failed = 0;
    /* 개체 트랙 v2 업로드 실패를 따로 센다(지적: 재분석했는데 트랙이 안 들어옴 — 조용히
       삼키니 성공처럼 보였다). 재분석 본체와 별개로 세어 끝 알림에서 알린다. */
    const pool = createSummaryPool();
    try {
      /* 고른 경기만 돌린다(요청: 재분석 누르면 팝업으로 경기 목록이 뜨고 선택해서
         재분석) — 목록은 팝업이 이미 받아 뒀으므로 여기서 다시 받지 않는다. 안 넘어오면
         (옛 경로) 예전처럼 전부 받는다. 한 번에 다 받으면 응답이 수십 MB라 커서로 나눈다. */
      let ids: number[] = only ?? [];
      if (!only) {
        let cursor: string | undefined;
        do {
          const page = await api.getGameResultsPage({ cursor, limit: 100 });
          page.items.forEach((m) => { if (m.replay) ids.push(m.id); });
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
      }
      ids = [...new Set(ids)];
      setRedo({ done: 0, total: ids.length, failed: 0 });

      const one = async (id: number) => {
        try {
          const blob = await api.downloadReplay(id);
          if (pool) {
            const r = await pool.run(id, `${id}.rep`, await blob.arrayBuffer());
            if (!r.ok) throw new Error(r.error);
            await api.reanalyzeGameResult(id, {
              mapData: r.mapData,
              mapName: r.mapName, gameStartedAt: r.gameStartedAt,
              durationSeconds: r.durationSeconds, slots: r.slots,
            });
          } else {
            // 일꾼을 못 쓰는 환경(옛 브라우저 등)에서는 예전처럼 화면 쪽에서 읽는다.
            const parsed = await parseReplayFile(new File([blob], `${id}.rep`));
            await api.reanalyzeGameResult(id, {
              mapData: parsed.mapGrid ?? null,
              mapName: parsed.mapName || null,
              gameStartedAt: parsed.gameStartedAt ?? null,
              durationSeconds: parsed.durationSeconds ?? null,
              slots: parsed.players.map((p) => ({
                rawName: p.rawName, race: p.race,
                apm: p.apm, eapm: p.eapm,
                cmdCount: p.cmdCount, effectiveCmdCount: p.effectiveCmdCount,
                buildCount: p.buildCount, buildMix: p.buildMix,
              })),
            });
          }
        } catch {
          failed += 1;
        }
        done += 1;
        setRedo({ done, total: ids.length, failed });
      };
      // 갈래는 일꾼 수의 두 배 — 절반이 파싱하는 동안 나머지 절반이 내려받고 있게 된다.
      // 일꾼이 없는 환경에서도 내려받기·올리기는 겹칠 수 있으므로 여러 갈래로 굴린다.
      await runLanes(ids, (pool?.size ?? 2) * 2, one);

      /* 마지막 한 건이 세어지는 것을 보고 나서 알림을 띄운다(지적: 끝수가 안 세어진 채로
         완료가 뜬다) — window.alert는 그 자리에서 화면을 멈춰 세우는데, 바로 위에서 부른
         setRedo는 아직 그려지기 전이라 39/40에서 멈춘 채로 알림이 덮였다. 값이 틀린 게
         아니라 그릴 틈을 안 준 것이라, 한 프레임만 양보하면 된다. */
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      window.alert(`경기 ${done - failed}건을 다시 분석했어요.${failed > 0 ? `\n${failed}건은 리플레이를 읽지 못해 그대로 뒀어요.` : ""}\n참값 자취는 서버가 뒤에서 굽습니다 — 잠시 뒤 재생해 보세요.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "경기를 다시 분석하지 못했어요.");
    } finally {
      pool?.close();
      setRedo(null);
    }
  };

  /* ── 재분석 경기 고르기(요청) ─────────────────────────────────────────────────
     예전엔 버튼을 누르면 "등록된 경기를 모두" 다시 분석했다. 파서를 고칠 때마다 전부를
     다시 도는 것은 몇 분씩 걸리고, 방금 손본 규칙이 어느 경기에 어떻게 먹혔는지 보려면
     한두 건만 돌리고 싶을 때가 많다. 목록에서 골라 돌린다. */
  type PickRow = { id: number; matchNo: string; date: string; map: string; who: string };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickRows, setPickRows] = useState<PickRow[] | null>(null);
  const [pickErr, setPickErr] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [pickQuery, setPickQuery] = useState("");
  useLockBodyScroll(pickerOpen, () => setPickerOpen(false));

  const openPicker = async () => {
    setPickerOpen(true);
    setPickErr("");
    if (pickRows) return;            // 한 번 받아 두면 다시 안 받는다.
    try {
      const rows: PickRow[] = [];
      let cursor: string | undefined;
      do {
        const page = await api.getGameResultsPage({ cursor, limit: 100 });
        for (const m of page.items) {
          if (!m.replay) continue;   // 리플레이가 없으면 다시 읽을 것이 없다.
          /* 이름은 리플레이 원본 아이디(rawName)를 쓴다 — 회원 연결과 무관하게
             리플레이로 등록된 모든 슬롯에 있고, 어느 경기인지 알아보는 데 그게 제일 낫다. */
          const names = [...m.team1, ...m.team2]
            .map((sl) => sl.rawName || "")
            .filter(Boolean);
          rows.push({
            id: m.id,
            matchNo: m.matchNo,
            date: m.gameStartedAt ? m.gameStartedAt.slice(0, 10) : m.date,
            map: m.mapName || "(맵 미상)",
            who: names.join(" · "),
          });
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      setPickRows(rows);
    } catch (e) {
      setPickErr(e instanceof Error ? e.message : "경기 목록을 받지 못했어요.");
      setPickRows([]);
    }
  };

  /* 검색은 화면에서만 거른다 — 목록을 이미 통째로 들고 있어서 서버를 다시 부를 이유가 없다.
     전체 선택 체크박스는 '지금 보이는 것'을 기준으로 켠다(요청: 전체 선택 체크박스도 넣고) —
     검색으로 좁힌 뒤 전체 선택하면 그 좁힌 것만 골라진다. */
  const pickFiltered = (pickRows ?? []).filter((r) => {
    const q = pickQuery.trim().toLowerCase();
    if (!q) return true;
    return `${r.matchNo} ${r.date} ${r.map} ${r.who}`.toLowerCase().includes(q);
  });
  const allShownPicked = pickFiltered.length > 0 && pickFiltered.every((r) => picked.has(r.id));
  const toggleAllShown = () => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (allShownPicked) pickFiltered.forEach((r) => next.delete(r.id));
      else pickFiltered.forEach((r) => next.add(r.id));
      return next;
    });
  };
  const togglePick = (id: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const currentNumber = versionNumber(appVersion);

  // "현재 버전 설정" — 등록된 버전 중 하나로 활성 버전을 바꾼다(예전 배포/롤백을 하나로 합침).
  // 바꾸면 모두에게 즉시 반영되고, 회원들은 다음 접속 때 버전 안내 팝업을 다시 보게 된다.
  const [versionPickerOpen, setVersionPickerOpen] = useState(false);
  // 중첩 미니 모달(현재버전 선택)의 바깥 탭 닫기 — 오버레이 클릭 대신 실드 콜백으로
  // (오버레이는 display:contents라 더 이상 클릭을 받지 않는다, bodyScrollLock 참고).
  useLockBodyScroll(versionPickerOpen, () => setVersionPickerOpen(false));
  const [confirmSetVersion, setConfirmSetVersion] = useState<string | null>(null);
  /* 재분석 고르기 창도 다른 모달과 같은 표준 장치를 쓴다(지적: 제어판 쪽은 그게 안 돼
     있는 것 같다 — 실제로 이 창만 빠져 있었다). 스크롤락이 실드·바깥 클릭 닫기·탭바
     물러남을 한꺼번에 맡는다. 아래에서 document.body로 포털도 함께 — 인라인으로 두면
     .scr-app 안이라 실드가 제 클릭을 막고, position:fixed도 조상 상자에 갇힌다. */
  useLockBodyScroll(pickerOpen, () => setPickerOpen(false));
  const [pickValue, setPickValue] = useState("");

  // 현재 버전을 뺀 '고를 수 있는' 버전들 — 현재 버전으로 다시 설정하는 건 의미가 없어 제외한다.
  // 드롭다운은 최신 버전이 위로 오도록 역순(내림차순)으로 노출한다. appVersions는 오름차순이라,
  // filter가 만든 새 배열을 그대로 뒤집는다(원본은 건드리지 않음).
  const pickableVersions = appVersions
    .filter((v) => versionNumber(v.number) !== currentNumber)
    .reverse();

  const openVersionPicker = () => {
    setPickValue(pickableVersions[0]?.number ?? "");
    setVersionPickerOpen(true);
  };

  const setVersion = async (number: string) => {
    setBusy(true);
    setErr("");
    try {
      await setAppVersion(number);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "버전 설정에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  const toggleNotice = async () => {
    setTogglingNotice(true);
    setErr("");
    try {
      await setNoticeEnabled(!noticeEnabled);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "설정을 바꾸지 못했어요.");
    } finally {
      setTogglingNotice(false);
    }
  };

  return (
    <div className="scr-screen scr-admin-screen">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">제어판</h1>
      </div>

      {/* 운영 메뉴 안의 화면이라 여기까지 들어온 사람은 이미 운영자다 — 비밀번호 잠금은
          없앴다(요청). 예전에는 로고 3연타로 들어오는 숨은 화면이라 한 겹이 필요했다. */}
      <div className="scr-admin-panel-body">
        {(
          <>
            {/* 버전관리 — 소제목(현재 버전 표시 포함) + 버튼들. 관리 기능은 전부 운영자
                전용이라 회원에겐 버튼을 노출하지 않는다(현재 버전 표시만 본다). */}
            <div className="scr-admin-panel-section-title">
              버전관리 <span className="scr-admin-panel-section-title-dim">(현재버전 : {currentNumber})</span>
            </div>
            {isAdmin ? (
              <>
                <div className="scr-admin-panel-grid">
                  {/* 현재 버전 설정 — 등록된 버전 중에서 골라 활성 버전을 바꾼다(모두에게
                      즉시 반영·안내 팝업 재노출이라 확인창을 거친다). */}
                  <button
                    type="button" className="scr-btn scr-btn-primary"
                    onClick={openVersionPicker} disabled={busy}
                  >
                    {busy ? <Spinner /> : "현재 버전 설정"}
                  </button>
                  {/* 버전 등록 — 버전 추가/삭제 + 버전별 안내 내용 편집 모달(요청: 소제목이
                      이미 '버전관리'라 버튼까지 같은 이름이면 무엇이 다른지 안 읽힌다). */}
                  <button
                    type="button" className="scr-btn scr-btn-primary"
                    onClick={() => setVersionManageOpen(true)}
                  >
                    버전 등록
                  </button>
                </div>

                {/* 버전 안내 표시 토글 — 예전엔 "버전 안내 설정" 모달 안에 있었지만 제어판
                    본체로 옮겼다(요청). 켜져 있어야만 버전이 바뀐 뒤 안내 팝업이 뜬다. */}
                <div className="scr-notice-toggle-row scr-admin-panel-notice-toggle">
                  <div className="scr-notice-toggle-label">
                    <span className="scr-notice-toggle-title">버전 안내 표시</span>
                    <span className="scr-notice-toggle-desc">
                      {noticeEnabled ? "새 버전 접속 시 안내를 띄웁니다." : "안내를 띄우지 않습니다."}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={noticeEnabled}
                    className={cx("scr-notice-switch", noticeEnabled && "scr-notice-switch-on")}
                    onClick={() => void toggleNotice()}
                    disabled={togglingNotice}
                  >
                    <span className="scr-notice-switch-knob" />
                  </button>
                </div>
              </>
            ) : (
              <div className="scr-admin-panel-member-note">관리 기능은 운영자만 사용할 수 있어요.</div>
            )}

            {isAdmin && (
              <>
                {err && <div className="scr-err">{err}</div>}
                {/* 경기관리 — 단순 조회(다운로드)를 뺀 나머지는 전부 실행 전 확인창을
                    거친다(요청: "관리자 버튼들은 다 컨펌창 있어야돼(단순 조회는
                    제외)"). */}
                <div className="scr-admin-panel-section-title">경기관리</div>
                <div className="scr-admin-panel-grid">
                  {/* 모든 경기기록 삭제 — 되돌릴 수 없는 작업이지만 버튼 색으로 겁주지는
                      않는다(요청). window.prompt로 "삭제"를 직접 입력해야 실행된다. */}
                  <button
                    type="button" className="scr-btn scr-btn-primary"
                    onClick={deleteAllGameResults} disabled={busy}
                  >
                    {busy ? <Spinner /> : "배치삭제"}
                  </button>
                  {/* 등록된 리플레이 전체를 zip으로 백업 다운로드(운영자) — 읽기 전용이라
                      확인창 없이 바로 받는다. */}
                  <button
                    type="button" className="scr-btn scr-btn-primary"
                    onClick={downloadReplays} disabled={downloading}
                  >
                    {downloading ? <Spinner /> : "배치다운로드"}
                  </button>
                  {/* 리플레이 폴더 일괄 등록 — 버튼을 누르면 바로 폴더 선택창이 뜬다.
                      배치등록 → 경기 재분석 순이 자연스럽다(요청) — 먼저 등록하고 그다음
                      다시 읽는 순서다. 이 컴포넌트가 함께 그리는 옵션·안내 줄은 CSS에서
                      뒤로 미뤄(order) 두 버튼이 한 줄에 나란히 선다. */}
                  <ReplayBatchButton />
                  {/* 경기 재분석 — 파서·규칙이 좋아졌을 때 옛 경기까지 다시 읽는다(요청).
                      리플레이에서 나오는 값만 새로 쓰고 사람이 정한 것은 그대로다(위 주석).
                      소제목을 따로 두지 않고 경기관리에 함께 둔다(요청) — 등록된 경기를
                      손대는 일이라 배치등록·배치삭제와 같은 성격이다. */}
                  <button
                    type="button" className="scr-btn scr-btn-primary"
                    onClick={() => { void openPicker(); }} disabled={redo !== null}
                  >
                    {/* 진행 숫자는 버튼 안에 넣는다(요청) — 밖에 따로 두면 그 줄이 통째로
                        생겼다 사라지며 아래 버튼들이 위아래로 밀린다(스크린샷). */}
                    {redo ? (
                      <>
                        <Spinner />
                        {redo.total > 0 ? `${redo.done}/${redo.total}` : "목록 받는 중"}
                        {redo.failed > 0 ? ` · 실패 ${redo.failed}` : ""}
                      </>
                    ) : "경기 재분석"}
                  </button>
                </div>

                {/* (삭제) 랭킹 관리 — "현재 랭킹 집계"와 "순위 기준선" 두 버튼이 있던
                    자리다. 랭크 변동 기능을 멈춰 두면서(요청: 지금 구조가 깔끔하지 않아
                    일단 기능을 멈춘다) 버튼과 그 핸들러·확인창까지 함께 걷어냈다 — 눌러도
                    서버가 409로 막으므로(RANKING_SHIFT_ENABLED) 남겨 두면 못 쓰는 버튼만
                    남는다. 다시 켤 때는 이 커밋을 되짚으면 된다. API 클라이언트의
                    recomputeRankingShifts·reseedRankingShifts는 엔드포인트가 그대로라
                    남겨 뒀다. */}

              </>
            )}
          </>
      )}
      </div>

      {confirmSetVersion && (
        <ConfirmDialog
          title={`현재 버전을 ${confirmSetVersion}(으)로 바꿀까요?`}
          message="모든 사용자에게 즉시 반영되고, 회원들은 다음 접속 시 버전 안내를 다시 보게 됩니다."
          confirmLabel="설정"
          onConfirm={() => {
            const next = confirmSetVersion;
            setConfirmSetVersion(null);
            void setVersion(next);
          }}
          onCancel={() => setConfirmSetVersion(null)}
        />
      )}

      {/* 재분석 경기 고르기(요청) — 목록에서 골라 돌린다. 다른 모달과 같이 body로
          포털한다(위 useLockBodyScroll 주석). */}
      {pickerOpen && createPortal(
        <div className="scr-modal-overlay">
          <div
            className="scr-modal scr-modal-md scr-redo-pick"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="scr-modal-head">
              <span>다시 분석할 경기 고르기</span>
              <button className="scr-icon-btn" onClick={() => setPickerOpen(false)} aria-label="닫기"><X size={14} /></button>
            </div>
            <div className="scr-modal-body scr-redo-pick-body">
              {pickErr && <div className="scr-redo-pick-err">{pickErr}</div>}
              {pickRows === null ? (
                <div className="scr-redo-pick-empty"><Spinner /> 경기 목록을 받는 중…</div>
              ) : pickRows.length === 0 ? (
                <div className="scr-redo-pick-empty">리플레이가 붙은 경기가 없어요.</div>
              ) : (
                <>
                  <input
                    type="search"
                    className="scr-input scr-redo-pick-search"
                    placeholder="경기번호·날짜·맵·선수로 찾기"
                    value={pickQuery}
                    onChange={(e) => setPickQuery(e.target.value)}
                  />
                  {/* 전체 선택 — 검색으로 좁혔으면 그 좁힌 것만 대상이다(위 주석). */}
                  <label className="scr-redo-pick-all">
                    <input type="checkbox" checked={allShownPicked} onChange={toggleAllShown} />
                    <span>
                      전체 선택
                      {pickQuery.trim() ? ` (검색된 ${pickFiltered.length}건)` : ` (${pickFiltered.length}건)`}
                    </span>
                  </label>
                  <div className="scr-redo-pick-list">
                    {pickFiltered.map((r) => (
                      <label key={r.id} className={cx("scr-redo-pick-row", picked.has(r.id) && "is-on")}>
                        <input
                          type="checkbox"
                          checked={picked.has(r.id)}
                          onChange={() => togglePick(r.id)}
                        />
                        {/* 윗줄은 경기(리플레이)와 맵, 아랫줄은 로스터(요청) — 무엇을
                            다시 분석하는지가 먼저고, 누가 했는지는 그 아래다. */}
                        <span className="scr-redo-pick-main">
                          <span className="scr-redo-pick-top">
                            <span className="scr-redo-pick-no">{r.matchNo}</span>
                            <span className="scr-redo-pick-map">{r.map}</span>
                            <span className="scr-redo-pick-date">{r.date}</span>
                          </span>
                          <span className="scr-redo-pick-who">{r.who}</span>
                        </span>
                      </label>
                    ))}
                    {pickFiltered.length === 0 && (
                      <div className="scr-redo-pick-empty">찾는 경기가 없어요.</div>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="scr-modal-foot scr-redo-pick-foot">
              <span className="scr-redo-pick-count">{picked.size}건 선택</span>
              <button
                type="button"
                className="scr-btn scr-btn-primary"
                disabled={picked.size === 0}
                onClick={() => { setPickerOpen(false); setConfirmRedo(true); }}
              >
                다시 분석
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {confirmRedo && (
        <ConfirmDialog
          title={`고른 경기 ${picked.size}건을 다시 분석할까요?`}
          /* 안내는 두 줄이면 된다(요청: 설명이 너무 길다) — 무엇이 바뀌고 무엇이 안 바뀌는지,
             그리고 오래 걸린다는 것. 어느 값이 어떻게 다시 써지는지는 여기서 읽을 일이
             아니다(그건 reanalyzeGames 주석에 있다) — 누르기 전에 알아야 하는 건
             "내가 손으로 넣은 것은 안 건드린다"뿐이다. */
          message="리플레이가 붙은 경기를 다시 읽어 분석 결과를 새로 씁니다. 직접 입력한 값(날짜·승패·회원 연결 등)은 그대로예요. 건수가 많으면 몇 분 걸립니다."
          confirmLabel="다시 분석"
          onConfirm={() => { setConfirmRedo(false); void reanalyzeGames([...picked]); }}
          onCancel={() => setConfirmRedo(false)}
        />
      )}

      {versionManageOpen && (
        <VersionManageModal onClose={() => setVersionManageOpen(false)} />
      )}


      {versionPickerOpen && (
        <div className="scr-modal-overlay" onClick={() => setVersionPickerOpen(false)}>
          <div
            className="scr-modal scr-modal-sm scr-admin-panel-version-popup"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="scr-modal-head">
              <span>현재 버전 설정</span>
              <button className="scr-icon-btn" onClick={() => setVersionPickerOpen(false)} aria-label="닫기"><X size={14} /></button>
            </div>
            <div className="scr-modal-body">
              {/* 등록된 버전 중에서 드롭다운으로 고른다 — 현재 버전은 다시 설정할 이유가 없어
                  후보에서 뺀다. */}
              {pickableVersions.length === 0 ? (
                <div className="scr-version-pick-empty">고를 수 있는 다른 버전이 없어요.</div>
              ) : (
                <>
                  <Select
                    value={pickValue}
                    options={pickableVersions.map((v) => ({ value: v.number, label: `${v.number} 버전` }))}
                    onChange={setPickValue}
                    className="scr-version-pick-select"
                  />
                  <button
                    type="button"
                    className="scr-btn scr-btn-primary scr-version-pick-confirm"
                    onClick={() => { setConfirmSetVersion(pickValue); setVersionPickerOpen(false); }}
                    disabled={!pickValue}
                  >
                    설정
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
