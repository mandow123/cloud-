"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import type { Locale } from "@/lib/i18n";
import { formatMoneyMinor, readManagedGpuJson, type ManagedGpuCatalogEnvelope } from "@/lib/managed-gpu-client";
import styles from "./managed-gpu.module.css";

type ManagedGpuCatalogCopy = Readonly<{
  errorTitle: string;
  errorBody: string;
  errorTruth: string;
  loading: string;
  closedTitle: string;
  closedBody: string;
  gpuModel: string;
  allModels: string;
  reviewedProductUnit: string;
  productsAria: string;
  catalogOnlyTitle: string;
  catalogOnlyBody: string;
  vramQuote: string;
  vramUnit: string;
  ownershipBadge: string;
  bankPrice: string;
  formalQuote: string;
  cardHourReference: string;
  cardHourUnit: string;
  warranty: string;
  contractConfirmation: string;
  monthUnit: string;
  estimatedDelivery: string;
  supplierConfirmation: string;
  dayUnit: string;
  hostingFacility: string;
  quoteConfirmation: string;
  deliveryChoice: string;
  facilityHosting: string;
  globalShipping: string;
  utilization7d: string;
  utilization30d: string;
  noUtilization: string;
  truth: string;
  requestQuote: string;
  unavailable: string;
  emptyTitle: string;
  emptyBody: string;
}>;

