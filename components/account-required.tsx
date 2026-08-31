"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "./locale-provider";

const copy = {
  "zh-CN": { interrupted: "暂时无法确认登录状态", interruptedCopy: "页面没有收到统一账号会话结果。不会把网络异常误判成退出登录，也不会在状态不明时开放购买或供应操作。", retry: "重新检查登录状态", checking: "正在核对账户与交易主体…", redirecting: "正在前往统一账号登录…", signIn: "登录后继续", gateCopy: "正式上架、提交需求和创建订单必须绑定个人或企业主体。行情与公开资源仍可匿名浏览。", login: "统一账号登录", orgRequired: "需要一个已启用的交易主体", orgCopy: "当前账户尚未绑定可用的个人、企业、IDC 或云厂商主体。请联系 KAI 运营完成主体登记或审核。", approval: "当前交易主体尚未启用", approvalCopy: "可以继续浏览行情、资源和个人资料；购买、供应、订单和支付操作会保持关闭，直到主体审核通过。" },
  "zh-TW": { interrupted: "暫時無法確認登入狀態", interruptedCopy: "頁面未收到統一帳戶工作階段結果。網路異常不會被誤判為登出，狀態不明時亦不會開放購買或供應操作。", retry: "重新檢查登入狀態", checking: "正在核對帳戶與交易主體…", redirecting: "正在前往統一帳戶登入…", signIn: "登入後繼續", gateCopy: "正式上架、提交需求和建立訂單必須綁定個人或企業主體。行情與公開資源仍可匿名瀏覽。", login: "統一帳戶登入", orgRequired: "需要一個已啟用的交易主體", orgCopy: "目前帳戶尚未綁定可用的個人、企業、IDC 或雲端供應商主體。請聯絡 KAI 營運完成登記或審核。", approval: "目前交易主體尚未啟用", approvalCopy: "您仍可瀏覽行情、資源和個人資料；購買、供應、訂單和支付會保持關閉，直到審核通過。" },
  en: { interrupted: "Unable to confirm your sign-in status", interruptedCopy: "The unified account session did not respond. A network error will not be treated as a sign-out, and purchasing or supplying stays locked while the status is unknown.", retry: "Check sign-in status again", checking: "Checking your account and trading entity…", redirecting: "Opening unified account sign-in…", signIn: "Sign in to continue", gateCopy: "Listings, demand submissions and orders must be linked to a personal or business entity. Public market data and resources remain available anonymously.", login: "Unified account sign-in", orgRequired: "An active trading entity is required", orgCopy: "This account is not linked to an active individual, company, IDC or cloud-provider entity. Contact KAI operations to complete registration or review.", approval: "The current trading entity is not active", approvalCopy: "You can still browse markets, resources and your profile. Purchasing, supplying, orders and payments remain locked until approval." },
  ja: { interrupted: "ログイン状態を確認できません", interruptedCopy: "統合アカウントのセッション結果を受信できませんでした。ネットワーク障害をログアウトと誤認せず、状態不明の間は購入・供給操作を開放しません。", retry: "ログイン状態を再確認", checking: "アカウントと取引主体を確認中…", redirecting: "統合アカウントのログインへ移動中…", signIn: "ログインして続行", gateCopy: "出品、需要提出、注文作成には個人または法人の取引主体が必要です。公開市場とリソースは匿名でも閲覧できます。", login: "統合アカウントでログイン", orgRequired: "有効な取引主体が必要です", orgCopy: "このアカウントには有効な個人、企業、IDC、クラウド事業者の主体が紐付いていません。KAI 運営に登録または審査を依頼してください。", approval: "現在の取引主体は未承認です", approvalCopy: "市場、リソース、プロフィールは閲覧できます。承認されるまで購入、供給、注文、支払いは利用できません。" },
  ko: { interrupted: "로그인 상태를 확인할 수 없습니다", interruptedCopy: "통합 계정 세션 응답을 받지 못했습니다. 네트워크 오류를 로그아웃으로 처리하지 않으며 상태를 알 수 없는 동안 구매와 공급 작업은 잠깁니다.", retry: "로그인 상태 다시 확인", checking: "계정과 거래 주체 확인 중…", redirecting: "통합 계정 로그인으로 이동 중…", signIn: "로그인 후 계속", gateCopy: "등록, 수요 제출, 주문 생성에는 개인 또는 기업 거래 주체가 필요합니다. 공개 시세와 리소스는 익명으로 계속 볼 수 있습니다.", login: "통합 계정 로그인", orgRequired: "활성 거래 주체가 필요합니다", orgCopy: "이 계정에 활성 개인, 기업, IDC 또는 클라우드 공급자 주체가 연결되지 않았습니다. KAI 운영팀에 등록 또는 심사를 요청하세요.", approval: "현재 거래 주체가 활성화되지 않았습니다", approvalCopy: "시세, 리소스, 프로필은 계속 볼 수 있습니다. 승인 전까지 구매, 공급, 주문, 결제는 잠깁니다." },
  fr: { interrupted: "Impossible de confirmer la connexion", interruptedCopy: "La session du compte unifié n’a pas répondu. Une erreur réseau ne sera pas assimilée à une déconnexion et les opérations d’achat ou d’offre restent bloquées tant que l’état est inconnu.", retry: "Vérifier à nouveau la connexion", checking: "Vérification du compte et de l’entité…", redirecting: "Ouverture de la connexion unifiée…", signIn: "Se connecter pour continuer", gateCopy: "Les offres, demandes et commandes doivent être liées à une personne ou une entreprise. Les marchés et ressources publics restent accessibles anonymement.", login: "Connexion au compte unifié", orgRequired: "Une entité de transaction active est requise", orgCopy: "Ce compte n’est lié à aucune personne, entreprise, IDC ou fournisseur cloud actif. Contactez les opérations KAI pour terminer l’enregistrement ou la vérification.", approval: "L’entité de transaction actuelle n’est pas active", approvalCopy: "Vous pouvez consulter les marchés, ressources et votre profil. Les achats, offres, commandes et paiements restent bloqués jusqu’à l’approbation." },
  th: { interrupted: "ไม่สามารถยืนยันสถานะการเข้าสู่ระบบ", interruptedCopy: "ไม่ได้รับผลเซสชันจากบัญชีแบบรวม ระบบจะไม่ถือว่าข้อผิดพลาดเครือข่ายคือการออกจากระบบ และจะล็อกการซื้อหรือการเสนอทรัพยากรไว้ขณะสถานะยังไม่ชัดเจน", retry: "ตรวจสอบสถานะอีกครั้ง", checking: "กำลังตรวจสอบบัญชีและนิติบุคคล…", redirecting: "กำลังไปยังการเข้าสู่ระบบบัญชีแบบรวม…", signIn: "เข้าสู่ระบบเพื่อดำเนินการต่อ", gateCopy: "การลงรายการ ส่งความต้องการ และสร้างคำสั่งซื้อต้องผูกกับบุคคลหรือองค์กร แต่ยังเรียกดูตลาดและทรัพยากรสาธารณะโดยไม่เข้าสู่ระบบได้", login: "เข้าสู่ระบบบัญชีแบบรวม", orgRequired: "ต้องมีนิติบุคคลการซื้อขายที่เปิดใช้งาน", orgCopy: "บัญชีนี้ยังไม่เชื่อมโยงกับบุคคล บริษัท IDC หรือผู้ให้บริการคลาวด์ที่เปิดใช้งาน โปรดติดต่อฝ่ายปฏิบัติการ KAI", approval: "นิติบุคคลการซื้อขายปัจจุบันยังไม่เปิดใช้งาน", approvalCopy: "ยังดูตลาด ทรัพยากร และโปรไฟล์ได้ แต่การซื้อ การเสนอ คำสั่งซื้อ และการชำระเงินจะถูกล็อกจนกว่าจะอนุมัติ" },
  vi: { interrupted: "Không thể xác nhận trạng thái đăng nhập", interruptedCopy: "Trang chưa nhận được kết quả phiên tài khoản hợp nhất. Lỗi mạng sẽ không bị coi là đăng xuất và thao tác mua hoặc cung ứng vẫn bị khóa khi trạng thái chưa rõ.", retry: "Kiểm tra lại trạng thái đăng nhập", checking: "Đang kiểm tra tài khoản và chủ thể giao dịch…", redirecting: "Đang chuyển đến đăng nhập tài khoản hợp nhất…", signIn: "Đăng nhập để tiếp tục", gateCopy: "Đăng tài nguyên, gửi nhu cầu và tạo đơn hàng phải gắn với cá nhân hoặc doanh nghiệp. Dữ liệu thị trường và tài nguyên công khai vẫn có thể xem ẩn danh.", login: "Đăng nhập tài khoản hợp nhất", orgRequired: "Cần một chủ thể giao dịch đang hoạt động", orgCopy: "Tài khoản này chưa gắn với cá nhân, doanh nghiệp, IDC hoặc nhà cung cấp đám mây đang hoạt động. Hãy liên hệ vận hành KAI để đăng ký hoặc xét duyệt.", approval: "Chủ thể giao dịch hiện tại chưa hoạt động", approvalCopy: "Bạn vẫn có thể xem thị trường, tài nguyên và hồ sơ. Mua, cung ứng, đơn hàng và thanh toán bị khóa cho đến khi được duyệt." },
  id: { interrupted: "Status masuk tidak dapat dikonfirmasi", interruptedCopy: "Hasil sesi akun terpadu tidak diterima. Gangguan jaringan tidak akan dianggap sebagai keluar, dan pembelian atau penawaran tetap terkunci selama status belum diketahui.", retry: "Periksa kembali status masuk", checking: "Memeriksa akun dan entitas perdagangan…", redirecting: "Membuka proses masuk akun terpadu…", signIn: "Masuk untuk melanjutkan", gateCopy: "Listing, pengajuan kebutuhan, dan pembuatan pesanan harus terhubung ke individu atau badan usaha. Pasar dan sumber daya publik tetap dapat dilihat secara anonim.", login: "Masuk akun terpadu", orgRequired: "Entitas perdagangan aktif diperlukan", orgCopy: "Akun ini belum terhubung ke individu, perusahaan, IDC, atau penyedia cloud aktif. Hubungi operasi KAI untuk menyelesaikan pendaftaran atau peninjauan.", approval: "Entitas perdagangan saat ini belum aktif", approvalCopy: "Anda tetap dapat melihat pasar, sumber daya, dan profil. Pembelian, penawaran, pesanan, dan pembayaran terkunci hingga disetujui." },
  ms: { interrupted: "Status log masuk tidak dapat disahkan", interruptedCopy: "Keputusan sesi akaun bersepadu tidak diterima. Ralat rangkaian tidak akan dianggap sebagai log keluar, dan pembelian atau penawaran kekal dikunci ketika status belum diketahui.", retry: "Semak semula status log masuk", checking: "Menyemak akaun dan entiti perdagangan…", redirecting: "Membuka log masuk akaun bersepadu…", signIn: "Log masuk untuk meneruskan", gateCopy: "Penyenaraian, penghantaran keperluan dan pesanan mesti dipautkan kepada individu atau entiti perniagaan. Pasaran dan sumber awam kekal boleh dilihat secara anonim.", login: "Log masuk akaun bersepadu", orgRequired: "Entiti perdagangan aktif diperlukan", orgCopy: "Akaun ini belum dipautkan kepada individu, syarikat, IDC atau penyedia awan yang aktif. Hubungi operasi KAI untuk melengkapkan pendaftaran atau semakan.", approval: "Entiti perdagangan semasa belum aktif", approvalCopy: "Anda masih boleh melihat pasaran, sumber dan profil. Pembelian, penawaran, pesanan dan pembayaran dikunci sehingga diluluskan." },
} as const satisfies Record<Locale, Record<string, string>>;

