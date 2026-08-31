import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ResourceDetailActions } from "@/components/resource-detail-actions";
import { classifyBuyCatalogListing } from "@/lib/buy-catalog";
import { formatCardHourValue } from "@/lib/card-hours";
import { getResourceById, resourceListings, suppliers } from "@/lib/data";
import type { Locale } from "@/lib/i18n";
import { formatCardHourQuote } from "@/lib/market";
import { isBuyCatalogV2Enabled } from "@/lib/server/buy-catalog-feature";
import { manualDeliveryIntakeEnabled } from "@/lib/server/manual-delivery-intake";
import { getRequestLocale } from "@/lib/server/request-locale";
import type { DealMode, ResourceCategory } from "@/lib/types";

type ResourceDetailCopy = {
  categories: Record<ResourceCategory, string>;
  deals: Record<DealMode, string>;
  notFound: string; detailSuffix: string; descriptionSuffix: string; breadcrumb: string; quoteSupplier: string; initialSupplier: string; resourceId: string;
  marketQuote: string; supplierConfirmation: string; referenceRange: string; sampleCount: string; recordUnit: string; updatedAt: string; validUntil: string;
  noticeAria: string; important: string; marketConfirm: string; profileKicker: string; overview: string; capacity: string; sla: string; deliveryForm: string; deliveryLead: string;
  technicalKicker: string; specifications: string; tagsAria: string; pricingKicker: string; pricingScope: string; displayUnit: string; cardHourSetUnit: string;
  tax: string; taxIncluded: string; taxExcluded: string; energy: string; energyIncluded: string; energyExcluded: string; network: string; networkIncluded: string; networkExcluded: string; scopeNote: string; priceDisclaimer: string;
  supplierKicker: string; supplierInfo: string; supplierSource: string; supplierProfile: string; dataSource: string; supplierProvided: string; userProvided: string; quoteDate: string; supplierPending: string; leadPending: string; platformSource: string; supportedDeals: string;
  actionsAria: string; nextStep: string; inquiryTitle: string; requestTitle: string; inquiryDescription: string; requestDescription: string; quoteSamples: string; dataStatus: string; catalogPending: string; backBuy: string; backResources: string;
};

