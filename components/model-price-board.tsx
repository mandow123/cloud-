"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import type { Locale } from "@/lib/i18n";

export type ModelMarketScope = "domestic" | "international";
export type ModelCapability = "text" | "reasoning" | "multimodal" | "embedding";
export type ModelPriceSourceStatus =
  | "official_api"
  | "official_page"
  | "aggregated"
  | "provider_quote"
  | "estimated";

export interface ModelTokenPriceQuote {
  id: string;
  vendor: string;
  model: string;
  market: ModelMarketScope;
  categories: readonly ModelCapability[];
  inputCnyPerMillion: number | null;
  cachedInputCnyPerMillion: number | null;
  outputCnyPerMillion: number | null;
  originalCurrency: string;
  originalInputPerMillion?: number | null;
  originalCachedInputPerMillion?: number | null;
  originalOutputPerMillion?: number | null;
  sourceName: string;
  sourceUrl?: string;
  officialSourceName?: string;
  officialSourceUrl?: string;
  sourceStatus: ModelPriceSourceStatus;
  updatedAt: string;
  isStale: boolean;
  serviceTier: string;
  contextBand: string;
  freshness?: {
    state?: "current" | "official_only" | "stale" | "review_required";
  };
  availabilityNote?: string;
}

export interface ModelCostIndexSnapshot {
  name?: string;
  value: number;
  baseDate: string;
  updatedAt: string;
  change1d?: number | null;
  change30d?: number | null;
  sampleSize?: number;
}

export interface ModelPriceBoardProps {
  quotes: readonly ModelTokenPriceQuote[];
  index: ModelCostIndexSnapshot;
  className?: string;
}

type MarketFilter = "all" | ModelMarketScope;
type CapabilityFilter = "all" | ModelCapability;
type FreshnessFilter = "all" | "validated" | "official" | "review";

