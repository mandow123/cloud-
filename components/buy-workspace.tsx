"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { formatCardHourDisplayMicros, formatCardHourValue } from "@/lib/card-hours";
import type { HostingReadinessEnvelope, PublicHostingOffer, PublicHostingReadiness } from "@/lib/hosting-v2-client";
import { formatHostingTime } from "@/lib/hosting-v2-client";
import type { Locale } from "@/lib/i18n";
import type { ResourceListing } from "@/lib/types";
import styles from "./buy-workspace.module.css";

type OfferPayload = Readonly<{ records: PublicHostingOffer[] }>;
type BuyCopy = Readonly<{
  factFallback: string;
  live: Readonly<{ error: string; loading: string; eyebrow: string; title: string; itemUnit: string; availableTime: string; cardHoursPerGpuHour: string; details: string }>;
  hero: Readonly<{ eyebrow: string; title: string; description: string; quickNavLabel: string; myRequests: string; myAssets: string; submitDemand: string; sparkCampaign: string }>;
  mode: Readonly<{ label: string; rent: string; managed: string }>;
  catalog: Readonly<{ eyebrow: string; title: string; packageUnit: string; intro: string; filterLabel: string; search: string; searchPlaceholder: string; gpuModel: string; allModels: string; gpuCount: string; allGpuCounts: string; gpuCountUnit: string; sort: string; lowToHigh: string; highToLow: string; empty: string }>;
  card: Readonly<{ supplierQuote: string; manualDelivery: string; gpuPackage: string; memory: string; storage: string; serviceArea: string; regionNetwork: string; deliveryMethod: string; quoteReference: string; cardHourUnit: string; perPackagePerHour: string; gpuUnit: string; viewDetails: string; loginForQuote: string; maintenance: string }>;
  leads: Readonly<{ title: string; countSuffix: string; expand: string; notice: string; submit: string }>;
}>;

