import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import ReplayMapCanvas from "../../components/replay/ReplayMapCanvas";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import { Spinner } from "../../components/common/Feedback";
import { api } from "../../api/client";
import { useReplayMap } from "../../hooks/useReplayMap";
import { cleanMapName } from "../../utils/mapName";
import { cx } from "../../utils/format";
import type { MapCatalog, MapCatalogEntry, MinimapImage } from "../../types";

// 운영 메뉴의 "미니맵" 화면 — 맵마다 실제 미니맵 그림을 올려 두는 곳이다.
//
// 왜 사람이 올리나: 리플레이에는 타일 '번호'만 있고, 그 번호가 물인지 풀인지 언덕인지 적힌
// 표는 게임 설치본(cv5)에 있다. 번호만으로 갈라 보려는 시도를 네 번 했고 다 실패했다(자세한
// 내용은 ReplayMapCanvas 주석). 그림을 한 번 올려 두면 그 위에 아바타·화살표를 얹으므로
// 게임에서 보던 미니맵과 같은 그림이 된다(요청).
//
// 묶기: 이름이나 판본만 다른 거의 같은 맵이 여러 벌 돌아다닌다(빠른무한 계열). 맵은 격자
// 내용으로 구분하므로 그런 것들은 각각 다른 행이 되는데, 그림은 하나면 된다 — 그래서 맵을
// 여러 개 골라 한 그림에 묶는다(요청: "버전이나 이름이 다른 경우도 한데 묶을 수 있어야").
//
// 목록에는 그 맵의 격자 개략도를 함께 그린다(요청: "원래 미니맵 보여주던 렌더링 이미지를
// 보여주면 고르는 데 도움될 듯") — 이름이 "New Super빠른무한"처럼 비슷비슷해서 이름만으로는
// 어느 맵인지 못 가른다. 개략도는 격자를 그대로 그린 그림이라 두 맵이 정말 같은 판인지
// 눈으로 바로 확인된다.

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

