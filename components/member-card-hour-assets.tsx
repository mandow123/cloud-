"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import { createIdempotencyKey, MarketplaceApiError, marketplacePost } from "@/lib/client/marketplace-client";
import type { Locale } from "@/lib/i18n";
import styles from "./member-card-hour-assets.module.css";

type PaymentChannel = "ALIPAY" | "WXPAY";

type TopupRecord = {
  id: string;
  channel?: PaymentChannel | null;
  cardHourMicros: number;
  amountCents: number;
  status: "PROCESSING" | "PENDING" | "CAPTURED" | "CLOSED" | "RECONCILIATION_REQUIRED";
  createdAt: string;
  appealEligibility: { canAppeal: boolean; retryAt: string | null };
};

type AppealNotification = {
  caseNumber: string;
  topupOrderId: string;
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "CLOSED";
  resolutionNote: string | null;
  unread: boolean;
  updatedAt: string;
};

type CardHourDashboard = {
  rate: { cardHours: string; cny: string; topupBlockCardHours: string; topupBlockCny: string };
  balance: { availableMicros: number; heldMicros: number; lifetimeTopupMicros: number; lifetimeSpentMicros: number };
  income: { rentalVestedMicros: number; commissionVestedMicros: number };
  topups: TopupRecord[];
  appealNotifications: AppealNotification[];
  unreadAppealCount: number;
  topupAvailability: {
    ready: boolean;
    mode: "PILOT" | "CATALOG";
    reason: string | null;
    minCardHours: number;
    maxCardHours: number | null;
    stepCardHours: number;
    channels: Array<{ channel: PaymentChannel; ready: boolean; reason: string | null }>;
    packages: Array<{ code: string; name: string; cardHours: number; amountCents: number; description: string; badge?: string }>;
  };
};

type TopupCheckout = {
  record: TopupRecord;
  checkoutUrl: string;
  provider: "QIXIANG_PAY";
  channel: PaymentChannel;
  replayed: boolean;
};

