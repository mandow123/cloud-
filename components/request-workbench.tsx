"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import {
  createIdempotencyKey,
  MarketplaceApiError,
  marketplacePost,
} from "@/lib/client/marketplace-client";
import type { Locale } from "@/lib/i18n";
import {
  marketplaceRegions,
  type MarketplaceRegion,
  type MarketplaceRequestRecord,
} from "@/lib/marketplace";
import type { DealMode, PricingUnit, ResourceCategory } from "@/lib/types";

export type RequestPrefill = {
  title?: string;
  category?: ResourceCategory;
  pricingUnit?: PricingUnit;
  region?: string;
};

type RequestWorkbenchProps = {
  initialMode?: DealMode;
  initialPrefill?: RequestPrefill;
};

type ProcurementValues = {
  dealMode: "rental" | "service";
  category: ResourceCategory;
  pricingUnit: PricingUnit;
  quantity: string;
  duration: string;
  region: string;
  deliveryDate: string;
  requirements: string;
  consent: boolean;
};

type SwapValues = {
  offeredCategory: ResourceCategory;
  offeredUnit: PricingUnit;
  offeredQuantity: string;
  offeredDescription: string;
  wantedCategory: ResourceCategory;
  wantedUnit: PricingUnit;
  wantedQuantity: string;
  wantedDescription: string;
  region: string;
  cashDirection: "none" | "offer" | "request";
  cashAmount: string;
  consent: boolean;
};

type Confirmation = {
  id: string;
  mode: "procurement" | "swap";
  title: string;
};

type RequestCopy = Readonly<{
  categories: Readonly<Record<ResourceCategory, string>>;
  units: Readonly<Record<PricingUnit, string>>;
  duration: Readonly<{ noDuration: string; quantityPrefix: string; quantitySuffix: string; durationLabel: string; durationHelp: string }>;
  validation: Readonly<{ positiveQuantity: string; positiveDuration: string; selectRegion: string; selectDate: string; requirementsLength: string; consent: string; positiveOfferedQuantity: string; offeredDescriptionLength: string; positiveWantedQuantity: string; wantedDescriptionLength: string; selectMatchRegion: string; positiveCash: string }>;
  common: Readonly<{ resourceType: string; pricingUnit: string; quantity: string; select: string; consentText: string; submitting: string; serverFallback: string; requestIdLabel: string }>;
  flow: Readonly<{ aria: string; stepType: string; stepDescribe: string; stepConfirm: string; title: string; typeAria: string; procurementTab: string; swapTab: string }>;
  procurement: Readonly<{ basicInfo: string; dealMode: string; rental: string; service: string; demandQuantity: string; expectedRegion: string; startDate: string; requirements: string; placeholder: string; submit: string }>;
  swap: Readonly<{ offered: string; swapTo: string; wanted: string; matching: string; expectedRegion: string; cashDifference: string; noCash: string; weAdd: string; theyAdd: string; cashLimit: string; submit: string; specs: string; offeredPlaceholder: string; wantedPlaceholder: string }>;
  aside: Readonly<{ kicker: string; title: string; items: readonly [string, string, string]; prefilled: string }>;
  confirmation: Readonly<{ kicker: string; title: string; idLabel: string; statusAria: string; recorded: string; now: string; recordedDescription: string; standardization: string; next: string; swapDescription: string; procurementDescription: string; solution: string; afterMatch: string; solutionDescription: string; refreshNote: string }>;
}>;

