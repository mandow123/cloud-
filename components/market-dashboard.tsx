"use client";

import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useLocale } from "@/components/locale-provider";
import type { Locale } from "@/lib/i18n";
import { formatPrice } from "@/lib/market";
import type { MarketSeries, ResourceCategory } from "@/lib/types";

const CATEGORY_ORDER: ResourceCategory[] = [
  "gpu",
  "rack_capacity",
  "cloud_vendor",
];

type Copy = { categories: Record<ResourceCategory, string>; empty: string; emptyHelp: string; title: string; lead: string; covered: string; window: string; days: string; dataBasis: string; dataNature: string; dailyData: string; noticeAria: string; notice: string; reference: string; infra: string; modelLink: string; tabs: string; benchmark: string; range: string; latest: string; samples: string; region: string; updated: string; average: string; trend: string; trendHelp: string; up: string; down: string; flat: string; conclusion: string; quartile: string; latestSnapshot: string; benchmarkCol: string; sampleCount: string; updatedAt: string; footnote: string };
const EN: Copy = { categories: { gpu: "GPU compute", token_model: "Token / models", rack_capacity: "Rack / capacity", cloud_vendor: "Cloud resources" }, empty: "No market sample for this category", emptyHelp: "Choose another resource category.", title: "China compute market", lead: "Compare heterogeneous GPU, Token, model, rack, and cloud resources using consistent price percentiles and pricing units.", covered: "Categories", window: "Observation window", days: "days", dataBasis: "Data basis", dataNature: "Data type", dailyData: "Daily catalog prices + initialization samples", noticeAria: "Data notice", notice: "Token and model data show public catalog prices and source status. GPU, rack, and cloud data use initialization samples until supplier verification.", reference: "Market reference · confirm by inquiry", infra: "Infrastructure compute market", modelLink: "View daily Token / model market", tabs: "Market resource categories", benchmark: "Benchmark", range: "Range", latest: "Latest P50 median", samples: "Daily samples", region: "Region", updated: "Updated", average: "average daily samples", trend: "Price percentile trend", trendHelp: "Band: P25–P75; line: P50 median", up: "rose", down: "fell", flat: "was broadly flat", conclusion: "Summary", quartile: "latest quartile range", latestSnapshot: "latest snapshot", benchmarkCol: "Benchmark", sampleCount: "Samples", updatedAt: "Updated", footnote: "P25, P50, and P75 are quartiles from initialization quote samples. They are verified as suppliers connect; confirm final terms by inquiry." };
const COPY: Record<Locale, Copy> = {
  en: EN,
  "zh-CN": { ...EN, categories: { gpu: "GPU 算力", token_model: "Token / 模型", rack_capacity: "整机柜 / 容量", cloud_vendor: "云厂商资源" }, empty: "暂无该分类行情样本", emptyHelp: "请选择其他资源分类查看市场行情。", title: "中国算力行情中心", lead: "将异构 GPU、Token、模型实例、机柜容量与云厂商资源，归一到可比较的价格分位和清晰计价口径。", covered: "覆盖分类", window: "观察窗口", days: "天", dataBasis: "数据口径", dataNature: "数据性质", dailyData: "日度目录价 + 初始化样本", noticeAria: "数据提示", notice: "Token / 模型板块展示公开目录价与来源状态；GPU、机柜和云厂商行情使用平台初始化样本，供应商接入后核验更新。", reference: "市场参考报价 · 具体以询价确认为准", infra: "基础设施算力行情", modelLink: "查看 Token / 模型日度行情", tabs: "行情资源分类", benchmark: "观察基准", range: "观察区间", latest: "最新 P50 中位价", samples: "当日样本", region: "区域", updated: "更新于", average: "平均每日样本", trend: "价格分位走势", trendHelp: "色带为 P25–P75，横线为 P50 中位价", up: "上涨", down: "下降", flat: "基本持平", conclusion: "文字结论", quartile: "最新四分位区间", latestSnapshot: "最新横截面", benchmarkCol: "基准", sampleCount: "样本量", updatedAt: "更新时间", footnote: "P25、P50、P75 为平台初始化报价样本的四分位统计；供应商接入后核验更新，具体以询价确认为准。" },
  "zh-TW": { categories: { gpu: "GPU 算力", token_model: "Token / 模型", rack_capacity: "整機櫃 / 容量", cloud_vendor: "雲端資源" }, empty: "此分類暫無行情樣本", emptyHelp: "請選擇其他資源分類。", title: "中國算力行情中心", lead: "以一致的價格分位與計價口徑比較異構算力資源。", covered: "涵蓋分類", window: "觀察窗口", days: "天", dataBasis: "資料口徑", dataNature: "資料性質", dailyData: "每日目錄價 + 初始化樣本", noticeAria: "資料提示", notice: "Token 與模型顯示公開目錄價及來源狀態；GPU、機櫃與雲端資料在供應商驗證前使用初始化樣本。", reference: "市場參考 · 最終以詢價確認", infra: "基礎設施算力行情", modelLink: "查看 Token / 模型每日行情", tabs: "行情資源分類", benchmark: "觀察基準", range: "觀察區間", latest: "最新 P50 中位價", samples: "當日樣本", region: "區域", updated: "更新於", average: "平均每日樣本", trend: "價格分位走勢", trendHelp: "色帶：P25–P75；線：P50 中位價", up: "上漲", down: "下跌", flat: "大致持平", conclusion: "摘要", quartile: "最新四分位區間", latestSnapshot: "最新橫截面", benchmarkCol: "基準", sampleCount: "樣本量", updatedAt: "更新時間", footnote: "P25、P50、P75 為初始化報價樣本的四分位數；供應商接入後驗證更新，最終條款以詢價確認。" },
  ja: { categories: { gpu: "GPU コンピュート", token_model: "Token / モデル", rack_capacity: "ラック / 容量", cloud_vendor: "クラウド資源" }, empty: "この分類の市場サンプルはありません", emptyHelp: "別の資源分類を選択してください。", title: "中国コンピュート市場", lead: "統一された価格分位と課金単位で異種計算資源を比較します。", covered: "対象分類", window: "観測期間", days: "日", dataBasis: "データ基準", dataNature: "データ種別", dailyData: "日次カタログ価格 + 初期サンプル", noticeAria: "データに関する注意", notice: "Token とモデルは公開カタログ価格と出典状態を表示します。GPU、ラック、クラウドはサプライヤー検証まで初期サンプルを使用します。", reference: "市場参考値 · 最終条件は問い合わせで確認", infra: "インフラ計算資源市場", modelLink: "Token / モデルの日次市場を見る", tabs: "市場資源の分類", benchmark: "基準", range: "期間", latest: "最新 P50 中央値", samples: "当日サンプル", region: "地域", updated: "更新", average: "1日平均サンプル", trend: "価格分位の推移", trendHelp: "帯：P25–P75、線：P50 中央値", up: "上昇", down: "下落", flat: "ほぼ横ばい", conclusion: "概要", quartile: "最新四分位範囲", latestSnapshot: "最新スナップショット", benchmarkCol: "基準", sampleCount: "サンプル数", updatedAt: "更新日時", footnote: "P25、P50、P75 は初期見積サンプルの四分位数です。サプライヤー接続後に検証し、最終条件は問い合わせで確認します。" },
  ko: { categories: { gpu: "GPU 컴퓨팅", token_model: "Token / 모델", rack_capacity: "랙 / 용량", cloud_vendor: "클라우드 리소스" }, empty: "이 분류의 시장 샘플이 없습니다", emptyHelp: "다른 리소스 분류를 선택하세요.", title: "중국 컴퓨팅 시장", lead: "일관된 가격 분위수와 과금 단위로 이기종 컴퓨팅 리소스를 비교합니다.", covered: "포함 분류", window: "관찰 기간", days: "일", dataBasis: "데이터 기준", dataNature: "데이터 유형", dailyData: "일일 카탈로그 가격 + 초기 샘플", noticeAria: "데이터 안내", notice: "Token과 모델은 공개 카탈로그 가격과 출처 상태를 표시합니다. GPU, 랙, 클라우드는 공급자 검증 전 초기 샘플을 사용합니다.", reference: "시장 참고값 · 최종 조건은 문의 확인", infra: "인프라 컴퓨팅 시장", modelLink: "Token / 모델 일일 시장 보기", tabs: "시장 리소스 분류", benchmark: "기준", range: "기간", latest: "최신 P50 중앙값", samples: "당일 샘플", region: "지역", updated: "업데이트", average: "일평균 샘플", trend: "가격 분위수 추이", trendHelp: "밴드: P25–P75, 선: P50 중앙값", up: "상승", down: "하락", flat: "대체로 보합", conclusion: "요약", quartile: "최신 사분위 범위", latestSnapshot: "최신 스냅샷", benchmarkCol: "기준", sampleCount: "샘플 수", updatedAt: "업데이트 시간", footnote: "P25, P50, P75는 초기 견적 샘플의 사분위수입니다. 공급자 연결 후 검증하며 최종 조건은 문의로 확인합니다." },
  fr: { categories: { gpu: "Calcul GPU", token_model: "Token / modèles", rack_capacity: "Rack / capacité", cloud_vendor: "Ressources cloud" }, empty: "Aucun échantillon pour cette catégorie", emptyHelp: "Choisissez une autre catégorie de ressources.", title: "Marché chinois du calcul", lead: "Comparez les ressources de calcul hétérogènes avec des percentiles et unités de prix cohérents.", covered: "Catégories couvertes", window: "Période d’observation", days: "jours", dataBasis: "Base des données", dataNature: "Type de données", dailyData: "Tarifs catalogue quotidiens + échantillons initiaux", noticeAria: "Avis sur les données", notice: "Les Token et modèles affichent les tarifs publics et l’état des sources. Les GPU, racks et clouds utilisent des échantillons initiaux avant validation fournisseur.", reference: "Référence marché · à confirmer sur demande", infra: "Marché du calcul d’infrastructure", modelLink: "Voir le marché quotidien Token / modèles", tabs: "Catégories de ressources", benchmark: "Référence", range: "Période", latest: "Dernière médiane P50", samples: "Échantillons du jour", region: "Région", updated: "Mis à jour", average: "échantillons moyens par jour", trend: "Tendance des percentiles", trendHelp: "Bande : P25–P75 ; ligne : médiane P50", up: "en hausse", down: "en baisse", flat: "globalement stable", conclusion: "Résumé", quartile: "dernière plage interquartile", latestSnapshot: "dernier instantané", benchmarkCol: "Référence", sampleCount: "Échantillons", updatedAt: "Mise à jour", footnote: "P25, P50 et P75 sont les quartiles des échantillons initiaux. Ils sont validés lors de l’intégration des fournisseurs ; confirmez les conditions finales sur demande." },
  th: { categories: { gpu: "พลังประมวลผล GPU", token_model: "Token / โมเดล", rack_capacity: "แร็ก / ความจุ", cloud_vendor: "ทรัพยากรคลาวด์" }, empty: "ไม่มีตัวอย่างตลาดสำหรับหมวดนี้", emptyHelp: "เลือกหมวดทรัพยากรอื่น", title: "ตลาดพลังประมวลผลจีน", lead: "เปรียบเทียบทรัพยากรประมวลผลต่างชนิดด้วยเปอร์เซ็นไทล์ราคาและหน่วยคิดราคาที่สอดคล้องกัน", covered: "หมวดที่ครอบคลุม", window: "ช่วงสังเกต", days: "วัน", dataBasis: "เกณฑ์ข้อมูล", dataNature: "ประเภทข้อมูล", dailyData: "ราคาตามแคตตาล็อกรายวัน + ตัวอย่างเริ่มต้น", noticeAria: "หมายเหตุข้อมูล", notice: "Token และโมเดลแสดงราคาสาธารณะและสถานะแหล่งข้อมูล ส่วน GPU แร็ก และคลาวด์ใช้ตัวอย่างเริ่มต้นก่อนผู้ให้บริการยืนยัน", reference: "ราคาอ้างอิงตลาด · ยืนยันขั้นสุดท้ายเมื่อสอบถาม", infra: "ตลาดโครงสร้างพื้นฐาน", modelLink: "ดูตลาด Token / โมเดลรายวัน", tabs: "หมวดทรัพยากรตลาด", benchmark: "เกณฑ์", range: "ช่วง", latest: "ค่ามัธยฐาน P50 ล่าสุด", samples: "ตัวอย่างวันนี้", region: "ภูมิภาค", updated: "อัปเดต", average: "ตัวอย่างเฉลี่ยต่อวัน", trend: "แนวโน้มเปอร์เซ็นไทล์ราคา", trendHelp: "แถบ: P25–P75; เส้น: ค่ามัธยฐาน P50", up: "เพิ่มขึ้น", down: "ลดลง", flat: "ค่อนข้างคงที่", conclusion: "สรุป", quartile: "ช่วงควอไทล์ล่าสุด", latestSnapshot: "ภาพรวมล่าสุด", benchmarkCol: "เกณฑ์", sampleCount: "จำนวนตัวอย่าง", updatedAt: "เวลาอัปเดต", footnote: "P25, P50 และ P75 เป็นควอไทล์ของตัวอย่างราคาเริ่มต้น จะตรวจสอบเมื่อผู้ให้บริการเชื่อมต่อ และยืนยันเงื่อนไขสุดท้ายเมื่อสอบถาม" },
  vi: { categories: { gpu: "Năng lực GPU", token_model: "Token / mô hình", rack_capacity: "Tủ máy / dung lượng", cloud_vendor: "Tài nguyên đám mây" }, empty: "Không có mẫu thị trường cho danh mục này", emptyHelp: "Hãy chọn danh mục tài nguyên khác.", title: "Thị trường năng lực Trung Quốc", lead: "So sánh tài nguyên tính toán khác loại bằng phân vị giá và đơn vị định giá thống nhất.", covered: "Danh mục bao phủ", window: "Khoảng quan sát", days: "ngày", dataBasis: "Cơ sở dữ liệu", dataNature: "Loại dữ liệu", dailyData: "Giá danh mục hằng ngày + mẫu khởi tạo", noticeAria: "Lưu ý dữ liệu", notice: "Token và mô hình hiển thị giá công khai cùng trạng thái nguồn. GPU, tủ máy và đám mây dùng mẫu khởi tạo trước khi nhà cung cấp xác minh.", reference: "Tham chiếu thị trường · xác nhận khi hỏi giá", infra: "Thị trường hạ tầng", modelLink: "Xem thị trường Token / mô hình hằng ngày", tabs: "Danh mục tài nguyên", benchmark: "Mốc tham chiếu", range: "Khoảng", latest: "Trung vị P50 mới nhất", samples: "Mẫu trong ngày", region: "Khu vực", updated: "Cập nhật", average: "mẫu trung bình mỗi ngày", trend: "Xu hướng phân vị giá", trendHelp: "Dải: P25–P75; đường: trung vị P50", up: "tăng", down: "giảm", flat: "gần như ổn định", conclusion: "Tóm tắt", quartile: "khoảng tứ phân vị mới nhất", latestSnapshot: "ảnh chụp mới nhất", benchmarkCol: "Mốc", sampleCount: "Số mẫu", updatedAt: "Thời gian cập nhật", footnote: "P25, P50 và P75 là các tứ phân vị của mẫu giá khởi tạo. Mẫu được xác minh khi nhà cung cấp kết nối; điều khoản cuối cùng xác nhận khi hỏi giá." },
  id: { categories: { gpu: "Komputasi GPU", token_model: "Token / model", rack_capacity: "Rak / kapasitas", cloud_vendor: "Sumber daya cloud" }, empty: "Tidak ada sampel pasar untuk kategori ini", emptyHelp: "Pilih kategori sumber daya lain.", title: "Pasar komputasi Tiongkok", lead: "Bandingkan sumber daya komputasi heterogen dengan persentil harga dan unit harga yang konsisten.", covered: "Kategori tercakup", window: "Periode pengamatan", days: "hari", dataBasis: "Dasar data", dataNature: "Jenis data", dailyData: "Harga katalog harian + sampel awal", noticeAria: "Catatan data", notice: "Token dan model menampilkan harga katalog publik serta status sumber. GPU, rak, dan cloud memakai sampel awal sebelum verifikasi pemasok.", reference: "Referensi pasar · konfirmasi melalui permintaan", infra: "Pasar komputasi infrastruktur", modelLink: "Lihat pasar Token / model harian", tabs: "Kategori sumber daya pasar", benchmark: "Tolok ukur", range: "Rentang", latest: "Median P50 terbaru", samples: "Sampel hari ini", region: "Wilayah", updated: "Diperbarui", average: "rata-rata sampel harian", trend: "Tren persentil harga", trendHelp: "Pita: P25–P75; garis: median P50", up: "naik", down: "turun", flat: "relatif stabil", conclusion: "Ringkasan", quartile: "rentang kuartil terbaru", latestSnapshot: "snapshot terbaru", benchmarkCol: "Tolok ukur", sampleCount: "Jumlah sampel", updatedAt: "Waktu pembaruan", footnote: "P25, P50, dan P75 adalah kuartil sampel penawaran awal. Sampel diverifikasi saat pemasok terhubung; konfirmasikan ketentuan akhir melalui permintaan." },
  ms: { categories: { gpu: "Pengkomputeran GPU", token_model: "Token / model", rack_capacity: "Rak / kapasiti", cloud_vendor: "Sumber awan" }, empty: "Tiada sampel pasaran untuk kategori ini", emptyHelp: "Pilih kategori sumber lain.", title: "Pasaran pengkomputeran China", lead: "Bandingkan sumber pengkomputeran heterogen dengan persentil harga dan unit harga yang konsisten.", covered: "Kategori diliputi", window: "Tempoh pemerhatian", days: "hari", dataBasis: "Asas data", dataNature: "Jenis data", dailyData: "Harga katalog harian + sampel awal", noticeAria: "Makluman data", notice: "Token dan model memaparkan harga katalog awam serta status sumber. GPU, rak dan awan menggunakan sampel awal sebelum pengesahan pembekal.", reference: "Rujukan pasaran · sahkan melalui pertanyaan", infra: "Pasaran pengkomputeran infrastruktur", modelLink: "Lihat pasaran Token / model harian", tabs: "Kategori sumber pasaran", benchmark: "Penanda aras", range: "Julat", latest: "Median P50 terkini", samples: "Sampel hari ini", region: "Wilayah", updated: "Dikemas kini", average: "purata sampel harian", trend: "Trend persentil harga", trendHelp: "Jalur: P25–P75; garis: median P50", up: "meningkat", down: "menurun", flat: "hampir stabil", conclusion: "Ringkasan", quartile: "julat kuartil terkini", latestSnapshot: "petikan terkini", benchmarkCol: "Penanda aras", sampleCount: "Bilangan sampel", updatedAt: "Masa kemas kini", footnote: "P25, P50 dan P75 ialah kuartil sampel tawaran awal. Sampel disahkan apabila pembekal bersambung; sahkan syarat akhir melalui pertanyaan." },
};