type Copy = { title: string; intro: string; available: string; appeals: string; newUpdates: string; latest: string; unread: string; summary: string; held: string; totalTopup: string; totalSpent: string; cardHours: string; paymentTruth: string; topup: string; boundary: string; modeAria: string; packages: string; custom: string; packageAria: string; amount: string; amountHelp: string; pilot: string; chooseChannel: string; open: string; closed: string; channelPending: string; fixedRate: string; credited: string; payable: string; creating: string; pay: string; paymentNotice: string; history: string; order: string; method: string; money: string; status: string; created: string; action: string; historical: string; processing: string; appealUpdated: string; viewAppeal: string; topupProblem: string; appealAfter: string; noHistory: string; loadFailed: string; loadSafe: string; retry: string; loading: string; invalidSelection: string; createFailed: string; unsafeCheckout: string; requestId: string; statusLabels: Record<TopupRecord["status"], string>; appealLabels: Record<AppealNotification["status"], string> };
const EN: Copy = { title: "My assets · Card-hour account", intro: "Top up with CNY to buy KAI standard card-hours. Compute resources are traded only in card-hours.", available: "Available KAI standard card-hours", appeals: "Top-up appeal updates", newUpdates: "new updates", latest: "Latest status", unread: "Unread", summary: "Asset summary", held: "Held", totalTopup: "Lifetime top-ups", totalSpent: "Lifetime usage", cardHours: "KAI standard card-hours", paymentTruth: "Creating a payment order or returning from checkout does not mean payment succeeded. Card-hours appear only after the platform receives a trusted payment result and posts the ledger entry.", topup: "Top up card-hours", boundary: "CNY is used only to buy KAI standard card-hours. User card-hours cannot be withdrawn or transferred.", modeAria: "Choose top-up amount mode", packages: "Package", custom: "Custom", packageAria: "Card-hour top-up packages", amount: "Card-hour amount", amountHelp: "Minimum 5.00 card-hours, in increments of 5.00.", pilot: "Small-value production acceptance is active; only 5.00 card-hours are supported.", chooseChannel: "Choose payment channel", open: "Available", closed: "Unavailable", channelPending: "Payment channels are completing production acceptance.", fixedRate: "Fixed purchase reference", credited: "Card-hours credited", payable: "Amount due", creating: "Creating payment…", pay: "Confirm and continue to payment", paymentNotice: "Only server-side confirmation posts card-hours. Self-service refunds are unavailable; administrators review top-up exceptions manually.", history: "Top-up history", order: "Payment order", method: "Payment method", money: "Amount", status: "Status", created: "Created", action: "Action", historical: "Historical payment", processing: "Processing", appealUpdated: "Appeal updated", viewAppeal: "View appeal", topupProblem: "Problem with this top-up", appealAfter: "Appeal available after", noHistory: "No top-up history. Payment results are isolated to the current organization.", loadFailed: "Unable to load card-hour assets", loadSafe: "Card-hour assets are temporarily unavailable.", retry: "Try again", loading: "Loading card-hour assets for this organization…", invalidSelection: "Choose an available payment method and a valid card-hour amount.", createFailed: "Unable to create the payment order. Try again later.", unsafeCheckout: "The payment address failed the security check.", requestId: "Request ID", statusLabels: { PROCESSING: "Creating payment", PENDING: "Awaiting payment confirmation", CAPTURED: "Credited", CLOSED: "Closed (not credited)", RECONCILIATION_REQUIRED: "Manual review required" }, appealLabels: { OPEN: "Submitted", UNDER_REVIEW: "Under manual review", RESOLVED: "Resolution available", CLOSED: "Closed" } };
const COPY_BASE: Record<Locale, Copy> = {
  en: EN,
  "zh-CN": { ...EN, title: "我的资产 · 卡时账户", intro: "充值人民币购买 KAI 标准卡时；网站资源仍只用卡时交易。", available: "可用 KAI 标准卡时", appeals: "充值申诉进展", newUpdates: "条新进展", latest: "最新处理状态", unread: "未读", summary: "资产概览", held: "已冻结", totalTopup: "累计充值", totalSpent: "累计使用", cardHours: "KAI 标准卡时", paymentTruth: "创建付款单或从收银台返回，都不代表支付成功。只有平台服务端收到可信支付结果并完成卡时入账后，页面才会显示“已到账”。", topup: "充值卡时", boundary: "人民币仅用于充值 KAI 标准卡时；站内算力资源只使用卡时交易。用户卡时不可提现、不可转账。", modeAria: "充值数量选择方式", packages: "套餐充值", custom: "自定义充值", packageAria: "卡时充值套餐", amount: "充值卡时数量", amountHelp: "最低 5.00 卡时，且必须为 5.00 的整数倍。", pilot: "当前为小额生产验收，仅支持充值 5.00 卡时。", chooseChannel: "选择支付渠道", open: "已开放", closed: "暂未开放", channelPending: "支付渠道正在完成生产验收。", fixedRate: "固定购买参考", credited: "到账卡时", payable: "应付金额", creating: "正在创建付款单…", pay: "确认并前往支付", paymentNotice: "只有平台服务端确认后才会入账。当前不提供自助退款；充值异常由管理员人工核对处理。", history: "充值记录", order: "付款单", method: "支付方式", money: "金额", status: "状态", created: "创建时间", action: "处理", historical: "历史付款单", processing: "处理中", appealUpdated: "申诉有新进展", viewAppeal: "查看申诉", topupProblem: "充值遇到问题", appealAfter: "可于此时间后申诉", noHistory: "还没有充值记录。支付结果会按当前组织隔离显示。", loadFailed: "卡时资产读取失败", loadSafe: "卡时资产暂时无法读取。", retry: "重新读取", loading: "正在读取当前组织的卡时资产…", invalidSelection: "请选择已开放的支付方式和有效卡时数量。", createFailed: "付款单创建失败，请稍后重试。", unsafeCheckout: "支付地址未通过安全检查，请稍后重试。", requestId: "请求编号", statusLabels: { PROCESSING: "付款单创建中", PENDING: "等待支付确认", CAPTURED: "已到账", CLOSED: "已关闭（未到账）", RECONCILIATION_REQUIRED: "待人工核对" }, appealLabels: { OPEN: "已提交", UNDER_REVIEW: "人工核对中", RESOLVED: "已有处理结论", CLOSED: "已关闭" } },
  "zh-TW": { ...EN, title: "我的資產 · 卡時帳戶", intro: "儲值人民幣購買 KAI 標準卡時；站內資源只用卡時交易。", available: "可用 KAI 標準卡時", appeals: "儲值申訴進展", newUpdates: "筆新進展", latest: "最新處理狀態", unread: "未讀", summary: "資產概覽", held: "已凍結", totalTopup: "累計儲值", totalSpent: "累計使用", topup: "儲值卡時", packages: "套餐儲值", custom: "自訂儲值", amount: "儲值卡時數量", chooseChannel: "選擇付款管道", open: "已開放", closed: "暫未開放", credited: "入帳卡時", payable: "應付金額", creating: "正在建立付款單…", pay: "確認並前往付款", history: "儲值記錄", order: "付款單", method: "付款方式", money: "金額", status: "狀態", created: "建立時間", action: "處理", loadFailed: "卡時資產讀取失敗", retry: "重新讀取", loading: "正在讀取目前組織的卡時資產…", requestId: "請求編號" },
  ja: { ...EN, title: "資産 · カード時口座", intro: "人民元で KAI 標準カード時をチャージします。サイト内取引はカード時のみです。", available: "利用可能な KAI 標準カード時", appeals: "チャージ異議の進捗", summary: "資産概要", held: "確保済み", totalTopup: "累計チャージ", totalSpent: "累計使用", topup: "カード時をチャージ", packages: "パッケージ", custom: "任意金額", amount: "カード時数量", chooseChannel: "決済方法", open: "利用可能", closed: "利用不可", credited: "入帳カード時", payable: "支払額", creating: "決済を作成中…", pay: "確認して支払いへ", history: "チャージ履歴", order: "決済番号", method: "決済方法", money: "金額", status: "状態", created: "作成日時", action: "操作", loadFailed: "カード時資産を読み込めません", retry: "再試行", loading: "カード時資産を読み込み中…", requestId: "リクエスト ID" },
  ko: { ...EN, title: "내 자산 · 카드시간 계정", intro: "위안화로 KAI 표준 카드시간을 충전합니다. 사이트 거래는 카드시간만 사용합니다.", available: "사용 가능한 KAI 표준 카드시간", appeals: "충전 이의 진행", summary: "자산 개요", held: "잠금", totalTopup: "누적 충전", totalSpent: "누적 사용", topup: "카드시간 충전", packages: "패키지", custom: "직접 입력", amount: "카드시간 수량", chooseChannel: "결제 채널", open: "사용 가능", closed: "사용 불가", credited: "입금 카드시간", payable: "결제 금액", creating: "결제 생성 중…", pay: "확인 후 결제", history: "충전 내역", order: "결제 주문", method: "결제 방법", money: "금액", status: "상태", created: "생성 시간", action: "처리", loadFailed: "자산을 불러올 수 없습니다", retry: "다시 시도", loading: "카드시간 자산 불러오는 중…", requestId: "요청 ID" },
  fr: { ...EN, title: "Mes actifs · Heures-carte", intro: "Rechargez en CNY pour acheter des heures-carte KAI. Les ressources s’échangent uniquement en heures-carte.", available: "Heures-carte KAI disponibles", appeals: "Suivi des contestations", summary: "Résumé des actifs", held: "Bloquées", totalTopup: "Recharges cumulées", totalSpent: "Utilisation cumulée", topup: "Recharger", packages: "Forfait", custom: "Personnalisé", amount: "Quantité d’heures-carte", chooseChannel: "Moyen de paiement", open: "Disponible", closed: "Indisponible", credited: "Heures-carte créditées", payable: "Montant dû", creating: "Création du paiement…", pay: "Confirmer et payer", history: "Historique", order: "Paiement", method: "Méthode", money: "Montant", status: "Statut", created: "Créé", action: "Action", loadFailed: "Impossible de charger les actifs", retry: "Réessayer", loading: "Chargement des actifs…", requestId: "ID de requête" },
  th: { ...EN, title: "สินทรัพย์ · บัญชีชั่วโมงการ์ด", intro: "เติมเงิน CNY เพื่อซื้อชั่วโมงการ์ด KAI ทรัพยากรในระบบซื้อขายด้วยชั่วโมงการ์ดเท่านั้น", available: "ชั่วโมงการ์ด KAI ที่ใช้ได้", appeals: "ความคืบหน้าคำร้อง", summary: "สรุปสินทรัพย์", held: "ถูกล็อก", totalTopup: "เติมสะสม", totalSpent: "ใช้สะสม", topup: "เติมชั่วโมงการ์ด", packages: "แพ็กเกจ", custom: "กำหนดเอง", amount: "จำนวนชั่วโมงการ์ด", chooseChannel: "ช่องทางชำระเงิน", open: "เปิดใช้", closed: "ยังไม่เปิด", credited: "ชั่วโมงการ์ดที่ได้รับ", payable: "ยอดชำระ", creating: "กำลังสร้างการชำระเงิน…", pay: "ยืนยันและชำระเงิน", history: "ประวัติการเติม", order: "คำสั่งชำระเงิน", method: "วิธีชำระ", money: "จำนวนเงิน", status: "สถานะ", created: "สร้างเมื่อ", action: "ดำเนินการ", loadFailed: "โหลดสินทรัพย์ไม่ได้", retry: "ลองอีกครั้ง", loading: "กำลังโหลดสินทรัพย์…", requestId: "รหัสคำขอ" },
  vi: { ...EN, title: "Tài sản · Tài khoản giờ-thẻ", intro: "Nạp CNY để mua giờ-thẻ KAI. Tài nguyên trên nền tảng chỉ giao dịch bằng giờ-thẻ.", available: "Giờ-thẻ KAI khả dụng", appeals: "Tiến độ khiếu nại", summary: "Tổng quan tài sản", held: "Đã khóa", totalTopup: "Tổng nạp", totalSpent: "Tổng sử dụng", topup: "Nạp giờ-thẻ", packages: "Gói", custom: "Tùy chỉnh", amount: "Số giờ-thẻ", chooseChannel: "Kênh thanh toán", open: "Đã mở", closed: "Chưa mở", credited: "Giờ-thẻ nhận", payable: "Số tiền phải trả", creating: "Đang tạo thanh toán…", pay: "Xác nhận và thanh toán", history: "Lịch sử nạp", order: "Đơn thanh toán", method: "Phương thức", money: "Số tiền", status: "Trạng thái", created: "Thời gian tạo", action: "Xử lý", loadFailed: "Không thể tải tài sản", retry: "Thử lại", loading: "Đang tải tài sản…", requestId: "Mã yêu cầu" },
  id: { ...EN, title: "Aset · Akun jam-kartu", intro: "Isi CNY untuk membeli jam-kartu KAI. Sumber daya hanya diperdagangkan dalam jam-kartu.", available: "Jam-kartu KAI tersedia", appeals: "Perkembangan banding", summary: "Ringkasan aset", held: "Ditahan", totalTopup: "Total isi ulang", totalSpent: "Total penggunaan", topup: "Isi ulang jam-kartu", packages: "Paket", custom: "Kustom", amount: "Jumlah jam-kartu", chooseChannel: "Kanal pembayaran", open: "Tersedia", closed: "Belum tersedia", credited: "Jam-kartu diterima", payable: "Jumlah bayar", creating: "Membuat pembayaran…", pay: "Konfirmasi dan bayar", history: "Riwayat isi ulang", order: "Pesanan pembayaran", method: "Metode", money: "Jumlah", status: "Status", created: "Dibuat", action: "Tindakan", loadFailed: "Aset tidak dapat dimuat", retry: "Coba lagi", loading: "Memuat aset…", requestId: "ID permintaan" },
  ms: { ...EN, title: "Aset · Akaun jam-kad", intro: "Tambah nilai CNY untuk membeli jam-kad KAI. Sumber hanya didagangkan dalam jam-kad.", available: "Jam-kad KAI tersedia", appeals: "Kemajuan rayuan", summary: "Ringkasan aset", held: "Dikunci", totalTopup: "Jumlah tambah nilai", totalSpent: "Jumlah penggunaan", topup: "Tambah nilai jam-kad", packages: "Pakej", custom: "Tersuai", amount: "Jumlah jam-kad", chooseChannel: "Saluran pembayaran", open: "Tersedia", closed: "Belum tersedia", credited: "Jam-kad diterima", payable: "Jumlah perlu dibayar", creating: "Mencipta pembayaran…", pay: "Sahkan dan bayar", history: "Sejarah tambah nilai", order: "Pesanan pembayaran", method: "Kaedah", money: "Jumlah", status: "Status", created: "Dicipta", action: "Tindakan", loadFailed: "Aset tidak dapat dimuatkan", retry: "Cuba lagi", loading: "Memuatkan aset…", requestId: "ID permintaan" },
};

