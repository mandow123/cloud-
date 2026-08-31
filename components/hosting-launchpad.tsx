"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import type { HostingReadinessEnvelope, PublicHostingOffer, PublicHostingReadiness } from "@/lib/hosting-v2-client";
import { formatCardHours } from "@/lib/hosting-v2-client";
import type { Locale } from "@/lib/i18n";
import styles from "./hosting-public.module.css";

type AccountEnvelope = Readonly<{
  authenticated?: boolean;
  account?: Readonly<{ displayName?: string }> | null;
  organization?: Readonly<{ name?: string }> | null;
}>;

type LaunchpadState = Readonly<{
  readiness: PublicHostingReadiness;
  release: string;
  offers: readonly PublicHostingOffer[];
  account: AccountEnvelope;
  localAcceptance: boolean;
}>;

type LaunchCopy = {
  modes: Record<PublicHostingReadiness["rolloutMode"], string>; checks: readonly string[];
  error: readonly [string, string, string, string]; header: readonly [string, string, string, string, string];
  actions: readonly [readonly [string, string, string], readonly [string, string, string], readonly [string, string, string], readonly [string, string, string, string, string]];
  metrics: readonly [string, string, string, string, string, string, string, string, string, string, string, string];
  readiness: readonly [string, string, string, string, string, string, string]; offers: readonly [string, string, string, string, string];
};

