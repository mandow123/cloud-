"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import styles from "@/components/catalog-purchase.module.css";
import { createIdempotencyKey, MarketplaceApiError, marketplacePost } from "@/lib/client/marketplace-client";
import { formatCardHourValue } from "@/lib/card-hours";
import type { Locale } from "@/lib/i18n";
import type { MarketplaceRequestRecord } from "@/lib/marketplace";
import type { ResourceListing } from "@/lib/types";
import { requiresManualSshPublicKey } from "@/lib/manual-delivery";

const hourlyUnits = new Set(["卡时", "服务器时", "模型实例时", "预留容量时"]);

type CatalogPurchaseCopy = {
  successEyebrow: string; successTitle: string; applicationId: string; successHelp: string; viewDetails: string; viewAll: string; continueBuy: string;
  back: string; headingEyebrow: string; title: string; lead: string; supplierSource: string; dataSource: string; supplierPending: string;
  detailsEyebrow: string; formTitle: string; quantity: string; duration: string; startDate: string; optionalNote: string; notePlaceholder: string; sshKey: string; sshPlaceholder: string; sshHelp: string;
  safeError: string; requestId: string; summaryAria: string; priceEyebrow: string; cardHour: string; unitNote: string; hours: string; referenceRange: string; estimatedTotal: string; scopeStatus: string;
  flow: readonly [string, string, string, string]; loginSubmit: string; inactiveSubmit: string; checking: string; submitting: string; submit: string;
};

