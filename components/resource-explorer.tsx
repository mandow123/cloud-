"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/components/locale-provider";
import purchaseStyles from "@/components/resource-purchase.module.css";
import type { BuyCatalogClassification } from "@/lib/buy-catalog";
import { formatCardHourValue } from "@/lib/card-hours";
import type { Locale } from "@/lib/i18n";
import { filterAndSortResources, formatCardHourQuote, parseResourceQuery } from "@/lib/market";
import type { DealMode, ResourceCategory, ResourceListing } from "@/lib/types";

type ResourceExplorerCopy = {
  categories: Record<ResourceCategory, string>;
  deals: Record<DealMode, string>;
  taxIncluded: string; taxExcluded: string; energyIncluded: string; energyExcluded: string; networkIncluded: string; networkExcluded: string;
  heading: string; lead: string; kicker: string; directory: string; directorySummary: string; quoteNotice: string; sourceNoteLabel: string; sourceNote: string; unverified: string;
  filters: string; filterResources: string; clearCount: string; keyword: string; searchPlaceholder: string; category: string; allCategories: string; deal: string; allDeals: string; region: string; allRegions: string; delivery: string; allDeliveries: string; unit: string; allUnits: string;
  matchedInventory: string; foundCount: string; sort: string; recommended: string; priceLowHigh: string; priceHighLow: string; recentlyUpdated: string; compareLimit: string;
  comparePlans: string; selectedCount: string; clearCompare: string; compareItem: string; remove: string; marketQuote: string; supplierSource: string; regionDelivery: string; capacitySample: string; targetSla: string; priceScope: string; quoteSamples: string; updatedAt: string; confirmByInquiry: string;
  noResults: string; noResultsHelp: string; clearAll: string; submitDemand: string; resourceSupplier: string; categoryDeal: string; capacitySla: string; action: string; addCompare: string;
  deliveryForm: string; deliveryLeadTime: string; viewDetails: string; resultsSummary: string; sourcesSummary: string; supplierDirectory: string; supplierProvided: string; supplierUnverified: string; sourcePrefix: string; quoteSheet: string;
  maintenance: string; submitInquiry: string; submitRelated: string; standardCardHourUnit: string; inquiryAria: string; demandAria: string; logoAlt: string; sample: string; updated: string;
};