type Copy = { markets: Record<ModelMarketScope, string>; capabilities: Record<ModelCapability, string>; sources: Record<ModelPriceSourceStatus, string>; title: string; intro: string; update: string; indexName: string; base: string; day1: string; day30: string; noHistory: string; indexNote: string; baseDate: string; updated: string; sample: string; search: string; placeholder: string; market: string; allMarkets: string; category: string; allCategories: string; freshness: string; allStatuses: string; validated: string; official: string; review: string; clear: string; showing: string; tiers: string; models: string; vendors: string; noMatch: string; noMatchHelp: string; allModels: string; vendorModel: string; scopeCategory: string; input: string; cached: string; output: string; original: string; sourceUpdated: string; cnyUnit: string; source: string; timeZone: string; shown: string; showMore: string; unavailable: string; normalized: string; serviceTier: string; context: string; newWindow: string; officialReview: string; viewSource: string; up: string; down: string; flat: string };
const EN: Copy = { markets: { domestic: "Domestic", international: "International" }, capabilities: { text: "Text", reasoning: "Reasoning", multimodal: "Multimodal", embedding: "Embedding" }, sources: { official_api: "Official API", official_page: "Official page", aggregated: "Aggregated · official review pending", provider_quote: "Provider quote", estimated: "KAI estimate" }, title: "Mainstream model Token prices", intro: "Prices are separated by service tier, context, input, cached input and output while preserving original currency and source status. CNY values use CNY / million Token. Confirm final terms by inquiry.", update: "Updated daily at 06:00 China Standard Time · previous complete version retained on failure", indexName: "KAI model invocation cost index", base: "Base 100", day1: "1-day change", day30: "30-day change", noHistory: "Building history; no complete 30-day change yet.", indexNote: "This index shows the relative cost trend of a fixed model basket and is not an average CNY price or a substitute for any quote.", baseDate: "Base", updated: "Updated", sample: "Samples", search: "Search vendor, model, or tier", placeholder: "e.g. DeepSeek, Qwen, GPT", market: "Market scope", allMarkets: "Domestic and international", category: "Model category", allCategories: "All categories", freshness: "Data freshness", allStatuses: "All statuses", validated: "Automatically validated", official: "Official review baseline", review: "Manual review required", clear: "Clear filters", showing: "Showing", tiers: "price tiers", models: "models", vendors: "vendors", noMatch: "No matching model prices", noMatchHelp: "Clear some filters or check the vendor and model name.", allModels: "View all models", vendorModel: "Vendor / model", scopeCategory: "Scope / category", input: "Input", cached: "Cached input", output: "Output", original: "Original currency / million Token", sourceUpdated: "Source / updated", cnyUnit: "CNY / million Token", source: "Data source", timeZone: "China Standard Time", shown: "shown", showMore: "Show 20 more", unavailable: "Not published or not applicable", normalized: "Normalized CNY price", serviceTier: "Service tier", context: "Context", newWindow: "opens in a new window", officialReview: "Official review page", viewSource: "View source", up: "up", down: "down", flat: "flat" };
const COPY: Record<Locale, Copy> = {
  en: EN,
  "zh-CN": { ...EN, markets: { domestic: "国内", international: "国际" }, capabilities: { text: "文本", reasoning: "推理", multimodal: "多模态", embedding: "嵌入" }, sources: { official_api: "官方 API", official_page: "官方页面", aggregated: "聚合目录·待官方复核", provider_quote: "供应方报盘", estimated: "KAI 估算" }, title: "主流模型 Token 分项行情", intro: "每个模型按服务档位、上下文档位、输入、缓存输入和输出分别报价，并保留原币种与来源状态。人民币价格统一为“元 / 百万 Token”，具体以询价确认为准。", update: "每日 06:00（北京时间）更新 · 失败时保留上一版，不发布半表", indexName: "KAI 模型调用成本指数", base: "基期 100", day1: "1 日变化", day30: "30 日变化", noHistory: "历史样本积累中，暂无完整 30 日变化。", indexNote: "该指数仅表达固定模型篮子相对基期的成本趋势，不是跨模型人民币均价，也不能替代实际报价。", baseDate: "基期", updated: "更新", sample: "样本", search: "搜索厂商、模型或档位", placeholder: "例如：DeepSeek、Qwen、GPT", market: "市场范围", allMarkets: "国内与国际", category: "模型分类", allCategories: "全部分类", freshness: "数据新鲜度", allStatuses: "全部状态", validated: "已通过自动校验", official: "官方审核基线", review: "需人工复核", clear: "清除筛选", showing: "显示", tiers: "个价格档", models: "个具体模型", vendors: "家厂商", noMatch: "没有匹配的模型行情", noMatchHelp: "可清除部分筛选，或检查厂商与模型名称。", allModels: "查看全部模型", vendorModel: "厂商 / 模型", scopeCategory: "范围 / 分类", input: "输入", cached: "缓存输入", output: "输出", original: "原币种 / 百万 Token", sourceUpdated: "来源 / 更新时间", cnyUnit: "人民币元 / 百万 Token", source: "数据来源", timeZone: "北京时间", shown: "已显示", showMore: "再显示 20 条", unavailable: "未公布或不适用", normalized: "人民币标准化价格", serviceTier: "服务档", context: "上下文", newWindow: "在新窗口打开", officialReview: "官方复核页", viewSource: "查看来源", up: "上涨", down: "下降", flat: "持平" },
  "zh-TW": { markets: { domestic: "國內", international: "國際" }, capabilities: { text: "文字", reasoning: "推理", multimodal: "多模態", embedding: "嵌入" }, sources: { official_api: "官方 API", official_page: "官方頁面", aggregated: "彙總目錄·待官方複核", provider_quote: "供應商報價", estimated: "KAI 估算" }, title: "主流模型 Token 分項行情", intro: "按服務與上下文檔位分列輸入、快取輸入和輸出價格，並保留原幣種及來源狀態。人民幣統一為每百萬 Token，最終條款以詢價為準。", update: "每日北京時間 06:00 更新 · 失敗時保留上一個完整版本", indexName: "KAI 模型呼叫成本指數", base: "基期 100", day1: "1 日變化", day30: "30 日變化", noHistory: "歷史樣本累積中，暫無完整 30 日變化。", indexNote: "此指數只表示固定模型籃子相對基期的成本趨勢，並非平均人民幣價格，也不能取代實際報價。", baseDate: "基期", updated: "更新", sample: "樣本", search: "搜尋供應商、模型或檔位", placeholder: "例如：DeepSeek、Qwen、GPT", market: "市場範圍", allMarkets: "國內與國際", category: "模型分類", allCategories: "全部分類", freshness: "資料新鮮度", allStatuses: "全部狀態", validated: "已通過自動校驗", official: "官方複核基線", review: "需人工複核", clear: "清除篩選", showing: "顯示", tiers: "個價格檔", models: "個模型", vendors: "家供應商", noMatch: "沒有符合的模型行情", noMatchHelp: "請清除部分篩選或檢查供應商與模型名稱。", allModels: "查看全部模型", vendorModel: "供應商 / 模型", scopeCategory: "範圍 / 分類", input: "輸入", cached: "快取輸入", output: "輸出", original: "原幣種 / 百萬 Token", sourceUpdated: "來源 / 更新時間", cnyUnit: "人民幣元 / 百萬 Token", source: "資料來源", timeZone: "北京時間", shown: "已顯示", showMore: "再顯示 20 項", unavailable: "未公布或不適用", normalized: "人民幣標準化價格", serviceTier: "服務檔位", context: "上下文", newWindow: "在新視窗開啟", officialReview: "官方複核頁", viewSource: "查看來源", up: "上漲", down: "下跌", flat: "持平" },
  ja: { markets: { domestic: "国内", international: "海外" }, capabilities: { text: "テキスト", reasoning: "推論", multimodal: "マルチモーダル", embedding: "埋め込み" }, sources: { official_api: "公式 API", official_page: "公式ページ", aggregated: "集約カタログ・公式確認待ち", provider_quote: "プロバイダー見積", estimated: "KAI 推定" }, title: "主要モデルの Token 価格", intro: "サービス階層、コンテキスト、入力、キャッシュ入力、出力ごとに価格を分け、元通貨と出典状態を保持します。人民元は 100 万 Token あたりで表示し、最終条件は問い合わせで確認します。", update: "毎日中国標準時 06:00 更新 · 失敗時は直前の完全版を保持", indexName: "KAI モデル呼び出しコスト指数", base: "基準 100", day1: "1日変化", day30: "30日変化", noHistory: "履歴を蓄積中のため、完全な30日変化はまだありません。", indexNote: "固定モデルバスケットの基準比コスト推移を示す指数で、人民元平均価格や実際の見積の代替ではありません。", baseDate: "基準日", updated: "更新", sample: "サンプル", search: "プロバイダー、モデル、階層を検索", placeholder: "例：DeepSeek、Qwen、GPT", market: "市場範囲", allMarkets: "国内・海外", category: "モデル分類", allCategories: "全分類", freshness: "データ鮮度", allStatuses: "全ステータス", validated: "自動検証済み", official: "公式確認基準", review: "手動確認が必要", clear: "絞り込みを解除", showing: "表示中", tiers: "価格階層", models: "モデル", vendors: "プロバイダー", noMatch: "一致するモデル価格はありません", noMatchHelp: "一部の絞り込みを解除するか、プロバイダー名とモデル名を確認してください。", allModels: "全モデルを表示", vendorModel: "プロバイダー / モデル", scopeCategory: "範囲 / 分類", input: "入力", cached: "キャッシュ入力", output: "出力", original: "元通貨 / 100万 Token", sourceUpdated: "出典 / 更新", cnyUnit: "人民元 / 100万 Token", source: "データ出典", timeZone: "中国標準時", shown: "表示済み", showMore: "さらに20件表示", unavailable: "未公表または対象外", normalized: "人民元換算価格", serviceTier: "サービス階層", context: "コンテキスト", newWindow: "新しいウィンドウで開く", officialReview: "公式確認ページ", viewSource: "出典を見る", up: "上昇", down: "下落", flat: "横ばい" },
  ko: { markets: { domestic: "국내", international: "해외" }, capabilities: { text: "텍스트", reasoning: "추론", multimodal: "멀티모달", embedding: "임베딩" }, sources: { official_api: "공식 API", official_page: "공식 페이지", aggregated: "통합 카탈로그·공식 검토 대기", provider_quote: "공급자 견적", estimated: "KAI 추정" }, title: "주요 모델 Token 가격", intro: "서비스 등급, 컨텍스트, 입력, 캐시 입력, 출력별 가격을 구분하고 원래 통화와 출처 상태를 유지합니다. CNY는 백만 Token 단위이며 최종 조건은 문의로 확인합니다.", update: "매일 중국 표준시 06:00 업데이트 · 실패 시 이전 완전판 유지", indexName: "KAI 모델 호출 비용 지수", base: "기준 100", day1: "1일 변화", day30: "30일 변화", noHistory: "기록을 축적 중이며 완전한 30일 변화는 아직 없습니다.", indexNote: "고정 모델 바스켓의 기준 대비 비용 추이를 나타낼 뿐 평균 CNY 가격이나 실제 견적을 대신하지 않습니다.", baseDate: "기준일", updated: "업데이트", sample: "샘플", search: "공급자, 모델 또는 등급 검색", placeholder: "예: DeepSeek, Qwen, GPT", market: "시장 범위", allMarkets: "국내 및 해외", category: "모델 분류", allCategories: "전체 분류", freshness: "데이터 신선도", allStatuses: "전체 상태", validated: "자동 검증 완료", official: "공식 검토 기준", review: "수동 검토 필요", clear: "필터 지우기", showing: "표시", tiers: "가격 등급", models: "모델", vendors: "공급자", noMatch: "일치하는 모델 가격이 없습니다", noMatchHelp: "일부 필터를 지우거나 공급자와 모델 이름을 확인하세요.", allModels: "모든 모델 보기", vendorModel: "공급자 / 모델", scopeCategory: "범위 / 분류", input: "입력", cached: "캐시 입력", output: "출력", original: "원 통화 / 백만 Token", sourceUpdated: "출처 / 업데이트", cnyUnit: "CNY / 백만 Token", source: "데이터 출처", timeZone: "중국 표준시", shown: "표시됨", showMore: "20개 더 보기", unavailable: "미공개 또는 해당 없음", normalized: "CNY 표준화 가격", serviceTier: "서비스 등급", context: "컨텍스트", newWindow: "새 창에서 열기", officialReview: "공식 검토 페이지", viewSource: "출처 보기", up: "상승", down: "하락", flat: "보합" },
  fr: { markets: { domestic: "National", international: "International" }, capabilities: { text: "Texte", reasoning: "Raisonnement", multimodal: "Multimodal", embedding: "Vectorisation" }, sources: { official_api: "API officielle", official_page: "Page officielle", aggregated: "Catalogue agrégé · validation officielle en attente", provider_quote: "Devis fournisseur", estimated: "Estimation KAI" }, title: "Prix Token des principaux modèles", intro: "Les prix sont séparés par niveau de service, contexte, entrée, entrée en cache et sortie, tout en conservant la devise et l’état de la source. Les montants CNY sont par million de Token ; confirmez les conditions finales sur demande.", update: "Mise à jour quotidienne à 06:00, heure de Chine · version complète précédente conservée en cas d’échec", indexName: "Indice KAI du coût d’appel des modèles", base: "Base 100", day1: "Variation 1 jour", day30: "Variation 30 jours", noHistory: "Historique en cours de constitution ; variation complète sur 30 jours indisponible.", indexNote: "Cet indice suit le coût relatif d’un panier fixe de modèles. Ce n’est ni un prix moyen en CNY ni un remplacement d’un devis réel.", baseDate: "Date de base", updated: "Mis à jour", sample: "Échantillons", search: "Rechercher fournisseur, modèle ou niveau", placeholder: "ex. DeepSeek, Qwen, GPT", market: "Marché", allMarkets: "National et international", category: "Catégorie", allCategories: "Toutes les catégories", freshness: "Fraîcheur des données", allStatuses: "Tous les états", validated: "Validation automatique réussie", official: "Référence officielle", review: "Révision manuelle requise", clear: "Effacer les filtres", showing: "Affichage", tiers: "niveaux de prix", models: "modèles", vendors: "fournisseurs", noMatch: "Aucun prix correspondant", noMatchHelp: "Effacez certains filtres ou vérifiez le fournisseur et le modèle.", allModels: "Voir tous les modèles", vendorModel: "Fournisseur / modèle", scopeCategory: "Marché / catégorie", input: "Entrée", cached: "Entrée en cache", output: "Sortie", original: "Devise d’origine / million Token", sourceUpdated: "Source / mise à jour", cnyUnit: "CNY / million Token", source: "Source des données", timeZone: "Heure de Chine", shown: "affichés", showMore: "Afficher 20 de plus", unavailable: "Non publié ou non applicable", normalized: "Prix normalisé en CNY", serviceTier: "Niveau de service", context: "Contexte", newWindow: "ouvre une nouvelle fenêtre", officialReview: "Page de vérification officielle", viewSource: "Voir la source", up: "hausse", down: "baisse", flat: "stable" },
  th: { markets: { domestic: "ในประเทศ", international: "ต่างประเทศ" }, capabilities: { text: "ข้อความ", reasoning: "การให้เหตุผล", multimodal: "หลายรูปแบบ", embedding: "เวกเตอร์" }, sources: { official_api: "API ทางการ", official_page: "หน้าทางการ", aggregated: "แคตตาล็อกรวม · รอตรวจสอบทางการ", provider_quote: "ใบเสนอราคาผู้ให้บริการ", estimated: "ประมาณการ KAI" }, title: "ราคา Token ของโมเดลหลัก", intro: "แยกราคาตามระดับบริการ บริบท อินพุต อินพุตแคช และเอาต์พุต พร้อมคงสกุลเงินและสถานะแหล่งข้อมูล ราคา CNY คิดต่อหนึ่งล้าน Token และต้องยืนยันเงื่อนไขสุดท้ายเมื่อสอบถาม", update: "อัปเดตทุกวัน 06:00 น. ตามเวลาจีน · หากล้มเหลวจะคงเวอร์ชันสมบูรณ์ก่อนหน้า", indexName: "ดัชนีต้นทุนเรียกใช้โมเดล KAI", base: "ฐาน 100", day1: "เปลี่ยนแปลง 1 วัน", day30: "เปลี่ยนแปลง 30 วัน", noHistory: "กำลังสะสมประวัติ ยังไม่มีการเปลี่ยนแปลง 30 วันที่สมบูรณ์", indexNote: "ดัชนีนี้แสดงแนวโน้มต้นทุนของชุดโมเดลคงที่เทียบฐาน ไม่ใช่ราคาเฉลี่ย CNY และไม่แทนใบเสนอราคาจริง", baseDate: "วันที่ฐาน", updated: "อัปเดต", sample: "ตัวอย่าง", search: "ค้นหาผู้ให้บริการ โมเดล หรือระดับ", placeholder: "เช่น DeepSeek, Qwen, GPT", market: "ขอบเขตตลาด", allMarkets: "ในประเทศและต่างประเทศ", category: "ประเภทโมเดล", allCategories: "ทุกประเภท", freshness: "ความใหม่ของข้อมูล", allStatuses: "ทุกสถานะ", validated: "ตรวจสอบอัตโนมัติแล้ว", official: "เกณฑ์ตรวจสอบทางการ", review: "ต้องตรวจสอบด้วยคน", clear: "ล้างตัวกรอง", showing: "กำลังแสดง", tiers: "ระดับราคา", models: "โมเดล", vendors: "ผู้ให้บริการ", noMatch: "ไม่พบราคาที่ตรงกัน", noMatchHelp: "ล้างตัวกรองบางส่วนหรือตรวจสอบชื่อผู้ให้บริการและโมเดล", allModels: "ดูทุกโมเดล", vendorModel: "ผู้ให้บริการ / โมเดล", scopeCategory: "ขอบเขต / ประเภท", input: "อินพุต", cached: "อินพุตแคช", output: "เอาต์พุต", original: "สกุลเงินเดิม / ล้าน Token", sourceUpdated: "แหล่งข้อมูล / อัปเดต", cnyUnit: "CNY / ล้าน Token", source: "แหล่งข้อมูล", timeZone: "เวลาจีน", shown: "แสดงแล้ว", showMore: "แสดงเพิ่ม 20 รายการ", unavailable: "ไม่เผยแพร่หรือไม่เกี่ยวข้อง", normalized: "ราคามาตรฐาน CNY", serviceTier: "ระดับบริการ", context: "บริบท", newWindow: "เปิดในหน้าต่างใหม่", officialReview: "หน้าตรวจสอบทางการ", viewSource: "ดูแหล่งข้อมูล", up: "เพิ่มขึ้น", down: "ลดลง", flat: "คงที่" },
  vi: { markets: { domestic: "Trong nước", international: "Quốc tế" }, capabilities: { text: "Văn bản", reasoning: "Suy luận", multimodal: "Đa phương thức", embedding: "Nhúng" }, sources: { official_api: "API chính thức", official_page: "Trang chính thức", aggregated: "Danh mục tổng hợp · chờ xác minh chính thức", provider_quote: "Báo giá nhà cung cấp", estimated: "Ước tính KAI" }, title: "Giá Token của các mô hình chính", intro: "Giá được tách theo cấp dịch vụ, ngữ cảnh, đầu vào, đầu vào cache và đầu ra, đồng thời giữ nguyên tiền tệ và trạng thái nguồn. Giá CNY tính trên một triệu Token; xác nhận điều khoản cuối cùng khi hỏi giá.", update: "Cập nhật hằng ngày lúc 06:00 giờ Trung Quốc · giữ bản đầy đủ trước đó nếu thất bại", indexName: "Chỉ số chi phí gọi mô hình KAI", base: "Mốc 100", day1: "Thay đổi 1 ngày", day30: "Thay đổi 30 ngày", noHistory: "Đang tích lũy lịch sử; chưa có thay đổi đủ 30 ngày.", indexNote: "Chỉ số thể hiện xu hướng chi phí tương đối của một rổ mô hình cố định, không phải giá CNY trung bình và không thay thế báo giá thực tế.", baseDate: "Ngày gốc", updated: "Cập nhật", sample: "Mẫu", search: "Tìm nhà cung cấp, mô hình hoặc cấp", placeholder: "ví dụ DeepSeek, Qwen, GPT", market: "Phạm vi thị trường", allMarkets: "Trong nước và quốc tế", category: "Loại mô hình", allCategories: "Tất cả loại", freshness: "Độ mới dữ liệu", allStatuses: "Tất cả trạng thái", validated: "Đã xác minh tự động", official: "Mốc xác minh chính thức", review: "Cần rà soát thủ công", clear: "Xóa bộ lọc", showing: "Đang hiển thị", tiers: "cấp giá", models: "mô hình", vendors: "nhà cung cấp", noMatch: "Không có giá phù hợp", noMatchHelp: "Xóa một số bộ lọc hoặc kiểm tra tên nhà cung cấp và mô hình.", allModels: "Xem tất cả mô hình", vendorModel: "Nhà cung cấp / mô hình", scopeCategory: "Phạm vi / loại", input: "Đầu vào", cached: "Đầu vào cache", output: "Đầu ra", original: "Tiền tệ gốc / triệu Token", sourceUpdated: "Nguồn / cập nhật", cnyUnit: "CNY / triệu Token", source: "Nguồn dữ liệu", timeZone: "Giờ Trung Quốc", shown: "đã hiển thị", showMore: "Hiển thị thêm 20", unavailable: "Chưa công bố hoặc không áp dụng", normalized: "Giá chuẩn hóa CNY", serviceTier: "Cấp dịch vụ", context: "Ngữ cảnh", newWindow: "mở trong cửa sổ mới", officialReview: "Trang xác minh chính thức", viewSource: "Xem nguồn", up: "tăng", down: "giảm", flat: "ổn định" },
  id: { markets: { domestic: "Domestik", international: "Internasional" }, capabilities: { text: "Teks", reasoning: "Penalaran", multimodal: "Multimodal", embedding: "Embedding" }, sources: { official_api: "API resmi", official_page: "Halaman resmi", aggregated: "Katalog agregat · menunggu tinjauan resmi", provider_quote: "Penawaran penyedia", estimated: "Estimasi KAI" }, title: "Harga Token model utama", intro: "Harga dipisahkan menurut tingkat layanan, konteks, input, input cache, dan output, sambil mempertahankan mata uang serta status sumber. Nilai CNY per satu juta Token; konfirmasikan ketentuan akhir melalui permintaan.", update: "Diperbarui setiap hari pukul 06.00 waktu Tiongkok · versi lengkap sebelumnya dipertahankan jika gagal", indexName: "Indeks biaya pemanggilan model KAI", base: "Dasar 100", day1: "Perubahan 1 hari", day30: "Perubahan 30 hari", noHistory: "Riwayat sedang dibangun; perubahan 30 hari lengkap belum tersedia.", indexNote: "Indeks ini menunjukkan tren biaya relatif dari keranjang model tetap, bukan harga rata-rata CNY dan bukan pengganti penawaran nyata.", baseDate: "Tanggal dasar", updated: "Diperbarui", sample: "Sampel", search: "Cari penyedia, model, atau tingkat", placeholder: "mis. DeepSeek, Qwen, GPT", market: "Cakupan pasar", allMarkets: "Domestik dan internasional", category: "Kategori model", allCategories: "Semua kategori", freshness: "Kesegaran data", allStatuses: "Semua status", validated: "Tervalidasi otomatis", official: "Tolok ukur tinjauan resmi", review: "Perlu tinjauan manual", clear: "Hapus filter", showing: "Menampilkan", tiers: "tingkat harga", models: "model", vendors: "penyedia", noMatch: "Tidak ada harga yang cocok", noMatchHelp: "Hapus beberapa filter atau periksa nama penyedia dan model.", allModels: "Lihat semua model", vendorModel: "Penyedia / model", scopeCategory: "Cakupan / kategori", input: "Input", cached: "Input cache", output: "Output", original: "Mata uang asli / juta Token", sourceUpdated: "Sumber / diperbarui", cnyUnit: "CNY / juta Token", source: "Sumber data", timeZone: "Waktu Tiongkok", shown: "ditampilkan", showMore: "Tampilkan 20 lagi", unavailable: "Belum diterbitkan atau tidak berlaku", normalized: "Harga CNY ternormalisasi", serviceTier: "Tingkat layanan", context: "Konteks", newWindow: "buka di jendela baru", officialReview: "Halaman tinjauan resmi", viewSource: "Lihat sumber", up: "naik", down: "turun", flat: "stabil" },
  ms: { markets: { domestic: "Domestik", international: "Antarabangsa" }, capabilities: { text: "Teks", reasoning: "Penaakulan", multimodal: "Multimodal", embedding: "Benaman" }, sources: { official_api: "API rasmi", official_page: "Halaman rasmi", aggregated: "Katalog agregat · menunggu semakan rasmi", provider_quote: "Sebut harga penyedia", estimated: "Anggaran KAI" }, title: "Harga Token model utama", intro: "Harga diasingkan mengikut tahap perkhidmatan, konteks, input, input cache dan output sambil mengekalkan mata wang serta status sumber. Nilai CNY bagi sejuta Token; sahkan syarat akhir melalui pertanyaan.", update: "Dikemas kini setiap hari 06:00 waktu China · versi lengkap sebelumnya dikekalkan jika gagal", indexName: "Indeks kos panggilan model KAI", base: "Asas 100", day1: "Perubahan 1 hari", day30: "Perubahan 30 hari", noHistory: "Sejarah sedang dibina; perubahan lengkap 30 hari belum tersedia.", indexNote: "Indeks ini menunjukkan trend kos relatif bakul model tetap, bukan harga purata CNY dan bukan pengganti sebut harga sebenar.", baseDate: "Tarikh asas", updated: "Dikemas kini", sample: "Sampel", search: "Cari penyedia, model atau tahap", placeholder: "cth. DeepSeek, Qwen, GPT", market: "Skop pasaran", allMarkets: "Domestik dan antarabangsa", category: "Kategori model", allCategories: "Semua kategori", freshness: "Kesegaran data", allStatuses: "Semua status", validated: "Disahkan secara automatik", official: "Penanda aras semakan rasmi", review: "Perlu semakan manual", clear: "Kosongkan penapis", showing: "Memaparkan", tiers: "tahap harga", models: "model", vendors: "penyedia", noMatch: "Tiada harga sepadan", noMatchHelp: "Kosongkan beberapa penapis atau semak nama penyedia dan model.", allModels: "Lihat semua model", vendorModel: "Penyedia / model", scopeCategory: "Skop / kategori", input: "Input", cached: "Input cache", output: "Output", original: "Mata wang asal / juta Token", sourceUpdated: "Sumber / dikemas kini", cnyUnit: "CNY / juta Token", source: "Sumber data", timeZone: "Waktu China", shown: "dipaparkan", showMore: "Papar 20 lagi", unavailable: "Belum diterbitkan atau tidak berkenaan", normalized: "Harga CNY ternormal", serviceTier: "Tahap perkhidmatan", context: "Konteks", newWindow: "buka dalam tetingkap baharu", officialReview: "Halaman semakan rasmi", viewSource: "Lihat sumber", up: "meningkat", down: "menurun", flat: "stabil" },
};

