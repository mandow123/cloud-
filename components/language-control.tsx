"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { localeOptions, type Locale } from "@/lib/i18n";
import { useLocale } from "./locale-provider";

type ControlCopy = {
  panelLabel: string;
  languageTitle: string;
  interfaceLanguage: string;
  searchLanguage: string;
  currencyTitle: string;
  paymentCurrency: string;
  searchCurrency: string;
  currencyNote: string;
  unavailable: string;
  close: string;
};

const CONTROL_COPY: Record<Locale, ControlCopy> = {
  "zh-CN": { panelLabel: "语言与充值币种", languageTitle: "语言", interfaceLanguage: "界面语言", searchLanguage: "搜索语言", currencyTitle: "充值币种", paymentCurrency: "法币入金", searchCurrency: "搜索币种", currencyNote: "算力交易统一使用 KAI 标准卡时；法币仅用于充值卡时。当前仅开放人民币充值。", unavailable: "待开放", close: "关闭语言与币种面板" },
  "zh-TW": { panelLabel: "語言與充值幣種", languageTitle: "語言", interfaceLanguage: "介面語言", searchLanguage: "搜尋語言", currencyTitle: "充值幣種", paymentCurrency: "法幣入金", searchCurrency: "搜尋幣種", currencyNote: "算力交易統一使用 KAI 標準卡時；法幣僅用於充值卡時。目前僅開放人民幣充值。", unavailable: "待開放", close: "關閉語言與幣種面板" },
  en: { panelLabel: "Language and top-up currency", languageTitle: "Language", interfaceLanguage: "Interface language", searchLanguage: "Search languages", currencyTitle: "Top-up currency", paymentCurrency: "Fiat top-ups", searchCurrency: "Search currencies", currencyNote: "Compute is traded only in KAI standard card-hours. Fiat is used only to top up card-hours. CNY is currently the only supported top-up currency.", unavailable: "Coming soon", close: "Close language and currency panel" },
  ja: { panelLabel: "言語とチャージ通貨", languageTitle: "言語", interfaceLanguage: "表示言語", searchLanguage: "言語を検索", currencyTitle: "チャージ通貨", paymentCurrency: "法定通貨入金", searchCurrency: "通貨を検索", currencyNote: "計算資源の取引は KAI 標準カード時に統一されています。法定通貨はカード時のチャージにのみ使用され、現在は人民元のみ対応しています。", unavailable: "近日対応", close: "言語と通貨パネルを閉じる" },
  ko: { panelLabel: "언어 및 충전 통화", languageTitle: "언어", interfaceLanguage: "화면 언어", searchLanguage: "언어 검색", currencyTitle: "충전 통화", paymentCurrency: "법정화폐 충전", searchCurrency: "통화 검색", currencyNote: "컴퓨팅 거래는 KAI 표준 카드시간만 사용합니다. 법정화폐는 카드시간 충전에만 사용되며 현재는 위안화만 지원합니다.", unavailable: "출시 예정", close: "언어 및 통화 패널 닫기" },
  fr: { panelLabel: "Langue et devise de recharge", languageTitle: "Langue", interfaceLanguage: "Langue de l’interface", searchLanguage: "Rechercher une langue", currencyTitle: "Devise de recharge", paymentCurrency: "Recharge en monnaie fiduciaire", searchCurrency: "Rechercher une devise", currencyNote: "Les échanges utilisent uniquement les heures-carte KAI. Les devises servent seulement à recharger des heures-carte. Seul le CNY est actuellement disponible.", unavailable: "Bientôt", close: "Fermer le panneau des langues et devises" },
  th: { panelLabel: "ภาษาและสกุลเงินเติมเงิน", languageTitle: "ภาษา", interfaceLanguage: "ภาษาหน้าจอ", searchLanguage: "ค้นหาภาษา", currencyTitle: "สกุลเงินเติมเงิน", paymentCurrency: "เติมเงินด้วยสกุลเงิน", searchCurrency: "ค้นหาสกุลเงิน", currencyNote: "การซื้อขายใช้ชั่วโมงการ์ด KAI เท่านั้น เงินทั่วไปใช้เพื่อเติมชั่วโมงการ์ด และปัจจุบันรองรับเฉพาะ CNY", unavailable: "เร็ว ๆ นี้", close: "ปิดแผงภาษาและสกุลเงิน" },
  vi: { panelLabel: "Ngôn ngữ và tiền nạp", languageTitle: "Ngôn ngữ", interfaceLanguage: "Ngôn ngữ giao diện", searchLanguage: "Tìm ngôn ngữ", currencyTitle: "Tiền nạp", paymentCurrency: "Nạp bằng tiền pháp định", searchCurrency: "Tìm tiền tệ", currencyNote: "Giao dịch điện toán chỉ dùng giờ-thẻ KAI. Tiền pháp định chỉ dùng để nạp giờ-thẻ. Hiện chỉ hỗ trợ CNY.", unavailable: "Sắp ra mắt", close: "Đóng bảng ngôn ngữ và tiền tệ" },
  id: { panelLabel: "Bahasa dan mata uang isi ulang", languageTitle: "Bahasa", interfaceLanguage: "Bahasa antarmuka", searchLanguage: "Cari bahasa", currencyTitle: "Mata uang isi ulang", paymentCurrency: "Isi ulang fiat", searchCurrency: "Cari mata uang", currencyNote: "Transaksi komputasi hanya memakai jam-kartu KAI. Fiat hanya untuk mengisi jam-kartu. Saat ini hanya CNY yang didukung.", unavailable: "Segera hadir", close: "Tutup panel bahasa dan mata uang" },
  ms: { panelLabel: "Bahasa dan mata wang tambah nilai", languageTitle: "Bahasa", interfaceLanguage: "Bahasa antara muka", searchLanguage: "Cari bahasa", currencyTitle: "Mata wang tambah nilai", paymentCurrency: "Tambah nilai fiat", searchCurrency: "Cari mata wang", currencyNote: "Transaksi pengkomputeran hanya menggunakan jam-kad KAI. Fiat hanya untuk menambah nilai jam-kad. Buat masa ini hanya CNY disokong.", unavailable: "Akan datang", close: "Tutup panel bahasa dan mata wang" },
};