const RESOURCE_DETAIL_COPY = {
  "zh-CN": { categories: { gpu: "GPU 算力", token_model: "Token / 模型", rack_capacity: "整机柜 / 容量", cloud_vendor: "云厂商资源" }, deals: { rental: "租赁", service: "服务采购", swap: "资源置换" }, notFound: "资源未找到", detailSuffix: "资源详情", descriptionSuffix: "市场参考报价，具体以询价确认为准。", breadcrumb: "面包屑导航", quoteSupplier: "报价单供应商来源", initialSupplier: "平台初始化供应方档案", resourceId: "资源编号", marketQuote: "市场参考报价", supplierConfirmation: "供应商确认后生效", referenceRange: "参考区间", sampleCount: "样本量", recordUnit: "条", updatedAt: "更新于", validUntil: "有效期至", noticeAria: "市场报价说明", important: "重要说明：", marketConfirm: "市场参考报价 · 询价后确认", profileKicker: "资源档案", overview: "资源概览", capacity: "容量样本", sla: "服务等级 SLA", deliveryForm: "交付形态", deliveryLead: "预计交付周期", technicalKicker: "技术规格", specifications: "规格参数", tagsAria: "资源标签", pricingKicker: "计价范围", pricingScope: "计价口径", displayUnit: "平台展示单位", cardHourSetUnit: "卡时 / 套·小时", tax: "税费", taxIncluded: "报价已含税", taxExcluded: "报价未含税", energy: "电力", energyIncluded: "已含基础电力", energyExcluded: "不含电力费用", network: "网络", networkIncluded: "已含基础网络", networkExcluded: "不含网络费用", scopeNote: "补充口径", priceDisclaimer: "最终价格会受期限、资源数量、并发、网络、电力、税费与交付条件影响。页面展示市场参考报价，具体以询价确认为准。", supplierKicker: "供应商档案", supplierInfo: "供应与撮合说明", supplierSource: "供应商来源", supplierProfile: "供应方档案", dataSource: "数据来源：", supplierProvided: "供应商提供的", userProvided: "用户提供的", quoteDate: "报价单日期：", supplierPending: "供应商提供报价 · 库存、地域网络与正式卡时报价待确认", leadPending: "报价资料线索 · 需重新匹配与确认", platformSource: "当前供应方档案为平台初始化样本，接入后核验；平台不对外披露其他供应方的原始报价。", supportedDeals: "支持交易方式", actionsAria: "资源操作", nextStep: "下一步", inquiryTitle: "提交套餐询价", requestTitle: "提交相关算力需求", inquiryDescription: "核对数量、租用时长与 SSH 公钥，平台再确认库存、地域网络和正式卡时报价。", requestDescription: "此条目仅作资源线索，平台将根据你的需求重新匹配供应商。", quoteSamples: "报价样本", dataStatus: "数据状态", catalogPending: "目录资料 · 需重新确认", backBuy: "返回 GPU 套餐继续比较", backResources: "返回资源市场继续比较" },
  "zh-TW": { categories: { gpu: "GPU 算力", token_model: "Token / 模型", rack_capacity: "整機櫃 / 容量", cloud_vendor: "雲端供應商資源" }, deals: { rental: "租賃", service: "服務採購", swap: "資源置換" }, notFound: "找不到資源", detailSuffix: "資源詳情", descriptionSuffix: "市場參考報價，具體以詢價確認為準。", breadcrumb: "麵包屑導覽", quoteSupplier: "報價單供應商來源", initialSupplier: "平台初始化供應方檔案", resourceId: "資源編號", marketQuote: "市場參考報價", supplierConfirmation: "供應商確認後生效", referenceRange: "參考區間", sampleCount: "樣本量", recordUnit: "筆", updatedAt: "更新於", validUntil: "有效期至", noticeAria: "市場報價說明", important: "重要說明：", marketConfirm: "市場參考報價 · 詢價後確認", profileKicker: "資源檔案", overview: "資源概覽", capacity: "容量樣本", sla: "服務等級 SLA", deliveryForm: "交付形態", deliveryLead: "預計交付週期", technicalKicker: "技術規格", specifications: "規格參數", tagsAria: "資源標籤", pricingKicker: "計價範圍", pricingScope: "計價口徑", displayUnit: "平台顯示單位", cardHourSetUnit: "卡時 / 套·小時", tax: "稅費", taxIncluded: "報價已含稅", taxExcluded: "報價未含稅", energy: "電力", energyIncluded: "已含基礎電力", energyExcluded: "不含電力費用", network: "網路", networkIncluded: "已含基礎網路", networkExcluded: "不含網路費用", scopeNote: "補充口徑", priceDisclaimer: "最終價格會受期限、數量、並行、網路、電力、稅費與交付條件影響。頁面僅顯示市場參考報價，具體以詢價確認為準。", supplierKicker: "供應商檔案", supplierInfo: "供應與媒合說明", supplierSource: "供應商來源", supplierProfile: "供應方檔案", dataSource: "資料來源：", supplierProvided: "供應商提供的", userProvided: "使用者提供的", quoteDate: "報價單日期：", supplierPending: "供應商提供報價 · 庫存、區域網路與正式卡時價格待確認", leadPending: "報價資料線索 · 需重新媒合與確認", platformSource: "目前供應方檔案為平台初始化樣本，接入後核驗；平台不對外揭露其他供應方的原始報價。", supportedDeals: "支援交易方式", actionsAria: "資源操作", nextStep: "下一步", inquiryTitle: "提交套餐詢價", requestTitle: "提交相關算力需求", inquiryDescription: "核對數量、租用時長與 SSH 公鑰後，平台再確認庫存、區域網路和正式卡時價格。", requestDescription: "此項目僅作資源線索，平台會依你的需求重新媒合供應商。", quoteSamples: "報價樣本", dataStatus: "資料狀態", catalogPending: "目錄資料 · 需重新確認", backBuy: "返回 GPU 套餐繼續比較", backResources: "返回資源市場繼續比較" },
  en: { categories: { gpu: "GPU compute", token_model: "Token / model", rack_capacity: "Rack / capacity", cloud_vendor: "Cloud provider" }, deals: { rental: "Rental", service: "Service purchase", swap: "Resource exchange" }, notFound: "Resource not found", detailSuffix: "Resource details", descriptionSuffix: "Market reference quote; confirm final terms by inquiry.", breadcrumb: "Breadcrumb", quoteSupplier: "Quote-sheet supplier source", initialSupplier: "Platform-initialized supplier profile", resourceId: "Resource ID", marketQuote: "Market reference quote", supplierConfirmation: "Effective after supplier confirmation", referenceRange: "Reference range", sampleCount: "Samples", recordUnit: "records", updatedAt: "Updated", validUntil: "Valid until", noticeAria: "Market quote notice", important: "Important: ", marketConfirm: "Market reference · Confirm by inquiry", profileKicker: "Resource profile", overview: "Resource overview", capacity: "Capacity sample", sla: "Service level SLA", deliveryForm: "Delivery format", deliveryLead: "Estimated lead time", technicalKicker: "Technical specification", specifications: "Specifications", tagsAria: "Resource tags", pricingKicker: "Pricing scope", pricingScope: "Pricing basis", displayUnit: "Platform display unit", cardHourSetUnit: "card-hours / set-hour", tax: "Tax", taxIncluded: "Tax included", taxExcluded: "Tax excluded", energy: "Energy", energyIncluded: "Base energy included", energyExcluded: "Energy excluded", network: "Network", networkIncluded: "Base network included", networkExcluded: "Network excluded", scopeNote: "Additional scope", priceDisclaimer: "Final pricing depends on term, quantity, concurrency, network, energy, tax, and delivery conditions. Values shown are market references; confirm by inquiry.", supplierKicker: "Supplier profile", supplierInfo: "Supply and matching", supplierSource: "Supplier source", supplierProfile: "Supplier profile", dataSource: "Data source: ", supplierProvided: "supplier-provided", userProvided: "user-provided", quoteDate: "Quote date: ", supplierPending: "Supplier quote · Inventory, regional network, and final card-hour quote pending", leadPending: "Quote lead · Requires new matching and confirmation", platformSource: "This supplier profile is an initial platform sample pending onboarding verification. Other suppliers’ original quotes are not disclosed.", supportedDeals: "Supported deal types", actionsAria: "Resource actions", nextStep: "Next step", inquiryTitle: "Submit package inquiry", requestTitle: "Submit related compute request", inquiryDescription: "Confirm quantity, rental duration, and SSH public key. The platform will then verify inventory, regional network, and the final card-hour quote.", requestDescription: "This item is a resource lead only. The platform will rematch suppliers to your requirements.", quoteSamples: "Quote samples", dataStatus: "Data status", catalogPending: "Catalog data · Reconfirmation required", backBuy: "Back to GPU packages", backResources: "Back to resource marketplace" },
  ja: { categories: { gpu: "GPU コンピュート", token_model: "Token / モデル", rack_capacity: "ラック / 容量", cloud_vendor: "クラウド事業者" }, deals: { rental: "レンタル", service: "サービス購入", swap: "リソース交換" }, notFound: "リソースが見つかりません", detailSuffix: "リソース詳細", descriptionSuffix: "市場参考価格です。最終条件は問い合わせで確認してください。", breadcrumb: "パンくず", quoteSupplier: "見積書の供給元", initialSupplier: "プラットフォーム初期供給元情報", resourceId: "リソース ID", marketQuote: "市場参考価格", supplierConfirmation: "供給元の確認後に有効", referenceRange: "参考範囲", sampleCount: "サンプル数", recordUnit: "件", updatedAt: "更新日", validUntil: "有効期限", noticeAria: "市場価格について", important: "重要：", marketConfirm: "市場参考価格 · 問い合わせで確認", profileKicker: "リソース情報", overview: "リソース概要", capacity: "容量サンプル", sla: "サービスレベル SLA", deliveryForm: "納品形態", deliveryLead: "納期目安", technicalKicker: "技術仕様", specifications: "仕様", tagsAria: "リソースタグ", pricingKicker: "価格範囲", pricingScope: "価格基準", displayUnit: "表示単位", cardHourSetUnit: "カード時 / セット時", tax: "税", taxIncluded: "税込", taxExcluded: "税別", energy: "電力", energyIncluded: "基本電力込み", energyExcluded: "電力別", network: "ネットワーク", networkIncluded: "基本ネットワーク込み", networkExcluded: "ネットワーク別", scopeNote: "補足条件", priceDisclaimer: "最終価格は期間、数量、同時実行数、ネットワーク、電力、税、納品条件で変わります。表示値は市場参考価格で、問い合わせ確認が優先されます。", supplierKicker: "供給元情報", supplierInfo: "供給とマッチング", supplierSource: "供給元", supplierProfile: "供給元情報", dataSource: "データ出典：", supplierProvided: "供給元提供の", userProvided: "ユーザー提供の", quoteDate: "見積日：", supplierPending: "供給元見積 · 在庫、地域ネットワーク、最終カード時価格は要確認", leadPending: "見積情報 · 再マッチングと確認が必要", platformSource: "現在の供給元情報は初期サンプルで、接続後に検証します。他社の元見積は公開しません。", supportedDeals: "対応取引", actionsAria: "リソース操作", nextStep: "次の手順", inquiryTitle: "パッケージを問い合わせる", requestTitle: "関連需要を送信", inquiryDescription: "数量、期間、SSH 公開鍵を確認後、在庫、地域ネットワーク、最終カード時価格を確認します。", requestDescription: "この項目はリソース情報のみです。要件に応じて供給元を再マッチングします。", quoteSamples: "見積サンプル", dataStatus: "データ状態", catalogPending: "カタログ情報 · 再確認が必要", backBuy: "GPU パッケージ比較に戻る", backResources: "リソース市場に戻る" },
  ko: { categories: { gpu: "GPU 컴퓨팅", token_model: "Token / 모델", rack_capacity: "랙 / 용량", cloud_vendor: "클라우드 공급자" }, deals: { rental: "대여", service: "서비스 구매", swap: "리소스 교환" }, notFound: "리소스를 찾을 수 없습니다", detailSuffix: "리소스 상세", descriptionSuffix: "시장 참고 견적이며 최종 조건은 문의로 확인합니다.", breadcrumb: "경로 탐색", quoteSupplier: "견적서 공급자 출처", initialSupplier: "플랫폼 초기 공급자 정보", resourceId: "리소스 ID", marketQuote: "시장 참고 견적", supplierConfirmation: "공급자 확인 후 유효", referenceRange: "참고 범위", sampleCount: "샘플 수", recordUnit: "건", updatedAt: "업데이트", validUntil: "유효 기간", noticeAria: "시장 견적 안내", important: "중요: ", marketConfirm: "시장 참고 견적 · 문의 후 확인", profileKicker: "리소스 정보", overview: "리소스 개요", capacity: "용량 샘플", sla: "서비스 수준 SLA", deliveryForm: "제공 형태", deliveryLead: "예상 제공 기간", technicalKicker: "기술 사양", specifications: "사양", tagsAria: "리소스 태그", pricingKicker: "가격 범위", pricingScope: "가격 기준", displayUnit: "플랫폼 표시 단위", cardHourSetUnit: "카드시간 / 세트-시간", tax: "세금", taxIncluded: "세금 포함", taxExcluded: "세금 별도", energy: "전력", energyIncluded: "기본 전력 포함", energyExcluded: "전력 별도", network: "네트워크", networkIncluded: "기본 네트워크 포함", networkExcluded: "네트워크 별도", scopeNote: "추가 기준", priceDisclaimer: "최종 가격은 기간, 수량, 동시성, 네트워크, 전력, 세금 및 제공 조건에 따라 달라집니다. 표시값은 시장 참고 견적이며 문의 확인이 우선합니다.", supplierKicker: "공급자 정보", supplierInfo: "공급 및 매칭", supplierSource: "공급자 출처", supplierProfile: "공급자 정보", dataSource: "데이터 출처: ", supplierProvided: "공급자 제공", userProvided: "사용자 제공", quoteDate: "견적일: ", supplierPending: "공급자 견적 · 재고, 지역 네트워크, 최종 카드시간 견적 확인 필요", leadPending: "견적 정보 · 재매칭 및 확인 필요", platformSource: "현재 공급자 정보는 플랫폼 초기 샘플이며 연동 후 검증합니다. 다른 공급자의 원 견적은 공개하지 않습니다.", supportedDeals: "지원 거래 방식", actionsAria: "리소스 작업", nextStep: "다음 단계", inquiryTitle: "패키지 문의 제출", requestTitle: "관련 컴퓨팅 수요 제출", inquiryDescription: "수량, 대여 기간, SSH 공개 키를 확인한 뒤 재고, 지역 네트워크, 최종 카드시간 견적을 검증합니다.", requestDescription: "이 항목은 리소스 정보일 뿐이며 요구사항에 맞춰 공급자를 다시 매칭합니다.", quoteSamples: "견적 샘플", dataStatus: "데이터 상태", catalogPending: "카탈로그 정보 · 재확인 필요", backBuy: "GPU 패키지 비교로 돌아가기", backResources: "리소스 시장으로 돌아가기" },
  fr: { categories: { gpu: "Calcul GPU", token_model: "Token / modèle", rack_capacity: "Baie / capacité", cloud_vendor: "Fournisseur cloud" }, deals: { rental: "Location", service: "Achat de service", swap: "Échange de ressources" }, notFound: "Ressource introuvable", detailSuffix: "Détails de la ressource", descriptionSuffix: "Prix indicatif du marché ; conditions finales à confirmer sur demande.", breadcrumb: "Fil d’Ariane", quoteSupplier: "Source fournisseur du devis", initialSupplier: "Profil fournisseur initialisé par la plateforme", resourceId: "ID de ressource", marketQuote: "Prix indicatif du marché", supplierConfirmation: "Valable après confirmation du fournisseur", referenceRange: "Fourchette indicative", sampleCount: "Échantillons", recordUnit: "entrées", updatedAt: "Mis à jour", validUntil: "Valable jusqu’au", noticeAria: "Avis de prix", important: "Important : ", marketConfirm: "Prix indicatif · À confirmer sur demande", profileKicker: "Profil de ressource", overview: "Aperçu", capacity: "Échantillon de capacité", sla: "Niveau de service SLA", deliveryForm: "Mode de livraison", deliveryLead: "Délai estimé", technicalKicker: "Spécifications techniques", specifications: "Spécifications", tagsAria: "Étiquettes de ressource", pricingKicker: "Périmètre tarifaire", pricingScope: "Base tarifaire", displayUnit: "Unité affichée", cardHourSetUnit: "heures-carte / heure-ensemble", tax: "Taxe", taxIncluded: "Taxes incluses", taxExcluded: "Taxes exclues", energy: "Énergie", energyIncluded: "Énergie de base incluse", energyExcluded: "Énergie exclue", network: "Réseau", networkIncluded: "Réseau de base inclus", networkExcluded: "Réseau exclu", scopeNote: "Périmètre complémentaire", priceDisclaimer: "Le prix final dépend de la durée, du volume, de la simultanéité, du réseau, de l’énergie, des taxes et de la livraison. Les valeurs sont indicatives et doivent être confirmées.", supplierKicker: "Profil fournisseur", supplierInfo: "Offre et mise en relation", supplierSource: "Source fournisseur", supplierProfile: "Profil fournisseur", dataSource: "Source des données : ", supplierProvided: "fourni par le fournisseur", userProvided: "fourni par l’utilisateur", quoteDate: "Date du devis : ", supplierPending: "Devis fournisseur · Stock, réseau régional et prix final en heures-carte à confirmer", leadPending: "Piste de devis · Nouvelle mise en relation et confirmation requises", platformSource: "Ce profil est un échantillon initial à vérifier lors de l’intégration. Les devis originaux des autres fournisseurs ne sont pas divulgués.", supportedDeals: "Types de transaction", actionsAria: "Actions de ressource", nextStep: "Étape suivante", inquiryTitle: "Demander un devis", requestTitle: "Soumettre un besoin associé", inquiryDescription: "Confirmez quantité, durée et clé publique SSH. La plateforme vérifiera ensuite stock, réseau régional et prix final en heures-carte.", requestDescription: "Cette entrée est uniquement une piste. La plateforme recherchera à nouveau des fournisseurs selon vos besoins.", quoteSamples: "Échantillons de devis", dataStatus: "État des données", catalogPending: "Données catalogue · Reconfirmation requise", backBuy: "Retour aux offres GPU", backResources: "Retour au marché des ressources" },
  th: { categories: { gpu: "พลังประมวลผล GPU", token_model: "Token / โมเดล", rack_capacity: "แร็ก / ความจุ", cloud_vendor: "ผู้ให้บริการคลาวด์" }, deals: { rental: "เช่า", service: "ซื้อบริการ", swap: "แลกเปลี่ยนทรัพยากร" }, notFound: "ไม่พบทรัพยากร", detailSuffix: "รายละเอียดทรัพยากร", descriptionSuffix: "ราคาอ้างอิงตลาด โปรดยืนยันเงื่อนไขจริงผ่านการสอบถาม", breadcrumb: "เส้นทางนำทาง", quoteSupplier: "แหล่งผู้ให้บริการจากใบเสนอราคา", initialSupplier: "ข้อมูลผู้ให้บริการเริ่มต้นของแพลตฟอร์ม", resourceId: "รหัสทรัพยากร", marketQuote: "ราคาอ้างอิงตลาด", supplierConfirmation: "มีผลหลังผู้ให้บริการยืนยัน", referenceRange: "ช่วงอ้างอิง", sampleCount: "จำนวนตัวอย่าง", recordUnit: "รายการ", updatedAt: "อัปเดต", validUntil: "ใช้ได้ถึง", noticeAria: "หมายเหตุราคา", important: "ข้อสำคัญ: ", marketConfirm: "ราคาอ้างอิง · ยืนยันหลังสอบถาม", profileKicker: "ข้อมูลทรัพยากร", overview: "ภาพรวมทรัพยากร", capacity: "ตัวอย่างความจุ", sla: "ระดับบริการ SLA", deliveryForm: "รูปแบบส่งมอบ", deliveryLead: "ระยะเวลาส่งมอบโดยประมาณ", technicalKicker: "ข้อกำหนดทางเทคนิค", specifications: "ข้อมูลจำเพาะ", tagsAria: "แท็กทรัพยากร", pricingKicker: "ขอบเขตราคา", pricingScope: "เกณฑ์ราคา", displayUnit: "หน่วยแสดงผล", cardHourSetUnit: "ชั่วโมงการ์ด / ชุด-ชั่วโมง", tax: "ภาษี", taxIncluded: "รวมภาษี", taxExcluded: "ไม่รวมภาษี", energy: "ไฟฟ้า", energyIncluded: "รวมไฟฟ้าพื้นฐาน", energyExcluded: "ไม่รวมไฟฟ้า", network: "เครือข่าย", networkIncluded: "รวมเครือข่ายพื้นฐาน", networkExcluded: "ไม่รวมเครือข่าย", scopeNote: "ขอบเขตเพิ่มเติม", priceDisclaimer: "ราคาจริงขึ้นกับระยะเวลา จำนวน การใช้งานพร้อมกัน เครือข่าย ไฟฟ้า ภาษี และการส่งมอบ ราคาบนหน้าเป็นเพียงราคาอ้างอิงและต้องยืนยันอีกครั้ง", supplierKicker: "ข้อมูลผู้ให้บริการ", supplierInfo: "การจัดหาและจับคู่", supplierSource: "แหล่งผู้ให้บริการ", supplierProfile: "ข้อมูลผู้ให้บริการ", dataSource: "แหล่งข้อมูล: ", supplierProvided: "จากผู้ให้บริการ", userProvided: "จากผู้ใช้", quoteDate: "วันที่ใบเสนอราคา: ", supplierPending: "ราคาจากผู้ให้บริการ · รอยืนยันสต็อก เครือข่ายภูมิภาค และราคาชั่วโมงการ์ดจริง", leadPending: "ข้อมูลราคา · ต้องจับคู่และยืนยันใหม่", platformSource: "ข้อมูลผู้ให้บริการนี้เป็นตัวอย่างเริ่มต้นและจะตรวจสอบหลังเชื่อมต่อ แพลตฟอร์มไม่เปิดเผยใบเสนอราคาต้นฉบับของรายอื่น", supportedDeals: "รูปแบบธุรกรรมที่รองรับ", actionsAria: "การทำงานกับทรัพยากร", nextStep: "ขั้นตอนถัดไป", inquiryTitle: "ส่งคำขอราคาแพ็กเกจ", requestTitle: "ส่งความต้องการที่เกี่ยวข้อง", inquiryDescription: "ยืนยันจำนวน ระยะเวลาเช่า และคีย์สาธารณะ SSH จากนั้นแพลตฟอร์มจะตรวจสอบสต็อก เครือข่าย และราคาชั่วโมงการ์ดจริง", requestDescription: "รายการนี้เป็นเพียงข้อมูลอ้างอิง แพลตฟอร์มจะจับคู่ผู้ให้บริการใหม่ตามความต้องการ", quoteSamples: "ตัวอย่างราคา", dataStatus: "สถานะข้อมูล", catalogPending: "ข้อมูลแค็ตตาล็อก · ต้องยืนยันใหม่", backBuy: "กลับไปเปรียบเทียบแพ็กเกจ GPU", backResources: "กลับไปตลาดทรัพยากร" },
  vi: { categories: { gpu: "Năng lực GPU", token_model: "Token / mô hình", rack_capacity: "Tủ rack / dung lượng", cloud_vendor: "Nhà cung cấp đám mây" }, deals: { rental: "Cho thuê", service: "Mua dịch vụ", swap: "Hoán đổi tài nguyên" }, notFound: "Không tìm thấy tài nguyên", detailSuffix: "Chi tiết tài nguyên", descriptionSuffix: "Giá tham khảo thị trường; điều kiện cuối cùng được xác nhận khi hỏi giá.", breadcrumb: "Điều hướng phân cấp", quoteSupplier: "Nguồn nhà cung cấp từ báo giá", initialSupplier: "Hồ sơ nhà cung cấp khởi tạo bởi nền tảng", resourceId: "ID tài nguyên", marketQuote: "Giá tham khảo thị trường", supplierConfirmation: "Có hiệu lực sau khi nhà cung cấp xác nhận", referenceRange: "Khoảng tham khảo", sampleCount: "Số mẫu", recordUnit: "mục", updatedAt: "Cập nhật", validUntil: "Hiệu lực đến", noticeAria: "Lưu ý báo giá", important: "Quan trọng: ", marketConfirm: "Giá tham khảo · Xác nhận khi hỏi giá", profileKicker: "Hồ sơ tài nguyên", overview: "Tổng quan tài nguyên", capacity: "Mẫu dung lượng", sla: "Cấp dịch vụ SLA", deliveryForm: "Hình thức bàn giao", deliveryLead: "Thời gian dự kiến", technicalKicker: "Thông số kỹ thuật", specifications: "Thông số", tagsAria: "Thẻ tài nguyên", pricingKicker: "Phạm vi giá", pricingScope: "Cơ sở định giá", displayUnit: "Đơn vị hiển thị", cardHourSetUnit: "giờ-thẻ / bộ-giờ", tax: "Thuế", taxIncluded: "Đã gồm thuế", taxExcluded: "Chưa gồm thuế", energy: "Điện", energyIncluded: "Đã gồm điện cơ bản", energyExcluded: "Chưa gồm điện", network: "Mạng", networkIncluded: "Đã gồm mạng cơ bản", networkExcluded: "Chưa gồm mạng", scopeNote: "Phạm vi bổ sung", priceDisclaimer: "Giá cuối cùng phụ thuộc thời hạn, số lượng, đồng thời, mạng, điện, thuế và điều kiện bàn giao. Giá hiển thị chỉ để tham khảo và phải được xác nhận.", supplierKicker: "Hồ sơ nhà cung cấp", supplierInfo: "Nguồn cung và kết nối", supplierSource: "Nguồn nhà cung cấp", supplierProfile: "Hồ sơ nhà cung cấp", dataSource: "Nguồn dữ liệu: ", supplierProvided: "do nhà cung cấp cung cấp", userProvided: "do người dùng cung cấp", quoteDate: "Ngày báo giá: ", supplierPending: "Báo giá nhà cung cấp · Chờ xác nhận tồn kho, mạng khu vực và giá giờ-thẻ cuối cùng", leadPending: "Đầu mối báo giá · Cần ghép nối và xác nhận lại", platformSource: "Hồ sơ này là mẫu khởi tạo, sẽ xác minh khi tích hợp. Nền tảng không công bố báo giá gốc của nhà cung cấp khác.", supportedDeals: "Loại giao dịch hỗ trợ", actionsAria: "Thao tác tài nguyên", nextStep: "Bước tiếp theo", inquiryTitle: "Gửi yêu cầu giá gói", requestTitle: "Gửi nhu cầu liên quan", inquiryDescription: "Xác nhận số lượng, thời gian thuê và khóa công khai SSH; nền tảng sẽ kiểm tra tồn kho, mạng khu vực và giá giờ-thẻ cuối cùng.", requestDescription: "Mục này chỉ là đầu mối tài nguyên. Nền tảng sẽ ghép lại nhà cung cấp theo nhu cầu.", quoteSamples: "Mẫu báo giá", dataStatus: "Trạng thái dữ liệu", catalogPending: "Dữ liệu danh mục · Cần xác nhận lại", backBuy: "Quay lại các gói GPU", backResources: "Quay lại chợ tài nguyên" },
  id: { categories: { gpu: "Komputasi GPU", token_model: "Token / model", rack_capacity: "Rak / kapasitas", cloud_vendor: "Penyedia cloud" }, deals: { rental: "Sewa", service: "Pembelian layanan", swap: "Pertukaran sumber daya" }, notFound: "Sumber daya tidak ditemukan", detailSuffix: "Detail sumber daya", descriptionSuffix: "Penawaran referensi pasar; konfirmasikan ketentuan akhir melalui permintaan.", breadcrumb: "Jejak navigasi", quoteSupplier: "Sumber pemasok dari lembar penawaran", initialSupplier: "Profil pemasok awal platform", resourceId: "ID sumber daya", marketQuote: "Penawaran referensi pasar", supplierConfirmation: "Berlaku setelah konfirmasi pemasok", referenceRange: "Kisaran referensi", sampleCount: "Jumlah sampel", recordUnit: "entri", updatedAt: "Diperbarui", validUntil: "Berlaku hingga", noticeAria: "Catatan penawaran pasar", important: "Penting: ", marketConfirm: "Referensi pasar · Konfirmasi melalui permintaan", profileKicker: "Profil sumber daya", overview: "Ringkasan sumber daya", capacity: "Sampel kapasitas", sla: "Tingkat layanan SLA", deliveryForm: "Bentuk pengiriman", deliveryLead: "Estimasi waktu pengiriman", technicalKicker: "Spesifikasi teknis", specifications: "Spesifikasi", tagsAria: "Tag sumber daya", pricingKicker: "Cakupan harga", pricingScope: "Dasar harga", displayUnit: "Unit tampilan platform", cardHourSetUnit: "jam-kartu / set-jam", tax: "Pajak", taxIncluded: "Pajak termasuk", taxExcluded: "Pajak belum termasuk", energy: "Energi", energyIncluded: "Energi dasar termasuk", energyExcluded: "Energi belum termasuk", network: "Jaringan", networkIncluded: "Jaringan dasar termasuk", networkExcluded: "Jaringan belum termasuk", scopeNote: "Cakupan tambahan", priceDisclaimer: "Harga akhir bergantung pada jangka waktu, jumlah, konkurensi, jaringan, energi, pajak, dan pengiriman. Nilai yang ditampilkan adalah referensi dan harus dikonfirmasi.", supplierKicker: "Profil pemasok", supplierInfo: "Pasokan dan pencocokan", supplierSource: "Sumber pemasok", supplierProfile: "Profil pemasok", dataSource: "Sumber data: ", supplierProvided: "disediakan pemasok", userProvided: "disediakan pengguna", quoteDate: "Tanggal penawaran: ", supplierPending: "Penawaran pemasok · Stok, jaringan regional, dan harga akhir jam-kartu belum dikonfirmasi", leadPending: "Prospek penawaran · Perlu pencocokan dan konfirmasi ulang", platformSource: "Profil ini adalah sampel awal platform yang akan diverifikasi saat onboarding. Penawaran asli pemasok lain tidak diungkap.", supportedDeals: "Jenis transaksi didukung", actionsAria: "Tindakan sumber daya", nextStep: "Langkah berikutnya", inquiryTitle: "Ajukan penawaran paket", requestTitle: "Ajukan kebutuhan terkait", inquiryDescription: "Konfirmasi jumlah, durasi sewa, dan kunci publik SSH. Platform kemudian memverifikasi stok, jaringan regional, dan harga akhir jam-kartu.", requestDescription: "Item ini hanya prospek sumber daya. Platform akan mencocokkan ulang pemasok sesuai kebutuhan Anda.", quoteSamples: "Sampel penawaran", dataStatus: "Status data", catalogPending: "Data katalog · Perlu konfirmasi ulang", backBuy: "Kembali ke paket GPU", backResources: "Kembali ke pasar sumber daya" },
  ms: { categories: { gpu: "Pengkomputeran GPU", token_model: "Token / model", rack_capacity: "Rak / kapasiti", cloud_vendor: "Penyedia awan" }, deals: { rental: "Sewa", service: "Pembelian perkhidmatan", swap: "Pertukaran sumber" }, notFound: "Sumber tidak ditemui", detailSuffix: "Butiran sumber", descriptionSuffix: "Sebut harga rujukan pasaran; sahkan syarat akhir melalui pertanyaan.", breadcrumb: "Jejak navigasi", quoteSupplier: "Sumber pembekal daripada helaian sebut harga", initialSupplier: "Profil pembekal awal platform", resourceId: "ID sumber", marketQuote: "Sebut harga rujukan pasaran", supplierConfirmation: "Berkuat kuasa selepas pengesahan pembekal", referenceRange: "Julat rujukan", sampleCount: "Bilangan sampel", recordUnit: "rekod", updatedAt: "Dikemas kini", validUntil: "Sah hingga", noticeAria: "Notis sebut harga", important: "Penting: ", marketConfirm: "Rujukan pasaran · Sahkan melalui pertanyaan", profileKicker: "Profil sumber", overview: "Gambaran sumber", capacity: "Sampel kapasiti", sla: "Tahap perkhidmatan SLA", deliveryForm: "Bentuk penghantaran", deliveryLead: "Anggaran tempoh penghantaran", technicalKicker: "Spesifikasi teknikal", specifications: "Spesifikasi", tagsAria: "Tag sumber", pricingKicker: "Skop harga", pricingScope: "Asas harga", displayUnit: "Unit paparan platform", cardHourSetUnit: "jam-kad / set-jam", tax: "Cukai", taxIncluded: "Cukai termasuk", taxExcluded: "Cukai tidak termasuk", energy: "Tenaga", energyIncluded: "Tenaga asas termasuk", energyExcluded: "Tenaga tidak termasuk", network: "Rangkaian", networkIncluded: "Rangkaian asas termasuk", networkExcluded: "Rangkaian tidak termasuk", scopeNote: "Skop tambahan", priceDisclaimer: "Harga akhir bergantung pada tempoh, kuantiti, keserentakan, rangkaian, tenaga, cukai dan penghantaran. Nilai dipaparkan ialah rujukan dan perlu disahkan.", supplierKicker: "Profil pembekal", supplierInfo: "Bekalan dan padanan", supplierSource: "Sumber pembekal", supplierProfile: "Profil pembekal", dataSource: "Sumber data: ", supplierProvided: "disediakan pembekal", userProvided: "disediakan pengguna", quoteDate: "Tarikh sebut harga: ", supplierPending: "Sebut harga pembekal · Stok, rangkaian wilayah dan harga akhir jam-kad belum disahkan", leadPending: "Petunjuk sebut harga · Perlu padanan dan pengesahan semula", platformSource: "Profil ini ialah sampel awal platform yang akan disahkan semasa penyambungan. Sebut harga asal pembekal lain tidak didedahkan.", supportedDeals: "Jenis transaksi disokong", actionsAria: "Tindakan sumber", nextStep: "Langkah seterusnya", inquiryTitle: "Hantar pertanyaan pakej", requestTitle: "Hantar keperluan berkaitan", inquiryDescription: "Sahkan kuantiti, tempoh sewa dan kunci awam SSH. Platform kemudian mengesahkan stok, rangkaian wilayah dan harga akhir jam-kad.", requestDescription: "Item ini hanya petunjuk sumber. Platform akan memadankan semula pembekal mengikut keperluan anda.", quoteSamples: "Sampel sebut harga", dataStatus: "Status data", catalogPending: "Data katalog · Perlu pengesahan semula", backBuy: "Kembali ke pakej GPU", backResources: "Kembali ke pasaran sumber" },
} satisfies Record<Locale, ResourceDetailCopy>;