const BUY_COPY = {
  "zh-CN": {
    factFallback: "询价时确认",
    live: { error: "实时库存暂时无法读取，供应商询价套餐仍可正常浏览。", loading: "正在读取平台实时库存…", eyebrow: "平台库存", title: "平台实时库存", itemUnit: "项", availableTime: "可用时间", cardHoursPerGpuHour: "卡时 / GPU 小时", details: "查看库存详情" },
    hero: { eyebrow: "GPU 算力目录", title: "选购 GPU 算力", description: "先看清 GPU 套餐、供应商、规格与卡时参考价，再提交询价。平台确认库存和网络条件后安排人工交付。", quickNavLabel: "购买算力快捷入口", myRequests: "我的算力申请", myAssets: "我的资产", submitDemand: "没有合适套餐？提交需求", sparkCampaign: "DGX Spark 专项" },
    mode: { label: "GPU 服务类型", rent: "租用 GPU", managed: "GPU 云托管" },
    catalog: { eyebrow: "供应商 GPU 套餐", title: "供应商 GPU 套餐", packageUnit: "个套餐", intro: "以下为供应商提供的报价套餐。页面价格用于询价参考；提交后不会锁定库存、不会付款，也不代表成交。", filterLabel: "筛选 GPU 套餐", search: "搜索套餐", searchPlaceholder: "搜索 A100、H100、H200、B200…", gpuModel: "GPU 型号", allModels: "全部型号", gpuCount: "每套 GPU 数", allGpuCounts: "全部卡数", gpuCountUnit: "张", sort: "价格排序", lowToHigh: "卡时从低到高", highToLow: "卡时从高到低", empty: "没有符合当前筛选的套餐，请更换型号或搜索词。" },
    card: { supplierQuote: "供应商报价", manualDelivery: "人工交付", gpuPackage: "GPU 套餐", memory: "内存", storage: "存储", serviceArea: "服务范围", regionNetwork: "地域与网络", deliveryMethod: "交付方式", quoteReference: "询价参考", cardHourUnit: "卡时", perPackagePerHour: "每套 · 每小时", gpuUnit: "张 GPU", viewDetails: "查看详情", loginForQuote: "登录询价", maintenance: "人工询价维护中" },
    leads: { title: "更多供应商资源线索", countSuffix: "家报价线索，可用于提交定制需求", expand: "展开查看 ＋", notice: "这些条目来自供应商报价资料，仅作需求线索，不代表当前库存或可购买套餐。如有兴趣，请提交算力需求，由平台重新确认。", submit: "提交相关需求" },
  },
  "zh-TW": {
    factFallback: "詢價時確認",
    live: { error: "暫時無法讀取即時庫存，仍可正常瀏覽供應商詢價套餐。", loading: "正在讀取平台即時庫存…", eyebrow: "平台庫存", title: "平台即時庫存", itemUnit: "項", availableTime: "可用時間", cardHoursPerGpuHour: "卡時 / GPU 小時", details: "查看庫存詳情" },
    hero: { eyebrow: "GPU 算力目錄", title: "選購 GPU 算力", description: "先查看 GPU 套餐、供應商、規格與卡時參考價，再提交詢價。平台確認庫存與網路條件後安排人工交付。", quickNavLabel: "購買算力快捷入口", myRequests: "我的算力申請", myAssets: "我的資產", submitDemand: "沒有合適套餐？提交需求", sparkCampaign: "DGX Spark 專項" },
    mode: { label: "GPU 服務類型", rent: "租用 GPU", managed: "GPU 雲端託管" },
    catalog: { eyebrow: "供應商 GPU 套餐", title: "供應商 GPU 套餐", packageUnit: "個套餐", intro: "以下為供應商提供的報價套餐。頁面價格僅供詢價參考；提交後不會鎖定庫存、不會付款，也不代表成交。", filterLabel: "篩選 GPU 套餐", search: "搜尋套餐", searchPlaceholder: "搜尋 A100、H100、H200、B200…", gpuModel: "GPU 型號", allModels: "全部型號", gpuCount: "每套 GPU 數", allGpuCounts: "全部卡數", gpuCountUnit: "張", sort: "價格排序", lowToHigh: "卡時由低至高", highToLow: "卡時由高至低", empty: "沒有符合目前篩選的套餐，請更換型號或搜尋詞。" },
    card: { supplierQuote: "供應商報價", manualDelivery: "人工交付", gpuPackage: "GPU 套餐", memory: "記憶體", storage: "儲存空間", serviceArea: "服務範圍", regionNetwork: "地區與網路", deliveryMethod: "交付方式", quoteReference: "詢價參考", cardHourUnit: "卡時", perPackagePerHour: "每套 · 每小時", gpuUnit: "張 GPU", viewDetails: "查看詳情", loginForQuote: "登入詢價", maintenance: "人工詢價維護中" },
    leads: { title: "更多供應商資源線索", countSuffix: "家報價線索，可用於提交客製需求", expand: "展開查看 ＋", notice: "這些條目來自供應商報價資料，僅作需求線索，不代表目前庫存或可購買套餐。如有興趣，請提交算力需求，由平台重新確認。", submit: "提交相關需求" },
  },
  en: {
    factFallback: "Confirm when requesting a quote",
    live: { error: "Live inventory is temporarily unavailable. Supplier quote packages remain available to browse.", loading: "Loading live platform inventory…", eyebrow: "PLATFORM INVENTORY", title: "Live platform inventory", itemUnit: "items", availableTime: "Available from", cardHoursPerGpuHour: "Card-hours / GPU hour", details: "View inventory details" },
    hero: { eyebrow: "GPU COMPUTE CATALOG", title: "Buy GPU compute", description: "Review GPU packages, suppliers, specifications and reference card-hour prices before requesting a quote. The platform arranges manual delivery after confirming inventory and network conditions.", quickNavLabel: "Quick links for buying compute", myRequests: "My compute requests", myAssets: "My assets", submitDemand: "No suitable package? Submit a request", sparkCampaign: "DGX Spark campaign" },
    mode: { label: "GPU service type", rent: "Rent GPU", managed: "Managed GPU cloud" },
    catalog: { eyebrow: "SUPPLIER GPU PACKAGES", title: "Supplier GPU packages", packageUnit: "packages", intro: "These quote packages are provided by suppliers. Displayed prices are references for inquiries; submission does not reserve inventory, take payment or constitute a transaction.", filterLabel: "Filter GPU packages", search: "Search packages", searchPlaceholder: "Search A100, H100, H200, B200…", gpuModel: "GPU model", allModels: "All models", gpuCount: "GPUs per package", allGpuCounts: "All GPU counts", gpuCountUnit: "GPU", sort: "Sort by price", lowToHigh: "Card-hours: low to high", highToLow: "Card-hours: high to low", empty: "No packages match the current filters. Try another model or search term." },
    card: { supplierQuote: "Supplier quote", manualDelivery: "Manual delivery", gpuPackage: "GPU package", memory: "Memory", storage: "Storage", serviceArea: "Service area", regionNetwork: "Region and network", deliveryMethod: "Delivery method", quoteReference: "Quote reference", cardHourUnit: "card-hours", perPackagePerHour: "per package · per hour", gpuUnit: "GPU", viewDetails: "View details", loginForQuote: "Sign in for a quote", maintenance: "Manual quoting under maintenance" },
    leads: { title: "More supplier resource leads", countSuffix: "quote leads available for custom requests", expand: "Expand ＋", notice: "These entries come from supplier quotation materials and are demand leads only. They do not represent current inventory or purchasable packages. Submit a compute request for the platform to reconfirm availability.", submit: "Submit related request" },
  },
  ja: {
    factFallback: "見積依頼時に確認",
    live: { error: "リアルタイム在庫を一時的に取得できません。サプライヤーの見積パッケージは引き続き閲覧できます。", loading: "プラットフォームのリアルタイム在庫を読み込み中…", eyebrow: "プラットフォーム在庫", title: "リアルタイム在庫", itemUnit: "件", availableTime: "利用可能日時", cardHoursPerGpuHour: "カード時間 / GPU 時間", details: "在庫詳細を見る" },
    hero: { eyebrow: "GPU コンピュートカタログ", title: "GPU コンピュートを選ぶ", description: "GPU パッケージ、サプライヤー、仕様、カード時間の参考価格を確認してから見積りを依頼してください。在庫とネットワーク条件の確認後、プラットフォームが手動納品を手配します。", quickNavLabel: "GPU 購入クイックリンク", myRequests: "自分の算力申請", myAssets: "自分の資産", submitDemand: "適切なパッケージがない場合は要件を送信", sparkCampaign: "DGX Spark 特集" },
    mode: { label: "GPU サービス種別", rent: "GPU をレンタル", managed: "GPU クラウド運用" },
    catalog: { eyebrow: "サプライヤー GPU パッケージ", title: "サプライヤー GPU パッケージ", packageUnit: "パッケージ", intro: "以下はサプライヤー提供の見積パッケージです。表示価格は見積りの参考であり、送信しても在庫確保、支払い、成約にはなりません。", filterLabel: "GPU パッケージを絞り込む", search: "パッケージを検索", searchPlaceholder: "A100、H100、H200、B200 を検索…", gpuModel: "GPU モデル", allModels: "すべてのモデル", gpuCount: "パッケージごとの GPU 数", allGpuCounts: "すべての枚数", gpuCountUnit: "枚", sort: "価格順", lowToHigh: "カード時間：安い順", highToLow: "カード時間：高い順", empty: "条件に一致するパッケージがありません。モデルまたは検索語を変更してください。" },
    card: { supplierQuote: "サプライヤー見積", manualDelivery: "手動納品", gpuPackage: "GPU パッケージ", memory: "メモリ", storage: "ストレージ", serviceArea: "サービス地域", regionNetwork: "地域とネットワーク", deliveryMethod: "納品方法", quoteReference: "見積参考", cardHourUnit: "カード時間", perPackagePerHour: "1パッケージ・1時間あたり", gpuUnit: "GPU", viewDetails: "詳細を見る", loginForQuote: "ログインして見積依頼", maintenance: "手動見積りはメンテナンス中" },
    leads: { title: "その他のサプライヤーリソース情報", countSuffix: "件の見積情報（カスタム要件の送信に利用可能）", expand: "展開 ＋", notice: "これらはサプライヤーの見積資料に基づく要件情報であり、現在の在庫や購入可能なパッケージを示すものではありません。ご希望の場合は算力要件を送信し、プラットフォームの再確認をお待ちください。", submit: "関連要件を送信" },
  },
  ko: {
    factFallback: "견적 요청 시 확인",
    live: { error: "실시간 재고를 일시적으로 불러올 수 없습니다. 공급업체 견적 패키지는 계속 살펴볼 수 있습니다.", loading: "플랫폼 실시간 재고를 불러오는 중…", eyebrow: "플랫폼 재고", title: "플랫폼 실시간 재고", itemUnit: "개", availableTime: "이용 가능 시간", cardHoursPerGpuHour: "카드 시간 / GPU 시간", details: "재고 상세 보기" },
    hero: { eyebrow: "GPU 컴퓨팅 카탈로그", title: "GPU 컴퓨팅 구매", description: "GPU 패키지, 공급업체, 사양 및 카드 시간 참고 가격을 확인한 뒤 견적을 요청하세요. 플랫폼은 재고와 네트워크 조건을 확인한 후 수동 인도를 준비합니다.", quickNavLabel: "컴퓨팅 구매 바로가기", myRequests: "내 컴퓨팅 신청", myAssets: "내 자산", submitDemand: "적합한 패키지가 없나요? 요구사항 제출", sparkCampaign: "DGX Spark 특별관" },
    mode: { label: "GPU 서비스 유형", rent: "GPU 대여", managed: "GPU 클라우드 위탁운영" },
    catalog: { eyebrow: "공급업체 GPU 패키지", title: "공급업체 GPU 패키지", packageUnit: "개 패키지", intro: "아래는 공급업체가 제공한 견적 패키지입니다. 표시 가격은 견적 참고용이며, 제출해도 재고가 확보되거나 결제 또는 거래가 이루어지지 않습니다.", filterLabel: "GPU 패키지 필터", search: "패키지 검색", searchPlaceholder: "A100, H100, H200, B200 검색…", gpuModel: "GPU 모델", allModels: "모든 모델", gpuCount: "패키지당 GPU 수", allGpuCounts: "모든 GPU 수", gpuCountUnit: "장", sort: "가격 정렬", lowToHigh: "카드 시간 낮은 순", highToLow: "카드 시간 높은 순", empty: "현재 필터에 맞는 패키지가 없습니다. 모델이나 검색어를 변경하세요." },
    card: { supplierQuote: "공급업체 견적", manualDelivery: "수동 인도", gpuPackage: "GPU 패키지", memory: "메모리", storage: "스토리지", serviceArea: "서비스 지역", regionNetwork: "지역 및 네트워크", deliveryMethod: "인도 방식", quoteReference: "견적 참고", cardHourUnit: "카드 시간", perPackagePerHour: "패키지당 · 시간당", gpuUnit: "GPU", viewDetails: "상세 보기", loginForQuote: "로그인 후 견적 요청", maintenance: "수동 견적 점검 중" },
    leads: { title: "추가 공급업체 리소스 정보", countSuffix: "개 견적 정보, 맞춤 요구사항 제출 가능", expand: "펼쳐보기 ＋", notice: "이 항목은 공급업체 견적 자료에서 가져온 요구 정보일 뿐 현재 재고나 구매 가능한 패키지를 의미하지 않습니다. 관심이 있다면 컴퓨팅 요구사항을 제출하여 플랫폼의 재확인을 받으세요.", submit: "관련 요구사항 제출" },
  },
  fr: {
    factFallback: "À confirmer lors de la demande de devis",
    live: { error: "Le stock en temps réel est temporairement indisponible. Les offres sur devis des fournisseurs restent consultables.", loading: "Chargement du stock en temps réel…", eyebrow: "STOCK DE LA PLATEFORME", title: "Stock en temps réel", itemUnit: "offres", availableTime: "Disponible à partir de", cardHoursPerGpuHour: "Heures-carte / heure GPU", details: "Voir le détail du stock" },
    hero: { eyebrow: "CATALOGUE DE CALCUL GPU", title: "Acheter du calcul GPU", description: "Consultez les offres GPU, les fournisseurs, les spécifications et les prix indicatifs en heures-carte avant de demander un devis. La plateforme organise la livraison manuelle après confirmation du stock et du réseau.", quickNavLabel: "Accès rapides pour acheter du calcul", myRequests: "Mes demandes de calcul", myAssets: "Mes actifs", submitDemand: "Aucune offre adaptée ? Soumettre un besoin", sparkCampaign: "Opération DGX Spark" },
    mode: { label: "Type de service GPU", rent: "Louer un GPU", managed: "GPU cloud géré" },
    catalog: { eyebrow: "OFFRES GPU DES FOURNISSEURS", title: "Offres GPU des fournisseurs", packageUnit: "offres", intro: "Ces offres sont fournies par les fournisseurs. Les prix affichés sont indicatifs : l’envoi ne réserve pas le stock, ne déclenche aucun paiement et ne constitue pas une transaction.", filterLabel: "Filtrer les offres GPU", search: "Rechercher une offre", searchPlaceholder: "Rechercher A100, H100, H200, B200…", gpuModel: "Modèle de GPU", allModels: "Tous les modèles", gpuCount: "GPU par offre", allGpuCounts: "Tous les nombres de GPU", gpuCountUnit: "GPU", sort: "Trier par prix", lowToHigh: "Heures-carte : ordre croissant", highToLow: "Heures-carte : ordre décroissant", empty: "Aucune offre ne correspond aux filtres. Essayez un autre modèle ou terme." },
    card: { supplierQuote: "Devis fournisseur", manualDelivery: "Livraison manuelle", gpuPackage: "Offre GPU", memory: "Mémoire", storage: "Stockage", serviceArea: "Zone de service", regionNetwork: "Région et réseau", deliveryMethod: "Mode de livraison", quoteReference: "Prix indicatif", cardHourUnit: "heures-carte", perPackagePerHour: "par offre · par heure", gpuUnit: "GPU", viewDetails: "Voir les détails", loginForQuote: "Se connecter pour un devis", maintenance: "Devis manuel en maintenance" },
    leads: { title: "Autres pistes de ressources fournisseurs", countSuffix: "pistes de devis pour une demande personnalisée", expand: "Développer ＋", notice: "Ces éléments proviennent de documents tarifaires de fournisseurs et constituent uniquement des pistes. Ils ne représentent ni un stock actuel ni des offres achetables. Soumettez un besoin de calcul pour obtenir une nouvelle confirmation de la plateforme.", submit: "Soumettre le besoin associé" },
  },
  th: {
    factFallback: "ยืนยันเมื่อขอใบเสนอราคา",
    live: { error: "ไม่สามารถอ่านสต็อกแบบเรียลไทม์ได้ชั่วคราว ยังสามารถดูแพ็กเกจขอราคาจากผู้ให้บริการได้ตามปกติ", loading: "กำลังโหลดสต็อกแบบเรียลไทม์ของแพลตฟอร์ม…", eyebrow: "สต็อกแพลตฟอร์ม", title: "สต็อกแบบเรียลไทม์", itemUnit: "รายการ", availableTime: "พร้อมใช้งานตั้งแต่", cardHoursPerGpuHour: "ชั่วโมงการ์ด / ชั่วโมง GPU", details: "ดูรายละเอียดสต็อก" },
    hero: { eyebrow: "แคตตาล็อกพลังประมวลผล GPU", title: "เลือกซื้อพลังประมวลผล GPU", description: "ตรวจสอบแพ็กเกจ GPU ผู้ให้บริการ สเปก และราคาอ้างอิงชั่วโมงการ์ดก่อนขอใบเสนอราคา แพลตฟอร์มจะจัดส่งมอบโดยเจ้าหน้าที่หลังยืนยันสต็อกและเงื่อนไขเครือข่าย", quickNavLabel: "ทางลัดสำหรับซื้อพลังประมวลผล", myRequests: "คำขอพลังประมวลผลของฉัน", myAssets: "สินทรัพย์ของฉัน", submitDemand: "ไม่มีแพ็กเกจที่เหมาะสม? ส่งความต้องการ", sparkCampaign: "แคมเปญ DGX Spark" },
    mode: { label: "ประเภทบริการ GPU", rent: "เช่า GPU", managed: "GPU คลาวด์แบบดูแล" },
    catalog: { eyebrow: "แพ็กเกจ GPU จากผู้ให้บริการ", title: "แพ็กเกจ GPU จากผู้ให้บริการ", packageUnit: "แพ็กเกจ", intro: "แพ็กเกจเสนอราคาเหล่านี้จัดทำโดยผู้ให้บริการ ราคาที่แสดงใช้เป็นข้อมูลอ้างอิง การส่งคำขอจะไม่ล็อกสต็อก ไม่เรียกเก็บเงิน และไม่ถือว่าเกิดธุรกรรม", filterLabel: "กรองแพ็กเกจ GPU", search: "ค้นหาแพ็กเกจ", searchPlaceholder: "ค้นหา A100, H100, H200, B200…", gpuModel: "รุ่น GPU", allModels: "ทุกรุ่น", gpuCount: "จำนวน GPU ต่อแพ็กเกจ", allGpuCounts: "ทุกจำนวน GPU", gpuCountUnit: "ใบ", sort: "เรียงตามราคา", lowToHigh: "ชั่วโมงการ์ด: ต่ำไปสูง", highToLow: "ชั่วโมงการ์ด: สูงไปต่ำ", empty: "ไม่มีแพ็กเกจตรงกับตัวกรอง โปรดลองเปลี่ยนรุ่นหรือคำค้น" },
    card: { supplierQuote: "ใบเสนอราคาผู้ให้บริการ", manualDelivery: "ส่งมอบโดยเจ้าหน้าที่", gpuPackage: "แพ็กเกจ GPU", memory: "หน่วยความจำ", storage: "พื้นที่จัดเก็บ", serviceArea: "พื้นที่ให้บริการ", regionNetwork: "ภูมิภาคและเครือข่าย", deliveryMethod: "วิธีส่งมอบ", quoteReference: "ราคาอ้างอิง", cardHourUnit: "ชั่วโมงการ์ด", perPackagePerHour: "ต่อแพ็กเกจ · ต่อชั่วโมง", gpuUnit: "GPU", viewDetails: "ดูรายละเอียด", loginForQuote: "เข้าสู่ระบบเพื่อขอราคา", maintenance: "ระบบขอราคาโดยเจ้าหน้าที่อยู่ระหว่างบำรุงรักษา" },
    leads: { title: "ข้อมูลทรัพยากรจากผู้ให้บริการเพิ่มเติม", countSuffix: "ข้อมูลราคา สำหรับส่งความต้องการเฉพาะ", expand: "ขยายดู ＋", notice: "รายการเหล่านี้มาจากเอกสารเสนอราคาของผู้ให้บริการและใช้เป็นข้อมูลความต้องการเท่านั้น ไม่ใช่สต็อกปัจจุบันหรือแพ็กเกจที่ซื้อได้ โปรดส่งความต้องการพลังประมวลผลเพื่อให้แพลตฟอร์มยืนยันอีกครั้ง", submit: "ส่งความต้องการที่เกี่ยวข้อง" },
  },
  vi: {
    factFallback: "Xác nhận khi yêu cầu báo giá",
    live: { error: "Tạm thời không thể đọc tồn kho trực tiếp. Bạn vẫn có thể xem các gói yêu cầu báo giá của nhà cung cấp.", loading: "Đang tải tồn kho trực tiếp của nền tảng…", eyebrow: "TỒN KHO NỀN TẢNG", title: "Tồn kho trực tiếp", itemUnit: "mục", availableTime: "Có thể dùng từ", cardHoursPerGpuHour: "Giờ-thẻ / giờ GPU", details: "Xem chi tiết tồn kho" },
    hero: { eyebrow: "DANH MỤC TÍNH TOÁN GPU", title: "Mua năng lực tính toán GPU", description: "Xem gói GPU, nhà cung cấp, thông số và giá giờ-thẻ tham khảo trước khi yêu cầu báo giá. Nền tảng sẽ sắp xếp bàn giao thủ công sau khi xác nhận tồn kho và điều kiện mạng.", quickNavLabel: "Lối tắt mua năng lực tính toán", myRequests: "Yêu cầu tính toán của tôi", myAssets: "Tài sản của tôi", submitDemand: "Không có gói phù hợp? Gửi nhu cầu", sparkCampaign: "Chương trình DGX Spark" },
    mode: { label: "Loại dịch vụ GPU", rent: "Thuê GPU", managed: "GPU đám mây được quản lý" },
    catalog: { eyebrow: "GÓI GPU CỦA NHÀ CUNG CẤP", title: "Gói GPU của nhà cung cấp", packageUnit: "gói", intro: "Các gói báo giá dưới đây do nhà cung cấp cung cấp. Giá hiển thị chỉ để tham khảo; việc gửi yêu cầu không giữ tồn kho, không thanh toán và không tạo giao dịch.", filterLabel: "Lọc gói GPU", search: "Tìm gói", searchPlaceholder: "Tìm A100, H100, H200, B200…", gpuModel: "Mẫu GPU", allModels: "Tất cả mẫu", gpuCount: "Số GPU mỗi gói", allGpuCounts: "Mọi số lượng GPU", gpuCountUnit: "GPU", sort: "Sắp xếp theo giá", lowToHigh: "Giờ-thẻ: thấp đến cao", highToLow: "Giờ-thẻ: cao đến thấp", empty: "Không có gói phù hợp với bộ lọc. Hãy đổi mẫu hoặc từ khóa." },
    card: { supplierQuote: "Báo giá nhà cung cấp", manualDelivery: "Bàn giao thủ công", gpuPackage: "Gói GPU", memory: "Bộ nhớ", storage: "Lưu trữ", serviceArea: "Phạm vi dịch vụ", regionNetwork: "Khu vực và mạng", deliveryMethod: "Phương thức bàn giao", quoteReference: "Giá tham khảo", cardHourUnit: "giờ-thẻ", perPackagePerHour: "mỗi gói · mỗi giờ", gpuUnit: "GPU", viewDetails: "Xem chi tiết", loginForQuote: "Đăng nhập để báo giá", maintenance: "Báo giá thủ công đang bảo trì" },
    leads: { title: "Thêm đầu mối tài nguyên nhà cung cấp", countSuffix: "đầu mối báo giá cho nhu cầu tùy chỉnh", expand: "Mở rộng ＋", notice: "Các mục này đến từ tài liệu báo giá của nhà cung cấp và chỉ là đầu mối nhu cầu, không đại diện cho tồn kho hiện tại hoặc gói có thể mua. Hãy gửi nhu cầu tính toán để nền tảng xác nhận lại.", submit: "Gửi nhu cầu liên quan" },
  },
  id: {
    factFallback: "Konfirmasi saat meminta penawaran",
    live: { error: "Inventaris langsung sementara tidak dapat dibaca. Paket penawaran pemasok tetap dapat dijelajahi.", loading: "Memuat inventaris langsung platform…", eyebrow: "INVENTARIS PLATFORM", title: "Inventaris langsung platform", itemUnit: "item", availableTime: "Tersedia mulai", cardHoursPerGpuHour: "Jam-kartu / jam GPU", details: "Lihat detail inventaris" },
    hero: { eyebrow: "KATALOG KOMPUTASI GPU", title: "Beli komputasi GPU", description: "Tinjau paket GPU, pemasok, spesifikasi, dan harga referensi jam-kartu sebelum meminta penawaran. Platform mengatur penyerahan manual setelah inventaris dan kondisi jaringan dikonfirmasi.", quickNavLabel: "Tautan cepat pembelian komputasi", myRequests: "Permintaan komputasi saya", myAssets: "Aset saya", submitDemand: "Tidak ada paket yang sesuai? Ajukan kebutuhan", sparkCampaign: "Program DGX Spark" },
    mode: { label: "Jenis layanan GPU", rent: "Sewa GPU", managed: "Cloud GPU terkelola" },
    catalog: { eyebrow: "PAKET GPU PEMASOK", title: "Paket GPU pemasok", packageUnit: "paket", intro: "Paket penawaran ini disediakan oleh pemasok. Harga yang ditampilkan hanya referensi; pengajuan tidak memesan inventaris, mengambil pembayaran, atau membentuk transaksi.", filterLabel: "Filter paket GPU", search: "Cari paket", searchPlaceholder: "Cari A100, H100, H200, B200…", gpuModel: "Model GPU", allModels: "Semua model", gpuCount: "GPU per paket", allGpuCounts: "Semua jumlah GPU", gpuCountUnit: "GPU", sort: "Urutkan harga", lowToHigh: "Jam-kartu: rendah ke tinggi", highToLow: "Jam-kartu: tinggi ke rendah", empty: "Tidak ada paket yang cocok dengan filter. Coba model atau kata kunci lain." },
    card: { supplierQuote: "Penawaran pemasok", manualDelivery: "Penyerahan manual", gpuPackage: "Paket GPU", memory: "Memori", storage: "Penyimpanan", serviceArea: "Area layanan", regionNetwork: "Wilayah dan jaringan", deliveryMethod: "Metode penyerahan", quoteReference: "Referensi penawaran", cardHourUnit: "jam-kartu", perPackagePerHour: "per paket · per jam", gpuUnit: "GPU", viewDetails: "Lihat detail", loginForQuote: "Masuk untuk penawaran", maintenance: "Penawaran manual sedang dipelihara" },
    leads: { title: "Prospek sumber daya pemasok lainnya", countSuffix: "prospek penawaran untuk kebutuhan khusus", expand: "Perluas ＋", notice: "Entri ini berasal dari materi penawaran pemasok dan hanya merupakan prospek kebutuhan. Entri tidak mewakili inventaris saat ini atau paket yang dapat dibeli. Ajukan kebutuhan komputasi agar platform mengonfirmasi ulang.", submit: "Ajukan kebutuhan terkait" },
  },
  ms: {
    factFallback: "Sahkan semasa meminta sebut harga",
    live: { error: "Inventori masa nyata tidak dapat dibaca buat sementara waktu. Pakej sebut harga pembekal masih boleh dilihat.", loading: "Memuatkan inventori masa nyata platform…", eyebrow: "INVENTORI PLATFORM", title: "Inventori masa nyata platform", itemUnit: "item", availableTime: "Tersedia mulai", cardHoursPerGpuHour: "Jam-kad / jam GPU", details: "Lihat butiran inventori" },
    hero: { eyebrow: "KATALOG PENGKOMPUTERAN GPU", title: "Beli pengkomputeran GPU", description: "Semak pakej GPU, pembekal, spesifikasi dan harga rujukan jam-kad sebelum meminta sebut harga. Platform mengatur penyerahan manual selepas inventori dan keadaan rangkaian disahkan.", quickNavLabel: "Pautan pantas pembelian pengkomputeran", myRequests: "Permohonan pengkomputeran saya", myAssets: "Aset saya", submitDemand: "Tiada pakej sesuai? Hantar keperluan", sparkCampaign: "Kempen DGX Spark" },
    mode: { label: "Jenis perkhidmatan GPU", rent: "Sewa GPU", managed: "Awan GPU terurus" },
    catalog: { eyebrow: "PAKEJ GPU PEMBEKAL", title: "Pakej GPU pembekal", packageUnit: "pakej", intro: "Pakej sebut harga ini disediakan oleh pembekal. Harga yang dipaparkan hanya rujukan; penghantaran permohonan tidak menempah inventori, mengambil bayaran atau membentuk transaksi.", filterLabel: "Tapis pakej GPU", search: "Cari pakej", searchPlaceholder: "Cari A100, H100, H200, B200…", gpuModel: "Model GPU", allModels: "Semua model", gpuCount: "GPU setiap pakej", allGpuCounts: "Semua bilangan GPU", gpuCountUnit: "GPU", sort: "Susun harga", lowToHigh: "Jam-kad: rendah ke tinggi", highToLow: "Jam-kad: tinggi ke rendah", empty: "Tiada pakej sepadan dengan tapisan. Cuba model atau kata carian lain." },
    card: { supplierQuote: "Sebut harga pembekal", manualDelivery: "Penyerahan manual", gpuPackage: "Pakej GPU", memory: "Memori", storage: "Storan", serviceArea: "Kawasan perkhidmatan", regionNetwork: "Wilayah dan rangkaian", deliveryMethod: "Kaedah penyerahan", quoteReference: "Rujukan sebut harga", cardHourUnit: "jam-kad", perPackagePerHour: "setiap pakej · setiap jam", gpuUnit: "GPU", viewDetails: "Lihat butiran", loginForQuote: "Log masuk untuk sebut harga", maintenance: "Sebut harga manual sedang diselenggara" },
    leads: { title: "Petunjuk sumber pembekal lain", countSuffix: "petunjuk sebut harga untuk keperluan tersuai", expand: "Kembangkan ＋", notice: "Entri ini datang daripada bahan sebut harga pembekal dan hanya merupakan petunjuk keperluan. Ia tidak mewakili inventori semasa atau pakej yang boleh dibeli. Hantar keperluan pengkomputeran untuk pengesahan semula platform.", submit: "Hantar keperluan berkaitan" },
  },
} as const satisfies Record<Locale, BuyCopy>;