const CURRENCIES = [
  { code: "CNY", label: "人民币", enabled: true },
  { code: "USD", label: "美元", enabled: false },
  { code: "EUR", label: "欧元", enabled: false },
  { code: "JPY", label: "日元", enabled: false },
  { code: "KRW", label: "韩元", enabled: false },
  { code: "GBP", label: "英镑", enabled: false },
  { code: "HKD", label: "港元", enabled: false },
  { code: "TWD", label: "新台币", enabled: false },
  { code: "SGD", label: "新加坡元", enabled: false },
  { code: "MYR", label: "马来西亚林吉特", enabled: false },
  { code: "IDR", label: "印度尼西亚卢比", enabled: false },
  { code: "PHP", label: "菲律宾比索", enabled: false },
  { code: "AUD", label: "澳大利亚元", enabled: false },
  { code: "CAD", label: "加拿大元", enabled: false },
  { code: "THB", label: "泰铢", enabled: false },
] as const;

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function CheckIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 13 4 4L19 7" /></svg>;
}

export function LanguageControl() {
  const { locale, setLocale, t } = useLocale();
  const [open, setOpen] = useState(false);
  const [languageQuery, setLanguageQuery] = useState("");
  const [currencyQuery, setCurrencyQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const copy = CONTROL_COPY[locale];
  const currentOption = localeOptions.find((option) => option.value === locale) ?? localeOptions[0];
  const currencyDisplay = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: "currency" });
    } catch {
      return null;
    }
  }, [locale]);

  const filteredLanguages = useMemo(() => {
    const query = languageQuery.trim().toLocaleLowerCase();
    if (!query) return localeOptions;
    return localeOptions.filter((option) => `${option.label} ${option.shortLabel} ${option.value}`.toLocaleLowerCase().includes(query));
  }, [languageQuery]);

  const filteredCurrencies = useMemo(() => {
    const query = currencyQuery.trim().toLocaleLowerCase();
    if (!query) return CURRENCIES;
    return CURRENCIES.filter((item) => `${currencyDisplay?.of(item.code) ?? item.label} ${item.code}`.toLocaleLowerCase().includes(query));
  }, [currencyDisplay, currencyQuery]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  function chooseLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    setOpen(false);
    setLanguageQuery("");
  }

  return (
    <div className="language-market-control" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        className="language-market-trigger"
        title={t("languageScope")}
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <svg aria-hidden="true" className="language-market-globe" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c3 3 4.5 6 4.5 9S15 18 12 21M12 3c-3 3-4.5 6-4.5 9S9 18 12 21" />
        </svg>
        <span className="language-market-trigger-label">{currentOption.label}</span>
        <span aria-hidden="true" className="language-market-trigger-separator">·</span>
        <span>CNY</span>
        <svg aria-hidden="true" className="language-market-chevron" data-open={open ? "true" : "false"} viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {open ? (
        <div aria-label={copy.panelLabel} className="language-market-panel" id={panelId} role="dialog">
          <section className="language-market-column" aria-labelledby={`${panelId}-language`}>
            <div className="language-market-heading">
              <h2 id={`${panelId}-language`}>{copy.languageTitle}</h2>
              <span>{copy.interfaceLanguage}</span>
            </div>
            <label className="language-market-search">
              <SearchIcon />
              <span className="sr-only">{copy.searchLanguage}</span>
              <input ref={searchRef} value={languageQuery} onChange={(event) => setLanguageQuery(event.target.value)} placeholder={copy.searchLanguage} type="search" />
            </label>
            <div className="language-market-options">
              {filteredLanguages.map((option) => {
                const selected = option.value === locale;
                return (
                  <button
                    aria-pressed={selected}
                    className="language-market-option"
                    data-selected={selected ? "true" : "false"}
                    key={option.value}
                    type="button"
                    onClick={() => chooseLocale(option.value)}
                  >
                    <span>{option.label}</span>
                    <span className="language-market-option-code">{option.value}</span>
                    {selected ? <CheckIcon /> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="language-market-column language-market-currency" aria-labelledby={`${panelId}-currency`}>
            <div className="language-market-heading">
              <h2 id={`${panelId}-currency`}>{copy.currencyTitle}</h2>
              <span>{copy.paymentCurrency}</span>
            </div>
            <label className="language-market-search">
              <SearchIcon />
              <span className="sr-only">{copy.searchCurrency}</span>
              <input value={currencyQuery} onChange={(event) => setCurrencyQuery(event.target.value)} placeholder={copy.searchCurrency} type="search" />
            </label>
            <div className="language-market-options language-market-currency-options">
              {filteredCurrencies.map((currency) => (
                <button
                  aria-disabled={!currency.enabled}
                  aria-pressed={Boolean(currency.enabled)}
                  className="language-market-option language-market-currency-option"
                  data-selected={currency.enabled ? "true" : "false"}
                  key={currency.code}
                  title={currency.enabled ? (currencyDisplay?.of(currency.code) ?? currency.label) : copy.unavailable}
                  type="button"
                  disabled={!currency.enabled}
                >
                  <span>{currencyDisplay?.of(currency.code) ?? currency.label}</span>
                  <span className="language-market-option-code">{currency.code}</span>
                  {currency.enabled ? <CheckIcon /> : <span className="language-market-pending">{copy.unavailable}</span>}
                </button>
              ))}
            </div>
            <p className="language-market-note">{copy.currencyNote}</p>
          </section>
          <button aria-label={copy.close} className="language-market-close" type="button" onClick={() => setOpen(false)}>×</button>
        </div>
      ) : null}
    </div>
  );
}