type CardHourCoreCopy = Pick<Copy, "newUpdates" | "latest" | "unread" | "cardHours" | "paymentTruth" | "boundary" | "modeAria" | "packageAria" | "amountHelp" | "pilot" | "channelPending" | "fixedRate" | "paymentNotice" | "historical" | "processing" | "appealUpdated" | "viewAppeal" | "topupProblem" | "appealAfter" | "noHistory" | "loadSafe" | "invalidSelection" | "createFailed" | "unsafeCheckout" | "statusLabels" | "appealLabels">;
const CARD_HOUR_CORE_COPY: Record<Exclude<Locale, "en">, CardHourCoreCopy> = {
  "zh-CN": { newUpdates: "条新进展", latest: "最新处理状态", unread: "未读", cardHours: "KAI 标准卡时", paymentTruth: "创建付款单或从收银台返回都不代表支付成功；只有服务端确认并入账后才显示已到账。", boundary: "人民币仅用于充值 KAI 标准卡时；用户卡时不可提现、不可转账。", modeAria: "充值数量选择方式", packageAria: "卡时充值套餐", amountHelp: "最低 5.00 卡时，且必须为 5.00 的整数倍。", pilot: "当前为小额生产验收，仅支持充值 5.00 卡时。", channelPending: "支付渠道正在完成生产验收。", fixedRate: "固定购买参考", paymentNotice: "只有服务端确认后才会入账；充值异常由管理员人工核对。", historical: "历史付款单", processing: "处理中", appealUpdated: "申诉有新进展", viewAppeal: "查看申诉", topupProblem: "充值遇到问题", appealAfter: "可于此时间后申诉", noHistory: "还没有充值记录；支付结果按当前组织隔离显示。", loadSafe: "卡时资产暂时无法读取。", invalidSelection: "请选择已开放的支付方式和有效卡时数量。", createFailed: "付款单创建失败，请稍后重试。", unsafeCheckout: "支付地址未通过安全检查。", statusLabels: { PROCESSING: "付款单创建中", PENDING: "等待支付确认", CAPTURED: "已到账", CLOSED: "已关闭（未到账）", RECONCILIATION_REQUIRED: "待人工核对" }, appealLabels: { OPEN: "已提交", UNDER_REVIEW: "人工核对中", RESOLVED: "已有处理结论", CLOSED: "已关闭" } },
  "zh-TW": { newUpdates: "筆新進展", latest: "最新處理狀態", unread: "未讀", cardHours: "KAI 標準卡時", paymentTruth: "建立付款單或從收銀台返回都不代表付款成功；只有服務端確認並入帳後才顯示已到帳。", boundary: "人民幣僅用於儲值 KAI 標準卡時；使用者卡時不可提現、不可轉帳。", modeAria: "儲值數量選擇方式", packageAria: "卡時儲值套餐", amountHelp: "最低 5.00 卡時，且必須為 5.00 的整數倍。", pilot: "目前為小額生產驗收，僅支援儲值 5.00 卡時。", channelPending: "付款管道正在完成生產驗收。", fixedRate: "固定購買參考", paymentNotice: "只有服務端確認後才會入帳；儲值異常由管理員人工核對。", historical: "歷史付款單", processing: "處理中", appealUpdated: "申訴有新進展", viewAppeal: "查看申訴", topupProblem: "儲值遇到問題", appealAfter: "可於此時間後申訴", noHistory: "尚無儲值記錄；付款結果依目前組織隔離顯示。", loadSafe: "目前無法讀取卡時資產。", invalidSelection: "請選擇已開放的付款方式與有效卡時數量。", createFailed: "付款單建立失敗，請稍後重試。", unsafeCheckout: "付款位址未通過安全檢查。", statusLabels: { PROCESSING: "付款單建立中", PENDING: "等待付款確認", CAPTURED: "已到帳", CLOSED: "已關閉（未到帳）", RECONCILIATION_REQUIRED: "待人工核對" }, appealLabels: { OPEN: "已提交", UNDER_REVIEW: "人工核對中", RESOLVED: "已有處理結論", CLOSED: "已關閉" } },
  ja: { newUpdates: "件の更新", latest: "最新状態", unread: "未読", cardHours: "KAI 標準カード時", paymentTruth: "支払い注文の作成や決済画面からの戻りは成功を意味しません。サーバー確認と入帳後のみ反映されます。", boundary: "人民元は KAI 標準カード時の購入にのみ使用され、出金や譲渡はできません。", modeAria: "チャージ数量の選択方法", packageAria: "カード時チャージパッケージ", amountHelp: "最低 5.00 カード時、5.00 単位です。", pilot: "少額本番検収中のため 5.00 カード時のみ対応します。", channelPending: "決済手段は本番検収中です。", fixedRate: "固定購入参考", paymentNotice: "サーバー確認後のみ入帳され、問題は管理者が手動確認します。", historical: "過去の支払い", processing: "処理中", appealUpdated: "申立て更新あり", viewAppeal: "申立てを見る", topupProblem: "チャージの問題", appealAfter: "申立て可能時刻", noHistory: "チャージ履歴はありません。結果は現在の組織に分離されます。", loadSafe: "カード時資産は一時的に利用できません。", invalidSelection: "利用可能な決済方法と有効なカード時数量を選択してください。", createFailed: "支払い注文を作成できません。後でもう一度お試しください。", unsafeCheckout: "決済 URL の安全確認に失敗しました。", statusLabels: { PROCESSING: "支払い作成中", PENDING: "支払い確認待ち", CAPTURED: "入帳済み", CLOSED: "終了（未入帳）", RECONCILIATION_REQUIRED: "手動確認が必要" }, appealLabels: { OPEN: "送信済み", UNDER_REVIEW: "手動確認中", RESOLVED: "結論あり", CLOSED: "終了" } },
  ko: { newUpdates: "건의 새 소식", latest: "최신 처리 상태", unread: "읽지 않음", cardHours: "KAI 표준 카드시간", paymentTruth: "결제 주문 생성이나 결제창 복귀는 성공을 뜻하지 않습니다. 서버 확인과 원장 반영 후에만 표시됩니다.", boundary: "CNY는 KAI 표준 카드시간 구매에만 사용되며 출금이나 양도가 불가합니다.", modeAria: "충전 수량 선택 방식", packageAria: "카드시간 충전 패키지", amountHelp: "최소 5.00 카드시간이며 5.00 단위입니다.", pilot: "소액 운영 검수 중으로 5.00 카드시간만 지원합니다.", channelPending: "결제 채널이 운영 검수를 진행 중입니다.", fixedRate: "고정 구매 참고", paymentNotice: "서버 확인 후에만 반영되며 이상 건은 관리자가 수동 확인합니다.", historical: "과거 결제 주문", processing: "처리 중", appealUpdated: "이의제기 새 소식", viewAppeal: "이의제기 보기", topupProblem: "충전 문제", appealAfter: "이후 이의제기 가능", noHistory: "충전 내역이 없습니다. 결과는 현재 조직별로 분리됩니다.", loadSafe: "카드시간 자산을 일시적으로 사용할 수 없습니다.", invalidSelection: "사용 가능한 결제 방법과 올바른 카드시간 수량을 선택하세요.", createFailed: "결제 주문을 만들 수 없습니다. 나중에 다시 시도하세요.", unsafeCheckout: "결제 주소가 보안 검사를 통과하지 못했습니다.", statusLabels: { PROCESSING: "결제 생성 중", PENDING: "결제 확인 대기", CAPTURED: "입금 완료", CLOSED: "종료(미입금)", RECONCILIATION_REQUIRED: "수동 확인 필요" }, appealLabels: { OPEN: "제출됨", UNDER_REVIEW: "수동 검토 중", RESOLVED: "결론 있음", CLOSED: "종료" } },
  fr: { newUpdates: "nouvelles mises à jour", latest: "Dernier état", unread: "Non lu", cardHours: "heures-carte KAI standard", paymentTruth: "Créer un ordre ou revenir de la caisse ne prouve pas le paiement. Le crédit apparaît uniquement après confirmation serveur et écriture au registre.", boundary: "Le CNY sert uniquement à acheter des heures-carte KAI, non retirables et non transférables.", modeAria: "Mode de sélection du montant", packageAria: "Forfaits d’heures-carte", amountHelp: "Minimum 5,00 heures-carte, par pas de 5,00.", pilot: "Recette de production limitée : seules 5,00 heures-carte sont proposées.", channelPending: "Les moyens de paiement terminent leur recette de production.", fixedRate: "Référence d’achat fixe", paymentNotice: "Seule la confirmation serveur crédite le compte ; les anomalies sont examinées manuellement.", historical: "Paiement historique", processing: "Traitement", appealUpdated: "Contestation mise à jour", viewAppeal: "Voir la contestation", topupProblem: "Problème de recharge", appealAfter: "Contestation possible après", noHistory: "Aucune recharge. Les résultats sont isolés par organisation.", loadSafe: "Les actifs en heures-carte sont momentanément indisponibles.", invalidSelection: "Choisissez un moyen disponible et une quantité valide.", createFailed: "Impossible de créer l’ordre de paiement. Réessayez plus tard.", unsafeCheckout: "L’adresse de paiement a échoué au contrôle de sécurité.", statusLabels: { PROCESSING: "Création du paiement", PENDING: "Confirmation en attente", CAPTURED: "Crédité", CLOSED: "Clos sans crédit", RECONCILIATION_REQUIRED: "Examen manuel requis" }, appealLabels: { OPEN: "Soumise", UNDER_REVIEW: "Examen manuel", RESOLVED: "Conclusion disponible", CLOSED: "Clôturée" } },
  th: { newUpdates: "รายการอัปเดตใหม่", latest: "สถานะล่าสุด", unread: "ยังไม่อ่าน", cardHours: "ชั่วโมงการ์ดมาตรฐาน KAI", paymentTruth: "การสร้างรายการหรือกลับจากหน้าชำระเงินไม่ใช่หลักฐานว่าชำระสำเร็จ ระบบจะแสดงเมื่อเซิร์ฟเวอร์ยืนยันและลงบัญชีแล้วเท่านั้น", boundary: "CNY ใช้ซื้อชั่วโมงการ์ด KAI เท่านั้น ไม่สามารถถอนหรือโอนได้", modeAria: "วิธีเลือกจำนวนเติม", packageAria: "แพ็กเกจชั่วโมงการ์ด", amountHelp: "ขั้นต่ำ 5.00 ชั่วโมงการ์ด และเพิ่มทีละ 5.00", pilot: "กำลังทดสอบการผลิตแบบจำนวนเล็ก รองรับ 5.00 ชั่วโมงการ์ดเท่านั้น", channelPending: "ช่องทางชำระเงินกำลังผ่านการทดสอบการผลิต", fixedRate: "ราคาอ้างอิงคงที่", paymentNotice: "จะลงบัญชีเมื่อเซิร์ฟเวอร์ยืนยันเท่านั้น และผู้ดูแลตรวจสอบข้อผิดปกติด้วยตนเอง", historical: "รายการชำระเงินเดิม", processing: "กำลังดำเนินการ", appealUpdated: "คำร้องมีอัปเดต", viewAppeal: "ดูคำร้อง", topupProblem: "ปัญหาการเติม", appealAfter: "ยื่นคำร้องได้หลัง", noHistory: "ยังไม่มีประวัติการเติม ผลลัพธ์แยกตามองค์กรปัจจุบัน", loadSafe: "สินทรัพย์ชั่วโมงการ์ดไม่พร้อมใช้งานชั่วคราว", invalidSelection: "เลือกวิธีชำระเงินที่เปิดใช้และจำนวนชั่วโมงการ์ดที่ถูกต้อง", createFailed: "สร้างรายการชำระเงินไม่สำเร็จ โปรดลองภายหลัง", unsafeCheckout: "ที่อยู่ชำระเงินไม่ผ่านการตรวจสอบความปลอดภัย", statusLabels: { PROCESSING: "กำลังสร้างการชำระ", PENDING: "รอยืนยันการชำระ", CAPTURED: "เข้าบัญชีแล้ว", CLOSED: "ปิดแล้ว (ไม่เข้าบัญชี)", RECONCILIATION_REQUIRED: "ต้องตรวจสอบด้วยเจ้าหน้าที่" }, appealLabels: { OPEN: "ส่งแล้ว", UNDER_REVIEW: "กำลังตรวจสอบ", RESOLVED: "มีข้อสรุปแล้ว", CLOSED: "ปิดแล้ว" } },
  vi: { newUpdates: "cập nhật mới", latest: "Trạng thái mới nhất", unread: "Chưa đọc", cardHours: "giờ-thẻ KAI tiêu chuẩn", paymentTruth: "Tạo đơn hoặc quay lại từ trang thanh toán không chứng minh đã trả tiền. Chỉ hiển thị sau khi máy chủ xác nhận và ghi sổ.", boundary: "CNY chỉ dùng mua giờ-thẻ KAI; giờ-thẻ không thể rút hoặc chuyển.", modeAria: "Cách chọn số lượng nạp", packageAria: "Gói nạp giờ-thẻ", amountHelp: "Tối thiểu 5,00 giờ-thẻ, theo bước 5,00.", pilot: "Đang nghiệm thu sản xuất giá trị nhỏ; chỉ hỗ trợ 5,00 giờ-thẻ.", channelPending: "Kênh thanh toán đang hoàn tất nghiệm thu sản xuất.", fixedRate: "Tham chiếu mua cố định", paymentNotice: "Chỉ máy chủ xác nhận mới ghi có; bất thường được quản trị viên kiểm tra thủ công.", historical: "Đơn thanh toán cũ", processing: "Đang xử lý", appealUpdated: "Khiếu nại có cập nhật", viewAppeal: "Xem khiếu nại", topupProblem: "Vấn đề nạp tiền", appealAfter: "Có thể khiếu nại sau", noHistory: "Chưa có lịch sử nạp. Kết quả được tách theo tổ chức hiện tại.", loadSafe: "Tài sản giờ-thẻ tạm thời không khả dụng.", invalidSelection: "Chọn phương thức đang mở và số giờ-thẻ hợp lệ.", createFailed: "Không thể tạo đơn thanh toán. Hãy thử lại sau.", unsafeCheckout: "Địa chỉ thanh toán không vượt qua kiểm tra bảo mật.", statusLabels: { PROCESSING: "Đang tạo thanh toán", PENDING: "Chờ xác nhận", CAPTURED: "Đã ghi có", CLOSED: "Đã đóng (chưa ghi có)", RECONCILIATION_REQUIRED: "Cần kiểm tra thủ công" }, appealLabels: { OPEN: "Đã gửi", UNDER_REVIEW: "Đang kiểm tra", RESOLVED: "Đã có kết luận", CLOSED: "Đã đóng" } },
  id: { newUpdates: "pembaruan baru", latest: "Status terbaru", unread: "Belum dibaca", cardHours: "jam-kartu standar KAI", paymentTruth: "Membuat pesanan atau kembali dari checkout tidak membuktikan pembayaran. Kredit muncul hanya setelah konfirmasi server dan pencatatan buku besar.", boundary: "CNY hanya untuk membeli jam-kartu KAI; jam-kartu tidak dapat ditarik atau ditransfer.", modeAria: "Cara memilih jumlah isi ulang", packageAria: "Paket isi ulang jam-kartu", amountHelp: "Minimum 5,00 jam-kartu dengan kelipatan 5,00.", pilot: "Penerimaan produksi nilai kecil aktif; hanya 5,00 jam-kartu didukung.", channelPending: "Kanal pembayaran sedang menyelesaikan penerimaan produksi.", fixedRate: "Referensi pembelian tetap", paymentNotice: "Hanya konfirmasi server yang memberi kredit; masalah diperiksa manual oleh admin.", historical: "Pembayaran historis", processing: "Memproses", appealUpdated: "Banding diperbarui", viewAppeal: "Lihat banding", topupProblem: "Masalah isi ulang", appealAfter: "Banding tersedia setelah", noHistory: "Belum ada riwayat isi ulang. Hasil dipisahkan per organisasi.", loadSafe: "Aset jam-kartu sementara tidak tersedia.", invalidSelection: "Pilih metode pembayaran tersedia dan jumlah jam-kartu yang valid.", createFailed: "Pesanan pembayaran gagal dibuat. Coba lagi nanti.", unsafeCheckout: "Alamat pembayaran gagal dalam pemeriksaan keamanan.", statusLabels: { PROCESSING: "Membuat pembayaran", PENDING: "Menunggu konfirmasi", CAPTURED: "Dikreditkan", CLOSED: "Ditutup (belum dikreditkan)", RECONCILIATION_REQUIRED: "Perlu tinjauan manual" }, appealLabels: { OPEN: "Dikirim", UNDER_REVIEW: "Ditinjau manual", RESOLVED: "Hasil tersedia", CLOSED: "Ditutup" } },
  ms: { newUpdates: "kemas kini baharu", latest: "Status terkini", unread: "Belum dibaca", cardHours: "jam-kad standard KAI", paymentTruth: "Mencipta pesanan atau kembali dari daftar keluar tidak membuktikan bayaran. Kredit hanya muncul selepas pengesahan pelayan dan catatan lejar.", boundary: "CNY hanya untuk membeli jam-kad KAI; jam-kad tidak boleh dikeluarkan atau dipindahkan.", modeAria: "Cara memilih jumlah tambah nilai", packageAria: "Pakej tambah nilai jam-kad", amountHelp: "Minimum 5.00 jam-kad dengan gandaan 5.00.", pilot: "Penerimaan pengeluaran nilai kecil aktif; hanya 5.00 jam-kad disokong.", channelPending: "Saluran bayaran sedang melengkapkan penerimaan pengeluaran.", fixedRate: "Rujukan pembelian tetap", paymentNotice: "Hanya pengesahan pelayan memberi kredit; masalah disemak manual oleh pentadbir.", historical: "Bayaran terdahulu", processing: "Memproses", appealUpdated: "Rayuan dikemas kini", viewAppeal: "Lihat rayuan", topupProblem: "Masalah tambah nilai", appealAfter: "Rayuan tersedia selepas", noHistory: "Belum ada sejarah tambah nilai. Hasil diasingkan mengikut organisasi.", loadSafe: "Aset jam-kad tidak tersedia sementara.", invalidSelection: "Pilih kaedah bayaran tersedia dan jumlah jam-kad yang sah.", createFailed: "Pesanan bayaran gagal dicipta. Cuba lagi kemudian.", unsafeCheckout: "Alamat bayaran gagal pemeriksaan keselamatan.", statusLabels: { PROCESSING: "Mencipta bayaran", PENDING: "Menunggu pengesahan", CAPTURED: "Dikreditkan", CLOSED: "Ditutup (belum dikreditkan)", RECONCILIATION_REQUIRED: "Perlu semakan manual" }, appealLabels: { OPEN: "Dihantar", UNDER_REVIEW: "Dalam semakan", RESOLVED: "Hasil tersedia", CLOSED: "Ditutup" } },
};
const COPY = Object.fromEntries(Object.entries(COPY_BASE).map(([locale, value]) => [locale, locale === "en" ? value : { ...value, ...CARD_HOUR_CORE_COPY[locale as Exclude<Locale, "en">] }])) as Record<Locale, Copy>;

