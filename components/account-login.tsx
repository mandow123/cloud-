"use client";

import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "./locale-provider";

const copy = {
  "zh-CN": { title: "登录或注册个人账户", intro: "使用 KAI 统一账户进入 Cloud。新用户可完成邮箱注册和验证码验证，已有用户直接登录。", expired: "登录未完成或事务已过期，请重新发起登录。", unconfigured: "统一账户应用尚未完成生产登记，登录入口暂不可用。", unavailable: "KAI Identity 当前不可用", upstream: "这不是您的账号或授权选择问题。平台已识别上游连接异常，请修复后重试。", login: "使用 KAI Identity 登录 / 注册", retry: "重新检查账户中心", verify: "注册与邮箱验证", verifyBy: "由 auth.kai.com 安全完成", session: "Cloud 本地会话", sessionCopy: "登录成功后独立管理与退出", identity: "身份中心", register: "注册账户", browse: "继续匿名浏览资源" },
  "zh-TW": { title: "登入或註冊個人帳戶", intro: "使用 KAI 統一帳戶進入 Cloud。新使用者可完成電郵註冊與驗證碼驗證，現有使用者可直接登入。", expired: "登入未完成或交易已過期，請重新發起登入。", unconfigured: "統一帳戶應用尚未完成正式登記，登入入口暫不可用。", unavailable: "KAI Identity 目前不可用", upstream: "這不是您的帳戶或授權選擇問題。平台已識別上游連線異常，請修復後重試。", login: "使用 KAI Identity 登入 / 註冊", retry: "重新檢查帳戶中心", verify: "註冊與電郵驗證", verifyBy: "由 auth.kai.com 安全完成", session: "Cloud 本地工作階段", sessionCopy: "登入成功後獨立管理與登出", identity: "身份中心", register: "註冊帳戶", browse: "繼續匿名瀏覽資源" },
  en: { title: "Sign in or create an account", intro: "Use your unified KAI account to enter Cloud. New users can verify their email during registration; existing users can sign in directly.", expired: "The sign-in was not completed or the transaction expired. Please start again.", unconfigured: "The unified account application is not registered for production yet, so sign-in is unavailable.", unavailable: "KAI Identity is unavailable", upstream: "This is not an account or consent issue. The platform detected an upstream connection error; please try again after it is resolved.", login: "Sign in / register with KAI Identity", retry: "Check the account service again", verify: "Registration and email verification", verifyBy: "Completed securely at auth.kai.com", session: "Cloud local session", sessionCopy: "Managed and signed out independently after login", identity: "Identity center", register: "Create account", browse: "Continue browsing anonymously" },
  ja: { title: "個人アカウントにログインまたは登録", intro: "KAI 統合アカウントで Cloud にアクセスします。新規ユーザーはメール認証を行い、既存ユーザーはそのままログインできます。", expired: "ログインが完了していないか、処理の有効期限が切れました。もう一度開始してください。", unconfigured: "統合アカウントの本番登録が完了していないため、ログインは現在利用できません。", unavailable: "KAI Identity は現在利用できません", upstream: "アカウントや同意の問題ではありません。上流接続の異常を検出しました。復旧後に再試行してください。", login: "KAI Identity でログイン / 登録", retry: "アカウントサービスを再確認", verify: "登録とメール認証", verifyBy: "auth.kai.com で安全に完了", session: "Cloud ローカルセッション", sessionCopy: "ログイン後は独立して管理・ログアウト", identity: "ID センター", register: "アカウント登録", browse: "匿名でリソースを閲覧" },
  ko: { title: "개인 계정 로그인 또는 등록", intro: "KAI 통합 계정으로 Cloud에 접속합니다. 신규 사용자는 이메일 인증을 완료하고 기존 사용자는 바로 로그인할 수 있습니다.", expired: "로그인이 완료되지 않았거나 요청이 만료되었습니다. 다시 시작해 주세요.", unconfigured: "통합 계정 앱의 운영 등록이 완료되지 않아 현재 로그인할 수 없습니다.", unavailable: "KAI Identity를 사용할 수 없습니다", upstream: "계정이나 동의 선택의 문제가 아닙니다. 상위 연결 오류가 감지되었으니 복구 후 다시 시도해 주세요.", login: "KAI Identity로 로그인 / 등록", retry: "계정 서비스 다시 확인", verify: "등록 및 이메일 인증", verifyBy: "auth.kai.com에서 안전하게 완료", session: "Cloud 로컬 세션", sessionCopy: "로그인 후 독립적으로 관리 및 로그아웃", identity: "ID 센터", register: "계정 등록", browse: "익명으로 리소스 계속 보기" },
  fr: { title: "Se connecter ou créer un compte", intro: "Utilisez votre compte KAI unifié pour accéder à Cloud. Les nouveaux utilisateurs valident leur e-mail à l’inscription ; les autres se connectent directement.", expired: "La connexion n’a pas abouti ou la transaction a expiré. Veuillez recommencer.", unconfigured: "L’application de compte unifié n’est pas encore enregistrée en production ; la connexion est indisponible.", unavailable: "KAI Identity est indisponible", upstream: "Il ne s’agit pas d’un problème de compte ou de consentement. Une erreur de connexion en amont a été détectée ; réessayez après sa résolution.", login: "Connexion / inscription avec KAI Identity", retry: "Vérifier à nouveau le service de compte", verify: "Inscription et validation de l’e-mail", verifyBy: "Réalisées en toute sécurité sur auth.kai.com", session: "Session Cloud locale", sessionCopy: "Gérée et fermée indépendamment après connexion", identity: "Centre d’identité", register: "Créer un compte", browse: "Continuer à parcourir anonymement" },
  th: { title: "เข้าสู่ระบบหรือสร้างบัญชีส่วนบุคคล", intro: "ใช้บัญชี KAI แบบรวมเพื่อเข้าสู่ Cloud ผู้ใช้ใหม่ยืนยันอีเมลระหว่างสมัคร ส่วนผู้ใช้เดิมเข้าสู่ระบบได้ทันที", expired: "การเข้าสู่ระบบไม่สำเร็จหรือรายการหมดอายุ โปรดเริ่มใหม่", unconfigured: "แอปบัญชีแบบรวมยังไม่ได้ลงทะเบียนสำหรับระบบจริง จึงยังเข้าสู่ระบบไม่ได้", unavailable: "KAI Identity ไม่พร้อมใช้งาน", upstream: "ปัญหานี้ไม่ได้เกิดจากบัญชีหรือการยินยอม ระบบตรวจพบข้อผิดพลาดการเชื่อมต่อภายนอก โปรดลองอีกครั้งหลังแก้ไข", login: "เข้าสู่ระบบ / สมัครด้วย KAI Identity", retry: "ตรวจสอบบริการบัญชีอีกครั้ง", verify: "การสมัครและยืนยันอีเมล", verifyBy: "ดำเนินการอย่างปลอดภัยที่ auth.kai.com", session: "เซสชัน Cloud ในระบบ", sessionCopy: "จัดการและออกจากระบบแยกกันหลังเข้าสู่ระบบ", identity: "ศูนย์ข้อมูลประจำตัว", register: "สร้างบัญชี", browse: "เรียกดูทรัพยากรต่อโดยไม่เข้าสู่ระบบ" },
  vi: { title: "Đăng nhập hoặc tạo tài khoản cá nhân", intro: "Dùng tài khoản KAI hợp nhất để vào Cloud. Người dùng mới xác minh email khi đăng ký; người dùng hiện tại có thể đăng nhập trực tiếp.", expired: "Đăng nhập chưa hoàn tất hoặc giao dịch đã hết hạn. Vui lòng bắt đầu lại.", unconfigured: "Ứng dụng tài khoản hợp nhất chưa được đăng ký cho môi trường chính thức nên chưa thể đăng nhập.", unavailable: "KAI Identity hiện không khả dụng", upstream: "Đây không phải vấn đề về tài khoản hoặc lựa chọn ủy quyền. Nền tảng phát hiện lỗi kết nối thượng nguồn; vui lòng thử lại sau khi khắc phục.", login: "Đăng nhập / đăng ký bằng KAI Identity", retry: "Kiểm tra lại dịch vụ tài khoản", verify: "Đăng ký và xác minh email", verifyBy: "Hoàn tất an toàn tại auth.kai.com", session: "Phiên Cloud cục bộ", sessionCopy: "Được quản lý và đăng xuất độc lập sau khi đăng nhập", identity: "Trung tâm danh tính", register: "Tạo tài khoản", browse: "Tiếp tục duyệt ẩn danh" },
  id: { title: "Masuk atau buat akun pribadi", intro: "Gunakan akun KAI terpadu untuk masuk ke Cloud. Pengguna baru memverifikasi email saat mendaftar; pengguna lama dapat langsung masuk.", expired: "Proses masuk belum selesai atau transaksi kedaluwarsa. Silakan mulai lagi.", unconfigured: "Aplikasi akun terpadu belum terdaftar untuk produksi, sehingga proses masuk belum tersedia.", unavailable: "KAI Identity tidak tersedia", upstream: "Ini bukan masalah akun atau persetujuan. Platform mendeteksi gangguan koneksi hulu; coba lagi setelah diperbaiki.", login: "Masuk / daftar dengan KAI Identity", retry: "Periksa kembali layanan akun", verify: "Pendaftaran dan verifikasi email", verifyBy: "Diselesaikan dengan aman di auth.kai.com", session: "Sesi lokal Cloud", sessionCopy: "Dikelola dan diakhiri secara terpisah setelah masuk", identity: "Pusat identitas", register: "Buat akun", browse: "Lanjutkan menjelajah secara anonim" },
  ms: { title: "Log masuk atau cipta akaun peribadi", intro: "Gunakan akaun KAI bersepadu untuk memasuki Cloud. Pengguna baharu mengesahkan e-mel ketika mendaftar; pengguna sedia ada boleh terus log masuk.", expired: "Log masuk tidak selesai atau transaksi telah tamat tempoh. Sila mulakan semula.", unconfigured: "Aplikasi akaun bersepadu belum didaftarkan untuk pengeluaran, jadi log masuk belum tersedia.", unavailable: "KAI Identity tidak tersedia", upstream: "Ini bukan isu akaun atau persetujuan. Platform mengesan ralat sambungan huluan; cuba lagi selepas dipulihkan.", login: "Log masuk / daftar dengan KAI Identity", retry: "Semak semula perkhidmatan akaun", verify: "Pendaftaran dan pengesahan e-mel", verifyBy: "Diselesaikan dengan selamat di auth.kai.com", session: "Sesi setempat Cloud", sessionCopy: "Diurus dan dilog keluar secara berasingan selepas log masuk", identity: "Pusat identiti", register: "Cipta akaun", browse: "Teruskan melayari secara anonim" },
} as const satisfies Record<Locale, Record<string, string>>;