type ResourceDetailPageProps = {
  params: Promise<{ id: string }>;
};

export function generateStaticParams() {
  return resourceListings.map((resource) => ({ id: resource.id }));
}

export async function generateMetadata({ params }: ResourceDetailPageProps): Promise<Metadata> {
  const locale = await getRequestLocale();
  const copy = RESOURCE_DETAIL_COPY[locale];
  const { id } = await params;
  const resource = getResourceById(id);
  if (!resource) return { title: copy.notFound };
  return {
    title: `${resource.title} · ${copy.detailSuffix}`,
    description: `${resource.summary} ${copy.descriptionSuffix}`,
  };
}

function yesNo(value: boolean, yes: string, no: string) {
  return value ? yes : no;
}

export default async function ResourceDetailPage({ params }: ResourceDetailPageProps) {
  const locale = await getRequestLocale();
  const copy = RESOURCE_DETAIL_COPY[locale];
  const { id } = await params;
  const resource = getResourceById(id);
  if (!resource) notFound();

  const requestParams = new URLSearchParams({
    listing: resource.id,
    category: resource.category,
    deal: resource.dealModes[0],
    unit: resource.pricingUnit,
  });
  const requestHref = `/request?${requestParams.toString()}`;
  const buyClassification = classifyBuyCatalogListing(resource, suppliers);
  const primaryInquiry = buyClassification === "PRIMARY_INQUIRY";
  const inquiryEnabled = primaryInquiry && isBuyCatalogV2Enabled() && manualDeliveryIntakeEnabled();
  const packageRate = primaryInquiry ? `${formatCardHourValue(resource.quote.median / 1.002)} ${copy.cardHourSetUnit}` : formatCardHourQuote(resource.quote.median, resource.pricingUnit);

  return (
    <div>
      <div className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="shell py-4">
          <nav className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]" aria-label={copy.breadcrumb}>
            <Link className="underline decoration-[var(--border-strong)] underline-offset-4 hover:text-[var(--accent)]" href="/resources">{copy.backResources.replace(/^←\s*/u, "")}</Link>
            <span aria-hidden="true">/</span>
            <span>{copy.categories[resource.category]}</span>
            <span aria-hidden="true">/</span>
            <span className="text-[var(--ink)]" aria-current="page">{resource.title}</span>
          </nav>
        </div>
      </div>

      <section className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="shell grid gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-end lg:py-16">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className="border border-[var(--border-strong)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)]">{copy.categories[resource.category]}</span>
              {resource.dealModes.map((mode) => (
                <span key={mode} className="border border-[var(--border)] bg-[var(--info-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--text)]">{copy.deals[mode]}</span>
              ))}
            </div>
            <h1 className="mt-5 mb-0 max-w-4xl text-4xl leading-[1.08] text-[var(--ink)] sm:text-5xl">{resource.title}</h1>
            <p className="mt-5 mb-0 max-w-3xl text-lg leading-8 text-[var(--text)]">{resource.summary}</p>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--muted)]">
              <span><strong className="text-[var(--ink)]">{resource.supplierName}</strong> · {resource.source ? copy.quoteSupplier : copy.initialSupplier}</span>
              <span>{resource.region}</span>
              <span>{copy.resourceId} {resource.id}</span>
            </div>
          </div>

          <div className="border-t-2 border-[var(--accent)] bg-[var(--info-bg)] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="m-0 text-xs font-semibold tracking-wide text-[var(--muted)]">{copy.marketQuote}</p>
                <p className="mt-2 mb-0 text-3xl font-semibold tabular-nums text-[var(--ink)]">
                  {packageRate}
                </p>
              </div>
              <span className="border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-xs font-semibold text-[var(--warning)]">{copy.supplierConfirmation}</span>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-5 border-t border-[var(--border)] pt-5">
              <div>
                <dt className="text-xs text-[var(--muted)]">{copy.referenceRange}</dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums text-[var(--ink)]">
                  {primaryInquiry ? `${formatCardHourValue(resource.quote.rangeMin / 1.002)}–${formatCardHourValue(resource.quote.rangeMax / 1.002)} ${copy.cardHourSetUnit}` : `${formatCardHourQuote(resource.quote.rangeMin, resource.pricingUnit)} – ${formatCardHourQuote(resource.quote.rangeMax, resource.pricingUnit)}`}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">{copy.sampleCount}</dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums text-[var(--ink)]">{resource.quote.sampleCount} {copy.recordUnit}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">{copy.updatedAt}</dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--ink)]">{resource.quote.updatedAt}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">{copy.validUntil}</dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--ink)]">{resource.quote.validUntil}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <div className="shell py-10 sm:py-12">
        <aside className="market-notice mb-10" aria-label={copy.noticeAria}>
          <p className="m-0">
            <strong>{copy.important}</strong>{resource.quote.disclaimer} {resource.source ? resource.source.notice : copy.platformSource}
          </p>
          <p className="m-0 whitespace-nowrap font-semibold text-[var(--warning)]">{copy.marketConfirm}</p>
        </aside>

        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-12">
            <section aria-labelledby="resource-overview-title">
              <div className="mb-5 border-b border-[var(--border-strong)] pb-3">
                <p className="kicker">{copy.profileKicker}</p>
                <h2 id="resource-overview-title" className="m-0 text-2xl text-[var(--ink)]">{copy.overview}</h2>
              </div>
              <dl className="grid border-t-2 border-[var(--accent)] sm:grid-cols-2">
                {[
                  [copy.capacity, resource.capacity],
                  [copy.sla, resource.sla],
                  [copy.deliveryForm, resource.deliveryForm],
                  [copy.deliveryLead, resource.deliveryLeadTime],
                ].map(([label, value], index) => (
                  <div key={label} className={`border-b border-[var(--border)] bg-[var(--surface)] p-5 ${index % 2 === 0 ? "sm:border-r" : ""}`}>
                    <dt className="text-xs font-semibold text-[var(--muted)]">{label}</dt>
                    <dd className="mt-2 text-lg font-semibold text-[var(--ink)]">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section aria-labelledby="resource-specs-title">
              <div className="mb-5 border-b border-[var(--border-strong)] pb-3">
                <p className="kicker">{copy.technicalKicker}</p>
                <h2 id="resource-specs-title" className="m-0 text-2xl text-[var(--ink)]">{copy.specifications}</h2>
              </div>
              <div className="overflow-hidden border border-[var(--border)]">
                <table className="data-table">
                  <tbody>
                    {Object.entries(resource.specs).map(([label, value]) => (
                      <tr key={label}>
                        <th className="w-1/3 min-w-36 text-[var(--muted)]" scope="row">{label}</th>
                        <td className="font-semibold text-[var(--ink)]">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-5 flex flex-wrap gap-2" aria-label={copy.tagsAria}>
                {resource.tags.map((tag) => (
                  <span key={tag} className="border border-[var(--border)] bg-[var(--info-bg)] px-2.5 py-1 text-xs font-medium text-[var(--text)]">{tag}</span>
                ))}
              </div>
            </section>

            <section aria-labelledby="pricing-scope-title">
              <div className="mb-5 border-b border-[var(--border-strong)] pb-3">
                <p className="kicker">{copy.pricingKicker}</p>
                <h2 id="pricing-scope-title" className="m-0 text-2xl text-[var(--ink)]">{copy.pricingScope}</h2>
              </div>
              <div className="border-t-2 border-[var(--accent)] bg-[var(--surface)]">
                <dl className="grid sm:grid-cols-2">
                  <div className="border-b border-[var(--border)] p-5 sm:border-r"><dt className="text-xs text-[var(--muted)]">{copy.displayUnit}</dt><dd className="mt-2 font-semibold text-[var(--ink)]">{primaryInquiry ? copy.cardHourSetUnit : `KAI / ${resource.pricingUnit}`}</dd></div>
                  <div className="border-b border-[var(--border)] p-5"><dt className="text-xs text-[var(--muted)]">{copy.tax}</dt><dd className="mt-2 font-semibold text-[var(--ink)]">{yesNo(resource.quote.taxIncluded, copy.taxIncluded, copy.taxExcluded)}</dd></div>
                  <div className="border-b border-[var(--border)] p-5 sm:border-r"><dt className="text-xs text-[var(--muted)]">{copy.energy}</dt><dd className="mt-2 font-semibold text-[var(--ink)]">{yesNo(resource.quote.energyIncluded, copy.energyIncluded, copy.energyExcluded)}</dd></div>
                  <div className="border-b border-[var(--border)] p-5"><dt className="text-xs text-[var(--muted)]">{copy.network}</dt><dd className="mt-2 font-semibold text-[var(--ink)]">{yesNo(resource.quote.networkIncluded, copy.networkIncluded, copy.networkExcluded)}</dd></div>
                </dl>
                <div className="border-b border-[var(--border)] bg-[var(--info-bg)] p-5">
                  <p className="m-0 text-xs font-semibold text-[var(--muted)]">{copy.scopeNote}</p>
                  <p className="mt-2 mb-0 text-sm leading-6 text-[var(--text)]">{resource.quote.scopeNote}</p>
                </div>
              </div>
              <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
                {copy.priceDisclaimer}
              </p>
            </section>

            <section aria-labelledby="supplier-title">
              <div className="mb-5 border-b border-[var(--border-strong)] pb-3">
                <p className="kicker">{copy.supplierKicker}</p>
                <h2 id="supplier-title" className="m-0 text-2xl text-[var(--ink)]">{copy.supplierInfo}</h2>
              </div>
              <div className="grid gap-6 border border-[var(--border)] bg-[var(--surface)] p-5 sm:grid-cols-2 sm:p-6">
                <div>
                  <p className="m-0 text-xs font-semibold text-[var(--muted)]">{resource.source ? copy.supplierSource : copy.supplierProfile}</p>
                  <p className="mt-2 mb-0 text-lg font-semibold text-[var(--ink)]">{resource.supplierName}</p>
                  {resource.source ? (
                    <div className="mt-2 space-y-1 text-sm leading-6 text-[var(--text)]">
                      <p className="m-0">{copy.dataSource}{primaryInquiry ? copy.supplierProvided : copy.userProvided}《{resource.source.documentTitle}》</p>
                      <p className="m-0">{copy.quoteDate}{resource.source.observedAt}</p>
                      <p className="m-0 font-semibold text-[var(--warning)]">{primaryInquiry ? copy.supplierPending : copy.leadPending}</p>
                    </div>
                  ) : (
                    <p className="mt-2 mb-0 text-sm leading-6 text-[var(--text)]">{copy.platformSource}</p>
                  )}
                </div>
                <div>
                  <p className="m-0 text-xs font-semibold text-[var(--muted)]">{copy.supportedDeals}</p>
                  <ul className="mt-2 mb-0 list-none space-y-2 p-0 text-sm text-[var(--ink)]">
                    {resource.dealModes.map((mode) => <li key={mode}>— {copy.deals[mode]}</li>)}
                  </ul>
                </div>
              </div>
            </section>
          </div>

          <aside className="border border-[var(--border)] bg-[var(--surface)] lg:sticky lg:top-28" aria-label={copy.actionsAria}>
            <div className="border-b border-[var(--border)] p-5">
              <p className="m-0 text-xs font-semibold tracking-wide text-[var(--muted)]">{copy.nextStep}</p>
              <h2 className="mt-2 mb-0 text-xl text-[var(--ink)]">{primaryInquiry ? copy.inquiryTitle : copy.requestTitle}</h2>
              <p className="mt-2 mb-0 text-sm leading-6 text-[var(--text)]">{primaryInquiry ? copy.inquiryDescription : copy.requestDescription}</p>
            </div>
            <div className="p-5">
              <ResourceDetailActions inquiryHref={inquiryEnabled ? `/checkout/${encodeURIComponent(resource.id)}` : undefined} inquiryUnavailable={primaryInquiry && !inquiryEnabled} resourceId={resource.id} resourceTitle={resource.title} requestHref={requestHref} />
            </div>
            <dl className="grid grid-cols-2 border-t border-[var(--border)] bg-[var(--info-bg)] text-xs">
              <div className="border-r border-[var(--border)] p-4"><dt className="text-[var(--muted)]">{copy.quoteSamples}</dt><dd className="mt-1 font-semibold text-[var(--ink)]">{resource.quote.sampleCount} {copy.recordUnit}</dd></div>
              <div className="p-4"><dt className="text-[var(--muted)]">{copy.dataStatus}</dt><dd className="mt-1 font-semibold text-[var(--accent)]">{primaryInquiry ? copy.supplierPending : buyClassification === "REFERENCE_LEAD" ? copy.leadPending : copy.catalogPending}</dd></div>
            </dl>
          </aside>
        </div>

        <div className="mt-14 border-t border-[var(--border)] pt-5">
          <Link className="text-sm font-semibold text-[var(--accent)] underline underline-offset-4" href={primaryInquiry ? "/buy" : "/resources"}>← {primaryInquiry ? copy.backBuy : copy.backResources}</Link>
        </div>
      </div>
    </div>
  );
}
