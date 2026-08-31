"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminApiError, adminGetDashboard, adminGetRows, type AdminRow } from "@/components/admin-api-client";
import { AdminPageHeader } from "@/components/admin-page-header";
import { AdminEmpty, AdminError, AdminLoading, AdminLoginRequired } from "@/components/admin-states";
import { useLocale } from "@/components/locale-provider";
import type { Locale } from "@/lib/i18n";

type Dashboard = Record<string, unknown>;

type MetricKey = "supply" | "verification" | "capacity" | "listing" | "demand" | "swap" | "order" | "delivery" | "metering" | "settlement" | "snapshot" | "work" | "refund";
type AdminDashboardCopy = {
  metrics: Record<MetricKey, string>;
  loading: string; refresh: string; description: string; kicker: string; title: string; loadingDashboard: string; loadError: string; timeoutError: string; networkError: string; invalidResponse: string; requestId: string; metricsAria: string; details: string;
  slaKicker: string; workTitle: string; allWork: string; noWorkDescription: string; noWorkTitle: string; unnamedWork: string; noObject: string; noSla: string;
  coverageKicker: string; coverageTitle: string; noCoverageDescription: string; noCoverageTitle: string;
  riskKicker: string; riskTitle: string; riskCenter: string; noRiskDescription: string; noRiskTitle: string; exception: string; unnamedException: string;
  noDashboardDescription: string; noDashboardTitle: string;
};

