import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Upload, Link2Off } from "lucide-react";
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
  const fileRef = useRef<HTMLInputElement>(null);

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
      <p className="scr-minimap-lead">
        경기 미니맵에 쓸 실제 그림을 먼저 등록하고, 리플레이에서 읽은 맵을 그 그림에 매핑합니다.
        매핑 안 된 맵은 리플레이 격자로 그린 개략도(썸네일 그림)가 그대로 쓰입니다. 이름·판본만
        다른 같은 맵은 한 미니맵에 여러 개를 매핑하세요.
      </p>

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
          <button
            type="button" className="scr-btn scr-btn-primary"
            onClick={() => fileRef.current?.click()} disabled={busy}
          >
            {busy ? <Spinner /> : <><Upload size={14} /> 그림 올려 등록</>}
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
          return (
            <div key={i.id} className="scr-minimap-group">
              <div className="scr-minimap-image-row">
                <img className="scr-minimap-thumb scr-minimap-thumb-lg" src={i.image} alt={i.name} />
                <span className="scr-minimap-map-text">
                  <span className="scr-minimap-map-name">{i.name}</span>
                  <span className="scr-minimap-map-meta">매핑된 맵 {mapped.length}개</span>
                </span>
                <button
                  type="button" className="scr-icon-btn"
                  onClick={() => setConfirmDelete(i)} disabled={busy}
                  aria-label={`${i.name} 지우기`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="scr-minimap-maps scr-minimap-maps-nested">
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
