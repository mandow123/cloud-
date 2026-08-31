import type { Metadata } from "next";
import Link from "next/link";
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/server/request-locale";
import styles from "./guides.module.css";

const metadataCopy: Record<Locale, { title: string; description: string }> = {
  "zh-CN": { title: "使用教程", description: "KAI Cloud GPU 租用、个人 4090 上架、交付、计量和卡时结算教程。" },
  "zh-TW": { title: "使用教學", description: "KAI Cloud GPU 租用、個人 4090 上架、交付、計量和卡時計算教學。" },
  en: { title: "Guides", description: "Guides to renting GPUs, listing a personal 4090, delivery, metering, and card-hour settlement on KAI Cloud." },
  ja: { title: "利用ガイド", description: "KAI Cloud の GPU レンタル、個人 4090 出品、納品、計測、カード時間決済ガイド。" },
  ko: { title: "사용 가이드", description: "KAI Cloud GPU 대여, 개인 4090 등록, 제공, 계량 및 카드시간 정산 가이드입니다." },
  fr: { title: "Guides", description: "Guides KAI Cloud pour louer un GPU, publier une 4090 personnelle, livrer, mesurer et régler en heures-carte." },
  th: { title: "คู่มือการใช้งาน", description: "คู่มือ KAI Cloud สำหรับการเช่า GPU ลงรายการ 4090 การส่งมอบ การวัดผล และการชำระด้วยชั่วโมงการ์ด" },
  vi: { title: "Hướng dẫn sử dụng", description: "Hướng dẫn KAI Cloud về thuê GPU, đăng 4090 cá nhân, bàn giao, đo lường và quyết toán giờ-card." },
  id: { title: "Panduan", description: "Panduan KAI Cloud untuk menyewa GPU, mendaftarkan 4090 pribadi, penyerahan, pengukuran, dan penyelesaian jam-kartu." },
  ms: { title: "Panduan", description: "Panduan KAI Cloud untuk sewaan GPU, penyenaraian 4090 peribadi, penyerahan, pemeteran dan penyelesaian jam-kad." },
};

export async function generateMetadata(): Promise<Metadata> {
  return metadataCopy[await getRequestLocale()];
}