const COPY = {
  "zh-CN": { metrics: { supply: "供给记录", verification: "验真任务", capacity: "容量批次", listing: "有效挂牌", demand: "买方需求", swap: "容量置换", order: "订单记录", delivery: "交付任务", metering: "计量会话", settlement: "结算记录", snapshot: "KAI-SCH 快照", work: "开放待办", refund: "待审批退款" }, loading: "读取中…", refresh: "刷新总览", description: "从供应商上架、买方需求和验真，到匹配、支付、交付与异常的服务端运营视图。", kicker: "运营指挥中心", title: "运营总览", loadingDashboard: "正在读取管理员总览…", loadError: "暂时无法读取管理员总览。", timeoutError: "管理员总览请求超时，请稍后重试。", networkError: "无法连接管理员服务，请检查网络后重试。", invalidResponse: "管理员总览接口返回了无法识别的内容。", requestId: "请求编号", metricsAria: "关键运营指标", details: "查看明细", slaKicker: "SLA 队列", workTitle: "我的待办", allWork: "全部待办", noWorkDescription: "总览接口没有返回待办投影。", noWorkTitle: "没有待办数据", unnamedWork: "未命名待办", noObject: "未返回关联对象", noSla: "无 SLA", coverageKicker: "业务覆盖", coverageTitle: "业务对象覆盖", noCoverageDescription: "总览接口没有返回对象计数。", noCoverageTitle: "没有覆盖数据", riskKicker: "风险警报", riskTitle: "严重异常", riskCenter: "异常中心", noRiskDescription: "总览接口没有返回严重异常。", noRiskTitle: "没有异常投影", exception: "异常", unnamedException: "未命名异常", noDashboardDescription: "总览接口没有返回业务数据。", noDashboardTitle: "暂无管理员总览" },
  "zh-TW": { metrics: { supply: "供給記錄", verification: "驗真任務", capacity: "容量批次", listing: "有效掛牌", demand: "買方需求", swap: "容量置換", order: "訂單記錄", delivery: "交付任務", metering: "計量工作階段", settlement: "結算記錄", snapshot: "KAI-SCH 快照", work: "開放待辦", refund: "待審批退款" }, loading: "讀取中…", refresh: "重新整理總覽", description: "從供應商上架、買方需求和驗真，到媒合、支付、交付與異常的服務端營運視圖。", kicker: "營運指揮中心", title: "營運總覽", loadingDashboard: "正在讀取管理員總覽…", loadError: "暫時無法讀取管理員總覽。", timeoutError: "管理員總覽請求逾時，請稍後重試。", networkError: "無法連線管理員服務，請檢查網路後重試。", invalidResponse: "管理員總覽介面傳回無法識別的內容。", requestId: "請求編號", metricsAria: "關鍵營運指標", details: "查看明細", slaKicker: "SLA 佇列", workTitle: "我的待辦", allWork: "全部待辦", noWorkDescription: "總覽介面沒有傳回待辦投影。", noWorkTitle: "沒有待辦資料", unnamedWork: "未命名待辦", noObject: "未傳回關聯物件", noSla: "無 SLA", coverageKicker: "業務覆蓋", coverageTitle: "業務物件覆蓋", noCoverageDescription: "總覽介面沒有傳回物件計數。", noCoverageTitle: "沒有覆蓋資料", riskKicker: "風險警報", riskTitle: "嚴重異常", riskCenter: "異常中心", noRiskDescription: "總覽介面沒有傳回嚴重異常。", noRiskTitle: "沒有異常投影", exception: "異常", unnamedException: "未命名異常", noDashboardDescription: "總覽介面沒有傳回業務資料。", noDashboardTitle: "暫無管理員總覽" },
  en: { metrics: { supply: "Supply records", verification: "Verification tasks", capacity: "Capacity lots", listing: "Active listings", demand: "Buyer demand", swap: "Capacity swaps", order: "Orders", delivery: "Delivery tasks", metering: "Metering sessions", settlement: "Settlements", snapshot: "KAI-SCH snapshots", work: "Open work items", refund: "Refunds awaiting approval" }, loading: "Loading…", refresh: "Refresh overview", description: "A server-side operations view spanning supplier listings, buyer demand, verification, matching, payment, delivery, and exceptions.", kicker: "Operations command center", title: "Operations overview", loadingDashboard: "Loading administrator overview…", loadError: "The administrator overview is temporarily unavailable.", timeoutError: "The administrator overview request timed out. Try again later.", networkError: "Unable to reach the administrator service. Check your connection and try again.", invalidResponse: "The administrator overview returned an unrecognized response.", requestId: "Request ID", metricsAria: "Key operations metrics", details: "View details", slaKicker: "SLA queue", workTitle: "My work items", allWork: "All work items", noWorkDescription: "The overview did not return a work-item projection.", noWorkTitle: "No work-item data", unnamedWork: "Unnamed work item", noObject: "No related object", noSla: "No SLA", coverageKicker: "Coverage", coverageTitle: "Business object coverage", noCoverageDescription: "The overview did not return object counts.", noCoverageTitle: "No coverage data", riskKicker: "Risk alerts", riskTitle: "Critical exceptions", riskCenter: "Exception center", noRiskDescription: "The overview did not return critical exceptions.", noRiskTitle: "No exception projection", exception: "Exception", unnamedException: "Unnamed exception", noDashboardDescription: "The overview did not return business data.", noDashboardTitle: "No administrator overview" },
  ja: { metrics: { supply: "供給記録", verification: "検証タスク", capacity: "容量ロット", listing: "有効な掲載", demand: "買い手需要", swap: "容量交換", order: "注文記録", delivery: "納品タスク", metering: "計測セッション", settlement: "精算記録", snapshot: "KAI-SCH スナップショット", work: "未完了タスク", refund: "承認待ち返金" }, loading: "読み込み中…", refresh: "概要を更新", description: "サプライヤー掲載、買い手需要、検証からマッチング、支払い、納品、例外までを確認するサーバー運用ビューです。", kicker: "運用コマンドセンター", title: "運用概要", loadingDashboard: "管理者概要を読み込み中…", loadError: "管理者概要を一時的に読み込めません。", timeoutError: "管理者概要の要求がタイムアウトしました。後でもう一度お試しください。", networkError: "管理者サービスに接続できません。ネットワークを確認してください。", invalidResponse: "管理者概要から認識できない応答が返されました。", requestId: "リクエスト ID", metricsAria: "主要運用指標", details: "詳細を見る", slaKicker: "SLA キュー", workTitle: "自分のタスク", allWork: "すべてのタスク", noWorkDescription: "概要 API からタスク投影が返されませんでした。", noWorkTitle: "タスクデータなし", unnamedWork: "名称未設定タスク", noObject: "関連オブジェクトなし", noSla: "SLA なし", coverageKicker: "カバレッジ", coverageTitle: "業務オブジェクトのカバレッジ", noCoverageDescription: "概要 API からオブジェクト件数が返されませんでした。", noCoverageTitle: "カバレッジデータなし", riskKicker: "リスク警告", riskTitle: "重大な例外", riskCenter: "例外センター", noRiskDescription: "概要 API から重大な例外が返されませんでした。", noRiskTitle: "例外投影なし", exception: "例外", unnamedException: "名称未設定の例外", noDashboardDescription: "概要 API から業務データが返されませんでした。", noDashboardTitle: "管理者概要なし" },
  ko: { metrics: { supply: "공급 기록", verification: "검증 작업", capacity: "용량 로트", listing: "활성 등록", demand: "구매자 수요", swap: "용량 교환", order: "주문 기록", delivery: "인도 작업", metering: "계량 세션", settlement: "정산 기록", snapshot: "KAI-SCH 스냅샷", work: "미처리 작업", refund: "승인 대기 환불" }, loading: "불러오는 중…", refresh: "개요 새로고침", description: "공급자 등록, 구매자 수요와 검증부터 매칭, 결제, 인도 및 예외까지의 서버 운영 화면입니다.", kicker: "운영 지휘 센터", title: "운영 개요", loadingDashboard: "관리자 개요 불러오는 중…", loadError: "관리자 개요를 일시적으로 불러올 수 없습니다.", timeoutError: "관리자 개요 요청 시간이 초과되었습니다. 나중에 다시 시도하세요.", networkError: "관리자 서비스에 연결할 수 없습니다. 네트워크를 확인하세요.", invalidResponse: "관리자 개요에서 인식할 수 없는 응답이 반환되었습니다.", requestId: "요청 ID", metricsAria: "주요 운영 지표", details: "상세 보기", slaKicker: "SLA 대기열", workTitle: "내 작업", allWork: "모든 작업", noWorkDescription: "개요 API에서 작업 항목이 반환되지 않았습니다.", noWorkTitle: "작업 데이터 없음", unnamedWork: "이름 없는 작업", noObject: "관련 객체 없음", noSla: "SLA 없음", coverageKicker: "범위", coverageTitle: "비즈니스 객체 범위", noCoverageDescription: "개요 API에서 객체 수가 반환되지 않았습니다.", noCoverageTitle: "범위 데이터 없음", riskKicker: "위험 경고", riskTitle: "심각한 예외", riskCenter: "예외 센터", noRiskDescription: "개요 API에서 심각한 예외가 반환되지 않았습니다.", noRiskTitle: "예외 데이터 없음", exception: "예외", unnamedException: "이름 없는 예외", noDashboardDescription: "개요 API에서 비즈니스 데이터가 반환되지 않았습니다.", noDashboardTitle: "관리자 개요 없음" },
  fr: { metrics: { supply: "Offres fournisseurs", verification: "Tâches de vérification", capacity: "Lots de capacité", listing: "Annonces actives", demand: "Demandes acheteurs", swap: "Échanges de capacité", order: "Commandes", delivery: "Tâches de livraison", metering: "Sessions de mesure", settlement: "Règlements", snapshot: "Instantanés KAI-SCH", work: "Tâches ouvertes", refund: "Remboursements à approuver" }, loading: "Chargement…", refresh: "Actualiser la vue", description: "Vue opérationnelle serveur couvrant les offres, la demande, la vérification, la mise en relation, le paiement, la livraison et les exceptions.", kicker: "Centre de commande des opérations", title: "Vue d’ensemble des opérations", loadingDashboard: "Chargement de la vue administrateur…", loadError: "La vue administrateur est temporairement indisponible.", timeoutError: "La demande de vue administrateur a expiré. Réessayez plus tard.", networkError: "Impossible de joindre le service administrateur. Vérifiez le réseau.", invalidResponse: "La vue administrateur a renvoyé une réponse inconnue.", requestId: "ID de requête", metricsAria: "Indicateurs opérationnels clés", details: "Voir les détails", slaKicker: "File SLA", workTitle: "Mes tâches", allWork: "Toutes les tâches", noWorkDescription: "La vue n’a renvoyé aucune projection de tâches.", noWorkTitle: "Aucune donnée de tâche", unnamedWork: "Tâche sans nom", noObject: "Aucun objet associé", noSla: "Aucun SLA", coverageKicker: "Couverture", coverageTitle: "Couverture des objets métier", noCoverageDescription: "La vue n’a renvoyé aucun nombre d’objets.", noCoverageTitle: "Aucune donnée de couverture", riskKicker: "Alertes de risque", riskTitle: "Exceptions critiques", riskCenter: "Centre des exceptions", noRiskDescription: "La vue n’a renvoyé aucune exception critique.", noRiskTitle: "Aucune projection d’exception", exception: "Exception", unnamedException: "Exception sans nom", noDashboardDescription: "La vue n’a renvoyé aucune donnée métier.", noDashboardTitle: "Aucune vue administrateur" },
  th: { metrics: { supply: "รายการอุปทาน", verification: "งานตรวจสอบ", capacity: "ชุดความจุ", listing: "รายการที่ใช้งาน", demand: "ความต้องการผู้ซื้อ", swap: "แลกเปลี่ยนความจุ", order: "คำสั่งซื้อ", delivery: "งานส่งมอบ", metering: "เซสชันการวัด", settlement: "รายการชำระ", snapshot: "สแนปชอต KAI-SCH", work: "งานที่เปิดอยู่", refund: "คืนเงินรออนุมัติ" }, loading: "กำลังโหลด…", refresh: "รีเฟรชภาพรวม", description: "มุมมองปฏิบัติการฝั่งเซิร์ฟเวอร์ ตั้งแต่รายการผู้ให้บริการ ความต้องการ การตรวจสอบ การจับคู่ การชำระ การส่งมอบ และข้อยกเว้น", kicker: "ศูนย์บัญชาการปฏิบัติการ", title: "ภาพรวมปฏิบัติการ", loadingDashboard: "กำลังโหลดภาพรวมผู้ดูแล…", loadError: "ไม่สามารถโหลดภาพรวมผู้ดูแลได้ชั่วคราว", timeoutError: "คำขอภาพรวมผู้ดูแลหมดเวลา โปรดลองใหม่ภายหลัง", networkError: "เชื่อมต่อบริการผู้ดูแลไม่ได้ โปรดตรวจสอบเครือข่าย", invalidResponse: "ภาพรวมผู้ดูแลส่งคืนข้อมูลที่ไม่รู้จัก", requestId: "รหัสคำขอ", metricsAria: "ตัวชี้วัดปฏิบัติการสำคัญ", details: "ดูรายละเอียด", slaKicker: "คิว SLA", workTitle: "งานของฉัน", allWork: "งานทั้งหมด", noWorkDescription: "ภาพรวมไม่ได้ส่งคืนข้อมูลงาน", noWorkTitle: "ไม่มีข้อมูลงาน", unnamedWork: "งานไม่มีชื่อ", noObject: "ไม่มีวัตถุที่เกี่ยวข้อง", noSla: "ไม่มี SLA", coverageKicker: "ความครอบคลุม", coverageTitle: "ความครอบคลุมวัตถุธุรกิจ", noCoverageDescription: "ภาพรวมไม่ได้ส่งคืนจำนวนวัตถุ", noCoverageTitle: "ไม่มีข้อมูลความครอบคลุม", riskKicker: "การแจ้งเตือนความเสี่ยง", riskTitle: "ข้อยกเว้นร้ายแรง", riskCenter: "ศูนย์ข้อยกเว้น", noRiskDescription: "ภาพรวมไม่ได้ส่งคืนข้อยกเว้นร้ายแรง", noRiskTitle: "ไม่มีข้อมูลข้อยกเว้น", exception: "ข้อยกเว้น", unnamedException: "ข้อยกเว้นไม่มีชื่อ", noDashboardDescription: "ภาพรวมไม่ได้ส่งคืนข้อมูลธุรกิจ", noDashboardTitle: "ไม่มีภาพรวมผู้ดูแล" },
  vi: { metrics: { supply: "Bản ghi nguồn cung", verification: "Tác vụ xác minh", capacity: "Lô dung lượng", listing: "Đăng bán hiệu lực", demand: "Nhu cầu người mua", swap: "Hoán đổi dung lượng", order: "Đơn hàng", delivery: "Tác vụ bàn giao", metering: "Phiên đo lường", settlement: "Quyết toán", snapshot: "Ảnh chụp KAI-SCH", work: "Việc đang mở", refund: "Hoàn tiền chờ duyệt" }, loading: "Đang tải…", refresh: "Làm mới tổng quan", description: "Góc nhìn vận hành phía máy chủ từ đăng bán, nhu cầu và xác minh đến ghép nối, thanh toán, bàn giao và ngoại lệ.", kicker: "Trung tâm điều hành", title: "Tổng quan vận hành", loadingDashboard: "Đang tải tổng quan quản trị…", loadError: "Tạm thời không thể tải tổng quan quản trị.", timeoutError: "Yêu cầu tổng quan quản trị đã hết thời gian. Hãy thử lại sau.", networkError: "Không thể kết nối dịch vụ quản trị. Hãy kiểm tra mạng.", invalidResponse: "Tổng quan quản trị trả về phản hồi không nhận dạng được.", requestId: "Mã yêu cầu", metricsAria: "Chỉ số vận hành chính", details: "Xem chi tiết", slaKicker: "Hàng đợi SLA", workTitle: "Việc của tôi", allWork: "Tất cả công việc", noWorkDescription: "Tổng quan không trả về dữ liệu công việc.", noWorkTitle: "Không có dữ liệu công việc", unnamedWork: "Công việc chưa đặt tên", noObject: "Không có đối tượng liên quan", noSla: "Không có SLA", coverageKicker: "Phạm vi", coverageTitle: "Phạm vi đối tượng nghiệp vụ", noCoverageDescription: "Tổng quan không trả về số lượng đối tượng.", noCoverageTitle: "Không có dữ liệu phạm vi", riskKicker: "Cảnh báo rủi ro", riskTitle: "Ngoại lệ nghiêm trọng", riskCenter: "Trung tâm ngoại lệ", noRiskDescription: "Tổng quan không trả về ngoại lệ nghiêm trọng.", noRiskTitle: "Không có dữ liệu ngoại lệ", exception: "Ngoại lệ", unnamedException: "Ngoại lệ chưa đặt tên", noDashboardDescription: "Tổng quan không trả về dữ liệu nghiệp vụ.", noDashboardTitle: "Chưa có tổng quan quản trị" },
  id: { metrics: { supply: "Catatan pasokan", verification: "Tugas verifikasi", capacity: "Lot kapasitas", listing: "Daftar aktif", demand: "Permintaan pembeli", swap: "Pertukaran kapasitas", order: "Pesanan", delivery: "Tugas pengiriman", metering: "Sesi pengukuran", settlement: "Penyelesaian", snapshot: "Snapshot KAI-SCH", work: "Tugas terbuka", refund: "Refund menunggu persetujuan" }, loading: "Memuat…", refresh: "Segarkan ringkasan", description: "Tampilan operasi sisi server dari daftar pemasok, permintaan dan verifikasi hingga pencocokan, pembayaran, pengiriman, dan pengecualian.", kicker: "Pusat kendali operasi", title: "Ringkasan operasi", loadingDashboard: "Memuat ringkasan administrator…", loadError: "Ringkasan administrator sementara tidak tersedia.", timeoutError: "Permintaan ringkasan administrator habis waktu. Coba lagi nanti.", networkError: "Tidak dapat terhubung ke layanan administrator. Periksa jaringan.", invalidResponse: "Ringkasan administrator mengembalikan respons yang tidak dikenal.", requestId: "ID permintaan", metricsAria: "Metrik operasi utama", details: "Lihat detail", slaKicker: "Antrean SLA", workTitle: "Tugas saya", allWork: "Semua tugas", noWorkDescription: "Ringkasan tidak mengembalikan proyeksi tugas.", noWorkTitle: "Tidak ada data tugas", unnamedWork: "Tugas tanpa nama", noObject: "Tidak ada objek terkait", noSla: "Tanpa SLA", coverageKicker: "Cakupan", coverageTitle: "Cakupan objek bisnis", noCoverageDescription: "Ringkasan tidak mengembalikan jumlah objek.", noCoverageTitle: "Tidak ada data cakupan", riskKicker: "Peringatan risiko", riskTitle: "Pengecualian kritis", riskCenter: "Pusat pengecualian", noRiskDescription: "Ringkasan tidak mengembalikan pengecualian kritis.", noRiskTitle: "Tidak ada proyeksi pengecualian", exception: "Pengecualian", unnamedException: "Pengecualian tanpa nama", noDashboardDescription: "Ringkasan tidak mengembalikan data bisnis.", noDashboardTitle: "Tidak ada ringkasan administrator" },
  ms: { metrics: { supply: "Rekod bekalan", verification: "Tugas pengesahan", capacity: "Lot kapasiti", listing: "Penyenaraian aktif", demand: "Permintaan pembeli", swap: "Pertukaran kapasiti", order: "Pesanan", delivery: "Tugas penghantaran", metering: "Sesi pengukuran", settlement: "Penyelesaian", snapshot: "Syot kilat KAI-SCH", work: "Tugas terbuka", refund: "Bayaran balik menunggu kelulusan" }, loading: "Memuatkan…", refresh: "Segar semula ringkasan", description: "Paparan operasi pelayan daripada penyenaraian pembekal, permintaan dan pengesahan hingga padanan, pembayaran, penghantaran dan pengecualian.", kicker: "Pusat arahan operasi", title: "Ringkasan operasi", loadingDashboard: "Memuatkan ringkasan pentadbir…", loadError: "Ringkasan pentadbir tidak tersedia buat sementara.", timeoutError: "Permintaan ringkasan pentadbir tamat masa. Cuba lagi kemudian.", networkError: "Tidak dapat menghubungi perkhidmatan pentadbir. Semak rangkaian.", invalidResponse: "Ringkasan pentadbir mengembalikan respons tidak dikenali.", requestId: "ID permintaan", metricsAria: "Metrik operasi utama", details: "Lihat butiran", slaKicker: "Baris gilir SLA", workTitle: "Tugas saya", allWork: "Semua tugas", noWorkDescription: "Ringkasan tidak mengembalikan unjuran tugas.", noWorkTitle: "Tiada data tugas", unnamedWork: "Tugas tanpa nama", noObject: "Tiada objek berkaitan", noSla: "Tiada SLA", coverageKicker: "Liputan", coverageTitle: "Liputan objek perniagaan", noCoverageDescription: "Ringkasan tidak mengembalikan kiraan objek.", noCoverageTitle: "Tiada data liputan", riskKicker: "Amaran risiko", riskTitle: "Pengecualian kritikal", riskCenter: "Pusat pengecualian", noRiskDescription: "Ringkasan tidak mengembalikan pengecualian kritikal.", noRiskTitle: "Tiada unjuran pengecualian", exception: "Pengecualian", unnamedException: "Pengecualian tanpa nama", noDashboardDescription: "Ringkasan tidak mengembalikan data perniagaan.", noDashboardTitle: "Tiada ringkasan pentadbir" },
} satisfies Record<Locale, AdminDashboardCopy>;