const RESOURCE_EXPLORER_COPY = {
  "zh-CN": {
    categories: { gpu: "GPU 算力", token_model: "Token / 模型", rack_capacity: "整机柜 / 容量", cloud_vendor: "云厂商资源" }, deals: { rental: "租赁", service: "服务采购", swap: "资源置换" },
    taxIncluded: "含税", taxExcluded: "未含税", energyIncluded: "含电力", energyExcluded: "未含电力", networkIncluded: "含网络", networkExcluded: "未含网络", heading: "算力资源市场", lead: "按供应商来源、GPU 型号、区域和交付形态发现候选方案；报价统一换算为 KAI 标准卡时，提交后再核验库存与成交条件。", kicker: "供应商参考目录", directory: "供应参考目录", directorySummary: "含 {count} 家报价单供应商来源；均需重新询价和验真。", quoteNotice: "报价声明", sourceNoteLabel: "来源说明：", sourceNote: "报价单供应商会明确标注公司名称、数据日期与来源文件，不代表已经入驻或存在可成交库存。", unverified: "未经 KAI 验真 · 具体以询价确认为准", filters: "资源筛选", filterResources: "筛选资源", clearCount: "清除 {count} 项", keyword: "关键词", searchPlaceholder: "型号、能力或供应商", category: "资源分类", allCategories: "全部分类", deal: "交易方式", allDeals: "全部方式", region: "资源区域", allRegions: "全国区域", delivery: "交付形态", allDeliveries: "全部形态", unit: "计价单位", allUnits: "全部单位", matchedInventory: "匹配资源", foundCount: "找到 {count} 项资源", sort: "排序", recommended: "综合推荐", priceLowHigh: "价格从低到高", priceHighLow: "价格从高到低", recentlyUpdated: "最近更新", compareLimit: "一次最多比较 3 项资源，请先移除一项。", comparePlans: "方案对比", selectedCount: "已选择 {count} / 3 项", clearCompare: "清空对比", compareItem: "对比项", remove: "移除", marketQuote: "市场参考报价", supplierSource: "供应商来源", regionDelivery: "区域 / 交付", capacitySample: "容量样本", targetSla: "目标服务等级", priceScope: "价格口径", quoteSamples: "报价样本", updatedAt: "更新时间", confirmByInquiry: "具体以询价确认为准", noResults: "没有匹配的目录资源", noResultsHelp: "当前筛选组合较窄。清除筛选后可浏览完整资源池，或提交算力需求由 KAI 进行人工撮合。", clearAll: "清除全部筛选", submitDemand: "提交算力需求", resourceSupplier: "资源 / 供应商", categoryDeal: "分类 / 交易", capacitySla: "容量样本 / 目标 SLA", action: "操作", addCompare: "加入对比", deliveryForm: "交付形态", deliveryLeadTime: "交付周期", viewDetails: "查看详情", resultsSummary: "共 {count} 项 · 报价更新以各资源详情页为准", sourcesSummary: "{count} 家供应商报价来源已标注，库存和价格需重新确认", supplierDirectory: "供应商目录", supplierProvided: "供应商提供报价", supplierUnverified: "未经 KAI 验真", sourcePrefix: "供应商来源：", quoteSheet: "报价单", maintenance: "人工询价维护中", submitInquiry: "提交询价", submitRelated: "提交相关需求", standardCardHourUnit: "KAI 标准卡时 / 套·小时", inquiryAria: "基于 {title} 提交询价，目录参考价 {quote}", demandAria: "基于 {title} 提交相关算力需求", logoAlt: "{supplier} Logo", sample: "样本", updated: "更新",
  },
  "zh-TW": {
    categories: { gpu: "GPU 算力", token_model: "Token / 模型", rack_capacity: "整機櫃 / 容量", cloud_vendor: "雲端供應商資源" }, deals: { rental: "租賃", service: "服務採購", swap: "資源置換" },
    taxIncluded: "含稅", taxExcluded: "未含稅", energyIncluded: "含電力", energyExcluded: "未含電力", networkIncluded: "含網路", networkExcluded: "未含網路", heading: "算力資源市場", lead: "依供應商來源、GPU 型號、區域和交付形態尋找候選方案；報價統一換算為 KAI 標準卡時，提交後再核驗庫存與成交條件。", kicker: "供應商參考目錄", directory: "供應參考目錄", directorySummary: "含 {count} 家報價單供應商來源；均需重新詢價和驗真。", quoteNotice: "報價聲明", sourceNoteLabel: "來源說明：", sourceNote: "報價單供應商會明確標示公司名稱、資料日期與來源文件，不代表已經入駐或存在可成交庫存。", unverified: "未經 KAI 驗真 · 具體以詢價確認為準", filters: "資源篩選", filterResources: "篩選資源", clearCount: "清除 {count} 項", keyword: "關鍵字", searchPlaceholder: "型號、能力或供應商", category: "資源分類", allCategories: "全部分類", deal: "交易方式", allDeals: "全部方式", region: "資源區域", allRegions: "全部區域", delivery: "交付形態", allDeliveries: "全部形態", unit: "計價單位", allUnits: "全部單位", matchedInventory: "符合資源", foundCount: "找到 {count} 項資源", sort: "排序", recommended: "綜合推薦", priceLowHigh: "價格由低至高", priceHighLow: "價格由高至低", recentlyUpdated: "最近更新", compareLimit: "一次最多比較 3 項資源，請先移除一項。", comparePlans: "方案比較", selectedCount: "已選擇 {count} / 3 項", clearCompare: "清空比較", compareItem: "比較項", remove: "移除", marketQuote: "市場參考報價", supplierSource: "供應商來源", regionDelivery: "區域 / 交付", capacitySample: "容量樣本", targetSla: "目標服務等級", priceScope: "價格口徑", quoteSamples: "報價樣本", updatedAt: "更新時間", confirmByInquiry: "具體以詢價確認為準", noResults: "沒有符合的目錄資源", noResultsHelp: "目前篩選組合較窄。清除篩選後可瀏覽完整資源池，或提交算力需求由 KAI 人工媒合。", clearAll: "清除全部篩選", submitDemand: "提交算力需求", resourceSupplier: "資源 / 供應商", categoryDeal: "分類 / 交易", capacitySla: "容量樣本 / 目標 SLA", action: "操作", addCompare: "加入比較", deliveryForm: "交付形態", deliveryLeadTime: "交付週期", viewDetails: "查看詳情", resultsSummary: "共 {count} 項 · 報價更新以各資源詳情頁為準", sourcesSummary: "{count} 家供應商報價來源已標示，庫存和價格需重新確認", supplierDirectory: "供應商目錄", supplierProvided: "供應商提供報價", supplierUnverified: "未經 KAI 驗真", sourcePrefix: "供應商來源：", quoteSheet: "報價單", maintenance: "人工詢價維護中", submitInquiry: "提交詢價", submitRelated: "提交相關需求", standardCardHourUnit: "KAI 標準卡時 / 套·小時", inquiryAria: "依 {title} 提交詢價，目錄參考價 {quote}", demandAria: "依 {title} 提交相關算力需求", logoAlt: "{supplier} Logo", sample: "樣本", updated: "更新",
  },
  en: {
    categories: { gpu: "GPU compute", token_model: "Token / model", rack_capacity: "Rack / capacity", cloud_vendor: "Cloud provider" }, deals: { rental: "Rental", service: "Service purchase", swap: "Resource exchange" },
    taxIncluded: "Tax included", taxExcluded: "Tax excluded", energyIncluded: "Energy included", energyExcluded: "Energy excluded", networkIncluded: "Network included", networkExcluded: "Network excluded", heading: "Compute Resource Marketplace", lead: "Discover options by supplier source, GPU model, region, and delivery format. Quotes are normalized to KAI standard card-hours; inventory and transaction terms are verified after submission.", kicker: "Supplier reference directory", directory: "Reference directory", directorySummary: "Includes quote sources from {count} suppliers; every item requires a new inquiry and verification.", quoteNotice: "Quote notice", sourceNoteLabel: "Source note: ", sourceNote: "Quote suppliers are identified by company, data date, and source file. This does not mean they are onboarded or have tradable inventory.", unverified: "Not verified by KAI · Confirm by inquiry", filters: "Resource filters", filterResources: "Filter resources", clearCount: "Clear {count}", keyword: "Keyword", searchPlaceholder: "Model, capability, or supplier", category: "Category", allCategories: "All categories", deal: "Deal type", allDeals: "All deal types", region: "Region", allRegions: "All regions", delivery: "Delivery format", allDeliveries: "All formats", unit: "Pricing unit", allUnits: "All units", matchedInventory: "Matched inventory", foundCount: "{count} resources found", sort: "Sort", recommended: "Recommended", priceLowHigh: "Price: low to high", priceHighLow: "Price: high to low", recentlyUpdated: "Recently updated", compareLimit: "You can compare up to 3 resources. Remove one first.", comparePlans: "Compare options", selectedCount: "{count} / 3 selected", clearCompare: "Clear comparison", compareItem: "Comparison", remove: "Remove", marketQuote: "Market reference quote", supplierSource: "Supplier source", regionDelivery: "Region / delivery", capacitySample: "Capacity sample", targetSla: "Target service level", priceScope: "Price scope", quoteSamples: "Quote samples", updatedAt: "Updated", confirmByInquiry: "Confirm by inquiry", noResults: "No matching catalog resources", noResultsHelp: "This filter set is narrow. Clear filters to browse the full pool, or submit a compute request for manual matching by KAI.", clearAll: "Clear all filters", submitDemand: "Submit compute request", resourceSupplier: "Resource / supplier", categoryDeal: "Category / deal", capacitySla: "Capacity sample / target SLA", action: "Action", addCompare: "Compare", deliveryForm: "Delivery format", deliveryLeadTime: "Delivery lead time", viewDetails: "View details", resultsSummary: "{count} items · See each resource page for quote updates", sourcesSummary: "Quote sources from {count} suppliers are labeled; inventory and pricing require reconfirmation", supplierDirectory: "Supplier directory", supplierProvided: "Supplier-provided quote", supplierUnverified: "Not verified by KAI", sourcePrefix: "Supplier source: ", quoteSheet: "quote sheet", maintenance: "Manual inquiries are under maintenance", submitInquiry: "Submit inquiry", submitRelated: "Submit related request", standardCardHourUnit: "KAI standard card-hours / set-hour", inquiryAria: "Submit an inquiry for {title}; catalog reference {quote}", demandAria: "Submit a related compute request for {title}", logoAlt: "{supplier} logo", sample: "Samples", updated: "Updated",
  },
  ja: {
    categories: { gpu: "GPU コンピュート", token_model: "Token / モデル", rack_capacity: "ラック / 容量", cloud_vendor: "クラウド事業者" }, deals: { rental: "レンタル", service: "サービス購入", swap: "リソース交換" },
    taxIncluded: "税込", taxExcluded: "税別", energyIncluded: "電力込み", energyExcluded: "電力別", networkIncluded: "ネットワーク込み", networkExcluded: "ネットワーク別", heading: "コンピュートリソース市場", lead: "供給元、GPU 型番、地域、納品形態から候補を探せます。価格は KAI 標準カード時に換算され、送信後に在庫と取引条件を確認します。", kicker: "サプライヤー参考ディレクトリ", directory: "参考ディレクトリ", directorySummary: "{count} 社の見積情報を掲載。すべて再問い合わせと検証が必要です。", quoteNotice: "見積について", sourceNoteLabel: "出典：", sourceNote: "見積元は会社名、データ日、出典ファイルを明記します。登録済みまたは取引可能な在庫があることを示すものではありません。", unverified: "KAI 未検証 · 問い合わせで要確認", filters: "リソース絞り込み", filterResources: "リソースを絞り込む", clearCount: "{count} 件解除", keyword: "キーワード", searchPlaceholder: "型番、機能、サプライヤー", category: "カテゴリー", allCategories: "すべて", deal: "取引方法", allDeals: "すべて", region: "地域", allRegions: "すべての地域", delivery: "納品形態", allDeliveries: "すべて", unit: "価格単位", allUnits: "すべて", matchedInventory: "一致したリソース", foundCount: "{count} 件見つかりました", sort: "並び順", recommended: "おすすめ", priceLowHigh: "価格の安い順", priceHighLow: "価格の高い順", recentlyUpdated: "更新順", compareLimit: "比較できるのは 3 件までです。1 件削除してください。", comparePlans: "プラン比較", selectedCount: "{count} / 3 件選択", clearCompare: "比較をクリア", compareItem: "比較項目", remove: "削除", marketQuote: "市場参考価格", supplierSource: "供給元", regionDelivery: "地域 / 納品", capacitySample: "容量サンプル", targetSla: "目標サービスレベル", priceScope: "価格範囲", quoteSamples: "見積サンプル", updatedAt: "更新日", confirmByInquiry: "問い合わせで要確認", noResults: "一致するリソースがありません", noResultsHelp: "条件を広げて全リソースを確認するか、KAI の手動マッチング用に需要を送信してください。", clearAll: "すべて解除", submitDemand: "需要を送信", resourceSupplier: "リソース / 供給元", categoryDeal: "カテゴリー / 取引", capacitySla: "容量 / 目標 SLA", action: "操作", addCompare: "比較に追加", deliveryForm: "納品形態", deliveryLeadTime: "納期", viewDetails: "詳細を見る", resultsSummary: "全 {count} 件 · 価格更新は各詳細ページを参照", sourcesSummary: "{count} 社の出典を表示。価格と在庫は再確認が必要です", supplierDirectory: "サプライヤーディレクトリ", supplierProvided: "サプライヤー提供見積", supplierUnverified: "KAI 未検証", sourcePrefix: "供給元：", quoteSheet: "見積書", maintenance: "手動問い合わせはメンテナンス中", submitInquiry: "問い合わせる", submitRelated: "関連需要を送信", standardCardHourUnit: "KAI 標準カード時 / セット時", inquiryAria: "{title} の問い合わせを送信、参考価格 {quote}", demandAria: "{title} に関連する需要を送信", logoAlt: "{supplier} ロゴ", sample: "サンプル", updated: "更新",
  },
  ko: {
    categories: { gpu: "GPU 컴퓨팅", token_model: "Token / 모델", rack_capacity: "랙 / 용량", cloud_vendor: "클라우드 공급자" }, deals: { rental: "대여", service: "서비스 구매", swap: "리소스 교환" },
    taxIncluded: "세금 포함", taxExcluded: "세금 별도", energyIncluded: "전력 포함", energyExcluded: "전력 별도", networkIncluded: "네트워크 포함", networkExcluded: "네트워크 별도", heading: "컴퓨팅 리소스 시장", lead: "공급자 출처, GPU 모델, 지역 및 인도 방식으로 후보를 찾습니다. 견적은 KAI 표준 카드시간으로 환산되며 제출 후 재고와 거래 조건을 확인합니다.", kicker: "공급자 참조 디렉터리", directory: "참조 디렉터리", directorySummary: "{count}개 공급자 견적 출처 포함. 모두 재문의와 검증이 필요합니다.", quoteNotice: "견적 안내", sourceNoteLabel: "출처 안내: ", sourceNote: "회사명, 데이터 날짜 및 원본 파일을 표시합니다. 입점 또는 거래 가능한 재고를 의미하지 않습니다.", unverified: "KAI 미검증 · 문의 확인 필요", filters: "리소스 필터", filterResources: "리소스 필터링", clearCount: "{count}개 지우기", keyword: "키워드", searchPlaceholder: "모델, 성능 또는 공급자", category: "분류", allCategories: "전체 분류", deal: "거래 방식", allDeals: "전체 방식", region: "지역", allRegions: "전체 지역", delivery: "인도 방식", allDeliveries: "전체 방식", unit: "가격 단위", allUnits: "전체 단위", matchedInventory: "일치 리소스", foundCount: "리소스 {count}개", sort: "정렬", recommended: "추천순", priceLowHigh: "낮은 가격순", priceHighLow: "높은 가격순", recentlyUpdated: "최근 업데이트", compareLimit: "최대 3개까지 비교할 수 있습니다. 하나를 제거하세요.", comparePlans: "옵션 비교", selectedCount: "{count} / 3 선택", clearCompare: "비교 지우기", compareItem: "비교 항목", remove: "제거", marketQuote: "시장 참고 견적", supplierSource: "공급자 출처", regionDelivery: "지역 / 인도", capacitySample: "용량 샘플", targetSla: "목표 서비스 수준", priceScope: "가격 범위", quoteSamples: "견적 샘플", updatedAt: "업데이트", confirmByInquiry: "문의 확인 필요", noResults: "일치하는 리소스가 없습니다", noResultsHelp: "필터를 지워 전체 리소스를 보거나 KAI 수동 매칭을 위해 수요를 제출하세요.", clearAll: "모든 필터 지우기", submitDemand: "컴퓨팅 수요 제출", resourceSupplier: "리소스 / 공급자", categoryDeal: "분류 / 거래", capacitySla: "용량 / 목표 SLA", action: "작업", addCompare: "비교 추가", deliveryForm: "인도 방식", deliveryLeadTime: "인도 기간", viewDetails: "상세 보기", resultsSummary: "총 {count}개 · 견적 업데이트는 상세 페이지 참조", sourcesSummary: "{count}개 공급자 출처 표시됨. 재고와 가격은 재확인 필요", supplierDirectory: "공급자 디렉터리", supplierProvided: "공급자 제공 견적", supplierUnverified: "KAI 미검증", sourcePrefix: "공급자 출처: ", quoteSheet: "견적서", maintenance: "수동 문의 점검 중", submitInquiry: "문의 제출", submitRelated: "관련 수요 제출", standardCardHourUnit: "KAI 표준 카드시간 / 세트·시간", inquiryAria: "{title} 문의 제출, 카탈로그 참고가 {quote}", demandAria: "{title} 관련 컴퓨팅 수요 제출", logoAlt: "{supplier} 로고", sample: "샘플", updated: "업데이트",
  },
  fr: {
    categories: { gpu: "Calcul GPU", token_model: "Token / modèle", rack_capacity: "Baie / capacité", cloud_vendor: "Fournisseur cloud" }, deals: { rental: "Location", service: "Achat de service", swap: "Échange de ressources" },
    taxIncluded: "Taxes incluses", taxExcluded: "Hors taxes", energyIncluded: "Énergie incluse", energyExcluded: "Énergie exclue", networkIncluded: "Réseau inclus", networkExcluded: "Réseau exclu", heading: "Marché des ressources de calcul", lead: "Trouvez des options par fournisseur, modèle de GPU, région et mode de livraison. Les prix sont normalisés en heures-carte KAI, puis le stock et les conditions sont vérifiés après l’envoi.", kicker: "Répertoire indicatif des fournisseurs", directory: "Répertoire indicatif", directorySummary: "Sources de devis de {count} fournisseurs ; chaque offre doit être vérifiée par une nouvelle demande.", quoteNotice: "Avis sur les prix", sourceNoteLabel: "Source : ", sourceNote: "Le nom de la société, la date et le fichier source sont indiqués. Cela ne signifie pas que le fournisseur est intégré ni que le stock est disponible.", unverified: "Non vérifié par KAI · À confirmer", filters: "Filtres de ressources", filterResources: "Filtrer les ressources", clearCount: "Effacer {count}", keyword: "Mot-clé", searchPlaceholder: "Modèle, capacité ou fournisseur", category: "Catégorie", allCategories: "Toutes", deal: "Type de transaction", allDeals: "Tous", region: "Région", allRegions: "Toutes les régions", delivery: "Mode de livraison", allDeliveries: "Tous", unit: "Unité de prix", allUnits: "Toutes", matchedInventory: "Ressources correspondantes", foundCount: "{count} ressources trouvées", sort: "Trier", recommended: "Recommandé", priceLowHigh: "Prix croissant", priceHighLow: "Prix décroissant", recentlyUpdated: "Mise à jour récente", compareLimit: "Vous pouvez comparer 3 ressources au maximum. Retirez-en une.", comparePlans: "Comparer", selectedCount: "{count} / 3 sélectionnées", clearCompare: "Effacer la comparaison", compareItem: "Critère", remove: "Retirer", marketQuote: "Prix indicatif", supplierSource: "Source fournisseur", regionDelivery: "Région / livraison", capacitySample: "Échantillon de capacité", targetSla: "Niveau de service cible", priceScope: "Périmètre du prix", quoteSamples: "Échantillons de prix", updatedAt: "Mise à jour", confirmByInquiry: "À confirmer sur demande", noResults: "Aucune ressource correspondante", noResultsHelp: "Effacez les filtres pour voir toutes les ressources ou envoyez un besoin pour une mise en relation manuelle par KAI.", clearAll: "Effacer tous les filtres", submitDemand: "Soumettre un besoin", resourceSupplier: "Ressource / fournisseur", categoryDeal: "Catégorie / transaction", capacitySla: "Capacité / SLA cible", action: "Action", addCompare: "Comparer", deliveryForm: "Mode de livraison", deliveryLeadTime: "Délai", viewDetails: "Voir les détails", resultsSummary: "{count} offres · Voir la fiche pour les mises à jour", sourcesSummary: "{count} sources fournisseurs indiquées ; stock et prix à reconfirmer", supplierDirectory: "Répertoire fournisseur", supplierProvided: "Prix fourni par le fournisseur", supplierUnverified: "Non vérifié par KAI", sourcePrefix: "Source fournisseur : ", quoteSheet: "devis", maintenance: "Demandes manuelles en maintenance", submitInquiry: "Envoyer une demande", submitRelated: "Envoyer un besoin associé", standardCardHourUnit: "heures-carte KAI standard / ensemble-heure", inquiryAria: "Envoyer une demande pour {title}, référence {quote}", demandAria: "Envoyer un besoin associé à {title}", logoAlt: "Logo {supplier}", sample: "Échantillons", updated: "Mise à jour",
  },
  th: {
    categories: { gpu: "การประมวลผล GPU", token_model: "Token / โมเดล", rack_capacity: "แร็ก / ความจุ", cloud_vendor: "ผู้ให้บริการคลาวด์" }, deals: { rental: "เช่า", service: "ซื้อบริการ", swap: "แลกเปลี่ยนทรัพยากร" },
    taxIncluded: "รวมภาษี", taxExcluded: "ไม่รวมภาษี", energyIncluded: "รวมไฟฟ้า", energyExcluded: "ไม่รวมไฟฟ้า", networkIncluded: "รวมเครือข่าย", networkExcluded: "ไม่รวมเครือข่าย", heading: "ตลาดทรัพยากรประมวลผล", lead: "ค้นหาตัวเลือกตามแหล่งผู้ให้บริการ รุ่น GPU ภูมิภาค และรูปแบบส่งมอบ ราคาแปลงเป็นชั่วโมงการ์ดมาตรฐาน KAI และตรวจสอบสต็อกกับเงื่อนไขหลังส่งคำขอ", kicker: "ไดเรกทอรีอ้างอิงผู้ให้บริการ", directory: "ไดเรกทอรีอ้างอิง", directorySummary: "มีแหล่งใบเสนอราคาจากผู้ให้บริการ {count} ราย ทุกรายการต้องสอบถามและตรวจสอบใหม่", quoteNotice: "หมายเหตุราคา", sourceNoteLabel: "แหล่งข้อมูล: ", sourceNote: "ระบุชื่อบริษัท วันที่ข้อมูล และไฟล์ต้นฉบับ ไม่ได้หมายความว่าเข้าร่วมระบบหรือมีสต็อกพร้อมซื้อขาย", unverified: "ยังไม่ตรวจสอบโดย KAI · โปรดยืนยัน", filters: "ตัวกรองทรัพยากร", filterResources: "กรองทรัพยากร", clearCount: "ล้าง {count} รายการ", keyword: "คำค้น", searchPlaceholder: "รุ่น ความสามารถ หรือผู้ให้บริการ", category: "หมวดหมู่", allCategories: "ทุกหมวด", deal: "ประเภทธุรกรรม", allDeals: "ทุกประเภท", region: "ภูมิภาค", allRegions: "ทุกภูมิภาค", delivery: "รูปแบบส่งมอบ", allDeliveries: "ทุกรูปแบบ", unit: "หน่วยราคา", allUnits: "ทุกหน่วย", matchedInventory: "ทรัพยากรที่ตรงกัน", foundCount: "พบ {count} รายการ", sort: "เรียง", recommended: "แนะนำ", priceLowHigh: "ราคาต่ำไปสูง", priceHighLow: "ราคาสูงไปต่ำ", recentlyUpdated: "อัปเดตล่าสุด", compareLimit: "เปรียบเทียบได้สูงสุด 3 รายการ โปรดนำออกหนึ่งรายการ", comparePlans: "เปรียบเทียบตัวเลือก", selectedCount: "เลือก {count} / 3", clearCompare: "ล้างการเปรียบเทียบ", compareItem: "หัวข้อเปรียบเทียบ", remove: "นำออก", marketQuote: "ราคาอ้างอิงตลาด", supplierSource: "แหล่งผู้ให้บริการ", regionDelivery: "ภูมิภาค / ส่งมอบ", capacitySample: "ตัวอย่างความจุ", targetSla: "ระดับบริการเป้าหมาย", priceScope: "ขอบเขตราคา", quoteSamples: "ตัวอย่างราคา", updatedAt: "อัปเดต", confirmByInquiry: "ยืนยันผ่านการสอบถาม", noResults: "ไม่พบทรัพยากรที่ตรงกัน", noResultsHelp: "ล้างตัวกรองเพื่อดูทั้งหมด หรือส่งความต้องการให้ KAI จับคู่ด้วยเจ้าหน้าที่", clearAll: "ล้างตัวกรองทั้งหมด", submitDemand: "ส่งความต้องการ", resourceSupplier: "ทรัพยากร / ผู้ให้บริการ", categoryDeal: "หมวด / ธุรกรรม", capacitySla: "ความจุ / SLA เป้าหมาย", action: "การทำงาน", addCompare: "เพิ่มเพื่อเทียบ", deliveryForm: "รูปแบบส่งมอบ", deliveryLeadTime: "ระยะเวลาส่งมอบ", viewDetails: "ดูรายละเอียด", resultsSummary: "รวม {count} รายการ · ดูการอัปเดตในหน้ารายละเอียด", sourcesSummary: "ระบุแหล่งผู้ให้บริการ {count} ราย ต้องยืนยันสต็อกและราคาใหม่", supplierDirectory: "ไดเรกทอรีผู้ให้บริการ", supplierProvided: "ราคาจากผู้ให้บริการ", supplierUnverified: "ยังไม่ตรวจสอบโดย KAI", sourcePrefix: "แหล่งผู้ให้บริการ: ", quoteSheet: "ใบเสนอราคา", maintenance: "ระบบสอบถามโดยเจ้าหน้าที่อยู่ระหว่างปรับปรุง", submitInquiry: "ส่งคำขอราคา", submitRelated: "ส่งความต้องการที่เกี่ยวข้อง", standardCardHourUnit: "ชั่วโมงการ์ดมาตรฐาน KAI / ชุด·ชั่วโมง", inquiryAria: "ส่งคำขอสำหรับ {title} ราคาอ้างอิง {quote}", demandAria: "ส่งความต้องการที่เกี่ยวข้องกับ {title}", logoAlt: "โลโก้ {supplier}", sample: "ตัวอย่าง", updated: "อัปเดต",
  },
  vi: {
    categories: { gpu: "Năng lực GPU", token_model: "Token / mô hình", rack_capacity: "Tủ rack / dung lượng", cloud_vendor: "Nhà cung cấp đám mây" }, deals: { rental: "Thuê", service: "Mua dịch vụ", swap: "Hoán đổi tài nguyên" },
    taxIncluded: "Đã gồm thuế", taxExcluded: "Chưa gồm thuế", energyIncluded: "Đã gồm điện", energyExcluded: "Chưa gồm điện", networkIncluded: "Đã gồm mạng", networkExcluded: "Chưa gồm mạng", heading: "Chợ tài nguyên tính toán", lead: "Tìm phương án theo nguồn cung cấp, mẫu GPU, khu vực và hình thức bàn giao. Báo giá được quy đổi sang giờ-thẻ KAI tiêu chuẩn; tồn kho và điều kiện giao dịch được xác minh sau khi gửi.", kicker: "Danh mục tham khảo nhà cung cấp", directory: "Danh mục tham khảo", directorySummary: "Có nguồn báo giá từ {count} nhà cung cấp; mọi mục đều cần hỏi giá và xác minh lại.", quoteNotice: "Lưu ý báo giá", sourceNoteLabel: "Nguồn: ", sourceNote: "Tên công ty, ngày dữ liệu và tệp nguồn được ghi rõ. Điều này không có nghĩa nhà cung cấp đã tham gia hoặc có tồn kho giao dịch.", unverified: "Chưa được KAI xác minh · Cần hỏi lại", filters: "Bộ lọc tài nguyên", filterResources: "Lọc tài nguyên", clearCount: "Xóa {count} mục", keyword: "Từ khóa", searchPlaceholder: "Mẫu, khả năng hoặc nhà cung cấp", category: "Danh mục", allCategories: "Tất cả", deal: "Hình thức giao dịch", allDeals: "Tất cả", region: "Khu vực", allRegions: "Tất cả khu vực", delivery: "Hình thức bàn giao", allDeliveries: "Tất cả", unit: "Đơn vị giá", allUnits: "Tất cả", matchedInventory: "Tài nguyên phù hợp", foundCount: "Tìm thấy {count} tài nguyên", sort: "Sắp xếp", recommended: "Đề xuất", priceLowHigh: "Giá tăng dần", priceHighLow: "Giá giảm dần", recentlyUpdated: "Mới cập nhật", compareLimit: "Chỉ có thể so sánh tối đa 3 tài nguyên. Hãy xóa một mục.", comparePlans: "So sánh phương án", selectedCount: "Đã chọn {count} / 3", clearCompare: "Xóa so sánh", compareItem: "Mục so sánh", remove: "Xóa", marketQuote: "Giá tham khảo thị trường", supplierSource: "Nguồn nhà cung cấp", regionDelivery: "Khu vực / bàn giao", capacitySample: "Mẫu dung lượng", targetSla: "Mức dịch vụ mục tiêu", priceScope: "Phạm vi giá", quoteSamples: "Mẫu báo giá", updatedAt: "Cập nhật", confirmByInquiry: "Cần xác nhận khi hỏi giá", noResults: "Không có tài nguyên phù hợp", noResultsHelp: "Xóa bộ lọc để xem toàn bộ hoặc gửi nhu cầu để KAI hỗ trợ ghép nối thủ công.", clearAll: "Xóa tất cả bộ lọc", submitDemand: "Gửi nhu cầu", resourceSupplier: "Tài nguyên / nhà cung cấp", categoryDeal: "Danh mục / giao dịch", capacitySla: "Dung lượng / SLA mục tiêu", action: "Thao tác", addCompare: "Thêm so sánh", deliveryForm: "Hình thức bàn giao", deliveryLeadTime: "Thời gian bàn giao", viewDetails: "Xem chi tiết", resultsSummary: "Tổng {count} mục · Xem trang chi tiết để biết cập nhật giá", sourcesSummary: "Đã ghi nguồn của {count} nhà cung cấp; cần xác nhận lại tồn kho và giá", supplierDirectory: "Danh mục nhà cung cấp", supplierProvided: "Báo giá do nhà cung cấp cung cấp", supplierUnverified: "Chưa được KAI xác minh", sourcePrefix: "Nguồn nhà cung cấp: ", quoteSheet: "bảng báo giá", maintenance: "Kênh hỏi giá thủ công đang bảo trì", submitInquiry: "Gửi hỏi giá", submitRelated: "Gửi nhu cầu liên quan", standardCardHourUnit: "giờ-thẻ KAI tiêu chuẩn / bộ·giờ", inquiryAria: "Gửi hỏi giá cho {title}, giá tham khảo {quote}", demandAria: "Gửi nhu cầu liên quan đến {title}", logoAlt: "Logo {supplier}", sample: "Mẫu", updated: "Cập nhật",
  },
  id: {
    categories: { gpu: "Komputasi GPU", token_model: "Token / model", rack_capacity: "Rak / kapasitas", cloud_vendor: "Penyedia cloud" }, deals: { rental: "Sewa", service: "Pembelian layanan", swap: "Pertukaran sumber daya" },
    taxIncluded: "Termasuk pajak", taxExcluded: "Belum termasuk pajak", energyIncluded: "Termasuk energi", energyExcluded: "Belum termasuk energi", networkIncluded: "Termasuk jaringan", networkExcluded: "Belum termasuk jaringan", heading: "Pasar Sumber Daya Komputasi", lead: "Temukan opsi berdasarkan sumber pemasok, model GPU, wilayah, dan format pengiriman. Harga dinormalisasi ke jam-kartu standar KAI; stok dan ketentuan transaksi diverifikasi setelah pengajuan.", kicker: "Direktori referensi pemasok", directory: "Direktori referensi", directorySummary: "Mencakup sumber penawaran dari {count} pemasok; semuanya perlu ditanyakan dan diverifikasi ulang.", quoteNotice: "Catatan harga", sourceNoteLabel: "Sumber: ", sourceNote: "Nama perusahaan, tanggal data, dan berkas sumber ditampilkan. Ini tidak berarti pemasok telah bergabung atau memiliki stok siap transaksi.", unverified: "Belum diverifikasi KAI · Konfirmasi melalui pertanyaan", filters: "Filter sumber daya", filterResources: "Filter sumber daya", clearCount: "Hapus {count}", keyword: "Kata kunci", searchPlaceholder: "Model, kemampuan, atau pemasok", category: "Kategori", allCategories: "Semua kategori", deal: "Jenis transaksi", allDeals: "Semua jenis", region: "Wilayah", allRegions: "Semua wilayah", delivery: "Format pengiriman", allDeliveries: "Semua format", unit: "Satuan harga", allUnits: "Semua satuan", matchedInventory: "Sumber daya cocok", foundCount: "{count} sumber daya ditemukan", sort: "Urutkan", recommended: "Rekomendasi", priceLowHigh: "Harga terendah", priceHighLow: "Harga tertinggi", recentlyUpdated: "Pembaruan terbaru", compareLimit: "Maksimal 3 sumber daya dapat dibandingkan. Hapus satu terlebih dahulu.", comparePlans: "Bandingkan opsi", selectedCount: "{count} / 3 dipilih", clearCompare: "Hapus perbandingan", compareItem: "Item perbandingan", remove: "Hapus", marketQuote: "Harga referensi pasar", supplierSource: "Sumber pemasok", regionDelivery: "Wilayah / pengiriman", capacitySample: "Sampel kapasitas", targetSla: "Tingkat layanan target", priceScope: "Cakupan harga", quoteSamples: "Sampel penawaran", updatedAt: "Diperbarui", confirmByInquiry: "Konfirmasi melalui pertanyaan", noResults: "Tidak ada sumber daya yang cocok", noResultsHelp: "Hapus filter untuk melihat semua sumber daya, atau kirim kebutuhan agar KAI mencocokkan secara manual.", clearAll: "Hapus semua filter", submitDemand: "Kirim kebutuhan", resourceSupplier: "Sumber daya / pemasok", categoryDeal: "Kategori / transaksi", capacitySla: "Kapasitas / SLA target", action: "Tindakan", addCompare: "Bandingkan", deliveryForm: "Format pengiriman", deliveryLeadTime: "Waktu pengiriman", viewDetails: "Lihat detail", resultsSummary: "Total {count} item · Lihat halaman detail untuk pembaruan harga", sourcesSummary: "Sumber dari {count} pemasok ditandai; stok dan harga perlu dikonfirmasi ulang", supplierDirectory: "Direktori pemasok", supplierProvided: "Penawaran dari pemasok", supplierUnverified: "Belum diverifikasi KAI", sourcePrefix: "Sumber pemasok: ", quoteSheet: "lembar penawaran", maintenance: "Pertanyaan manual sedang dipelihara", submitInquiry: "Kirim pertanyaan", submitRelated: "Kirim kebutuhan terkait", standardCardHourUnit: "jam-kartu standar KAI / set·jam", inquiryAria: "Kirim pertanyaan untuk {title}, referensi katalog {quote}", demandAria: "Kirim kebutuhan komputasi terkait {title}", logoAlt: "Logo {supplier}", sample: "Sampel", updated: "Diperbarui",
  },
  ms: {
    categories: { gpu: "Pengkomputeran GPU", token_model: "Token / model", rack_capacity: "Rak / kapasiti", cloud_vendor: "Penyedia awan" }, deals: { rental: "Sewa", service: "Pembelian perkhidmatan", swap: "Pertukaran sumber" },
    taxIncluded: "Termasuk cukai", taxExcluded: "Tidak termasuk cukai", energyIncluded: "Termasuk tenaga", energyExcluded: "Tidak termasuk tenaga", networkIncluded: "Termasuk rangkaian", networkExcluded: "Tidak termasuk rangkaian", heading: "Pasaran Sumber Pengkomputeran", lead: "Temui pilihan mengikut sumber pembekal, model GPU, rantau dan bentuk penghantaran. Sebut harga diseragamkan kepada jam-kad standard KAI; stok dan syarat transaksi disahkan selepas penyerahan.", kicker: "Direktori rujukan pembekal", directory: "Direktori rujukan", directorySummary: "Merangkumi sumber sebut harga daripada {count} pembekal; semuanya perlu ditanya dan disahkan semula.", quoteNotice: "Notis harga", sourceNoteLabel: "Sumber: ", sourceNote: "Nama syarikat, tarikh data dan fail sumber dinyatakan. Ini tidak bermakna pembekal telah menyertai atau mempunyai stok sedia niaga.", unverified: "Belum disahkan KAI · Sahkan melalui pertanyaan", filters: "Penapis sumber", filterResources: "Tapis sumber", clearCount: "Kosongkan {count}", keyword: "Kata kunci", searchPlaceholder: "Model, keupayaan atau pembekal", category: "Kategori", allCategories: "Semua kategori", deal: "Jenis urus niaga", allDeals: "Semua jenis", region: "Rantau", allRegions: "Semua rantau", delivery: "Bentuk penghantaran", allDeliveries: "Semua bentuk", unit: "Unit harga", allUnits: "Semua unit", matchedInventory: "Sumber sepadan", foundCount: "{count} sumber ditemui", sort: "Susun", recommended: "Disyorkan", priceLowHigh: "Harga rendah ke tinggi", priceHighLow: "Harga tinggi ke rendah", recentlyUpdated: "Kemas kini terkini", compareLimit: "Maksimum 3 sumber boleh dibandingkan. Alih keluar satu dahulu.", comparePlans: "Bandingkan pilihan", selectedCount: "{count} / 3 dipilih", clearCompare: "Kosongkan perbandingan", compareItem: "Item perbandingan", remove: "Alih keluar", marketQuote: "Harga rujukan pasaran", supplierSource: "Sumber pembekal", regionDelivery: "Rantau / penghantaran", capacitySample: "Sampel kapasiti", targetSla: "Tahap perkhidmatan sasaran", priceScope: "Skop harga", quoteSamples: "Sampel sebut harga", updatedAt: "Dikemas kini", confirmByInquiry: "Sahkan melalui pertanyaan", noResults: "Tiada sumber yang sepadan", noResultsHelp: "Kosongkan penapis untuk melihat semua sumber atau serahkan keperluan untuk padanan manual KAI.", clearAll: "Kosongkan semua penapis", submitDemand: "Serahkan keperluan", resourceSupplier: "Sumber / pembekal", categoryDeal: "Kategori / urus niaga", capacitySla: "Kapasiti / SLA sasaran", action: "Tindakan", addCompare: "Bandingkan", deliveryForm: "Bentuk penghantaran", deliveryLeadTime: "Tempoh penghantaran", viewDetails: "Lihat butiran", resultsSummary: "Jumlah {count} item · Lihat halaman butiran untuk kemas kini harga", sourcesSummary: "Sumber daripada {count} pembekal ditanda; stok dan harga perlu disahkan semula", supplierDirectory: "Direktori pembekal", supplierProvided: "Sebut harga pembekal", supplierUnverified: "Belum disahkan KAI", sourcePrefix: "Sumber pembekal: ", quoteSheet: "helaian sebut harga", maintenance: "Pertanyaan manual sedang diselenggara", submitInquiry: "Hantar pertanyaan", submitRelated: "Hantar keperluan berkaitan", standardCardHourUnit: "jam-kad standard KAI / set·jam", inquiryAria: "Hantar pertanyaan untuk {title}, rujukan katalog {quote}", demandAria: "Hantar keperluan pengkomputeran berkaitan {title}", logoAlt: "Logo {supplier}", sample: "Sampel", updated: "Dikemas kini",
  },
} satisfies Record<Locale, ResourceExplorerCopy>;