type RangeDays = 7 | 30 | 90;

function isCategory(value: string | null): value is ResourceCategory {
  return CATEGORY_ORDER.includes(value as ResourceCategory);
}

function isRange(value: string | null): value is `${RangeDays}` {
  return value === "7" || value === "30" || value === "90";
}

function dateLabel(value: string, locale: Locale, style: "short" | "full") { const date = new Date(`${value}T00:00:00Z`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, style === "short" ? { month: "numeric", day: "numeric", timeZone: "UTC" } : { dateStyle: "long", timeZone: "UTC" }).format(date); }

export function MarketDashboard({
  series,
  modelBoard,
}: {
  series: readonly MarketSeries[];
  modelBoard?: ReactNode;
}) {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const firstCategory = CATEGORY_ORDER.find((item) =>
    series.some((entry) => entry.category === item),
  ) ?? "gpu";
  const [category, setCategory] = useState<ResourceCategory>(firstCategory);
  const [range, setRange] = useState<RangeDays>(30);
  const [activeSeriesId, setActiveSeriesId] = useState("");

  const visibleSeries = useMemo(
    () => series.filter((entry) => entry.category === category),
    [category, series],
  );
  const activeSeries =
    visibleSeries.find((entry) => entry.id === activeSeriesId) ?? visibleSeries[0];
  const points = useMemo(
    () => activeSeries?.points.slice(-range) ?? [],
    [activeSeries, range],
  );

  useEffect(() => {
    function syncFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const nextCategory = params.get("category");
      const nextRange = params.get("range");
      const nextSeries = params.get("series");

      const resolvedCategory = isCategory(nextCategory) && series.some((entry) => entry.category === nextCategory)
        ? nextCategory
        : firstCategory;
      setCategory(resolvedCategory);
      setRange(isRange(nextRange) ? Number(nextRange) as RangeDays : 30);
      setActiveSeriesId(
        nextSeries && series.some((entry) => entry.id === nextSeries && entry.category === resolvedCategory)
          ? nextSeries
          : "",
      );
    }

    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [firstCategory, series]);

  function writeUrl(next: {
    category?: ResourceCategory;
    range?: RangeDays;
    seriesId?: string;
  }) {
    const params = new URLSearchParams(window.location.search);
    if (next.category) params.set("category", next.category);
    if (next.range) params.set("range", String(next.range));
    if (next.seriesId) params.set("series", next.seriesId);
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  function chooseCategory(nextCategory: ResourceCategory) {
    const nextSeries = series.find((entry) => entry.category === nextCategory);
    setCategory(nextCategory);
    setActiveSeriesId(nextSeries?.id ?? "");
    writeUrl({ category: nextCategory, seriesId: nextSeries?.id });
  }

  function chooseRange(nextRange: RangeDays) {
    setRange(nextRange);
    writeUrl({ range: nextRange });
  }

  function moveCategory(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? CATEGORY_ORDER.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + CATEGORY_ORDER.length) % CATEGORY_ORDER.length;
    const nextCategory = CATEGORY_ORDER[nextIndex];
    chooseCategory(nextCategory);
    document.getElementById(`market-tab-${nextCategory}`)?.focus();
  }

  if (!activeSeries || points.length === 0) {
    return (
      <div className="border-y border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
        <p className="m-0 text-lg font-semibold text-[var(--ink)]">{copy.empty}</p>
        <p className="mt-2 text-sm text-[var(--muted)]">{copy.emptyHelp}</p>
      </div>
    );
  }

  const latest = points[points.length - 1];
  const baseline = points[0];
  const change = baseline.p50 === 0 ? 0 : ((latest.p50 - baseline.p50) / baseline.p50) * 100;
  const allValues = points.flatMap((point) => [point.p25, point.p50, point.p75]);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const chartSpan = Math.max(maxValue - minValue, 1);
  const averageSamples = Math.round(
    points.reduce((total, point) => total + point.sampleCount, 0) / points.length,
  );
  const direction = change > 0.05 ? copy.up : change < -0.05 ? copy.down : copy.flat;

  return (
    <div>
      <section className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="shell py-14 sm:py-16">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
            <div>
              <p className="kicker">KAI Market Intelligence</p>
              <h1 className="m-0 max-w-4xl text-4xl leading-[1.08] text-[var(--ink)] sm:text-5xl">
                {copy.title}
              </h1>
              <p className="section-lead">
                {copy.lead}
              </p>
            </div>
            <dl className="m-0 grid grid-cols-2 border-t-2 border-[var(--accent)] bg-[var(--info-bg)]">
              <div className="border-b border-r border-[var(--border)] p-4">
                <dt className="text-xs font-semibold text-[var(--muted)]">{copy.covered}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--ink)]">4</dd>
              </div>
              <div className="border-b border-[var(--border)] p-4">
                <dt className="text-xs font-semibold text-[var(--muted)]">{copy.window}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--ink)]">90 {copy.days}</dd>
              </div>
              <div className="border-r border-[var(--border)] p-4">
                <dt className="text-xs font-semibold text-[var(--muted)]">{copy.dataBasis}</dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--ink)]">P25 / P50 / P75</dd>
              </div>
              <div className="p-4">
                <dt className="text-xs font-semibold text-[var(--muted)]">{copy.dataNature}</dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--accent)]">{copy.dailyData}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <div className="shell py-10 sm:py-12">
        <aside className="market-notice mb-8" aria-label={copy.noticeAria}>
          <p className="m-0">
            {copy.notice}
          </p>
          <p className="m-0 whitespace-nowrap font-semibold text-[var(--warning)]">{copy.reference}</p>
        </aside>

        {modelBoard ? (
          <div className="mb-14 scroll-mt-24" id="model-token-market">
            {modelBoard}
          </div>
        ) : null}

        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="kicker">Infrastructure market</p>
            <h2 className="m-0 text-2xl text-[var(--ink)]">{copy.infra}</h2>
          </div>
          <a className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent)] underline underline-offset-4" href="#model-token-market">
            {copy.modelLink}
          </a>
        </div>

        <div
          className="grid grid-cols-1 border-b border-[var(--border-strong)] sm:grid-cols-3"
          role="tablist"
          aria-label={copy.tabs}
        >
          {CATEGORY_ORDER.map((item, index) => {
            const selected = category === item;
            return (
              <button
                key={item}
                className={`min-h-12 cursor-pointer border-t-2 px-3 py-3 text-sm font-semibold transition-colors md:px-5 ${
                  selected
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]"
                    : "border-transparent bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--info-bg)]"
                }`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="market-infrastructure-panel"
                id={`market-tab-${item}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => chooseCategory(item)}
                onKeyDown={(event) => moveCategory(event, index)}
              >
                {copy.categories[item]}
              </button>
            );
          })}
        </div>

        <section
          className="mt-6 border border-[var(--border)] bg-[var(--surface)]"
          role="tabpanel"
          aria-labelledby={`market-tab-${category}`}
          id="market-infrastructure-panel"
        >
          <div className="grid border-b border-[var(--border)] lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="p-5 sm:p-6">
              <label className="block max-w-lg text-xs font-semibold text-[var(--muted)]" htmlFor="series-select">
                {copy.benchmark}
              </label>
              <select
                id="series-select"
                className="mt-2 min-h-11 w-full border border-[var(--border-strong)] bg-[var(--canvas)] px-3 text-sm font-semibold text-[var(--ink)] sm:w-auto sm:min-w-80"
                value={activeSeries.id}
                onChange={(event) => {
                  setActiveSeriesId(event.target.value);
                  writeUrl({ seriesId: event.target.value });
                }}
              >
                {visibleSeries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label} · {entry.region}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1 border-t border-[var(--border)] p-3 lg:border-t-0 lg:border-l">
              <span className="mr-2 text-xs font-semibold text-[var(--muted)]">{copy.range}</span>
              {([7, 30, 90] as RangeDays[]).map((days) => (
                <button
                  key={days}
                  type="button"
                  className={`min-h-11 min-w-14 cursor-pointer border px-3 text-sm font-semibold ${
                    range === days
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--border-strong)]"
                  }`}
                  aria-pressed={range === days}
                  onClick={() => chooseRange(days)}
                >
                  {days} {copy.days}
                </button>
              ))}
            </div>
          </div>

          <div className="grid xl:grid-cols-[300px_minmax(0,1fr)]">
            <div className="border-b border-[var(--border)] p-5 sm:p-6 xl:border-r xl:border-b-0">
              <p className="m-0 text-xs font-semibold tracking-wide text-[var(--muted)]">{copy.latest}</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums text-[var(--ink)]">
                {formatPrice(latest.p50, activeSeries.pricingUnit)}
              </p>
              <p className={`mt-2 text-sm font-semibold ${change >= 0 ? "text-[var(--warning)]" : "text-[var(--success)]"}`}>
                {change > 0 ? "+" : ""}{change.toFixed(1)}% / {range} {copy.days}
              </p>
              <dl className="mt-8 grid grid-cols-2 gap-x-5 gap-y-6">
                <div>
                  <dt className="text-xs text-[var(--muted)]">P25</dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums text-[var(--ink)]">
                    {formatPrice(latest.p25, activeSeries.pricingUnit)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted)]">P75</dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums text-[var(--ink)]">
                    {formatPrice(latest.p75, activeSeries.pricingUnit)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted)]">{copy.samples}</dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums text-[var(--ink)]">{latest.sampleCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted)]">{copy.region}</dt>
                  <dd className="mt-1 text-sm font-semibold text-[var(--ink)]">{activeSeries.region}</dd>
                </div>
              </dl>
              <div className="mt-8 border-t border-[var(--border)] pt-5">
                <p className="m-0 text-xs leading-5 text-[var(--muted)]">
                  {copy.updated} {activeSeries.updatedAt} · {copy.average} {averageSamples}
                </p>
              </div>
            </div>

            <div className="min-w-0 p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="m-0 text-lg text-[var(--ink)]">{copy.trend}</h2>
                  <p className="mt-1 text-xs text-[var(--muted)]">{copy.trendHelp}</p>
                </div>
                <div className="flex items-center gap-4 text-xs text-[var(--muted)]" aria-hidden="true">
                  <span className="flex items-center gap-2"><i className="h-3 w-3 bg-[var(--accent-soft)] ring-1 ring-[var(--border-strong)]" />P25–P75</span>
                  <span className="flex items-center gap-2"><i className="h-0.5 w-4 bg-[var(--accent)]" />P50</span>
                </div>
              </div>

              <div
                className="relative h-72 border-y border-[var(--border)] bg-[var(--info-bg)]"
                role="img"
                aria-label={`${activeSeries.label}: ${dateLabel(points[0].date, locale, "full")} – ${dateLabel(latest.date, locale, "full")}; P50 ${direction} ${Math.abs(change).toFixed(1)}%; ${copy.latest} ${formatPrice(latest.p50, activeSeries.pricingUnit)}.`}
              >
                {[0, 1, 2, 3, 4].map((line) => (
                  <div
                    key={line}
                    className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--border)]"
                    style={{ top: `${line * 25}%` }}
                    aria-hidden="true"
                  />
                ))}
                <div className="absolute inset-0 flex items-end gap-px px-1 pt-3" aria-hidden="true">
                  {points.map((point) => {
                    const p25 = ((point.p25 - minValue) / chartSpan) * 84 + 6;
                    const p50 = ((point.p50 - minValue) / chartSpan) * 84 + 6;
                    const p75 = ((point.p75 - minValue) / chartSpan) * 84 + 6;
                    return (
                      <div key={point.date} className="relative h-full min-w-1 flex-1">
                        <div
                          className="absolute inset-x-[12%] bg-[var(--accent-soft)] ring-1 ring-inset ring-[var(--border-strong)]"
                          style={{ bottom: `${p25}%`, height: `${Math.max(p75 - p25, 1.5)}%` }}
                        />
                        <div
                          className="absolute inset-x-0 h-0.5 bg-[var(--accent)]"
                          style={{ bottom: `${p50}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-2 flex justify-between text-xs tabular-nums text-[var(--muted)]" aria-hidden="true">
                <span>{dateLabel(points[0].date, locale, "short")}</span>
                <span>{dateLabel(points[Math.floor((points.length - 1) / 2)].date, locale, "short")}</span>
                <span>{dateLabel(latest.date, locale, "short")}</span>
              </div>
              <p className="mt-5 border-l-2 border-[var(--accent)] pl-4 text-sm leading-6 text-[var(--text)]">
                <strong className="text-[var(--ink)]">{copy.conclusion}: </strong>
                {range} {copy.days}, {activeSeries.label} P50 {direction}
                {Math.abs(change) > 0.05 ? ` ${Math.abs(change).toFixed(1)}%` : ""}; {copy.quartile}:
                {formatPrice(latest.p25, activeSeries.pricingUnit)} – {formatPrice(latest.p75, activeSeries.pricingUnit)}.
              </p>

              <table className="sr-only">
                <caption>{activeSeries.label} · {range} {copy.days}</caption>
                <thead><tr><th>{copy.updatedAt}</th><th>P25</th><th>P50</th><th>P75</th><th>{copy.sampleCount}</th></tr></thead>
                <tbody>
                  {points.map((point) => (
                    <tr key={point.date}>
                      <td>{point.date}</td><td>{point.p25}</td><td>{point.p50}</td><td>{point.p75}</td><td>{point.sampleCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="mt-14" aria-labelledby="market-snapshot-title">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="kicker">Latest snapshot</p>
              <h2 id="market-snapshot-title" className="m-0 text-2xl text-[var(--ink)]">{copy.categories[category]} · {copy.latestSnapshot}</h2>
            </div>
            <p className="m-0 text-xs text-[var(--muted)]">{copy.reference}</p>
          </div>
          <div className="data-table-wrap border border-[var(--border)]">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{copy.benchmarkCol}</th>
                  <th scope="col">{copy.region}</th>
                  <th className="num" scope="col">P25</th>
                  <th className="num" scope="col">P50</th>
                  <th className="num" scope="col">P75</th>
                  <th className="num" scope="col">{copy.sampleCount}</th>
                  <th scope="col">{copy.updatedAt}</th>
                </tr>
              </thead>
              <tbody>
                {visibleSeries.map((entry) => {
                  const point = entry.points[entry.points.length - 1];
                  return (
                    <tr key={entry.id}>
                      <th className="min-w-52 text-[var(--ink)]" scope="row">{entry.label}</th>
                      <td>{entry.region}</td>
                      <td className="num whitespace-nowrap">{formatPrice(point.p25, entry.pricingUnit)}</td>
                      <td className="num whitespace-nowrap font-semibold text-[var(--ink)]">{formatPrice(point.p50, entry.pricingUnit)}</td>
                      <td className="num whitespace-nowrap">{formatPrice(point.p75, entry.pricingUnit)}</td>
                      <td className="num">{point.sampleCount}</td>
                      <td className="whitespace-nowrap">{entry.updatedAt}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
            {copy.footnote}
          </p>
        </section>
      </div>
    </div>
  );
}