const EN: Record<string, string> = {
  "教程与操作手册": "Guides and operations manual",
  "进入 GPU 市场": "Open GPU market",
  "上架算力": "List compute",
  "教程章节": "Guide chapters",
  "开始使用": "Get started",
  "租用第一台 GPU": "Rent your first GPU",
  "如何比较资源": "How to compare resources",
  "上架一张 4090": "List a 4090",
  "接入云 GPU": "Connect a cloud GPU",
  "交付与连接": "Delivery and connection",
  "计量与验收": "Metering and acceptance",
  "卡时与结算": "Card hours and settlement",
  "本地闭环说明": "Local closed-loop note",
  "当前预览使用真实本地数据库和 TEST 状态机，不移动真实资金。": "This preview uses a real local database and TEST state machine. No real funds are moved.",
  "从一张 GPU，到一次完整服务。": "From one GPU to a complete service.",
  "KAI Cloud 同时服务两类人：需要算力的人，以及拥有算力的人。下面每条教程都对应网站中的真实操作入口。": "KAI Cloud serves people who need compute and people who own it. Every guide below points to a real workflow in the site.",
  "我是使用者": "I need compute",
  "5 分钟租用第一台 GPU": "Rent your first GPU in five minutes",
  "选择模板 → 比较资源 → 租用 → 连接": "Choose template → compare resources → rent → connect",
  "我是供应方": "I supply compute",
  "把 GPU 上架并获得卡时": "List a GPU and earn card hours",
  "登记 → 验真 → 上架 → 交付 → 结算": "Register → verify → list → deliver → settle",
  "先选软件环境，再找机器。模板决定实例启动后有什么，资源记录决定它跑在哪里、性能与价格是多少。": "Choose the software environment first, then the machine. The template defines the instance; the resource record defines location, performance, and price.",
  "选择模板": "Choose a template",
  "进入 GPU 市场，保留默认的 PyTorch + CUDA 模板，或按任务更换镜像与连接方式。": "Open the GPU market and keep the default PyTorch + CUDA template, or select an image and connection method for your task.",
  "筛选资源": "Filter resources",
  "按 GPU 型号、显存、区域、资源等级和连接方式缩小范围。": "Narrow results by GPU model, memory, region, resource tier, and connection method.",
  "查看卡时价格": "Review card-hour price",
  "资源卡主价格统一显示为 KAI 标准卡时 / GPU / 小时；人民币只作为固定换算参考。": "Primary prices use KAI standard card hours per GPU per hour; CNY is only a fixed conversion reference.",
  "创建租约": "Create a lease",
  "确认 GPU 数量、时长和预计卡时，创建 TEST 租约。平台会锁定容量并要求供应方确认。": "Confirm GPU count, duration, and estimated card hours, then create a TEST lease. Capacity is held pending supplier confirmation.",
  "领取并连接": "Claim and connect",
  "交付包通过核验后，领取一次性连接信息，由平台先做连接检查，再进入服务时间窗。": "After the delivery package is verified, claim one-time connection details. The platform checks connectivity before the service window begins.",
  "打开 GPU 市场开始操作 →": "Open the GPU market →",
  "如何比较两条 GPU 资源": "How to compare two GPU resources",
  "GPU 资源比较要点": "GPU comparison points",
  "指标": "Metric", "看什么": "What to check", "为什么重要": "Why it matters",
  "GPU 与显存": "GPU and memory", "准确型号、显存、卡数": "Exact model, memory, and GPU count", "决定模型规模和并行方式": "Determines model size and parallelism",
  "资源等级": "Resource tier", "已验真、社区、数据中心": "Verified, community, or data center", "决定适合实验还是生产": "Indicates experimental or production suitability",
  "可靠性": "Reliability", "可用率、响应时间、历史连接": "Availability, response time, and connection history", "长任务应优先看稳定性": "Stability matters most for long jobs",
  "交付方式": "Delivery method", "SSH、Jupyter、容器或裸金属": "SSH, Jupyter, container, or bare metal", "决定启动和运维方法": "Determines startup and operations",
  "总卡时": "Total card hours", "单价 × GPU 数量 × 服务时长": "Unit price × GPU count × service duration", "不要只看每卡小时单价": "Do not compare only the per-GPU hourly rate",
  "提示": "Note",
  "硬件制造商与实际算力供应方是两个字段。页面不会用 NVIDIA、AMD 或云厂商 Logo 暗示其为卖家或合作方。": "Hardware manufacturer and compute supplier are separate fields. Manufacturer or cloud-provider logos never imply that they are sellers or partners.",
  "上架一张个人 RTX 4090": "List a personal RTX 4090",
  "目标不是把名字放进供应商名录，而是让这张卡变成一条能被下单、交付、计量和验收的资源。": "The goal is not a supplier-directory entry, but a resource that can be ordered, delivered, metered, and accepted.",
  "准备主机": "Prepare the host", "确认 Linux、NVIDIA 驱动、Docker、稳定公网、可用端口和散热条件。": "Confirm Linux, NVIDIA drivers, Docker, stable public networking, available ports, and cooling.",
  "登记身份": "Register identity", "填写受控 GPU 型号、数量、区域和资源来源。4090 会记录为独立产品版本，不与 H100 混用。": "Provide the controlled GPU model, count, region, and source. A 4090 is recorded separately and never mixed with H100.",
  "完成验真": "Complete verification", "Connector 检查型号、24GB 显存、卡数、网络和连续时间窗；通过后生成验真凭证。": "The Connector checks model, 24 GB memory, GPU count, network, and continuous availability, then issues verification evidence.",
  "声明容量": "Declare capacity", "选择未来可出租的时间窗、最大并行 GPU 数和是否允许中断。": "Choose future rental windows, maximum parallel GPUs, and whether interruption is allowed.",
  "发布价格": "Publish price", "填写每 GPU / 小时的 KAI 标准卡时价格，系统生成不可变上架版本。": "Enter the KAI standard card-hour price per GPU per hour; the system creates an immutable listing version.",
  "接单与交付": "Accept and deliver", "供应方确认订单，准备隔离实例和脱敏连接档案；连接测试通过后才能开始计量。": "The supplier confirms the order and prepares an isolated instance and redacted connection record. Metering starts only after the connection test passes.",
  "打开个人 GPU 上架说明 →": "Open the personal GPU listing guide →",
  "接入云 GPU 或数据中心库存": "Connect cloud GPU or data-center inventory",
  "云上资源与个人 GPU 不需要两套交易系统。差别只在验真方法和交付方式：云资源优先用 Cloud API 核验实例身份，数据中心可用 Connector 与人工审核组合；之后都进入相同的容量批次、上架、订单、交付和计量链路。": "Cloud resources and personal GPUs share one transaction system. Only verification and delivery differ; both then follow the same capacity, listing, order, delivery, and metering flow.",
  "云资源上架流程": "Cloud resource listing flow", "云账号 / 机房资源": "Cloud account / facility resource", "API / Connector 验真": "API / Connector verification", "容量批次": "Capacity batch", "GPU 市场": "GPU market",
  "查看资源连接器与接入状态 →": "View connectors and onboarding status →",
  "交付与连接不是一句“已开通”": "Delivery is more than saying “activated”",
  "每笔订单都有独立交付任务。供应方只能提交脱敏端点、协议、端口、用户名提示、有效期和操作摘要；密码、私钥与 Token 不允许出现在公开档案中。平台审核通过后，买方领取一次性测试码并发起连接检查。": "Every order has a separate delivery task. Suppliers submit only redacted connection details. Passwords, private keys, and tokens are never stored in public records. After review, the buyer claims a one-time test code and starts a connection check.",
  "服务只能在固定订单时间窗内启动。实例启动后，计量会话从 SCHEDULED 进入 ACTIVE；时间窗结束后汇总可用与不可用 GPU 秒，形成 FINAL 计量记录。买方查看连接、服务窗与证据后选择验收或争议。": "Service starts only inside the order window. Metering moves from SCHEDULED to ACTIVE and produces a FINAL record of available and unavailable GPU seconds. The buyer then accepts or disputes the evidence.",
  "GPU 数量 × 服务秒数": "GPU count × service seconds",
  "卡时与测试结算": "Card hours and test settlement",
  "网站中的市场价格、订单预计支付和供应方应收都优先使用 KAI 标准卡时。固定参考为 1 KAI 标准卡时 = ¥1.002。当前本地闭环只记录 TEST 支付与测试结算，": "Market prices, estimated order charges, and supplier receivables use KAI standard card hours. The fixed reference is 1 KAI standard card hour = ¥1.002. This local loop records only TEST payments and settlements; ",
  "fundsMoved 永远为 false": "fundsMoved is always false",
  "；真实充值、扣减与变现保持关闭。": "; real top-ups, deductions, and cash conversion remain disabled.",
  "成交卡时": "Gross card hours", "未交付 / 争议抵扣": "Undelivered / dispute credits", "供应方可结算": "Supplier net payable", "LOCAL TEST · 不代表真实余额或支付凭证": "LOCAL TEST · Not a real balance or payment receipt",
  "在本地订单中走完结算 →": "Complete a local order settlement →", "下一步": "Next step", "选择一条路线并真正操作一次": "Choose a path and complete one real workflow", "租用 GPU": "Rent GPU", "上架 GPU": "List GPU", "本页目录": "On this page",
};

