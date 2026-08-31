"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useLocale } from "@/components/locale-provider";
import type { Locale } from "@/lib/i18n";

const WATCHLIST_KEY = "kai-cloud-watchlist-v1";

type ResourceDetailActionsCopy = {
  maintenance: string;
  inquiryAria: string;
  demandAria: string;
  submitInquiry: string;
  submitDemand: string;
  watched: string;
  watch: string;
  localOnly: string;
  maintenanceHelp: string;
  inquiryHelp: string;
  demandHelp: string;
};

const RESOURCE_DETAIL_ACTIONS_COPY = {
  "zh-CN": { maintenance: "人工询价维护中", inquiryAria: "登录后询价{title}", demandAria: "基于{title}提交需求", submitInquiry: "登录后提交询价", submitDemand: "提交相关算力需求", watched: "已关注此资源", watch: "关注此资源", localOnly: "关注状态仅保存在当前设备。", maintenanceHelp: "当前只能浏览供应商报价，人工询价入口尚未开放。", inquiryHelp: "提交仅生成询价申请，不锁库存、不支付、不成交。", demandHelp: "提交需求不会自动触发采购、支付或资源开通。" },
  "zh-TW": { maintenance: "人工詢價維護中", inquiryAria: "登入後詢價{title}", demandAria: "依{title}提交需求", submitInquiry: "登入後提交詢價", submitDemand: "提交相關算力需求", watched: "已關注此資源", watch: "關注此資源", localOnly: "關注狀態僅保存在目前裝置。", maintenanceHelp: "目前只能瀏覽供應商報價，人工詢價入口尚未開放。", inquiryHelp: "提交只會建立詢價申請，不鎖定庫存、不付款、不成交。", demandHelp: "提交需求不會自動觸發採購、付款或資源開通。" },
  en: { maintenance: "Manual inquiries are under maintenance", inquiryAria: "Sign in to inquire about {title}", demandAria: "Submit a request based on {title}", submitInquiry: "Sign in to submit inquiry", submitDemand: "Submit related compute request", watched: "Resource followed", watch: "Follow resource", localOnly: "Follow status is saved only on this device. ", maintenanceHelp: "Supplier quotes remain visible, but manual inquiries are not open yet.", inquiryHelp: "Submission creates an inquiry only; it does not reserve inventory, take payment, or create a transaction.", demandHelp: "Submitting a request does not automatically trigger procurement, payment, or provisioning." },
  ja: { maintenance: "手動問い合わせはメンテナンス中です", inquiryAria: "ログインして{title}を問い合わせる", demandAria: "{title}に基づく需要を送信", submitInquiry: "ログインして問い合わせる", submitDemand: "関連する需要を送信", watched: "このリソースをフォロー中", watch: "このリソースをフォロー", localOnly: "フォロー状態はこの端末にのみ保存されます。", maintenanceHelp: "供給元の見積は閲覧できますが、手動問い合わせはまだ利用できません。", inquiryHelp: "送信されるのは問い合わせのみで、在庫確保・支払い・成約は行われません。", demandHelp: "需要の送信だけで調達・支払い・開通が自動実行されることはありません。" },
  ko: { maintenance: "수동 문의 점검 중", inquiryAria: "로그인 후 {title} 문의", demandAria: "{title} 기반 수요 제출", submitInquiry: "로그인 후 문의 제출", submitDemand: "관련 컴퓨팅 수요 제출", watched: "이 리소스를 팔로우 중", watch: "이 리소스 팔로우", localOnly: "팔로우 상태는 현재 기기에만 저장됩니다. ", maintenanceHelp: "공급자 견적은 볼 수 있지만 수동 문의는 아직 열리지 않았습니다.", inquiryHelp: "제출 시 문의만 생성되며 재고 예약, 결제 또는 거래가 이루어지지 않습니다.", demandHelp: "수요 제출만으로 구매, 결제 또는 프로비저닝이 자동 실행되지 않습니다." },
  fr: { maintenance: "Demandes manuelles en maintenance", inquiryAria: "Se connecter pour demander un devis sur {title}", demandAria: "Soumettre un besoin fondé sur {title}", submitInquiry: "Se connecter et demander un devis", submitDemand: "Soumettre un besoin associé", watched: "Ressource suivie", watch: "Suivre cette ressource", localOnly: "Le suivi est enregistré uniquement sur cet appareil. ", maintenanceHelp: "Les devis restent consultables, mais les demandes manuelles ne sont pas encore ouvertes.", inquiryHelp: "La soumission crée uniquement une demande : aucun stock, paiement ou achat n’est engagé.", demandHelp: "La soumission n’entraîne automatiquement ni achat, ni paiement, ni mise à disposition." },
  th: { maintenance: "ระบบสอบถามราคาโดยเจ้าหน้าที่อยู่ระหว่างปรับปรุง", inquiryAria: "เข้าสู่ระบบเพื่อสอบถาม {title}", demandAria: "ส่งความต้องการจาก {title}", submitInquiry: "เข้าสู่ระบบและส่งคำขอราคา", submitDemand: "ส่งความต้องการที่เกี่ยวข้อง", watched: "ติดตามทรัพยากรนี้แล้ว", watch: "ติดตามทรัพยากรนี้", localOnly: "สถานะการติดตามบันทึกไว้ในอุปกรณ์นี้เท่านั้น ", maintenanceHelp: "ยังดูราคาอ้างอิงได้ แต่ช่องทางสอบถามโดยเจ้าหน้าที่ยังไม่เปิด", inquiryHelp: "การส่งจะสร้างเพียงคำขอราคา ไม่ได้จองสต็อก ชำระเงิน หรือทำรายการซื้อขาย", demandHelp: "การส่งความต้องการจะไม่เริ่มการจัดซื้อ การชำระเงิน หรือการเปิดใช้งานโดยอัตโนมัติ" },
  vi: { maintenance: "Kênh hỏi giá thủ công đang bảo trì", inquiryAria: "Đăng nhập để hỏi giá {title}", demandAria: "Gửi nhu cầu dựa trên {title}", submitInquiry: "Đăng nhập và gửi yêu cầu giá", submitDemand: "Gửi nhu cầu liên quan", watched: "Đang theo dõi tài nguyên", watch: "Theo dõi tài nguyên", localOnly: "Trạng thái theo dõi chỉ được lưu trên thiết bị này. ", maintenanceHelp: "Bạn vẫn có thể xem báo giá nhà cung cấp, nhưng kênh hỏi giá thủ công chưa mở.", inquiryHelp: "Việc gửi chỉ tạo yêu cầu giá; không giữ hàng, không thanh toán và không phát sinh giao dịch.", demandHelp: "Gửi nhu cầu không tự động kích hoạt mua sắm, thanh toán hoặc cấp phát." },
  id: { maintenance: "Permintaan manual sedang dalam pemeliharaan", inquiryAria: "Masuk untuk meminta penawaran {title}", demandAria: "Ajukan kebutuhan berdasarkan {title}", submitInquiry: "Masuk dan ajukan penawaran", submitDemand: "Ajukan kebutuhan terkait", watched: "Sumber daya diikuti", watch: "Ikuti sumber daya", localOnly: "Status mengikuti hanya disimpan di perangkat ini. ", maintenanceHelp: "Penawaran pemasok tetap dapat dilihat, tetapi permintaan manual belum dibuka.", inquiryHelp: "Pengajuan hanya membuat permintaan; tidak memesan stok, mengambil pembayaran, atau membuat transaksi.", demandHelp: "Pengajuan kebutuhan tidak otomatis memicu pembelian, pembayaran, atau penyediaan." },
  ms: { maintenance: "Pertanyaan manual sedang diselenggara", inquiryAria: "Log masuk untuk bertanya tentang {title}", demandAria: "Hantar keperluan berdasarkan {title}", submitInquiry: "Log masuk dan hantar pertanyaan", submitDemand: "Hantar keperluan berkaitan", watched: "Sumber diikuti", watch: "Ikuti sumber", localOnly: "Status ikutan hanya disimpan pada peranti ini. ", maintenanceHelp: "Sebut harga pembekal masih boleh dilihat, tetapi pertanyaan manual belum dibuka.", inquiryHelp: "Hantaran hanya mewujudkan pertanyaan; tiada stok dikunci, bayaran dibuat atau transaksi diwujudkan.", demandHelp: "Menghantar keperluan tidak mencetuskan perolehan, bayaran atau penyediaan secara automatik." },
} satisfies Record<Locale, ResourceDetailActionsCopy>;