function nested(data: Dashboard, paths: string[]) {
  for (const path of paths) {
    let current: unknown = data;
    for (const part of path.split(".")) {
      if (!current || typeof current !== "object" || Array.isArray(current)) { current = undefined; break; }
      current = (current as Record<string, unknown>)[part];
    }
    if (current !== undefined && current !== null) return current;
  }
  return undefined;
}

function numberText(value: unknown, locale: Locale, money = false, percent = false) {
  if (typeof value !== "number") return "—";
  if (money) return `¥${(value / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (percent) return `${value.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
  return value.toLocaleString(locale);
}

function dateTime(value: unknown, locale: Locale, fallback: string) {
  if (typeof value !== "string") return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
}

function dashboardErrorMessage(error: unknown, copy: AdminDashboardCopy) {
  if (!(error instanceof AdminApiError)) return copy.loadError;
  const message = error.code === "REQUEST_TIMEOUT"
    ? copy.timeoutError
    : error.code === "NETWORK_ERROR"
      ? copy.networkError
      : error.code === "INVALID_RESPONSE"
        ? copy.invalidResponse
        : copy.loadError;
  return `${message}${error.requestId ? ` (${copy.requestId}: ${error.requestId})` : ""}`;
}

function objectRows(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

const metrics = [
  { key: "supply", paths: ["counts.supply-offers"], href: "/admin/supply-offers" },
  { key: "verification", paths: ["counts.verifications"], href: "/admin/verifications" },
  { key: "capacity", paths: ["counts.capacity-lots"], href: "/admin/capacity-lots" },
  { key: "listing", paths: ["counts.listings"], href: "/admin/listings" },
  { key: "demand", paths: ["counts.demands"], href: "/admin/demands" },
  { key: "swap", paths: ["counts.swaps"], href: "/admin/swaps" },
  { key: "order", paths: ["counts.orders"], href: "/admin/orders" },
  { key: "delivery", paths: ["counts.delivery"], href: "/admin/delivery" },
  { key: "metering", paths: ["counts.metering"], href: "/admin/metering" },
  { key: "settlement", paths: ["counts.settlements"], href: "/admin/settlements" },
  { key: "snapshot", paths: ["counts.standardization"], href: "/admin/standardization" },
  { key: "work", paths: ["openWorkItems"], href: "/admin/work-items" },
  { key: "refund", paths: ["pendingRefundApprovals"], href: "/admin/payments/refunds", critical: true },
] as const;

async function dashboardBundle() {
  const [dashboard, workItems] = await Promise.all([
    adminGetDashboard(),
    adminGetRows({ path: "/api/v1/admin/work-items" }),
  ]);
  return { dashboard, workItems };
}

export function AdminDashboard() {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const [data, setData] = useState<Dashboard | null>(null);
  const [workItems, setWorkItems] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { const result = await dashboardBundle(); setData(result.dashboard); setWorkItems(result.workItems); } catch (loadError) { setError(loadError); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void dashboardBundle()
      .then((result) => { if (!cancelled) { setData(result.dashboard); setWorkItems(result.workItems); } })
      .catch((loadError: unknown) => { if (!cancelled) setError(loadError); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (error instanceof AdminApiError && [401, 403].includes(error.status)) return <AdminLoginRequired forbidden={error.status === 403} />;

  const exceptions = data ? objectRows(nested(data, ["exceptions", "criticalExceptions", "alerts"])) : [];
  const funnel = data && nested(data, ["counts"]);
  const funnelEntries = funnel && typeof funnel === "object" && !Array.isArray(funnel)
    ? Object.entries(funnel as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number")
    : [];

  return (
    <div className="admin-page">
      <AdminPageHeader
        actions={<button className="admin-button secondary" disabled={loading} onClick={() => void load()} type="button">{loading ? copy.loading : copy.refresh}</button>}
        description={copy.description}
        kicker={copy.kicker}
        title={copy.title}
      />

      {loading && !data ? <AdminLoading label={copy.loadingDashboard} /> : null}
      {error ? <AdminError message={dashboardErrorMessage(error, copy)} onRetry={() => void load()} /> : null}

      {data ? (
        <>
          <section className="admin-metric-grid" aria-label={copy.metricsAria}>
            {metrics.map((metric) => (
              <Link className={"critical" in metric && metric.critical ? "critical" : ""} href={metric.href} key={metric.key}>
                <span>{copy.metrics[metric.key]}</span>
                <strong>{numberText(nested(data, [...metric.paths]), locale)}</strong>
                <small>{copy.details} →</small>
              </Link>
            ))}
          </section>

          <div className="admin-dashboard-grid">
            <section className="admin-panel admin-panel-wide" aria-labelledby="admin-work-title">
              <div className="admin-panel-head"><div><p className="admin-kicker">{copy.slaKicker}</p><h2 id="admin-work-title">{copy.workTitle}</h2></div><Link href="/admin/work-items">{copy.allWork}</Link></div>
              {workItems.length === 0 ? <AdminEmpty description={copy.noWorkDescription} title={copy.noWorkTitle} /> : (
                <div className="admin-compact-list">{workItems.slice(0, 6).map((item, index) => <article key={String(item.id ?? index)}><div><strong>{String(item.title ?? item.summary ?? item.type ?? copy.unnamedWork)}</strong><span>{String(item.objectId ?? item.targetId ?? copy.noObject)}</span></div><div><b>{String(item.priority ?? item.severity ?? "—")}</b><time>{dateTime(item.dueAt, locale, copy.noSla)}</time></div></article>)}</div>
              )}
            </section>

            <section className="admin-panel" aria-labelledby="admin-funnel-title">
              <div className="admin-panel-head"><div><p className="admin-kicker">{copy.coverageKicker}</p><h2 id="admin-funnel-title">{copy.coverageTitle}</h2></div></div>
              {funnelEntries.length === 0 ? <AdminEmpty description={copy.noCoverageDescription} title={copy.noCoverageTitle} /> : <ol className="admin-funnel">{funnelEntries.map(([label, value], index) => <li key={label}><span>{String(index + 1).padStart(2, "0")}</span><strong>{label}</strong><b>{value.toLocaleString(locale)}</b></li>)}</ol>}
            </section>

            <section className="admin-panel" aria-labelledby="admin-exception-title">
              <div className="admin-panel-head"><div><p className="admin-kicker">{copy.riskKicker}</p><h2 id="admin-exception-title">{copy.riskTitle}</h2></div><Link href="/admin/exceptions">{copy.riskCenter}</Link></div>
              {exceptions.length === 0 ? <AdminEmpty description={copy.noRiskDescription} title={copy.noRiskTitle} /> : <div className="admin-alert-list">{exceptions.slice(0, 6).map((item, index) => <article key={String(item.id ?? item.code ?? index)}><span>{String(item.severity ?? item.priority ?? copy.exception)}</span><div><strong>{String(item.title ?? item.summary ?? item.message ?? copy.unnamedException)}</strong><small>{String(item.objectId ?? item.orderId ?? item.code ?? "—")}</small></div></article>)}</div>}
            </section>
          </div>
        </>
      ) : !loading && !error ? <AdminEmpty description={copy.noDashboardDescription} title={copy.noDashboardTitle} /> : null}
    </div>
  );
}