const COMPARE_KEY = "kai-cloud-compare-v1";

function readCompareIds() {
  try {
    const value = JSON.parse(window.localStorage.getItem(COMPARE_KEY) ?? "[]") as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string").slice(0, 3)
      : [];
  } catch {
    return [];
  }
}

function saveCompareIds(ids: string[]) {
  try {
    window.localStorage.setItem(COMPARE_KEY, JSON.stringify(ids));
    window.dispatchEvent(new CustomEvent("kai-compare-changed", { detail: ids }));
  } catch {
    // Comparing remains available for this page when browser storage is unavailable.
  }
}

function unique(values: string[]) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function interpolate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), template);
}

function pricingScope(resource: ResourceListing, copy: ResourceExplorerCopy) {
  const { quote } = resource;
  return [
    quote.taxIncluded ? copy.taxIncluded : copy.taxExcluded,
    quote.energyIncluded ? copy.energyIncluded : copy.energyExcluded,
    quote.networkIncluded ? copy.networkIncluded : copy.networkExcluded,
  ].join(" · ");
}

function catalogDisplayQuote(resource: ResourceListing, classification: BuyCatalogClassification, copy: ResourceExplorerCopy) {
  return classification === "PRIMARY_INQUIRY"
    ? `${formatCardHourValue(resource.quote.median / 1.002)} ${copy.standardCardHourUnit}`
    : formatCardHourQuote(resource.quote.median, resource.pricingUnit);
}