const SOURCE_STYLES: Record<ModelPriceSourceStatus, string> = {
  official_api: "border-[var(--border-strong)] bg-[var(--success-bg)] text-[var(--success)]",
  official_page: "border-[var(--border-strong)] bg-[var(--accent-soft)] text-[var(--accent)]",
  aggregated: "border-[var(--border-strong)] bg-[var(--warning-bg)] text-[var(--warning)]",
  provider_quote: "border-[var(--border-strong)] bg-[var(--warning-bg)] text-[var(--warning)]",
  estimated: "border-[var(--border)] bg-[var(--info-bg)] text-[var(--muted)]",
};

const fieldClass =
  "min-h-11 w-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)]";

function formatCnyPrice(value: number | null, locale: Locale) {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: value < 1 ? 3 : value < 100 ? 2 : 0,
    maximumFractionDigits: value < 1 ? 4 : value < 100 ? 2 : 0,
  }).format(value);
}

function formatOriginalPrice(value: number | null | undefined, currency: string, locale: Locale) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "code",
      minimumFractionDigits: value < 1 ? 3 : 2,
      maximumFractionDigits: value < 1 ? 4 : 2,
    }).format(value);
  } catch {
    return `${currency} ${formatCnyPrice(value, locale)}`;
  }
}

function formatDateTime(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function formatIndexChange(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function priceStatusLabel(value: number | null, copy: Copy) {
  return value === null ? copy.unavailable : copy.normalized;
}

function quoteVariantLabel(quote: ModelTokenPriceQuote, copy: Copy) {
  return `${copy.serviceTier}: ${quote.serviceTier} · ${copy.context}: ${quote.contextBand}`;
}

function quoteAccessibleLabel(quote: ModelTokenPriceQuote, copy: Copy) {
  return `${quote.vendor} ${quote.model}; ${copy.serviceTier} ${quote.serviceTier}; ${copy.context} ${quote.contextBand}`;
}

function SourceBadge({ status }: { status: ModelPriceSourceStatus }) {
  const { locale } = useLocale();
  return (
    <span
      className={`inline-flex min-h-8 items-center border px-2 py-1 text-xs font-semibold ${SOURCE_STYLES[status]}`}
    >
      {COPY[locale].sources[status]}
    </span>
  );
}

function FreshnessBadge({ quote }: { quote: ModelTokenPriceQuote }) {
  const { locale } = useLocale(); const copy = COPY[locale];
  if (quote.freshness?.state === "official_only") {
    return (
      <span className="inline-flex min-h-8 items-center border border-[var(--border)] bg-[var(--info-bg)] px-2 py-1 text-xs font-semibold text-[var(--muted)]">
        {copy.official}
      </span>
    );
  }
  return quote.isStale ? (
    <span className="inline-flex min-h-8 items-center border border-[var(--border-strong)] bg-[var(--warning-bg)] px-2 py-1 text-xs font-semibold text-[var(--warning)]">
      {copy.review}
    </span>
  ) : (
    <span className="inline-flex min-h-8 items-center border border-[var(--border)] bg-[var(--success-bg)] px-2 py-1 text-xs font-semibold text-[var(--success)]">
      {copy.validated}
    </span>
  );
}

function CapabilityTags({ categories }: { categories: readonly ModelCapability[] }) {
  const { locale } = useLocale();
  return (
    <span className="flex flex-wrap gap-1.5">
      {categories.map((category) => (
        <span
          className="border border-[var(--border)] bg-[var(--info-bg)] px-2 py-1 text-xs font-semibold text-[var(--text)]"
          key={category}
        >
          {COPY[locale].capabilities[category]}
        </span>
      ))}
    </span>
  );
}

function OriginalPriceLine({ quote }: { quote: ModelTokenPriceQuote }) {
  const { locale } = useLocale(); const copy = COPY[locale];
  return (
    <span className="grid gap-1 text-xs tabular-nums text-[var(--muted)]">
      <span>{copy.input} {formatOriginalPrice(quote.originalInputPerMillion, quote.originalCurrency, locale)}</span>
      <span>{copy.cached} {formatOriginalPrice(quote.originalCachedInputPerMillion, quote.originalCurrency, locale)}</span>
      <span>{copy.output} {formatOriginalPrice(quote.originalOutputPerMillion, quote.originalCurrency, locale)}</span>
    </span>
  );
}

export function ModelPriceBoard({ quotes, index, className = "" }: ModelPriceBoardProps) {
  const { locale } = useLocale(); const copy = COPY[locale];
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState<MarketFilter>("all");
  const [capability, setCapability] = useState<CapabilityFilter>("all");
  const [freshness, setFreshness] = useState<FreshnessFilter>("all");
  const [visibleLimit, setVisibleLimit] = useState(20);

  useEffect(() => {
    function syncFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const nextMarket = params.get("model_market");
      const nextCapability = params.get("model_capability");
      const nextFreshness = params.get("model_status");
      setQuery(params.get("model_q") ?? "");
      setMarket(nextMarket === "domestic" || nextMarket === "international" ? nextMarket : "all");
      setCapability(
        nextCapability === "text" || nextCapability === "reasoning" || nextCapability === "multimodal" || nextCapability === "embedding"
          ? nextCapability
          : "all",
      );
      setFreshness(
        nextFreshness === "validated" || nextFreshness === "official" || nextFreshness === "review"
          ? nextFreshness
          : "all",
      );
      setVisibleLimit(20);
    }
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  function writeFilters(
    next: { query?: string; market?: MarketFilter; capability?: CapabilityFilter; freshness?: FreshnessFilter },
    historyMode: "push" | "replace" = "push",
  ) {
    const values = {
      query: next.query ?? query,
      market: next.market ?? market,
      capability: next.capability ?? capability,
      freshness: next.freshness ?? freshness,
    };
    const params = new URLSearchParams(window.location.search);
    const assign = (key: string, value: string, defaultValue = "all") => value === defaultValue ? params.delete(key) : params.set(key, value);
    assign("model_q", values.query, "");
    assign("model_market", values.market);
    assign("model_capability", values.capability);
    assign("model_status", values.freshness);
    const target = `${window.location.pathname}${params.size ? `?${params.toString()}` : ""}${window.location.hash}`;
    window.history[historyMode === "push" ? "pushState" : "replaceState"](null, "", target);
  }

  const filteredQuotes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return quotes.filter((quote) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        quote.vendor.toLocaleLowerCase("zh-CN").includes(normalizedQuery) ||
        quote.model.toLocaleLowerCase("zh-CN").includes(normalizedQuery) ||
        quote.serviceTier.toLocaleLowerCase("zh-CN").includes(normalizedQuery) ||
        quote.contextBand.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
      const matchesMarket = market === "all" || quote.market === market;
      const matchesCapability = capability === "all" || quote.categories.includes(capability);
      const freshnessState = quote.freshness?.state === "official_only"
        ? "official"
        : quote.isStale || quote.freshness?.state === "stale" || quote.freshness?.state === "review_required"
          ? "review"
          : "validated";
      const matchesFreshness = freshness === "all" || freshness === freshnessState;
      return matchesQuery && matchesMarket && matchesCapability && matchesFreshness;
    });
  }, [capability, freshness, market, query, quotes]);

  const supplierCount = new Set(filteredQuotes.map((quote) => quote.vendor)).size;
  const modelCount = new Set(filteredQuotes.map((quote) => `${quote.vendor}\u0000${quote.model}`)).size;
  const reviewCount = filteredQuotes.filter((quote) => quote.isStale || quote.freshness?.state === "stale" || quote.freshness?.state === "review_required").length;
  const officialCount = filteredQuotes.filter((quote) => quote.freshness?.state === "official_only").length;
  const validatedCount = filteredQuotes.length - reviewCount - officialCount;
  const visibleQuotes = filteredQuotes.slice(0, visibleLimit);
  const hasFilters = query.length > 0 || market !== "all" || capability !== "all" || freshness !== "all";
  const hasComplete30DayChange = index.change30d !== null
    && index.change30d !== undefined
    && Number.isFinite(index.change30d);
  const indexDirection = hasComplete30DayChange
    ? index.change30d! > 0 ? copy.up : index.change30d! < 0 ? copy.down : copy.flat
    : null;

  function clearFilters() {
    setQuery("");
    setMarket("all");
    setCapability("all");
    setFreshness("all");
    setVisibleLimit(20);
    writeFilters({ query: "", market: "all", capability: "all", freshness: "all" });
  }

  return (
    <section className={className} aria-labelledby="model-price-board-title">
      <div className="grid border-y border-[var(--border)] bg-[var(--surface)] lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="p-5 sm:p-7">
          <p className="kicker">Model price intelligence</p>
          <h2 className="m-0 text-2xl leading-tight text-[var(--ink)] sm:text-3xl" id="model-price-board-title">
            {copy.title}
          </h2>
          <p className="mt-3 mb-0 max-w-3xl text-sm leading-6 text-[var(--text)]">
            {copy.intro}
          </p>
          <p className="mt-4 mb-0 inline-flex border border-[var(--border-strong)] bg-[var(--success-bg)] px-3 py-2 text-xs font-semibold text-[var(--success)]">
            {copy.update}
          </p>
        </div>
        <aside className="border-t-2 border-[var(--accent)] bg-[var(--info-bg)] p-5 lg:border-t-0 lg:border-l lg:border-l-[var(--border)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="m-0 text-xs font-semibold text-[var(--muted)]">
                {index.name ?? copy.indexName}
              </p>
              <p className="mt-2 mb-0 text-3xl font-semibold tabular-nums text-[var(--ink)]">
                {index.value.toFixed(2)}
              </p>
            </div>
            <span className="border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-xs font-semibold text-[var(--accent)]">
              {copy.base}
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-[var(--border)] py-3 text-xs">
            <div>
              <dt className="text-[var(--muted)]">{copy.day1}</dt>
              <dd className="mt-1 font-semibold tabular-nums text-[var(--ink)]">{formatIndexChange(index.change1d)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">{copy.day30}</dt>
              <dd className="mt-1 font-semibold tabular-nums text-[var(--ink)]">{formatIndexChange(index.change30d)}</dd>
            </div>
          </dl>
          <p className="mt-3 mb-0 text-xs leading-5 text-[var(--muted)]">
            {indexDirection === null
              ? copy.noHistory
              : `${copy.indexName}: ${indexDirection}.`}
            {copy.indexNote}
          </p>
          <p className="mt-2 mb-0 text-xs text-[var(--muted)]">
            {copy.baseDate} {index.baseDate} · {copy.updated} {formatDateTime(index.updatedAt, locale)}
            {index.sampleSize !== undefined ? ` · ${copy.sample} ${index.sampleSize}` : ""}
          </p>
        </aside>
      </div>

      <div className="mt-6 border-y border-[var(--border)] bg-[var(--info-bg)] p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(240px,1.4fr)_repeat(3,minmax(150px,0.8fr))_auto] xl:items-end">
          <label className="grid gap-1.5 text-xs font-semibold text-[var(--ink)]">
            {copy.search}
            <input
              className={fieldClass}
               onChange={(event) => {
                 setQuery(event.target.value);
                 setVisibleLimit(20);
                 writeFilters({ query: event.target.value }, "replace");
               }}
              placeholder={copy.placeholder}
              type="search"
              value={query}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-[var(--ink)]">
            {copy.market}
            <select className={fieldClass} onChange={(event) => {
              const value = event.target.value as MarketFilter;
              setMarket(value);
              setVisibleLimit(20);
              writeFilters({ market: value });
            }} value={market}>
              <option value="all">{copy.allMarkets}</option>
              <option value="domestic">{copy.markets.domestic}</option>
              <option value="international">{copy.markets.international}</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-[var(--ink)]">
            {copy.category}
            <select
              className={fieldClass}
               onChange={(event) => {
                 const value = event.target.value as CapabilityFilter;
                 setCapability(value);
                 setVisibleLimit(20);
                 writeFilters({ capability: value });
               }}
              value={capability}
            >
              <option value="all">{copy.allCategories}</option>
              <option value="text">{copy.capabilities.text}</option>
              <option value="reasoning">{copy.capabilities.reasoning}</option>
              <option value="multimodal">{copy.capabilities.multimodal}</option>
              <option value="embedding">{copy.capabilities.embedding}</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-[var(--ink)]">
            {copy.freshness}
            <select className={fieldClass} onChange={(event) => {
              const value = event.target.value as FreshnessFilter;
              setFreshness(value);
              setVisibleLimit(20);
              writeFilters({ freshness: value });
            }} value={freshness}>
              <option value="all">{copy.allStatuses}</option>
              <option value="validated">{copy.validated}</option>
              <option value="official">{copy.official}</option>
              <option value="review">{copy.review}</option>
            </select>
          </label>
          <button
            className="button button-secondary button-compact min-h-11 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!hasFilters}
            onClick={clearFilters}
            type="button"
          >
            {copy.clear}
          </button>
        </div>
        <p className="mt-4 mb-0 text-xs text-[var(--muted)]" aria-live="polite">
          {copy.showing} {filteredQuotes.length} {copy.tiers} · {modelCount} {copy.models} · {supplierCount} {copy.vendors}
          {` · ${validatedCount} ${copy.validated} · ${officialCount} ${copy.official} · ${reviewCount} ${copy.review}`}
        </p>
      </div>

      {filteredQuotes.length === 0 ? (
        <div className="mt-6 border-y border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
          <p className="m-0 text-lg font-semibold text-[var(--ink)]">{copy.noMatch}</p>
          <p className="mt-2 mb-0 text-sm text-[var(--muted)]">{copy.noMatchHelp}</p>
          <button className="button button-secondary mt-5" onClick={clearFilters} type="button">
            {copy.allModels}
          </button>
        </div>
      ) : (
        <>
          <div className="mt-6 hidden overflow-x-auto border border-[var(--border)] lg:block">
            <table className="data-table min-w-[1180px]">
              <caption className="sr-only">{copy.title}</caption>
              <thead>
                <tr>
                  <th scope="col">{copy.vendorModel}</th>
                  <th scope="col">{copy.scopeCategory}</th>
                  <th className="num" scope="col">{copy.input}<br />{copy.cnyUnit}</th>
                  <th className="num" scope="col">{copy.cached}<br />{copy.cnyUnit}</th>
                  <th className="num" scope="col">{copy.output}<br />{copy.cnyUnit}</th>
                  <th scope="col">{copy.original}</th>
                  <th scope="col">{copy.sourceUpdated}</th>
                </tr>
              </thead>
              <tbody>
                {visibleQuotes.map((quote) => (
                  <tr key={quote.id}>
                    <th aria-label={quoteAccessibleLabel(quote, copy)} className="min-w-64 text-left" scope="row">
                      <span className="block text-xs font-semibold text-[var(--accent)]">{quote.vendor}</span>
                      <span className="mt-1 block text-base text-[var(--ink)]">{quote.model}</span>
                      <span className="mt-1 block text-xs font-semibold text-[var(--text)]">
                        {quoteVariantLabel(quote, copy)}
                      </span>
                      {quote.availabilityNote ? (
                        <span className="mt-1 block max-w-60 text-xs font-normal text-[var(--muted)]">
                          {quote.availabilityNote}
                        </span>
                      ) : null}
                    </th>
                    <td className="min-w-44">
                      <span className="mb-2 block text-xs font-semibold text-[var(--ink)]">{copy.markets[quote.market]}</span>
                      <CapabilityTags categories={quote.categories} />
                    </td>
                    <PriceCell value={quote.inputCnyPerMillion} />
                    <PriceCell value={quote.cachedInputCnyPerMillion} />
                    <PriceCell value={quote.outputCnyPerMillion} />
                    <td className="min-w-52"><OriginalPriceLine quote={quote} /></td>
                    <td className="min-w-56">
                      <div className="flex flex-wrap gap-1.5">
                        <SourceBadge status={quote.sourceStatus} />
                        <FreshnessBadge quote={quote} />
                      </div>
                      <SourceName quote={quote} />
                      <span className="mt-1 block text-xs tabular-nums text-[var(--muted)]">
                        {copy.timeZone} {formatDateTime(quote.updatedAt, locale)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 grid gap-4 lg:hidden">
            {visibleQuotes.map((quote) => (
              <article
                aria-label={quoteAccessibleLabel(quote, copy)}
                className="border-t-2 border-[var(--accent)] bg-[var(--surface)] p-5 ring-1 ring-[var(--border)]"
                key={quote.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="m-0 text-xs font-semibold text-[var(--accent)]">
                      {quote.vendor} · {copy.markets[quote.market]}
                    </p>
                    <h3 className="mt-1 mb-0 text-xl text-[var(--ink)]">{quote.model}</h3>
                    <p className="mt-1 mb-0 text-xs font-semibold text-[var(--text)]">{quoteVariantLabel(quote, copy)}</p>
                  </div>
                  <FreshnessBadge quote={quote} />
                </div>
                <div className="mt-3"><CapabilityTags categories={quote.categories} /></div>
                <dl className="mt-5 grid grid-cols-3 border-y border-[var(--border)] text-center">
                  <MobilePrice label={copy.input} value={quote.inputCnyPerMillion} />
                  <MobilePrice label={copy.cached} value={quote.cachedInputCnyPerMillion} bordered />
                  <MobilePrice label={copy.output} value={quote.outputCnyPerMillion} />
                </dl>
                <p className="mt-2 mb-0 text-center text-xs text-[var(--muted)]">{copy.cnyUnit}</p>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="m-0 text-xs font-semibold text-[var(--ink)]">{copy.original}</p>
                    <div className="mt-2"><OriginalPriceLine quote={quote} /></div>
                  </div>
                  <div>
                    <p className="m-0 text-xs font-semibold text-[var(--ink)]">{copy.source}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5"><SourceBadge status={quote.sourceStatus} /></div>
                    <SourceName quote={quote} />
                    <p className="mt-1 mb-0 text-xs tabular-nums text-[var(--muted)]">{copy.timeZone} {formatDateTime(quote.updatedAt, locale)}</p>
                  </div>
                </div>
                {quote.availabilityNote ? (
                  <p className="mt-4 mb-0 border-t border-[var(--border)] pt-3 text-xs leading-5 text-[var(--muted)]">
                    {quote.availabilityNote}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
          {visibleQuotes.length < filteredQuotes.length ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--border)] bg-[var(--info-bg)] p-4">
              <p className="m-0 text-sm text-[var(--text)]">{copy.shown} {visibleQuotes.length} / {filteredQuotes.length} {copy.tiers}</p>
              <button className="button button-secondary button-compact" onClick={() => setVisibleLimit((value) => value + 20)} type="button">
                {copy.showMore}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function PriceCell({ value }: { value: number | null }) {
  const { locale } = useLocale(); const copy = COPY[locale];
  return (
    <td className="num min-w-36">
      <span className="font-mono text-xl font-semibold tabular-nums text-[var(--ink)]" title={priceStatusLabel(value, copy)}>
        {formatCnyPrice(value, locale)}
      </span>
    </td>
  );
}

function MobilePrice({ label, value, bordered = false }: { label: string; value: number | null; bordered?: boolean }) {
  const { locale } = useLocale(); const copy = COPY[locale];
  return (
    <div className={`min-w-0 px-2 py-4 ${bordered ? "border-x border-[var(--border)]" : ""}`}>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 truncate font-mono text-lg font-semibold tabular-nums text-[var(--ink)]" title={priceStatusLabel(value, copy)}>
        {formatCnyPrice(value, locale)}
      </dd>
    </div>
  );
}

function SourceName({ quote }: { quote: ModelTokenPriceQuote }) {
  const { locale } = useLocale(); const copy = COPY[locale];
  return (
    <span className="mt-2 grid max-w-56 gap-1 text-xs font-semibold">
      {quote.sourceUrl ? (
        <a
          className="truncate text-[var(--accent)] underline underline-offset-4"
          href={quote.sourceUrl}
          rel="noreferrer"
          target="_blank"
          title={quote.sourceName}
        >
          {quote.sourceName}
          <span className="sr-only"> ({copy.newWindow})</span>
        </a>
      ) : (
        <span className="truncate text-[var(--text)]" title={quote.sourceName}>{quote.sourceName}</span>
      )}
      {quote.sourceStatus === "aggregated" && quote.officialSourceUrl ? (
        <a
          className="truncate font-normal text-[var(--muted)] underline underline-offset-4"
          href={quote.officialSourceUrl}
          rel="noreferrer"
          target="_blank"
          title={quote.officialSourceName ?? copy.officialReview}
        >
          {copy.officialReview}: {quote.officialSourceName ?? copy.viewSource}
          <span className="sr-only"> ({copy.newWindow})</span>
        </a>
      ) : null}
    </span>
  );
}
