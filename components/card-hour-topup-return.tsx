"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import { createIdempotencyKey, MarketplaceApiError, marketplacePost, safeMarketplaceErrorMessage } from "@/lib/client/marketplace-client";
import type { Locale } from "@/lib/i18n";
import styles from "./member-card-hour-assets.module.css";

type PaymentChannel = "ALIPAY" | "WXPAY";
type TopupStatus = "PROCESSING" | "PENDING" | "CAPTURED" | "CLOSED" | "RECONCILIATION_REQUIRED";
type TopupDetail = {
  id: string;
  channel: PaymentChannel;
  status: TopupStatus;
  credited: boolean;
  cardHourMicros: number;
  amountCents: number;
  currency: "CNY";
  expiresAt: string;
  appealEligibility: { canAppeal: boolean; retryAt: string | null };
};

type TopupReturnErrorCopy = { load: string; reconcile: string; requestId: string; retry: (seconds: number) => string };
const TOPUP_RETURN_ERROR_COPY = {
  "zh-CN": { load: "付款单状态暂时无法读取。", reconcile: "支付结果暂时无法核对。", requestId: "请求编号", retry: (seconds) => `可在 ${seconds} 秒后重试。` },
  "zh-TW": { load: "目前無法讀取付款單狀態。", reconcile: "目前無法核對付款結果。", requestId: "請求編號", retry: (seconds) => `可於 ${seconds} 秒後重試。` },
  en: { load: "The payment order status cannot be loaded right now.", reconcile: "The payment result cannot be verified right now.", requestId: "Request ID", retry: (seconds) => `Try again in ${seconds} seconds.` },
  ja: { load: "現在、支払い注文の状態を読み込めません。", reconcile: "現在、支払い結果を確認できません。", requestId: "リクエスト ID", retry: (seconds) => `${seconds} 秒後に再試行できます。` },
  ko: { load: "현재 결제 주문 상태를 불러올 수 없습니다.", reconcile: "현재 결제 결과를 확인할 수 없습니다.", requestId: "요청 ID", retry: (seconds) => `${seconds}초 후 다시 시도하세요.` },
  fr: { load: "L’état de l’ordre de paiement est momentanément indisponible.", reconcile: "Le résultat du paiement ne peut pas être vérifié actuellement.", requestId: "ID de requête", retry: (seconds) => `Réessayez dans ${seconds} secondes.` },
  th: { load: "ยังไม่สามารถโหลดสถานะรายการชำระเงินได้", reconcile: "ยังไม่สามารถตรวจสอบผลการชำระเงินได้", requestId: "รหัสคำขอ", retry: (seconds) => `ลองอีกครั้งใน ${seconds} วินาที` },
  vi: { load: "Hiện không thể tải trạng thái đơn thanh toán.", reconcile: "Hiện không thể xác minh kết quả thanh toán.", requestId: "ID yêu cầu", retry: (seconds) => `Thử lại sau ${seconds} giây.` },
  id: { load: "Status pesanan pembayaran belum dapat dimuat.", reconcile: "Hasil pembayaran belum dapat diverifikasi.", requestId: "ID permintaan", retry: (seconds) => `Coba lagi dalam ${seconds} detik.` },
  ms: { load: "Status pesanan bayaran belum dapat dimuatkan.", reconcile: "Hasil bayaran belum dapat disahkan.", requestId: "ID permintaan", retry: (seconds) => `Cuba lagi dalam ${seconds} saat.` },
} satisfies Record<Locale, TopupReturnErrorCopy>;