function money(cents: number, locale: Locale) { return new Intl.NumberFormat(locale, { style: "currency", currency: "CNY" }).format(cents / 100); }
function dateTime(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function secureCheckoutUrl(value: string, message: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(message);
  return url.toString();
}

class SafeLoadError extends Error { constructor(readonly requestId?: string) { super("CARD_HOUR_ASSETS_UNAVAILABLE"); } }
function safeError(error: unknown, fallback: string, requestIdLabel: string) { const requestId = error instanceof MarketplaceApiError ? error.requestId : undefined; return requestId ? `${fallback} (${requestIdLabel}: ${requestId})` : fallback; }

export function MemberCardHourAssets() {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const [dashboard, setDashboard] = useState<CardHourDashboard | null>(null);
  const [loadError, setLoadError] = useState("");
  const [cardHours, setCardHours] = useState("100");
  const [amountMode, setAmountMode] = useState<"PACKAGE" | "CUSTOM">("PACKAGE");
  const [channel, setChannel] = useState<PaymentChannel | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const idempotencyKey = useRef<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/v1/member/card-hours", { credentials: "same-origin", cache: "no-store", signal });
    const payload = await response.json().catch(() => null) as (CardHourDashboard & { error?: { requestId?: string } }) | null;
    if (!response.ok || !payload) throw new SafeLoadError(payload?.error?.requestId);
    setDashboard(payload);
    const firstPackage = payload.topupAvailability.packages[0];
    if (firstPackage) setCardHours(String(payload.topupAvailability.mode === "PILOT" ? firstPackage.cardHours : 500));
    setAmountMode("PACKAGE");
    const firstReady = payload.topupAvailability.channels.find((item) => item.ready)?.channel ?? null;
    setChannel((current) => payload.topupAvailability.channels.some((item) => item.ready && item.channel === current) ? current : firstReady);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => {
      load(controller.signal).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const requestId = error instanceof SafeLoadError ? error.requestId : undefined;
        setLoadError(requestId ? `${copy.loadSafe} (${copy.requestId}: ${requestId})` : copy.loadSafe);
      });
    });
    return () => { window.cancelAnimationFrame(frame); controller.abort(); };
  }, [copy.loadSafe, copy.requestId, load]);

  const amount = Number(cardHours);
  const constraints = dashboard?.topupAvailability;
  const validAmount = Number.isSafeInteger(amount)
    && amount >= (constraints?.minCardHours ?? 5)
    && (constraints?.maxCardHours === null || constraints?.maxCardHours === undefined || amount <= constraints.maxCardHours)
    && amount % (constraints?.stepCardHours ?? 5) === 0;
  const amountCents = validAmount ? Math.round(amount * 100.2) : 0;
  const readyChannels = useMemo(() => dashboard?.topupAvailability.channels.filter((item) => item.ready) ?? [], [dashboard]);
  const appealByTopup = useMemo(() => new Map((dashboard?.appealNotifications ?? []).map((item) => [item.topupOrderId, item])), [dashboard]);

  async function createTopup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!dashboard?.topupAvailability.ready || !validAmount || !channel || !readyChannels.some((item) => item.channel === channel)) {
      setMessage(copy.invalidSelection);
      return;
    }
    setSubmitting(true);
    try {
      idempotencyKey.current ??= createIdempotencyKey(`card-hour-${channel.toLowerCase()}`);
      const result = await marketplacePost<TopupRecord, TopupCheckout>(
        "/api/v1/member/card-hours/topups",
        { cardHours, channel },
        idempotencyKey.current,
        20_000,
      );
      const checkoutUrl = secureCheckoutUrl(result.checkoutUrl, copy.unsafeCheckout);
      idempotencyKey.current = null;
      window.location.assign(checkoutUrl);
    } catch (error) {
      setMessage(safeError(error, copy.createFailed, copy.requestId));
      setSubmitting(false);
    }
  }

  if (loadError) return <section className={styles.returnPanel} role="alert"><h1>{copy.loadFailed}</h1><p>{loadError}</p><button className={styles.secondaryAction} onClick={() => { setLoadError(""); void load().catch((error: unknown) => { const requestId = error instanceof SafeLoadError ? error.requestId : undefined; setLoadError(requestId ? `${copy.loadSafe} (${copy.requestId}: ${requestId})` : copy.loadSafe); }); }} type="button">{copy.retry}</button></section>;
  if (!dashboard) return <div className={styles.returnPanel} role="status">{copy.loading}</div>;

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div><p className={styles.eyebrow}>MY ASSETS</p><h1>{copy.title}</h1><p>{copy.intro}</p></div>
        <dl className={styles.balance}><dt>{copy.available}</dt><dd>{formatCardHourDisplayMicros(dashboard.balance.availableMicros)}</dd></dl>
      </header>

      {dashboard.appealNotifications.length ? <section className={styles.panel} aria-labelledby="appeal-updates-title">
        <div className={styles.notificationHeading}><div><p className={styles.eyebrow}>APPEAL UPDATES</p><h2 id="appeal-updates-title">{copy.appeals}</h2></div>{dashboard.unreadAppealCount > 0 ? <strong>{dashboard.unreadAppealCount} {copy.newUpdates}</strong> : <span>{copy.latest}</span>}</div>
        <div className={styles.notificationList}>{dashboard.appealNotifications.slice(0, 5).map((item) => <Link className={styles.notification} href={`/member/card-hours/topups/${encodeURIComponent(item.topupOrderId)}/appeal`} key={item.caseNumber}><span>{item.unread ? copy.unread : copy.appealLabels[item.status]}</span><strong>{item.caseNumber}</strong><small>{copy.appealLabels[item.status]} · {dateTime(item.updatedAt, locale)}</small>{item.resolutionNote ? <em>{item.resolutionNote}</em> : null}</Link>)}</div>
      </section> : null}

      <div className={styles.grid}>
        <section className={styles.panel} aria-labelledby="asset-summary-title">
          <p className={styles.eyebrow}>ACCOUNT SUMMARY</p><h2 id="asset-summary-title">{copy.summary}</h2>
          <div className={styles.metrics}>
            <div><span>{copy.held}</span><strong>{formatCardHourDisplayMicros(dashboard.balance.heldMicros)}</strong><small>{copy.cardHours}</small></div>
            <div><span>{copy.totalTopup}</span><strong>{formatCardHourDisplayMicros(dashboard.balance.lifetimeTopupMicros)}</strong><small>{copy.cardHours}</small></div>
            <div><span>{copy.totalSpent}</span><strong>{formatCardHourDisplayMicros(dashboard.balance.lifetimeSpentMicros)}</strong><small>{copy.cardHours}</small></div>
          </div>
          <p className={styles.notice}>{copy.paymentTruth}</p>
        </section>

        <form className={styles.panel} onSubmit={createTopup}>
          <p className={styles.eyebrow}>TOP UP CARD HOURS</p><h2>{copy.topup}</h2>
          <p className={styles.boundary}>{copy.boundary}</p>
          <div className={styles.amountMode} role="tablist" aria-label={copy.modeAria}>
            <button aria-selected={amountMode === "PACKAGE"} disabled={submitting || dashboard.topupAvailability.mode === "PILOT"} onClick={() => setAmountMode("PACKAGE")} role="tab" type="button">{copy.packages}</button>
            <button aria-selected={amountMode === "CUSTOM"} disabled={submitting || dashboard.topupAvailability.mode === "PILOT"} onClick={() => setAmountMode("CUSTOM")} role="tab" type="button">{copy.custom}</button>
          </div>
          {amountMode === "PACKAGE" ? <div className={styles.packages} aria-label={copy.packageAria}>{dashboard.topupAvailability.packages.map((item) => {
            const selected = cardHours === String(item.cardHours);
            return <button aria-pressed={selected} className={styles.package} disabled={submitting} key={item.code} onClick={() => { idempotencyKey.current = null; setCardHours(String(item.cardHours)); }} type="button">
              <span>{item.name}{item.badge ? <small>{item.badge}</small> : null}</span><strong>{item.cardHours.toFixed(2)} {copy.cardHours}</strong><b>{money(item.amountCents, locale)}</b><em>{item.description}</em>
            </button>;
          })}</div> : <label className={styles.field} htmlFor="member-card-hour-amount">{copy.amount}<input id="member-card-hour-amount" inputMode="numeric" min={dashboard.topupAvailability.minCardHours} max={dashboard.topupAvailability.maxCardHours ?? undefined} onChange={(event) => { idempotencyKey.current = null; setCardHours(event.target.value); }} step={dashboard.topupAvailability.stepCardHours} type="number" value={cardHours} /><small>{copy.amountHelp}</small></label>}
          {dashboard.topupAvailability.mode === "PILOT" ? <p className={styles.pilot}>{copy.pilot}</p> : null}
          <fieldset className={styles.field}>
            <legend>{copy.chooseChannel}</legend>
            <div className={styles.channels}>{dashboard.topupAvailability.channels.map((item) => <button aria-pressed={channel === item.channel && item.ready} className={styles.channel} disabled={submitting || !item.ready} key={item.channel} onClick={() => { idempotencyKey.current = null; setChannel(item.channel); }} type="button"><strong>{item.channel === "ALIPAY" ? "Alipay" : "WeChat Pay"}</strong><small>{item.ready ? copy.open : copy.closed}</small></button>)}</div>
            {!readyChannels.length ? <p className={styles.notice}>{copy.channelPending}</p> : null}
          </fieldset>
          <dl className={styles.summary}><div><dt>{copy.fixedRate}</dt><dd>1.00 KAI = ¥1.002</dd></div><div><dt>{copy.credited}</dt><dd>{validAmount ? amount.toFixed(2) : "—"}</dd></div><div><dt>{copy.payable}</dt><dd>{validAmount ? money(amountCents, locale) : "—"}</dd></div></dl>
          {message ? <p className={styles.error} role="alert">{message}</p> : null}
          <button className={styles.primaryAction} disabled={submitting || !dashboard.topupAvailability.ready || !validAmount || !channel} type="submit">{submitting ? copy.creating : copy.pay}</button>
          <p className={styles.notice}>{copy.paymentNotice}</p>
        </form>
      </div>

      <section className={styles.panel} aria-labelledby="topup-history-title">
        <p className={styles.eyebrow}>TOP-UP HISTORY</p><h2 id="topup-history-title">{copy.history}</h2>
        {dashboard.topups.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{copy.order}</th><th>{copy.method}</th><th>{copy.cardHours}</th><th>{copy.money}</th><th>{copy.status}</th><th>{copy.created}</th><th>{copy.action}</th></tr></thead><tbody>{dashboard.topups.map((record) => {
          const appeal = appealByTopup.get(record.id);
          return <tr key={record.id}><td data-label={copy.order}><Link href={`/member/card-hours/topups/${encodeURIComponent(record.id)}/return`}>{record.id}</Link></td><td data-label={copy.method}>{record.channel ?? copy.historical}</td><td data-label={copy.cardHours}>{formatCardHourDisplayMicros(record.cardHourMicros)}</td><td data-label={copy.money}>{money(record.amountCents, locale)}</td><td data-label={copy.status}>{copy.statusLabels[record.status] ?? copy.processing}</td><td data-label={copy.created}>{dateTime(record.createdAt, locale)}</td><td data-label={copy.action}>{appeal ? <Link href={`/member/card-hours/topups/${encodeURIComponent(record.id)}/appeal`}>{appeal.unread ? copy.appealUpdated : `${copy.viewAppeal} · ${copy.appealLabels[appeal.status]}`}</Link> : record.appealEligibility.canAppeal ? <Link href={`/member/card-hours/topups/${encodeURIComponent(record.id)}/appeal`}>{copy.topupProblem}</Link> : record.appealEligibility.retryAt ? <small>{copy.appealAfter}: {dateTime(record.appealEligibility.retryAt, locale)}</small> : "—"}</td></tr>;
        })}</tbody></table></div> : <p>{copy.noHistory}</p>}
      </section>
    </div>
  );
}