const CATALOG_PURCHASE_COPY = {
  "zh-CN": { successEyebrow: "询价已受理", successTitle: "询价意向已提交", applicationId: "申请编号：", successHelp: "平台将先人工确认库存、地域网络、供应商交付条件和正式卡时报价；确认后由运营人员把你的 SSH 公钥安全交给对应供应商并协调开通。当前仅为询价参考：未锁库存、未支付、未成交，也不会自动操作任何机器。", viewDetails: "查看本次算力详情", viewAll: "查看全部申请", continueBuy: "继续选购算力", back: "返回 GPU 套餐", headingEyebrow: "请求供应商报价", title: "确认算力套餐与询价信息", lead: "核对 GPU 套餐、数量、时长和卡时参考总计。提交后由平台确认库存、地域网络与正式报价；本页不创建成交订单。", supplierSource: "供应商来源：", dataSource: "数据来源：", supplierPending: "供应商提供报价 · 待确认", detailsEyebrow: "询价信息", formTitle: "填写询价数量", quantity: "资源数量", duration: "服务时长（小时）", startDate: "计划开始日期", optionalNote: "补充要求（选填）", notePlaceholder: "例如：网络、存储、镜像、专线或交付窗口要求", sshKey: "SSH 公钥", sshPlaceholder: "ssh-ed25519 AAAA… your-device", sshHelp: "仅提交单行 OpenSSH 公钥，支持 Ed25519 或至少 2048 位 RSA。公钥会保存到平台数据库，供授权管理员人工交付；请勿提交私钥。", safeError: "询价意向提交失败，请检查数量和交付日期后重试。", requestId: "请求编号", summaryAria: "价格汇总", priceEyebrow: "价格汇总", cardHour: "卡时", unitNote: "卡时 / 套·小时 · 正式价格以供应商确认为准", hours: "小时", referenceRange: "卡时参考范围", estimatedTotal: "询价参考总计", scopeStatus: "询价参考 · 未锁库存 · 未支付 · 未成交", flow: ["提交询价意向，不锁库存、不扣卡时", "平台人工确认库存与正式卡时报价", "管理员核对公钥并协调供应商人工开通", "买方收到连接信息后自行验收"], loginSubmit: "登录后提交询价", inactiveSubmit: "完善交易主体后提交", checking: "正在核对账户…", submitting: "正在提交…", submit: "提交询价" },
  "zh-TW": { successEyebrow: "詢價已受理", successTitle: "詢價意向已提交", applicationId: "申請編號：", successHelp: "平台會先人工確認庫存、區域網路、供應商交付條件與正式卡時報價；確認後由營運人員安全地把 SSH 公鑰交給對應供應商並協調開通。目前僅為詢價參考：未鎖定庫存、未付款、未成交，也不會自動操作任何機器。", viewDetails: "查看本次算力詳情", viewAll: "查看全部申請", continueBuy: "繼續選購算力", back: "返回 GPU 套餐", headingEyebrow: "請求供應商報價", title: "確認算力套餐與詢價資訊", lead: "核對 GPU 套餐、數量、時長與卡時參考總計。提交後由平台確認庫存、區域網路與正式報價；本頁不建立成交訂單。", supplierSource: "供應商來源：", dataSource: "資料來源：", supplierPending: "供應商提供報價 · 待確認", detailsEyebrow: "詢價資訊", formTitle: "填寫詢價數量", quantity: "資源數量", duration: "服務時長（小時）", startDate: "計畫開始日期", optionalNote: "補充要求（選填）", notePlaceholder: "例如：網路、儲存、映像、專線或交付窗口要求", sshKey: "SSH 公鑰", sshPlaceholder: "ssh-ed25519 AAAA… your-device", sshHelp: "僅提交單行 OpenSSH 公鑰，支援 Ed25519 或至少 2048 位 RSA。公鑰會儲存至平台資料庫，供授權管理員人工交付；請勿提交私鑰。", safeError: "詢價意向提交失敗，請檢查數量和交付日期後重試。", requestId: "請求編號", summaryAria: "價格彙總", priceEyebrow: "價格彙總", cardHour: "卡時", unitNote: "卡時 / 套·小時 · 正式價格以供應商確認為準", hours: "小時", referenceRange: "卡時參考範圍", estimatedTotal: "詢價參考總計", scopeStatus: "詢價參考 · 未鎖定庫存 · 未付款 · 未成交", flow: ["提交詢價意向，不鎖定庫存、不扣卡時", "平台人工確認庫存與正式卡時報價", "管理員核對公鑰並協調供應商人工開通", "買方收到連線資訊後自行驗收"], loginSubmit: "登入後提交詢價", inactiveSubmit: "完善交易主體後提交", checking: "正在核對帳戶…", submitting: "正在提交…", submit: "提交詢價" },
  en: { successEyebrow: "Inquiry accepted", successTitle: "Inquiry submitted", applicationId: "Application ID: ", successHelp: "The platform will manually confirm inventory, regional network, supplier delivery terms, and the final card-hour quote. Operations will then securely pass your SSH public key to the matching supplier and coordinate provisioning. This is an inquiry only: no inventory is reserved, no payment is taken, no transaction is created, and no machine is operated automatically.", viewDetails: "View this compute request", viewAll: "View all applications", continueBuy: "Continue browsing compute", back: "Back to GPU packages", headingEyebrow: "Request a supplier quote", title: "Confirm package and inquiry details", lead: "Review the GPU package, quantity, duration, and estimated card-hour total. The platform will confirm inventory, regional network, and final pricing after submission; this page does not create an order.", supplierSource: "Supplier source: ", dataSource: "Data source: ", supplierPending: "Supplier-provided quote · Pending confirmation", detailsEyebrow: "Inquiry details", formTitle: "Enter inquiry quantity", quantity: "Resource quantity", duration: "Service duration (hours)", startDate: "Planned start date", optionalNote: "Additional requirements (optional)", notePlaceholder: "For example: network, storage, image, private line, or delivery window", sshKey: "SSH public key", sshPlaceholder: "ssh-ed25519 AAAA… your-device", sshHelp: "Submit one OpenSSH public-key line only: Ed25519 or RSA of at least 2048 bits. It is stored by the platform for manual delivery by authorized administrators. Never submit a private key.", safeError: "The inquiry could not be submitted. Check the quantity and start date, then try again.", requestId: "Request ID", summaryAria: "Price summary", priceEyebrow: "Price summary", cardHour: "card-hours", unitNote: "card-hours / set-hour · Final price requires supplier confirmation", hours: "hours", referenceRange: "Card-hour reference range", estimatedTotal: "Estimated inquiry total", scopeStatus: "Reference only · No inventory reserved · No payment · No transaction", flow: ["Submit an inquiry without reserving inventory or deducting card-hours", "The platform manually confirms inventory and the final card-hour quote", "An administrator verifies the public key and coordinates manual provisioning", "The buyer validates the connection details after delivery"], loginSubmit: "Sign in to submit inquiry", inactiveSubmit: "Complete trading profile to submit", checking: "Checking account…", submitting: "Submitting…", submit: "Submit inquiry" },
  ja: { successEyebrow: "問い合わせを受け付けました", successTitle: "問い合わせを送信しました", applicationId: "申請 ID：", successHelp: "在庫、地域ネットワーク、供給元の納品条件、最終カード時価格を手動確認します。その後、担当者が SSH 公開鍵を安全に供給元へ渡し、開通を調整します。これは問い合わせのみで、在庫確保・支払い・成約・機器の自動操作は行われません。", viewDetails: "今回の算力詳細を見る", viewAll: "すべての申請を見る", continueBuy: "算力を引き続き探す", back: "GPU パッケージに戻る", headingEyebrow: "供給元に見積を依頼", title: "パッケージと問い合わせ内容の確認", lead: "GPU パッケージ、数量、期間、カード時参考合計を確認してください。送信後に在庫、地域ネットワーク、最終価格を確認します。このページでは注文は成立しません。", supplierSource: "供給元：", dataSource: "データ出典：", supplierPending: "供給元提供の見積 · 確認待ち", detailsEyebrow: "問い合わせ内容", formTitle: "数量を入力", quantity: "リソース数量", duration: "利用時間（時間）", startDate: "開始予定日", optionalNote: "追加要件（任意）", notePlaceholder: "例：ネットワーク、ストレージ、イメージ、専用線、納品時間帯", sshKey: "SSH 公開鍵", sshPlaceholder: "ssh-ed25519 AAAA… your-device", sshHelp: "1 行の OpenSSH 公開鍵のみ送信してください。Ed25519 または 2048 ビット以上の RSA に対応します。公開鍵は権限を持つ管理者の手動納品用に保存されます。秘密鍵は送信しないでください。", safeError: "問い合わせを送信できませんでした。数量と開始日を確認して再試行してください。", requestId: "リクエスト ID", summaryAria: "価格概要", priceEyebrow: "価格概要", cardHour: "カード時", unitNote: "カード時 / セット時 · 最終価格は供給元の確認が必要", hours: "時間", referenceRange: "カード時参考範囲", estimatedTotal: "問い合わせ参考合計", scopeStatus: "参考のみ · 在庫未確保 · 未払い · 未成約", flow: ["在庫確保やカード時控除をせず問い合わせを送信", "在庫と最終カード時価格を手動確認", "管理者が公開鍵を確認し手動開通を調整", "購入者が接続情報を受け取り自ら検収"], loginSubmit: "ログインして問い合わせる", inactiveSubmit: "取引主体情報を完成して送信", checking: "アカウントを確認中…", submitting: "送信中…", submit: "問い合わせる" },
  ko: { successEyebrow: "문의 접수", successTitle: "문의가 제출되었습니다", applicationId: "신청 ID: ", successHelp: "플랫폼이 재고, 지역 네트워크, 공급자 제공 조건 및 최종 카드시간 견적을 수동 확인합니다. 이후 운영 담당자가 SSH 공개 키를 공급자에게 안전하게 전달하고 개통을 조율합니다. 이는 문의일 뿐이며 재고 예약, 결제, 거래 또는 장비 자동 조작이 발생하지 않습니다.", viewDetails: "이번 컴퓨팅 상세 보기", viewAll: "전체 신청 보기", continueBuy: "컴퓨팅 계속 둘러보기", back: "GPU 패키지로 돌아가기", headingEyebrow: "공급자 견적 요청", title: "패키지 및 문의 정보 확인", lead: "GPU 패키지, 수량, 기간, 카드시간 참고 합계를 확인하세요. 제출 후 재고, 지역 네트워크 및 최종 가격을 확인하며 이 페이지에서는 주문이 생성되지 않습니다.", supplierSource: "공급자 출처: ", dataSource: "데이터 출처: ", supplierPending: "공급자 제공 견적 · 확인 대기", detailsEyebrow: "문의 정보", formTitle: "문의 수량 입력", quantity: "리소스 수량", duration: "서비스 시간(시간)", startDate: "예정 시작일", optionalNote: "추가 요구사항(선택)", notePlaceholder: "예: 네트워크, 스토리지, 이미지, 전용선 또는 제공 시간", sshKey: "SSH 공개 키", sshPlaceholder: "ssh-ed25519 AAAA… your-device", sshHelp: "한 줄의 OpenSSH 공개 키만 제출하세요. Ed25519 또는 2048비트 이상 RSA를 지원합니다. 공개 키는 권한 있는 관리자의 수동 제공을 위해 저장됩니다. 개인 키는 제출하지 마세요.", safeError: "문의를 제출하지 못했습니다. 수량과 시작일을 확인한 후 다시 시도하세요.", requestId: "요청 ID", summaryAria: "가격 요약", priceEyebrow: "가격 요약", cardHour: "카드시간", unitNote: "카드시간 / 세트-시간 · 최종 가격은 공급자 확인 필요", hours: "시간", referenceRange: "카드시간 참고 범위", estimatedTotal: "문의 참고 합계", scopeStatus: "참고용 · 재고 미예약 · 미결제 · 미거래", flow: ["재고 예약이나 카드시간 차감 없이 문의 제출", "플랫폼이 재고와 최종 카드시간 견적을 수동 확인", "관리자가 공개 키를 확인하고 공급자 개통을 조율", "구매자가 연결 정보를 받은 뒤 직접 검수"], loginSubmit: "로그인 후 문의 제출", inactiveSubmit: "거래 주체 정보 완성 후 제출", checking: "계정 확인 중…", submitting: "제출 중…", submit: "문의 제출" },
  fr: { successEyebrow: "Demande reçue", successTitle: "Demande de devis envoyée", applicationId: "ID de demande : ", successHelp: "La plateforme confirmera manuellement le stock, le réseau régional, les conditions de livraison et le prix final en heures-carte. L’équipe transmettra ensuite votre clé publique SSH au fournisseur et coordonnera la mise à disposition. Il s’agit uniquement d’une demande : aucun stock, paiement, achat ni contrôle automatique de machine.", viewDetails: "Voir cette demande de calcul", viewAll: "Voir toutes les demandes", continueBuy: "Continuer à chercher du calcul", back: "Retour aux offres GPU", headingEyebrow: "Demander un devis fournisseur", title: "Confirmer l’offre et la demande", lead: "Vérifiez l’offre GPU, la quantité, la durée et le total indicatif en heures-carte. La plateforme confirmera ensuite le stock, le réseau et le prix final ; cette page ne crée pas de commande.", supplierSource: "Source fournisseur : ", dataSource: "Source des données : ", supplierPending: "Devis fournisseur · Confirmation en attente", detailsEyebrow: "Détails de la demande", formTitle: "Saisir la quantité", quantity: "Quantité de ressources", duration: "Durée du service (heures)", startDate: "Date de début prévue", optionalNote: "Exigences complémentaires (facultatif)", notePlaceholder: "Ex. réseau, stockage, image, liaison privée ou fenêtre de livraison", sshKey: "Clé publique SSH", sshPlaceholder: "ssh-ed25519 AAAA… your-device", sshHelp: "Envoyez une seule ligne de clé publique OpenSSH : Ed25519 ou RSA d’au moins 2048 bits. Elle est conservée pour une livraison manuelle par un administrateur autorisé. N’envoyez jamais de clé privée.", safeError: "La demande n’a pas pu être envoyée. Vérifiez la quantité et la date de début, puis réessayez.", requestId: "ID de requête", summaryAria: "Récapitulatif du prix", priceEyebrow: "Récapitulatif du prix", cardHour: "heures-carte", unitNote: "heures-carte / heure-ensemble · Prix final à confirmer", hours: "heures", referenceRange: "Fourchette indicative en heures-carte", estimatedTotal: "Total indicatif", scopeStatus: "Indication uniquement · Aucun stock réservé · Aucun paiement · Aucun achat", flow: ["Envoyer une demande sans réserver de stock ni débiter d’heures-carte", "La plateforme confirme manuellement le stock et le prix final", "Un administrateur vérifie la clé publique et coordonne la mise à disposition", "L’acheteur valide lui-même les informations de connexion"], loginSubmit: "Se connecter et envoyer", inactiveSubmit: "Compléter le profil commercial", checking: "Vérification du compte…", submitting: "Envoi…", submit: "Envoyer la demande" },
  th: { successEyebrow: "รับคำขอแล้ว", successTitle: "ส่งคำขอราคาแล้ว", applicationId: "รหัสคำขอ: ", successHelp: "แพลตฟอร์มจะยืนยันสต็อก เครือข่ายภูมิภาค เงื่อนไขส่งมอบ และราคาชั่วโมงการ์ดจริงด้วยเจ้าหน้าที่ จากนั้นจะส่งคีย์สาธารณะ SSH ให้ผู้ให้บริการอย่างปลอดภัยและประสานการเปิดใช้งาน นี่เป็นเพียงคำขอราคา: ไม่มีการจองสต็อก ชำระเงิน ซื้อขาย หรือควบคุมเครื่องโดยอัตโนมัติ", viewDetails: "ดูรายละเอียดคำขอนี้", viewAll: "ดูคำขอทั้งหมด", continueBuy: "เลือกซื้อพลังประมวลผลต่อ", back: "กลับไปแพ็กเกจ GPU", headingEyebrow: "ขอราคาจากผู้ให้บริการ", title: "ยืนยันแพ็กเกจและข้อมูลคำขอ", lead: "ตรวจสอบแพ็กเกจ GPU จำนวน ระยะเวลา และยอดชั่วโมงการ์ดอ้างอิง แพลตฟอร์มจะยืนยันสต็อก เครือข่าย และราคาจริงหลังส่ง หน้านี้ไม่สร้างคำสั่งซื้อ", supplierSource: "แหล่งผู้ให้บริการ: ", dataSource: "แหล่งข้อมูล: ", supplierPending: "ราคาจากผู้ให้บริการ · รอยืนยัน", detailsEyebrow: "ข้อมูลคำขอ", formTitle: "กรอกจำนวน", quantity: "จำนวนทรัพยากร", duration: "ระยะเวลาบริการ (ชั่วโมง)", startDate: "วันที่เริ่มที่วางแผนไว้", optionalNote: "ข้อกำหนดเพิ่มเติม (ไม่บังคับ)", notePlaceholder: "เช่น เครือข่าย พื้นที่เก็บข้อมูล อิมเมจ สายส่วนตัว หรือช่วงส่งมอบ", sshKey: "คีย์สาธารณะ SSH", sshPlaceholder: "ssh-ed25519 AAAA… your-device", sshHelp: "ส่งคีย์สาธารณะ OpenSSH หนึ่งบรรทัดเท่านั้น รองรับ Ed25519 หรือ RSA อย่างน้อย 2048 บิต ระบบจะเก็บไว้เพื่อการส่งมอบโดยผู้ดูแลที่ได้รับอนุญาต ห้ามส่งคีย์ส่วนตัว", safeError: "ส่งคำขอราคาไม่สำเร็จ โปรดตรวจสอบจำนวนและวันที่เริ่มแล้วลองอีกครั้ง", requestId: "รหัสคำขอ", summaryAria: "สรุปราคา", priceEyebrow: "สรุปราคา", cardHour: "ชั่วโมงการ์ด", unitNote: "ชั่วโมงการ์ด / ชุด-ชั่วโมง · ราคาจริงต้องให้ผู้ให้บริการยืนยัน", hours: "ชั่วโมง", referenceRange: "ช่วงชั่วโมงการ์ดอ้างอิง", estimatedTotal: "ยอดคำขอราคาอ้างอิง", scopeStatus: "เพื่ออ้างอิง · ไม่จองสต็อก · ไม่ชำระเงิน · ไม่ซื้อขาย", flow: ["ส่งคำขอโดยไม่จองสต็อกหรือหักชั่วโมงการ์ด", "แพลตฟอร์มยืนยันสต็อกและราคาจริงโดยเจ้าหน้าที่", "ผู้ดูแลตรวจสอบคีย์สาธารณะและประสานการเปิดใช้งาน", "ผู้ซื้อทดสอบข้อมูลเชื่อมต่อด้วยตนเอง"], loginSubmit: "เข้าสู่ระบบเพื่อส่งคำขอ", inactiveSubmit: "กรอกข้อมูลผู้ทำธุรกรรมให้ครบ", checking: "กำลังตรวจสอบบัญชี…", submitting: "กำลังส่ง…", submit: "ส่งคำขอราคา" },
  vi: { successEyebrow: "Đã nhận yêu cầu", successTitle: "Đã gửi yêu cầu giá", applicationId: "ID yêu cầu: ", successHelp: "Nền tảng sẽ xác nhận thủ công tồn kho, mạng khu vực, điều kiện bàn giao và giá giờ-thẻ cuối cùng. Nhân viên vận hành sau đó chuyển khóa công khai SSH của bạn cho nhà cung cấp một cách an toàn và điều phối cấp phát. Đây chỉ là yêu cầu giá: không giữ hàng, không thanh toán, không phát sinh giao dịch và không tự động thao tác máy.", viewDetails: "Xem chi tiết yêu cầu này", viewAll: "Xem tất cả yêu cầu", continueBuy: "Tiếp tục chọn năng lực tính toán", back: "Quay lại các gói GPU", headingEyebrow: "Yêu cầu báo giá nhà cung cấp", title: "Xác nhận gói và thông tin hỏi giá", lead: "Kiểm tra gói GPU, số lượng, thời gian và tổng giờ-thẻ tham khảo. Nền tảng sẽ xác nhận tồn kho, mạng khu vực và giá cuối cùng sau khi gửi; trang này không tạo đơn hàng.", supplierSource: "Nguồn nhà cung cấp: ", dataSource: "Nguồn dữ liệu: ", supplierPending: "Báo giá nhà cung cấp · Chờ xác nhận", detailsEyebrow: "Thông tin hỏi giá", formTitle: "Nhập số lượng", quantity: "Số lượng tài nguyên", duration: "Thời gian dịch vụ (giờ)", startDate: "Ngày bắt đầu dự kiến", optionalNote: "Yêu cầu bổ sung (không bắt buộc)", notePlaceholder: "Ví dụ: mạng, lưu trữ, image, đường truyền riêng hoặc khung bàn giao", sshKey: "Khóa công khai SSH", sshPlaceholder: "ssh-ed25519 AAAA… your-device", sshHelp: "Chỉ gửi một dòng khóa công khai OpenSSH: Ed25519 hoặc RSA tối thiểu 2048 bit. Khóa được lưu để quản trị viên có thẩm quyền bàn giao thủ công. Không gửi khóa riêng tư.", safeError: "Không thể gửi yêu cầu giá. Hãy kiểm tra số lượng và ngày bắt đầu rồi thử lại.", requestId: "ID yêu cầu", summaryAria: "Tóm tắt giá", priceEyebrow: "Tóm tắt giá", cardHour: "giờ-thẻ", unitNote: "giờ-thẻ / bộ-giờ · Giá cuối cùng cần nhà cung cấp xác nhận", hours: "giờ", referenceRange: "Khoảng giờ-thẻ tham khảo", estimatedTotal: "Tổng tham khảo", scopeStatus: "Chỉ tham khảo · Không giữ hàng · Không thanh toán · Không giao dịch", flow: ["Gửi yêu cầu mà không giữ hàng hoặc trừ giờ-thẻ", "Nền tảng xác nhận thủ công tồn kho và giá cuối cùng", "Quản trị viên kiểm tra khóa công khai và điều phối cấp phát", "Người mua tự nghiệm thu thông tin kết nối"], loginSubmit: "Đăng nhập để gửi yêu cầu", inactiveSubmit: "Hoàn tất hồ sơ giao dịch", checking: "Đang kiểm tra tài khoản…", submitting: "Đang gửi…", submit: "Gửi yêu cầu giá" },
  id: { successEyebrow: "Permintaan diterima", successTitle: "Permintaan penawaran dikirim", applicationId: "ID aplikasi: ", successHelp: "Platform akan mengonfirmasi stok, jaringan regional, ketentuan pengiriman, dan harga akhir jam-kartu secara manual. Tim operasi kemudian meneruskan kunci publik SSH secara aman ke pemasok dan mengoordinasikan penyediaan. Ini hanya permintaan: tidak ada stok dipesan, pembayaran, transaksi, atau operasi mesin otomatis.", viewDetails: "Lihat detail permintaan ini", viewAll: "Lihat semua permintaan", continueBuy: "Lanjut mencari komputasi", back: "Kembali ke paket GPU", headingEyebrow: "Minta penawaran pemasok", title: "Konfirmasi paket dan detail permintaan", lead: "Tinjau paket GPU, jumlah, durasi, dan total referensi jam-kartu. Platform akan mengonfirmasi stok, jaringan, dan harga akhir setelah pengajuan; halaman ini tidak membuat pesanan.", supplierSource: "Sumber pemasok: ", dataSource: "Sumber data: ", supplierPending: "Penawaran pemasok · Menunggu konfirmasi", detailsEyebrow: "Detail permintaan", formTitle: "Masukkan jumlah", quantity: "Jumlah sumber daya", duration: "Durasi layanan (jam)", startDate: "Tanggal mulai rencana", optionalNote: "Persyaratan tambahan (opsional)", notePlaceholder: "Misalnya jaringan, penyimpanan, image, jalur privat, atau jendela pengiriman", sshKey: "Kunci publik SSH", sshPlaceholder: "ssh-ed25519 AAAA… your-device", sshHelp: "Kirim satu baris kunci publik OpenSSH saja: Ed25519 atau RSA minimal 2048 bit. Kunci disimpan untuk pengiriman manual oleh administrator berwenang. Jangan kirim kunci privat.", safeError: "Permintaan penawaran tidak dapat dikirim. Periksa jumlah dan tanggal mulai, lalu coba lagi.", requestId: "ID permintaan", summaryAria: "Ringkasan harga", priceEyebrow: "Ringkasan harga", cardHour: "jam-kartu", unitNote: "jam-kartu / set-jam · Harga akhir perlu konfirmasi pemasok", hours: "jam", referenceRange: "Kisaran referensi jam-kartu", estimatedTotal: "Total referensi", scopeStatus: "Referensi saja · Stok tidak dipesan · Tanpa pembayaran · Tanpa transaksi", flow: ["Ajukan permintaan tanpa memesan stok atau mengurangi jam-kartu", "Platform mengonfirmasi stok dan harga akhir secara manual", "Administrator memverifikasi kunci publik dan mengoordinasikan penyediaan", "Pembeli memvalidasi informasi koneksi sendiri"], loginSubmit: "Masuk untuk mengajukan", inactiveSubmit: "Lengkapi profil transaksi", checking: "Memeriksa akun…", submitting: "Mengirim…", submit: "Ajukan penawaran" },
  ms: { successEyebrow: "Pertanyaan diterima", successTitle: "Pertanyaan sebut harga dihantar", applicationId: "ID permohonan: ", successHelp: "Platform akan mengesahkan stok, rangkaian wilayah, syarat penghantaran dan harga akhir jam-kad secara manual. Pasukan operasi kemudian menghantar kunci awam SSH anda dengan selamat kepada pembekal dan menyelaras penyediaan. Ini hanya pertanyaan: tiada stok ditempah, bayaran, transaksi atau operasi mesin automatik.", viewDetails: "Lihat butiran permohonan ini", viewAll: "Lihat semua permohonan", continueBuy: "Terus cari pengkomputeran", back: "Kembali ke pakej GPU", headingEyebrow: "Minta sebut harga pembekal", title: "Sahkan pakej dan butiran pertanyaan", lead: "Semak pakej GPU, kuantiti, tempoh dan jumlah rujukan jam-kad. Platform akan mengesahkan stok, rangkaian dan harga akhir selepas hantaran; halaman ini tidak mewujudkan pesanan.", supplierSource: "Sumber pembekal: ", dataSource: "Sumber data: ", supplierPending: "Sebut harga pembekal · Menunggu pengesahan", detailsEyebrow: "Butiran pertanyaan", formTitle: "Masukkan kuantiti", quantity: "Kuantiti sumber", duration: "Tempoh perkhidmatan (jam)", startDate: "Tarikh mula dirancang", optionalNote: "Keperluan tambahan (pilihan)", notePlaceholder: "Contohnya rangkaian, storan, imej, talian peribadi atau tetingkap penghantaran", sshKey: "Kunci awam SSH", sshPlaceholder: "ssh-ed25519 AAAA… your-device", sshHelp: "Hantar satu baris kunci awam OpenSSH sahaja: Ed25519 atau RSA sekurang-kurangnya 2048 bit. Ia disimpan untuk penghantaran manual oleh pentadbir yang dibenarkan. Jangan hantar kunci peribadi.", safeError: "Pertanyaan tidak dapat dihantar. Semak kuantiti dan tarikh mula, kemudian cuba lagi.", requestId: "ID permintaan", summaryAria: "Ringkasan harga", priceEyebrow: "Ringkasan harga", cardHour: "jam-kad", unitNote: "jam-kad / set-jam · Harga akhir perlu pengesahan pembekal", hours: "jam", referenceRange: "Julat rujukan jam-kad", estimatedTotal: "Jumlah rujukan", scopeStatus: "Rujukan sahaja · Stok tidak ditempah · Tiada bayaran · Tiada transaksi", flow: ["Hantar pertanyaan tanpa menempah stok atau menolak jam-kad", "Platform mengesahkan stok dan harga akhir secara manual", "Pentadbir mengesahkan kunci awam dan menyelaras penyediaan", "Pembeli mengesahkan sendiri maklumat sambungan"], loginSubmit: "Log masuk untuk menghantar", inactiveSubmit: "Lengkapkan profil transaksi", checking: "Menyemak akaun…", submitting: "Menghantar…", submit: "Hantar pertanyaan" },
} satisfies Record<Locale, CatalogPurchaseCopy>;