type TopupReturnCopy = {
  channel: Record<PaymentChannel, string>; creditedTitle: string; closedTitle: string; reviewTitle: string; processingTitle: string; waitingTitle: string;
  creditedDetail: string; closedDetail: string; reviewDetail: string; waitingDetail: string; order: string; method: string; cardHours: string; amount: string; serverStatus: string;
  confirmed: string; closed: string; review: string; processing: string; checking: string; reviewNotice: string; pendingNotice: string; recheck: string; appeal: string; back: string; appealAt: string;
};
const RETURN_EN: TopupReturnCopy = { channel: { ALIPAY: "Alipay", WXPAY: "WeChat Pay" }, creditedTitle: "Card-hours credited", closedTitle: "Payment order closed", reviewTitle: "Payment awaiting manual review", processingTitle: "Creating payment order", waitingTitle: "Waiting for payment confirmation", creditedDetail: "The platform server confirmed the payment and credited the card-hours.", closedDetail: "This order was not credited. If you were charged, keep the payment proof and request a manual review.", reviewDetail: "The platform is verifying the result under rate limits. Do not pay again or create another top-up.", waitingDetail: "Returning from checkout does not prove payment. The platform is waiting for a trusted payment notification.", order: "Payment order", method: "Payment method", cardHours: "Card-hours", amount: "Amount", serverStatus: "Server status", confirmed: "Confirmed and credited", closed: "Closed", review: "Manual review", processing: "Processing", checking: "The platform server is verifying the payment; browser return parameters are not trusted…", reviewNotice: "The result is not confirmed. The platform will continue controlled verification; do not pay again.", pendingNotice: "The result is still unconfirmed. A delay is not a failure and never causes automatic credit.", recheck: "Verify payment again", appeal: "Top-up problem / file an appeal", back: "Back to my assets", appealAt: "The payment is within the normal confirmation window. If unchanged, an appeal can be filed after" };
const TOPUP_RETURN_COPY: Record<Locale, TopupReturnCopy> = {
  en: RETURN_EN,
  "zh-CN": { channel: { ALIPAY: "支付宝", WXPAY: "微信支付" }, creditedTitle: "卡时已到账", closedTitle: "付款单已关闭", reviewTitle: "支付结果待人工核对", processingTitle: "付款单创建中", waitingTitle: "正在等待支付确认", creditedDetail: "平台服务端已经确认支付结果并完成卡时入账。", closedDetail: "该付款单未完成入账。如已扣款，请保留支付凭证并联系平台人工核对。", reviewDetail: "平台正在按限频规则主动核对支付结果。请勿重复付款，也不要重新发起充值。", waitingDetail: "从支付页面返回不代表付款成功。平台正在等待可信支付通知。", order: "付款单", method: "支付方式", cardHours: "购买卡时", amount: "支付金额", serverStatus: "服务端状态", confirmed: "已确认并入账", closed: "已关闭", review: "待人工核对", processing: "处理中", checking: "正在通过平台服务端核对支付结果，不读取浏览器回跳参数作为成功依据…", reviewNotice: "支付结果尚未确认，平台会继续受控核对；请勿重复付款。", pendingNotice: "支付结果仍未确认。延迟不等于失败，也不会自动入账。", recheck: "重新核对支付结果", appeal: "充值遇到问题／发起申诉", back: "返回我的资产", appealAt: "支付仍在正常确认时间内；如届时仍未更新，可于以下时间后发起申诉：" },
  "zh-TW": { ...RETURN_EN, channel: { ALIPAY: "支付寶", WXPAY: "微信支付" }, creditedTitle: "卡時已到帳", closedTitle: "付款單已關閉", reviewTitle: "付款待人工核對", processingTitle: "正在建立付款單", waitingTitle: "等待付款確認", creditedDetail: "平台服務端已確認付款並完成卡時入帳。", closedDetail: "此付款單未入帳；如已扣款，請保留憑證並申請人工核對。", reviewDetail: "平台正受控核對付款結果，請勿重複付款或儲值。", waitingDetail: "從結帳頁返回不代表付款成功，平台正等待可信通知。", order: "付款單", method: "付款方式", cardHours: "購買卡時", amount: "付款金額", serverStatus: "服務端狀態", confirmed: "已確認並入帳", closed: "已關閉", review: "待人工核對", processing: "處理中", checking: "服務端正在核對付款，不採信瀏覽器回跳參數…", reviewNotice: "結果尚未確認，請勿重複付款。", pendingNotice: "結果仍未確認；延遲不等於失敗，也不會自動入帳。", recheck: "重新核對付款", appeal: "儲值問題／提出申訴", back: "返回我的資產", appealAt: "若仍未更新，可於此時間後申訴：" },
  ja: { ...RETURN_EN, creditedTitle: "カード時を入帳しました", closedTitle: "支払い注文は終了しました", reviewTitle: "手動確認待ち", processingTitle: "支払い注文を作成中", waitingTitle: "支払い確認待ち", creditedDetail: "サーバーが支払いを確認し、カード時を入帳しました。", closedDetail: "未入帳です。引き落とされた場合は証明を保存して手動確認を申請してください。", reviewDetail: "結果を制御下で確認中です。重複して支払わないでください。", waitingDetail: "決済画面からの戻りは成功を意味しません。信頼できる通知を待っています。", order: "支払い注文", method: "支払い方法", cardHours: "カード時", amount: "金額", serverStatus: "サーバー状態", confirmed: "確認・入帳済み", closed: "終了", review: "手動確認", processing: "処理中", checking: "サーバーで支払いを確認中です…", reviewNotice: "未確認です。重複して支払わないでください。", pendingNotice: "まだ未確認です。遅延は失敗や自動入帳を意味しません。", recheck: "支払いを再確認", appeal: "チャージ問題／申立て", back: "資産へ戻る", appealAt: "更新されない場合、次の時刻以降に申立てできます：" },
  ko: { ...RETURN_EN, creditedTitle: "카드시간 입금 완료", closedTitle: "결제 주문 종료", reviewTitle: "수동 확인 대기", processingTitle: "결제 주문 생성 중", waitingTitle: "결제 확인 대기", creditedDetail: "서버가 결제를 확인하고 카드시간을 반영했습니다.", closedDetail: "반영되지 않았습니다. 출금됐다면 증빙을 보관하고 수동 확인을 요청하세요.", reviewDetail: "결과를 제한적으로 확인 중입니다. 중복 결제하지 마세요.", waitingDetail: "결제창 복귀는 성공을 뜻하지 않습니다. 신뢰할 수 있는 알림을 기다립니다.", order: "결제 주문", method: "결제 방법", cardHours: "카드시간", amount: "금액", serverStatus: "서버 상태", confirmed: "확인 및 반영됨", closed: "종료", review: "수동 확인", processing: "처리 중", checking: "서버에서 결제를 확인 중입니다…", reviewNotice: "아직 확인되지 않았습니다. 중복 결제하지 마세요.", pendingNotice: "결과가 미확인입니다. 지연은 실패나 자동 반영을 뜻하지 않습니다.", recheck: "결제 다시 확인", appeal: "충전 문제／이의제기", back: "내 자산으로", appealAt: "변경이 없으면 다음 시각 이후 이의제기할 수 있습니다：" },
  fr: { ...RETURN_EN, creditedTitle: "Heures-carte créditées", closedTitle: "Ordre de paiement clos", reviewTitle: "Paiement en examen manuel", processingTitle: "Création du paiement", waitingTitle: "Confirmation du paiement", creditedDetail: "Le serveur a confirmé le paiement et crédité les heures-carte.", closedDetail: "Aucun crédit. Si vous avez été débité, conservez la preuve et demandez un examen manuel.", reviewDetail: "Le résultat est vérifié sous contrôle. Ne payez pas une seconde fois.", waitingDetail: "Le retour de la caisse ne prouve pas le paiement. La plateforme attend une notification fiable.", order: "Ordre de paiement", method: "Moyen de paiement", cardHours: "Heures-carte", amount: "Montant", serverStatus: "État serveur", confirmed: "Confirmé et crédité", closed: "Clos", review: "Examen manuel", processing: "Traitement", checking: "Vérification du paiement côté serveur…", reviewNotice: "Résultat non confirmé ; ne payez pas de nouveau.", pendingNotice: "Résultat non confirmé. Un délai n’est ni un échec ni un crédit automatique.", recheck: "Revérifier le paiement", appeal: "Problème de recharge／contester", back: "Retour à mes actifs", appealAt: "Sans mise à jour, une contestation sera possible après :" },
  th: { ...RETURN_EN, creditedTitle: "ชั่วโมงการ์ดเข้าบัญชีแล้ว", closedTitle: "ปิดรายการชำระเงินแล้ว", reviewTitle: "รอตรวจสอบด้วยเจ้าหน้าที่", processingTitle: "กำลังสร้างรายการชำระ", waitingTitle: "รอยืนยันการชำระ", creditedDetail: "เซิร์ฟเวอร์ยืนยันการชำระและลงชั่วโมงการ์ดแล้ว", closedDetail: "รายการนี้ยังไม่เข้าบัญชี หากถูกหักเงินให้เก็บหลักฐานและขอตรวจสอบ", reviewDetail: "ระบบกำลังตรวจสอบผล โปรดอย่าชำระซ้ำ", waitingDetail: "การกลับจากหน้าชำระไม่ใช่หลักฐานสำเร็จ ระบบกำลังรอการแจ้งที่เชื่อถือได้", order: "รายการชำระ", method: "วิธีชำระ", cardHours: "ชั่วโมงการ์ด", amount: "จำนวนเงิน", serverStatus: "สถานะเซิร์ฟเวอร์", confirmed: "ยืนยันและเข้าบัญชีแล้ว", closed: "ปิดแล้ว", review: "ตรวจสอบด้วยเจ้าหน้าที่", processing: "กำลังดำเนินการ", checking: "เซิร์ฟเวอร์กำลังตรวจสอบการชำระ…", reviewNotice: "ยังไม่ยืนยันผล โปรดอย่าชำระซ้ำ", pendingNotice: "ผลยังไม่ยืนยัน ความล่าช้าไม่ใช่ความล้มเหลวหรือการเข้าบัญชีอัตโนมัติ", recheck: "ตรวจสอบการชำระอีกครั้ง", appeal: "ปัญหาการเติม／ยื่นคำร้อง", back: "กลับไปสินทรัพย์", appealAt: "หากยังไม่อัปเดต สามารถยื่นคำร้องหลังเวลา：" },
  vi: { ...RETURN_EN, creditedTitle: "Đã ghi có giờ-thẻ", closedTitle: "Đơn thanh toán đã đóng", reviewTitle: "Chờ kiểm tra thủ công", processingTitle: "Đang tạo đơn thanh toán", waitingTitle: "Chờ xác nhận thanh toán", creditedDetail: "Máy chủ đã xác nhận thanh toán và ghi có giờ-thẻ.", closedDetail: "Đơn chưa được ghi có. Nếu đã bị trừ tiền, hãy lưu bằng chứng và yêu cầu kiểm tra.", reviewDetail: "Hệ thống đang kiểm tra kết quả; đừng thanh toán lại.", waitingDetail: "Quay lại từ trang thanh toán không chứng minh thành công. Hệ thống đang chờ thông báo tin cậy.", order: "Đơn thanh toán", method: "Phương thức", cardHours: "Giờ-thẻ", amount: "Số tiền", serverStatus: "Trạng thái máy chủ", confirmed: "Đã xác nhận và ghi có", closed: "Đã đóng", review: "Kiểm tra thủ công", processing: "Đang xử lý", checking: "Máy chủ đang xác minh thanh toán…", reviewNotice: "Kết quả chưa xác nhận; đừng thanh toán lại.", pendingNotice: "Kết quả chưa xác nhận. Chậm trễ không phải thất bại hay tự động ghi có.", recheck: "Kiểm tra lại thanh toán", appeal: "Vấn đề nạp／khiếu nại", back: "Về tài sản", appealAt: "Nếu chưa cập nhật, có thể khiếu nại sau：" },
  id: { ...RETURN_EN, creditedTitle: "Jam-kartu dikreditkan", closedTitle: "Pesanan pembayaran ditutup", reviewTitle: "Menunggu tinjauan manual", processingTitle: "Membuat pesanan pembayaran", waitingTitle: "Menunggu konfirmasi", creditedDetail: "Server mengonfirmasi pembayaran dan mengkreditkan jam-kartu.", closedDetail: "Pesanan belum dikreditkan. Jika saldo terpotong, simpan bukti dan minta tinjauan.", reviewDetail: "Hasil sedang diperiksa; jangan membayar lagi.", waitingDetail: "Kembali dari checkout bukan bukti keberhasilan. Sistem menunggu notifikasi tepercaya.", order: "Pesanan pembayaran", method: "Metode pembayaran", cardHours: "Jam-kartu", amount: "Jumlah", serverStatus: "Status server", confirmed: "Dikonfirmasi dan dikreditkan", closed: "Ditutup", review: "Tinjauan manual", processing: "Memproses", checking: "Server sedang memverifikasi pembayaran…", reviewNotice: "Hasil belum dikonfirmasi; jangan membayar lagi.", pendingNotice: "Hasil belum dikonfirmasi. Penundaan bukan kegagalan atau kredit otomatis.", recheck: "Periksa pembayaran lagi", appeal: "Masalah isi ulang／banding", back: "Kembali ke aset", appealAt: "Jika belum berubah, banding dapat diajukan setelah：" },
  ms: { ...RETURN_EN, creditedTitle: "Jam-kad dikreditkan", closedTitle: "Pesanan bayaran ditutup", reviewTitle: "Menunggu semakan manual", processingTitle: "Mencipta pesanan bayaran", waitingTitle: "Menunggu pengesahan", creditedDetail: "Pelayan mengesahkan bayaran dan mengkreditkan jam-kad.", closedDetail: "Pesanan belum dikreditkan. Jika baki ditolak, simpan bukti dan minta semakan.", reviewDetail: "Hasil sedang disemak; jangan bayar lagi.", waitingDetail: "Kembali dari daftar keluar bukan bukti kejayaan. Sistem menunggu pemberitahuan dipercayai.", order: "Pesanan bayaran", method: "Kaedah bayaran", cardHours: "Jam-kad", amount: "Jumlah", serverStatus: "Status pelayan", confirmed: "Disahkan dan dikreditkan", closed: "Ditutup", review: "Semakan manual", processing: "Memproses", checking: "Pelayan sedang mengesahkan bayaran…", reviewNotice: "Hasil belum disahkan; jangan bayar lagi.", pendingNotice: "Hasil belum disahkan. Kelewatan bukan kegagalan atau kredit automatik.", recheck: "Semak bayaran lagi", appeal: "Masalah tambah nilai／rayuan", back: "Kembali ke aset", appealAt: "Jika belum berubah, rayuan boleh dibuat selepas：" },
};