const MODEL_LABELS: Record<string, string> = { RTX_4090: "RTX 4090", H100_80GB: "H100 80GB", H100_94GB: "H100 94GB" };

function offerModel(value: string) { return MODEL_LABELS[value] ?? value.replaceAll("_", " "); }
function cardHours(micros: number) { try { return formatCardHourDisplayMicros(micros); } catch { return "—"; } }
function sourceDate(listing: ResourceListing) { return listing.source?.observedAt ?? listing.quote.updatedAt.slice(0, 10); }
function packageRate(listing: ResourceListing, unit: string) { return `${formatCardHourValue(listing.quote.median / 1.002)} ${unit}`; }
function packageGpuCount(listing: ResourceListing) {
  const match = listing.specs.GPU?.match(/×\s*(\d+)/u);
  return match ? Number(match[1]) : 1;
}
function modelFamily(listing: ResourceListing) { return listing.title.split("·")[0]?.trim() || listing.specs.GPU || listing.title; }
function listingSearchText(listing: ResourceListing) { return [listing.title, listing.supplierName, listing.region, listing.deliveryForm, ...Object.values(listing.specs)].join(" ").toLocaleLowerCase("zh-CN"); }
function fact(listing: ResourceListing, labels: string[], fallback: string) { for (const label of labels) if (listing.specs[label]) return listing.specs[label]; return fallback; }
function responseJson<T>(response: Response): Promise<T | null> { return response.json().catch(() => null) as Promise<T | null>; }