const CORE: Record<Exclude<Locale, "zh-CN" | "en">, Record<string, string>> = {
  "zh-TW": { "教程与操作手册": "教學與操作手冊", "教程章节": "教學章節", "开始使用": "開始使用", "租用第一台 GPU": "租用第一台 GPU", "如何比较资源": "如何比較資源", "上架一张 4090": "上架一張 4090", "接入云 GPU": "接入雲端 GPU", "交付与连接": "交付與連接", "计量与验收": "計量與驗收", "卡时与结算": "卡時與結算", "进入 GPU 市场": "進入 GPU 市場", "上架算力": "上架算力", "本地闭环说明": "本地閉環說明", "从一张 GPU，到一次完整服务。": "從一張 GPU，到一次完整服務。", "我是使用者": "我是使用者", "我是供应方": "我是供應方", "选择模板": "選擇範本", "筛选资源": "篩選資源", "查看卡时价格": "查看卡時價格", "创建租约": "建立租約", "领取并连接": "領取並連接", "如何比较两条 GPU 资源": "如何比較兩條 GPU 資源", "指标": "指標", "看什么": "查看內容", "为什么重要": "重要原因", "资源等级": "資源等級", "可靠性": "可靠性", "交付方式": "交付方式", "总卡时": "總卡時", "提示": "提示", "上架一张个人 RTX 4090": "上架一張個人 RTX 4090", "准备主机": "準備主機", "登记身份": "登記身分", "完成验真": "完成驗證", "声明容量": "聲明容量", "发布价格": "發布價格", "接单与交付": "接單與交付", "接入云 GPU 或数据中心库存": "接入雲端 GPU 或資料中心庫存", "云资源上架流程": "雲端資源上架流程", "交付与连接不是一句“已开通”": "交付與連接不只是一句「已開通」", "卡时与测试结算": "卡時與測試結算", "下一步": "下一步", "本页目录": "本頁目錄", "租用 GPU": "租用 GPU", "上架 GPU": "上架 GPU" },
  ja: { "教程与操作手册": "ガイドと操作マニュアル", "教程章节": "ガイドの章", "开始使用": "はじめに", "租用第一台 GPU": "最初の GPU を借りる", "如何比较资源": "リソースの比較方法", "上架一张 4090": "4090 を掲載", "接入云 GPU": "クラウド GPU を接続", "交付与连接": "納品と接続", "计量与验收": "計測と検収", "卡时与结算": "カード時間と決済", "进入 GPU 市场": "GPU市場を開く", "上架算力": "計算資源を出品", "本地闭环说明": "ローカル閉ループについて", "从一张 GPU，到一次完整服务。": "1枚の GPU から完全なサービスへ。", "我是使用者": "利用者", "我是供应方": "提供者", "选择模板": "テンプレートを選択", "筛选资源": "リソースを絞り込む", "查看卡时价格": "カード時間価格を確認", "创建租约": "契約を作成", "领取并连接": "受領して接続", "如何比较两条 GPU 资源": "2つの GPU リソースを比較", "指标": "指標", "看什么": "確認項目", "为什么重要": "重要な理由", "资源等级": "リソース階層", "可靠性": "信頼性", "交付方式": "納品方法", "总卡时": "合計カード時間", "提示": "注意", "上架一张个人 RTX 4090": "個人 RTX 4090 を掲載", "准备主机": "ホストを準備", "登记身份": "識別情報を登録", "完成验真": "検証を完了", "声明容量": "容量を申告", "发布价格": "価格を公開", "接单与交付": "受注と納品", "接入云 GPU 或数据中心库存": "クラウド GPU またはデータセンター在庫を接続", "云资源上架流程": "クラウド資源の掲載フロー", "交付与连接不是一句“已开通”": "納品は「有効化済み」の一言ではありません", "卡时与测试结算": "カード時間とテスト決済", "下一步": "次のステップ", "本页目录": "このページ", "租用 GPU": "GPU を借りる", "上架 GPU": "GPU を掲載" },
  ko: { "教程与操作手册": "가이드 및 운영 설명서", "教程章节": "가이드 목차", "开始使用": "시작하기", "租用第一台 GPU": "첫 GPU 대여", "如何比较资源": "리소스 비교 방법", "上架一张 4090": "4090 등록", "接入云 GPU": "클라우드 GPU 연결", "交付与连接": "인도 및 연결", "计量与验收": "계량 및 검수", "卡时与结算": "카드시간 및 정산", "进入 GPU 市场": "GPU 마켓 열기", "上架算力": "컴퓨팅 등록", "本地闭环说明": "로컬 폐쇄 루프 안내", "从一张 GPU，到一次完整服务。": "한 장의 GPU에서 완전한 서비스까지.", "我是使用者": "사용자", "我是供应方": "공급자", "选择模板": "템플릿 선택", "筛选资源": "리소스 필터", "查看卡时价格": "카드시간 가격 확인", "创建租约": "대여 계약 생성", "领取并连接": "수령 및 연결", "如何比较两条 GPU 资源": "두 GPU 리소스 비교", "指标": "지표", "看什么": "확인 항목", "为什么重要": "중요한 이유", "资源等级": "리소스 등급", "可靠性": "신뢰성", "交付方式": "인도 방식", "总卡时": "총 카드시간", "提示": "안내", "上架一张个人 RTX 4090": "개인 RTX 4090 등록", "准备主机": "호스트 준비", "登记身份": "신원 등록", "完成验真": "검증 완료", "声明容量": "용량 선언", "发布价格": "가격 게시", "接单与交付": "주문 수락 및 인도", "接入云 GPU 或数据中心库存": "클라우드 GPU 또는 데이터센터 재고 연결", "云资源上架流程": "클라우드 리소스 등록 흐름", "交付与连接不是一句“已开通”": "인도는 단순한 ‘활성화 완료’가 아닙니다", "卡时与测试结算": "카드시간 및 테스트 정산", "下一步": "다음 단계", "本页目录": "이 페이지", "租用 GPU": "GPU 대여", "上架 GPU": "GPU 등록" },
  fr: { "教程与操作手册": "Guides et manuel d’exploitation", "教程章节": "Chapitres du guide", "开始使用": "Bien démarrer", "租用第一台 GPU": "Louer son premier GPU", "如何比较资源": "Comparer les ressources", "上架一张 4090": "Publier une 4090", "接入云 GPU": "Connecter un GPU cloud", "交付与连接": "Livraison et connexion", "计量与验收": "Mesure et réception", "卡时与结算": "Heures-carte et règlement", "进入 GPU 市场": "Ouvrir le marché GPU", "上架算力": "Publier du calcul", "本地闭环说明": "Note sur la boucle locale", "从一张 GPU，到一次完整服务。": "D’un GPU à un service complet.", "我是使用者": "Je cherche du calcul", "我是供应方": "Je fournis du calcul", "选择模板": "Choisir un modèle", "筛选资源": "Filtrer les ressources", "查看卡时价格": "Voir le prix en heures-carte", "创建租约": "Créer un contrat", "领取并连接": "Récupérer et se connecter", "如何比较两条 GPU 资源": "Comparer deux ressources GPU", "指标": "Critère", "看什么": "À vérifier", "为什么重要": "Pourquoi", "资源等级": "Niveau de ressource", "可靠性": "Fiabilité", "交付方式": "Mode de livraison", "总卡时": "Total d’heures-carte", "提示": "Remarque", "上架一张个人 RTX 4090": "Publier une RTX 4090 personnelle", "准备主机": "Préparer l’hôte", "登记身份": "Enregistrer l’identité", "完成验真": "Terminer la vérification", "声明容量": "Déclarer la capacité", "发布价格": "Publier le prix", "接单与交付": "Accepter et livrer", "接入云 GPU 或数据中心库存": "Connecter un GPU cloud ou un stock de centre de données", "云资源上架流程": "Flux de publication cloud", "交付与连接不是一句“已开通”": "La livraison ne se résume pas à « activé »", "卡时与测试结算": "Heures-carte et règlement de test", "下一步": "Étape suivante", "本页目录": "Sur cette page", "租用 GPU": "Louer un GPU", "上架 GPU": "Publier un GPU" },
  th: { "教程与操作手册": "คู่มือและการดำเนินงาน", "教程章节": "บทในคู่มือ", "开始使用": "เริ่มต้นใช้งาน", "租用第一台 GPU": "เช่า GPU เครื่องแรก", "如何比较资源": "วิธีเปรียบเทียบทรัพยากร", "上架一张 4090": "ลงรายการ 4090", "接入云 GPU": "เชื่อมต่อ GPU คลาวด์", "交付与连接": "ส่งมอบและเชื่อมต่อ", "计量与验收": "การวัดและตรวจรับ", "卡时与结算": "ชั่วโมงการ์ดและการชำระ", "进入 GPU 市场": "เปิดตลาด GPU", "上架算力": "ลงรายการกำลังประมวลผล", "本地闭环说明": "หมายเหตุวงจรภายใน", "从一张 GPU，到一次完整服务。": "จาก GPU หนึ่งใบสู่บริการที่สมบูรณ์", "我是使用者": "ฉันต้องการใช้งาน", "我是供应方": "ฉันเป็นผู้ให้บริการ", "选择模板": "เลือกเทมเพลต", "筛选资源": "กรองทรัพยากร", "查看卡时价格": "ดูราคาชั่วโมงการ์ด", "创建租约": "สร้างสัญญาเช่า", "领取并连接": "รับและเชื่อมต่อ", "如何比较两条 GPU 资源": "เปรียบเทียบทรัพยากร GPU สองรายการ", "指标": "ตัวชี้วัด", "看什么": "สิ่งที่ต้องดู", "为什么重要": "เหตุผลที่สำคัญ", "资源等级": "ระดับทรัพยากร", "可靠性": "ความน่าเชื่อถือ", "交付方式": "วิธีส่งมอบ", "总卡时": "ชั่วโมงการ์ดรวม", "提示": "หมายเหตุ", "上架一张个人 RTX 4090": "ลงรายการ RTX 4090 ส่วนบุคคล", "准备主机": "เตรียมโฮสต์", "登记身份": "ลงทะเบียนตัวตน", "完成验真": "ยืนยันให้เสร็จ", "声明容量": "แจ้งความจุ", "发布价格": "เผยแพร่ราคา", "接单与交付": "รับคำสั่งและส่งมอบ", "接入云 GPU 或数据中心库存": "เชื่อมต่อ GPU คลาวด์หรือสต็อกศูนย์ข้อมูล", "云资源上架流程": "ขั้นตอนลงรายการคลาวด์", "交付与连接不是一句“已开通”": "การส่งมอบไม่ใช่เพียงคำว่า ‘เปิดใช้แล้ว’", "卡时与测试结算": "ชั่วโมงการ์ดและการชำระทดสอบ", "下一步": "ขั้นตอนถัดไป", "本页目录": "ในหน้านี้", "租用 GPU": "เช่า GPU", "上架 GPU": "ลงรายการ GPU" },
  vi: { "教程与操作手册": "Hướng dẫn và sổ tay vận hành", "教程章节": "Các chương hướng dẫn", "开始使用": "Bắt đầu", "租用第一台 GPU": "Thuê GPU đầu tiên", "如何比较资源": "Cách so sánh tài nguyên", "上架一张 4090": "Đăng một 4090", "接入云 GPU": "Kết nối GPU đám mây", "交付与连接": "Bàn giao và kết nối", "计量与验收": "Đo lường và nghiệm thu", "卡时与结算": "Giờ-thẻ và quyết toán", "进入 GPU 市场": "Mở chợ GPU", "上架算力": "Đăng tài nguyên", "本地闭环说明": "Lưu ý vòng khép kín cục bộ", "从一张 GPU，到一次完整服务。": "Từ một GPU đến một dịch vụ hoàn chỉnh.", "我是使用者": "Tôi cần tài nguyên", "我是供应方": "Tôi cung cấp tài nguyên", "选择模板": "Chọn mẫu", "筛选资源": "Lọc tài nguyên", "查看卡时价格": "Xem giá giờ-thẻ", "创建租约": "Tạo hợp đồng thuê", "领取并连接": "Nhận và kết nối", "如何比较两条 GPU 资源": "So sánh hai tài nguyên GPU", "指标": "Tiêu chí", "看什么": "Cần xem", "为什么重要": "Vì sao quan trọng", "资源等级": "Cấp tài nguyên", "可靠性": "Độ tin cậy", "交付方式": "Cách bàn giao", "总卡时": "Tổng giờ-thẻ", "提示": "Lưu ý", "上架一张个人 RTX 4090": "Đăng RTX 4090 cá nhân", "准备主机": "Chuẩn bị máy chủ", "登记身份": "Đăng ký danh tính", "完成验真": "Hoàn tất xác minh", "声明容量": "Khai báo dung lượng", "发布价格": "Công bố giá", "接单与交付": "Nhận đơn và bàn giao", "接入云 GPU 或数据中心库存": "Kết nối GPU đám mây hoặc kho trung tâm dữ liệu", "云资源上架流程": "Quy trình đăng tài nguyên đám mây", "交付与连接不是一句“已开通”": "Bàn giao không chỉ là nói ‘đã kích hoạt’", "卡时与测试结算": "Giờ-thẻ và quyết toán thử nghiệm", "下一步": "Bước tiếp theo", "本页目录": "Trong trang này", "租用 GPU": "Thuê GPU", "上架 GPU": "Đăng GPU" },
  id: { "教程与操作手册": "Panduan dan manual operasi", "教程章节": "Bab panduan", "开始使用": "Mulai", "租用第一台 GPU": "Sewa GPU pertama", "如何比较资源": "Cara membandingkan sumber daya", "上架一张 4090": "Listing satu 4090", "接入云 GPU": "Hubungkan GPU cloud", "交付与连接": "Pengiriman dan koneksi", "计量与验收": "Metering dan penerimaan", "卡时与结算": "Jam-kartu dan penyelesaian", "进入 GPU 市场": "Buka pasar GPU", "上架算力": "Daftarkan komputasi", "本地闭环说明": "Catatan alur lokal", "从一张 GPU，到一次完整服务。": "Dari satu GPU menjadi layanan lengkap.", "我是使用者": "Saya pengguna", "我是供应方": "Saya pemasok", "选择模板": "Pilih templat", "筛选资源": "Filter sumber daya", "查看卡时价格": "Lihat harga jam-kartu", "创建租约": "Buat sewa", "领取并连接": "Klaim dan hubungkan", "如何比较两条 GPU 资源": "Bandingkan dua sumber daya GPU", "指标": "Metrik", "看什么": "Yang diperiksa", "为什么重要": "Mengapa penting", "资源等级": "Tingkat sumber daya", "可靠性": "Keandalan", "交付方式": "Metode pengiriman", "总卡时": "Total jam-kartu", "提示": "Catatan", "上架一张个人 RTX 4090": "Listing RTX 4090 pribadi", "准备主机": "Siapkan host", "登记身份": "Daftarkan identitas", "完成验真": "Selesaikan verifikasi", "声明容量": "Nyatakan kapasitas", "发布价格": "Publikasikan harga", "接单与交付": "Terima dan kirim", "接入云 GPU 或数据中心库存": "Hubungkan GPU cloud atau inventaris pusat data", "云资源上架流程": "Alur listing cloud", "交付与连接不是一句“已开通”": "Pengiriman bukan sekadar ‘diaktifkan’", "卡时与测试结算": "Jam-kartu dan penyelesaian uji", "下一步": "Langkah berikutnya", "本页目录": "Di halaman ini", "租用 GPU": "Sewa GPU", "上架 GPU": "Listing GPU" },
  ms: { "教程与操作手册": "Panduan dan manual operasi", "教程章节": "Bab panduan", "开始使用": "Mula", "租用第一台 GPU": "Sewa GPU pertama", "如何比较资源": "Cara membandingkan sumber", "上架一张 4090": "Senaraikan satu 4090", "接入云 GPU": "Sambungkan GPU awan", "交付与连接": "Penyerahan dan sambungan", "计量与验收": "Pemeteran dan penerimaan", "卡时与结算": "Jam-kad dan penyelesaian", "进入 GPU 市场": "Buka pasaran GPU", "上架算力": "Senaraikan pengkomputeran", "本地闭环说明": "Nota aliran setempat", "从一张 GPU，到一次完整服务。": "Daripada satu GPU kepada perkhidmatan lengkap.", "我是使用者": "Saya pengguna", "我是供应方": "Saya pembekal", "选择模板": "Pilih templat", "筛选资源": "Tapis sumber", "查看卡时价格": "Lihat harga jam-kad", "创建租约": "Cipta sewaan", "领取并连接": "Tuntut dan sambung", "如何比较两条 GPU 资源": "Bandingkan dua sumber GPU", "指标": "Metrik", "看什么": "Perkara diperiksa", "为什么重要": "Mengapa penting", "资源等级": "Tahap sumber", "可靠性": "Kebolehpercayaan", "交付方式": "Kaedah penyerahan", "总卡时": "Jumlah jam-kad", "提示": "Nota", "上架一张个人 RTX 4090": "Senaraikan RTX 4090 peribadi", "准备主机": "Sediakan hos", "登记身份": "Daftar identiti", "完成验真": "Lengkapkan pengesahan", "声明容量": "Isytiharkan kapasiti", "发布价格": "Terbitkan harga", "接单与交付": "Terima dan serah", "接入云 GPU 或数据中心库存": "Sambungkan GPU awan atau inventori pusat data", "云资源上架流程": "Aliran penyenaraian awan", "交付与连接不是一句“已开通”": "Penyerahan bukan sekadar ‘diaktifkan’", "卡时与测试结算": "Jam-kad dan penyelesaian ujian", "下一步": "Langkah seterusnya", "本页目录": "Pada halaman ini", "租用 GPU": "Sewa GPU", "上架 GPU": "Senarai GPU" },
};