type AccountSession = {
  authenticated: boolean;
  account?: { displayName?: string; primaryEmail?: string | null } | null;
  organization?: { id?: string; name?: string } | null;
  memberships?: Array<{ organizationId?: string; status?: string }>;
};

export function AccountRequired({ children, purpose, redirectOnSignedOut = false }: { children: ReactNode; purpose: string; redirectOnSignedOut?: boolean }) {
  const { locale } = useLocale();
  const text = copy[locale];
  const [session, setSession] = useState<AccountSession | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    const redirectToLogin = () => {
      const returnTo = window.location.pathname + window.location.search;
      window.location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    };
    fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.ok) return response.json() as Promise<AccountSession>;
        if (response.status === 401 || response.status === 403) return { authenticated: false };
        throw new Error("ACCOUNT_SESSION_UNAVAILABLE");
      })
      .then((nextSession) => {
        if (cancelled) return;
        setSession(nextSession);
        if (!nextSession.authenticated && redirectOnSignedOut) redirectToLogin();
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadVersion, redirectOnSignedOut]);

  if (loadError) {
    return (
      <section className="account-gate" aria-labelledby="account-session-error-title">
        <p className="kicker">ACCOUNT CHECK INTERRUPTED</p>
        <h2 id="account-session-error-title">{text.interrupted}</h2>
        <p>{text.interruptedCopy}</p>
        <button className="button button-primary" onClick={() => { setSession(null); setLoadError(false); setLoadVersion((current) => current + 1); }} type="button">
          {text.retry}
        </button>
      </section>
    );
  }

  if (session === null) {
    return <div className="account-gate" role="status">{text.checking}</div>;
  }

  if (!session.authenticated) {
    const returnTo = typeof window === "undefined" ? "/member" : window.location.pathname + window.location.search;
    if (redirectOnSignedOut) return <div className="account-gate" role="status">{text.redirecting}</div>;
    return (
      <section className="account-gate" aria-labelledby="account-gate-title">
        <p className="kicker">ACCOUNT REQUIRED</p>
        <h2 id="account-gate-title">{text.signIn}{locale === "zh-CN" || locale === "zh-TW" ? purpose : ""}</h2>
        <p>{text.gateCopy}</p>
        <Link className="button button-primary" href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>
          {text.login}
        </Link>
      </section>
    );
  }

  if (!session.organization) {
    return (
      <section className="account-gate" aria-labelledby="organization-gate-title">
        <p className="kicker">ORGANIZATION REQUIRED</p>
        <h2 id="organization-gate-title">{text.orgRequired}</h2>
        <p>{text.orgCopy}</p>
      </section>
    );
  }

  const activeMembership = session.memberships?.find((membership) => membership.organizationId === session.organization?.id);
  if (!activeMembership || activeMembership.status !== "ACTIVE") {
    return (
      <section className="account-gate" aria-labelledby="membership-gate-title">
        <p className="kicker">SUBJECT APPROVAL REQUIRED</p>
        <h2 id="membership-gate-title">{text.approval}</h2>
        <p>{text.approvalCopy}</p>
      </section>
    );
  }

  return <>{children}</>;
}
