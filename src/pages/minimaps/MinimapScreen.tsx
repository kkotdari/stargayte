import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Upload, Link2Off, ImageUp, Mountain, RefreshCcw } from "lucide-react";
import TerrainReviewModal from "../../modals/TerrainReviewModal";
import { analyzeMinimap, encodeWalk } from "../../utils/minimapTerrain";
import ReplayMapCanvas from "../../components/replay/ReplayMapCanvas";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import Select from "../../components/common/Select";
import { Spinner } from "../../components/common/Feedback";
import { api } from "../../api/client";
import { useReplayMap } from "../../hooks/useReplayMap";
import { cleanMapName } from "../../utils/mapName";
import { cx } from "../../utils/format";
import type { MapCatalog, MapCatalogEntry, MinimapImage } from "../../types";

// 운영 메뉴의 "미니맵" 화면 — 미니맵 그림을 먼저 등록하고, 리플레이에서 읽은 맵을 그 그림에
// 매핑하는 곳이다(요청한 흐름).
//
// 왜 그림을 사람이 올리나: 리플레이에는 타일 '번호'만 있고, 그 번호가 물인지 풀인지 언덕인지
// 적힌 표는 게임 설치본(cv5)에 있다. 번호만으로 갈라 보려는 시도를 네 번 했고 다 실패했다
// (자세한 내용은 ReplayMapCanvas 주석). 그림을 한 번 올려 두면 그 위에 아바타·화살표를
// 얹으므로 게임에서 보던 미니맵과 같은 그림이 된다.
//
// 화면은 세 부분이다(요청):
//   ① 미니맵 등록 — 이름과 그림만으로 먼저 만든다. 맵을 안 골라도 등록된다.
//   ② 매핑 안 된 맵 — 아직 어느 미니맵에도 안 붙은 맵만 여기 보인다. 체크(전체 선택 포함)해서
//      등록된 미니맵 하나에 붙인다.
//   ③ 등록된 미니맵 — 그림마다 그 밑에 붙어 있는 맵 목록이 딸린다. 매핑 해제는 거기서 하나씩.
// 이름·판본만 다른 거의 같은 맵이 여러 벌 돌아다니므로(빠른무한 계열) 한 그림에 여러 맵이
// 붙는 것이 정상이다.
//
// 맵의 썸네일은 리플레이 격자를 그대로 그린 개략도 한 장이다(요청) — 이름이 "New Super
// 빠른무한"처럼 비슷비슷해서 이름만으로는 어느 맵인지 못 가른다.

/** 올릴 그림을 이 한 변 크기로 줄인다 — 미니맵은 화면에서 240~360px로 보이므로 이 정도면
 *  충분하고, 원본(1000px PNG 700KB)을 그대로 올리면 카드 하나 볼 때마다 그만큼 받는다. */
const MAX_SIDE = 512;
/** JPEG 품질 — 지형 그림이라 이 정도에서 눈에 띄는 손실이 없다(대략 60~90KB). */
const JPEG_QUALITY = 0.86;