const checkKeys = ["supplierIdentity", "agentDelivery", "feeSchedule", "cardHourLedger", "approvedImages", "metering", "cleanup", "alipayClosed"] as const;
const LAUNCH_COPY: Record<Locale, LaunchCopy> = {
  "zh-CN": { modes: { DISABLED: "尚未开放", SETUP: "预上线配置", INTERNAL_AGENT_TRIAL: "邀请制试运营" }, checks: ["统一身份与供应主体", "真实 Host Agent", "有效费率版本", "卡时锁定与结算账本", "审核交付镜像", "真实计量", "撤权与清理", "公开充值保持关闭"], error: ["Hosting 状态未知", "实时状态暂时无法读取。平台不会在状态未知时开放成交。", "重新读取", "正在同步报价、Agent 与结算状态…"], header: ["实时控制面", "从一个真实动作开始", "租用、上架、履约与结算共用同一份设备证据、合同快照和卡时账本。", "当前运行阶段", "本地验收 · 非生产供给"], actions: [["租用 GPU", "筛选验真报价，锁定卡时并启动实例。", "暂无真实机器在线"], ["上架一张 GPU", "完成主体审核、Agent 配对和硬件验真。", "个已审核供应主体"], ["管理资源与订单", "查看设备、报价、履约、异常和清理证据。", "台有效 Host Agent"], ["查看卡时收益", "核对租金、佣金、锁定、释放和结算账目。", "当前交易主体", "登录后查看", "LIVE"]], metrics: ["公开报价", "只统计当前可成交", "审核供应主体", "服务端审核结果", "有效 Agent", "在线且验真有效", "异常清理", "非零时禁止再售", "实时运营指标", "平台成交边界", "可进入真实交付", "查看当前限制"], readiness: ["成交就绪检查", "本地验收允许跑通交互和状态机，但不计作真实 GPU 或生产成交。", "所有关键项已经就绪，新订单可以进入真实交付。", "任一关键项未就绪时，公开成交保持关闭；页面不会用模拟资源冒充真实供给。", "当前真实报价", "查看全部", "查看并租用"], offers: ["KAI 标准卡时 / GPU 小时", "Release", "READY", "CLOSED", "当前组织"] },
  "zh-TW": { modes: { DISABLED: "尚未開放", SETUP: "預上線設定", INTERNAL_AGENT_TRIAL: "邀請制試營運" }, checks: ["統一身分與供應主體", "真實 Host Agent", "有效費率版本", "卡時鎖定與結算帳本", "審核交付映像", "真實計量", "撤權與清理", "公開儲值保持關閉"], error: ["Hosting 狀態未知", "暫時無法讀取即時狀態。狀態未知時不會開放成交。", "重新讀取", "正在同步報價、Agent 與結算狀態…"], header: ["即時控制面", "從一個真實動作開始", "租用、上架、履約與結算共用相同的裝置證據、合約快照與卡時帳本。", "目前運行階段", "本機驗收 · 非生產供給"], actions: [["租用 GPU", "篩選驗真報價，鎖定卡時並啟動執行個體。", "暫無真實機器上線"], ["上架一張 GPU", "完成主體審核、Agent 配對與硬體驗真。", "個已審核供應主體"], ["管理資源與訂單", "查看裝置、報價、履約、異常與清理證據。", "台有效 Host Agent"], ["查看卡時收益", "核對租金、佣金、鎖定、釋放與結算帳目。", "目前交易主體", "登入後查看", "LIVE"]], metrics: ["公開報價", "僅統計目前可成交", "審核供應主體", "伺服器審核結果", "有效 Agent", "線上且驗真有效", "異常清理", "非零時禁止再售", "即時營運指標", "平台成交邊界", "可進入真實交付", "查看目前限制"], readiness: ["成交就緒檢查", "本機驗收可跑通互動與狀態機，但不計作真實 GPU 或生產成交。", "所有關鍵項已就緒，新訂單可進入真實交付。", "任一關鍵項未就緒時公開成交保持關閉，不會用模擬資源冒充真實供給。", "目前真實報價", "查看全部", "查看並租用"], offers: ["KAI 標準卡時 / GPU 小時", "Release", "READY", "CLOSED", "目前組織"] },
  en: { modes: { DISABLED: "Not open", SETUP: "Pre-launch setup", INTERNAL_AGENT_TRIAL: "Invite-only trial" }, checks: ["Unified identity and supplier", "Real Host Agent", "Active fee schedule", "Card-hour hold and settlement ledger", "Approved delivery images", "Real metering", "Revocation and cleanup", "Public top-up stays closed"], error: ["Hosting status unknown", "Live status is temporarily unavailable. Transactions remain closed while status is unknown.", "Try again", "Synchronizing offers, Agents, and settlement…"], header: ["LIVE CONTROL PLANE", "Start with one real action", "Renting, listing, fulfillment, and settlement share the same device evidence, contract snapshot, and card-hour ledger.", "Current operating stage", "Local acceptance · not production supply"], actions: [["Rent a GPU", "Filter verified offers, hold card-hours, and launch an instance.", "No real machines online"], ["List a GPU", "Complete supplier review, Agent pairing, and hardware verification.", "approved suppliers"], ["Manage resources and orders", "Review devices, offers, fulfillment, incidents, and cleanup evidence.", "active Host Agents"], ["View card-hour earnings", "Reconcile rent, commission, holds, releases, and settlement.", "Current transaction entity", "Sign in to view", "LIVE"]], metrics: ["Public offers", "Currently transactable only", "Approved suppliers", "Server review result", "Active Agents", "Online and verified", "Cleanup incidents", "Non-zero blocks resale", "Live operations metrics", "Platform transaction boundary", "Ready for real delivery", "View current limits"], readiness: ["Transaction readiness checks", "Local acceptance exercises interactions and state machines but is not real GPU supply or a production transaction.", "All critical items are ready. New orders may enter real delivery.", "If any critical item is unavailable, public transactions remain closed; simulated resources are never presented as real supply.", "Current real offers", "View all", "View and rent"], offers: ["KAI standard card-hours / GPU hour", "Release", "READY", "CLOSED", "Current organization"] },
  ja: { modes: { DISABLED: "未公開", SETUP: "公開前設定", INTERNAL_AGENT_TRIAL: "招待制試運用" }, checks: ["統一IDと供給者", "実Host Agent", "有効な手数料版", "カード時間ロックと決済台帳", "承認済み納品イメージ", "実計測", "権限撤回と清掃", "公開入金は閉鎖"], error: ["Hosting 状態不明", "リアルタイム状態を取得できません。状態不明時は取引を開放しません。", "再読み込み", "見積、Agent、決済状態を同期中…"], header: ["リアルタイム制御面", "1つの実動作から開始", "貸出、掲載、履行、決済は同じデバイス証拠、契約スナップショット、台帳を利用します。", "現在の運用段階", "ローカル検収 · 非本番供給"], actions: [["GPUを借りる", "検証済み見積を選び、カード時間を確保して起動します。", "実機はオンラインではありません"], ["GPUを掲載", "供給者審査、Agent接続、ハードウェア検証を完了します。", "承認済み供給者"], ["資源と注文を管理", "デバイス、見積、履行、異常、清掃証拠を確認します。", "有効なHost Agent"], ["カード時間収益を見る", "賃料、手数料、ロック、解放、決済を照合します。", "現在の取引主体", "ログインして表示", "LIVE"]], metrics: ["公開見積", "現在取引可能なもののみ", "承認済み供給者", "サーバー審査結果", "有効Agent", "オンライン・検証済み", "清掃異常", "0以外は再販禁止", "リアルタイム運用指標", "取引境界", "実納品へ進行可能", "現在の制限を見る"], readiness: ["取引準備チェック", "ローカル検収は操作と状態機械の確認用で、実GPUや本番取引ではありません。", "全重要項目が準備済みです。新規注文は実納品に進めます。", "重要項目が1つでも未準備なら公開取引は閉鎖し、模擬資源を実供給として表示しません。", "現在の実見積", "すべて見る", "確認して借りる"], offers: ["KAI標準カード時間 / GPU時間", "Release", "READY", "CLOSED", "現在の組織"] },
  ko: { modes: { DISABLED: "미공개", SETUP: "출시 전 설정", INTERNAL_AGENT_TRIAL: "초대 전용 시험 운영" }, checks: ["통합 신원 및 공급자", "실제 Host Agent", "유효 수수료 버전", "카드시간 잠금 및 정산 원장", "승인된 인도 이미지", "실제 계량", "권한 회수 및 정리", "공개 충전 닫힘"], error: ["Hosting 상태 알 수 없음", "실시간 상태를 읽을 수 없습니다. 상태가 불명확하면 거래를 열지 않습니다.", "다시 불러오기", "견적, Agent 및 정산 상태 동기화 중…"], header: ["실시간 제어면", "하나의 실제 작업부터 시작", "대여, 등록, 이행 및 정산은 동일한 장치 증거, 계약 스냅샷 및 카드시간 원장을 사용합니다.", "현재 운영 단계", "로컬 검수 · 비프로덕션 공급"], actions: [["GPU 대여", "검증 견적을 선택하고 카드시간을 잠근 뒤 인스턴스를 시작합니다.", "온라인 실제 장비 없음"], ["GPU 등록", "공급자 검토, Agent 페어링 및 하드웨어 검증을 완료합니다.", "승인된 공급자"], ["리소스 및 주문 관리", "장치, 견적, 이행, 이상 및 정리 증거를 확인합니다.", "유효한 Host Agent"], ["카드시간 수익 보기", "임대료, 수수료, 잠금, 해제 및 정산을 대조합니다.", "현재 거래 주체", "로그인 후 보기", "LIVE"]], metrics: ["공개 견적", "현재 거래 가능 항목만", "승인 공급자", "서버 검토 결과", "유효 Agent", "온라인 및 검증됨", "정리 이상", "0이 아니면 재판매 금지", "실시간 운영 지표", "거래 경계", "실제 인도 가능", "현재 제한 보기"], readiness: ["거래 준비 점검", "로컬 검수는 상호작용과 상태 머신만 확인하며 실제 GPU나 프로덕션 거래가 아닙니다.", "모든 핵심 항목이 준비되었습니다. 신규 주문이 실제 인도로 진행될 수 있습니다.", "핵심 항목이 미준비면 공개 거래를 닫고 모의 리소스를 실제 공급으로 표시하지 않습니다.", "현재 실제 견적", "모두 보기", "확인 및 대여"], offers: ["KAI 표준 카드시간 / GPU 시간", "Release", "READY", "CLOSED", "현재 조직"] },
  fr: { modes: { DISABLED: "Non ouvert", SETUP: "Configuration avant lancement", INTERNAL_AGENT_TRIAL: "Essai sur invitation" }, checks: ["Identité et fournisseur unifiés", "Host Agent réel", "Barème actif", "Blocage et registre des heures-carte", "Images de livraison approuvées", "Mesure réelle", "Révocation et nettoyage", "Recharge publique fermée"], error: ["Statut Hosting inconnu", "Le statut temps réel est indisponible. Les transactions restent fermées tant qu’il est inconnu.", "Réessayer", "Synchronisation des offres, Agents et règlements…"], header: ["PLAN DE CONTRÔLE EN DIRECT", "Commencer par une action réelle", "Location, publication, exécution et règlement partagent les mêmes preuves, instantané de contrat et registre.", "Phase actuelle", "Réception locale · hors production"], actions: [["Louer un GPU", "Filtrer les offres vérifiées, bloquer les heures-carte et lancer une instance.", "Aucune machine réelle en ligne"], ["Publier un GPU", "Terminer l’examen, l’association Agent et la vérification matérielle.", "fournisseurs approuvés"], ["Gérer ressources et commandes", "Voir appareils, offres, exécution, incidents et preuves de nettoyage.", "Host Agents actifs"], ["Voir les revenus", "Rapprocher loyer, commission, blocages, libérations et règlements.", "Entité de transaction actuelle", "Se connecter pour voir", "LIVE"]], metrics: ["Offres publiques", "Actuellement négociables seulement", "Fournisseurs approuvés", "Résultat serveur", "Agents actifs", "En ligne et vérifiés", "Incidents de nettoyage", "Une valeur non nulle bloque la revente", "Indicateurs en direct", "Limite de transaction", "Prêt pour livraison réelle", "Voir les limites"], readiness: ["Contrôles de préparation", "La réception locale teste interactions et états, mais ne constitue ni offre GPU réelle ni transaction de production.", "Tous les éléments critiques sont prêts. Les nouvelles commandes peuvent être livrées.", "Si un élément critique manque, les transactions publiques restent fermées et aucune simulation n’est présentée comme réelle.", "Offres réelles actuelles", "Tout voir", "Voir et louer"], offers: ["Heures-carte standard KAI / heure GPU", "Release", "READY", "CLOSED", "Organisation actuelle"] },
  th: { modes: { DISABLED: "ยังไม่เปิด", SETUP: "ตั้งค่าก่อนเปิด", INTERNAL_AGENT_TRIAL: "ทดลองแบบเชิญ" }, checks: ["ข้อมูลตัวตนและผู้ให้บริการ", "Host Agent จริง", "ตารางค่าธรรมเนียม", "การล็อกและบัญชีชั่วโมงการ์ด", "อิมเมจส่งมอบที่อนุมัติ", "การวัดจริง", "ถอนสิทธิ์และล้าง", "ปิดเติมเงินสาธารณะ"], error: ["ไม่ทราบสถานะ Hosting", "อ่านสถานะแบบเรียลไทม์ไม่ได้ ระบบจะไม่เปิดซื้อขายเมื่อไม่ทราบสถานะ", "ลองอีกครั้ง", "กำลังซิงค์ข้อเสนอ Agent และการชำระ…"], header: ["ระบบควบคุมสด", "เริ่มจากการทำงานจริงหนึ่งอย่าง", "การเช่า ลงรายการ ส่งมอบ และชำระใช้หลักฐานอุปกรณ์ สัญญา และบัญชีเดียวกัน", "ขั้นตอนปัจจุบัน", "ตรวจรับภายใน · ไม่ใช่การผลิต"], actions: [["เช่า GPU", "กรองข้อเสนอที่ตรวจแล้ว ล็อกชั่วโมงการ์ด และเริ่มอินสแตนซ์", "ไม่มีเครื่องจริงออนไลน์"], ["ลงรายการ GPU", "ผ่านการตรวจผู้ให้บริการ จับคู่ Agent และตรวจฮาร์ดแวร์", "ผู้ให้บริการที่อนุมัติ"], ["จัดการทรัพยากรและคำสั่งซื้อ", "ดูอุปกรณ์ ข้อเสนอ การส่งมอบ เหตุผิดปกติ และหลักฐานล้าง", "Host Agent ที่ใช้งาน"], ["ดูรายได้ชั่วโมงการ์ด", "ตรวจค่าเช่า ค่าธรรมเนียม การล็อก คืน และชำระ", "นิติบุคคลปัจจุบัน", "เข้าสู่ระบบเพื่อดู", "LIVE"]], metrics: ["ข้อเสนอสาธารณะ", "เฉพาะที่ซื้อขายได้", "ผู้ให้บริการอนุมัติ", "ผลตรวจจากเซิร์ฟเวอร์", "Agent ที่ใช้งาน", "ออนไลน์และตรวจแล้ว", "ปัญหาการล้าง", "ห้ามขายต่อหากไม่เป็นศูนย์", "ตัวชี้วัดสด", "ขอบเขตซื้อขาย", "พร้อมส่งมอบจริง", "ดูข้อจำกัด"], readiness: ["ตรวจความพร้อม", "การตรวจรับภายในใช้ทดสอบการทำงานเท่านั้น ไม่ใช่ GPU จริงหรือธุรกรรมผลิต", "รายการสำคัญพร้อมแล้ว คำสั่งซื้อใหม่ส่งมอบจริงได้", "หากรายการสำคัญไม่พร้อม การซื้อขายสาธารณะจะปิดและไม่ใช้ข้อมูลจำลองแทนของจริง", "ข้อเสนอจริงปัจจุบัน", "ดูทั้งหมด", "ดูและเช่า"], offers: ["ชั่วโมงการ์ดมาตรฐาน KAI / ชั่วโมง GPU", "Release", "READY", "CLOSED", "องค์กรปัจจุบัน"] },
  vi: { modes: { DISABLED: "Chưa mở", SETUP: "Thiết lập trước khi mở", INTERNAL_AGENT_TRIAL: "Thử nghiệm theo lời mời" }, checks: ["Danh tính và nhà cung cấp thống nhất", "Host Agent thật", "Biểu phí hiệu lực", "Giữ và sổ cái giờ-thẻ", "Image bàn giao đã duyệt", "Đo lường thật", "Thu hồi và dọn dẹp", "Nạp công khai đóng"], error: ["Không rõ trạng thái Hosting", "Tạm thời không đọc được trạng thái. Giao dịch vẫn đóng khi trạng thái chưa rõ.", "Tải lại", "Đang đồng bộ báo giá, Agent và quyết toán…"], header: ["MẶT ĐIỀU KHIỂN TRỰC TIẾP", "Bắt đầu bằng một hành động thật", "Thuê, đăng, thực hiện và quyết toán dùng chung bằng chứng thiết bị, bản chụp hợp đồng và sổ cái.", "Giai đoạn hiện tại", "Nghiệm thu cục bộ · không phải nguồn cung sản xuất"], actions: [["Thuê GPU", "Lọc báo giá đã xác minh, giữ giờ-thẻ và khởi chạy phiên bản.", "Không có máy thật online"], ["Đăng một GPU", "Hoàn tất xét duyệt, ghép Agent và xác minh phần cứng.", "nhà cung cấp đã duyệt"], ["Quản lý tài nguyên và đơn", "Xem thiết bị, báo giá, thực hiện, sự cố và bằng chứng dọn dẹp.", "Host Agent hoạt động"], ["Xem doanh thu giờ-thẻ", "Đối soát tiền thuê, phí, giữ, giải phóng và quyết toán.", "Chủ thể giao dịch hiện tại", "Đăng nhập để xem", "LIVE"]], metrics: ["Báo giá công khai", "Chỉ tính mục giao dịch được", "Nhà cung cấp đã duyệt", "Kết quả máy chủ", "Agent hoạt động", "Online và đã xác minh", "Sự cố dọn dẹp", "Khác 0 sẽ chặn bán lại", "Chỉ số vận hành trực tiếp", "Ranh giới giao dịch", "Sẵn sàng bàn giao thật", "Xem giới hạn"], readiness: ["Kiểm tra sẵn sàng", "Nghiệm thu cục bộ chỉ thử tương tác và trạng thái, không phải GPU thật hay giao dịch sản xuất.", "Tất cả mục quan trọng đã sẵn sàng. Đơn mới có thể bàn giao thật.", "Nếu mục quan trọng chưa sẵn sàng, giao dịch công khai vẫn đóng và không dùng tài nguyên mô phỏng giả làm nguồn cung thật.", "Báo giá thật hiện tại", "Xem tất cả", "Xem và thuê"], offers: ["Giờ-thẻ chuẩn KAI / giờ GPU", "Release", "READY", "CLOSED", "Tổ chức hiện tại"] },
  id: { modes: { DISABLED: "Belum dibuka", SETUP: "Persiapan pra-peluncuran", INTERNAL_AGENT_TRIAL: "Uji coba undangan" }, checks: ["Identitas dan pemasok terpadu", "Host Agent nyata", "Jadwal biaya aktif", "Hold dan buku besar jam-kartu", "Image pengiriman disetujui", "Metering nyata", "Pencabutan dan pembersihan", "Top-up publik ditutup"], error: ["Status Hosting tidak diketahui", "Status langsung sementara tidak tersedia. Transaksi tetap ditutup selama status tidak diketahui.", "Muat ulang", "Menyinkronkan penawaran, Agent, dan penyelesaian…"], header: ["KONTROL LANGSUNG", "Mulai dari satu tindakan nyata", "Sewa, listing, pemenuhan, dan penyelesaian memakai bukti perangkat, snapshot kontrak, dan buku besar yang sama.", "Tahap operasi saat ini", "Penerimaan lokal · bukan pasokan produksi"], actions: [["Sewa GPU", "Filter penawaran terverifikasi, tahan jam-kartu, dan jalankan instans.", "Tidak ada mesin nyata online"], ["Listing GPU", "Selesaikan tinjauan, pairing Agent, dan verifikasi perangkat keras.", "pemasok disetujui"], ["Kelola sumber daya dan pesanan", "Lihat perangkat, penawaran, pemenuhan, insiden, dan bukti pembersihan.", "Host Agent aktif"], ["Lihat pendapatan jam-kartu", "Rekonsiliasi sewa, komisi, hold, pelepasan, dan penyelesaian.", "Entitas transaksi saat ini", "Masuk untuk melihat", "LIVE"]], metrics: ["Penawaran publik", "Hanya yang dapat ditransaksikan", "Pemasok disetujui", "Hasil tinjauan server", "Agent aktif", "Online dan terverifikasi", "Insiden pembersihan", "Nilai non-nol memblokir penjualan ulang", "Metrik operasi langsung", "Batas transaksi", "Siap untuk pengiriman nyata", "Lihat batas saat ini"], readiness: ["Pemeriksaan kesiapan", "Penerimaan lokal hanya menguji interaksi dan status, bukan pasokan GPU nyata atau transaksi produksi.", "Semua unsur penting siap. Pesanan baru dapat masuk pengiriman nyata.", "Jika unsur penting belum siap, transaksi publik tetap ditutup dan sumber simulasi tidak ditampilkan sebagai pasokan nyata.", "Penawaran nyata saat ini", "Lihat semua", "Lihat dan sewa"], offers: ["Jam-kartu standar KAI / jam GPU", "Release", "READY", "CLOSED", "Organisasi saat ini"] },
  ms: { modes: { DISABLED: "Belum dibuka", SETUP: "Persediaan prapelancaran", INTERNAL_AGENT_TRIAL: "Percubaan jemputan" }, checks: ["Identiti dan pembekal bersatu", "Host Agent sebenar", "Jadual fi aktif", "Tahanan dan lejar jam-kad", "Imej penghantaran diluluskan", "Pemeteran sebenar", "Penarikan dan pembersihan", "Tambah nilai awam ditutup"], error: ["Status Hosting tidak diketahui", "Status langsung tidak tersedia buat sementara. Transaksi kekal ditutup selagi status tidak diketahui.", "Muat semula", "Menyegerakkan tawaran, Agent dan penyelesaian…"], header: ["KAWALAN LANGSUNG", "Mulakan dengan satu tindakan sebenar", "Sewa, penyenaraian, pemenuhan dan penyelesaian menggunakan bukti peranti, syot kontrak dan lejar yang sama.", "Peringkat operasi semasa", "Penerimaan setempat · bukan bekalan produksi"], actions: [["Sewa GPU", "Tapis tawaran disahkan, tahan jam-kad dan lancarkan kejadian.", "Tiada mesin sebenar dalam talian"], ["Senaraikan GPU", "Lengkapkan semakan, pasangan Agent dan pengesahan perkakasan.", "pembekal diluluskan"], ["Urus sumber dan pesanan", "Lihat peranti, tawaran, pemenuhan, insiden dan bukti pembersihan.", "Host Agent aktif"], ["Lihat pendapatan jam-kad", "Selaraskan sewa, komisen, tahanan, pelepasan dan penyelesaian.", "Entiti transaksi semasa", "Log masuk untuk melihat", "LIVE"]], metrics: ["Tawaran awam", "Hanya yang boleh diniagakan", "Pembekal diluluskan", "Hasil semakan pelayan", "Agent aktif", "Dalam talian dan disahkan", "Insiden pembersihan", "Nilai bukan sifar menghalang jualan semula", "Metrik operasi langsung", "Sempadan transaksi", "Sedia untuk penghantaran sebenar", "Lihat had semasa"], readiness: ["Semakan kesediaan", "Penerimaan setempat hanya menguji interaksi dan keadaan, bukan GPU sebenar atau transaksi produksi.", "Semua unsur penting sedia. Pesanan baharu boleh memasuki penghantaran sebenar.", "Jika unsur penting belum sedia, transaksi awam kekal ditutup dan sumber simulasi tidak dipersembahkan sebagai bekalan sebenar.", "Tawaran sebenar semasa", "Lihat semua", "Lihat dan sewa"], offers: ["Jam-kad standard KAI / jam GPU", "Release", "READY", "CLOSED", "Organisasi semasa"] },
};

