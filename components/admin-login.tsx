"use client";

import { FormEvent, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "./locale-provider";

const copy = {
  "zh-CN": { title: "登录 KAI 管理后台", intro: "后台包含供应、需求、订单、卡时账本与交付运营数据。Root 与独立财务审批员使用不同账号登录，服务端逐请求检查各自权限。", failed: "登录未完成", unavailable: "管理员登录暂时不可用。", user: "管理员账号", password: "管理员密码", busy: "正在验证并进入…", submit: "登录管理员后台", signedOut: "未登录", signedOutRule: "不读取任何后台业务数据", denied: "无权限", deniedRule: "显示 403，不降级到普通用户数据", method: "登录方式", methodRule: "后台仅接受 Root 或独立审批账号密码", audit: "操作记录", auditRule: "登录与写操作均进入安全审计" },
  "zh-TW": { title: "登入 KAI 管理後台", intro: "後台包含供應、需求、訂單、卡時帳本與交付營運資料。Root 與獨立財務審批員使用不同帳戶，服務端逐請求檢查權限。", failed: "登入未完成", unavailable: "管理員登入暫時不可用。", user: "管理員帳戶", password: "管理員密碼", busy: "正在驗證並進入…", submit: "登入管理員後台", signedOut: "未登入", signedOutRule: "不讀取任何後台業務資料", denied: "無權限", deniedRule: "顯示 403，不降級到一般使用者資料", method: "登入方式", methodRule: "後台僅接受 Root 或獨立審批帳戶密碼", audit: "操作記錄", auditRule: "登入與寫入操作均進入安全審計" },
  en: { title: "Sign in to KAI Admin", intro: "The console contains supply, demand, order, card-hour ledger and delivery operations data. Root and independent finance approvers use separate accounts, with permissions checked on every request.", failed: "Sign-in not completed", unavailable: "Administrator sign-in is temporarily unavailable.", user: "Administrator account", password: "Administrator password", busy: "Verifying…", submit: "Sign in to KAI Admin", signedOut: "Signed out", signedOutRule: "No administration data is loaded", denied: "No permission", deniedRule: "Shows 403 and never falls back to user data", method: "Sign-in method", methodRule: "Only Root or independent approver credentials are accepted", audit: "Audit trail", auditRule: "Sign-ins and writes are recorded in the security audit" },
  ja: { title: "KAI 管理画面にログイン", intro: "供給、需要、注文、カード時台帳、納品運用データを扱います。Root と独立財務承認者は別アカウントを使用し、リクエストごとに権限を確認します。", failed: "ログインが完了しませんでした", unavailable: "管理者ログインは一時的に利用できません。", user: "管理者アカウント", password: "管理者パスワード", busy: "確認中…", submit: "管理画面にログイン", signedOut: "未ログイン", signedOutRule: "管理データを読み込みません", denied: "権限なし", deniedRule: "403 を表示し、一般ユーザーデータへ切り替えません", method: "ログイン方式", methodRule: "Root または独立承認者の認証情報のみ受け付けます", audit: "操作記録", auditRule: "ログインと書き込みはセキュリティ監査に記録されます" },
  ko: { title: "KAI 관리자 로그인", intro: "공급, 수요, 주문, 카드시간 원장 및 인도 운영 데이터를 다룹니다. Root와 독립 재무 승인자는 별도 계정을 사용하며 모든 요청에서 권한을 확인합니다.", failed: "로그인이 완료되지 않았습니다", unavailable: "관리자 로그인을 일시적으로 사용할 수 없습니다.", user: "관리자 계정", password: "관리자 비밀번호", busy: "확인 중…", submit: "관리자 로그인", signedOut: "로그아웃 상태", signedOutRule: "관리 업무 데이터를 불러오지 않음", denied: "권한 없음", deniedRule: "403을 표시하고 일반 사용자 데이터로 대체하지 않음", method: "로그인 방식", methodRule: "Root 또는 독립 승인자 계정만 허용", audit: "감사 기록", auditRule: "로그인과 쓰기 작업은 보안 감사에 기록" },
  fr: { title: "Connexion à KAI Admin", intro: "La console contient les données d’offre, de demande, de commandes, de registre d’heures-carte et de livraison. Root et les approbateurs financiers utilisent des comptes distincts, contrôlés à chaque requête.", failed: "Connexion non terminée", unavailable: "La connexion administrateur est temporairement indisponible.", user: "Compte administrateur", password: "Mot de passe administrateur", busy: "Vérification…", submit: "Se connecter à KAI Admin", signedOut: "Déconnecté", signedOutRule: "Aucune donnée d’administration n’est chargée", denied: "Sans autorisation", deniedRule: "Affiche 403 sans basculer vers les données utilisateur", method: "Mode de connexion", methodRule: "Seuls les identifiants Root ou d’approbateur indépendant sont acceptés", audit: "Journal d’audit", auditRule: "Les connexions et écritures sont consignées" },
  th: { title: "เข้าสู่ระบบ KAI Admin", intro: "คอนโซลมีข้อมูลอุปทาน อุปสงค์ คำสั่งซื้อ บัญชีชั่วโมงการ์ด และการส่งมอบ โดย Root และผู้อนุมัติการเงินใช้บัญชีแยกและตรวจสิทธิ์ทุกคำขอ", failed: "เข้าสู่ระบบไม่สำเร็จ", unavailable: "การเข้าสู่ระบบผู้ดูแลไม่พร้อมใช้งานชั่วคราว", user: "บัญชีผู้ดูแล", password: "รหัสผ่านผู้ดูแล", busy: "กำลังตรวจสอบ…", submit: "เข้าสู่ระบบ KAI Admin", signedOut: "ยังไม่เข้าสู่ระบบ", signedOutRule: "ไม่โหลดข้อมูลหลังบ้าน", denied: "ไม่มีสิทธิ์", deniedRule: "แสดง 403 และไม่ใช้ข้อมูลผู้ใช้แทน", method: "วิธีเข้าสู่ระบบ", methodRule: "รับเฉพาะบัญชี Root หรือผู้อนุมัติอิสระ", audit: "บันทึกการตรวจสอบ", auditRule: "การเข้าสู่ระบบและการเขียนถูกบันทึกเพื่อความปลอดภัย" },
  vi: { title: "Đăng nhập KAI Admin", intro: "Bảng điều khiển chứa dữ liệu cung, cầu, đơn hàng, sổ giờ-thẻ và vận hành bàn giao. Root và người duyệt tài chính độc lập dùng tài khoản riêng; quyền được kiểm tra ở mỗi yêu cầu.", failed: "Đăng nhập chưa hoàn tất", unavailable: "Đăng nhập quản trị tạm thời không khả dụng.", user: "Tài khoản quản trị", password: "Mật khẩu quản trị", busy: "Đang xác minh…", submit: "Đăng nhập KAI Admin", signedOut: "Chưa đăng nhập", signedOutRule: "Không tải dữ liệu quản trị", denied: "Không có quyền", deniedRule: "Hiển thị 403 và không chuyển sang dữ liệu người dùng", method: "Phương thức đăng nhập", methodRule: "Chỉ chấp nhận thông tin Root hoặc người duyệt độc lập", audit: "Nhật ký kiểm toán", auditRule: "Đăng nhập và thao tác ghi đều được kiểm toán" },
  id: { title: "Masuk ke KAI Admin", intro: "Konsol memuat data pasokan, permintaan, pesanan, buku besar jam-kartu, dan pengiriman. Root serta penyetuju keuangan independen memakai akun terpisah dan izin diperiksa pada setiap permintaan.", failed: "Proses masuk belum selesai", unavailable: "Proses masuk administrator sementara tidak tersedia.", user: "Akun administrator", password: "Kata sandi administrator", busy: "Memverifikasi…", submit: "Masuk ke KAI Admin", signedOut: "Belum masuk", signedOutRule: "Tidak memuat data administrasi", denied: "Tanpa izin", deniedRule: "Menampilkan 403 tanpa beralih ke data pengguna", method: "Metode masuk", methodRule: "Hanya kredensial Root atau penyetuju independen yang diterima", audit: "Jejak audit", auditRule: "Proses masuk dan penulisan dicatat dalam audit keamanan" },
  ms: { title: "Log masuk ke KAI Admin", intro: "Konsol mengandungi data bekalan, permintaan, pesanan, lejar jam-kad dan penghantaran. Root dan pelulus kewangan bebas menggunakan akaun berasingan dengan kebenaran diperiksa pada setiap permintaan.", failed: "Log masuk belum selesai", unavailable: "Log masuk pentadbir tidak tersedia buat sementara waktu.", user: "Akaun pentadbir", password: "Kata laluan pentadbir", busy: "Mengesahkan…", submit: "Log masuk KAI Admin", signedOut: "Belum log masuk", signedOutRule: "Tidak memuatkan data pentadbiran", denied: "Tiada kebenaran", deniedRule: "Memaparkan 403 tanpa beralih kepada data pengguna", method: "Kaedah log masuk", methodRule: "Hanya kelayakan Root atau pelulus bebas diterima", audit: "Jejak audit", auditRule: "Log masuk dan penulisan direkodkan dalam audit keselamatan" },
} as const satisfies Record<Locale, Record<string, string>>;

type AuthResponse = { admin?: { principal?: { roles?: string[] } } };

export function AdminLogin() {
  const { locale } = useLocale();
  const text = copy[locale];
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/admin/password", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = await response.json().catch(() => ({})) as AuthResponse;
      if (!response.ok) throw new Error(text.unavailable);
      window.location.assign(payload.admin?.principal?.roles?.includes("FINANCE_APPROVER") ? "/admin/hosting" : "/admin");
    } catch {
      setError(text.unavailable);
      setBusy(false);
    }
  }

  return (
    <div className="admin-login-main">
      <section className="admin-login-card" aria-labelledby="admin-login-title">
        <p className="admin-kicker">Protected operations</p>
        <h1 id="admin-login-title">{text.title}</h1>
        <p>{text.intro}</p>

        {error ? <div className="admin-inline-error" role="alert"><strong>{text.failed}</strong><span>{error}</span></div> : null}

        <form className="admin-login-form" onSubmit={login}>
          <label htmlFor="admin-username"><span>{text.user}</span><input autoComplete="username" id="admin-username" maxLength={64} onChange={(event) => setUsername(event.target.value)} required value={username} /></label>
          <label htmlFor="admin-password"><span>{text.password}</span><input autoComplete="current-password" id="admin-password" maxLength={256} minLength={12} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
          <button className="admin-button primary" disabled={busy || username.trim().length < 3 || password.length < 12} type="submit">{busy ? text.busy : text.submit}</button>
        </form>

        <dl className="admin-login-rules">
          <div><dt>{text.signedOut}</dt><dd>{text.signedOutRule}</dd></div>
          <div><dt>{text.denied}</dt><dd>{text.deniedRule}</dd></div>
          <div><dt>{text.method}</dt><dd>{text.methodRule}</dd></div>
          <div><dt>{text.audit}</dt><dd>{text.auditRule}</dd></div>
        </dl>
      </section>
    </div>
  );
}