export function AccountLogin({ returnTo, configured, serviceAvailable, identityError, authError }: {
  returnTo: string;
  configured: boolean;
  serviceAvailable: boolean;
  identityError?: string;
  authError?: string;
}) {
  const { locale } = useLocale();
  const text = copy[locale];
  const loginHref = `/api/auth/kai/start?returnTo=${encodeURIComponent(returnTo)}`;
  const retryHref = `/login?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <section className="mx-auto max-w-xl border-t-4 border-[var(--accent)] bg-[var(--surface)] p-6 ring-1 ring-[var(--border)] sm:p-9" aria-labelledby="account-login-title">
      <p className="kicker">KAI IDENTITY</p>
      <h1 className="m-0 text-4xl" id="account-login-title">{text.title}</h1>
      <p className="section-lead text-base">{text.intro}</p>

      {authError ? <div className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]" role="alert">{text.expired}</div> : null}
      {!configured ? <div className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]" role="alert">{text.unconfigured}</div> : null}
      {configured && !serviceAvailable ? <div className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]" role="alert">
        <strong className="block text-[var(--ink)]">{text.unavailable}</strong>
        <span className="mt-1 block">{text.upstream}</span>
        <span className="sr-only">故障代码：{identityError ?? "KAI_IDENTITY_UNAVAILABLE"}</span>
      </div> : null}

      <a aria-disabled={!serviceAvailable} className={`button button-primary mt-7 min-h-12 w-full justify-center${serviceAvailable ? "" : " pointer-events-none opacity-50"}`} href={serviceAvailable ? loginHref : undefined}>
        {text.login}
      </a>
      {configured && !serviceAvailable ? <Link className="button mt-3 min-h-11 w-full justify-center" href={retryHref}>{text.retry}</Link> : null}

      <dl className="mt-7 grid gap-3 border-t border-[var(--border)] pt-6 text-sm sm:grid-cols-2">
        <div><dt className="font-semibold text-[var(--ink)]">{text.verify}</dt><dd className="mt-1 text-[var(--muted)]">{text.verifyBy}</dd></div>
        <div><dt className="font-semibold text-[var(--ink)]">{text.session}</dt><dd className="mt-1 text-[var(--muted)]">{text.sessionCopy}</dd></div>
      </dl>

      <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <a className="font-semibold text-[var(--accent)] underline underline-offset-4" href="https://auth.kai.com/" rel="noreferrer">{text.identity}</a>
        <a className="font-semibold text-[var(--accent)] underline underline-offset-4" href="https://auth.kai.com/sign-up" rel="noreferrer">{text.register}</a>
        <Link className="font-semibold text-[var(--accent)] underline underline-offset-4" href="/resources">{text.browse}</Link>
      </div>
    </section>
  );
}
