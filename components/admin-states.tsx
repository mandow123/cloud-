"use client";

import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "./locale-provider";

const copy = {
  "zh-CN": { loading: "正在读取服务端数据…", failed: "数据读取失败", retry: "重新读取", forbidden: "当前账号没有管理员权限", forbiddenCopy: "当前账户不是唯一 Root；页面不会降级展示未授权数据。", required: "管理员会话尚未建立", requiredCopy: "请使用独立管理员账号密码登录，服务端会再次校验唯一 Root 权限。", login: "前往管理员登录" },
  "zh-TW": { loading: "正在讀取服務端資料…", failed: "資料讀取失敗", retry: "重新讀取", forbidden: "目前帳戶沒有管理員權限", forbiddenCopy: "目前帳戶不是唯一 Root；頁面不會降級顯示未授權資料。", required: "管理員工作階段尚未建立", requiredCopy: "請使用獨立管理員帳號密碼登入，服務端會再次校驗唯一 Root 權限。", login: "前往管理員登入" },
  en: { loading: "Loading server data…", failed: "Failed to load data", retry: "Try again", forbidden: "This account has no administrator access", forbiddenCopy: "The account is not the unique Root. Unauthorized data will not be shown as a fallback.", required: "No administrator session", requiredCopy: "Sign in with the separate administrator credentials. The server will verify the unique Root role again.", login: "Go to administrator sign-in" },
  ja: { loading: "サーバーデータを読み込み中…", failed: "データの読み込みに失敗しました", retry: "再読み込み", forbidden: "このアカウントには管理者権限がありません", forbiddenCopy: "このアカウントは唯一の Root ではありません。未承認データを代替表示しません。", required: "管理者セッションがありません", requiredCopy: "専用の管理者認証情報でログインしてください。サーバーが唯一の Root 権限を再確認します。", login: "管理者ログインへ" },
  ko: { loading: "서버 데이터 불러오는 중…", failed: "데이터를 불러오지 못했습니다", retry: "다시 불러오기", forbidden: "이 계정에는 관리자 권한이 없습니다", forbiddenCopy: "현재 계정은 유일한 Root가 아닙니다. 권한 없는 데이터를 대신 표시하지 않습니다.", required: "관리자 세션이 없습니다", requiredCopy: "별도 관리자 계정으로 로그인하세요. 서버에서 유일한 Root 권한을 다시 확인합니다.", login: "관리자 로그인으로 이동" },
  fr: { loading: "Chargement des données serveur…", failed: "Échec du chargement des données", retry: "Réessayer", forbidden: "Ce compte n’a pas d’accès administrateur", forbiddenCopy: "Ce compte n’est pas l’unique Root. Aucune donnée non autorisée ne sera affichée par défaut.", required: "Aucune session administrateur", requiredCopy: "Connectez-vous avec les identifiants administrateur séparés. Le serveur vérifiera à nouveau le rôle Root unique.", login: "Accéder à la connexion administrateur" },
  th: { loading: "กำลังโหลดข้อมูลเซิร์ฟเวอร์…", failed: "โหลดข้อมูลไม่สำเร็จ", retry: "ลองอีกครั้ง", forbidden: "บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลระบบ", forbiddenCopy: "บัญชีนี้ไม่ใช่ Root เพียงบัญชีเดียว และจะไม่แสดงข้อมูลที่ไม่ได้รับอนุญาตเป็นทางเลือก", required: "ยังไม่มีเซสชันผู้ดูแลระบบ", requiredCopy: "โปรดเข้าสู่ระบบด้วยข้อมูลผู้ดูแลระบบแยกต่างหาก เซิร์ฟเวอร์จะตรวจสอบสิทธิ์ Root อีกครั้ง", login: "ไปยังการเข้าสู่ระบบผู้ดูแล" },
  vi: { loading: "Đang tải dữ liệu máy chủ…", failed: "Không tải được dữ liệu", retry: "Tải lại", forbidden: "Tài khoản này không có quyền quản trị", forbiddenCopy: "Tài khoản không phải Root duy nhất. Trang sẽ không hiển thị dữ liệu trái phép thay thế.", required: "Chưa có phiên quản trị", requiredCopy: "Hãy đăng nhập bằng thông tin quản trị riêng. Máy chủ sẽ xác minh lại vai trò Root duy nhất.", login: "Đến trang đăng nhập quản trị" },
  id: { loading: "Memuat data server…", failed: "Gagal memuat data", retry: "Muat ulang", forbidden: "Akun ini tidak memiliki akses administrator", forbiddenCopy: "Akun ini bukan satu-satunya Root. Data tanpa izin tidak akan ditampilkan sebagai pengganti.", required: "Belum ada sesi administrator", requiredCopy: "Masuk dengan kredensial administrator terpisah. Server akan memverifikasi kembali peran Root tunggal.", login: "Buka halaman masuk administrator" },
  ms: { loading: "Memuatkan data pelayan…", failed: "Gagal memuatkan data", retry: "Muat semula", forbidden: "Akaun ini tiada akses pentadbir", forbiddenCopy: "Akaun ini bukan satu-satunya Root. Data tanpa kebenaran tidak akan dipaparkan sebagai gantian.", required: "Tiada sesi pentadbir", requiredCopy: "Log masuk dengan kelayakan pentadbir berasingan. Pelayan akan mengesahkan semula peranan Root tunggal.", login: "Pergi ke log masuk pentadbir" },
} as const satisfies Record<Locale, Record<string, string>>;

export function AdminLoading({ label }: { label?: string }) {
  const { locale } = useLocale();
  return <div className="admin-state admin-state-loading" role="status"><span className="admin-loader" aria-hidden="true" />{label ?? copy[locale].loading}</div>;
}

export function AdminEmpty({ title, description }: { title: string; description: string }) {
  return <div className="admin-state"><strong>{title}</strong><p>{description}</p></div>;
}

export function AdminError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { locale } = useLocale();
  const text = copy[locale];
  return (
    <div className="admin-state admin-state-error" role="alert">
      <strong>{text.failed}</strong>
      <p>{message}</p>
      {onRetry ? <button className="admin-button secondary" onClick={onRetry} type="button">{text.retry}</button> : null}
    </div>
  );
}

export function AdminLoginRequired({ forbidden = false }: { forbidden?: boolean }) {
  const { locale } = useLocale();
  const text = copy[locale];
  return (
    <div className="admin-state admin-auth-required" role="alert">
      <span className="admin-state-code">{forbidden ? "403" : "401"}</span>
      <strong>{forbidden ? text.forbidden : text.required}</strong>
      <p>{forbidden ? text.forbiddenCopy : text.requiredCopy}</p>
      <Link className="admin-button primary" href="/admin/login">{text.login}</Link>
    </div>
  );
}