const CATALOG_COPY = {
  "zh-CN": { errorTitle: "目录暂时不可用", errorBody: "GPU 云托管目录暂时无法读取，请稍后重试。", errorTruth: "页面不会使用虚构库存或收益数据替代真实服务结果。", loading: "正在读取经审核的实体 GPU 商品…", closedTitle: "GPU 云托管尚未开放", closedBody: "库存、供应商合同、机房和结算政策全部核验完成后才会开放。", gpuModel: "GPU 型号", allModels: "全部型号", reviewedProductUnit: "个经审核商品版本", productsAria: "经审核的实体 GPU 商品", catalogOnlyTitle: "当前只开放目录与报价申请", catalogOnlyBody: "商品不代表实时库存；供应商确认序列号、银行付款和交付条件后才形成实体资产。", vramQuote: "显存报价时确认", vramUnit: "GB 显存", ownershipBadge: "整卡确权", bankPrice: "供应商银行价", formalQuote: "正式报价时确认", cardHourReference: "卡时参考", cardHourUnit: "卡时", warranty: "硬件质保", contractConfirmation: "合同中确认", monthUnit: "个月", estimatedDelivery: "预计交付", supplierConfirmation: "供应商确认", dayUnit: "天", hostingFacility: "托管机房", quoteConfirmation: "报价时确认", deliveryChoice: "交付选择", facilityHosting: "机房托管", globalShipping: "全球寄送", utilization7d: "近 7 日真实利用率", utilization30d: "近 30 日真实利用率", noUtilization: "尚无真实数据", truth: "只按真实成交与有效 GPU 秒产生卡时；不承诺固定收益，不支持卡时提现或转让。", requestQuote: "获取正式报价", unavailable: "库存与合同尚未核验，暂不可提交", emptyTitle: "当前没有可申请的实体 GPU", emptyBody: "平台不会在供应商商品和机房条件核验前展示可购买库存。" },
  "zh-TW": { errorTitle: "目錄暫時無法使用", errorBody: "GPU 雲端託管目錄暫時無法讀取，請稍後再試。", errorTruth: "頁面不會使用虛構庫存或收益資料取代真實服務結果。", loading: "正在讀取經審核的實體 GPU 商品…", closedTitle: "GPU 雲端託管尚未開放", closedBody: "庫存、供應商合約、機房和結算政策全部核驗完成後才會開放。", gpuModel: "GPU 型號", allModels: "全部型號", reviewedProductUnit: "個經審核商品版本", productsAria: "經審核的實體 GPU 商品", catalogOnlyTitle: "目前只開放目錄與報價申請", catalogOnlyBody: "商品不代表即時庫存；供應商確認序號、銀行付款和交付條件後才形成實體資產。", vramQuote: "顯存於報價時確認", vramUnit: "GB 顯存", ownershipBadge: "整卡確權", bankPrice: "供應商銀行價", formalQuote: "正式報價時確認", cardHourReference: "卡時參考", cardHourUnit: "卡時", warranty: "硬體保固", contractConfirmation: "合約中確認", monthUnit: "個月", estimatedDelivery: "預計交付", supplierConfirmation: "供應商確認", dayUnit: "天", hostingFacility: "託管機房", quoteConfirmation: "報價時確認", deliveryChoice: "交付選擇", facilityHosting: "機房託管", globalShipping: "全球寄送", utilization7d: "近 7 日真實利用率", utilization30d: "近 30 日真實利用率", noUtilization: "尚無真實資料", truth: "只按真實成交與有效 GPU 秒產生卡時；不承諾固定收益，不支援卡時提現或轉讓。", requestQuote: "取得正式報價", unavailable: "庫存與合約尚未核驗，暫不可提交", emptyTitle: "目前沒有可申請的實體 GPU", emptyBody: "平台不會在供應商商品與機房條件核驗前展示可購買庫存。" },
  en: { errorTitle: "Catalog temporarily unavailable", errorBody: "The managed GPU catalog cannot be loaded right now. Please try again later.", errorTruth: "The page will not replace real service results with fabricated inventory or output data.", loading: "Loading reviewed physical GPU products…", closedTitle: "Managed GPU cloud is not open yet", closedBody: "The service opens only after inventory, supplier contracts, facilities and settlement policies are fully verified.", gpuModel: "GPU model", allModels: "All models", reviewedProductUnit: "reviewed product versions", productsAria: "Reviewed physical GPU products", catalogOnlyTitle: "Catalog and quote requests only", catalogOnlyBody: "Products do not represent live inventory. A physical asset is created only after the supplier confirms the serial number, bank payment and delivery terms.", vramQuote: "VRAM confirmed with quote", vramUnit: "GB VRAM", ownershipBadge: "Whole-card ownership", bankPrice: "Supplier bank price", formalQuote: "Confirmed in formal quote", cardHourReference: "Card-hour reference", cardHourUnit: "card-hours", warranty: "Hardware warranty", contractConfirmation: "Confirmed in contract", monthUnit: "months", estimatedDelivery: "Estimated delivery", supplierConfirmation: "Supplier confirmation", dayUnit: "days", hostingFacility: "Hosting facility", quoteConfirmation: "Confirmed with quote", deliveryChoice: "Delivery choice", facilityHosting: "Facility hosting", globalShipping: "Global shipping", utilization7d: "Actual utilization, last 7 days", utilization30d: "Actual utilization, last 30 days", noUtilization: "No actual data yet", truth: "Card-hours are generated only from actual completed sales and valid GPU seconds. No fixed return is promised, and card-hours cannot be withdrawn or transferred.", requestQuote: "Get a formal quote", unavailable: "Inventory and contracts are not verified; submission is unavailable", emptyTitle: "No physical GPUs are currently available to request", emptyBody: "The platform does not show purchasable inventory before supplier products and facility conditions are verified." },
  ja: { errorTitle: "カタログを一時的に利用できません", errorBody: "GPU クラウド運用カタログを読み込めません。しばらくしてから再度お試しください。", errorTruth: "実際のサービス結果を架空の在庫や収益データで置き換えることはありません。", loading: "審査済みの物理 GPU 商品を読み込み中…", closedTitle: "GPU クラウド運用はまだ開始されていません", closedBody: "在庫、サプライヤー契約、施設、精算ポリシーの確認完了後にのみ開始します。", gpuModel: "GPU モデル", allModels: "すべてのモデル", reviewedProductUnit: "件の審査済み商品バージョン", productsAria: "審査済み物理 GPU 商品", catalogOnlyTitle: "現在はカタログと見積依頼のみ", catalogOnlyBody: "商品はリアルタイム在庫ではありません。サプライヤーがシリアル番号、銀行支払い、納品条件を確認した後に物理資産が成立します。", vramQuote: "VRAM は見積時に確認", vramUnit: "GB VRAM", ownershipBadge: "GPU 全体の所有権", bankPrice: "サプライヤー銀行価格", formalQuote: "正式見積で確認", cardHourReference: "カード時間参考", cardHourUnit: "カード時間", warranty: "ハードウェア保証", contractConfirmation: "契約で確認", monthUnit: "か月", estimatedDelivery: "納品予定", supplierConfirmation: "サプライヤー確認", dayUnit: "日", hostingFacility: "運用施設", quoteConfirmation: "見積時に確認", deliveryChoice: "納品方法", facilityHosting: "施設運用", globalShipping: "海外配送", utilization7d: "直近 7 日の実利用率", utilization30d: "直近 30 日の実利用率", noUtilization: "実データなし", truth: "実際の成約と有効な GPU 秒に基づいてのみカード時間が発生します。固定収益は保証せず、カード時間の出金・譲渡には対応しません。", requestQuote: "正式見積を取得", unavailable: "在庫と契約が未確認のため送信できません", emptyTitle: "申請可能な物理 GPU はありません", emptyBody: "サプライヤー商品と施設条件の確認前に購入可能な在庫を表示することはありません。" },
  ko: { errorTitle: "카탈로그를 일시적으로 사용할 수 없습니다", errorBody: "GPU 위탁운영 카탈로그를 불러올 수 없습니다. 잠시 후 다시 시도하세요.", errorTruth: "실제 서비스 결과를 허위 재고나 산출 데이터로 대체하지 않습니다.", loading: "검토된 실물 GPU 상품을 불러오는 중…", closedTitle: "GPU 클라우드 위탁운영은 아직 열리지 않았습니다", closedBody: "재고, 공급업체 계약, 시설 및 정산 정책이 모두 확인된 후에만 열립니다.", gpuModel: "GPU 모델", allModels: "모든 모델", reviewedProductUnit: "개 검토 상품 버전", productsAria: "검토된 실물 GPU 상품", catalogOnlyTitle: "현재 카탈로그와 견적 신청만 제공", catalogOnlyBody: "상품은 실시간 재고를 의미하지 않습니다. 공급업체가 일련번호, 은행 결제 및 인도 조건을 확인한 후 실물 자산이 생성됩니다.", vramQuote: "VRAM은 견적 시 확인", vramUnit: "GB VRAM", ownershipBadge: "GPU 전체 소유권", bankPrice: "공급업체 은행 가격", formalQuote: "정식 견적에서 확인", cardHourReference: "카드 시간 참고", cardHourUnit: "카드 시간", warranty: "하드웨어 보증", contractConfirmation: "계약에서 확인", monthUnit: "개월", estimatedDelivery: "예상 인도", supplierConfirmation: "공급업체 확인", dayUnit: "일", hostingFacility: "위탁운영 시설", quoteConfirmation: "견적 시 확인", deliveryChoice: "인도 선택", facilityHosting: "시설 위탁운영", globalShipping: "해외 배송", utilization7d: "최근 7일 실제 이용률", utilization30d: "최근 30일 실제 이용률", noUtilization: "실제 데이터 없음", truth: "실제 완료된 거래와 유효 GPU 초에 따라서만 카드 시간이 생성됩니다. 고정 수익을 약속하지 않으며 카드 시간 출금이나 양도를 지원하지 않습니다.", requestQuote: "정식 견적 받기", unavailable: "재고와 계약이 확인되지 않아 제출할 수 없습니다", emptyTitle: "신청 가능한 실물 GPU가 없습니다", emptyBody: "공급업체 상품과 시설 조건을 확인하기 전에는 구매 가능 재고를 표시하지 않습니다." },
  fr: { errorTitle: "Catalogue temporairement indisponible", errorBody: "Le catalogue de GPU gérés ne peut pas être chargé. Veuillez réessayer plus tard.", errorTruth: "La page ne remplace jamais les résultats réels par un stock ou des données de production fictifs.", loading: "Chargement des GPU physiques vérifiés…", closedTitle: "Le service de GPU gérés n’est pas encore ouvert", closedBody: "Il ouvrira uniquement après vérification complète du stock, des contrats fournisseurs, des centres et des politiques de règlement.", gpuModel: "Modèle de GPU", allModels: "Tous les modèles", reviewedProductUnit: "versions de produit vérifiées", productsAria: "GPU physiques vérifiés", catalogOnlyTitle: "Catalogue et demandes de devis uniquement", catalogOnlyBody: "Les produits ne représentent pas un stock en temps réel. Un actif physique est créé seulement après confirmation du numéro de série, du paiement bancaire et des conditions de livraison par le fournisseur.", vramQuote: "VRAM confirmée au devis", vramUnit: "Go de VRAM", ownershipBadge: "Propriété du GPU entier", bankPrice: "Prix bancaire fournisseur", formalQuote: "Confirmé dans le devis officiel", cardHourReference: "Référence en heures-carte", cardHourUnit: "heures-carte", warranty: "Garantie matérielle", contractConfirmation: "Confirmé au contrat", monthUnit: "mois", estimatedDelivery: "Livraison estimée", supplierConfirmation: "Confirmation du fournisseur", dayUnit: "jours", hostingFacility: "Centre d’hébergement", quoteConfirmation: "Confirmé au devis", deliveryChoice: "Choix de livraison", facilityHosting: "Hébergement en centre", globalShipping: "Expédition internationale", utilization7d: "Utilisation réelle sur 7 jours", utilization30d: "Utilisation réelle sur 30 jours", noUtilization: "Pas encore de données réelles", truth: "Les heures-carte proviennent uniquement de ventes effectivement réalisées et de secondes GPU valides. Aucun rendement fixe n’est promis ; elles ne sont ni retirables ni transférables.", requestQuote: "Obtenir un devis officiel", unavailable: "Stock et contrats non vérifiés ; envoi indisponible", emptyTitle: "Aucun GPU physique ne peut être demandé actuellement", emptyBody: "La plateforme n’affiche aucun stock achetable avant vérification des produits fournisseurs et des conditions du centre." },
  th: { errorTitle: "แคตตาล็อกไม่พร้อมใช้งานชั่วคราว", errorBody: "ไม่สามารถโหลดแคตตาล็อก GPU แบบดูแลได้ในขณะนี้ โปรดลองอีกครั้งภายหลัง", errorTruth: "หน้าจะไม่ใช้สต็อกหรือข้อมูลผลผลิตที่สมมติขึ้นแทนผลบริการจริง", loading: "กำลังโหลดสินค้า GPU จริงที่ผ่านการตรวจสอบ…", closedTitle: "GPU คลาวด์แบบดูแลยังไม่เปิดให้บริการ", closedBody: "จะเปิดเมื่อสต็อก สัญญาผู้ให้บริการ ศูนย์ และนโยบายการชำระได้รับการตรวจสอบครบถ้วนแล้วเท่านั้น", gpuModel: "รุ่น GPU", allModels: "ทุกรุ่น", reviewedProductUnit: "เวอร์ชันสินค้าที่ตรวจสอบแล้ว", productsAria: "สินค้า GPU จริงที่ตรวจสอบแล้ว", catalogOnlyTitle: "ขณะนี้เปิดเฉพาะแคตตาล็อกและการขอราคา", catalogOnlyBody: "สินค้าไม่ได้หมายถึงสต็อกแบบเรียลไทม์ สินทรัพย์จริงจะเกิดขึ้นหลังผู้ให้บริการยืนยันหมายเลขเครื่อง การชำระผ่านธนาคาร และเงื่อนไขส่งมอบ", vramQuote: "ยืนยัน VRAM ตอนเสนอราคา", vramUnit: "GB VRAM", ownershipBadge: "กรรมสิทธิ์ทั้งการ์ด", bankPrice: "ราคาธนาคารของผู้ให้บริการ", formalQuote: "ยืนยันในใบเสนอราคาอย่างเป็นทางการ", cardHourReference: "ชั่วโมงการ์ดอ้างอิง", cardHourUnit: "ชั่วโมงการ์ด", warranty: "ประกันฮาร์ดแวร์", contractConfirmation: "ยืนยันในสัญญา", monthUnit: "เดือน", estimatedDelivery: "คาดว่าจะส่งมอบ", supplierConfirmation: "ผู้ให้บริการยืนยัน", dayUnit: "วัน", hostingFacility: "ศูนย์ฝากดูแล", quoteConfirmation: "ยืนยันเมื่อเสนอราคา", deliveryChoice: "ตัวเลือกการส่งมอบ", facilityHosting: "ฝากดูแลในศูนย์", globalShipping: "จัดส่งทั่วโลก", utilization7d: "การใช้งานจริง 7 วันล่าสุด", utilization30d: "การใช้งานจริง 30 วันล่าสุด", noUtilization: "ยังไม่มีข้อมูลจริง", truth: "ชั่วโมงการ์ดเกิดจากยอดขายจริงที่เสร็จสมบูรณ์และวินาที GPU ที่ถูกต้องเท่านั้น ไม่รับประกันผลตอบแทนคงที่ และไม่รองรับการถอนหรือโอนชั่วโมงการ์ด", requestQuote: "รับใบเสนอราคาอย่างเป็นทางการ", unavailable: "ยังไม่ได้ตรวจสอบสต็อกและสัญญา จึงส่งคำขอไม่ได้", emptyTitle: "ขณะนี้ไม่มี GPU จริงที่ขอได้", emptyBody: "แพลตฟอร์มจะไม่แสดงสต็อกที่ซื้อได้ก่อนตรวจสอบสินค้าของผู้ให้บริการและเงื่อนไขศูนย์" },
  vi: { errorTitle: "Danh mục tạm thời không khả dụng", errorBody: "Hiện không thể tải danh mục GPU được quản lý. Vui lòng thử lại sau.", errorTruth: "Trang sẽ không thay thế kết quả dịch vụ thực bằng tồn kho hoặc dữ liệu sản lượng hư cấu.", loading: "Đang tải sản phẩm GPU vật lý đã được xét duyệt…", closedTitle: "GPU đám mây được quản lý chưa mở", closedBody: "Dịch vụ chỉ mở sau khi tồn kho, hợp đồng nhà cung cấp, cơ sở và chính sách quyết toán được xác minh đầy đủ.", gpuModel: "Mẫu GPU", allModels: "Tất cả mẫu", reviewedProductUnit: "phiên bản sản phẩm đã xét duyệt", productsAria: "Sản phẩm GPU vật lý đã xét duyệt", catalogOnlyTitle: "Hiện chỉ mở danh mục và yêu cầu báo giá", catalogOnlyBody: "Sản phẩm không đại diện cho tồn kho trực tiếp. Tài sản vật lý chỉ được tạo sau khi nhà cung cấp xác nhận số sê-ri, thanh toán ngân hàng và điều kiện bàn giao.", vramQuote: "VRAM xác nhận khi báo giá", vramUnit: "GB VRAM", ownershipBadge: "Quyền sở hữu toàn bộ GPU", bankPrice: "Giá ngân hàng của nhà cung cấp", formalQuote: "Xác nhận trong báo giá chính thức", cardHourReference: "Giờ-thẻ tham khảo", cardHourUnit: "giờ-thẻ", warranty: "Bảo hành phần cứng", contractConfirmation: "Xác nhận trong hợp đồng", monthUnit: "tháng", estimatedDelivery: "Dự kiến bàn giao", supplierConfirmation: "Nhà cung cấp xác nhận", dayUnit: "ngày", hostingFacility: "Cơ sở lưu trữ", quoteConfirmation: "Xác nhận khi báo giá", deliveryChoice: "Lựa chọn bàn giao", facilityHosting: "Lưu trữ tại cơ sở", globalShipping: "Giao hàng toàn cầu", utilization7d: "Mức sử dụng thực 7 ngày", utilization30d: "Mức sử dụng thực 30 ngày", noUtilization: "Chưa có dữ liệu thực", truth: "Giờ-thẻ chỉ được tạo từ giao dịch thực đã hoàn tất và số giây GPU hợp lệ. Không cam kết lợi nhuận cố định; giờ-thẻ không thể rút hoặc chuyển nhượng.", requestQuote: "Nhận báo giá chính thức", unavailable: "Tồn kho và hợp đồng chưa được xác minh; chưa thể gửi", emptyTitle: "Hiện không có GPU vật lý để yêu cầu", emptyBody: "Nền tảng không hiển thị tồn kho có thể mua trước khi xác minh sản phẩm nhà cung cấp và điều kiện cơ sở." },
  id: { errorTitle: "Katalog sementara tidak tersedia", errorBody: "Katalog GPU terkelola tidak dapat dimuat saat ini. Coba lagi nanti.", errorTruth: "Halaman tidak akan mengganti hasil layanan nyata dengan inventaris atau data hasil palsu.", loading: "Memuat produk GPU fisik yang telah ditinjau…", closedTitle: "Cloud GPU terkelola belum dibuka", closedBody: "Layanan hanya dibuka setelah inventaris, kontrak pemasok, fasilitas, dan kebijakan penyelesaian diverifikasi sepenuhnya.", gpuModel: "Model GPU", allModels: "Semua model", reviewedProductUnit: "versi produk ditinjau", productsAria: "Produk GPU fisik yang ditinjau", catalogOnlyTitle: "Saat ini hanya katalog dan permintaan penawaran", catalogOnlyBody: "Produk tidak mewakili inventaris langsung. Aset fisik dibuat setelah pemasok mengonfirmasi nomor seri, pembayaran bank, dan ketentuan penyerahan.", vramQuote: "VRAM dikonfirmasi saat penawaran", vramUnit: "GB VRAM", ownershipBadge: "Kepemilikan seluruh GPU", bankPrice: "Harga bank pemasok", formalQuote: "Dikonfirmasi dalam penawaran resmi", cardHourReference: "Referensi jam-kartu", cardHourUnit: "jam-kartu", warranty: "Garansi perangkat keras", contractConfirmation: "Dikonfirmasi dalam kontrak", monthUnit: "bulan", estimatedDelivery: "Perkiraan penyerahan", supplierConfirmation: "Konfirmasi pemasok", dayUnit: "hari", hostingFacility: "Fasilitas hosting", quoteConfirmation: "Dikonfirmasi saat penawaran", deliveryChoice: "Pilihan penyerahan", facilityHosting: "Hosting fasilitas", globalShipping: "Pengiriman global", utilization7d: "Utilisasi nyata 7 hari", utilization30d: "Utilisasi nyata 30 hari", noUtilization: "Belum ada data nyata", truth: "Jam-kartu hanya dihasilkan dari penjualan nyata yang selesai dan detik GPU yang valid. Tidak ada imbal hasil tetap yang dijanjikan; jam-kartu tidak dapat ditarik atau dialihkan.", requestQuote: "Dapatkan penawaran resmi", unavailable: "Inventaris dan kontrak belum diverifikasi; pengajuan tidak tersedia", emptyTitle: "Tidak ada GPU fisik yang dapat diajukan saat ini", emptyBody: "Platform tidak menampilkan inventaris yang dapat dibeli sebelum produk pemasok dan kondisi fasilitas diverifikasi." },
  ms: { errorTitle: "Katalog tidak tersedia buat sementara", errorBody: "Katalog GPU terurus tidak dapat dimuat sekarang. Cuba lagi kemudian.", errorTruth: "Halaman tidak akan menggantikan hasil perkhidmatan sebenar dengan inventori atau data hasil rekaan.", loading: "Memuatkan produk GPU fizikal yang telah disemak…", closedTitle: "Awan GPU terurus belum dibuka", closedBody: "Perkhidmatan hanya dibuka selepas inventori, kontrak pembekal, kemudahan dan dasar penyelesaian disahkan sepenuhnya.", gpuModel: "Model GPU", allModels: "Semua model", reviewedProductUnit: "versi produk disemak", productsAria: "Produk GPU fizikal yang disemak", catalogOnlyTitle: "Kini hanya katalog dan permohonan sebut harga", catalogOnlyBody: "Produk tidak mewakili inventori masa nyata. Aset fizikal diwujudkan selepas pembekal mengesahkan nombor siri, bayaran bank dan syarat penyerahan.", vramQuote: "VRAM disahkan semasa sebut harga", vramUnit: "GB VRAM", ownershipBadge: "Pemilikan seluruh GPU", bankPrice: "Harga bank pembekal", formalQuote: "Disahkan dalam sebut harga rasmi", cardHourReference: "Rujukan jam-kad", cardHourUnit: "jam-kad", warranty: "Waranti perkakasan", contractConfirmation: "Disahkan dalam kontrak", monthUnit: "bulan", estimatedDelivery: "Anggaran penyerahan", supplierConfirmation: "Pengesahan pembekal", dayUnit: "hari", hostingFacility: "Kemudahan pengehosan", quoteConfirmation: "Disahkan semasa sebut harga", deliveryChoice: "Pilihan penyerahan", facilityHosting: "Pengehosan kemudahan", globalShipping: "Penghantaran global", utilization7d: "Penggunaan sebenar 7 hari", utilization30d: "Penggunaan sebenar 30 hari", noUtilization: "Belum ada data sebenar", truth: "Jam-kad hanya terhasil daripada jualan sebenar yang selesai dan saat GPU yang sah. Tiada pulangan tetap dijanjikan; jam-kad tidak boleh dikeluarkan atau dipindah milik.", requestQuote: "Dapatkan sebut harga rasmi", unavailable: "Inventori dan kontrak belum disahkan; permohonan tidak tersedia", emptyTitle: "Tiada GPU fizikal yang boleh dipohon sekarang", emptyBody: "Platform tidak memaparkan inventori yang boleh dibeli sebelum produk pembekal dan keadaan kemudahan disahkan." },
} as const satisfies Record<Locale, ManagedGpuCatalogCopy>;