/** 목록의 한 줄 — 격자 개략도(왼쪽)와 지금 쓰는 그림(오른쪽)을 나란히 보여준다. */
function MapRow({
  map, image, picked, disabled, onToggle,
}: {
  map: MapCatalogEntry;
  image: MinimapImage | undefined;
  picked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  // 격자는 경기 카드가 쓰는 것과 같은 경로로 받는다(해시별 캐시 + 한 번에 묶어 묻기).
  const grid = useReplayMap(map.hash);
  const name = cleanMapName(map.name ?? "") || "(이름 없음)";
  return (
    <label className={cx("scr-minimap-map-row", picked && "scr-minimap-map-row-on")}>
      <input type="checkbox" checked={picked} onChange={onToggle} disabled={disabled} />
      {/* 격자 개략도 — 어느 맵인지 알아보는 근거다(요청). */}
      <span className="scr-minimap-thumb scr-minimap-thumb-grid">
        {grid ? <ReplayMapCanvas grid={grid} /> : null}
      </span>
      {/* 지금 이 맵이 쓰는 그림 — 없으면 빈 칸이고, 그때는 위 개략도가 그대로 쓰인다. */}
      {image
        ? <img className="scr-minimap-thumb" src={image.image} alt={image.name} />
        : <span className="scr-minimap-thumb scr-minimap-thumb-empty" aria-hidden />}
      <span className="scr-minimap-map-text">
        <span className="scr-minimap-map-name">{name}</span>
        <span className="scr-minimap-map-meta">
          {map.width}×{map.height} · {map.matches}경기
          {image ? ` · ${image.name}` : " · 그림 없음"}
        </span>
      </span>
    </label>
  );
}

export default function MinimapScreen() {
  const [catalog, setCatalog] = useState<MapCatalog | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // 지금 고른 맵 해시들 — 여기 담긴 맵들이 함께 한 그림을 쓰게 된다.
  const [picked, setPicked] = useState<Set<string>>(new Set());
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
  const imageById = useMemo(() => new Map(images.map((i) => [i.id, i])), [images]);

  const toggle = (hash: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  };

  /** 고른 맵들에 새 그림을 올린다 — 이름을 비워 두면 첫 맵의 이름을 쓴다. */
  const upload = async (file: File) => {
    setErr("");
    setBusy(true);
    try {
      const image = await toDataUrl(file);
      const hashes = [...picked];
      const first = maps.find((m) => m.hash === hashes[0]);
      const label = name.trim() || cleanMapName(first?.name ?? "") || "미니맵";
      await api.createMinimapImage({ name: label, image, hashes });
      setPicked(new Set());
      setName("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "그림을 올리지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  /** 고른 맵들을 이미 올려 둔 그림에 묶는다(또는 imageId=null로 떼어 낸다). */
  const assign = async (imageId: number | null) => {
    if (picked.size === 0) return;
    setErr("");
    setBusy(true);
    try {
      await api.assignMinimapImage(imageId, [...picked]);
      setPicked(new Set());
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "묶지 못했어요.");
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
        경기 미니맵에 쓸 실제 그림을 맵마다 올려 둡니다. 그림이 없는 맵은 리플레이의 타일
        격자로 그린 개략도(왼쪽 그림)가 그대로 쓰입니다. 이름·판본만 다른 같은 맵은 여러 개를
        골라 한 그림에 묶으세요.
      </p>

      {err && <div className="scr-err">{err}</div>}

      <div className="scr-minimap-panel">
        <div className="scr-notice-edit-label">등록된 맵 {maps.length}개</div>
        <div className="scr-minimap-maps">
          {catalog === null && <Spinner />}
          {catalog !== null && maps.length === 0 && (
            <div className="scr-minimap-empty">
              아직 등록된 맵이 없어요 — 리플레이를 등록하면 여기 쌓입니다.
            </div>
          )}
          {maps.map((m) => (
            <MapRow
              key={m.hash} map={m}
              image={m.imageId !== null ? imageById.get(m.imageId) : undefined}
              picked={picked.has(m.hash)} disabled={busy}
              onToggle={() => toggle(m.hash)}
            />
          ))}
        </div>
      </div>

      <div className="scr-minimap-panel">
        <div className="scr-notice-edit-label">고른 맵 {picked.size}개에 그림 지정</div>
        <div className="scr-minimap-assign">
          <input
            className="scr-input"
            value={name} onChange={(e) => setName(e.target.value)}
            placeholder="그림 이름(비우면 맵 이름)"
            disabled={busy}
          />
          <button
            type="button" className="scr-btn scr-btn-primary"
            onClick={() => fileRef.current?.click()}
            disabled={busy || picked.size === 0}
          >
            {busy ? <Spinner /> : <><Upload size={14} /> 새 그림 올리기</>}
          </button>
          <input
            ref={fileRef} type="file" accept="image/*" hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
        </div>

        {/* 이미 올려 둔 그림에 묶기 — 이름·판본만 다른 맵을 여기로 모은다(요청). */}
        {images.length > 0 && (
          <div className="scr-minimap-images">
            {images.map((i) => (
              <div key={i.id} className="scr-minimap-image-row">
                <img className="scr-minimap-thumb" src={i.image} alt={i.name} />
                <span className="scr-minimap-map-text">
                  <span className="scr-minimap-map-name">{i.name}</span>
                  <span className="scr-minimap-map-meta">
                    {maps.filter((m) => m.imageId === i.id).length}개 맵이 사용
                  </span>
                </span>
                <button
                  type="button" className="scr-btn scr-btn-secondary"
                  onClick={() => void assign(i.id)} disabled={busy || picked.size === 0}
                >
                  이 그림 쓰기
                </button>
                <button
                  type="button" className="scr-icon-btn"
                  onClick={() => setConfirmDelete(i)} disabled={busy}
                  aria-label={`${i.name} 지우기`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button" className="scr-btn scr-btn-secondary scr-minimap-unassign"
          onClick={() => void assign(null)} disabled={busy || picked.size === 0}
        >
          고른 맵에서 그림 떼기
        </button>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`"${confirmDelete.name}" 그림을 지울까요?`}
          message="이 그림을 쓰던 맵들은 다시 타일 격자 개략도로 그려집니다."
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
