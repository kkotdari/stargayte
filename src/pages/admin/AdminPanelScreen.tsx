import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import Select from "../../components/common/Select";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import ReplayBatchButton from "../../components/common/ReplayBatchButton";
import VersionManageModal from "../../modals/VersionManageModal";
import { api } from "../../api/client";
import { parseReplayFile } from "../../utils/replayParser";
import { buildReplaySummary } from "../../utils/replaySummary";
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
  // 순위 기준선 다시 깔기 — 눌러 놓고 결과를 바로 알려준다(운영자 1회용).
  const [seeding, setSeeding] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [confirmSeed, setConfirmSeed] = useState(false);
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

  // 지금 집계 — 스케줄러가 아침에 하는 것과 똑같은 일을 손으로 돌린다(요청). 아침을
  // 기다리지 않고 확인할 수 있고, 스케줄러가 정말 도는지 눈으로 보는 데도 쓴다.
  // 여러 번 눌러도 순위표가 그대로면 아무것도 안 남는다(recompute_daily가 그렇게 만들어져
  // 있다) — 그래서 확인창 없이 바로 돌린다.
  const recomputeRanks = async () => {
    setRecomputing(true);
    setErr("");
    try {
      const { changed } = await api.recomputeRankingShifts();
      window.alert(changed
        ? "랭킹을 다시 집계했어요. 활동에 변동 카드가 올라갑니다."
        : "랭킹을 다시 집계했어요. 순위가 그대로여서 남길 변동은 없었어요.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "집계하지 못했어요.");
    } finally {
      setRecomputing(false);
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
  const reanalyzeGames = async () => {
    setErr("");
    setRedo({ done: 0, total: 0, failed: 0 });
    let done = 0;
    let failed = 0;
    const pool = createSummaryPool();
    try {
      // 한 번에 다 받으면 응답이 수십 MB가 되므로 커서로 나눠 받는다.
      let cursor: string | undefined;
      const ids: number[] = [];
      do {
        const page = await api.getGameResultsPage({ cursor, limit: 100 });
        page.items.forEach((m) => { if (m.replay) ids.push(m.id); });
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      setRedo({ done: 0, total: ids.length, failed: 0 });

      const one = async (id: number) => {
        try {
          const blob = await api.downloadReplay(id);
          if (pool) {
            const r = await pool.run(id, `${id}.rep`, await blob.arrayBuffer());
            if (!r.ok) throw new Error(r.error);
            await api.reanalyzeGameResult(id, {
              summaryData: r.summaryData, mapData: r.mapData,
              mapName: r.mapName, gameStartedAt: r.gameStartedAt,
              durationSeconds: r.durationSeconds, slots: r.slots,
            });
          } else {
            // 일꾼을 못 쓰는 환경(옛 브라우저 등)에서는 예전처럼 화면 쪽에서 읽는다.
            const parsed = await parseReplayFile(new File([blob], `${id}.rep`));
            await api.reanalyzeGameResult(id, {
              summaryData: buildReplaySummary(parsed), mapData: parsed.mapGrid ?? null,
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

      window.alert(`경기 ${done - failed}건을 다시 분석했어요.${failed > 0 ? `\n${failed}건은 리플레이를 읽지 못해 그대로 뒀어요.` : ""}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "경기를 다시 분석하지 못했어요.");
    } finally {
      pool?.close();
      setRedo(null);
    }
  };

  // 순위 기준선 적재 — 지금 순위표를 스냅샷으로 남겨 다음 아침 재집계의 비교 대상으로
  // 삼는다. 변동 없이 저장돼 피드에는 안 뜨고, 여러 번 눌러도 이번 달 기준선을 덮어쓸
  // 뿐 행이 쌓이지 않는다.
  const reseedRanks = async () => {
    setSeeding(true);
    setErr("");
    try {
      const counts = await api.reseedRankingShifts();
      window.alert(
        `순위 기준선을 새로 깔았어요.\n개인전 ${counts["0101"] ?? 0}명 · 팀전 ${counts["0102"] ?? 0}명`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "기준선을 만들지 못했어요.");
    } finally {
      setSeeding(false);
    }
  };

  const currentNumber = versionNumber(appVersion);

  // "현재 버전 설정" — 등록된 버전 중 하나로 활성 버전을 바꾼다(예전 배포/롤백을 하나로 합침).
  // 바꾸면 모두에게 즉시 반영되고, 회원들은 다음 접속 때 버전 안내 팝업을 다시 보게 된다.
  const [versionPickerOpen, setVersionPickerOpen] = useState(false);
  // 중첩 미니 모달(현재버전 선택)의 바깥 탭 닫기 — 오버레이 클릭 대신 실드 콜백으로
  // (오버레이는 display:contents라 더 이상 클릭을 받지 않는다, bodyScrollLock 참고).
  useLockBodyScroll(versionPickerOpen, () => setVersionPickerOpen(false));
  const [confirmSetVersion, setConfirmSetVersion] = useState<string | null>(null);
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
                    onClick={() => setConfirmRedo(true)} disabled={redo !== null}
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

                {/* 랭킹 관리 — 순위 스냅샷 쪽 일은 경기관리와 성격이 달라 소제목을 따로
                    뒀다(요청). */}
                <div className="scr-admin-panel-section-title">랭킹 관리</div>
                <div className="scr-admin-panel-grid">
                  {/* 현재 랭킹 집계하기 — 스케줄러(아침)와 같은 로직을 지금 돌린다(요청).
                      순위가 그대로면 아무것도 안 남으므로 확인창 없이 바로 실행한다. */}
                  <button
                    type="button" className="scr-btn scr-btn-primary"
                    onClick={() => void recomputeRanks()} disabled={recomputing}
                  >
                    {recomputing ? <Spinner /> : "현재 랭킹 집계"}
                  </button>
                  {/* 순위 기준선 적재 — 지금 데이터로 스냅샷을 남긴다(1회용). 되돌릴 수는
                      없지만 파괴적이지도 않아서(덮어쓰기) 확인창만 한 번 거친다. */}
                  <button
                    type="button" className="scr-btn scr-btn-primary"
                    onClick={() => setConfirmSeed(true)} disabled={seeding}
                  >
                    {seeding ? <Spinner /> : "순위 기준선"}
                  </button>
                </div>

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

      {confirmRedo && (
        <ConfirmDialog
          title="등록된 경기를 모두 다시 분석할까요?"
          message="리플레이가 붙은 경기를 하나씩 다시 읽어 전황 요약·미니맵과 맵 이름·시작 시각·경기 길이, 참가자별 지표(종족·APM·커맨드·생산)를 새로 씁니다. 등록자·등록 시각·경기번호·날짜·분류·승패·회원 연결은 그대로입니다. 건수가 많으면 몇 분 걸립니다."
          confirmLabel="다시 분석"
          onConfirm={() => { setConfirmRedo(false); void reanalyzeGames(); }}
          onCancel={() => setConfirmRedo(false)}
        />
      )}

      {confirmSeed && (
        <ConfirmDialog
          title="지금 순위표를 기준선으로 저장할까요?"
          message="개인전·팀전 순위표를 그대로 스냅샷으로 남깁니다. 활동에는 안 뜨고, 다음 아침 재집계가 이 기준선과 비교해 변동을 만듭니다."
          confirmLabel="기준선 저장"
          onConfirm={() => { setConfirmSeed(false); void reseedRanks(); }}
          onCancel={() => setConfirmSeed(false)}
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