function formatUtilization(value: number | null, noData: string) {
  return value === null ? noData : `${(value / 100).toFixed(2)}%`;
}

export function ManagedGpuCatalog() {
  const { locale } = useLocale();
  const copy = CATALOG_COPY[locale];
  const [catalog, setCatalog] = useState<ManagedGpuCatalogEnvelope | null>(null);
  const [hasError, setHasError] = useState(false);
  const [model, setModel] = useState("ALL");

  useEffect(() => {
    const controller = new AbortController();
    readManagedGpuJson<ManagedGpuCatalogEnvelope>("/api/v1/managed-gpu/catalog", controller.signal)
      .then(setCatalog)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setHasError(true);
      });
    return () => controller.abort();
  }, []);

  const models = useMemo(() => Array.from(new Set(catalog?.records.map((record) => record.gpuModel) ?? [])).sort(), [catalog]);
  const records = catalog?.records.filter((record) => model === "ALL" || record.gpuModel === model) ?? [];

  if (hasError) return <section className={styles.state} role="alert"><h2>{copy.errorTitle}</h2><p>{copy.errorBody}</p><p>{copy.errorTruth}</p></section>;
  if (!catalog) return <section className={styles.state} role="status">{copy.loading}</section>;
  if (!catalog.enabled) return <section className={styles.state}><h2>{copy.closedTitle}</h2><p>{copy.closedBody}</p></section>;

  return <>
    <div className={styles.catalogBar}>
      <label><span>{copy.gpuModel}</span><select value={model} onChange={(event) => setModel(event.target.value)}><option value="ALL">{copy.allModels}</option>{models.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <p><strong>{records.length}</strong> {copy.reviewedProductUnit}</p>
    </div>
    {!catalog.available ? <div className={styles.notice}><strong>{copy.catalogOnlyTitle}</strong><span>{copy.catalogOnlyBody}</span></div> : null}
    {records.length ? <div className={styles.productGrid} aria-label={copy.productsAria}>{records.map((record) => {
      const facilityNames = record.facilityIds.map((id) => catalog.facilities.find((facility) => facility.id === id)?.name).filter(Boolean);
      return <article className={styles.productCard} key={record.id}>
        <div className={styles.productHead}><div><p>{record.sellerName}</p><h2>{record.gpuModel}</h2><span>{record.sku} · {record.vramGb === null ? copy.vramQuote : `${record.vramGb}${copy.vramUnit}`}</span></div><span className={styles.badge}>{copy.ownershipBadge}</span></div>
        <dl className={styles.facts}>
          <div><dt>{copy.bankPrice}</dt><dd>{record.unitPriceMinor === null || record.currency === null ? copy.formalQuote : formatMoneyMinor(record.unitPriceMinor, record.currency)}</dd></div>
          <div><dt>{copy.cardHourReference}</dt><dd>{record.cardHourReferenceMicros === null ? copy.formalQuote : `${formatCardHourDisplayMicros(record.cardHourReferenceMicros)} ${copy.cardHourUnit}`}</dd></div>
          <div><dt>{copy.warranty}</dt><dd>{record.warrantyMonths === null ? copy.contractConfirmation : `${record.warrantyMonths} ${copy.monthUnit}`}</dd></div>
          <div><dt>{copy.estimatedDelivery}</dt><dd>{record.estimatedDeliveryDays === null ? copy.supplierConfirmation : `${record.estimatedDeliveryDays} ${copy.dayUnit}`}</dd></div>
          <div><dt>{copy.hostingFacility}</dt><dd>{facilityNames.join("、") || copy.quoteConfirmation}</dd></div>
          <div><dt>{copy.deliveryChoice}</dt><dd>{record.fulfillmentModes.includes("BEIDOU_HOSTING") ? copy.facilityHosting : ""}{record.fulfillmentModes.length > 1 ? " / " : ""}{record.fulfillmentModes.includes("GLOBAL_SHIPPING") ? copy.globalShipping : ""}</dd></div>
        </dl>
        <div className={styles.utilization}><div><span>{copy.utilization7d}</span><strong>{formatUtilization(record.utilization7dBps, copy.noUtilization)}</strong></div><div><span>{copy.utilization30d}</span><strong>{formatUtilization(record.utilization30dBps, copy.noUtilization)}</strong></div></div>
        <p className={styles.truth}>{copy.truth}</p>
        {record.status === "AVAILABLE" ? <Link className={styles.primaryAction} href={`/managed-gpu/configure?product=${encodeURIComponent(record.id)}`}>{copy.requestQuote}</Link> : <span className={styles.disabledAction}>{copy.unavailable}</span>}
      </article>;
    })}</div> : <section className={styles.state}><h2>{copy.emptyTitle}</h2><p>{copy.emptyBody}</p></section>}
  </>;
}
