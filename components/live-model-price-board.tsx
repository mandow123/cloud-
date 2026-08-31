"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import {
  ModelPriceBoard,
  type ModelCostIndexSnapshot,
  type ModelTokenPriceQuote,
} from "@/components/model-price-board";
import type { Locale } from "@/lib/i18n";

type ModelSnapshot = {
  quotes: ModelTokenPriceQuote[];
  index: ModelCostIndexSnapshot;
  publishedAt: string;
};

const COPY: Record<Locale, { checking: string; failed: string; persistent: string; bundled: string; tiers: string; published: string; retry: string; requestId: string }> = {
  "zh-CN": { checking: "正在检查最新行情", failed: "最新检查失败，继续使用上一份安全快照", persistent: "已读取 06:00 持久化行情快照", bundled: "正在使用随版本发布的安全快照", tiers: "个模型价格档位", published: "发布于", retry: "重新检查", requestId: "请求编号" },
  "zh-TW": { checking: "正在檢查最新行情", failed: "最新檢查失敗，繼續使用上一份安全快照", persistent: "已讀取 06:00 持久化行情快照", bundled: "正在使用隨版本發布的安全快照", tiers: "個模型價格檔位", published: "發布於", retry: "重新檢查", requestId: "請求編號" },
  en: { checking: "Checking the latest market snapshot", failed: "Latest check failed; using the previous safe snapshot", persistent: "Loaded the persistent 06:00 market snapshot", bundled: "Using the safe snapshot bundled with this release", tiers: "model price tiers", published: "published", retry: "Check again", requestId: "Request ID" },
  ja: { checking: "最新市場を確認中", failed: "確認に失敗したため前回の安全なスナップショットを使用", persistent: "06:00 の永続スナップショットを読み込み済み", bundled: "リリース同梱の安全なスナップショットを使用中", tiers: "件のモデル価格", published: "公開", retry: "再確認", requestId: "リクエスト ID" },
  ko: { checking: "최신 시장 확인 중", failed: "확인 실패로 이전 안전 스냅샷 사용", persistent: "06:00 영구 시장 스냅샷 로드 완료", bundled: "릴리스에 포함된 안전 스냅샷 사용 중", tiers: "개 모델 가격", published: "게시", retry: "다시 확인", requestId: "요청 ID" },
  fr: { checking: "Vérification du dernier marché", failed: "Échec de la vérification ; instantané sûr précédent conservé", persistent: "Instantané persistant de 06:00 chargé", bundled: "Instantané sûr de la version utilisé", tiers: "niveaux de prix", published: "publié", retry: "Revérifier", requestId: "ID de requête" },
  th: { checking: "กำลังตรวจสอบตลาดล่าสุด", failed: "ตรวจสอบไม่สำเร็จ ใช้สแนปช็อตที่ปลอดภัยก่อนหน้า", persistent: "โหลดสแนปช็อตถาวร 06:00 แล้ว", bundled: "ใช้สแนปช็อตที่มากับรุ่น", tiers: "ระดับราคาโมเดล", published: "เผยแพร่", retry: "ตรวจอีกครั้ง", requestId: "รหัสคำขอ" },
  vi: { checking: "Đang kiểm tra thị trường mới nhất", failed: "Kiểm tra thất bại; tiếp tục dùng bản chụp an toàn trước", persistent: "Đã tải bản chụp 06:00", bundled: "Đang dùng bản chụp an toàn của phiên bản", tiers: "mức giá mô hình", published: "công bố", retry: "Kiểm tra lại", requestId: "Mã yêu cầu" },
  id: { checking: "Memeriksa pasar terbaru", failed: "Pemeriksaan gagal; memakai snapshot aman sebelumnya", persistent: "Snapshot persisten 06:00 dimuat", bundled: "Menggunakan snapshot aman dalam rilis", tiers: "tingkat harga model", published: "diterbitkan", retry: "Periksa lagi", requestId: "ID permintaan" },
  ms: { checking: "Menyemak pasaran terkini", failed: "Semakan gagal; menggunakan petikan selamat sebelumnya", persistent: "Petikan berterusan 06:00 dimuatkan", bundled: "Menggunakan petikan selamat dalam keluaran", tiers: "tahap harga model", published: "diterbitkan", retry: "Semak lagi", requestId: "ID permintaan" },
};

export function LiveModelPriceBoard({
  initialSnapshot,
  initialSource,
}: {
  initialSnapshot: ModelSnapshot;
  initialSource: "persistent" | "bundled";
}) {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [source, setSource] = useState<"persistent" | "bundled">(initialSource);
  const [refreshKey, setRefreshKey] = useState(0);
  const [checkState, setCheckState] = useState<"checking" | "ready" | "error">("checking");

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setCheckState("error");
      controller.abort();
    }, 12_000);
    fetch("/api/market", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("market unavailable");
        return response.json() as Promise<{ snapshot: ModelSnapshot; source: "persistent" | "bundled" }>;
      })
      .then((result) => {
        setSnapshot(result.snapshot);
        setSource(result.source);
        setCheckState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCheckState("error");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [refreshKey]);

  return (
    <div>
      <p className="mb-4 border-l-2 border-[var(--accent)] pl-3 text-sm text-[var(--text)]" role="status">
        {checkState === "checking"
          ? copy.checking
          : checkState === "error"
            ? copy.failed
            : source === "persistent" ? copy.persistent : copy.bundled}
        <span className="text-[var(--muted)]"> · {snapshot.quotes.length} {copy.tiers} · {copy.published} {new Date(snapshot.publishedAt).toLocaleString(locale, { timeZone: "Asia/Shanghai", hour12: false })}</span>
        {checkState === "error" ? <button className="ml-3 font-semibold text-[var(--accent)] underline" onClick={() => {
          setCheckState("checking");
          setRefreshKey((value) => value + 1);
        }} type="button">{copy.retry}</button> : null}
      </p>
      <ModelPriceBoard quotes={snapshot.quotes} index={snapshot.index} />
    </div>
  );
}