function interpolate(template: string, title: string) {
  return template.replace("{title}", title);
}

function readWatchlist(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WATCHLIST_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function subscribeWatchlist(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("kai-watchlist-changed", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("kai-watchlist-changed", onStoreChange);
  };
}

export function ResourceDetailActions({
  resourceId,
  resourceTitle,
  requestHref,
  inquiryHref,
  inquiryUnavailable = false,
}: {
  resourceId: string;
  resourceTitle: string;
  requestHref: string;
  inquiryHref?: string;
  inquiryUnavailable?: boolean;
}) {
  const { locale } = useLocale();
  const copy = RESOURCE_DETAIL_ACTIONS_COPY[locale];
  const watched = useSyncExternalStore(
    subscribeWatchlist,
    () => readWatchlist().includes(resourceId),
    () => false,
  );

  function toggleWatch() {
    const current = readWatchlist();
    const next = current.includes(resourceId)
      ? current.filter((id) => id !== resourceId)
      : [...current, resourceId];

    window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("kai-watchlist-changed", { detail: next }));
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
      {inquiryUnavailable ? <span className="button button-secondary w-full cursor-not-allowed" aria-disabled="true">{copy.maintenance}</span> : <Link
        className="button button-primary w-full"
        href={inquiryHref ?? requestHref}
        aria-label={interpolate(inquiryHref ? copy.inquiryAria : copy.demandAria, resourceTitle)}
      >
        {inquiryHref ? copy.submitInquiry : copy.submitDemand}
        <span aria-hidden="true">→</span>
      </Link>}
      <button
        className="button button-secondary w-full cursor-pointer"
        type="button"
        aria-pressed={watched}
        onClick={toggleWatch}
      >
        <span aria-hidden="true">{watched ? "●" : "○"}</span>
        {watched ? copy.watched : copy.watch}
      </button>
      <p className="m-0 text-xs leading-5 text-[var(--muted)] sm:col-span-2 lg:col-span-1">
        {copy.localOnly}{inquiryUnavailable ? copy.maintenanceHelp : inquiryHref ? copy.inquiryHelp : copy.demandHelp}
      </p>
    </div>
  );
}