const REQUEST_COPY = {
  "zh-CN": {
    categories: { gpu: "GPU 算力", token_model: "Token / 模型服务", rack_capacity: "整机柜 / 容量", cloud_vendor: "云厂商资源" },
    units: { 卡时: "卡时", 服务器时: "服务器时", "百万 Token": "百万 Token", 模型实例时: "模型实例时", 预留容量时: "预留容量时", 机柜月: "机柜月", "kW 月": "kW 月" },
    duration: { noDuration: "无需另填时长", quantityPrefix: "数量请直接按", quantitySuffix: "填写；服务端不会换算或提交小时数。", durationLabel: "持续时长（小时）", durationHelp: "仅小时类计价单位需要填写，提交值保持小时口径。" },
    validation: { positiveQuantity: "数量必须大于 0。", positiveDuration: "持续时长必须大于 0 小时。", selectRegion: "请选择期望区域。", selectDate: "请选择期望开始日期。", requirementsLength: "请用至少 8 个字描述交付要求。", consent: "请确认服务器提交说明。", positiveOfferedQuantity: "可提供数量必须大于 0。", offeredDescriptionLength: "请用至少 8 个字描述可提供资源。", positiveWantedQuantity: "期望数量必须大于 0。", wantedDescriptionLength: "请用至少 8 个字描述期望资源。", selectMatchRegion: "请选择期望撮合区域。", positiveCash: "补差金额必须大于 0。" },
    common: { resourceType: "资源类型", pricingUnit: "计价单位", quantity: "数量", select: "请选择", consentText: "我确认仅提交脱敏业务字段到 KAI Cloud 服务器，并且不含个人资料、商业机密或访问凭据。", submitting: "正在提交…", serverFallback: "需求服务暂时不可用，请稍后再试。", requestIdLabel: "请求编号" },
    flow: { aria: "发布流程，共三步", stepType: "01 选择类型", stepDescribe: "02 描述资源", stepConfirm: "03 服务端确认", title: "需求类型与信息表单", typeAria: "需求类型", procurementTab: "租赁 / 服务采购", swapTab: "双边置换" },
    procurement: { basicInfo: "需求基础信息", dealMode: "交易方式", rental: "算力租赁", service: "服务采购", demandQuantity: "需求数量", expectedRegion: "期望区域", startDate: "期望开始日期", requirements: "交付与 SLA 要求", placeholder: "例如：支持容器交付，期望 99.9% SLA，需要明确网络费用口径", submit: "提交需求" },
    swap: { offered: "我可提供", swapTo: "置换为", wanted: "我需要", matching: "撮合条件", expectedRegion: "期望区域", cashDifference: "现金补差", noCash: "不设置", weAdd: "我方可补差", theyAdd: "期望对方补差", cashLimit: "补差上限（人民币元）", submit: "提交置换需求", specs: "规格、容量与交付边界", offeredPlaceholder: "描述可提供的型号、容量、可用时段和交付形态", wantedPlaceholder: "描述期望获得的型号、容量、时段和 SLA" },
    aside: { kicker: "提交前须知", title: "需求服务已接通", items: ["业务字段会保存到 KAI Cloud 服务器，会员中心可再次读取。", "不要填写姓名、手机号、公司机密、账号或访问密钥。", "市场参考报价不是要约，具体价格与交付条件以询价确认为准。"], prefilled: "已从资源页预填" },
    confirmation: { kicker: "需求已确认", title: "需求已写入服务端", idLabel: "服务端需求编号", statusAria: "需求处理状态", recorded: "已记录", now: "刚刚", recordedDescription: "业务字段已写入服务器。", standardization: "KAI 标准化", next: "下一步", swapDescription: "整理双边资源的容量与补差口径。", procurementDescription: "整理计价、SLA 与交付口径。", solution: "方案待确认", afterMatch: "匹配后", solutionDescription: "展示标准化方案；具体交易需双方人工确认。", refreshNote: "刷新页面后确认区会消失；会员中心仍可从服务端读取这条记录。" },
  },
  "zh-TW": {
    categories: { gpu: "GPU 算力", token_model: "Token / 模型服務", rack_capacity: "整機櫃 / 容量", cloud_vendor: "雲端供應商資源" }, units: { 卡时: "卡時", 服务器时: "伺服器時", "百万 Token": "百萬 Token", 模型实例时: "模型實例時", 预留容量时: "預留容量時", 机柜月: "機櫃月", "kW 月": "kW 月" },
    duration: { noDuration: "無需另填時長", quantityPrefix: "數量請直接按", quantitySuffix: "填寫；服務端不會換算或提交小時數。", durationLabel: "持續時長（小時）", durationHelp: "僅小時計價單位需要填寫，提交值維持小時口徑。" }, validation: { positiveQuantity: "數量必須大於 0。", positiveDuration: "持續時長必須大於 0 小時。", selectRegion: "請選擇期望區域。", selectDate: "請選擇期望開始日期。", requirementsLength: "請用至少 8 個字描述交付要求。", consent: "請確認伺服器提交說明。", positiveOfferedQuantity: "可提供數量必須大於 0。", offeredDescriptionLength: "請用至少 8 個字描述可提供資源。", positiveWantedQuantity: "期望數量必須大於 0。", wantedDescriptionLength: "請用至少 8 個字描述期望資源。", selectMatchRegion: "請選擇期望撮合區域。", positiveCash: "補差金額必須大於 0。" },
    common: { resourceType: "資源類型", pricingUnit: "計價單位", quantity: "數量", select: "請選擇", consentText: "我確認僅提交脫敏業務欄位到 KAI Cloud 伺服器，且不含個人資料、商業機密或存取憑證。", submitting: "正在提交…", serverFallback: "需求服務暫時無法使用，請稍後再試。", requestIdLabel: "請求編號" }, flow: { aria: "發布流程，共三步", stepType: "01 選擇類型", stepDescribe: "02 描述資源", stepConfirm: "03 服務端確認", title: "需求類型與資訊表單", typeAria: "需求類型", procurementTab: "租賃 / 服務採購", swapTab: "雙邊置換" },
    procurement: { basicInfo: "需求基礎資訊", dealMode: "交易方式", rental: "算力租賃", service: "服務採購", demandQuantity: "需求數量", expectedRegion: "期望區域", startDate: "期望開始日期", requirements: "交付與 SLA 要求", placeholder: "例如：支援容器交付，期望 99.9% SLA，需要明確網路費用口徑", submit: "提交需求" }, swap: { offered: "我可提供", swapTo: "置換為", wanted: "我需要", matching: "撮合條件", expectedRegion: "期望區域", cashDifference: "現金補差", noCash: "不設定", weAdd: "我方可補差", theyAdd: "期望對方補差", cashLimit: "補差上限（人民幣元）", submit: "提交置換需求", specs: "規格、容量與交付邊界", offeredPlaceholder: "描述可提供的型號、容量、可用時段與交付形態", wantedPlaceholder: "描述期望取得的型號、容量、時段與 SLA" },
    aside: { kicker: "提交前須知", title: "需求服務已接通", items: ["業務欄位會儲存到 KAI Cloud 伺服器，會員中心可再次讀取。", "請勿填寫姓名、手機號碼、公司機密、帳號或存取密鑰。", "市場參考報價不是要約，具體價格與交付條件以詢價確認為準。"], prefilled: "已從資源頁預填" }, confirmation: { kicker: "需求已確認", title: "需求已寫入服務端", idLabel: "服務端需求編號", statusAria: "需求處理狀態", recorded: "已記錄", now: "剛剛", recordedDescription: "業務欄位已寫入伺服器。", standardization: "KAI 標準化", next: "下一步", swapDescription: "整理雙邊資源的容量與補差口徑。", procurementDescription: "整理計價、SLA 與交付口徑。", solution: "方案待確認", afterMatch: "匹配後", solutionDescription: "展示標準化方案；具體交易需雙方人工確認。", refreshNote: "重新整理頁面後確認區會消失；會員中心仍可從服務端讀取這筆記錄。" },
  },
  en: {
    categories: { gpu: "GPU compute", token_model: "Token / model services", rack_capacity: "Full rack / capacity", cloud_vendor: "Cloud-provider resources" }, units: { 卡时: "card-hours", 服务器时: "server-hours", "百万 Token": "million tokens", 模型实例时: "model instance-hours", 预留容量时: "reserved capacity-hours", 机柜月: "rack-months", "kW 月": "kW-months" },
    duration: { noDuration: "No separate duration required", quantityPrefix: "Enter the quantity directly in ", quantitySuffix: "; the server will not convert or submit hours.", durationLabel: "Duration (hours)", durationHelp: "Only hourly pricing units require a duration. The submitted value remains in hours." }, validation: { positiveQuantity: "Quantity must be greater than 0.", positiveDuration: "Duration must be greater than 0 hours.", selectRegion: "Select a preferred region.", selectDate: "Select a preferred start date.", requirementsLength: "Describe delivery requirements using at least 8 characters.", consent: "Confirm the server submission notice.", positiveOfferedQuantity: "Offered quantity must be greater than 0.", offeredDescriptionLength: "Describe the offered resource using at least 8 characters.", positiveWantedQuantity: "Wanted quantity must be greater than 0.", wantedDescriptionLength: "Describe the wanted resource using at least 8 characters.", selectMatchRegion: "Select a preferred matching region.", positiveCash: "Cash adjustment must be greater than 0." },
    common: { resourceType: "Resource type", pricingUnit: "Pricing unit", quantity: "Quantity", select: "Select", consentText: "I confirm that only de-identified business fields will be submitted to KAI Cloud and that they contain no personal data, trade secrets or access credentials.", submitting: "Submitting…", serverFallback: "The request service is temporarily unavailable. Please try again later.", requestIdLabel: "Request ID" }, flow: { aria: "Submission process, three steps", stepType: "01 Choose type", stepDescribe: "02 Describe resources", stepConfirm: "03 Server confirmation", title: "Request type and information form", typeAria: "Request type", procurementTab: "Rental / service procurement", swapTab: "Bilateral exchange" },
    procurement: { basicInfo: "Basic request information", dealMode: "Transaction mode", rental: "Compute rental", service: "Service procurement", demandQuantity: "Required quantity", expectedRegion: "Preferred region", startDate: "Preferred start date", requirements: "Delivery and SLA requirements", placeholder: "Example: container delivery, 99.9% SLA, and a clear network-fee basis", submit: "Submit request" }, swap: { offered: "What I can offer", swapTo: "Exchange for", wanted: "What I need", matching: "Matching conditions", expectedRegion: "Preferred region", cashDifference: "Cash adjustment", noCash: "None", weAdd: "I can add cash", theyAdd: "Counterparty adds cash", cashLimit: "Cash adjustment limit (CNY)", submit: "Submit exchange request", specs: "Specifications, capacity and delivery boundaries", offeredPlaceholder: "Describe the model, capacity, available period and delivery form you can offer", wantedPlaceholder: "Describe the desired model, capacity, period and SLA" },
    aside: { kicker: "BEFORE YOU START", title: "Request service is connected", items: ["Business fields are stored on KAI Cloud and can be read again in the member center.", "Do not enter names, phone numbers, company secrets, account credentials or access keys.", "Market reference prices are not offers; final pricing and delivery terms require quote confirmation."], prefilled: "Prefilled from resource page" }, confirmation: { kicker: "REQUEST CONFIRMED", title: "Request saved on the server", idLabel: "Server request ID", statusAria: "Request processing status", recorded: "Recorded", now: "Just now", recordedDescription: "Business fields were saved on the server.", standardization: "KAI standardization", next: "Next", swapDescription: "Standardize capacity and cash-adjustment terms for both sides.", procurementDescription: "Standardize pricing, SLA and delivery terms.", solution: "Solution awaiting confirmation", afterMatch: "After matching", solutionDescription: "A standardized solution will be shown; the actual transaction requires manual confirmation by both parties.", refreshNote: "The confirmation panel disappears after a refresh; this record remains available from the server in the member center." },
  },
  ja: {
    categories: { gpu: "GPU 算力", token_model: "Token / モデルサービス", rack_capacity: "ラック全体 / 容量", cloud_vendor: "クラウド事業者リソース" }, units: { 卡时: "カード時間", 服务器时: "サーバー時間", "百万 Token": "百万 Token", 模型实例时: "モデルインスタンス時間", 预留容量时: "予約容量時間", 机柜月: "ラック月", "kW 月": "kW 月" },
    duration: { noDuration: "期間の別入力は不要", quantityPrefix: "数量は ", quantitySuffix: " 単位で直接入力してください。サーバーは時間への換算・送信を行いません。", durationLabel: "継続時間（時間）", durationHelp: "時間単位の料金のみ入力が必要で、送信値は時間のままです。" }, validation: { positiveQuantity: "数量は 0 より大きくしてください。", positiveDuration: "継続時間は 0 時間より大きくしてください。", selectRegion: "希望地域を選択してください。", selectDate: "希望開始日を選択してください。", requirementsLength: "納品要件を 8 文字以上で記述してください。", consent: "サーバー送信の説明を確認してください。", positiveOfferedQuantity: "提供数量は 0 より大きくしてください。", offeredDescriptionLength: "提供リソースを 8 文字以上で記述してください。", positiveWantedQuantity: "希望数量は 0 より大きくしてください。", wantedDescriptionLength: "希望リソースを 8 文字以上で記述してください。", selectMatchRegion: "希望マッチング地域を選択してください。", positiveCash: "差額は 0 より大きくしてください。" },
    common: { resourceType: "リソース種別", pricingUnit: "料金単位", quantity: "数量", select: "選択してください", consentText: "匿名化された業務項目のみを KAI Cloud サーバーへ送信し、個人情報、企業秘密、アカウント、アクセス認証情報を含まないことを確認します。", submitting: "送信中…", serverFallback: "要件サービスを一時的に利用できません。しばらくしてから再度お試しください。", requestIdLabel: "リクエスト番号" }, flow: { aria: "公開手順、全3ステップ", stepType: "01 種別を選択", stepDescribe: "02 リソースを記述", stepConfirm: "03 サーバー確認", title: "要件種別と情報フォーム", typeAria: "要件種別", procurementTab: "レンタル / サービス調達", swapTab: "双方向交換" },
    procurement: { basicInfo: "要件基本情報", dealMode: "取引方法", rental: "算力レンタル", service: "サービス調達", demandQuantity: "必要数量", expectedRegion: "希望地域", startDate: "希望開始日", requirements: "納品と SLA の要件", placeholder: "例：コンテナ納品、99.9% SLA、ネットワーク費用基準の明記", submit: "要件を送信" }, swap: { offered: "提供できるもの", swapTo: "交換先", wanted: "必要なもの", matching: "マッチング条件", expectedRegion: "希望地域", cashDifference: "現金差額", noCash: "設定しない", weAdd: "自分が差額を追加", theyAdd: "相手に差額を希望", cashLimit: "差額上限（人民元）", submit: "交換要件を送信", specs: "仕様、容量、納品範囲", offeredPlaceholder: "提供可能なモデル、容量、利用期間、納品形態を記述", wantedPlaceholder: "希望するモデル、容量、期間、SLA を記述" },
    aside: { kicker: "開始前の注意", title: "要件サービスは接続済み", items: ["業務項目は KAI Cloud サーバーに保存され、会員センターで再取得できます。", "氏名、電話番号、企業秘密、アカウント、アクセスキーを入力しないでください。", "市場参考価格は申込みではなく、価格と納品条件は見積確認が優先されます。"], prefilled: "リソースページから入力済み" }, confirmation: { kicker: "要件確認済み", title: "要件をサーバーに保存しました", idLabel: "サーバー要件番号", statusAria: "要件処理状況", recorded: "記録済み", now: "たった今", recordedDescription: "業務項目をサーバーに保存しました。", standardization: "KAI 標準化", next: "次の手順", swapDescription: "双方の容量と差額条件を整理します。", procurementDescription: "料金、SLA、納品条件を整理します。", solution: "提案確認待ち", afterMatch: "マッチング後", solutionDescription: "標準化提案を表示します。具体的な取引は双方の手動確認が必要です。", refreshNote: "ページを更新すると確認欄は消えますが、会員センターからサーバー上の記録を再取得できます。" },
  },
  ko: {
    categories: { gpu: "GPU 컴퓨팅", token_model: "Token / 모델 서비스", rack_capacity: "전체 랙 / 용량", cloud_vendor: "클라우드 공급업체 리소스" }, units: { 卡时: "카드 시간", 服务器时: "서버 시간", "百万 Token": "백만 Token", 模型实例时: "모델 인스턴스 시간", 预留容量时: "예약 용량 시간", 机柜月: "랙 월", "kW 月": "kW 월" },
    duration: { noDuration: "별도 기간 입력 불필요", quantityPrefix: "수량을 ", quantitySuffix: " 단위로 직접 입력하세요. 서버는 시간으로 환산하거나 제출하지 않습니다.", durationLabel: "지속 시간(시간)", durationHelp: "시간 단위 가격에만 필요하며 제출 값은 시간 기준을 유지합니다." }, validation: { positiveQuantity: "수량은 0보다 커야 합니다.", positiveDuration: "지속 시간은 0시간보다 커야 합니다.", selectRegion: "희망 지역을 선택하세요.", selectDate: "희망 시작일을 선택하세요.", requirementsLength: "인도 요구사항을 8자 이상 입력하세요.", consent: "서버 제출 안내를 확인하세요.", positiveOfferedQuantity: "제공 수량은 0보다 커야 합니다.", offeredDescriptionLength: "제공 리소스를 8자 이상 설명하세요.", positiveWantedQuantity: "희망 수량은 0보다 커야 합니다.", wantedDescriptionLength: "희망 리소스를 8자 이상 설명하세요.", selectMatchRegion: "희망 매칭 지역을 선택하세요.", positiveCash: "차액은 0보다 커야 합니다." },
    common: { resourceType: "리소스 유형", pricingUnit: "가격 단위", quantity: "수량", select: "선택하세요", consentText: "비식별화된 업무 필드만 KAI Cloud 서버에 제출하며 개인정보, 영업비밀, 계정 또는 접근 자격 증명을 포함하지 않음을 확인합니다.", submitting: "제출 중…", serverFallback: "요구사항 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도하세요.", requestIdLabel: "요청 번호" }, flow: { aria: "제출 절차, 3단계", stepType: "01 유형 선택", stepDescribe: "02 리소스 설명", stepConfirm: "03 서버 확인", title: "요구사항 유형 및 정보 양식", typeAria: "요구사항 유형", procurementTab: "대여 / 서비스 조달", swapTab: "양자 교환" },
    procurement: { basicInfo: "기본 요구사항 정보", dealMode: "거래 방식", rental: "컴퓨팅 대여", service: "서비스 조달", demandQuantity: "필요 수량", expectedRegion: "희망 지역", startDate: "희망 시작일", requirements: "인도 및 SLA 요구사항", placeholder: "예: 컨테이너 인도, 99.9% SLA, 명확한 네트워크 비용 기준", submit: "요구사항 제출" }, swap: { offered: "제공 가능", swapTo: "교환 대상", wanted: "필요 리소스", matching: "매칭 조건", expectedRegion: "희망 지역", cashDifference: "현금 차액", noCash: "설정 안 함", weAdd: "내가 차액 추가", theyAdd: "상대방 차액 희망", cashLimit: "차액 한도(위안)", submit: "교환 요구사항 제출", specs: "사양, 용량 및 인도 범위", offeredPlaceholder: "제공 가능한 모델, 용량, 이용 시간 및 인도 형태를 설명", wantedPlaceholder: "희망 모델, 용량, 기간 및 SLA를 설명" },
    aside: { kicker: "시작 전 안내", title: "요구사항 서비스 연결됨", items: ["업무 필드는 KAI Cloud 서버에 저장되며 회원 센터에서 다시 읽을 수 있습니다.", "이름, 전화번호, 회사 기밀, 계정 또는 접근 키를 입력하지 마세요.", "시장 참고 가격은 청약이 아니며 실제 가격과 인도 조건은 견적 확인을 따릅니다."], prefilled: "리소스 페이지에서 미리 입력됨" }, confirmation: { kicker: "요구사항 확인됨", title: "요구사항이 서버에 저장됨", idLabel: "서버 요구사항 번호", statusAria: "요구사항 처리 상태", recorded: "기록됨", now: "방금", recordedDescription: "업무 필드가 서버에 저장되었습니다.", standardization: "KAI 표준화", next: "다음 단계", swapDescription: "양측 리소스의 용량과 차액 기준을 정리합니다.", procurementDescription: "가격, SLA 및 인도 기준을 정리합니다.", solution: "방안 확인 대기", afterMatch: "매칭 후", solutionDescription: "표준화된 방안을 표시하며 실제 거래는 양측의 수동 확인이 필요합니다.", refreshNote: "페이지를 새로 고치면 확인 영역은 사라지지만 회원 센터에서 서버 기록을 다시 읽을 수 있습니다." },
  },
  fr: {
    categories: { gpu: "Calcul GPU", token_model: "Services Token / modèle", rack_capacity: "Baie complète / capacité", cloud_vendor: "Ressources de fournisseur cloud" }, units: { 卡时: "heures-carte", 服务器时: "heures-serveur", "百万 Token": "millions de tokens", 模型实例时: "heures d’instance de modèle", 预留容量时: "heures de capacité réservée", 机柜月: "baies-mois", "kW 月": "kW-mois" },
    duration: { noDuration: "Aucune durée séparée requise", quantityPrefix: "Saisissez directement la quantité en ", quantitySuffix: " ; le serveur ne convertira ni n’enverra d’heures.", durationLabel: "Durée (heures)", durationHelp: "Seules les unités horaires exigent une durée. La valeur envoyée reste exprimée en heures." }, validation: { positiveQuantity: "La quantité doit être supérieure à 0.", positiveDuration: "La durée doit être supérieure à 0 heure.", selectRegion: "Sélectionnez une région souhaitée.", selectDate: "Sélectionnez une date de début souhaitée.", requirementsLength: "Décrivez les exigences de livraison avec au moins 8 caractères.", consent: "Confirmez l’avis d’envoi au serveur.", positiveOfferedQuantity: "La quantité proposée doit être supérieure à 0.", offeredDescriptionLength: "Décrivez la ressource proposée avec au moins 8 caractères.", positiveWantedQuantity: "La quantité souhaitée doit être supérieure à 0.", wantedDescriptionLength: "Décrivez la ressource souhaitée avec au moins 8 caractères.", selectMatchRegion: "Sélectionnez une région de mise en relation.", positiveCash: "L’ajustement financier doit être supérieur à 0." },
    common: { resourceType: "Type de ressource", pricingUnit: "Unité tarifaire", quantity: "Quantité", select: "Sélectionner", consentText: "Je confirme n’envoyer au serveur KAI Cloud que des champs métier désidentifiés, sans données personnelles, secrets commerciaux ni identifiants d’accès.", submitting: "Envoi…", serverFallback: "Le service de demandes est temporairement indisponible. Veuillez réessayer plus tard.", requestIdLabel: "Identifiant de requête" }, flow: { aria: "Processus de publication en trois étapes", stepType: "01 Choisir le type", stepDescribe: "02 Décrire la ressource", stepConfirm: "03 Confirmation serveur", title: "Type de besoin et formulaire d’information", typeAria: "Type de besoin", procurementTab: "Location / achat de services", swapTab: "Échange bilatéral" },
    procurement: { basicInfo: "Informations de base", dealMode: "Mode de transaction", rental: "Location de calcul", service: "Achat de services", demandQuantity: "Quantité demandée", expectedRegion: "Région souhaitée", startDate: "Date de début souhaitée", requirements: "Exigences de livraison et SLA", placeholder: "Exemple : livraison en conteneur, SLA de 99,9 %, base claire pour les frais réseau", submit: "Soumettre le besoin" }, swap: { offered: "Ce que je propose", swapTo: "Échanger contre", wanted: "Ce dont j’ai besoin", matching: "Conditions de mise en relation", expectedRegion: "Région souhaitée", cashDifference: "Ajustement financier", noCash: "Aucun", weAdd: "Je peux ajouter un montant", theyAdd: "L’autre partie ajoute un montant", cashLimit: "Plafond d’ajustement (CNY)", submit: "Soumettre l’échange", specs: "Spécifications, capacité et limites de livraison", offeredPlaceholder: "Décrivez le modèle, la capacité, la période et le mode de livraison proposés", wantedPlaceholder: "Décrivez le modèle, la capacité, la période et le SLA souhaités" },
    aside: { kicker: "AVANT DE COMMENCER", title: "Le service de demandes est connecté", items: ["Les champs métier sont conservés sur KAI Cloud et restent lisibles dans l’espace membre.", "Ne saisissez aucun nom, téléphone, secret d’entreprise, compte ou clé d’accès.", "Les prix de marché sont indicatifs ; le prix et la livraison définitifs dépendent du devis confirmé."], prefilled: "Prérempli depuis la page de ressource" }, confirmation: { kicker: "DEMANDE CONFIRMÉE", title: "Demande enregistrée sur le serveur", idLabel: "Identifiant serveur", statusAria: "État de traitement", recorded: "Enregistrée", now: "À l’instant", recordedDescription: "Les champs métier ont été enregistrés sur le serveur.", standardization: "Standardisation KAI", next: "Étape suivante", swapDescription: "Structurer la capacité et l’ajustement financier des deux parties.", procurementDescription: "Structurer la tarification, le SLA et les conditions de livraison.", solution: "Solution à confirmer", afterMatch: "Après mise en relation", solutionDescription: "Une solution standardisée sera présentée ; la transaction exige une confirmation manuelle des deux parties.", refreshNote: "Le panneau de confirmation disparaît après actualisation, mais l’enregistrement reste accessible depuis le serveur dans l’espace membre." },
  },
  th: {
    categories: { gpu: "พลังประมวลผล GPU", token_model: "บริการ Token / โมเดล", rack_capacity: "ตู้เต็ม / ความจุ", cloud_vendor: "ทรัพยากรผู้ให้บริการคลาวด์" }, units: { 卡时: "ชั่วโมงการ์ด", 服务器时: "ชั่วโมงเซิร์ฟเวอร์", "百万 Token": "ล้าน Token", 模型实例时: "ชั่วโมงอินสแตนซ์โมเดล", 预留容量时: "ชั่วโมงความจุสำรอง", 机柜月: "ตู้-เดือน", "kW 月": "kW-เดือน" },
    duration: { noDuration: "ไม่ต้องกรอกระยะเวลาแยก", quantityPrefix: "กรอกจำนวนโดยตรงเป็น ", quantitySuffix: " เซิร์ฟเวอร์จะไม่แปลงหรือส่งจำนวนชั่วโมง", durationLabel: "ระยะเวลา (ชั่วโมง)", durationHelp: "เฉพาะหน่วยราคาแบบรายชั่วโมงเท่านั้นที่ต้องกรอก และค่าที่ส่งยังคงเป็นชั่วโมง" }, validation: { positiveQuantity: "จำนวนต้องมากกว่า 0", positiveDuration: "ระยะเวลาต้องมากกว่า 0 ชั่วโมง", selectRegion: "โปรดเลือกภูมิภาคที่ต้องการ", selectDate: "โปรดเลือกวันที่เริ่มต้นที่ต้องการ", requirementsLength: "อธิบายข้อกำหนดการส่งมอบอย่างน้อย 8 ตัวอักษร", consent: "โปรดยืนยันคำอธิบายการส่งไปยังเซิร์ฟเวอร์", positiveOfferedQuantity: "จำนวนที่เสนอได้ต้องมากกว่า 0", offeredDescriptionLength: "อธิบายทรัพยากรที่เสนออย่างน้อย 8 ตัวอักษร", positiveWantedQuantity: "จำนวนที่ต้องการต้องมากกว่า 0", wantedDescriptionLength: "อธิบายทรัพยากรที่ต้องการอย่างน้อย 8 ตัวอักษร", selectMatchRegion: "โปรดเลือกภูมิภาคสำหรับจับคู่", positiveCash: "จำนวนเงินส่วนต่างต้องมากกว่า 0" },
    common: { resourceType: "ประเภททรัพยากร", pricingUnit: "หน่วยราคา", quantity: "จำนวน", select: "โปรดเลือก", consentText: "ฉันยืนยันว่าจะส่งเฉพาะข้อมูลธุรกิจที่ไม่ระบุตัวตนไปยังเซิร์ฟเวอร์ KAI Cloud และไม่มีข้อมูลส่วนบุคคล ความลับทางการค้า หรือข้อมูลรับรองการเข้าถึง", submitting: "กำลังส่ง…", serverFallback: "บริการความต้องการไม่พร้อมใช้งานชั่วคราว โปรดลองอีกครั้งภายหลัง", requestIdLabel: "หมายเลขคำขอ" }, flow: { aria: "ขั้นตอนการส่ง มีสามขั้น", stepType: "01 เลือกประเภท", stepDescribe: "02 อธิบายทรัพยากร", stepConfirm: "03 เซิร์ฟเวอร์ยืนยัน", title: "ประเภทความต้องการและแบบฟอร์มข้อมูล", typeAria: "ประเภทความต้องการ", procurementTab: "เช่า / จัดซื้อบริการ", swapTab: "แลกเปลี่ยนสองฝ่าย" },
    procurement: { basicInfo: "ข้อมูลความต้องการพื้นฐาน", dealMode: "รูปแบบธุรกรรม", rental: "เช่าพลังประมวลผล", service: "จัดซื้อบริการ", demandQuantity: "จำนวนที่ต้องการ", expectedRegion: "ภูมิภาคที่ต้องการ", startDate: "วันที่เริ่มต้นที่ต้องการ", requirements: "ข้อกำหนดการส่งมอบและ SLA", placeholder: "ตัวอย่าง: ส่งมอบด้วยคอนเทนเนอร์, SLA 99.9%, ระบุหลักเกณฑ์ค่าเครือข่าย", submit: "ส่งความต้องการ" }, swap: { offered: "สิ่งที่ฉันเสนอได้", swapTo: "แลกเป็น", wanted: "สิ่งที่ฉันต้องการ", matching: "เงื่อนไขจับคู่", expectedRegion: "ภูมิภาคที่ต้องการ", cashDifference: "เงินส่วนต่าง", noCash: "ไม่ตั้งค่า", weAdd: "ฉันเพิ่มเงินได้", theyAdd: "ต้องการให้อีกฝ่ายเพิ่มเงิน", cashLimit: "เพดานเงินส่วนต่าง (CNY)", submit: "ส่งคำขอแลกเปลี่ยน", specs: "สเปก ความจุ และขอบเขตการส่งมอบ", offeredPlaceholder: "อธิบายรุ่น ความจุ ช่วงเวลาที่ใช้ได้ และรูปแบบส่งมอบที่เสนอ", wantedPlaceholder: "อธิบายรุ่น ความจุ ช่วงเวลา และ SLA ที่ต้องการ" },
    aside: { kicker: "ก่อนเริ่ม", title: "เชื่อมต่อบริการความต้องการแล้ว", items: ["ข้อมูลธุรกิจจะถูกบันทึกบน KAI Cloud และอ่านซ้ำได้ในศูนย์สมาชิก", "ห้ามกรอกชื่อ หมายเลขโทรศัพท์ ความลับบริษัท บัญชี หรือคีย์เข้าถึง", "ราคาตลาดอ้างอิงไม่ใช่ข้อเสนอ ราคาจริงและเงื่อนไขส่งมอบต้องยืนยันด้วยใบเสนอราคา"], prefilled: "กรอกล่วงหน้าจากหน้าทรัพยากร" }, confirmation: { kicker: "ยืนยันความต้องการแล้ว", title: "บันทึกความต้องการบนเซิร์ฟเวอร์แล้ว", idLabel: "หมายเลขความต้องการบนเซิร์ฟเวอร์", statusAria: "สถานะการประมวลผล", recorded: "บันทึกแล้ว", now: "เมื่อสักครู่", recordedDescription: "บันทึกข้อมูลธุรกิจบนเซิร์ฟเวอร์แล้ว", standardization: "การทำมาตรฐาน KAI", next: "ขั้นต่อไป", swapDescription: "จัดโครงสร้างความจุและเงินส่วนต่างของทั้งสองฝ่าย", procurementDescription: "จัดโครงสร้างราคา SLA และเงื่อนไขส่งมอบ", solution: "รอยืนยันแนวทาง", afterMatch: "หลังจับคู่", solutionDescription: "จะแสดงแนวทางมาตรฐาน ธุรกรรมจริงต้องให้ทั้งสองฝ่ายยืนยันด้วยตนเอง", refreshNote: "พื้นที่ยืนยันจะหายไปหลังรีเฟรช แต่ยังอ่านรายการจากเซิร์ฟเวอร์ได้ในศูนย์สมาชิก" },
  },
  vi: {
    categories: { gpu: "Năng lực GPU", token_model: "Dịch vụ Token / mô hình", rack_capacity: "Tủ máy nguyên bộ / dung lượng", cloud_vendor: "Tài nguyên nhà cung cấp đám mây" }, units: { 卡时: "giờ-thẻ", 服务器时: "giờ máy chủ", "百万 Token": "triệu Token", 模型实例时: "giờ phiên bản mô hình", 预留容量时: "giờ dung lượng đặt trước", 机柜月: "tủ-tháng", "kW 月": "kW-tháng" },
    duration: { noDuration: "Không cần nhập thời lượng riêng", quantityPrefix: "Nhập trực tiếp số lượng theo ", quantitySuffix: "; máy chủ sẽ không quy đổi hoặc gửi số giờ.", durationLabel: "Thời lượng (giờ)", durationHelp: "Chỉ đơn vị tính giá theo giờ mới cần thời lượng; giá trị gửi vẫn tính bằng giờ." }, validation: { positiveQuantity: "Số lượng phải lớn hơn 0.", positiveDuration: "Thời lượng phải lớn hơn 0 giờ.", selectRegion: "Chọn khu vực mong muốn.", selectDate: "Chọn ngày bắt đầu mong muốn.", requirementsLength: "Mô tả yêu cầu bàn giao bằng ít nhất 8 ký tự.", consent: "Xác nhận thông báo gửi lên máy chủ.", positiveOfferedQuantity: "Số lượng cung cấp phải lớn hơn 0.", offeredDescriptionLength: "Mô tả tài nguyên cung cấp bằng ít nhất 8 ký tự.", positiveWantedQuantity: "Số lượng mong muốn phải lớn hơn 0.", wantedDescriptionLength: "Mô tả tài nguyên mong muốn bằng ít nhất 8 ký tự.", selectMatchRegion: "Chọn khu vực ghép nối mong muốn.", positiveCash: "Khoản bù tiền phải lớn hơn 0." },
    common: { resourceType: "Loại tài nguyên", pricingUnit: "Đơn vị tính giá", quantity: "Số lượng", select: "Vui lòng chọn", consentText: "Tôi xác nhận chỉ gửi các trường nghiệp vụ đã loại bỏ thông tin nhận dạng lên máy chủ KAI Cloud và không chứa dữ liệu cá nhân, bí mật thương mại hoặc thông tin truy cập.", submitting: "Đang gửi…", serverFallback: "Dịch vụ nhu cầu tạm thời không khả dụng. Vui lòng thử lại sau.", requestIdLabel: "Mã yêu cầu" }, flow: { aria: "Quy trình gửi gồm ba bước", stepType: "01 Chọn loại", stepDescribe: "02 Mô tả tài nguyên", stepConfirm: "03 Máy chủ xác nhận", title: "Loại nhu cầu và biểu mẫu thông tin", typeAria: "Loại nhu cầu", procurementTab: "Thuê / mua dịch vụ", swapTab: "Hoán đổi song phương" },
    procurement: { basicInfo: "Thông tin nhu cầu cơ bản", dealMode: "Phương thức giao dịch", rental: "Thuê năng lực tính toán", service: "Mua dịch vụ", demandQuantity: "Số lượng cần", expectedRegion: "Khu vực mong muốn", startDate: "Ngày bắt đầu mong muốn", requirements: "Yêu cầu bàn giao và SLA", placeholder: "Ví dụ: bàn giao bằng container, SLA 99,9%, nêu rõ cách tính phí mạng", submit: "Gửi nhu cầu" }, swap: { offered: "Tôi có thể cung cấp", swapTo: "Hoán đổi thành", wanted: "Tôi cần", matching: "Điều kiện ghép nối", expectedRegion: "Khu vực mong muốn", cashDifference: "Khoản bù tiền", noCash: "Không đặt", weAdd: "Tôi có thể bù thêm", theyAdd: "Mong đối tác bù thêm", cashLimit: "Giới hạn bù tiền (CNY)", submit: "Gửi nhu cầu hoán đổi", specs: "Thông số, dung lượng và phạm vi bàn giao", offeredPlaceholder: "Mô tả mẫu, dung lượng, thời gian khả dụng và hình thức bàn giao có thể cung cấp", wantedPlaceholder: "Mô tả mẫu, dung lượng, thời gian và SLA mong muốn" },
    aside: { kicker: "TRƯỚC KHI BẮT ĐẦU", title: "Dịch vụ nhu cầu đã kết nối", items: ["Các trường nghiệp vụ được lưu trên KAI Cloud và có thể đọc lại trong trung tâm thành viên.", "Không nhập tên, số điện thoại, bí mật công ty, tài khoản hoặc khóa truy cập.", "Giá tham khảo thị trường không phải chào hàng; giá và điều kiện bàn giao cuối cùng phải được xác nhận bằng báo giá."], prefilled: "Điền sẵn từ trang tài nguyên" }, confirmation: { kicker: "ĐÃ XÁC NHẬN NHU CẦU", title: "Nhu cầu đã được lưu trên máy chủ", idLabel: "Mã nhu cầu máy chủ", statusAria: "Trạng thái xử lý nhu cầu", recorded: "Đã ghi nhận", now: "Vừa xong", recordedDescription: "Các trường nghiệp vụ đã được lưu trên máy chủ.", standardization: "Chuẩn hóa KAI", next: "Bước tiếp theo", swapDescription: "Chuẩn hóa dung lượng và khoản bù của hai bên.", procurementDescription: "Chuẩn hóa giá, SLA và điều kiện bàn giao.", solution: "Giải pháp chờ xác nhận", afterMatch: "Sau khi ghép nối", solutionDescription: "Giải pháp chuẩn hóa sẽ được hiển thị; giao dịch thực tế cần hai bên xác nhận thủ công.", refreshNote: "Vùng xác nhận sẽ biến mất sau khi tải lại; bản ghi vẫn có thể đọc từ máy chủ trong trung tâm thành viên." },
  },
  id: {
    categories: { gpu: "Komputasi GPU", token_model: "Layanan Token / model", rack_capacity: "Rak penuh / kapasitas", cloud_vendor: "Sumber daya penyedia cloud" }, units: { 卡时: "jam-kartu", 服务器时: "jam-server", "百万 Token": "juta Token", 模型实例时: "jam instans model", 预留容量时: "jam kapasitas cadangan", 机柜月: "rak-bulan", "kW 月": "kW-bulan" },
    duration: { noDuration: "Tidak perlu durasi terpisah", quantityPrefix: "Masukkan jumlah langsung dalam ", quantitySuffix: "; server tidak akan mengonversi atau mengirim jam.", durationLabel: "Durasi (jam)", durationHelp: "Hanya unit harga per jam yang memerlukan durasi; nilai yang dikirim tetap dalam jam." }, validation: { positiveQuantity: "Jumlah harus lebih besar dari 0.", positiveDuration: "Durasi harus lebih besar dari 0 jam.", selectRegion: "Pilih wilayah yang diinginkan.", selectDate: "Pilih tanggal mulai yang diinginkan.", requirementsLength: "Jelaskan persyaratan penyerahan dengan minimal 8 karakter.", consent: "Konfirmasi pemberitahuan pengiriman server.", positiveOfferedQuantity: "Jumlah yang ditawarkan harus lebih besar dari 0.", offeredDescriptionLength: "Jelaskan sumber daya yang ditawarkan dengan minimal 8 karakter.", positiveWantedQuantity: "Jumlah yang diinginkan harus lebih besar dari 0.", wantedDescriptionLength: "Jelaskan sumber daya yang diinginkan dengan minimal 8 karakter.", selectMatchRegion: "Pilih wilayah pencocokan yang diinginkan.", positiveCash: "Penyesuaian tunai harus lebih besar dari 0." },
    common: { resourceType: "Jenis sumber daya", pricingUnit: "Unit harga", quantity: "Jumlah", select: "Pilih", consentText: "Saya mengonfirmasi bahwa hanya bidang bisnis yang telah dihilangkan identitasnya yang dikirim ke server KAI Cloud dan tidak berisi data pribadi, rahasia dagang, atau kredensial akses.", submitting: "Mengirim…", serverFallback: "Layanan kebutuhan sementara tidak tersedia. Coba lagi nanti.", requestIdLabel: "ID permintaan" }, flow: { aria: "Proses pengajuan, tiga langkah", stepType: "01 Pilih jenis", stepDescribe: "02 Jelaskan sumber daya", stepConfirm: "03 Konfirmasi server", title: "Jenis kebutuhan dan formulir informasi", typeAria: "Jenis kebutuhan", procurementTab: "Sewa / pengadaan layanan", swapTab: "Pertukaran bilateral" },
    procurement: { basicInfo: "Informasi dasar kebutuhan", dealMode: "Mode transaksi", rental: "Sewa komputasi", service: "Pengadaan layanan", demandQuantity: "Jumlah kebutuhan", expectedRegion: "Wilayah yang diinginkan", startDate: "Tanggal mulai", requirements: "Persyaratan penyerahan dan SLA", placeholder: "Contoh: penyerahan container, SLA 99,9%, dan dasar biaya jaringan yang jelas", submit: "Ajukan kebutuhan" }, swap: { offered: "Yang dapat saya tawarkan", swapTo: "Tukar dengan", wanted: "Yang saya butuhkan", matching: "Kondisi pencocokan", expectedRegion: "Wilayah yang diinginkan", cashDifference: "Penyesuaian tunai", noCash: "Tidak diatur", weAdd: "Saya dapat menambah tunai", theyAdd: "Pihak lain menambah tunai", cashLimit: "Batas penyesuaian (CNY)", submit: "Ajukan pertukaran", specs: "Spesifikasi, kapasitas, dan batas penyerahan", offeredPlaceholder: "Jelaskan model, kapasitas, waktu tersedia, dan bentuk penyerahan yang ditawarkan", wantedPlaceholder: "Jelaskan model, kapasitas, periode, dan SLA yang diinginkan" },
    aside: { kicker: "SEBELUM MEMULAI", title: "Layanan kebutuhan terhubung", items: ["Bidang bisnis disimpan di KAI Cloud dan dapat dibaca kembali di pusat anggota.", "Jangan masukkan nama, nomor telepon, rahasia perusahaan, akun, atau kunci akses.", "Harga referensi pasar bukan penawaran; harga dan penyerahan final harus dikonfirmasi melalui penawaran."], prefilled: "Diisi dari halaman sumber daya" }, confirmation: { kicker: "KEBUTUHAN DIKONFIRMASI", title: "Kebutuhan disimpan di server", idLabel: "ID kebutuhan server", statusAria: "Status pemrosesan kebutuhan", recorded: "Tercatat", now: "Baru saja", recordedDescription: "Bidang bisnis disimpan di server.", standardization: "Standardisasi KAI", next: "Berikutnya", swapDescription: "Menstandarkan kapasitas dan penyesuaian tunai kedua pihak.", procurementDescription: "Menstandarkan harga, SLA, dan ketentuan penyerahan.", solution: "Solusi menunggu konfirmasi", afterMatch: "Setelah pencocokan", solutionDescription: "Solusi standar akan ditampilkan; transaksi aktual memerlukan konfirmasi manual kedua pihak.", refreshNote: "Panel konfirmasi hilang setelah dimuat ulang; catatan tetap dapat dibaca dari server di pusat anggota." },
  },
  ms: {
    categories: { gpu: "Pengkomputeran GPU", token_model: "Perkhidmatan Token / model", rack_capacity: "Rak penuh / kapasiti", cloud_vendor: "Sumber pembekal awan" }, units: { 卡时: "jam-kad", 服务器时: "jam-pelayan", "百万 Token": "juta Token", 模型实例时: "jam tika model", 预留容量时: "jam kapasiti simpanan", 机柜月: "rak-bulan", "kW 月": "kW-bulan" },
    duration: { noDuration: "Tidak perlu tempoh berasingan", quantityPrefix: "Masukkan kuantiti terus dalam ", quantitySuffix: "; pelayan tidak akan menukar atau menghantar jam.", durationLabel: "Tempoh (jam)", durationHelp: "Hanya unit harga mengikut jam memerlukan tempoh; nilai dihantar kekal dalam jam." }, validation: { positiveQuantity: "Kuantiti mesti melebihi 0.", positiveDuration: "Tempoh mesti melebihi 0 jam.", selectRegion: "Pilih wilayah yang dikehendaki.", selectDate: "Pilih tarikh mula yang dikehendaki.", requirementsLength: "Huraikan keperluan penyerahan dengan sekurang-kurangnya 8 aksara.", consent: "Sahkan notis penghantaran pelayan.", positiveOfferedQuantity: "Kuantiti ditawarkan mesti melebihi 0.", offeredDescriptionLength: "Huraikan sumber ditawarkan dengan sekurang-kurangnya 8 aksara.", positiveWantedQuantity: "Kuantiti dikehendaki mesti melebihi 0.", wantedDescriptionLength: "Huraikan sumber dikehendaki dengan sekurang-kurangnya 8 aksara.", selectMatchRegion: "Pilih wilayah pemadanan yang dikehendaki.", positiveCash: "Pelarasan tunai mesti melebihi 0." },
    common: { resourceType: "Jenis sumber", pricingUnit: "Unit harga", quantity: "Kuantiti", select: "Pilih", consentText: "Saya mengesahkan bahawa hanya medan perniagaan yang dinyahkenal pasti dihantar ke pelayan KAI Cloud dan tidak mengandungi data peribadi, rahsia dagangan atau kelayakan akses.", submitting: "Menghantar…", serverFallback: "Perkhidmatan keperluan tidak tersedia buat sementara. Cuba lagi kemudian.", requestIdLabel: "ID permintaan" }, flow: { aria: "Proses penghantaran, tiga langkah", stepType: "01 Pilih jenis", stepDescribe: "02 Huraikan sumber", stepConfirm: "03 Pengesahan pelayan", title: "Jenis keperluan dan borang maklumat", typeAria: "Jenis keperluan", procurementTab: "Sewa / perolehan perkhidmatan", swapTab: "Pertukaran dua hala" },
    procurement: { basicInfo: "Maklumat asas keperluan", dealMode: "Kaedah transaksi", rental: "Sewa pengkomputeran", service: "Perolehan perkhidmatan", demandQuantity: "Kuantiti diperlukan", expectedRegion: "Wilayah dikehendaki", startDate: "Tarikh mula", requirements: "Keperluan penyerahan dan SLA", placeholder: "Contoh: penyerahan kontena, SLA 99.9%, dan asas caj rangkaian yang jelas", submit: "Hantar keperluan" }, swap: { offered: "Yang boleh saya tawarkan", swapTo: "Tukar dengan", wanted: "Yang saya perlukan", matching: "Syarat pemadanan", expectedRegion: "Wilayah dikehendaki", cashDifference: "Pelarasan tunai", noCash: "Tidak ditetapkan", weAdd: "Saya boleh menambah tunai", theyAdd: "Pihak lain menambah tunai", cashLimit: "Had pelarasan (CNY)", submit: "Hantar pertukaran", specs: "Spesifikasi, kapasiti dan sempadan penyerahan", offeredPlaceholder: "Huraikan model, kapasiti, masa tersedia dan bentuk penyerahan yang ditawarkan", wantedPlaceholder: "Huraikan model, kapasiti, tempoh dan SLA yang dikehendaki" },
    aside: { kicker: "SEBELUM BERMULA", title: "Perkhidmatan keperluan disambungkan", items: ["Medan perniagaan disimpan pada KAI Cloud dan boleh dibaca semula di pusat ahli.", "Jangan masukkan nama, nombor telefon, rahsia syarikat, akaun atau kunci akses.", "Harga rujukan pasaran bukan tawaran; harga dan penyerahan akhir mesti disahkan melalui sebut harga."], prefilled: "Diisi daripada halaman sumber" }, confirmation: { kicker: "KEPERLUAN DISAHKAN", title: "Keperluan disimpan pada pelayan", idLabel: "ID keperluan pelayan", statusAria: "Status pemprosesan", recorded: "Direkodkan", now: "Baru sahaja", recordedDescription: "Medan perniagaan disimpan pada pelayan.", standardization: "Piawaian KAI", next: "Seterusnya", swapDescription: "Piawaikan kapasiti dan pelarasan tunai kedua-dua pihak.", procurementDescription: "Piawaikan harga, SLA dan syarat penyerahan.", solution: "Penyelesaian menunggu pengesahan", afterMatch: "Selepas pemadanan", solutionDescription: "Penyelesaian piawai akan dipaparkan; transaksi sebenar memerlukan pengesahan manual kedua-dua pihak.", refreshNote: "Panel pengesahan hilang selepas muat semula; rekod masih boleh dibaca daripada pelayan di pusat ahli." },
  },
} as const satisfies Record<Locale, RequestCopy>;