function money(cents: number, locale: Locale) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "CNY" }).format(cents / 100);
}
function dateTime(value: string, locale: Locale) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date); }

export function CardHourTopupReturn({ orderId }: { orderId: string }) {
  const { locale } = useLocale();
  const errorCopy = TOPUP_RETURN_ERROR_COPY[locale];
  const copy = TOPUP_RETURN_COPY[locale];
  const [record, setRecord] = useState<TopupDetail | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);
  const pollCount = useRef(0);

  const check = useCallback(async (signal?: AbortSignal) => {
    setError("");
    const response = await fetch(`/api/v1/member/card-hours/topups/${encodeURIComponent(orderId)}`, { credentials: "same-origin", cache: "no-store", signal });
    const payload = await response.json().catch(() => null) as { record?: TopupDetail; error?: { code?: string; requestId?: string } } | null;
    if (!response.ok || !payload?.record) throw new MarketplaceApiError({ code: payload?.error?.code ?? (response.ok ? "INVALID_RESPONSE" : `HTTP_${response.status}`), message: "REQUEST_FAILED", requestId: payload?.error?.requestId, status: response.status });
    setRecord(payload.record);
    return payload.record;
  }, [orderId]);

  const reconcile = useCallback(async () => {
    setError("");
    const payload = await marketplacePost<TopupDetail, { record: TopupDetail; reconciled: boolean; replayed: boolean }>(
      `/api/v1/member/card-hours/topups/${encodeURIComponent(orderId)}`,
      {},
      createIdempotencyKey(`card-hour-reconcile-${orderId}`),
      12_000,
    );
    setRecord(payload.record);
    return payload.record;
  }, [orderId]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        let current: TopupDetail;
        if (pollCount.current % 10 === 0) {
          try { current = await reconcile(); }
          catch { current = await check(controller.signal); }
        } else current = await check(controller.signal);
        if (cancelled || (current.status === "CAPTURED" && current.credited) || current.status === "CLOSED") {
          setChecking(false);
          return;
        }
        pollCount.current += 1;
        if (pollCount.current >= 40) {
          setChecking(false);
          return;
        }
        timer = window.setTimeout(poll, 3_000);
      } catch (reason) {
        if (cancelled || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setError(safeMarketplaceErrorMessage(reason, errorCopy.load, { requestIdLabel: errorCopy.requestId, retryAfter: errorCopy.retry }));
        setChecking(false);
      }
    };
    void poll();
    return () => { cancelled = true; controller.abort(); if (timer) window.clearTimeout(timer); };
  }, [check, errorCopy, reconcile]);

  const credited = record?.status === "CAPTURED" && record.credited === true;
  const closed = record?.status === "CLOSED";
  const reconciliationRequired = record?.status === "RECONCILIATION_REQUIRED";
  const title = credited ? copy.creditedTitle : closed ? copy.closedTitle : reconciliationRequired ? copy.reviewTitle : record?.status === "PROCESSING" ? copy.processingTitle : copy.waitingTitle;
  const detail = credited
    ? copy.creditedDetail
    : closed
      ? copy.closedDetail
      : reconciliationRequired
        ? copy.reviewDetail
      : copy.waitingDetail;

  return (
    <div className={styles.returnPage}>
      <section className={styles.returnPanel} aria-live="polite">
        <p className={styles.eyebrow}>PAYMENT STATUS</p><h1>{title}</h1><p>{detail}</p>
        {record ? <dl className={styles.returnFacts}><div><dt>{copy.order}</dt><dd>{record.id}</dd></div><div><dt>{copy.method}</dt><dd>{copy.channel[record.channel]}</dd></div><div><dt>{copy.cardHours}</dt><dd>{formatCardHourDisplayMicros(record.cardHourMicros)}</dd></div><div><dt>{copy.amount}</dt><dd>{money(record.amountCents, locale)}</dd></div><div><dt>{copy.serverStatus}</dt><dd>{credited ? copy.confirmed : closed ? copy.closed : reconciliationRequired ? copy.review : copy.processing}</dd></div></dl> : null}
        {checking && !credited && !closed ? <p className={styles.notice} role="status">{copy.checking}</p> : null}
        {reconciliationRequired ? <p className={styles.notice} role="status">{copy.reviewNotice}</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {!checking && !credited && !closed ? <p className={styles.notice}>{copy.pendingNotice}</p> : null}
        <div className={styles.actions}>
          {!checking && !credited && !closed ? <button className={styles.primaryAction} onClick={() => { setChecking(true); pollCount.current = 0; void reconcile().then(() => setChecking(false)).catch((reason: unknown) => { setError(safeMarketplaceErrorMessage(reason, errorCopy.reconcile, { requestIdLabel: errorCopy.requestId, retryAfter: errorCopy.retry })); setChecking(false); }); }} type="button">{copy.recheck}</button> : null}
          {!credited && record?.appealEligibility.canAppeal ? <Link className={styles.secondaryAction} href={`/member/card-hours/topups/${encodeURIComponent(orderId)}/appeal`}>{copy.appeal}</Link> : null}
          <Link className={styles.secondaryAction} href="/member/card-hours">{copy.back}</Link>
        </div>
        {!credited && record?.appealEligibility.retryAt && !record.appealEligibility.canAppeal ? <p className={styles.notice}>{copy.appealAt} {dateTime(record.appealEligibility.retryAt, locale)}</p> : null}
      </section>
    </div>
  );
}