function publicCatalogText(value: string) {
  return value;
}

function supplierSource(resource: ResourceListing, copy: ResourceExplorerCopy) {
  if (!resource.source) return `${resource.supplierName} · ${copy.supplierDirectory}`;
  const status = resource.source.verificationStatus === "SUPPLIER_PROVIDED" ? copy.supplierProvided : copy.supplierUnverified;
  return `${copy.sourcePrefix}${resource.source.supplierName} · ${copy.quoteSheet} ${resource.source.observedAt} · ${status}`;
}

function SupplierIdentity({ copy, resource }: { copy: ResourceExplorerCopy; resource: ResourceListing }) {
  return (
    <span className="mt-1 flex items-center gap-2 text-xs text-[var(--muted)]">
      {resource.supplierLogoUrl ? <Image alt={interpolate(copy.logoAlt, { supplier: resource.supplierName })} className="h-8 w-8 shrink-0 border border-[var(--border)] object-cover" height={32} src={resource.supplierLogoUrl} width={32} /> : null}
      <span>{supplierSource(resource, copy)}</span>
    </span>
  );
}

function ResourceInquiryAction({
  classification,
  copy,
  inquiryEnabled,
  resource,
}: {
  classification: BuyCatalogClassification;
  copy: ResourceExplorerCopy;
  inquiryEnabled: boolean;
  resource: ResourceListing;
}) {
  if (classification === "PRIMARY_INQUIRY") {
    if (!inquiryEnabled) {
      return <span className={`${purchaseStyles.purchaseLink} cursor-not-allowed opacity-60`} aria-disabled="true">{copy.maintenance}</span>;
    }
    return (
      <Link
        className={purchaseStyles.purchaseLink}
        href={`/checkout/${encodeURIComponent(resource.id)}`}
        aria-label={interpolate(copy.inquiryAria, { title: resource.title, quote: catalogDisplayQuote(resource, classification, copy) })}
      >
        <span>{copy.submitInquiry}</span><span aria-hidden="true">→</span>
      </Link>
    );
  }

  return (
    <Link
      className={purchaseStyles.purchaseLink}
      href={`/request?listing=${encodeURIComponent(resource.id)}`}
      aria-label={interpolate(copy.demandAria, { title: resource.title })}
    >
      <span>{classification === "REFERENCE_LEAD" ? copy.submitRelated : copy.submitDemand}</span><span aria-hidden="true">→</span>
    </Link>
  );
}