/** 고른 파일을 정사각 512px JPEG data URL로 줄인다. */
async function toDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(MAX_SIDE, Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 줄일 수 없어요.");
  // 미니맵은 정사각형이다 — 원본이 조금 어긋나 있어도 정사각으로 늘려 맞춘다(마커 좌표가
  // 맵 크기 비율로 찍히므로 그림도 같은 비율이어야 자리가 맞는다).
  ctx.drawImage(bitmap, 0, 0, side, side);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

const mapLabel = (m: MapCatalogEntry): string => cleanMapName(m.name ?? "") || "(이름 없음)";

/** 맵 한 줄의 왼쪽 썸네일 — 리플레이 격자를 그대로 그린 개략도(요청: 한 장이면 됨). */
function GridThumb({ hash }: { hash: string }) {
  // 경기 카드가 쓰는 것과 같은 경로로 받는다(해시별 캐시 + 한 번에 묶어 묻기).
  const grid = useReplayMap(hash);
  return (
    <span className="scr-minimap-thumb scr-minimap-thumb-grid">
      {grid ? <ReplayMapCanvas grid={grid} /> : null}
    </span>
  );
}

/** ② 매핑 안 된 맵 한 줄 — 체크해서 미니맵에 붙인다. */
function UnmappedRow({
  map, picked, disabled, onToggle,
}: {
  map: MapCatalogEntry; picked: boolean; disabled: boolean; onToggle: () => void;
}) {
  return (
    <label className={cx("scr-minimap-map-row", picked && "scr-minimap-map-row-on")}>
      <input type="checkbox" checked={picked} onChange={onToggle} disabled={disabled} />
      <GridThumb hash={map.hash} />
      <span className="scr-minimap-map-text">
        <span className="scr-minimap-map-name">{mapLabel(map)}</span>
        <span className="scr-minimap-map-meta">{map.width}×{map.height} · {map.matches}경기</span>
      </span>
    </label>
  );
}

/** ③ 미니맵에 붙어 있는 맵 한 줄 — 여기서 하나씩 매핑을 해제한다(요청). */
function MappedRow({
  map, disabled, onRelease,
}: {
  map: MapCatalogEntry; disabled: boolean; onRelease: () => void;
}) {
  return (
    <div className="scr-minimap-map-row scr-minimap-map-row-static">
      <GridThumb hash={map.hash} />
      <span className="scr-minimap-map-text">
        <span className="scr-minimap-map-name">{mapLabel(map)}</span>
        <span className="scr-minimap-map-meta">{map.width}×{map.height} · {map.matches}경기</span>
      </span>
      <button
        type="button" className="scr-btn scr-btn-secondary scr-btn-sm"
        onClick={onRelease} disabled={disabled}
      >
        <Link2Off size={13} /> 매핑 해제
      </button>
    </div>
  );
}

export default function MinimapScreen() {
  const [catalog, setCatalog] = useState<MapCatalog | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // ② 에서 고른 맵 해시들.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // ② 에서 어느 미니맵에 붙일지.
  const [into, setInto] = useState("");
  // ① 새 미니맵 이름.
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<MinimapImage | null>(null);
  // 지형 검수 모달(요청) — 그림 하나를 크게 띄워 이동 가능/불가 격자를 보고 고친다.
  const [terrainTarget, setTerrainTarget] = useState<MinimapImage | null>(null);
  /* 검수 모달용 앵커(지적: 빠른무한이 아직도 반대 — 모달의 자동 분석이 앵커 없이 돌았다)
     — 매핑된 첫 맵의 자원 좌표를 받아 분수로 넘긴다. */
  const [terrainAnchors, setTerrainAnchors] = useState<[number, number][] | undefined>(undefined);
  const openTerrain = async (img: MinimapImage) => {
    setTerrainAnchors(undefined);
    setTerrainTarget(img);
    const first = maps.find((m) => m.imageId === img.id);
    if (!first) return;
    try {
      const [mg] = await api.getReplayMaps([first.hash]);
      if (mg && (mg.resources ?? []).length > 0) {
        setTerrainAnchors(mg.resources.map(([x, y]) => [x / mg.width, y / mg.height] as [number, number]));
      }
    } catch { /* 앵커는 보정일 뿐 — 못 받아도 모달은 연다. */ }
  };
  /** 매핑된 맵 목록을 펼쳐 둔 미니맵들 — 기본은 접힘(요청). */
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  /* 그림을 바꿀 미니맵 — 파일 고르기는 창을 하나만 두고 이 값으로 대상을 기억한다(요청:
     미니맵 메뉴에서 그림 변경). 줄마다 <input type=file>을 두면 미니맵 수만큼 숨은 입력이
     생기고, 어느 줄에서 골랐는지도 그 입력이 알아야 한다 — 대상을 상태로 들면 창은 하나면
     된다. */
  const [swapId, setSwapId] = useState<number | null>(null);
  const swapRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      setCatalog(await api.getMapCatalog());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "맵 목록을 불러오지 못했어요.");
    }
  };
  useEffect(() => { void load(); }, []);

  const images = catalog?.images ?? [];
  const maps = catalog?.maps ?? [];
  const unmapped = useMemo(() => maps.filter((m) => m.imageId === null), [maps]);
  const mappedOf = (imageId: number) => maps.filter((m) => m.imageId === imageId);

  // 등록된 미니맵이 하나라도 있으면 첫 번째를 기본 선택으로 둔다 — 대개 한두 개뿐이라
  // 매번 고르게 할 이유가 없다. 고른 미니맵이 지워지면 다시 첫 번째로 돌아간다.
  useEffect(() => {
    if (images.length === 0) { setInto(""); return; }
    if (!images.some((i) => String(i.id) === into)) setInto(String(images[0].id));
  }, [images, into]);

  const toggle = (hash: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  };
  const allPicked = unmapped.length > 0 && unmapped.every((m) => picked.has(m.hash));
  const toggleAll = () => {
    setPicked(allPicked ? new Set() : new Set(unmapped.map((m) => m.hash)));
  };

  /** ① 미니맵을 새로 등록한다 — 맵을 안 골라도 등록된다(요청: 먼저 등록하고 나중에 매핑). */
  const create = async (file: File) => {
    setErr("");
    setBusy(true);
    try {
      const image = await toDataUrl(file);
      const label = name.trim() || "미니맵";
      const made = await api.createMinimapImage({ name: label, image, hashes: [] });
      setName("");
      setInto(String(made.id));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "미니맵을 등록하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  /** ② 고른 맵들을 미니맵 하나에 붙인다. */
  const mapInto = async () => {
    const imageId = Number(into);
    if (!imageId || picked.size === 0) return;
    setErr("");
    setBusy(true);
    try {
      await api.assignMinimapImage(imageId, [...picked]);
      setPicked(new Set());
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "매핑하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  /** ③ 매핑 해제 — 그 맵은 다시 위 목록으로 돌아가고 격자 개략도로 그려진다. */
  const release = async (hash: string) => {
    setErr("");
    setBusy(true);
    try {
      await api.assignMinimapImage(null, [hash]);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "해제하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  /* ③ 그림만 갈아 끼운다(요청) — 지웠다 다시 올리는 길밖에 없었는데, 그러면 그 그림에
     붙어 있던 맵 매핑이 통째로 풀린다. 더 나은 그림으로 바꾸는 일이 매핑을 처음부터 다시
     하는 일이 돼서는 안 된다. 이름은 그대로 다시 보낸다 — 서버가 이름을 늘 요구한다. */
  const swap = async (image: MinimapImage, file: File) => {
    setErr("");
    setBusy(true);
    try {
      const next = await toDataUrl(file);
      await api.updateMinimapImage(image.id, { name: image.name, image: next });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "그림을 바꾸지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (image: MinimapImage) => {
    setErr("");
    setBusy(true);
    try {
      await api.deleteMinimapImage(image.id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "지우지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scr-screen scr-minimap-screen">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">미니맵</h1>
      </div>

      {err && <div className="scr-err">{err}</div>}

      {/* ① 미니맵 등록 — 이름과 그림만으로 먼저 만든다. */}
      <div className="scr-minimap-panel">
        <div className="scr-notice-edit-label">미니맵 등록</div>
        <div className="scr-minimap-assign">
          <input
            className="scr-input"
            value={name} onChange={(e) => setName(e.target.value)}
            placeholder="미니맵 이름(예: 투혼 1.3)"
            disabled={busy}
          />
          {/* 버튼은 작게 — 한 번 쓰고 마는 자리라 크게 둘 이유가 없다(요청). */}
          <button
            type="button" className="scr-btn scr-btn-primary scr-btn-sm"
            onClick={() => fileRef.current?.click()} disabled={busy}
          >
            {busy ? <Spinner /> : <><Upload size={14} /> 등록</>}
          </button>
          <input
            ref={fileRef} type="file" accept="image/*" hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void create(f);
            }}
          />
        </div>
      </div>

      {/* ② 매핑 안 된 맵 — 체크해서 등록된 미니맵 하나에 붙인다. */}
      <div className="scr-minimap-panel">
        <div className="scr-minimap-panel-head">
          <span className="scr-notice-edit-label">매핑 안 된 맵 {unmapped.length}개</span>
          {unmapped.length > 0 && (
            <label className="scr-minimap-all">
              <input
                type="checkbox" checked={allPicked} onChange={toggleAll} disabled={busy}
              />
              전체 선택
            </label>
          )}
        </div>
        <div className="scr-minimap-maps">
          {catalog === null && <Spinner />}
          {catalog !== null && unmapped.length === 0 && (
            <div className="scr-minimap-empty">
              {maps.length === 0
                ? "아직 등록된 맵이 없어요 — 리플레이를 등록하면 여기 쌓입니다."
                : "모든 맵이 미니맵에 매핑돼 있어요."}
            </div>
          )}
          {unmapped.map((m) => (
            <UnmappedRow
              key={m.hash} map={m} picked={picked.has(m.hash)} disabled={busy}
              onToggle={() => toggle(m.hash)}
            />
          ))}
        </div>
        {unmapped.length > 0 && (
          <div className="scr-minimap-assign">
            {images.length === 0 ? (
              <span className="scr-minimap-empty">먼저 위에서 미니맵을 등록하세요.</span>
            ) : (
              <>
                <Select
                  value={into} onChange={setInto} disabled={busy} minDropWidth={240}
                  options={images.map((i) => ({ value: String(i.id), label: i.name }))}
                  placeholder="미니맵 선택"
                />
                <button
                  type="button" className="scr-btn scr-btn-primary"
                  onClick={() => void mapInto()} disabled={busy || picked.size === 0 || !into}
                >
                  {busy ? <Spinner /> : `고른 ${picked.size}개 매핑`}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ③ 등록된 미니맵 — 그림마다 붙어 있는 맵 목록이 딸린다(요청). */}
      <div className="scr-minimap-panel">
        <div className="scr-notice-edit-label">등록된 미니맵 {images.length}개</div>
        {images.length === 0 && (
          <div className="scr-minimap-empty">아직 등록된 미니맵이 없어요.</div>
        )}
        {images.map((i) => {
          const mapped = mappedOf(i.id);
          const open = openIds.has(i.id);
          return (
            <div key={i.id} className="scr-minimap-group">
              <div className="scr-minimap-image-row">
                <img className="scr-minimap-thumb scr-minimap-thumb-lg" src={i.image} alt={i.name} />
                {/* 매핑된 맵 목록은 접어 둔다(요청) — 미니맵이 늘면 목록만 길어져 정작
                    어떤 그림이 있는지 한눈에 안 들어온다. 줄 전체가 여닫이다. */}
                <button
                  type="button" className="scr-minimap-map-text scr-minimap-toggle"
                  onClick={() => setOpenIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(i.id)) next.delete(i.id); else next.add(i.id);
                    return next;
                  })}
                  aria-expanded={open}
                >
                  <span className="scr-minimap-map-name">{i.name}</span>
                  <span className="scr-minimap-map-meta">
                    매핑된 맵 {mapped.length}개 {open ? "▲" : "▼"}
                  </span>
                </button>
                {/* 그림 변경 — 지우기 왼쪽에 둔다(요청). 매핑을 지키면서 그림만 바꾸는
                    일이라, 되돌릴 수 없는 지우기와 나란히 있되 확인창은 없다. */}
                {/* 지형 검수(요청) — 자동 분석 결과를 크게 보고 칸 단위로 고친다. */}
                <button
                  type="button" className="scr-icon-btn"
                  onClick={() => void openTerrain(i)}
                  disabled={busy}
                  aria-label={`${i.name} 지형 검수`}
                  title="지형 검수"
                >
                  <Mountain size={14} />
                </button>
                {/* 재분석(요청) — 새 분석 규칙(색 순위·빵꾸 메우기)으로 지형을 다시 만들어
                    바로 저장한다. 손 검수한 값을 덮으니 필요할 때만. */}
                <button
                  type="button" className="scr-icon-btn"
                  onClick={async () => {
                    setBusy(true);
                    setErr("");
                    try {
                      /* 앵커(지적: 빠른무한 반전) — 매핑된 맵의 자원 좌표는 확실한 땅이다.
                         첫 매핑 맵의 격자를 받아 분수 좌표로 넘긴다. 매핑이 없으면 무앵커. */
                      let anchors: [number, number][] | undefined;
                      if (mapped.length > 0) {
                        const [mg] = await api.getReplayMaps([mapped[0].hash]);
                        if (mg && (mg.resources ?? []).length > 0) {
                          anchors = mg.resources.map(([x, y]) => [x / mg.width, y / mg.height] as [number, number]);
                        }
                      }
                      const g = await analyzeMinimap(i.image, anchors);
                      if (!g) throw new Error("그림을 분석하지 못했어요.");
                      const updated = await api.updateMinimapWalk(i.id, encodeWalk(g));
                      setCatalog((prev) => (prev ? {
                        ...prev,
                        images: prev.images.map((im) => (im.id === updated.id ? updated : im)),
                      } : prev));
                    } catch (e) {
                      setErr(e instanceof Error ? e.message : "지형을 재분석하지 못했어요.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                  aria-label={`${i.name} 지형 재분석`}
                  title="지형 재분석(자동 분석으로 다시 저장)"
                >
                  <RefreshCcw size={14} />
                </button>
                <button
                  type="button" className="scr-icon-btn"
                  onClick={() => { setSwapId(i.id); swapRef.current?.click(); }}
                  disabled={busy}
                  aria-label={`${i.name} 그림 변경`}
                  title="그림 변경"
                >
                  <ImageUp size={14} />
                </button>
                <button
                  type="button" className="scr-icon-btn"
                  onClick={() => setConfirmDelete(i)} disabled={busy}
                  aria-label={`${i.name} 지우기`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className={cx("scr-minimap-maps scr-minimap-maps-nested", !open && "scr-hidden")}>
                {mapped.length === 0 && (
                  <div className="scr-minimap-empty">매핑된 맵이 없어요 — 위에서 골라 매핑하세요.</div>
                )}
                {mapped.map((m) => (
                  <MappedRow
                    key={m.hash} map={m} disabled={busy}
                    onRelease={() => void release(m.hash)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 그림 변경용 파일 창 하나 — 어느 미니맵의 것인지는 swapId가 기억한다(위 주석). */}
      <input
        ref={swapRef} type="file" accept="image/*" hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          const target = images.find((i) => i.id === swapId);
          setSwapId(null);
          if (f && target) void swap(target, f);
        }}
      />

      {terrainTarget && (
        <TerrainReviewModal
          image={terrainTarget}
          anchors={terrainAnchors}
          reanalyzable
          onClose={() => setTerrainTarget(null)}
          onSaved={(updated) => setCatalog((prev) => (prev ? {
            ...prev,
            images: prev.images.map((im) => (im.id === updated.id ? updated : im)),
          } : prev))}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`"${confirmDelete.name}" 미니맵을 지울까요?`}
          message="여기 매핑돼 있던 맵들은 매핑이 풀리고, 다시 타일 격자 개략도로 그려집니다."
          confirmLabel="지우기"
          onConfirm={() => {
            const target = confirmDelete;
            setConfirmDelete(null);
            void remove(target);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