async function responseJson<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

function shortRelease(value: string) {
  return /^[a-f0-9]{12,64}$/u.test(value) ? value.slice(0, 12) : value;
}

function modelLabel(model: PublicHostingOffer["gpuModel"]) {
  return model === "RTX_4090" ? "RTX 4090" : "H100 80GB";
}

export function HostingLaunchpad() {
  const { locale } = useLocale();
  const copy = LAUNCH_COPY[locale];
  const [state, setState] = useState<LaunchpadState | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [readinessResponse, accountResponse] = await Promise.all([
        fetch("/api/ready", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" }),
      ]);
      const [readinessBody, accountBody] = await Promise.all([
        responseJson<HostingReadinessEnvelope>(readinessResponse),
        responseJson<AccountEnvelope>(accountResponse),
      ]);
      if (!readinessResponse.ok || !readinessBody?.hostingV2 || !accountResponse.ok || !accountBody) throw new Error("HOSTING_STATUS_INVALID");
      let offers: PublicHostingOffer[] = [];
      if (readinessBody.hostingV2.enabled && readinessBody.hostingV2.ready) {
        const offersResponse = await fetch("/api/v2/offers", { cache: "no-store", credentials: "same-origin" });
        const offersBody = await responseJson<{ records?: PublicHostingOffer[] }>(offersResponse);
        if (!offersResponse.ok || !Array.isArray(offersBody?.records)) throw new Error("HOSTING_OFFERS_INVALID");
        offers = offersBody.records;
      }
      setState({
        readiness: readinessBody.hostingV2,
        release: readinessBody.release ?? "unknown",
        offers,
        account: accountBody,
        localAcceptance: readinessBody.environment?.localAcceptance === true,
      });
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  const models = useMemo(() => state
    ? [...new Set(state.offers.map((offer) => modelLabel(offer.gpuModel)))]
    : [], [state]);

  if (failed) {
    return (
      <section className={styles.launchpadError} role="alert">
        <div><strong>{copy.error[0]}</strong><p>{copy.error[1]}</p></div>
        <button onClick={() => void load()} type="button">{copy.error[2]}</button>
      </section>
    );
  }

  if (!state) return <div className={styles.launchpadLoading} role="status">{copy.error[3]}</div>;

  const { readiness, offers, account } = state;
  const operations = readiness.operations;
  const transactionOpen = readiness.enabled && readiness.ready;
  const supplierHref = account.authenticated ? "/supply" : "/login?returnTo=%2Fsupply";
  const supplierOnboardingHref = account.authenticated ? "/supply/onboarding" : "/login?returnTo=%2Fsupply%2Fonboarding";
  const earningsHref = account.authenticated ? "/supply/earnings" : "/login?returnTo=%2Fsupply%2Fearnings";
  const checkRows = checkKeys.map((key, index) => [key, copy.checks[index]] as const);
  const number = new Intl.NumberFormat(locale);

  return (
    <section className={styles.launchpad} aria-labelledby="hosting-launchpad-title">
      <header className={styles.launchpadHeader}>
        <div>
          <p className={styles.sectionIndex}>{copy.header[0]}</p>
          <h2 id="hosting-launchpad-title">{copy.header[1]}</h2>
          <p>{copy.header[2]}</p>
        </div>
        <div className={transactionOpen && !state.localAcceptance ? styles.liveState : styles.closedState}>
          <span aria-hidden="true" />
          <div><small>{copy.header[3]}</small><strong>{state.localAcceptance ? copy.header[4] : copy.modes[readiness.rolloutMode]}</strong></div>
        </div>
      </header>

      <div className={styles.launchpadActions}>
        <Link className={styles.launchpadAction} href="/gpu">
          <span className={styles.cardCode}>01 / RENT</span>
          <div><h3>{copy.actions[0][0]}</h3><p>{copy.actions[0][1]}</p></div>
          <div className={styles.actionMeta}><strong>{number.format(offers.length)}</strong><span>{models.length ? models.join(" · ") : copy.actions[0][2]}</span></div>
          <span className={styles.actionArrow} aria-hidden="true">→</span>
        </Link>

        <Link className={styles.launchpadAction} href={supplierOnboardingHref}>
          <span className={styles.cardCode}>02 / ONBOARD</span>
          <div><h3>{copy.actions[1][0]}</h3><p>{copy.actions[1][1]}</p></div>
          <div className={styles.actionMeta}><strong>{number.format(operations?.approvedSupplierCount ?? 0)}</strong><span>{copy.actions[1][2]}</span></div>
          <span className={styles.actionArrow} aria-hidden="true">→</span>
        </Link>

        <Link className={styles.launchpadAction} href={supplierHref}>
          <span className={styles.cardCode}>03 / OPERATE</span>
          <div><h3>{copy.actions[2][0]}</h3><p>{copy.actions[2][1]}</p></div>
          <div className={styles.actionMeta}><strong>{number.format(operations?.activeAgentCount ?? 0)}</strong><span>{copy.actions[2][2]}</span></div>
          <span className={styles.actionArrow} aria-hidden="true">→</span>
        </Link>

        <Link className={styles.launchpadAction} href={earningsHref}>
          <span className={styles.cardCode}>04 / SETTLE</span>
          <div><h3>{copy.actions[3][0]}</h3><p>{copy.actions[3][1]}</p></div>
          <div className={styles.actionMeta}><strong>{account.authenticated ? copy.actions[3][4] : "—"}</strong><span>{account.authenticated ? account.organization?.name ?? copy.actions[3][2] : copy.actions[3][3]}</span></div>
          <span className={styles.actionArrow} aria-hidden="true">→</span>
        </Link>
      </div>

      <div className={styles.launchpadData}>
        <section className={styles.liveMetrics} aria-label={copy.metrics[8]}>
          {[
            [copy.metrics[0], number.format(offers.length), copy.metrics[1]],
            [copy.metrics[2], number.format(operations?.approvedSupplierCount ?? 0), copy.metrics[3]],
            [copy.metrics[4], number.format(operations?.activeAgentCount ?? 0), copy.metrics[5]],
            [copy.metrics[6], number.format((operations?.drainingDeviceCount ?? 0) + (operations?.failedCleanupCount ?? 0)), copy.metrics[7]],
          ].map(([label, value, note]) => (
            <div key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
          ))}
        </section>

        <details className={styles.readinessDisclosure}>
          <summary>
            <span>{copy.metrics[9]}</span>
            <strong>{transactionOpen && !state.localAcceptance ? copy.metrics[10] : copy.metrics[11]}</strong>
          </summary>
          <section className={styles.readinessPanel} aria-labelledby="readiness-panel-title">
            <header><h3 id="readiness-panel-title">{copy.readiness[0]}</h3><span>{copy.offers[1]} {shortRelease(state.release)}</span></header>
            <ul>
              {checkRows.map(([key, label]) => {
                const check = readiness.checks[key];
                return <li key={key}><span>{label}</span><strong className={check.ready ? styles.checkReady : styles.checkClosed}>{check.ready ? copy.offers[2] : copy.offers[3]}</strong></li>;
              })}
            </ul>
            <p>{state.localAcceptance ? copy.readiness[1] : transactionOpen ? copy.readiness[2] : copy.readiness[3]}</p>
          </section>
        </details>
      </div>

      {offers.length ? (
        <section className={styles.offerPreview} aria-labelledby="live-offers-title">
          <header><h3 id="live-offers-title">{copy.readiness[4]}</h3><Link href="/gpu">{copy.readiness[5]}</Link></header>
          {offers.slice(0, 3).map((offer) => (
            <article key={offer.id}>
              <div><strong>{offer.title}</strong><span>{modelLabel(offer.gpuModel)} · {offer.region}</span></div>
              <div><strong>{formatCardHours(offer.pricing.cardHourMicrosPerGpuHour)}</strong><span>{copy.offers[0]}</span></div>
              <Link href={`/gpu/offers/${encodeURIComponent(offer.id)}`}>{copy.readiness[6]}</Link>
            </article>
          ))}
        </section>
      ) : null}
    </section>
  );
}