type AccountSessionSnapshot = {
  authenticated?: boolean;
  organization?: { id?: string } | null;
  memberships?: Array<{ organizationId?: string; status?: string }>;
};

function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function CatalogPurchase({ resource, manualDeliveryEnabled }: { resource: ResourceListing; manualDeliveryEnabled: boolean }) {
  const { locale } = useLocale();
  const copy = CATALOG_PURCHASE_COPY[locale];
  const [quantity, setQuantity] = useState("1");
  const [durationHours, setDurationHours] = useState("24");
  const [deliveryDate, setDeliveryDate] = useState(tomorrow);
  const [note, setNote] = useState("");
  const [sshPublicKey, setSshPublicKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accountState, setAccountState] = useState<"loading" | "ready" | "signed-out" | "inactive">("loading");
  const [intent, setIntent] = useState<MarketplaceRequestRecord | null>(null);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response): Promise<AccountSessionSnapshot> => response.ok
        ? response.json() as Promise<AccountSessionSnapshot>
        : { authenticated: false })
      .then((session) => {
        if (session.authenticated !== true) {
          setAccountState("signed-out");
          return;
        }
        const active = session.memberships?.some((membership) => (
          membership.organizationId === session.organization?.id && membership.status === "ACTIVE"
        ));
        setAccountState(active ? "ready" : "inactive");
      })
      .catch((sessionError: unknown) => {
        if (sessionError instanceof DOMException && sessionError.name === "AbortError") return;
        setAccountState("signed-out");
      });
    return () => controller.abort();
  }, []);
  const usesDuration = hourlyUnits.has(resource.pricingUnit);
  const requiresSshPublicKey = manualDeliveryEnabled && requiresManualSshPublicKey(resource);
  const quantityNumber = Number(quantity);
  const durationNumber = usesDuration ? Number(durationHours) : 1;
  const estimatedAmount = useMemo(
    () => Number.isFinite(quantityNumber) && Number.isFinite(durationNumber) && quantityNumber > 0 && durationNumber > 0
      ? resource.quote.median * quantityNumber * durationNumber
      : 0,
    [durationNumber, quantityNumber, resource.quote.median],
  );
  const estimatedCardHours = estimatedAmount > 0 ? estimatedAmount / 1.002 : 0;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      keyRef.current ??= createIdempotencyKey("catalog-purchase");
      const result = await marketplacePost<MarketplaceRequestRecord>(
        "/api/v1/catalog-purchase-intents",
        {
          resourceId: resource.id,
          quantity: quantityNumber,
          durationHours: usesDuration ? durationNumber : null,
          deliveryDate,
          note,
          sshPublicKey: requiresSshPublicKey ? sshPublicKey.trim() : null,
        },
        keyRef.current,
        20_000,
      );
      keyRef.current = null;
      setIntent(result.record);
    } catch (submitError) {
      const requestId = submitError instanceof MarketplaceApiError ? submitError.requestId : undefined;
      setError(`${copy.safeError}${requestId ? ` (${copy.requestId}: ${requestId})` : ""}`);
    } finally {
      setBusy(false);
    }
  }

  if (intent) {
    return (
      <div className={`shell ${styles.page}`}>
        <section className={styles.success} aria-labelledby="purchase-success-title">
          <p className={styles.eyebrow}>{copy.successEyebrow}</p>
          <h2 id="purchase-success-title">{copy.successTitle}</h2>
          <p>{copy.applicationId}<strong>{intent.id}</strong></p>
          <p>{copy.successHelp}</p>
          <div className={styles.successActions}>
            <Link className="button button-primary" href={`/member/purchases/${encodeURIComponent(intent.id)}`}>{copy.viewDetails}</Link>
            <Link className="button button-secondary" href="/member/purchases">{copy.viewAll}</Link>
            <Link className="button button-secondary" href="/buy">{copy.continueBuy}</Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`shell ${styles.page}`}>
      <Link className={styles.backLink} href="/buy">← {copy.back}</Link>
      <header className={styles.heading}>
        <p>{copy.headingEyebrow}</p>
        <h1>{copy.title}</h1>
        <p>{copy.lead}</p>
      </header>

      <div className={styles.layout}>
        <main className={styles.main}>
          <section className={styles.resourceCard} aria-labelledby="purchase-resource-title">
            <p className={styles.eyebrow}>{resource.region} · {resource.deliveryForm}</p>
            <h2 id="purchase-resource-title">{resource.title}</h2>
            <p>{resource.summary}</p>
            <p className={styles.meta}><span>{resource.source ? `${copy.supplierSource}${resource.source.supplierName}` : resource.supplierName}</span><span>{resource.capacity}</span><span>SLA {resource.sla}</span></p>
            {resource.source ? <p className={styles.meta}><span>{copy.dataSource}《{resource.source.documentTitle}》</span><span>{resource.source.observedAt}</span><span>{copy.supplierPending}</span></p> : null}
            <dl className={styles.specs}>
              {Object.entries(resource.specs).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
          </section>

          <section className={styles.formSection} aria-labelledby="purchase-form-title">
            <p className={styles.eyebrow}>{copy.detailsEyebrow}</p>
            <h2 id="purchase-form-title">{copy.formTitle}</h2>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                {copy.quantity}
                <input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
              </label>
              {usesDuration ? (
                <label className={styles.field}>
                  {copy.duration}
                  <input type="number" min="1" step="1" value={durationHours} onChange={(event) => setDurationHours(event.target.value)} />
                </label>
              ) : null}
              <label className={styles.field}>
                {copy.startDate}
                <input type="date" min={tomorrow()} value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} />
              </label>
              <label className={`${styles.field} ${styles.wide}`}>
                {copy.optionalNote}
                <textarea maxLength={500} value={note} placeholder={copy.notePlaceholder} onChange={(event) => setNote(event.target.value)} />
              </label>
              {requiresSshPublicKey ? <label className={`${styles.field} ${styles.wide}`}>
                {copy.sshKey}
                <textarea autoCapitalize="off" autoCorrect="off" maxLength={8192} rows={4} spellCheck={false} value={sshPublicKey} placeholder={copy.sshPlaceholder} onChange={(event) => { setSshPublicKey(event.target.value); keyRef.current = null; }} />
                <small>{copy.sshHelp}</small>
              </label> : null}
            </div>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
          </section>
        </main>

        <aside className={styles.summary} aria-label={copy.summaryAria}>
          <p className={styles.eyebrow}>{copy.priceEyebrow}</p>
          <p className={styles.unitPrice}>
            {formatCardHourValue(resource.quote.median / 1.002)} {copy.cardHour}
            <span>{copy.unitNote}</span>
          </p>
          <dl className={styles.priceRows}>
            <div><dt>{copy.quantity}</dt><dd>{quantityNumber > 0 ? quantityNumber : "—"}</dd></div>
            {usesDuration ? <div><dt>{copy.duration}</dt><dd>{durationNumber > 0 ? `${durationNumber} ${copy.hours}` : "—"}</dd></div> : null}
            <div><dt>{copy.referenceRange}</dt><dd>{formatCardHourValue(resource.quote.rangeMin / 1.002)}–{formatCardHourValue(resource.quote.rangeMax / 1.002)} {copy.cardHour}</dd></div>
            <div><dt>{copy.estimatedTotal}</dt><dd className={styles.estimated}>{estimatedCardHours > 0 ? `${formatCardHourValue(estimatedCardHours)} ${copy.cardHour}` : "—"}</dd></div>
          </dl>
          <p className={styles.scope}>{resource.quote.scopeNote}</p>
          <p className={styles.scope}><strong>{copy.scopeStatus}</strong></p>
          <ol className={styles.flow}>
            {copy.flow.map((step) => <li key={step}>{step}</li>)}
          </ol>
          {accountState === "signed-out" ? (
            <Link className={styles.submit} href={`/login?returnTo=${encodeURIComponent(`/checkout/${resource.id}`)}`}>
              <span>{copy.loginSubmit}</span><span aria-hidden="true">→</span>
            </Link>
          ) : accountState === "inactive" ? (
            <Link className={styles.submit} href="/member#profile">
              <span>{copy.inactiveSubmit}</span><span aria-hidden="true">→</span>
            </Link>
          ) : (
            <button className={styles.submit} type="button" disabled={accountState !== "ready" || busy || estimatedAmount <= 0 || !deliveryDate || requiresSshPublicKey && sshPublicKey.trim().length < 40} onClick={() => void submit()}>
              <span>{accountState === "loading" ? copy.checking : busy ? copy.submitting : copy.submit}</span><span aria-hidden="true">→</span>
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}