const categoryValues: ResourceCategory[] = ["gpu", "token_model", "rack_capacity", "cloud_vendor"];

const categoryUnits: Record<ResourceCategory, PricingUnit[]> = {
  gpu: ["卡时", "服务器时", "预留容量时"],
  token_model: ["百万 Token", "模型实例时", "预留容量时"],
  rack_capacity: ["机柜月", "kW 月", "预留容量时"],
  cloud_vendor: ["卡时", "服务器时", "预留容量时"],
};

const inputClass =
  "min-h-11 w-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-[var(--ink)] placeholder:text-[var(--muted)]";
const fieldLabelClass = "grid gap-1.5 text-sm font-semibold text-[var(--ink)]";

function firstUnit(category: ResourceCategory) {
  return categoryUnits[category][0];
}

function isCompatibleUnit(category: ResourceCategory, unit?: PricingUnit): unit is PricingUnit {
  return Boolean(unit && categoryUnits[category].includes(unit));
}

function validPositive(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function durationConfig(unit: PricingUnit, copy: RequestCopy) {
  if (unit === "百万 Token") {
    return {
      required: false,
      label: copy.duration.noDuration,
      defaultValue: "",
      help: `${copy.duration.quantityPrefix}${copy.units[unit]}${copy.duration.quantitySuffix}`,
    };
  }
  if (unit === "机柜月" || unit === "kW 月") {
    return {
      required: false,
      label: copy.duration.noDuration,
      defaultValue: "",
      help: `${copy.duration.quantityPrefix}${copy.units[unit]}${copy.duration.quantitySuffix}`,
    };
  }
  return {
    required: true,
    label: copy.duration.durationLabel,
    defaultValue: "24",
    help: copy.duration.durationHelp,
  };
}

function ErrorText({ children, id }: { children?: string; id?: string }) {
  if (!children) return null;
  return (
    <span className="text-xs font-normal text-[var(--error)]" id={id} role="alert">
      {children}
    </span>
  );
}

function focusFirstInvalid(form: HTMLFormElement | null) {
  window.requestAnimationFrame(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

function UnitOptions({ category, copy }: { category: ResourceCategory; copy: RequestCopy }) {
  return categoryUnits[category].map((unit) => (
    <option key={unit} value={unit}>
      {copy.units[unit]}
    </option>
  ));
}

function CategoryOptions({ copy }: { copy: RequestCopy }) {
  return categoryValues.map((category) => (
    <option key={category} value={category}>
      {copy.categories[category]}
    </option>
  ));
}

function safeServerError(error: unknown, copy: RequestCopy) {
  const requestId = error instanceof MarketplaceApiError ? error.requestId : undefined;
  return requestId ? `${copy.common.serverFallback} (${copy.common.requestIdLabel}: ${requestId})` : copy.common.serverFallback;
}

export function RequestWorkbench({ initialMode = "rental", initialPrefill }: RequestWorkbenchProps) {
  const { locale } = useLocale();
  const copy = REQUEST_COPY[locale];
  const initialCategory = initialPrefill?.category ?? "gpu";
  const initialRegion = marketplaceRegions.includes(initialPrefill?.region as MarketplaceRegion)
    ? initialPrefill?.region as MarketplaceRegion
    : "";
  const initialUnit = isCompatibleUnit(initialCategory, initialPrefill?.pricingUnit)
    ? initialPrefill.pricingUnit
    : firstUnit(initialCategory);
  const [activeTab, setActiveTab] = useState<"procurement" | "swap">(
    initialMode === "swap" ? "swap" : "procurement",
  );
  const [procurement, setProcurement] = useState<ProcurementValues>({
    dealMode: initialMode === "service" ? "service" : "rental",
    category: initialCategory,
    pricingUnit: initialUnit,
    quantity: "1",
    duration: durationConfig(initialUnit, copy).defaultValue,
    region: initialRegion,
    deliveryDate: "",
    requirements: initialPrefill?.title ? `希望获取「${initialPrefill.title}」的标准化报价方案。` : "",
    consent: false,
  });
  const [swap, setSwap] = useState<SwapValues>({
    offeredCategory: initialCategory,
    offeredUnit: initialUnit,
    offeredQuantity: "1",
    offeredDescription: initialPrefill?.title ? `可提供与「${initialPrefill.title}」同类的资源，具体容量待确认。` : "",
    wantedCategory: "token_model",
    wantedUnit: "百万 Token",
    wantedQuantity: "1",
    wantedDescription: "",
    region: initialRegion,
    cashDirection: "none",
    cashAmount: "",
    consent: false,
  });
  const [procurementErrors, setProcurementErrors] = useState<Partial<Record<keyof ProcurementValues, string>>>({});
  const [swapErrors, setSwapErrors] = useState<Partial<Record<keyof SwapValues, string>>>({});
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);
  const procurementTabRef = useRef<HTMLButtonElement>(null);
  const swapTabRef = useRef<HTMLButtonElement>(null);
  const procurementFormRef = useRef<HTMLFormElement>(null);
  const swapFormRef = useRef<HTMLFormElement>(null);
  const procurementKeyRef = useRef<string | null>(null);
  const swapKeyRef = useRef<string | null>(null);
  const submissionLockRef = useRef(false);

  useEffect(() => {
    if (confirmation) confirmationRef.current?.focus();
  }, [confirmation]);

  function updateProcurement<Key extends keyof ProcurementValues>(key: Key, value: ProcurementValues[Key]) {
    setProcurement((current) => ({ ...current, [key]: value }));
    setProcurementErrors((current) => ({ ...current, [key]: undefined }));
    procurementKeyRef.current = null;
    setServerError(null);
    setConfirmation(null);
  }

  function updateProcurementCategory(category: ResourceCategory) {
    const pricingUnit = firstUnit(category);
    setProcurement((current) => ({
      ...current,
      category,
      pricingUnit,
      duration: durationConfig(pricingUnit, copy).defaultValue,
    }));
    setProcurementErrors((current) => ({ ...current, category: undefined, pricingUnit: undefined }));
    procurementKeyRef.current = null;
    setServerError(null);
    setConfirmation(null);
  }

  function updateProcurementUnit(pricingUnit: PricingUnit) {
    setProcurement((current) => ({
      ...current,
      pricingUnit,
      duration: durationConfig(pricingUnit, copy).defaultValue,
    }));
    setProcurementErrors((current) => ({ ...current, pricingUnit: undefined, duration: undefined }));
    procurementKeyRef.current = null;
    setServerError(null);
    setConfirmation(null);
  }

  function updateSwap<Key extends keyof SwapValues>(key: Key, value: SwapValues[Key]) {
    setSwap((current) => ({ ...current, [key]: value }));
    setSwapErrors((current) => ({ ...current, [key]: undefined }));
    swapKeyRef.current = null;
    setServerError(null);
    setConfirmation(null);
  }

  function updateSwapCategory(side: "offered" | "wanted", category: ResourceCategory) {
    setSwap((current) =>
      side === "offered"
        ? { ...current, offeredCategory: category, offeredUnit: firstUnit(category) }
        : { ...current, wantedCategory: category, wantedUnit: firstUnit(category) },
    );
    setSwapErrors((current) =>
      side === "offered"
        ? { ...current, offeredCategory: undefined, offeredUnit: undefined }
        : { ...current, wantedCategory: undefined, wantedUnit: undefined },
    );
    swapKeyRef.current = null;
    setServerError(null);
    setConfirmation(null);
  }

  async function submitProcurement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionLockRef.current) return;
    const nextErrors: Partial<Record<keyof ProcurementValues, string>> = {};
    const duration = durationConfig(procurement.pricingUnit, copy);

    if (!validPositive(procurement.quantity)) nextErrors.quantity = copy.validation.positiveQuantity;
    if (duration.required && !validPositive(procurement.duration)) nextErrors.duration = copy.validation.positiveDuration;
    if (!procurement.region) nextErrors.region = copy.validation.selectRegion;
    if (!procurement.deliveryDate) nextErrors.deliveryDate = copy.validation.selectDate;
    if (procurement.requirements.trim().length < 8) nextErrors.requirements = copy.validation.requirementsLength;
    if (!procurement.consent) nextErrors.consent = copy.validation.consent;

    setProcurementErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalid(procurementFormRef.current);
      return;
    }

    submissionLockRef.current = true;
    setSubmitting(true);
    setServerError(null);
    try {
      const idempotencyKey = procurementKeyRef.current ?? createIdempotencyKey("request-procurement");
      procurementKeyRef.current = idempotencyKey;
      const { record } = await marketplacePost<MarketplaceRequestRecord>(
        "/api/requests",
        {
          requestType: "procurement",
          dealMode: procurement.dealMode,
          category: procurement.category,
          pricingUnit: procurement.pricingUnit,
          quantity: Number(procurement.quantity),
          durationHours: duration.required ? Number(procurement.duration) : null,
          region: procurement.region,
          deliveryDate: procurement.deliveryDate,
          requirements: procurement.requirements.trim(),
        },
        idempotencyKey,
      );
      procurementKeyRef.current = null;
      setConfirmation({ id: record.id, mode: "procurement", title: record.title });
      window.dispatchEvent(new CustomEvent("kai-server-records-changed"));
    } catch (error) {
      const message = safeServerError(error, copy);
      const fieldMap: Record<string, keyof ProcurementValues> = {
        dealMode: "dealMode",
        category: "category",
        pricingUnit: "pricingUnit",
        quantity: "quantity",
        durationHours: "duration",
        region: "region",
        deliveryDate: "deliveryDate",
        requirements: "requirements",
      };
      const field = error instanceof MarketplaceApiError && error.field ? fieldMap[error.field] : undefined;
      if (field) {
        setProcurementErrors((current) => ({ ...current, [field]: message }));
        focusFirstInvalid(procurementFormRef.current);
      } else {
        setServerError(message);
      }
    } finally {
      submissionLockRef.current = false;
      setSubmitting(false);
    }
  }

  async function submitSwap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionLockRef.current) return;
    const nextErrors: Partial<Record<keyof SwapValues, string>> = {};

    if (!validPositive(swap.offeredQuantity)) nextErrors.offeredQuantity = copy.validation.positiveOfferedQuantity;
    if (swap.offeredDescription.trim().length < 8) nextErrors.offeredDescription = copy.validation.offeredDescriptionLength;
    if (!validPositive(swap.wantedQuantity)) nextErrors.wantedQuantity = copy.validation.positiveWantedQuantity;
    if (swap.wantedDescription.trim().length < 8) nextErrors.wantedDescription = copy.validation.wantedDescriptionLength;
    if (!swap.region) nextErrors.region = copy.validation.selectMatchRegion;
    if (swap.cashDirection !== "none" && !validPositive(swap.cashAmount)) nextErrors.cashAmount = copy.validation.positiveCash;
    if (!swap.consent) nextErrors.consent = copy.validation.consent;

    setSwapErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalid(swapFormRef.current);
      return;
    }

    submissionLockRef.current = true;
    setSubmitting(true);
    setServerError(null);
    try {
      const idempotencyKey = swapKeyRef.current ?? createIdempotencyKey("request-swap");
      swapKeyRef.current = idempotencyKey;
      const { record } = await marketplacePost<MarketplaceRequestRecord>(
        "/api/requests",
        {
          requestType: "swap",
          offered: {
            category: swap.offeredCategory,
            pricingUnit: swap.offeredUnit,
            quantity: Number(swap.offeredQuantity),
            description: swap.offeredDescription.trim(),
          },
          wanted: {
            category: swap.wantedCategory,
            pricingUnit: swap.wantedUnit,
            quantity: Number(swap.wantedQuantity),
            description: swap.wantedDescription.trim(),
          },
          region: swap.region,
          cashDirection: swap.cashDirection,
          cashAmount: swap.cashDirection === "none" ? null : Number(swap.cashAmount),
        },
        idempotencyKey,
      );
      swapKeyRef.current = null;
      setConfirmation({ id: record.id, mode: "swap", title: record.title });
      window.dispatchEvent(new CustomEvent("kai-server-records-changed"));
    } catch (error) {
      const message = safeServerError(error, copy);
      const fieldMap: Record<string, keyof SwapValues> = {
        "offered.category": "offeredCategory",
        "offered.pricingUnit": "offeredUnit",
        "offered.quantity": "offeredQuantity",
        "offered.description": "offeredDescription",
        "wanted.category": "wantedCategory",
        "wanted.pricingUnit": "wantedUnit",
        "wanted.quantity": "wantedQuantity",
        "wanted.description": "wantedDescription",
        region: "region",
        cashDirection: "cashDirection",
        cashAmount: "cashAmount",
      };
      const field = error instanceof MarketplaceApiError && error.field ? fieldMap[error.field] : undefined;
      if (field) {
        setSwapErrors((current) => ({ ...current, [field]: message }));
        focusFirstInvalid(swapFormRef.current);
      } else {
        setServerError(message);
      }
    } finally {
      submissionLockRef.current = false;
      setSubmitting(false);
    }
  }

  function chooseTab(tab: "procurement" | "swap") {
    setActiveTab(tab);
    setServerError(null);
    setConfirmation(null);
  }

  function moveTab(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextTab = event.key === "ArrowLeft" || event.key === "Home" ? "procurement" : "swap";
    chooseTab(nextTab);
    (nextTab === "procurement" ? procurementTabRef : swapTabRef).current?.focus();
  }

  return (
    <section aria-labelledby="request-workbench-title" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <div className="mb-6 flex items-center gap-3 text-xs font-semibold text-[var(--muted)]" aria-label={copy.flow.aria}>
          <span className="text-[var(--accent)]">{copy.flow.stepType}</span>
          <span aria-hidden="true">/</span>
          <span>{copy.flow.stepDescribe}</span>
          <span aria-hidden="true">/</span>
          <span>{copy.flow.stepConfirm}</span>
        </div>
        <h2 className="sr-only" id="request-workbench-title">
          {copy.flow.title}
        </h2>
        <div aria-label={copy.flow.typeAria} className="grid grid-cols-2 border-b border-[var(--border-strong)]" role="tablist">
          <button
            aria-controls="procurement-panel"
            aria-selected={activeTab === "procurement"}
            className={`min-h-14 border-b-2 px-4 text-left font-semibold ${
              activeTab === "procurement"
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]"
                : "border-transparent bg-[var(--surface)] text-[var(--muted)]"
            }`}
            id="procurement-tab"
            onKeyDown={moveTab}
            onClick={() => chooseTab("procurement")}
            ref={procurementTabRef}
            role="tab"
            tabIndex={activeTab === "procurement" ? 0 : -1}
            type="button"
          >
            {copy.flow.procurementTab}
          </button>
          <button
            aria-controls="swap-panel"
            aria-selected={activeTab === "swap"}
            className={`min-h-14 border-b-2 px-4 text-left font-semibold ${
              activeTab === "swap"
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]"
                : "border-transparent bg-[var(--surface)] text-[var(--muted)]"
            }`}
            id="swap-tab"
            onKeyDown={moveTab}
            onClick={() => chooseTab("swap")}
            ref={swapTabRef}
            role="tab"
            tabIndex={activeTab === "swap" ? 0 : -1}
            type="button"
          >
            {copy.flow.swapTab}
          </button>
        </div>

        {activeTab === "procurement" ? (
          <div aria-labelledby="procurement-tab" className="border-x border-b border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7" id="procurement-panel" role="tabpanel">
            <form noValidate onSubmit={submitProcurement} ref={procurementFormRef}>
              <fieldset className="m-0 border-0 p-0">
                <legend className="mb-5 text-xl font-semibold text-[var(--ink)]">{copy.procurement.basicInfo}</legend>
                <div className="grid gap-5 sm:grid-cols-2">
                  <label className={fieldLabelClass}>
                    {copy.procurement.dealMode}
                    <select
                      aria-describedby={procurementErrors.dealMode ? "procurement-deal-mode-error" : undefined}
                      aria-invalid={Boolean(procurementErrors.dealMode)}
                      className={inputClass}
                      id="procurement-deal-mode"
                      onChange={(event) => updateProcurement("dealMode", event.target.value as "rental" | "service")}
                      value={procurement.dealMode}
                    >
                      <option value="rental">{copy.procurement.rental}</option>
                      <option value="service">{copy.procurement.service}</option>
                    </select>
                    <ErrorText id="procurement-deal-mode-error">{procurementErrors.dealMode}</ErrorText>
                  </label>
                  <label className={fieldLabelClass}>
                    {copy.common.resourceType}
                    <select
                      aria-describedby={procurementErrors.category ? "procurement-category-error" : undefined}
                      aria-invalid={Boolean(procurementErrors.category)}
                      className={inputClass}
                      id="procurement-category"
                      onChange={(event) => updateProcurementCategory(event.target.value as ResourceCategory)}
                      value={procurement.category}
                    >
                      <CategoryOptions copy={copy} />
                    </select>
                    <ErrorText id="procurement-category-error">{procurementErrors.category}</ErrorText>
                  </label>
                  <label className={fieldLabelClass}>
                    {copy.common.pricingUnit}
                    <select
                      aria-describedby={procurementErrors.pricingUnit ? "procurement-unit-error" : undefined}
                      aria-invalid={Boolean(procurementErrors.pricingUnit)}
                      className={inputClass}
                      id="procurement-unit"
                      onChange={(event) => updateProcurementUnit(event.target.value as PricingUnit)}
                      value={procurement.pricingUnit}
                    >
                      <UnitOptions category={procurement.category} copy={copy} />
                    </select>
                    <ErrorText id="procurement-unit-error">{procurementErrors.pricingUnit}</ErrorText>
                  </label>
                  <label className={fieldLabelClass}>
                    {copy.procurement.demandQuantity} ({copy.units[procurement.pricingUnit]})
                    <input
                      aria-describedby={procurementErrors.quantity ? "procurement-quantity-error" : undefined}
                      aria-invalid={Boolean(procurementErrors.quantity)}
                      className={inputClass}
                      id="procurement-quantity"
                      inputMode="decimal"
                      min="0.01"
                      onChange={(event) => updateProcurement("quantity", event.target.value)}
                      step="0.01"
                      type="number"
                      value={procurement.quantity}
                    />
                    <ErrorText id="procurement-quantity-error">{procurementErrors.quantity}</ErrorText>
                  </label>
                  {durationConfig(procurement.pricingUnit, copy).required ? (
                    <label className={fieldLabelClass}>
                      {durationConfig(procurement.pricingUnit, copy).label}
                      <input
                        aria-describedby={`procurement-duration-help${procurementErrors.duration ? " procurement-duration-error" : ""}`}
                        aria-invalid={Boolean(procurementErrors.duration)}
                        className={inputClass}
                        id="procurement-duration"
                        inputMode="numeric"
                        min="1"
                        onChange={(event) => updateProcurement("duration", event.target.value)}
                        step="1"
                        type="number"
                        value={procurement.duration}
                      />
                      <span className="text-xs font-normal text-[var(--muted)]" id="procurement-duration-help">{durationConfig(procurement.pricingUnit, copy).help}</span>
                      <ErrorText id="procurement-duration-error">{procurementErrors.duration}</ErrorText>
                    </label>
                  ) : (
                    <div className="border border-[var(--border)] bg-[var(--info-bg)] p-3 text-sm" role="note">
                      <strong className="block text-[var(--ink)]">{durationConfig(procurement.pricingUnit, copy).label}</strong>
                      <span className="mt-1 block text-xs text-[var(--text)]">{durationConfig(procurement.pricingUnit, copy).help}</span>
                    </div>
                  )}
                  <label className={fieldLabelClass}>
                    {copy.procurement.expectedRegion}
                    <select
                      aria-describedby={procurementErrors.region ? "procurement-region-error" : undefined}
                      aria-invalid={Boolean(procurementErrors.region)}
                      className={inputClass}
                      id="procurement-region"
                      onChange={(event) => updateProcurement("region", event.target.value)}
                      value={procurement.region}
                    >
                      <option value="">{copy.common.select}</option>
                      {marketplaceRegions.map((region) => (
                        <option key={region}>{region}</option>
                      ))}
                    </select>
                    <ErrorText id="procurement-region-error">{procurementErrors.region}</ErrorText>
                  </label>
                  <label className={fieldLabelClass}>
                    {copy.procurement.startDate}
                    <input
                      aria-describedby={procurementErrors.deliveryDate ? "procurement-delivery-error" : undefined}
                      aria-invalid={Boolean(procurementErrors.deliveryDate)}
                      className={inputClass}
                      id="procurement-delivery"
                      onChange={(event) => updateProcurement("deliveryDate", event.target.value)}
                      type="date"
                      value={procurement.deliveryDate}
                    />
                    <ErrorText id="procurement-delivery-error">{procurementErrors.deliveryDate}</ErrorText>
                  </label>
                  <label className={`${fieldLabelClass} sm:col-span-2`}>
                    {copy.procurement.requirements}
                    <textarea
                      aria-describedby={procurementErrors.requirements ? "procurement-requirements-error" : undefined}
                      aria-invalid={Boolean(procurementErrors.requirements)}
                      className={`${inputClass} min-h-28 resize-y`}
                      id="procurement-requirements"
                      onChange={(event) => updateProcurement("requirements", event.target.value)}
                      placeholder={copy.procurement.placeholder}
                      value={procurement.requirements}
                    />
                    <ErrorText id="procurement-requirements-error">{procurementErrors.requirements}</ErrorText>
                  </label>
                </div>
              </fieldset>

              <Consent checked={procurement.consent} copy={copy} error={procurementErrors.consent} id="procurement-consent" onChange={(checked) => updateProcurement("consent", checked)} />
              {serverError ? <p className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-base text-[var(--error)]" role="alert">{serverError}</p> : null}
              <button className="button button-primary mt-6 w-full sm:w-auto" disabled={submitting} type="submit">
                {submitting ? copy.common.submitting : copy.procurement.submit}
              </button>
            </form>
          </div>
        ) : (
          <div aria-labelledby="swap-tab" className="border-x border-b border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7" id="swap-panel" role="tabpanel">
            <form noValidate onSubmit={submitSwap} ref={swapFormRef}>
              <SwapLeg
                category={swap.offeredCategory}
                categoryError={swapErrors.offeredCategory}
                copy={copy}
                description={swap.offeredDescription}
                descriptionError={swapErrors.offeredDescription}
                heading={copy.swap.offered}
                onCategoryChange={(category) => updateSwapCategory("offered", category)}
                onDescriptionChange={(value) => updateSwap("offeredDescription", value)}
                onQuantityChange={(value) => updateSwap("offeredQuantity", value)}
                onUnitChange={(unit) => updateSwap("offeredUnit", unit)}
                quantity={swap.offeredQuantity}
                quantityError={swapErrors.offeredQuantity}
                side="offered"
                unit={swap.offeredUnit}
                unitError={swapErrors.offeredUnit}
              />
              <div aria-hidden="true" className="my-5 text-center text-xl font-semibold text-[var(--accent)]">
                {copy.swap.swapTo}
              </div>
              <SwapLeg
                category={swap.wantedCategory}
                categoryError={swapErrors.wantedCategory}
                copy={copy}
                description={swap.wantedDescription}
                descriptionError={swapErrors.wantedDescription}
                heading={copy.swap.wanted}
                onCategoryChange={(category) => updateSwapCategory("wanted", category)}
                onDescriptionChange={(value) => updateSwap("wantedDescription", value)}
                onQuantityChange={(value) => updateSwap("wantedQuantity", value)}
                onUnitChange={(unit) => updateSwap("wantedUnit", unit)}
                quantity={swap.wantedQuantity}
                quantityError={swapErrors.wantedQuantity}
                side="wanted"
                unit={swap.wantedUnit}
                unitError={swapErrors.wantedUnit}
              />

              <fieldset className="mt-6 border-0 border-t border-[var(--border)] p-0 pt-6">
                <legend className="text-lg font-semibold text-[var(--ink)]">{copy.swap.matching}</legend>
                <div className="mt-4 grid gap-5 sm:grid-cols-2">
                  <label className={fieldLabelClass}>
                    {copy.swap.expectedRegion}
                    <select
                      aria-describedby={swapErrors.region ? "swap-region-error" : undefined}
                      aria-invalid={Boolean(swapErrors.region)}
                      className={inputClass}
                      id="swap-region"
                      onChange={(event) => updateSwap("region", event.target.value)}
                      value={swap.region}
                    >
                      <option value="">{copy.common.select}</option>
                      {marketplaceRegions.map((region) => (
                        <option key={region}>{region}</option>
                      ))}
                    </select>
                    <ErrorText id="swap-region-error">{swapErrors.region}</ErrorText>
                  </label>
                  <label className={fieldLabelClass}>
                    {copy.swap.cashDifference}
                    <select
                      aria-describedby={swapErrors.cashDirection ? "swap-cash-direction-error" : undefined}
                      aria-invalid={Boolean(swapErrors.cashDirection)}
                      className={inputClass}
                      id="swap-cash-direction"
                      onChange={(event) => updateSwap("cashDirection", event.target.value as SwapValues["cashDirection"])}
                      value={swap.cashDirection}
                    >
                      <option value="none">{copy.swap.noCash}</option>
                      <option value="offer">{copy.swap.weAdd}</option>
                      <option value="request">{copy.swap.theyAdd}</option>
                    </select>
                    <ErrorText id="swap-cash-direction-error">{swapErrors.cashDirection}</ErrorText>
                  </label>
                  {swap.cashDirection !== "none" ? (
                    <label className={fieldLabelClass}>
                      {copy.swap.cashLimit}
                      <input
                        aria-describedby={swapErrors.cashAmount ? "swap-cash-amount-error" : undefined}
                        aria-invalid={Boolean(swapErrors.cashAmount)}
                        className={inputClass}
                        id="swap-cash-amount"
                        inputMode="decimal"
                        min="0.01"
                        onChange={(event) => updateSwap("cashAmount", event.target.value)}
                        step="0.01"
                        type="number"
                        value={swap.cashAmount}
                      />
                      <ErrorText id="swap-cash-amount-error">{swapErrors.cashAmount}</ErrorText>
                    </label>
                  ) : null}
                </div>
              </fieldset>

              <Consent checked={swap.consent} copy={copy} error={swapErrors.consent} id="swap-consent" onChange={(checked) => updateSwap("consent", checked)} />
              {serverError ? <p className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-base text-[var(--error)]" role="alert">{serverError}</p> : null}
              <button className="button button-primary mt-6 w-full sm:w-auto" disabled={submitting} type="submit">
                {submitting ? copy.common.submitting : copy.swap.submit}
              </button>
            </form>
          </div>
        )}

        {confirmation ? <RequestConfirmation confirmation={confirmation} copy={copy} headingRef={confirmationRef} /> : null}
      </div>

      <aside className="self-start border-t-2 border-[var(--accent)] bg-[var(--info-bg)] p-5 lg:sticky lg:top-28">
        <p className="kicker">{copy.aside.kicker}</p>
        <h2 className="m-0 text-xl">{copy.aside.title}</h2>
        <ul className="mt-4 grid gap-3 pl-5 text-sm text-[var(--text)]">
          {copy.aside.items.map((item) => <li key={item}>{item}</li>)}
        </ul>
        {initialPrefill?.title ? (
          <div className="mt-5 border-t border-[var(--border)] pt-4 text-sm">
            <span className="block text-xs text-[var(--muted)]">{copy.aside.prefilled}</span>
            <strong className="mt-1 block text-[var(--ink)]">{initialPrefill.title}</strong>
          </div>
        ) : null}
      </aside>
    </section>
  );
}

function Consent({ checked, copy, error, id, onChange }: { checked: boolean; copy: RequestCopy; error?: string; id: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="mt-6 flex items-start gap-3 border border-[var(--border)] bg-[var(--info-bg)] p-4 text-sm text-[var(--text)]">
      <input
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={Boolean(error)}
        checked={checked}
        className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
        id={id}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>
        {copy.common.consentText}
        <ErrorText id={`${id}-error`}>{error}</ErrorText>
      </span>
    </label>
  );
}

type SwapLegProps = {
  side: "offered" | "wanted";
  heading: string;
  copy: RequestCopy;
  category: ResourceCategory;
  categoryError?: string;
  unit: PricingUnit;
  unitError?: string;
  quantity: string;
  quantityError?: string;
  description: string;
  descriptionError?: string;
  onCategoryChange: (category: ResourceCategory) => void;
  onUnitChange: (unit: PricingUnit) => void;
  onQuantityChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
};

function SwapLeg(props: SwapLegProps) {
  return (
    <fieldset className="m-0 border border-[var(--border)] bg-[var(--canvas)] p-4 sm:p-5">
      <legend className="px-2 text-xl font-semibold text-[var(--ink)]">{props.heading}</legend>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className={fieldLabelClass}>
          {props.copy.common.resourceType}
          <select
            aria-describedby={props.categoryError ? `${props.side}-category-error` : undefined}
            aria-invalid={Boolean(props.categoryError)}
            className={inputClass}
            id={`${props.side}-category`}
            onChange={(event) => props.onCategoryChange(event.target.value as ResourceCategory)}
            value={props.category}
          >
            <CategoryOptions copy={props.copy} />
          </select>
          <ErrorText id={`${props.side}-category-error`}>{props.categoryError}</ErrorText>
        </label>
        <label className={fieldLabelClass}>
          {props.copy.common.pricingUnit}
          <select
            aria-describedby={props.unitError ? `${props.side}-unit-error` : undefined}
            aria-invalid={Boolean(props.unitError)}
            className={inputClass}
            id={`${props.side}-unit`}
            onChange={(event) => props.onUnitChange(event.target.value as PricingUnit)}
            value={props.unit}
          >
            <UnitOptions category={props.category} copy={props.copy} />
          </select>
          <ErrorText id={`${props.side}-unit-error`}>{props.unitError}</ErrorText>
        </label>
        <label className={fieldLabelClass}>
          {props.copy.common.quantity}
          <input
            aria-describedby={props.quantityError ? `${props.side}-quantity-error` : undefined}
            aria-invalid={Boolean(props.quantityError)}
            className={inputClass}
            id={`${props.side}-quantity`}
            inputMode="decimal"
            min="0.01"
            onChange={(event) => props.onQuantityChange(event.target.value)}
            step="0.01"
            type="number"
            value={props.quantity}
          />
          <ErrorText id={`${props.side}-quantity-error`}>{props.quantityError}</ErrorText>
        </label>
        <label className={`${fieldLabelClass} sm:col-span-2`}>
          {props.copy.swap.specs}
          <textarea
            aria-describedby={props.descriptionError ? `${props.side}-description-error` : undefined}
            aria-invalid={Boolean(props.descriptionError)}
            className={`${inputClass} min-h-24 resize-y`}
            id={`${props.side}-description`}
            onChange={(event) => props.onDescriptionChange(event.target.value)}
            placeholder={props.side === "offered" ? props.copy.swap.offeredPlaceholder : props.copy.swap.wantedPlaceholder}
            value={props.description}
          />
          <ErrorText id={`${props.side}-description-error`}>{props.descriptionError}</ErrorText>
        </label>
      </div>
    </fieldset>
  );
}

function RequestConfirmation({ confirmation, copy, headingRef }: { confirmation: Confirmation; copy: RequestCopy; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  return (
    <section aria-live="polite" className="mt-8 border-t-2 border-[var(--success)] bg-[var(--success-bg)] p-5 sm:p-7" role="status">
      <p className="kicker">{copy.confirmation.kicker}</p>
      <h2 className="m-0 text-2xl" ref={headingRef} tabIndex={-1}>
        {copy.confirmation.title}
      </h2>
      <p className="mt-2 text-sm text-[var(--text)]">{confirmation.title}</p>
      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-3 border-y border-[var(--border)] py-4">
        <span className="text-xs font-semibold text-[var(--muted)]">{copy.confirmation.idLabel}</span>
        <strong className="font-mono text-lg text-[var(--ink)]">{confirmation.id}</strong>
      </div>
      <ol className="mt-6 grid gap-0" aria-label={copy.confirmation.statusAria}>
        {[
          [copy.confirmation.recorded, copy.confirmation.now, copy.confirmation.recordedDescription],
          [copy.confirmation.standardization, copy.confirmation.next, confirmation.mode === "swap" ? copy.confirmation.swapDescription : copy.confirmation.procurementDescription],
          [copy.confirmation.solution, copy.confirmation.afterMatch, copy.confirmation.solutionDescription],
        ].map(([status, time, description], index) => (
          <li className="grid grid-cols-[18px_1fr] gap-3" key={status}>
            <span className="relative flex justify-center" aria-hidden="true">
              <span className={`mt-1 size-2.5 rounded-full ${index === 0 ? "bg-[var(--success)]" : "border border-[var(--border-strong)] bg-[var(--surface)]"}`} />
              {index < 2 ? <span className="absolute bottom-0 top-4 w-px bg-[var(--border-strong)]" /> : null}
            </span>
            <div className="pb-5">
              <div className="flex flex-wrap justify-between gap-2">
                <strong className="text-sm text-[var(--ink)]">{status}</strong>
                <span className="text-xs text-[var(--muted)]">{time}</span>
              </div>
              <p className="mb-0 mt-1 text-sm text-[var(--text)]">{description}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="m-0 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">{copy.confirmation.refreshNote}</p>
    </section>
  );
}