function LiveInventory() {
  const { locale } = useLocale();
  const copy = BUY_COPY[locale];
  const [readiness, setReadiness] = useState<PublicHostingReadiness | null>(null);
  const [offers, setOffers] = useState<PublicHostingOffer[] | null>(null);
  const [hasError, setHasError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const readyResponse = await fetch("/api/ready", { cache: "no-store", signal: controller.signal });
        const readyBody = await responseJson<HostingReadinessEnvelope>(readyResponse);
        if (!readyBody?.hostingV2) throw new Error("READINESS_UNAVAILABLE");
        setReadiness(readyBody.hostingV2);
        if (!readyBody.hostingV2.enabled || !readyBody.hostingV2.ready) { setOffers([]); return; }
        const response = await fetch("/api/v2/offers", { cache: "no-store", signal: controller.signal });
        const body = await responseJson<OfferPayload>(response);
        if (!response.ok || !body || !Array.isArray(body.records)) throw new Error("OFFERS_UNAVAILABLE");
        setOffers(body.records);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setHasError(true);
        setOffers([]);
      }
    }
    void load();
    return () => controller.abort();
  }, []);
  if (hasError) return <p className={styles.inlineNotice} role="status">{copy.live.error}</p>;
  if (readiness === null || offers === null) return <p className={styles.inlineNotice} role="status">{copy.live.loading}</p>;
  if (!readiness.enabled || !readiness.ready || offers.length === 0) return null;
  return <section className={styles.liveSection} aria-labelledby="live-inventory-title">
    <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>{copy.live.eyebrow}</p><h2 id="live-inventory-title">{copy.live.title}</h2></div><span>{offers.length} {copy.live.itemUnit}</span></div>
    <div className={styles.liveList}>{offers.map((offer) => <article key={offer.id}>
      <div><h3>{offer.title}</h3><p>{offerModel(offer.gpuModel)} · {offer.region}</p></div>
      <div><small>{copy.live.availableTime}</small><strong>{formatHostingTime(offer.availableFrom)}</strong></div>
      <div><small>{copy.live.cardHoursPerGpuHour}</small><strong>{cardHours(offer.pricing.cardHourMicrosPerGpuHour)}</strong></div>
      <Link href={`/gpu/offers/${encodeURIComponent(offer.id)}`}>{copy.live.details}</Link>
    </article>)}</div>
  </section>;
}