function localizeText(locale: Locale, value: string) {
  if (locale === "zh-CN") return value;
  const trimmed = value.trim();
  const translated = (locale === "en" ? undefined : CORE[locale][trimmed]) ?? EN[trimmed];
  return translated ? value.replace(trimmed, translated) : value;
}

function localizeNode(locale: Locale, node: ReactNode): ReactNode {
  if (typeof node === "string") return localizeText(locale, node);
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(element.props)) {
    next[key] = key === "children"
      ? Children.map(value as ReactNode, (child) => localizeNode(locale, child))
      : typeof value === "string" ? localizeText(locale, value) : value;
  }
  return cloneElement(element, next);
}

const chapters = [
  { href: "#start", label: "开始使用" },
  { href: "#rent-gpu", label: "租用第一台 GPU" },
  { href: "#choosing-offer", label: "如何比较资源" },
  { href: "#list-4090", label: "上架一张 4090" },
  { href: "#cloud-host", label: "接入云 GPU" },
  { href: "#delivery", label: "交付与连接" },
  { href: "#metering", label: "计量与验收" },
  { href: "#card-hours", label: "卡时与结算" },
];

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <li><span>{number}</span><div><h3>{title}</h3><p>{children}</p></div></li>;
}

export default async function GuidesPage() {
  const locale = await getRequestLocale();
  return localizeNode(locale,
    <div className={styles.docsPage}>
      <div className={styles.docsTopbar}>
        <div><span>KAI Cloud Docs</span><b>教程与操作手册</b></div>
        <div><Link href="/gpu">进入 GPU 市场</Link><Link href="/hosting">上架算力</Link></div>
      </div>
      <div className={styles.docsLayout}>
        <aside className={styles.sidebar}>
          <p>GETTING STARTED</p>
          <nav aria-label="教程章节">
            {chapters.map((chapter) => <a href={chapter.href} key={chapter.href}>{chapter.label}</a>)}
          </nav>
          <div className={styles.sidebarCard}>
            <strong>本地闭环说明</strong>
            <span>当前预览使用真实本地数据库和 TEST 状态机，不移动真实资金。</span>
          </div>
        </aside>

        <article className={styles.article}>
          <header id="start" className={styles.articleHero}>
            <p>开始使用</p>
            <h1>从一张 GPU，到一次完整服务。</h1>
            <p>KAI Cloud 同时服务两类人：需要算力的人，以及拥有算力的人。下面每条教程都对应网站中的真实操作入口。</p>
            <div className={styles.choiceGrid}>
              <Link href="/gpu"><span>我是使用者</span><strong>5 分钟租用第一台 GPU</strong><small>选择模板 → 比较资源 → 租用 → 连接</small></Link>
              <Link href="/hosting"><span>我是供应方</span><strong>把 GPU 上架并获得卡时</strong><small>登记 → 验真 → 上架 → 交付 → 结算</small></Link>
            </div>
          </header>

          <section id="rent-gpu">
            <div className={styles.sectionLabel}>01 · RENTER</div>
            <h2>租用第一台 GPU</h2>
            <p className={styles.lead}>先选软件环境，再找机器。模板决定实例启动后有什么，资源记录决定它跑在哪里、性能与价格是多少。</p>
            <ol className={styles.steps}>
              <Step number="1" title="选择模板">进入 GPU 市场，保留默认的 PyTorch + CUDA 模板，或按任务更换镜像与连接方式。</Step>
              <Step number="2" title="筛选资源">按 GPU 型号、显存、区域、资源等级和连接方式缩小范围。</Step>
              <Step number="3" title="查看卡时价格">资源卡主价格统一显示为 KAI 标准卡时 / GPU / 小时；人民币只作为固定换算参考。</Step>
              <Step number="4" title="创建租约">确认 GPU 数量、时长和预计卡时，创建 TEST 租约。平台会锁定容量并要求供应方确认。</Step>
              <Step number="5" title="领取并连接">交付包通过核验后，领取一次性连接信息，由平台先做连接检查，再进入服务时间窗。</Step>
            </ol>
            <Link className={styles.actionLink} href="/gpu">打开 GPU 市场开始操作 →</Link>
          </section>

          <section id="choosing-offer">
            <div className={styles.sectionLabel}>02 · MARKET</div>
            <h2>如何比较两条 GPU 资源</h2>
            <div className={styles.compareTable} role="table" aria-label="GPU 资源比较要点">
              <div role="row"><strong role="columnheader">指标</strong><strong role="columnheader">看什么</strong><strong role="columnheader">为什么重要</strong></div>
              <div role="row"><span>GPU 与显存</span><span>准确型号、显存、卡数</span><span>决定模型规模和并行方式</span></div>
              <div role="row"><span>资源等级</span><span>已验真、社区、数据中心</span><span>决定适合实验还是生产</span></div>
              <div role="row"><span>可靠性</span><span>可用率、响应时间、历史连接</span><span>长任务应优先看稳定性</span></div>
              <div role="row"><span>交付方式</span><span>SSH、Jupyter、容器或裸金属</span><span>决定启动和运维方法</span></div>
              <div role="row"><span>总卡时</span><span>单价 × GPU 数量 × 服务时长</span><span>不要只看每卡小时单价</span></div>
            </div>
            <div className={styles.note}><strong>提示</strong><p>硬件制造商与实际算力供应方是两个字段。页面不会用 NVIDIA、AMD 或云厂商 Logo 暗示其为卖家或合作方。</p></div>
          </section>

          <section id="list-4090">
            <div className={styles.sectionLabel}>03 · PERSONAL HOST</div>
            <h2>上架一张个人 RTX 4090</h2>
            <p className={styles.lead}>目标不是把名字放进供应商名录，而是让这张卡变成一条能被下单、交付、计量和验收的资源。</p>
            <ol className={styles.steps}>
              <Step number="1" title="准备主机">确认 Linux、NVIDIA 驱动、Docker、稳定公网、可用端口和散热条件。</Step>
              <Step number="2" title="登记身份">填写受控 GPU 型号、数量、区域和资源来源。4090 会记录为独立产品版本，不与 H100 混用。</Step>
              <Step number="3" title="完成验真">Connector 检查型号、24GB 显存、卡数、网络和连续时间窗；通过后生成验真凭证。</Step>
              <Step number="4" title="声明容量">选择未来可出租的时间窗、最大并行 GPU 数和是否允许中断。</Step>
              <Step number="5" title="发布价格">填写每 GPU / 小时的 KAI 标准卡时价格，系统生成不可变上架版本。</Step>
              <Step number="6" title="接单与交付">供应方确认订单，准备隔离实例和脱敏连接档案；连接测试通过后才能开始计量。</Step>
            </ol>
            <Link className={styles.actionLink} href="/hosting/personal-gpu">打开个人 GPU 上架说明 →</Link>
          </section>

          <section id="cloud-host">
            <div className={styles.sectionLabel}>04 · CLOUD & DATACENTER</div>
            <h2>接入云 GPU 或数据中心库存</h2>
            <p>云上资源与个人 GPU 不需要两套交易系统。差别只在验真方法和交付方式：云资源优先用 Cloud API 核验实例身份，数据中心可用 Connector 与人工审核组合；之后都进入相同的容量批次、上架、订单、交付和计量链路。</p>
            <div className={styles.flowDiagram} aria-label="云资源上架流程">
              <span>云账号 / 机房资源</span><i>→</i><span>API / Connector 验真</span><i>→</i><span>容量批次</span><i>→</i><span>GPU 市场</span>
            </div>
            <Link className={styles.actionLink} href="/hosting/cloud">查看资源连接器与接入状态 →</Link>
          </section>

          <section id="delivery">
            <div className={styles.sectionLabel}>05 · DELIVERY</div>
            <h2>交付与连接不是一句“已开通”</h2>
            <p>每笔订单都有独立交付任务。供应方只能提交脱敏端点、协议、端口、用户名提示、有效期和操作摘要；密码、私钥与 Token 不允许出现在公开档案中。平台审核通过后，买方领取一次性测试码并发起连接检查。</p>
            <div className={styles.stateLine}><span>PROVISIONING</span><i>→</i><span>PACKAGE VERIFIED</span><i>→</i><span>CLAIMED</span><i>→</i><strong>CONNECTION PASSED</strong></div>
          </section>

          <section id="metering">
            <div className={styles.sectionLabel}>06 · METERING</div>
            <h2>计量与验收</h2>
            <p>服务只能在固定订单时间窗内启动。实例启动后，计量会话从 SCHEDULED 进入 ACTIVE；时间窗结束后汇总可用与不可用 GPU 秒，形成 FINAL 计量记录。买方查看连接、服务窗与证据后选择验收或争议。</p>
            <div className={styles.codeLike}>
              <span>scheduled_gpu_seconds</span><b>=</b><span>GPU 数量 × 服务秒数</span>
              <span>available_gpu_seconds</span><b>+</b><span>unavailable_gpu_seconds</span>
              <span>acceptance</span><b>=</b><span>ACCEPTED / DISPUTED</span>
            </div>
          </section>

          <section id="card-hours">
            <div className={styles.sectionLabel}>07 · KAI STANDARD HOURS</div>
            <h2>卡时与测试结算</h2>
            <p>网站中的市场价格、订单预计支付和供应方应收都优先使用 KAI 标准卡时。固定参考为 1 KAI 标准卡时 = ¥1.002。当前本地闭环只记录 TEST 支付与测试结算，<strong>fundsMoved 永远为 false</strong>；真实充值、扣减与变现保持关闭。</p>
            <div className={styles.settlementCard}>
              <div><span>成交卡时</span><strong>Gross</strong></div>
              <div><span>未交付 / 争议抵扣</span><strong>Credits</strong></div>
              <div><span>供应方可结算</span><strong>Net payable</strong></div>
              <small>LOCAL TEST · 不代表真实余额或支付凭证</small>
            </div>
            <Link className={styles.actionLink} href="/gpu">在本地订单中走完结算 →</Link>
          </section>

          <footer className={styles.articleFooter}>
            <div><span>下一步</span><strong>选择一条路线并真正操作一次</strong></div>
            <div><Link href="/gpu">租用 GPU</Link><Link href="/hosting">上架 GPU</Link></div>
          </footer>
        </article>

        <aside className={styles.onThisPage}>
          <p>本页目录</p>
          {chapters.slice(1).map((chapter) => <a href={chapter.href} key={chapter.href}>{chapter.label}</a>)}
        </aside>
      </div>
    </div>
  ) as ReactElement;
}
