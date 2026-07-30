import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Trash2, Upload } from "lucide-react";
import { Spinner } from "../components/common/Feedback";
import ConfirmDialog from "../components/common/ConfirmDialog";
import { api } from "../api/client";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { cleanMapName } from "../utils/mapName";
import { cx } from "../utils/format";
import type { MapCatalog, MapCatalogEntry, MinimapImage } from "../types";

interface MinimapManageModalProps {
  onClose: () => void;
}

// 제어판의 "미니맵 관리" — 맵마다 실제 미니맵 그림을 올려 두는 곳이다.
//
// 왜 사람이 올리나: 리플레이에는 타일 '번호'만 있고, 그 번호가 물인지 풀인지 언덕인지 적힌
// 표는 게임 설치본(cv5)에 있다. 번호만으로 갈라 보려는 시도를 네 번 했고 다 실패했다
// (빈도·응집도·순위·그룹 덩어리 — 자세한 내용은 ReplayMinimap 주석). 그림을 한 번 올려 두면
// 그 위에 아바타·화살표를 얹으므로 게임에서 보던 미니맵과 같은 그림이 된다(요청).
//
// 묶기: 이름이나 판본만 다른 거의 같은 맵이 여러 벌 돌아다닌다(빠른무한 계열). 맵은 격자
// 내용으로 구분하므로 그런 것들은 각각 다른 행이 되는데, 그림은 하나면 된다 — 그래서 맵을
// 여러 개 골라 한 그림에 묶는다(요청: "버전이나 이름이 다른 경우도 한데 묶을 수 있어야").

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

export default function MinimapManageModal({ onClose }: MinimapManageModalProps) {
  useLockBodyScroll();
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
  const imageById = useMemo(
    () => new Map(images.map((i) => [i.id, i])),
    [images],
  );

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

  const mapLabel = (m: MapCatalogEntry): string => cleanMapName(m.name ?? "") || "(이름 없음)";

  return createPortal(
    // 바깥을 눌러도 안 닫히게 한다(제어판과 같은 원칙) — 닫기는 헤더의 X 버튼으로만.
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm scr-minimap-manage">
        <div className="scr-modal-head">
          <span>미니맵 관리</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          {err && <div className="scr-err">{err}</div>}
          <div className="scr-notice-edit-label">등록된 맵</div>
          {/* 맵 목록 — 경기 수가 많은 것부터. 여러 개를 골라 한 그림에 묶을 수 있다(요청). */}
          <div className="scr-minimap-maps">
            {catalog === null && <Spinner />}
            {catalog !== null && maps.length === 0 && (
              <div className="scr-minimap-empty">아직 등록된 맵이 없어요 — 리플레이를 등록하면 여기 쌓입니다.</div>
            )}
            {maps.map((m) => {
              const img = m.imageId !== null ? imageById.get(m.imageId) : undefined;
              return (
                <label
                  key={m.hash}
                  className={cx("scr-minimap-map-row", picked.has(m.hash) && "scr-minimap-map-row-on")}
                >
                  <input
                    type="checkbox" checked={picked.has(m.hash)}
                    onChange={() => toggle(m.hash)} disabled={busy}
                  />
                  {/* 지금 이 맵이 쓰는 그림 — 없으면 빈 칸이고 격자 개략도로 그려진다. */}
                  {img
                    ? <img className="scr-minimap-thumb" src={img.image} alt={img.name} />
                    : <span className="scr-minimap-thumb scr-minimap-thumb-empty" aria-hidden />}
                  <span className="scr-minimap-map-text">
                    <span className="scr-minimap-map-name">{mapLabel(m)}</span>
                    <span className="scr-minimap-map-meta">
                      {m.width}×{m.height} · {m.matches}경기
                      {img ? ` · ${img.name}` : " · 그림 없음"}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="scr-notice-settings-divider" />

          {/* 고른 맵에 그림을 붙이는 부분 — 새로 올리거나, 이미 올려 둔 그림에 묶는다. */}
          <div className="scr-notice-edit-label">
            고른 맵 {picked.size}개에 그림 지정
          </div>
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
              {busy ? <Spinner /> : <><Upload size={13} /> 새 그림 올리기</>}
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
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`"${confirmDelete.name}" 그림을 지울까요?`}
          message="이 그림을 쓰던 맵들은 다시 타일 격자로 그려집니다."
          confirmLabel="지우기"
          onConfirm={() => {
            const target = confirmDelete;
            setConfirmDelete(null);
            void remove(target);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>,
    document.body,
  );
}