export function BuyWorkspace({ inquiryEnabled, primaryListings, referenceLeads, showLiveInventory }: { inquiryEnabled: boolean; primaryListings: readonly ResourceListing[]; referenceLeads: readonly ResourceListing[]; showLiveInventory: boolean }) {
  const { locale } = useLocale();
  const copy = BUY_COPY[locale];
  const [query, setQuery] = useState("");
  const [model, setModel] = useState("ALL");
  const [gpuCount, setGpuCount] = useState("ALL");
  const [sort, setSort] = useState<"PRICE_ASC" | "PRICE_DESC">("PRICE_ASC");
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const models = useMemo(() => Array.from(new Set(primaryListings.map(modelFamily))).sort(), [primaryListings]);
  const visibleListings = useMemo(() => primaryListings
    .filter((listing) => model === "ALL" || modelFamily(listing) === model)
    .filter((listing) => gpuCount === "ALL" || packageGpuCount(listing) === Number(gpuCount))
    .filter((listing) => !normalizedQuery || listingSearchText(listing).includes(normalizedQuery))
    .sort((left, right) => sort === "PRICE_ASC" ? left.quote.median - right.quote.median : right.quote.median - left.quote.median), [gpuCount, model, normalizedQuery, primaryListings, sort]);

  return <div className={styles.page}>
    <header className={styles.hero}><div className={`shell ${styles.heroInner}`}>
      <div><p className={styles.eyebrow}>{copy.hero.eyebrow}</p><h1>{copy.hero.title}</h1><p>{copy.hero.description}</p></div>
      <nav className={styles.routeLinks} aria-label={copy.hero.quickNavLabel}><Link href="/member/purchases">{copy.hero.myRequests}</Link><Link href="/member#card-hours">{copy.hero.myAssets}</Link><Link href="/request">{copy.hero.submitDemand}</Link><Link href="/campaigns/dgx-spark">{copy.hero.sparkCampaign}</Link></nav>
    </div></header>

    <main className={`shell ${styles.workspace}`}>
      <nav className={styles.modeTabs} aria-label={copy.mode.label}><Link className={styles.activeTab} aria-current="page" href="/buy">{copy.mode.rent}</Link><Link href="/managed-gpu">{copy.mode.managed}</Link></nav>
      <section aria-labelledby="supplier-catalog-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>{copy.catalog.eyebrow}</p><h2 id="supplier-catalog-title">{copy.catalog.title}</h2></div><span>{visibleListings.length} {copy.catalog.packageUnit}</span></div>
        <p className={styles.catalogIntro}>{copy.catalog.intro}</p>
        <div className={styles.filters} aria-label={copy.catalog.filterLabel}>
          <label><span>{copy.catalog.search}</span><input type="search" value={query} placeholder={copy.catalog.searchPlaceholder} onChange={(event) => setQuery(event.target.value)} /></label>
          <label><span>{copy.catalog.gpuModel}</span><select value={model} onChange={(event) => setModel(event.target.value)}><option value="ALL">{copy.catalog.allModels}</option>{models.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          <label><span>{copy.catalog.gpuCount}</span><select value={gpuCount} onChange={(event) => setGpuCount(event.target.value)}><option value="ALL">{copy.catalog.allGpuCounts}</option><option value="1">1 {copy.catalog.gpuCountUnit}</option><option value="2">2 {copy.catalog.gpuCountUnit}</option><option value="4">4 {copy.catalog.gpuCountUnit}</option></select></label>
          <label><span>{copy.catalog.sort}</span><select value={sort} onChange={(event) => setSort(event.target.value as "PRICE_ASC" | "PRICE_DESC")}><option value="PRICE_ASC">{copy.catalog.lowToHigh}</option><option value="PRICE_DESC">{copy.catalog.highToLow}</option></select></label>
        </div>
        <div className={styles.productGrid}>{visibleListings.map((listing) => <article className={styles.productCard} key={listing.id}>
          <div className={styles.supplierLine}>{listing.supplierLogoUrl ? <Image alt="" className={styles.supplierLogo} height={48} src={listing.supplierLogoUrl} width={48} /> : <span className={styles.logoFallback} aria-hidden="true">K</span>}<div><strong>{listing.supplierName}</strong><span>{copy.card.supplierQuote} · {sourceDate(listing)}</span></div></div>
          <div className={styles.productTitle}><p>{listing.deliveryForm} · {copy.card.manualDelivery}</p><h3>{listing.title}</h3></div>
          <dl className={styles.productFacts}><div><dt>{copy.card.gpuPackage}</dt><dd>{fact(listing, ["GPU"], copy.factFallback)}</dd></div><div><dt>CPU</dt><dd>{fact(listing, ["CPU", "宿主机CPU", "CPU与内存"], copy.factFallback)}</dd></div><div><dt>{copy.card.memory}</dt><dd>{fact(listing, ["内存", "宿主机内存", "CPU与内存"], copy.factFallback)}</dd></div><div><dt>{copy.card.storage}</dt><dd>{fact(listing, ["存储", "硬盘", "套餐硬盘"], copy.factFallback)}</dd></div></dl>
          <div className={styles.deliveryFacts}><p><span>{copy.card.serviceArea}</span><strong>{listing.region}</strong></p><p><span>{copy.card.regionNetwork}</span><strong>{fact(listing, ["地域与网络", "实际机房地域"], copy.factFallback)}</strong></p><p><span>{copy.card.deliveryMethod}</span><strong>{listing.deliveryLeadTime}</strong></p></div>
          <div className={styles.priceLine}><div><span>{copy.card.quoteReference}</span><strong>{packageRate(listing, copy.card.cardHourUnit)}</strong><small>{copy.card.perPackagePerHour} ({packageGpuCount(listing)} {copy.card.gpuUnit})</small></div><div className={styles.cardActions}><Link href={`/resources/${encodeURIComponent(listing.id)}`}>{copy.card.viewDetails}</Link>{inquiryEnabled ? <Link className={styles.primaryAction} href={`/checkout/${encodeURIComponent(listing.id)}`}>{copy.card.loginForQuote}</Link> : <span className={styles.disabledAction} aria-disabled="true">{copy.card.maintenance}</span>}</div></div>
        </article>)}</div>
        {visibleListings.length === 0 ? <div className={styles.empty}>{copy.catalog.empty}</div> : null}
      </section>

      {showLiveInventory ? <LiveInventory /> : null}

      <details className={styles.leadDirectory}>
        <summary><span><strong>{copy.leads.title}</strong><small>{referenceLeads.length} {copy.leads.countSuffix}</small></span><span aria-hidden="true">{copy.leads.expand}</span></summary>
        <div className={styles.leadNotice}>{copy.leads.notice}</div>
        <div className={styles.leadGrid}>{referenceLeads.map((listing) => <article key={listing.id}><div><strong>{listing.supplierName}</strong><h3>{listing.title}</h3><p>{listing.region} · {listing.deliveryForm} · {sourceDate(listing)}</p></div><Link href={`/request?listing=${encodeURIComponent(listing.id)}`}>{copy.leads.submit}</Link></article>)}</div>
      </details>
    </main>
  </div>;
}