function FilterSelect({
  id,
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  allLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2 text-xs font-semibold text-[var(--muted)]" htmlFor={id}>
      {label}
      <select
        id={id}
        className="min-h-11 w-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--ink)]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export function ResourceExplorer({
  classifications,
  inquiryEnabled,
  listings,
  heading,
  lead,
}: {
  classifications: Readonly<Record<string, BuyCatalogClassification>>;
  inquiryEnabled: boolean;
  listings: readonly ResourceListing[];
  heading?: string;
  lead?: string;
}) {
  const { locale } = useLocale();
  const copy = RESOURCE_EXPLORER_COPY[locale];
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareMessage, setCompareMessage] = useState("");

  useEffect(() => {
    const syncCompareIds = () => setCompareIds(readCompareIds());
    syncCompareIds();
    window.addEventListener("storage", syncCompareIds);
    window.addEventListener("kai-compare-changed", syncCompareIds);
    return () => {
      window.removeEventListener("storage", syncCompareIds);
      window.removeEventListener("kai-compare-changed", syncCompareIds);
    };
  }, []);

  const queryObject = useMemo(
    () => Object.fromEntries(searchParams.entries()),
    [searchParams],
  );
  const parsedFilters = useMemo(() => parseResourceQuery(queryObject), [queryObject]);
  const results = useMemo(
    () => filterAndSortResources(listings, parsedFilters),
    [listings, parsedFilters],
  );

  const regions = useMemo(() => unique(listings.map((item) => item.region)), [listings]);
  const deliveries = useMemo(() => unique(listings.map((item) => item.deliveryForm)), [listings]);
  const units = useMemo(() => unique(listings.map((item) => item.pricingUnit)), [listings]);
  const sourcedCount = useMemo(() => new Set(listings.flatMap((item) => item.source ? [item.source.supplierName] : [])).size, [listings]);
  const compared = compareIds
    .map((id) => listings.find((item) => item.id === id))
    .filter((item): item is ResourceListing => Boolean(item));

  function currentValue(key: string) {
    return searchParams.get(key) ?? "";
  }

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function clearFilters() {
    router.replace(pathname, { scroll: false });
  }

  function toggleCompare(id: string) {
    setCompareIds((current) => {
      if (current.includes(id)) {
        setCompareMessage("");
        const next = current.filter((item) => item !== id);
        saveCompareIds(next);
        return next;
      }
      if (current.length >= 3) {
        setCompareMessage(copy.compareLimit);
        return current;
      }
      setCompareMessage("");
      const next = [...current, id];
      saveCompareIds(next);
      return next;
    });
  }

  function clearCompare() {
    setCompareIds([]);
    setCompareMessage("");
    saveCompareIds([]);
  }

  const activeFilterCount = ["category", "deal", "region", "delivery", "unit", "q"]
    .filter((key) => currentValue(key)).length;

  return (
    <div>
      <section className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="shell py-14 sm:py-16">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
            <div>
              <p className="kicker">{copy.kicker}</p>
              <h1 className="m-0 max-w-4xl text-4xl leading-[1.08] text-[var(--ink)] sm:text-5xl">{heading ?? copy.heading}</h1>
              <p className="section-lead">{lead ?? copy.lead}</p>
            </div>
            <div className="border-t-2 border-[var(--accent)] bg-[var(--info-bg)] px-5 py-4">
              <div className="flex items-baseline justify-between gap-6">
                <span className="text-xs font-semibold text-[var(--muted)]">{copy.directory}</span>
                <strong className="text-3xl tabular-nums text-[var(--ink)]">{listings.length}</strong>
              </div>
              <p className="mt-2 mb-0 text-xs leading-5 text-[var(--muted)]">{interpolate(copy.directorySummary, { count: sourcedCount })}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="shell py-10 sm:py-12">
        <aside className="market-notice mb-8" aria-label={copy.quoteNotice}>
          <p className="m-0"><strong>{copy.sourceNoteLabel}</strong>{copy.sourceNote}</p>
          <p className="m-0 whitespace-nowrap font-semibold text-[var(--warning)]">{copy.unverified}</p>
        </aside>

        <div className="grid items-start gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="border border-[var(--border)] bg-[var(--info-bg)] lg:sticky lg:top-28" aria-label={copy.filters}>
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-4">
              <h2 className="m-0 text-base text-[var(--ink)]">{copy.filterResources}</h2>
              {activeFilterCount > 0 && (
                <button
                  className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center border-0 bg-transparent px-2 text-xs font-semibold text-[var(--accent)] underline underline-offset-4"
                  type="button"
                  onClick={clearFilters}
                >
                  {interpolate(copy.clearCount, { count: activeFilterCount })}
                </button>
              )}
            </div>
            <div className="grid gap-5 p-4 sm:grid-cols-2 lg:grid-cols-1">
              <label className="grid gap-2 text-xs font-semibold text-[var(--muted)] sm:col-span-2 lg:col-span-1" htmlFor="resource-search">
                {copy.keyword}
                <input
                  id="resource-search"
                  className="min-h-11 w-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--ink)] placeholder:text-[var(--muted)]"
                  type="search"
                  value={currentValue("q")}
                  placeholder={copy.searchPlaceholder}
                  onChange={(event) => updateFilter("q", event.target.value)}
                />
              </label>
              <FilterSelect
                id="filter-category"
                label={copy.category}
                allLabel={copy.allCategories}
                value={currentValue("category")}
                onChange={(value) => updateFilter("category", value)}
                options={(Object.entries(copy.categories) as Array<[ResourceCategory, string]>).map(([value, label]) => ({ value, label }))}
              />
              <FilterSelect
                id="filter-deal"
                label={copy.deal}
                allLabel={copy.allDeals}
                value={currentValue("deal")}
                onChange={(value) => updateFilter("deal", value)}
                options={(Object.entries(copy.deals) as Array<[DealMode, string]>).map(([value, label]) => ({ value, label }))}
              />
              <FilterSelect
                id="filter-region"
                label={copy.region}
                allLabel={copy.allRegions}
                value={currentValue("region")}
                onChange={(value) => updateFilter("region", value)}
                options={regions.map((value) => ({ value, label: value }))}
              />
              <FilterSelect
                id="filter-delivery"
                label={copy.delivery}
                allLabel={copy.allDeliveries}
                value={currentValue("delivery")}
                onChange={(value) => updateFilter("delivery", value)}
                options={deliveries.map((value) => ({ value, label: value }))}
              />
              <FilterSelect
                id="filter-unit"
                label={copy.unit}
                allLabel={copy.allUnits}
                value={currentValue("unit")}
                onChange={(value) => updateFilter("unit", value)}
                options={units.map((value) => ({ value, label: value }))}
              />
            </div>
          </aside>

          <div className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border-strong)] pb-4">
              <div>
                <p className="m-0 text-xs font-semibold tracking-wide text-[var(--muted)]">{copy.matchedInventory}</p>
                <p className="mt-1 mb-0 text-lg font-semibold text-[var(--ink)]">
                  {interpolate(copy.foundCount, { count: results.length })}
                </p>
              </div>
              <label className="flex items-center gap-3 text-xs font-semibold text-[var(--muted)]" htmlFor="resource-sort">
                {copy.sort}
                <select
                  id="resource-sort"
                  className="min-h-11 border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"
                  value={currentValue("sort") || "recommended"}
                  onChange={(event) => updateFilter("sort", event.target.value === "recommended" ? "" : event.target.value)}
                >
                  <option value="recommended">{copy.recommended}</option>
                  <option value="price_asc">{copy.priceLowHigh}</option>
                  <option value="price_desc">{copy.priceHighLow}</option>
                  <option value="updated_desc">{copy.recentlyUpdated}</option>
                </select>
              </label>
            </div>

            {compareMessage && (
              <p className="my-4 border-l-2 border-[var(--warning)] bg-[var(--warning-bg)] px-4 py-3 text-sm text-[var(--warning)]" role="status">
                {compareMessage}
              </p>
            )}

            {compared.length > 0 && (
              <section className="my-6 border-t-2 border-[var(--accent)] bg-[var(--surface)]" aria-labelledby="compare-title">
                <div className="flex flex-wrap items-center justify-between gap-3 border-x border-b border-[var(--border)] px-4 py-3">
                  <div>
                    <h2 id="compare-title" className="m-0 text-base text-[var(--ink)]">{copy.comparePlans}</h2>
                    <p className="m-0 text-xs text-[var(--muted)]">{interpolate(copy.selectedCount, { count: compared.length })}</p>
                  </div>
                  <button
                    className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center border-0 bg-transparent px-2 text-xs font-semibold text-[var(--accent)] underline underline-offset-4"
                    type="button"
                    onClick={clearCompare}
                  >
                    {copy.clearCompare}
                  </button>
                </div>
                <div className="overflow-x-auto border-x border-b border-[var(--border)]">
                  <table className="w-full min-w-[680px] border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="w-32 border-r border-[var(--border)] bg-[var(--info-bg)] p-3 text-left text-xs text-[var(--muted)]" scope="col">{copy.compareItem}</th>
                        {compared.map((resource) => (
                          <th key={resource.id} className="min-w-44 border-r border-[var(--border)] p-3 text-left align-top last:border-r-0" scope="col">
                            <Link className="inline-flex min-h-11 items-center font-semibold text-[var(--ink)] underline decoration-[var(--border-strong)] underline-offset-4 hover:text-[var(--accent)]" href={`/resources/${resource.id}`}>
                              {resource.title}
                            </Link>
                            <button
                              className="mt-1 inline-flex min-h-11 min-w-11 cursor-pointer items-center border-0 bg-transparent px-1 text-xs font-medium text-[var(--muted)] underline underline-offset-4"
                              type="button"
                              onClick={() => toggleCompare(resource.id)}
                            >{copy.remove}</button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        [copy.marketQuote, (item: ResourceListing) => catalogDisplayQuote(item, classifications[item.id] ?? "EXCLUDED", copy)],
                        [copy.supplierSource, (item: ResourceListing) => supplierSource(item, copy)],
                        [copy.regionDelivery, (item: ResourceListing) => `${item.region} · ${item.deliveryForm}`],
                        [copy.capacitySample, (item: ResourceListing) => publicCatalogText(item.capacity)],
                        [copy.targetSla, (item: ResourceListing) => publicCatalogText(item.sla)],
                        [copy.priceScope, (item: ResourceListing) => pricingScope(item, copy)],
                        [copy.quoteSamples, (item: ResourceListing) => `${item.quote.sampleCount}`],
                        [copy.updatedAt, (item: ResourceListing) => item.quote.updatedAt],
                      ].map(([label, render]) => (
                        <tr key={label as string} className="border-t border-[var(--border)]">
                          <th className="border-r border-[var(--border)] bg-[var(--info-bg)] p-3 text-left text-xs text-[var(--muted)]" scope="row">{label as string}</th>
                          {compared.map((resource) => (
                            <td key={resource.id} className="border-r border-[var(--border)] p-3 align-top text-[var(--text)] last:border-r-0">
                              {(render as (item: ResourceListing) => string)(resource)}
                              {label === copy.marketQuote && <span className="mt-1 block text-xs text-[var(--warning)]">{copy.confirmByInquiry}</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {results.length === 0 ? (
              <div className="mt-6 border-y border-[var(--border)] bg-[var(--surface)] px-6 py-20 text-center">
                <p className="m-0 text-xl font-semibold text-[var(--ink)]">{copy.noResults}</p>
                <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">
                  {copy.noResultsHelp}
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <button className="button button-secondary cursor-pointer" type="button" onClick={clearFilters}>{copy.clearAll}</button>
                  <Link className="button button-primary" href="/request">{copy.submitDemand}</Link>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-6 hidden overflow-x-auto border border-[var(--border)] xl:block">
                  <table className="data-table min-w-[920px]">
                    <thead>
                      <tr>
                        <th scope="col">{copy.resourceSupplier}</th>
                        <th scope="col">{copy.categoryDeal}</th>
                        <th scope="col">{copy.regionDelivery}</th>
                        <th scope="col">{copy.capacitySla}</th>
                        <th className="num" scope="col">{copy.marketQuote}</th>
                        <th scope="col">{copy.action}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((resource) => (
                        <tr key={resource.id}>
                          <td className="min-w-64">
                            <Link className="inline-flex min-h-11 items-center font-semibold text-[var(--ink)] underline decoration-[var(--border-strong)] underline-offset-4 hover:text-[var(--accent)]" href={`/resources/${resource.id}`}>
                              {resource.title}
                            </Link>
                            <SupplierIdentity copy={copy} resource={resource} />
                          </td>
                          <td className="min-w-40">
                            <span className="font-semibold text-[var(--ink)]">{copy.categories[resource.category]}</span>
                            <span className="mt-1 block text-xs text-[var(--muted)]">{resource.dealModes.map((mode) => copy.deals[mode]).join(" / ")}</span>
                          </td>
                          <td className="min-w-40">{resource.region}<span className="mt-1 block text-xs text-[var(--muted)]">{resource.deliveryForm}</span></td>
                          <td className="min-w-44">{publicCatalogText(resource.capacity)}<span className="mt-1 block text-xs text-[var(--muted)]">SLA {publicCatalogText(resource.sla)}</span></td>
                          <td className="num min-w-44">
                            <strong className="block whitespace-nowrap text-xl text-[var(--ink)]">{catalogDisplayQuote(resource, classifications[resource.id] ?? "EXCLUDED", copy)}</strong>
                            <span className="mt-1 block text-xs text-[var(--warning)]">{copy.marketQuote} · {copy.confirmByInquiry}</span>
                            <span className="mt-1 block text-xs text-[var(--muted)]">{pricingScope(resource, copy)}</span>
                            <span className="mt-1 block text-xs text-[var(--muted)]">{copy.sample} {resource.quote.sampleCount} · {copy.updated} {resource.quote.updatedAt}</span>
                          </td>
                          <td className="min-w-32">
                            <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--text)]">
                              <input
                                type="checkbox"
                                checked={compareIds.includes(resource.id)}
                                onChange={() => toggleCompare(resource.id)}
                              />
                              {copy.addCompare}
                            </label>
                            <ResourceInquiryAction classification={classifications[resource.id] ?? "EXCLUDED"} copy={copy} inquiryEnabled={inquiryEnabled} resource={resource} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-6 grid gap-4 xl:hidden">
                  {results.map((resource) => (
                    <article key={resource.id} className="border-t-2 border-[var(--border-strong)] bg-[var(--surface)] p-5 ring-1 ring-[var(--border)]">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="m-0 text-xs font-semibold text-[var(--accent)]">{copy.categories[resource.category]} · {resource.region}</p>
                          <h2 className="mt-2 mb-0 text-xl text-[var(--ink)]">
                            <Link className="inline-flex min-h-11 items-center hover:text-[var(--accent)]" href={`/resources/${resource.id}`}>{resource.title}</Link>
                          </h2>
                          <SupplierIdentity copy={copy} resource={resource} />
                        </div>
                        <div className={purchaseStyles.mobileActions}>
                          <label className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--text)]">
                            <input type="checkbox" checked={compareIds.includes(resource.id)} onChange={() => toggleCompare(resource.id)} />
                            {copy.addCompare}
                          </label>
                          <ResourceInquiryAction classification={classifications[resource.id] ?? "EXCLUDED"} copy={copy} inquiryEnabled={inquiryEnabled} resource={resource} />
                        </div>
                      </div>
                      <p className="mt-5 mb-0 text-sm leading-6 text-[var(--text)]">{publicCatalogText(resource.summary)}</p>
                      <dl className="mt-5 grid grid-cols-2 gap-4 border-y border-[var(--border)] py-4 text-sm">
                        <div><dt className="text-xs text-[var(--muted)]">{copy.deliveryForm}</dt><dd className="mt-1 font-semibold text-[var(--ink)]">{resource.deliveryForm}</dd></div>
                        <div><dt className="text-xs text-[var(--muted)]">{copy.deliveryLeadTime}</dt><dd className="mt-1 font-semibold text-[var(--ink)]">{publicCatalogText(resource.deliveryLeadTime)}</dd></div>
                        <div><dt className="text-xs text-[var(--muted)]">{copy.capacitySample}</dt><dd className="mt-1 font-semibold text-[var(--ink)]">{publicCatalogText(resource.capacity)}</dd></div>
                        <div><dt className="text-xs text-[var(--muted)]">{copy.targetSla}</dt><dd className="mt-1 font-semibold text-[var(--ink)]">{publicCatalogText(resource.sla)}</dd></div>
                      </dl>
                      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
                        <div>
                          <p className="m-0 text-xs text-[var(--muted)]">{copy.marketQuote}</p>
                          <p className="mt-1 mb-0 text-2xl font-semibold tabular-nums text-[var(--ink)]">{catalogDisplayQuote(resource, classifications[resource.id] ?? "EXCLUDED", copy)}</p>
                          <p className="m-0 text-xs text-[var(--warning)]">{copy.confirmByInquiry} · {pricingScope(resource, copy)}</p>
                          <p className="mt-1 mb-0 text-xs text-[var(--muted)]">{copy.sample} {resource.quote.sampleCount} · {copy.updated} {resource.quote.updatedAt}</p>
                        </div>
                        <Link className="button button-secondary button-compact" href={`/resources/${resource.id}`}>{copy.viewDetails} →</Link>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}

            {results.length > 0 && (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
                <span>{interpolate(copy.resultsSummary, { count: results.length })}</span>
                <span>{interpolate(copy.sourcesSummary, { count: sourcedCount })}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
