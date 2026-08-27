#!/usr/bin/env python3
"""KAI Cloud phase-1 transaction service.

Standard-library-only HTTP service with SQLite persistence. It deliberately keeps
the first production slice narrow: enterprise accounts, verified GPU listings,
atomic reservations, server-side payment callbacks, delivery, acceptance and an
append-only audit trail. Real payment credentials are injected through the
environment; the mock provider is for end-to-end acceptance only.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import importlib.util
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlencode, urlparse
from urllib.request import Request, urlopen

from qixiangpay import (
    QixiangPayConfig,
    QixiangPayError,
    create_checkout as qixiang_create_checkout,
    money_to_cents as qixiang_money_to_cents,
    query_merchant as qixiang_query_merchant,
    query_order as qixiang_query_order,
    refund_order as qixiang_refund_order,
    verify_signature as qixiang_verify_signature,
)


ROOT = Path(__file__).resolve().parent
STATIC_ROOT = (ROOT / "outputs").resolve()
DB_PATH = Path(os.environ.get("KAI_DB_PATH", str(ROOT / "data" / "kai.db"))).resolve()
EVIDENCE_ROOT = Path(os.environ.get("KAI_EVIDENCE_ROOT", str(DB_PATH.parent / "private-evidence"))).resolve()
HOST = os.environ.get("KAI_HOST", "127.0.0.1")
PORT = int(os.environ.get("KAI_PORT", "8081"))
ALLOW_DEMO = os.environ.get("KAI_ALLOW_DEMO", "false").lower() == "true"
SEED_CATALOG = os.environ.get("KAI_SEED_CATALOG", "false").lower() == "true"
COOKIE_SECURE = os.environ.get("KAI_COOKIE_SECURE", "false").lower() == "true"
SESSION_HOURS = int(os.environ.get("KAI_SESSION_HOURS", "12"))
MAX_BODY = 8_388_608
MAX_EVIDENCE_BYTES = 5_242_880
PBKDF2_ROUNDS = 310_000
MOCK_SECRET = os.environ.get("KAI_PAYMENT_MOCK_SECRET", "kai-local-mock-provider-change-me")
REQUIRE_SMS = os.environ.get("KAI_REQUIRE_SMS", "false").lower() == "true"
SMS_PROVIDER = os.environ.get("KAI_SMS_PROVIDER", "disabled").strip().lower()
OTP_TTL_SECONDS = int(os.environ.get("KAI_OTP_TTL_SECONDS", "300"))
OTP_MAX_ATTEMPTS = int(os.environ.get("KAI_OTP_MAX_ATTEMPTS", "5"))
OTP_HASH_SECRET = os.environ.get("KAI_OTP_HASH_SECRET", "")
PUBLIC_BASE_URL = os.environ.get("KAI_PUBLIC_BASE_URL", "").rstrip("/")
PLATFORM_MODE = os.environ.get("KAI_PLATFORM_MODE", "marketplace").strip().lower()
PAYMENT_GATEWAY = os.environ.get("KAI_PAYMENT_GATEWAY", "qixiang").strip().lower()
QIXIANG_PID = os.environ.get("KAI_QIXIANG_PID", "").strip()
QIXIANG_KEY = os.environ.get("KAI_QIXIANG_KEY", "").strip()
QIXIANG_MAPI_URL = os.environ.get(
    "KAI_QIXIANG_MAPI_URL", "https://api.payqixiang.cn/mapi.php"
).strip()
QIXIANG_API_URL = os.environ.get(
    "KAI_QIXIANG_API_URL", "https://api.payqixiang.cn/api.php"
).strip()
QIXIANG_TIMEOUT_SECONDS = min(60, max(1, int(os.environ.get("KAI_QIXIANG_TIMEOUT_SECONDS", "12"))))
QIXIANG_REFUND_ENABLED = os.environ.get("KAI_QIXIANG_REFUND_ENABLED", "false").lower() == "true"
PAYMENT_CREATE_ENABLED = os.environ.get("KAI_PAYMENT_CREATE_ENABLED", "false").lower() == "true"
APP_ORDER_ONLY_ENABLED = (
    os.environ.get("KAI_APP_ORDER_ONLY_ENABLED", "false").lower() == "true"
)
PAYMENT_RECONCILIATION_ENABLED = (
    os.environ.get("KAI_PAYMENT_RECONCILIATION_ENABLED", "false").lower() == "true"
)
QIXIANG_KEY_OWNERSHIP_CONFIRMED = (
    os.environ.get("KAI_QIXIANG_KEY_OWNERSHIP_CONFIRMED", "false").lower() == "true"
)
QIXIANG_RETIRED_KEY_SHA256 = os.environ.get(
    "KAI_QIXIANG_RETIRED_KEY_SHA256", ""
).strip().lower()
QIXIANG_CREDENTIAL_EVIDENCE_MAX_AGE_SECONDS = max(
    600,
    min(
        86_400,
        int(os.environ.get("KAI_QIXIANG_CREDENTIAL_EVIDENCE_MAX_AGE_SECONDS", "7200")),
    ),
)
QIXIANG_CREDENTIAL_REFRESH_SECONDS = max(
    300,
    min(
        QIXIANG_CREDENTIAL_EVIDENCE_MAX_AGE_SECONDS // 2,
        int(os.environ.get("KAI_QIXIANG_CREDENTIAL_REFRESH_SECONDS", "3600")),
    ),
)
QIXIANG_SCENE_REGISTERED = (
    os.environ.get("KAI_QIXIANG_SCENE_REGISTERED", "false").lower() == "true"
)
QIXIANG_ALLOW_INSECURE_HTTP = os.environ.get("KAI_QIXIANG_ALLOW_INSECURE_HTTP", "false").lower() == "true"
QIXIANG_CHECKOUT_HOSTS = tuple(
    host.strip().lower() for host in os.environ.get(
        "KAI_QIXIANG_CHECKOUT_HOSTS", "api.payqixiang.cn"
    ).split(",") if host.strip()
)
QIXIANG_PRODUCTION_PID = "4611"
QIXIANG_PRODUCTION_MAPI_URL = "https://api.payqixiang.cn/mapi.php"
QIXIANG_PRODUCTION_API_URL = "https://api.payqixiang.cn/api.php"
QIXIANG_PRODUCTION_CHECKOUT_HOSTS = ("api.payqixiang.cn",)
ORDER_RESERVATION_MINUTES = max(5, int(os.environ.get("KAI_ORDER_RESERVATION_MINUTES", "30")))
SETTLEMENT_HOLD_HOURS = max(0, int(os.environ.get("KAI_SETTLEMENT_HOLD_HOURS", "72")))
PLATFORM_FEE_BPS = min(5000, max(0, int(os.environ.get("KAI_PLATFORM_FEE_BPS", "500"))))
PLATFORM_INVENTORY_SUPPLIER_ID = "usr_platform_inventory"
PLATFORM_INVENTORY_PROVIDER = "CloudPay 自有资源"
SUPPLIER_REBATE_REVIEW_CENTS = 5_000_000
CARD_HOUR_MICROS = 1_000_000
SUPPLIER_REBATE_TIERS = (
    (100_000, 100),
    (1_000_000, 80),
    (3_000_000, 50),
    (5_000_000, 30),
    (None, 20),
)
METERING_TOLERANCE_RATIO = min(.25, max(0, float(os.environ.get("KAI_METERING_TOLERANCE_RATIO", ".02"))))
WORKER_INTERVAL_SECONDS = max(5, int(os.environ.get("KAI_WORKER_INTERVAL_SECONDS", "30")))
QIXIANG_QUERY_LIMIT_PER_MINUTE = max(
    4, min(120, int(os.environ.get("KAI_QIXIANG_QUERY_LIMIT_PER_MINUTE", "20")))
)
QIXIANG_QUERY_FAILURE_THRESHOLD = max(
    2, min(20, int(os.environ.get("KAI_QIXIANG_QUERY_FAILURE_THRESHOLD", "3")))
)
QIXIANG_QUERY_CIRCUIT_SECONDS = max(
    15, min(600, int(os.environ.get("KAI_QIXIANG_QUERY_CIRCUIT_SECONDS", "60")))
)
PAYMENT_WORKER_MAX_STALENESS_SECONDS = max(
    30, min(600, int(os.environ.get("KAI_PAYMENT_WORKER_MAX_STALENESS_SECONDS", "120")))
)
QIXIANG_CHECKOUT_LEASE_SECONDS = max(
    15, min(120, int(os.environ.get("KAI_QIXIANG_CHECKOUT_LEASE_SECONDS", "45")))
)
QIXIANG_MANUAL_REVIEW_AFTER_ATTEMPTS = max(
    5,
    min(
        10_000,
        int(os.environ.get("KAI_QIXIANG_MANUAL_REVIEW_AFTER_ATTEMPTS", "120")),
    ),
)
QIXIANG_MANUAL_REVIEW_BACKOFF_SECONDS = max(
    300,
    min(
        86_400,
        int(os.environ.get("KAI_QIXIANG_MANUAL_REVIEW_BACKOFF_SECONDS", "21600")),
    ),
)
MOBILE_LOGIN_MAX_EXCHANGES = max(
    2, min(5, int(os.environ.get("KAI_MOBILE_LOGIN_MAX_EXCHANGES", "3")))
)
CARD_HOUR_TOPUP_LISTING_ID = "lst_cloudpay_card_hour_topup"
CARD_HOUR_TOPUP_PRODUCT_CODE = "KAI_STANDARD_CARD_HOUR"
CARD_HOUR_VALID_DAYS = 364
CARD_HOUR_PRICE_NUMERATOR_CENTS = 501
CARD_HOUR_PRICE_DENOMINATOR_HOURS = 5
CARD_HOUR_TOPUP_MIN_CENTS = 100
CARD_HOUR_TOPUP_MAX_CENTS = 5_000_000
CARD_HOUR_PACKAGES = {
    "starter_5": {"card_hours_micros": 5 * CARD_HOUR_MICROS, "amount_cents": 501},
    "standard_50": {"card_hours_micros": 50 * CARD_HOUR_MICROS, "amount_cents": 5_010},
    "pro_100": {"card_hours_micros": 100 * CARD_HOUR_MICROS, "amount_cents": 10_020},
    "business_500": {"card_hours_micros": 500 * CARD_HOUR_MICROS, "amount_cents": 50_100},
}
ADMIN_ACCOUNT = os.environ.get("KAI_ADMIN_ACCOUNT", "").strip().lower()
ADMIN_PASSWORD = os.environ.get("KAI_ADMIN_PASSWORD", "")
OPERATOR_LEGAL_NAME = os.environ.get("KAI_OPERATOR_LEGAL_NAME", "").strip()
OPERATOR_CREDIT_CODE = os.environ.get("KAI_OPERATOR_CREDIT_CODE", "").strip()
SUPPORT_EMAIL = os.environ.get("KAI_SUPPORT_EMAIL", "").strip()
SUPPORT_PHONE = os.environ.get("KAI_SUPPORT_PHONE", "").strip()
ICP_FILING = os.environ.get("KAI_ICP_FILING", "").strip()
APP_FILING = os.environ.get("KAI_APP_FILING", "").strip()
INTERNET_SERVICE_CLASSIFICATION = os.environ.get(
    "KAI_INTERNET_SERVICE_CLASSIFICATION", ""
).strip()
INTERNET_SERVICE_CLASSIFICATION_STATUS = os.environ.get(
    "KAI_INTERNET_SERVICE_CLASSIFICATION_STATUS", "pending"
).strip().lower()
APP_NAME = os.environ.get("KAI_APP_NAME", "KAI Cloud").strip() or "KAI Cloud"
IOS_BUNDLE_ID = os.environ.get("KAI_IOS_BUNDLE_ID", "com.kaicloud.marketplace").strip()
ANDROID_PACKAGE_ID = os.environ.get("KAI_ANDROID_PACKAGE_ID", "com.kaicloud.marketplace").strip()
AUTH_PROVIDER = os.environ.get("KAI_AUTH_PROVIDER", "kai_identity").strip().lower()
IDENTITY_ISSUER = os.environ.get("KAI_IDENTITY_ISSUER", "https://auth.kai.com/api/auth").rstrip("/")
IDENTITY_CLIENT_ID = os.environ.get("KAI_IDENTITY_CLIENT_ID", "").strip()
IDENTITY_CLIENT_SECRET = os.environ.get("KAI_IDENTITY_CLIENT_SECRET", "").strip()
IDENTITY_REDIRECT_URI = os.environ.get(
    "KAI_IDENTITY_REDIRECT_URI",
    f"{PUBLIC_BASE_URL}/api/auth/kai/callback" if PUBLIC_BASE_URL else "",
).strip()
IDENTITY_MOBILE_REDIRECT_URI = os.environ.get(
    "KAI_IDENTITY_MOBILE_REDIRECT_URI",
    f"{PUBLIC_BASE_URL}/api/auth/kai/mobile/callback" if PUBLIC_BASE_URL else "",
).strip()
MOBILE_APP_CALLBACK_URI = os.environ.get(
    "KAI_MOBILE_APP_CALLBACK_URI", "cloudpay://auth/callback"
).strip()
MOBILE_APP_DEVELOPMENT_CALLBACK_URI = os.environ.get(
    "KAI_MOBILE_APP_DEVELOPMENT_CALLBACK_URI", ""
).strip()
MOBILE_APP_CALLBACK_URIS = frozenset(
    callback_uri
    for callback_uri in (
        MOBILE_APP_CALLBACK_URI,
        MOBILE_APP_DEVELOPMENT_CALLBACK_URI,
    )
    if callback_uri
)
IDENTITY_AUTHORIZATION_ENDPOINT = os.environ.get(
    "KAI_IDENTITY_AUTHORIZATION_ENDPOINT", f"{IDENTITY_ISSUER}/oauth2/authorize"
).strip()
IDENTITY_TOKEN_ENDPOINT = os.environ.get(
    "KAI_IDENTITY_TOKEN_ENDPOINT", f"{IDENTITY_ISSUER}/oauth2/token"
).strip()
IDENTITY_USERINFO_ENDPOINT = os.environ.get(
    "KAI_IDENTITY_USERINFO_ENDPOINT", f"{IDENTITY_ISSUER}/oauth2/userinfo"
).strip()
IDENTITY_TRANSACTION_MINUTES = 10
MOBILE_LOGIN_TICKET_MINUTES = 2
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.6-sol").strip() or "gpt-5.6-sol"
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
OPENAI_TIMEOUT_SECONDS = min(15, max(3, int(os.environ.get("OPENAI_TIMEOUT_SECONDS", "8"))))

RATE_LOCK = threading.Lock()
RATE_BUCKETS: dict[str, list[float]] = {}

MARKET_PRODUCTS = {
    "gpu": [
        {"id": "B200", "name": "NVIDIA B200", "base": 50.00, "unit": "元 / 配置时", "billing_unit": "单卡配置时"},
        {"id": "B300", "name": "NVIDIA B300", "base": 120.00, "unit": "元 / 配置时", "billing_unit": "双卡配置时"},
        {"id": "H100", "name": "NVIDIA H100", "base": 25.00, "unit": "元 / 配置时", "billing_unit": "单卡配置时"},
        {"id": "H200", "name": "NVIDIA H200", "base": 33.00, "unit": "元 / 配置时", "billing_unit": "单卡配置时"},
        {"id": "RTX5090", "name": "NVIDIA RTX 5090", "base": 5.00, "unit": "元 / 配置时", "billing_unit": "单卡配置时"},
        {"id": "RTX4090", "name": "NVIDIA RTX 4090", "base": 3.00, "unit": "元 / 配置时", "billing_unit": "单卡配置时"},
    ],
    "token": [
        {"id": "gpt5-mini-mixed", "name": "GPT-5 mini · KAI 网关 · 32K · 组合用量", "base": 18.70, "unit": "元 / 百万 Token"},
        {"id": "deepseek-v3-mixed", "name": "DeepSeek-V3 · KAI 网关 · 32K · 组合用量", "base": 12.10, "unit": "元 / 百万 Token"},
        {"id": "qwen3-32b-mixed", "name": "Qwen3-32B · KAI 网关 · 32K · 组合用量", "base": 9.40, "unit": "元 / 百万 Token"},
        {"id": "kimi-k2-mixed", "name": "Kimi K2 · KAI 网关 · 32K · 组合用量", "base": 11.00, "unit": "元 / 百万 Token"},
    ],
    "rack": [
        {"id": "rack20", "name": "20kW 标准风冷机柜", "base": 28000, "unit": "元 / 柜月"},
        {"id": "rack40", "name": "40kW 液冷机柜", "base": 65100, "unit": "元 / 柜月"},
        {"id": "rack80", "name": "80kW 高密液冷机柜", "base": 154560, "unit": "元 / 柜月"},
    ],
    "server": [
        {"id": "h100x8", "name": "NVIDIA H100 80GB × 8 整机", "base": 119.20, "unit": "元 / 整机时"},
        {"id": "h200x8", "name": "NVIDIA H200 141GB × 8 整机", "base": 150.40, "unit": "元 / 整机时"},
        {"id": "a100x8", "name": "NVIDIA A100 80GB × 8 整机", "base": 78.56, "unit": "元 / 整机时"},
        {"id": "l40sx4", "name": "NVIDIA L40S 48GB × 4 整机", "base": 32.80, "unit": "元 / 整机时"},
        {"id": "cpu512", "name": "双路 CPU · 512GB 内存服务器", "base": 6.80, "unit": "元 / 整机时"},
    ],
}
COMPUTE_PRODUCT_CONFIGS = (
    {"id": "cfg_b200_1", "gpu": "B200", "gpu_count": 1, "cpu_cores": 26, "memory_gb": 350, "hourly_price_cents": 5000},
    {"id": "cfg_b200_2", "gpu": "B200", "gpu_count": 2, "cpu_cores": 48, "memory_gb": 516, "hourly_price_cents": 10000},
    {"id": "cfg_b200_4", "gpu": "B200", "gpu_count": 4, "cpu_cores": 96, "memory_gb": 1024, "hourly_price_cents": 22000},
    {"id": "cfg_b200_8", "gpu": "B200", "gpu_count": 8, "cpu_cores": 192, "memory_gb": 2048, "hourly_price_cents": 44000},
    {"id": "cfg_b300_2", "gpu": "B300", "gpu_count": 2, "cpu_cores": 64, "memory_gb": 700, "hourly_price_cents": 12000},
    {"id": "cfg_h100_1", "gpu": "H100", "gpu_count": 1, "cpu_cores": 40, "memory_gb": 300, "hourly_price_cents": 2500},
    {"id": "cfg_h100_2", "gpu": "H100", "gpu_count": 2, "cpu_cores": 40, "memory_gb": 500, "hourly_price_cents": 3500},
    {"id": "cfg_h100_4", "gpu": "H100", "gpu_count": 4, "cpu_cores": 96, "memory_gb": 1150, "hourly_price_cents": 7000},
    {"id": "cfg_h200_1", "gpu": "H200", "gpu_count": 1, "cpu_cores": 30, "memory_gb": 256, "hourly_price_cents": 3300},
    {"id": "cfg_h200_2", "gpu": "H200", "gpu_count": 2, "cpu_cores": 48, "memory_gb": 512, "hourly_price_cents": 5500},
    {"id": "cfg_h200_4", "gpu": "H200", "gpu_count": 4, "cpu_cores": 112, "memory_gb": 1032, "hourly_price_cents": 18000},
    {"id": "cfg_rtx5090_1", "gpu": "RTX5090", "gpu_count": 1, "cpu_cores": 16, "memory_gb": 32, "hourly_price_cents": 500},
    {"id": "cfg_rtx5090_2", "gpu": "RTX5090", "gpu_count": 2, "cpu_cores": 32, "memory_gb": 94, "hourly_price_cents": 800},
    {"id": "cfg_rtx5090_4", "gpu": "RTX5090", "gpu_count": 4, "cpu_cores": 32, "memory_gb": 192, "hourly_price_cents": 1200},
    {"id": "cfg_rtx5090_8", "gpu": "RTX5090", "gpu_count": 8, "cpu_cores": 128, "memory_gb": 483, "hourly_price_cents": 2500},
    {"id": "cfg_rtx4090_1", "gpu": "RTX4090", "gpu_count": 1, "cpu_cores": 32, "memory_gb": 16, "hourly_price_cents": 300},
    {"id": "cfg_rtx4090_2", "gpu": "RTX4090", "gpu_count": 2, "cpu_cores": 32, "memory_gb": 64, "hourly_price_cents": 600},
    {"id": "cfg_rtx4090_4", "gpu": "RTX4090", "gpu_count": 4, "cpu_cores": 192, "memory_gb": 129, "hourly_price_cents": 1000},
    {"id": "cfg_rtx4090_8", "gpu": "RTX4090", "gpu_count": 8, "cpu_cores": 384, "memory_gb": 258, "hourly_price_cents": 1400},
)
MARKET_REGIONS = {
    "beijing": ("北京", 1.18), "shanghai": ("上海", 1.16),
    "chengdu": ("成都", .92), "guizhou": ("贵州", .82),
    "ningxia": ("宁夏", .80), "hongkong": ("中国香港", 1.32),
    "singapore": ("新加坡", 1.48),
}
MARKET_INTERVALS = {
    "5m": 300, "15m": 900, "1h": 3600, "4h": 14400,
    "1d": 86400, "1w": 604800, "1mo": 2592000,
}
H100_SERVICE_MODES = {
    "exclusive": {"label": "H100 80GB 独占", "billing_factor": 1.0, "gpu_memory_gb": 80},
    "slice_20gb": {"label": "H100 20GB 切片", "billing_factor": 0.25, "gpu_memory_gb": 20},
}
H100_CPU_OPTIONS = {16, 32, 64}
H100_MEMORY_OPTIONS = {64, 128, 256}
H100_STORAGE_OPTIONS = {
    "ssd_500": "500GB SSD", "nvme_1tb": "1TB NVMe", "nvme_2tb": "2TB NVMe",
}
H100_ENVIRONMENT_OPTIONS = {
    "ubuntu_cuda": "Ubuntu + CUDA", "pytorch": "Ubuntu + CUDA + PyTorch",
    "tensorflow": "Ubuntu + CUDA + TensorFlow",
}
ENVIRONMENT_DELIVERY_MODES = {
    "api": {"label": "推理 API", "capability_level": "L2"},
    "managed": {"label": "平台标准训练环境", "capability_level": "L3"},
    "custom": {"label": "客户 Docker / OCI 镜像", "capability_level": "L4"},
    "dedicated": {"label": "专属 GPU / 集群", "capability_level": "L5"},
}
ENVIRONMENT_TEMPLATES = {
    "base": "Ubuntu + CUDA 基础环境",
    "pytorch": "Ubuntu + CUDA + PyTorch",
    "tensorflow": "Ubuntu + CUDA + TensorFlow",
    "vllm": "Ubuntu + CUDA + vLLM",
    "deepspeed": "Ubuntu + CUDA + DeepSpeed",
}
ENVIRONMENT_WORKSPACE_OPTIONS = {"500GB": 500, "1TB": 1024, "2TB": 2048, "5TB": 5120}
ENVIRONMENT_ACCESS_MODES = {
    "api": "API Key / 短时令牌", "ssh": "采购方 SSH 公钥",
    "notebook": "Notebook 安全入口", "sso": "企业 SSO / 项目权限",
}
ENVIRONMENT_NETWORK_MODES = {
    "public": "标准公网接入", "private": "独立 VPC",
    "vpn": "VPN / 专线预检", "isolated": "隔离网络",
}
ENVIRONMENT_API_RUNTIMES = {
    "vllm": "vLLM", "sglang": "SGLang", "triton": "NVIDIA Triton", "tgi": "Hugging Face TGI",
}
ENVIRONMENT_API_CONTEXT_OPTIONS = {4096, 8192, 16384, 32768, 65536, 131072}
RESOURCE_UNITS = {
    "gpu": {"GPU 时"},
    "tokencap": {"Token 容量时"},
    "tokenusage": {"百万 Token"},
    "rack": {"柜月", "kW 月"},
}
RESOURCE_KIND_LABELS = {
    "gpu": "GPU 算力", "tokencap": "Token 容量时",
    "tokenusage": "百万 Token 实际用量", "rack": "柜月",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def future_iso(hours: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).replace(microsecond=0).isoformat()


def future_minutes_iso(minutes: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).replace(microsecond=0).isoformat()


def future_days_iso(days: int, *, base: datetime | None = None) -> str:
    moment = base or datetime.now(timezone.utc)
    return (moment + timedelta(days=days)).replace(microsecond=0).isoformat()


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def db_connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=15, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA busy_timeout=15000")
    return connection


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(digest).decode()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds, salt_b64, expected_b64 = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_b64.encode())
        expected = base64.urlsafe_b64decode(expected_b64.encode())
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(rounds))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def safe_return_to(value: object) -> str:
    target = str(value or "/").strip()
    if len(target) > 600 or not target.startswith("/") or target.startswith("//"):
        return "/"
    if "\\" in target or any(ord(character) < 32 for character in target):
        return "/"
    parsed = urlparse(target)
    if parsed.scheme or parsed.netloc:
        return "/"
    return parsed.path + (f"?{parsed.query}" if parsed.query else "")


def approved_mobile_app_callback_uri(value: object) -> str:
    candidate = str(value or "").strip()
    return candidate if candidate in MOBILE_APP_CALLBACK_URIS else ""


def normalize_phone(value: object) -> str:
    phone = re.sub(r"[\s()-]", "", str(value or "").strip())
    if phone.startswith("+86"):
        phone = phone[3:]
    elif phone.startswith("0086"):
        phone = phone[4:]
    if not re.fullmatch(r"1[3-9]\d{9}", phone):
        raise ApiError(422, "请输入有效的中国大陆手机号", "invalid_phone")
    return phone


def otp_digest(record_id: str, phone: str, code: str) -> str:
    secret = OTP_HASH_SECRET or (MOCK_SECRET if ALLOW_DEMO else "")
    if not secret:
        raise ApiError(503, "验证码安全密钥尚未配置", "otp_secret_not_configured")
    message = f"{record_id}|{phone}|register|{code}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def environment_file_ready(name: str) -> bool:
    value = os.environ.get(name, "").strip()
    if not value:
        return False
    try:
        candidate = Path(value).expanduser().resolve()
        return candidate.is_file() and candidate.stat().st_size > 0
    except (OSError, RuntimeError):
        return False


def sms_readiness() -> dict:
    if SMS_PROVIDER == "mock" and ALLOW_DEMO:
        return {"provider": "mock", "configured": True, "required": REQUIRE_SMS, "missing": []}
    if SMS_PROVIDER != "aliyun":
        return {"provider": SMS_PROVIDER, "configured": False, "required": REQUIRE_SMS,
                "missing": ["阿里云短信通道"]}
    checks = {
        "RAM AccessKey ID": bool(os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_ID", "").strip()),
        "RAM AccessKey Secret": bool(os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_SECRET", "").strip()),
        "短信签名": bool(os.environ.get("KAI_SMS_SIGN_NAME", "").strip()),
        "验证码模板": bool(os.environ.get("KAI_SMS_TEMPLATE_CODE", "").strip()),
        "验证码安全密钥": bool(OTP_HASH_SECRET),
        "阿里云短信官方 SDK": importlib.util.find_spec("alibabacloud_dysmsapi20170525") is not None,
    }
    missing = [label for label, ready in checks.items() if not ready]
    return {"provider": "aliyun", "configured": not missing, "required": REQUIRE_SMS, "missing": missing}


def identity_readiness() -> dict:
    checks = {
        "KAI Identity Client ID": bool(IDENTITY_CLIENT_ID),
        "KAI Identity Client Secret": bool(IDENTITY_CLIENT_SECRET),
        "CloudPay HTTPS 回调地址": IDENTITY_REDIRECT_URI.startswith("https://"),
        "CloudPay App HTTPS 回调地址": IDENTITY_MOBILE_REDIRECT_URI.startswith("https://"),
        "CloudPay App 正式原生回跳地址": MOBILE_APP_CALLBACK_URI == "cloudpay://auth/callback",
        "CloudPay App 开发原生回跳地址": (
            not MOBILE_APP_DEVELOPMENT_CALLBACK_URI
            or MOBILE_APP_DEVELOPMENT_CALLBACK_URI
            == "kaicloud-dev://auth/mobile/auth/handoff"
        ),
        "KAI Identity HTTPS 授权端点": IDENTITY_AUTHORIZATION_ENDPOINT.startswith("https://"),
        "KAI Identity HTTPS令牌端点": IDENTITY_TOKEN_ENDPOINT.startswith("https://"),
        "KAI Identity HTTPS 用户信息端点": IDENTITY_USERINFO_ENDPOINT.startswith("https://"),
    }
    missing = [label for label, ready in checks.items() if not ready]
    return {
        "provider": "kai_identity",
        "configured": not missing,
        "missing": missing,
        "issuer": IDENTITY_ISSUER,
        "start_url": "/api/auth/kai/start?return_to=/",
        "mobile_start_url": "/api/auth/kai/mobile/start?return_to=/",
        "registration_url": "https://auth.kai.com/sign-up",
        "cloud_login_url": "https://cloud.kai.com/login",
    }


def qixiang_config() -> QixiangPayConfig:
    return QixiangPayConfig(
        pid=QIXIANG_PRODUCTION_PID,
        key=QIXIANG_KEY,
        checkout_url=QIXIANG_PRODUCTION_MAPI_URL,
        api_url=QIXIANG_PRODUCTION_API_URL,
        timeout_seconds=QIXIANG_TIMEOUT_SECONDS,
        allow_insecure_http=False,
        checkout_hosts=QIXIANG_PRODUCTION_CHECKOUT_HOSTS,
    )


def payment_merchant_id(provider: str) -> str:
    if PAYMENT_GATEWAY == "qixiang":
        return QIXIANG_PID
    return os.environ.get(f"KAI_{provider.upper()}_MERCHANT_ID", "").strip()


def qixiang_key_fingerprints_distinct() -> bool:
    if not QIXIANG_KEY or not re.fullmatch(r"[0-9a-f]{64}", QIXIANG_RETIRED_KEY_SHA256):
        return False
    current_fingerprint = hashlib.sha256(QIXIANG_KEY.encode("utf-8")).hexdigest()
    return not hmac.compare_digest(current_fingerprint, QIXIANG_RETIRED_KEY_SHA256)


def parse_evidence_timestamp(value: object) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.astimezone(timezone.utc)


def current_qixiang_key_sha256() -> str:
    return hashlib.sha256(QIXIANG_KEY.encode("utf-8")).hexdigest() if QIXIANG_KEY else ""


def latest_qixiang_key_rotation_evidence() -> sqlite3.Row | None:
    if not qixiang_key_fingerprints_distinct():
        return None
    try:
        with db_connect() as connection:
            return connection.execute(
                """SELECT * FROM qixiang_key_rotation_evidence
                   WHERE pid=? AND active_key_sha256=? AND retired_key_sha256=?
                   ORDER BY provider_verified_at DESC,id DESC LIMIT 1""",
                (QIXIANG_PID, current_qixiang_key_sha256(), QIXIANG_RETIRED_KEY_SHA256),
            ).fetchone()
    except sqlite3.OperationalError:
        return None


def initial_qixiang_key_rotation_proof() -> sqlite3.Row | None:
    """Return the CLI proof that observed the provider's exact invalid-key result."""
    if not qixiang_key_fingerprints_distinct():
        return None
    try:
        with db_connect() as connection:
            return connection.execute(
                """SELECT * FROM qixiang_key_rotation_evidence
                   WHERE pid=? AND active_key_sha256=? AND retired_key_sha256=?
                     AND verification_source='rotation_cli_exact_invalid_key'
                   ORDER BY provider_verified_at ASC,id ASC LIMIT 1""",
                (QIXIANG_PID, current_qixiang_key_sha256(), QIXIANG_RETIRED_KEY_SHA256),
            ).fetchone()
    except sqlite3.OperationalError:
        return None


def qixiang_key_rotation_ready() -> bool:
    """Require a fresh live merchant query plus provider revocation evidence."""
    evidence = latest_qixiang_key_rotation_evidence()
    initial_proof = initial_qixiang_key_rotation_proof()
    if (
        not evidence
        or not initial_proof
        or not bool(evidence["provider_active"])
        or not bool(initial_proof["provider_active"])
    ):
        return False
    verified_at = parse_evidence_timestamp(evidence["provider_verified_at"])
    revoked_at = parse_evidence_timestamp(evidence["old_key_revoked_at"])
    if not verified_at or not revoked_at or not str(evidence["revocation_reference"] or "").strip():
        return False
    moment = datetime.now(timezone.utc)
    age = (moment - verified_at).total_seconds()
    return (
        -60 <= age <= QIXIANG_CREDENTIAL_EVIDENCE_MAX_AGE_SECONDS
        and revoked_at <= moment + timedelta(seconds=60)
    )


def normalized_old_key_revoked_at(value: object) -> str:
    parsed = parse_evidence_timestamp(value)
    if not parsed:
        raise ApiError(422, "旧 Key 撤销时间必须包含有效时区", "invalid_key_revocation_time")
    if parsed > datetime.now(timezone.utc) + timedelta(seconds=60):
        raise ApiError(422, "旧 Key 撤销时间不能晚于当前时间", "invalid_key_revocation_time")
    return parsed.replace(microsecond=0).isoformat()


def record_qixiang_key_rotation_evidence(
    *,
    merchant: dict,
    old_key_revoked_at: str,
    revocation_reference: str,
    verification_source: str,
    verified_by: str | None,
) -> sqlite3.Row:
    if not qixiang_key_fingerprints_distinct():
        raise ApiError(
            409,
            "运行时 Key 尚未与已退役 Key 区分，不能登记换发证据",
            "qixiang_key_rotation_not_completed",
        )
    if str(merchant.get("pid") or "") != QIXIANG_PID or not bool(merchant.get("active")):
        raise ApiError(409, "七相新 Key 商户验证未通过", "qixiang_new_key_not_verified")
    revoked_at = normalized_old_key_revoked_at(old_key_revoked_at)
    reference = clean_text(revocation_reference, "七相旧 Key 撤销凭证", 8, 200)
    if verification_source not in (
        "rotation_cli_exact_invalid_key",
        "admin_live_query",
        "scheduled_live_query",
    ):
        raise ApiError(422, "Key 换发验证来源无效", "invalid_key_rotation_source")
    if (
        verification_source == "rotation_cli_exact_invalid_key"
        and verified_by != "system:qixiang-key-rotation-cli"
    ):
        raise ApiError(403, "初始 Key 换发证据来源无效", "invalid_key_rotation_proof_actor")
    created = now_iso()
    evidence_id = uid("qkx")
    with db_connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            """INSERT INTO qixiang_key_rotation_evidence(
                 id,pid,active_key_sha256,retired_key_sha256,provider_active,
                 provider_orders,provider_orders_today,provider_verified_at,
                 old_key_revoked_at,revocation_reference,verification_source,
                 verified_by,created_at
               ) VALUES(?,?,?,?,1,?,?,?,?,?,?,?,?)""",
            (
                evidence_id,
                QIXIANG_PID,
                current_qixiang_key_sha256(),
                QIXIANG_RETIRED_KEY_SHA256,
                int(merchant.get("orders") or 0),
                int(merchant.get("orders_today") or 0),
                created,
                revoked_at,
                reference,
                verification_source,
                verified_by,
                created,
            ),
        )
        connection.execute(
            """INSERT INTO qixiang_credential_refresh_state(
                 state_key,pid,active_key_sha256,next_attempt_epoch,
                 consecutive_failures,last_error_code,last_attempt_at,updated_at
               ) VALUES('active',?,?,?,0,NULL,?,?)
               ON CONFLICT(state_key) DO UPDATE SET
                 pid=excluded.pid,
                 active_key_sha256=excluded.active_key_sha256,
                 next_attempt_epoch=excluded.next_attempt_epoch,
                 consecutive_failures=0,
                 last_error_code=NULL,
                 last_attempt_at=excluded.last_attempt_at,
                 updated_at=excluded.updated_at""",
            (
                QIXIANG_PID,
                current_qixiang_key_sha256(),
                int(time.time()) + QIXIANG_CREDENTIAL_REFRESH_SECONDS,
                created,
                created,
            ),
        )
        if verification_source in ("rotation_cli_exact_invalid_key", "admin_live_query"):
            audit(
                connection,
                verified_by if str(verified_by or "").startswith("usr_") else None,
                "payment_gateway",
                "qixiang",
                "payment_gateway.key_rotated",
                {
                    "pid_hash": hashlib.sha256(QIXIANG_PID.encode("utf-8")).hexdigest(),
                    "active_key_sha256": current_qixiang_key_sha256(),
                    "retired_key_sha256": QIXIANG_RETIRED_KEY_SHA256,
                    "revocation_reference": reference,
                    "provider_verified_at": created,
                    "old_key_revoked_at": revoked_at,
                    "verification_source": verification_source,
                    "verified_by": verified_by,
                    "active": True,
                },
            )
        evidence = connection.execute(
            "SELECT * FROM qixiang_key_rotation_evidence WHERE id=?", (evidence_id,)
        ).fetchone()
        connection.execute("COMMIT")
        return evidence


def payment_readiness(provider: str) -> dict:
    if PAYMENT_GATEWAY == "qixiang":
        checks = {
            "七相支付商户号 PID": QIXIANG_PID == QIXIANG_PRODUCTION_PID,
            "七相支付商户密钥 KEY": bool(QIXIANG_KEY),
            "七相支付官方 HTTPS 统一下单地址": (
                QIXIANG_MAPI_URL == QIXIANG_PRODUCTION_MAPI_URL
                and not QIXIANG_ALLOW_INSECURE_HTTP
            ),
            "七相支付官方 HTTPS 查单/退款地址": (
                QIXIANG_API_URL == QIXIANG_PRODUCTION_API_URL
                and not QIXIANG_ALLOW_INSECURE_HTTP
            ),
            "七相支付官方收银台域名": (
                QIXIANG_CHECKOUT_HOSTS == QIXIANG_PRODUCTION_CHECKOUT_HOSTS
            ),
            "CloudPay HTTPS 公网回调域名": PUBLIC_BASE_URL.startswith("https://"),
        }
        if PLATFORM_MODE == "marketplace":
            checks["平台型业务签约或持牌分账配置"] = (
                os.environ.get("KAI_QIXIANG_MARKETPLACE_MODE", "").strip().lower() == "enabled"
            )
        missing = [label for label, ready in checks.items() if not ready]
        creation_checks = {
            "七相 KEY 持有权与专用性已由运营方确认": QIXIANG_KEY_OWNERSHIP_CONFIRMED,
            "七相 KEY 已在披露后换发": qixiang_key_rotation_ready(),
            "App 域名与交易场景已在七相报备": QIXIANG_SCENE_REGISTERED,
        }
        creation_missing = missing + [
            label for label, ready in creation_checks.items() if not ready
        ]
        return {
            "provider": provider,
            "gateway": "qixiang",
            "configured": not missing,
            "creation_configured": not creation_missing,
            "refund_configured": (
                not missing
                and QIXIANG_KEY_OWNERSHIP_CONFIRMED
                and qixiang_key_rotation_ready()
                and QIXIANG_REFUND_ENABLED
            ),
            "missing": missing,
            "creation_missing": creation_missing,
            "channels": ["电脑/手机自适应收银台"],
        }
    if PAYMENT_GATEWAY != "adapter":
        return {
            "provider": provider,
            "gateway": PAYMENT_GATEWAY,
            "configured": False,
            "creation_configured": False,
            "refund_configured": False,
            "missing": ["受支持的支付网关配置"],
            "creation_missing": ["受支持的支付网关配置"],
            "channels": [],
        }
    prefix = f"KAI_{provider.upper()}"
    labels = {
        f"{prefix}_MERCHANT_ID": "商户号",
        f"{prefix}_ADAPTER_URL": "官方 SDK 支付适配服务",
        f"{prefix}_CALLBACK_SECRET": "适配服务回调密钥",
        f"{prefix}_MARKETPLACE_MODE": "子商户或持牌分账配置",
    }
    missing = [label for key, label in labels.items() if not os.environ.get(key, "").strip()]
    if PLATFORM_MODE == "marketplace" and os.environ.get(f"{prefix}_MARKETPLACE_MODE", "").strip().lower() != "enabled":
        if "子商户或持牌分账配置" not in missing:
            missing.append("子商户或持牌分账配置")
    adapter_url = os.environ.get(f"{prefix}_ADAPTER_URL", "").strip()
    if adapter_url and not adapter_url.startswith("https://"):
        missing.append("HTTPS 支付适配服务地址")
    if not PUBLIC_BASE_URL.startswith("https://"):
        missing.append("HTTPS 公网域名")
    configured = not missing
    return {
        "provider": provider,
        "gateway": "adapter",
        "configured": configured,
        "creation_configured": configured,
        "refund_configured": configured,
        "missing": missing,
        "creation_missing": missing,
        "channels": ["电脑网站支付", "手机网站支付"] if provider == "alipay" else ["Native 二维码", "H5 支付"],
    }


def release_compliance_checks() -> dict[str, bool]:
    classification_declared = INTERNET_SERVICE_CLASSIFICATION in (
        "non_commercial",
        "commercial",
    )
    return {
        "HTTPS 公网域名": PUBLIC_BASE_URL.startswith("https://"),
        "运营主体法定名称": bool(OPERATOR_LEGAL_NAME),
        "运营主体统一社会信用代码": bool(OPERATOR_CREDIT_CODE),
        "用户支持邮箱": bool(SUPPORT_EMAIL),
        "用户支持电话": bool(SUPPORT_PHONE),
        "ICP 备案号": bool(ICP_FILING),
        "APP 备案号": bool(APP_FILING),
        "互联网信息服务分类已明确": classification_declared,
        "互联网信息服务分类已审核": (
            classification_declared
            and INTERNET_SERVICE_CLASSIFICATION_STATUS == "approved"
        ),
    }


def release_compliance_ready() -> bool:
    return all(release_compliance_checks().values())


def integration_readiness() -> dict:
    marketplace_ready = PLATFORM_MODE == "marketplace"
    release_checks = {
        **release_compliance_checks(),
        "KAI Identity 统一登录": identity_readiness()["configured"],
        "支付宝真实支付通道": payment_readiness("alipay")["creation_configured"],
        "微信支付真实支付通道": payment_readiness("wechat")["creation_configured"],
    }
    return {
        "ok": True,
        "platform_mode": PLATFORM_MODE,
        "auth_provider": AUTH_PROVIDER,
        "marketplace_ready": marketplace_ready,
        "public_https": PUBLIC_BASE_URL.startswith("https://"),
        "identity": identity_readiness(),
        "sms": sms_readiness(),
        "payment": {
            "alipay": payment_readiness("alipay"),
            "wechat": payment_readiness("wechat"),
        },
        "payment_controls": {
            "create_enabled": PAYMENT_CREATE_ENABLED,
            "reconciliation_enabled": PAYMENT_RECONCILIATION_ENABLED,
            "refund_enabled": QIXIANG_REFUND_ENABLED,
        },
        "transaction_capabilities": {
            "supplier_review": True, "resource_verification": True, "server_listings": True,
            "reservation_expiry": True, "supplier_delivery": True, "dual_source_metering": True,
            "disputes_and_refunds": True, "settlement_ledger": True, "invoice_workflow": True,
            "supplier_card_hour_rebate": True,
            "gpu_token_rack": True, "swap_rfq": True, "account_deletion_request": True,
        },
        "app_release": {
            "app_name": APP_NAME,
            "ios_bundle_id": IOS_BUNDLE_ID,
            "android_package_id": ANDROID_PACKAGE_ID,
            "ready": all(release_checks.values()),
            "checks": release_checks,
            "blockers": [label for label, ready in release_checks.items() if not ready],
            "internet_service_classification": INTERNET_SERVICE_CLASSIFICATION or "unclassified",
            "internet_service_classification_status": INTERNET_SERVICE_CLASSIFICATION_STATUS,
        },
    }


def add_column_if_missing(connection: sqlite3.Connection, table: str, name: str, definition: str) -> None:
    columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})").fetchall()}
    if name not in columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")


def require_idempotency_key(headers) -> str:
    value = headers.get("Idempotency-Key", "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{12,120}", value):
        raise ApiError(422, "缺少有效幂等键", "invalid_idempotency_key")
    return value


def market_product(kind: str, product_id: str) -> dict:
    product = next((item for item in MARKET_PRODUCTS.get(kind, []) if item["id"] == product_id), None)
    if not product:
        raise ApiError(422, "行情产品不存在", "market_product_not_found")
    return product


def deterministic_ratio(seed: str) -> float:
    value = int(hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12], 16)
    return (value / float(0xFFFFFFFFFFFF)) * 2 - 1


def build_market_candles(kind: str, product_id: str, region_id: str,
                         interval: str, limit: int = 72) -> dict:
    if kind not in MARKET_PRODUCTS:
        raise ApiError(422, "行情类型无效", "invalid_market_kind")
    if region_id not in MARKET_REGIONS:
        raise ApiError(422, "行情地区无效", "invalid_market_region")
    if interval not in MARKET_INTERVALS:
        raise ApiError(422, "K 线周期无效", "invalid_market_interval")
    product = market_product(kind, product_id)
    region_name, region_factor = MARKET_REGIONS[region_id]
    seconds = MARKET_INTERVALS[interval]
    limit = max(24, min(limit, 120))
    current_bucket = int(time.time()) // seconds * seconds
    base = float(product["base"]) * region_factor
    source = "platform_reference"
    if kind == "gpu":
        with db_connect() as connection:
            rows = connection.execute(
                "SELECT unit_price_cents FROM listings WHERE status='active' AND gpu=? AND region=? AND valid_from<=? AND valid_until>?",
                (product_id, region_name, now_iso(), now_iso()),
            ).fetchall()
        if rows:
            base = sum(row["unit_price_cents"] for row in rows) / len(rows) / 100
            source = "verified_listing"

    volatility = {"gpu": .010, "token": .016, "rack": .005, "server": .008}[kind]
    volume_base = {"gpu": 480, "token": 1800, "rack": 12, "server": 96}[kind]
    candles = []
    previous_close = base * (1 + deterministic_ratio(f"{kind}|{product_id}|{region_id}|start") * volatility)
    for offset in range(limit - 1, -1, -1):
        stamp = current_bucket - offset * seconds
        cycle = deterministic_ratio(f"cycle|{product_id}|{region_id}|{stamp // (seconds * 12)}") * volatility * .7
        move = deterministic_ratio(f"close|{kind}|{product_id}|{region_id}|{stamp}") * volatility
        open_price = previous_close
        close_price = max(base * .6, open_price * (1 + move + cycle * .12))
        wick_up = abs(deterministic_ratio(f"high|{kind}|{product_id}|{stamp}")) * volatility * .8
        wick_down = abs(deterministic_ratio(f"low|{kind}|{product_id}|{stamp}")) * volatility * .8
        high_price = max(open_price, close_price) * (1 + wick_up)
        low_price = min(open_price, close_price) * (1 - wick_down)
        volume = volume_base * (1 + abs(move) / volatility * 1.8) * (1 + abs(cycle) / volatility)
        candles.append({
            "time": stamp,
            "open": round(open_price, 4), "high": round(high_price, 4),
            "low": round(low_price, 4), "close": round(close_price, 4),
            "volume": round(volume, 2),
        })
        previous_close = close_price

    if candles:
        live = candles[-1]
        progress = (time.time() - current_bucket) / seconds
        direction = deterministic_ratio(f"live|{kind}|{product_id}|{region_id}|{current_bucket}") * volatility
        live_close = live["open"] * (1 + direction * progress)
        live["close"] = round(live_close, 4)
        live["high"] = round(max(live["open"], live_close) * (1 + abs(direction) * .18), 4)
        live["low"] = round(min(live["open"], live_close) * (1 - abs(direction) * .14), 4)
        live["volume"] = round(live["volume"] * max(.08, progress), 2)

    return {
        "ok": True, "kind": kind, "product": {key: product[key] for key in ("id", "name", "unit")},
        "region": {"id": region_id, "name": region_name}, "interval": interval,
        "source": source, "reference_only": True, "candles": candles,
        "updated_at": now_iso(),
        "notice": "平台报价参考盘，展示同口径报价变化，不代表外部交易所成交价；订单执行价以服务端库存、有效期和双方确认为准。",
        "options": {
            "products": {key: [{"id": item["id"], "name": item["name"], "unit": item["unit"]} for item in value]
                         for key, value in MARKET_PRODUCTS.items()},
            "regions": [{"id": key, "name": value[0]} for key, value in MARKET_REGIONS.items()],
            "intervals": list(MARKET_INTERVALS.keys()),
        },
    }


APP_MARKET_KIND_MAP = {"gpu": "gpu", "cabinet": "rack", "token": "token", "server": "server"}
APP_MARKET_RANGES = {
    ("1d", "15m"): 96,
    ("7d", "4h"): 42,
    ("30d", "1d"): 30,
}


def app_market_instrument_id(kind: str, product_id: str, region_id: str) -> str:
    return f"{kind}:{product_id}:{region_id}"


def parse_app_market_instrument(value: str) -> tuple[str, str, str]:
    parts = str(value or "").split(":")
    if len(parts) != 3:
        raise ApiError(422, "行情产品标识无效", "invalid_market_instrument")
    kind, product_id, region_id = parts
    market_product(kind, product_id)
    if region_id not in MARKET_REGIONS:
        raise ApiError(422, "行情地区无效", "invalid_market_region")
    return kind, product_id, region_id


def app_market_dimensions(kind: str, product: dict, region_id: str) -> dict:
    dimensions = {
        "product": product["id"],
        "region": MARKET_REGIONS[region_id][0],
        "priceType": "平台参考价",
        "currency": "CNY",
    }
    if kind == "token":
        dimensions.update({
            "provider": "KAI 网关",
            "model": product["name"].split(" · ")[0],
            "contextTier": "32K",
            "usageType": "输入/缓存/输出组合用量",
        })
    elif kind == "rack":
        dimensions.update({"contractTerm": "月", "powerIncluded": "以具体报价为准"})
    elif kind == "server":
        dimensions.update({"billingUnit": "整机时", "networkAndStorage": "以具体报价为准"})
    else:
        dimensions.update({"billingUnit": product.get("billing_unit", "单卡时"), "offerType": "产品目录参考"})
    return dimensions


def app_market_instruments(category: str) -> dict:
    kind = APP_MARKET_KIND_MAP.get(category)
    if not kind:
        raise ApiError(422, "行情类型无效", "invalid_market_category")
    items = []
    for product in MARKET_PRODUCTS[kind]:
        for region_id, (region_name, _) in MARKET_REGIONS.items():
            payload = build_market_candles(kind, product["id"], region_id, "1h", 24)
            candles = payload["candles"]
            first = candles[0]
            last = candles[-1]
            source = payload["source"]
            items.append({
                "instrumentId": app_market_instrument_id(kind, product["id"], region_id),
                "category": category,
                "displayName": product["name"],
                "subtitle": product["unit"],
                "region": region_name,
                "unit": product["unit"].replace(" / ", "/"),
                "currency": "CNY",
                "priceFen": max(1, round(last["close"] * 100)),
                "lowFen": max(1, round(min(item["low"] for item in candles) * 100)),
                "highFen": max(1, round(max(item["high"] for item in candles) * 100)),
                "changeBps": round((last["close"] / first["open"] - 1) * 10000) if first["open"] else 0,
                "quoteCount": len(candles),
                "pointCount": len(candles),
                "observedAt": payload["updated_at"],
                "sourceLabel": "已验真挂牌" if source == "verified_listing" else "平台参考盘",
                "sourceUrl": None,
                "dataMode": "live" if source == "verified_listing" else "demo",
                "dimensions": app_market_dimensions(kind, product, region_id),
            })
    return {"ok": True, "items": items}


def app_market_candles(instrument_id: str, range_id: str, interval: str) -> dict:
    kind, product_id, region_id = parse_app_market_instrument(instrument_id)
    limit = APP_MARKET_RANGES.get((range_id, interval))
    if not limit:
        raise ApiError(422, "行情时间范围与周期不匹配", "invalid_market_period")
    payload = build_market_candles(kind, product_id, region_id, interval, limit)
    seconds = MARKET_INTERVALS[interval]
    return {
        "ok": True,
        "items": [{
            "startAt": datetime.fromtimestamp(item["time"], timezone.utc).isoformat(),
            "endAt": datetime.fromtimestamp(item["time"] + seconds, timezone.utc).isoformat(),
            "openFen": max(1, round(item["open"] * 100)),
            "highFen": max(1, round(item["high"] * 100)),
            "lowFen": max(1, round(item["low"] * 100)),
            "closeFen": max(1, round(item["close"] * 100)),
            "quoteCount": max(1, round(item["volume"])),
        } for item in payload["candles"]],
        "source": payload["source"],
        "referenceOnly": payload["reference_only"],
        "notice": payload["notice"],
    }


def app_market_status() -> dict:
    with db_connect() as connection:
        verified_count = connection.execute(
            "SELECT COUNT(*) AS total FROM listings WHERE status='active'"
        ).fetchone()["total"]
    instrument_count = sum(len(products) * len(MARKET_REGIONS) for products in MARKET_PRODUCTS.values())
    return {
        "ok": True,
        "configured": True,
        "pointCount": instrument_count * 24,
        "instrumentCount": instrument_count,
        "dataMode": "live" if verified_count else "demo",
        "lastSync": {"finishedAt": now_iso(), "records": verified_count},
    }


def send_verification_message(phone: str, code: str) -> str:
    readiness = sms_readiness()
    if not readiness["configured"]:
        raise ApiError(503, "短信验证码通道尚未配置完成", "sms_provider_not_configured")
    if SMS_PROVIDER == "mock" and ALLOW_DEMO:
        return uid("smsmock")
    try:
        from alibabacloud_dysmsapi20170525.client import Client as DysmsClient
        from alibabacloud_dysmsapi20170525 import models as sms_models
        from alibabacloud_tea_openapi import models as open_api_models
        from alibabacloud_tea_util import models as util_models

        config = open_api_models.Config(
            access_key_id=os.environ["ALIBABA_CLOUD_ACCESS_KEY_ID"],
            access_key_secret=os.environ["ALIBABA_CLOUD_ACCESS_KEY_SECRET"],
        )
        config.endpoint = "dysmsapi.aliyuncs.com"
        client = DysmsClient(config)
        request = sms_models.SendSmsRequest(
            phone_numbers=phone,
            sign_name=os.environ["KAI_SMS_SIGN_NAME"],
            template_code=os.environ["KAI_SMS_TEMPLATE_CODE"],
            template_param=json.dumps({"code": code}, separators=(",", ":")),
        )
        response = client.send_sms_with_options(request, util_models.RuntimeOptions())
        body = response.body
        if str(getattr(body, "code", "")) != "OK":
            raise ApiError(502, "短信服务未接受本次发送请求", "sms_provider_rejected")
        return str(getattr(body, "biz_id", "") or getattr(body, "request_id", "") or uid("sms"))
    except ApiError:
        raise
    except Exception as error:
        print(f"SMS provider error: {type(error).__name__}")
        raise ApiError(502, "短信验证码发送失败，请稍后重试", "sms_delivery_failed")


def verify_adapter_response(body: bytes, signature: str, secret: str) -> None:
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature or ""):
        raise ApiError(502, "支付适配服务响应签名无效", "invalid_adapter_response_signature")


def request_provider_checkout(provider: str, payment_id: str, order: sqlite3.Row,
                              channel: str, client_ip: str,
                              client_surface: str = "web") -> dict:
    readiness = payment_readiness(provider)
    if not readiness["configured"]:
        raise ApiError(503, f"{provider} 支付通道尚未配置完成", "payment_provider_not_configured")
    if PAYMENT_GATEWAY == "qixiang":
        app_checkout = client_surface == "app"
        try:
            return qixiang_create_checkout(
                qixiang_config(),
                payment_type="alipay" if provider == "alipay" else "wxpay",
                out_trade_no=payment_id,
                notify_url=f"{PUBLIC_BASE_URL}/api/payments/callback/qixiang",
                return_url=(
                    f"{PUBLIC_BASE_URL}/api/payments/return/qixiang/app"
                    if app_checkout
                    else f"{PUBLIC_BASE_URL}/api/payments/return/qixiang"
                ),
                subject=f"KAI Cloud 算力订单 {order['order_no']}",
                amount_cents=int(order["amount_cents"]),
                client_ip=client_ip,
                device="mobile" if app_checkout else "jump",
                param=order["id"],
            )
        except QixiangPayError as error:
            print(f"QixiangPay checkout error: {error.code}")
            raise ApiError(502, str(error), error.code)
    prefix = f"KAI_{provider.upper()}"
    payload = {
        "event_id": uid("checkout"),
        "payment_id": payment_id,
        "order_id": order["id"],
        "order_no": order["order_no"],
        "subject": f"KAI Cloud 算力订单 {order['order_no']}",
        "amount_cents": order["amount_cents"],
        "currency": "CNY",
        "merchant_id": os.environ[f"{prefix}_MERCHANT_ID"],
        "channel": channel,
        "notify_url": f"{PUBLIC_BASE_URL}/api/payments/callback/{provider}",
        "return_url": f"{PUBLIC_BASE_URL}/?payment_return={order['order_no']}",
    }
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    secret = os.environ[f"{prefix}_CALLBACK_SECRET"]
    signature = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    request = Request(
        os.environ[f"{prefix}_ADAPTER_URL"], data=body, method="POST",
        headers={
            "Content-Type": "application/json", "X-KAI-Gateway-Signature": signature,
            "Idempotency-Key": payload["event_id"],
        },
    )
    try:
        with urlopen(request, timeout=12) as response:
            response_body = response.read(MAX_BODY)
            verify_adapter_response(
                response_body, response.headers.get("X-KAI-Adapter-Signature", ""), secret,
            )
            result = json.loads(response_body.decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as error:
        print(f"Payment adapter error ({provider}): {type(error).__name__}")
        raise ApiError(502, "支付机构收银台暂时不可用，请稍后重试", "payment_checkout_unavailable")
    checkout_url = str(result.get("checkout_url") or "").strip()
    parsed = urlparse(checkout_url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ApiError(502, "支付机构返回了无效的收银台地址", "invalid_checkout_url")
    return {
        "checkout_url": checkout_url,
        "trade_no": str(result.get("provider_txn_id") or result.get("trade_no") or "").strip(),
        "raw_code": str(result.get("status") or "ACCEPTED"),
    }


def request_provider_refund(provider: str, refund: sqlite3.Row, order: sqlite3.Row,
                            payment: sqlite3.Row | None = None) -> dict:
    readiness = payment_readiness(provider)
    if not readiness["configured"]:
        raise ApiError(503, f"{provider} 退款通道尚未配置完成", "payment_provider_not_configured")
    if PAYMENT_GATEWAY == "qixiang":
        if not QIXIANG_REFUND_ENABLED:
            raise ApiError(503, "七相支付商户后台尚未开启退款 API", "refund_provider_not_enabled")
        if payment is None:
            with db_connect() as connection:
                payment = connection.execute(
                    "SELECT * FROM payments WHERE id=?", (refund["payment_id"],)
                ).fetchone()
        if not payment:
            raise ApiError(404, "原支付单不存在", "payment_not_found")
        try:
            provider_order = qixiang_query_order(
                qixiang_config(), out_trade_no=payment["id"]
            )
            if str(provider_order.get("status")) != "1":
                raise ApiError(409, "七相支付原订单尚未支付成功", "refund_original_not_paid")
            if qixiang_money_to_cents(provider_order.get("money")) != int(payment["amount_cents"]):
                raise ApiError(409, "七相支付原订单金额不匹配", "refund_original_amount_mismatch")
            return qixiang_refund_order(
                qixiang_config(),
                amount_cents=int(refund["amount_cents"]),
                trade_no=str(provider_order.get("trade_no") or payment["provider_txn_id"] or ""),
                out_trade_no=payment["id"],
            )
        except ApiError:
            raise
        except QixiangPayError as error:
            print(f"QixiangPay refund error: {error.code}")
            raise ApiError(502, str(error), error.code)
    prefix = f"KAI_{provider.upper()}"
    payload = {
        "event_id": uid("refund_request"), "refund_id": refund["id"], "order_id": order["id"],
        "order_no": order["order_no"], "amount_cents": refund["amount_cents"], "currency": "CNY",
        "merchant_id": os.environ[f"{prefix}_MERCHANT_ID"],
        "notify_url": f"{PUBLIC_BASE_URL}/api/payments/refund-callback/{provider}",
    }
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    secret = os.environ[f"{prefix}_CALLBACK_SECRET"]
    signature = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    request = Request(
        os.environ[f"{prefix}_ADAPTER_URL"].rstrip("/") + "/refund", data=body, method="POST",
        headers={
            "Content-Type": "application/json", "X-KAI-Gateway-Signature": signature,
            "Idempotency-Key": payload["event_id"],
        },
    )
    try:
        with urlopen(request, timeout=12) as response:
            response_body = response.read(MAX_BODY)
            verify_adapter_response(
                response_body, response.headers.get("X-KAI-Adapter-Signature", ""), secret,
            )
            result = json.loads(response_body.decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as error:
        print(f"Refund adapter error ({provider}): {type(error).__name__}")
        raise ApiError(502, "退款请求暂时无法提交，请稍后重试", "refund_adapter_unavailable")
    if str(result.get("status")) not in ("ACCEPTED", "PROCESSING", "SUCCESS"):
        raise ApiError(502, "支付机构未接受退款请求", "refund_provider_rejected")
    return result


def clean_text(value: object, field: str, minimum: int = 1, maximum: int = 160) -> str:
    text = str(value or "").strip()
    if len(text) < minimum or len(text) > maximum:
        raise ApiError(422, f"{field}长度不符合要求")
    return text


def parse_booking_datetime(value: object, field: str) -> datetime:
    raw = clean_text(value, field, 20, 40)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise ApiError(422, f"{field}格式无效", "invalid_booking_time")
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ApiError(422, f"{field}必须包含时区", "booking_timezone_required")
    return parsed.astimezone(timezone.utc).replace(microsecond=0)


def normalize_ssh_public_key(value: object) -> tuple[str, str]:
    raw = str(value or "").strip()
    if "\n" in raw or "\r" in raw or len(raw) > 12_000:
        raise ApiError(422, "SSH 公钥必须是单行 OpenSSH 公钥", "invalid_ssh_public_key")
    match = re.fullmatch(
        r"(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) ([A-Za-z0-9+/]+={0,3})(?: ([^\x00-\x1f]{1,120}))?",
        raw,
    )
    if not match:
        raise ApiError(422, "仅支持标准 OpenSSH 公钥（Ed25519、RSA 或 ECDSA）", "invalid_ssh_public_key")
    algorithm, encoded, comment = match.groups()
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        raise ApiError(422, "SSH 公钥编码无效", "invalid_ssh_public_key")
    if len(decoded) < 16 or len(decoded) > 8192:
        raise ApiError(422, "SSH 公钥长度无效", "invalid_ssh_public_key")
    if len(decoded) < 4:
        raise ApiError(422, "SSH 公钥内容无效", "invalid_ssh_public_key")
    name_length = int.from_bytes(decoded[:4], "big")
    embedded_algorithm = decoded[4:4 + name_length].decode("ascii", errors="ignore")
    if embedded_algorithm != algorithm:
        raise ApiError(422, "SSH 公钥算法与内容不一致", "invalid_ssh_public_key")
    normalized = f"{algorithm} {encoded}" + (f" {comment.strip()}" if comment else "")
    fingerprint = "SHA256:" + base64.b64encode(hashlib.sha256(decoded).digest()).decode("ascii").rstrip("=")
    return normalized, fingerprint


def mask_phone(phone: str) -> str:
    return f"{phone[:3]}****{phone[-4:]}" if len(phone) >= 7 else "****"


def mask_email(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    local, domain = email.split("@", 1)
    return f"{local[:1]}***@{domain}"


def decode_private_evidence(
    encoded: object,
    original_name: object,
    field: str,
    required: bool = True,
) -> dict | None:
    raw_value = str(encoded or "").strip()
    if not raw_value:
        if required:
            raise ApiError(422, f"请上传{field}", "evidence_required")
        return None
    if "," in raw_value and raw_value.lower().startswith("data:"):
        raw_value = raw_value.split(",", 1)[1]
    try:
        content = base64.b64decode(raw_value, validate=True)
    except (ValueError, TypeError):
        raise ApiError(422, f"{field}文件内容无效", "invalid_evidence_encoding")
    if not content or len(content) > MAX_EVIDENCE_BYTES:
        raise ApiError(413 if len(content) > MAX_EVIDENCE_BYTES else 422, f"{field}文件应小于 5MB", "evidence_too_large")
    if content.startswith(b"%PDF-"):
        mime, extension = "application/pdf", ".pdf"
    elif content.startswith(b"\x89PNG\r\n\x1a\n"):
        mime, extension = "image/png", ".png"
    elif content.startswith(b"\xff\xd8\xff"):
        mime, extension = "image/jpeg", ".jpg"
    else:
        raise ApiError(422, f"{field}仅支持 PDF、JPG 或 PNG", "unsupported_evidence_type")
    safe_name = str(original_name or f"{field}{extension}").replace("\\", "/").split("/")[-1].strip()
    safe_name = re.sub(r"[^0-9A-Za-z._\-\u4e00-\u9fff]", "_", safe_name)[:120] or f"{field}{extension}"
    return {
        "content": content,
        "file_name": safe_name,
        "mime": mime,
        "size": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "extension": extension,
    }


def store_private_evidence(evidence: dict, category: str) -> str:
    target_dir = (EVIDENCE_ROOT / category).resolve()
    if EVIDENCE_ROOT != target_dir and EVIDENCE_ROOT not in target_dir.parents:
        raise ApiError(500, "材料存储目录异常", "evidence_storage_error")
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{secrets.token_hex(24)}{evidence['extension']}"
    target.write_bytes(evidence["content"])
    return str(target)


def normalize_iso_time(value: object, field: str) -> str:
    text = clean_text(value, field, 10, 40)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise ApiError(422, f"{field}格式无效", "invalid_datetime")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone(timedelta(hours=8)))
    return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def public_user(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "account": row["account"],
        "role": row["role"],
        "enterprise_status": row["enterprise_status"],
        "lifecycle_status": row["lifecycle_status"] if "lifecycle_status" in row.keys() else "active",
        "must_change_password": bool(row["must_change_password"]) if "must_change_password" in row.keys() else False,
    }


def order_dict(row: sqlite3.Row) -> dict:
    try:
        raw_snapshot = json.loads(row["quote_snapshot_json"] or "{}")
    except (TypeError, json.JSONDecodeError):
        raw_snapshot = {}
    quote_snapshot = {
        "source": raw_snapshot.get("source"),
        "gpu": raw_snapshot.get("gpu"),
        "listing_version": raw_snapshot.get("listing_version"),
    }
    if isinstance(raw_snapshot.get("h100_configuration"), dict):
        allowed = {
            "service_mode", "service_mode_label", "gpu_memory_gb", "billing_factor",
            "service_hours", "billable_gpu_hours", "cpu_cores", "memory_gb", "storage",
            "storage_label", "environment", "environment_label", "operating_system",
            "start_at", "delivery_mode",
        }
        quote_snapshot["h100_configuration"] = {
            key: value for key, value in raw_snapshot["h100_configuration"].items() if key in allowed
        }
    if isinstance(raw_snapshot.get("environment_preflight"), dict):
        allowed = {
            "id", "task", "gpu", "delivery_mode", "template", "workspace_gb",
            "access_mode", "network_mode", "supplier_capability_required", "approved_supplier_capability_level",
        }
        quote_snapshot["environment_preflight"] = {
            key: value for key, value in raw_snapshot["environment_preflight"].items() if key in allowed
        }
    delivery = None
    if "delivery_task_status" in row.keys() and row["delivery_task_status"]:
        delivery = {
            "status": row["delivery_task_status"],
            "environment_preflight_id": row["delivery_environment_preflight_id"] if "delivery_environment_preflight_id" in row.keys() else None,
            "credential_reference": row["delivery_credential_reference"],
            "endpoint_summary": row["delivery_endpoint_summary"],
            "evidence_digest": row["delivery_evidence_digest"],
            "started_at": row["delivery_started_at"],
            "delivered_at": row["delivery_task_delivered_at"],
            "acceptance_due_at": row["delivery_task_acceptance_due_at"],
        }
    return {
        "id": row["id"],
        "order_no": row["order_no"],
        "listing_id": row["listing_id"],
        "gpu": row["gpu"],
        "kind": row["kind"] if "kind" in row.keys() else "gpu",
        "product_code": row["product_code"] if "product_code" in row.keys() else row["gpu"],
        "region": row["region"],
        "provider": row["provider"],
        "quantity": row["quantity"],
        "unit": row["unit"],
        "unit_price_cny": row["unit_price_cents"] / 100,
        "amount_cny": row["amount_cents"] / 100,
        "currency": row["currency"],
        "status": row["status"],
        "payment_provider": row["payment_provider"],
        "settlement_mode": row["settlement_mode"] if "settlement_mode" in row.keys() else "cash",
        "swap_id": row["swap_id"] if "swap_id" in row.keys() else None,
        "delivery_ref": row["delivery_ref"],
        "reservation_expires_at": row["reservation_expires_at"] if "reservation_expires_at" in row.keys() else None,
        "supplier_confirmed_at": row["supplier_confirmed_at"] if "supplier_confirmed_at" in row.keys() else None,
        "delivered_at": row["delivered_at"] if "delivered_at" in row.keys() else None,
        "accepted_at": row["accepted_at"] if "accepted_at" in row.keys() else None,
        "acceptance_due_at": row["acceptance_due_at"] if "acceptance_due_at" in row.keys() else None,
        "quote_snapshot": quote_snapshot,
        "service_configuration": quote_snapshot.get("h100_configuration"),
        "environment_preflight": quote_snapshot.get("environment_preflight"),
        "delivery": delivery,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def access_request_dict(row: sqlite3.Row, admin: bool = False) -> dict:
    keys = set(row.keys())
    status = row["status"]
    item = {
        "id": row["id"],
        "order_id": row["order_id"],
        "allocation_id": row["allocation_id"],
        "listing_id": row["listing_id"],
        "product_code": row["product_code"] if "product_code" in keys else None,
        "gpu": row["gpu"] if "gpu" in keys else None,
        "region": row["region"] if "region" in keys else None,
        "requested_hours": row["requested_hours"],
        "unit": row["unit"],
        "booking_start_at": row["booking_start_at"],
        "booking_end_at": row["booking_end_at"],
        "status": status,
        "contact_name": row["contact_name"],
        "contact_phone_masked": mask_phone(row["contact_phone"]),
        "contact_email_masked": mask_email(row["contact_email"]),
        "ssh_key_fingerprint": row["ssh_key_fingerprint"],
        "admin_note": row["admin_note"],
        "reviewed_at": row["reviewed_at"],
        "activated_at": row["activated_at"],
        "completed_at": row["completed_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
    if status in ("ready", "completed"):
        item["connection"] = {
            "management_url": row["management_url"],
            "ssh_host": row["ssh_host"],
            "ssh_port": row["ssh_port"],
            "ssh_user": row["ssh_user"],
        }
    if admin:
        item.update({
            "owner_user_id": row["owner_user_id"],
            "buyer_name": row["buyer_name"] if "buyer_name" in keys else None,
            "buyer_account": row["buyer_account"] if "buyer_account" in keys else None,
            "contact_phone": row["contact_phone"],
            "contact_email": row["contact_email"],
            "ssh_public_key": row["ssh_public_key"],
            "management_url": row["management_url"],
            "ssh_host": row["ssh_host"],
            "ssh_port": row["ssh_port"],
            "ssh_user": row["ssh_user"],
            "reviewer_user_id": row["reviewer_user_id"],
        })
    return item


def environment_preflight_dict(row: sqlite3.Row) -> dict:
    try:
        checks = json.loads(row["compatibility_json"] or "[]")
    except (TypeError, json.JSONDecodeError):
        checks = []
    try:
        reasons = json.loads(row["decision_reasons_json"] or "[]")
    except (TypeError, json.JSONDecodeError):
        reasons = []
    expires_at = row["expires_at"]
    approved = row["status"] == "approved" and bool(expires_at and expires_at > now_iso())
    workspace_gb = int(row["workspace_gb"] or 0)
    mode = row["delivery_mode"]
    template = row["template"]
    access_mode = row["access_mode"]
    network_mode = row["network_mode"]
    return {
        "id": row["id"],
        "status": row["status"],
        "decision": row["decision"],
        "decision_reasons": reasons,
        "checks": checks,
        "supplier_capability_required": row["supplier_capability_required"],
        "approved_supplier_capability_level": row["approved_supplier_capability_level"],
        "order_creation_allowed": approved,
        "billing_allowed": False,
        "billing_rule": "环境交付并通过采购方验收后开始计量",
        "review_note": row["review_note"],
        "order_id": row["order_id"],
        "spec": {
            "task": row["task"],
            "gpu": row["gpu"],
            "delivery_mode": mode,
            "delivery_mode_label": ENVIRONMENT_DELIVERY_MODES.get(mode, {}).get("label", mode),
            "template": template,
            "template_label": ENVIRONMENT_TEMPLATES.get(template, template),
            "image_reference": row["image_reference"],
            "workspace_gb": workspace_gb,
            "access_mode": access_mode,
            "access_mode_label": ENVIRONMENT_ACCESS_MODES.get(access_mode, access_mode),
            "network_mode": network_mode,
            "network_mode_label": ENVIRONMENT_NETWORK_MODES.get(network_mode, network_mode),
            "api_model": row["api_model"] if "api_model" in row.keys() else None,
            "api_runtime": row["api_runtime"] if "api_runtime" in row.keys() else None,
            "api_runtime_label": ENVIRONMENT_API_RUNTIMES.get(row["api_runtime"], row["api_runtime"]) if "api_runtime" in row.keys() and row["api_runtime"] else None,
            "api_context_tokens": int(row["api_context_tokens"] or 0) if "api_context_tokens" in row.keys() else 0,
            "api_concurrency": int(row["api_concurrency"] or 0) if "api_concurrency" in row.keys() else 0,
            "api_rate_limit_rpm": int(row["api_rate_limit_rpm"] or 0) if "api_rate_limit_rpm" in row.keys() else 0,
            "api_token_quota_millions": int(row["api_token_quota_millions"] or 0) if "api_token_quota_millions" in row.keys() else 0,
        },
        "expires_at": expires_at,
        "reviewed_at": row["reviewed_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


class ApiError(Exception):
    def __init__(self, status: int, message: str, code: str = "request_error"):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code


OCI_IMAGE_REFERENCE = re.compile(
    r"^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?/)?"
    r"(?:[a-z0-9]+(?:[._-][a-z0-9]+)*/)*"
    r"[a-z0-9]+(?:[._-][a-z0-9]+)*"
    r"(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[a-fA-F0-9]{64})$"
)


def normalized_environment_spec(raw: object, enterprise_status: str) -> tuple[dict, str, list[dict], list[str]]:
    data = raw if isinstance(raw, dict) else {}
    task = clean_text(data.get("task") or "training", "任务类型", 3, 24)
    if task not in ("inference", "training", "finetune"):
        raise ApiError(422, "任务类型无效", "invalid_environment_task")
    gpu = clean_text(data.get("gpu"), "GPU 型号", 2, 32).upper()
    mode = clean_text(data.get("delivery_mode"), "交付方式", 3, 24)
    if mode not in ENVIRONMENT_DELIVERY_MODES:
        raise ApiError(422, "环境交付方式无效", "invalid_delivery_mode")
    if mode == "api" and task != "inference":
        raise ApiError(422, "推理 API 交付仅适用于在线推理任务", "delivery_mode_task_mismatch")

    template = clean_text(data.get("template") or "base", "环境模板", 3, 32)
    if template not in ENVIRONMENT_TEMPLATES:
        raise ApiError(422, "环境模板不在当前支持清单中", "unsupported_environment_template")
    workspace_label = clean_text(data.get("workspace") or "1TB", "持久工作区", 2, 16)
    if workspace_label == "custom":
        workspace_gb = 0
    elif workspace_label in ENVIRONMENT_WORKSPACE_OPTIONS:
        workspace_gb = ENVIRONMENT_WORKSPACE_OPTIONS[workspace_label]
    else:
        raise ApiError(422, "持久工作区规格无效", "invalid_workspace_size")
    if mode == "api":
        workspace_gb = 0

    access_mode = clean_text(data.get("access_mode") or ("api" if mode == "api" else "ssh"), "访问方式", 3, 24)
    network_mode = clean_text(data.get("network_mode") or "public", "网络方式", 3, 24)
    if access_mode not in ENVIRONMENT_ACCESS_MODES:
        raise ApiError(422, "访问方式无效", "invalid_access_mode")
    if network_mode not in ENVIRONMENT_NETWORK_MODES:
        raise ApiError(422, "网络方式无效", "invalid_network_mode")
    if mode == "api" and access_mode != "api":
        raise ApiError(422, "推理 API 必须使用令牌访问", "delivery_access_mismatch")

    api_model = None
    api_runtime = None
    api_context_tokens = 0
    api_concurrency = 0
    api_rate_limit_rpm = 0
    api_token_quota_millions = 0
    if mode == "api":
        api_model = clean_text(data.get("api_model"), "推理模型", 2, 120)
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/@+\-]{1,119}", api_model):
            raise ApiError(422, "推理模型标识只能包含字母、数字及 . _ : / @ + -", "invalid_api_model")
        api_runtime = clean_text(data.get("api_runtime") or "vllm", "推理运行时", 3, 24).lower()
        if api_runtime not in ENVIRONMENT_API_RUNTIMES:
            raise ApiError(422, "推理运行时不在当前支持清单中", "unsupported_api_runtime")
        try:
            api_context_tokens = int(32768 if data.get("api_context_tokens") in (None, "") else data["api_context_tokens"])
            api_concurrency = int(8 if data.get("api_concurrency") in (None, "") else data["api_concurrency"])
            api_rate_limit_rpm = int(120 if data.get("api_rate_limit_rpm") in (None, "") else data["api_rate_limit_rpm"])
            api_token_quota_millions = int(10 if data.get("api_token_quota_millions") in (None, "") else data["api_token_quota_millions"])
        except (TypeError, ValueError):
            raise ApiError(422, "API 配额参数必须是整数", "invalid_api_quota")
        if api_context_tokens not in ENVIRONMENT_API_CONTEXT_OPTIONS:
            raise ApiError(422, "上下文长度不在当前支持清单中", "unsupported_api_context")
        if not 1 <= api_concurrency <= 1024:
            raise ApiError(422, "并发数必须在 1 至 1024 之间", "invalid_api_concurrency")
        if not 1 <= api_rate_limit_rpm <= 100000:
            raise ApiError(422, "每分钟请求数必须在 1 至 100000 之间", "invalid_api_rate_limit")
        if not 1 <= api_token_quota_millions <= 1000000:
            raise ApiError(422, "Token 配额必须在 1 至 1000000 百万 Token 之间", "invalid_api_token_quota")

    image_reference = None
    if mode == "custom":
        image_reference = clean_text(data.get("image_reference"), "OCI 镜像引用", 3, 240)
        if "://" in image_reference or any(character.isspace() for character in image_reference) or not OCI_IMAGE_REFERENCE.fullmatch(image_reference):
            raise ApiError(422, "OCI 镜像引用格式无效；请勿提交仓库密码或带凭据 URL", "invalid_image_reference")

    reasons: list[str] = []
    checks: list[dict] = []

    def add_check(code: str, label: str, passed: bool, pending_reason: str | None = None) -> None:
        checks.append({"code": code, "label": label, "status": "passed" if passed else "pending"})
        if not passed and pending_reason:
            reasons.append(pending_reason)

    add_check("identity", "企业身份已核验", enterprise_status == "verified", "enterprise_verification_required")
    add_check("template", "模板在平台支持清单", mode != "custom", "image_scan_required")
    add_check("workspace", "持久工作区可自动配置", workspace_gb <= 2048 and workspace_label != "custom", "workspace_capacity_review_required")
    add_check("access", "访问策略可自动下发", access_mode in ("api", "ssh", "notebook"), "enterprise_sso_review_required")
    add_check("network", "网络策略可自动下发", network_mode == "public", "network_review_required")
    if mode == "api":
        add_check("api_model", "推理模型标识有效", bool(api_model))
        add_check("api_runtime", "推理运行时在支持清单", api_runtime in ENVIRONMENT_API_RUNTIMES)
        add_check("api_quota", "并发、限流与 Token 配额有效", api_concurrency > 0 and api_rate_limit_rpm > 0 and api_token_quota_millions > 0)
    if mode == "custom":
        checks.append({"code": "image_reference", "label": "OCI 镜像引用格式有效", "status": "passed"})
        checks.append({"code": "image_security", "label": "镜像漏洞、签名与 CUDA 兼容性扫描", "status": "pending"})
    if mode == "dedicated":
        checks.append({"code": "topology", "label": "GPU 拓扑、网络与 SLA 项目确认", "status": "pending"})
        reasons.append("dedicated_cluster_review_required")

    requires_review = bool(reasons) or mode in ("custom", "dedicated")
    status = "pending_review" if requires_review else "approved"
    spec = {
        "task": task, "gpu": gpu, "delivery_mode": mode, "template": template,
        "image_reference": image_reference, "workspace_gb": workspace_gb,
        "access_mode": access_mode, "network_mode": network_mode,
        "api_model": api_model, "api_runtime": api_runtime,
        "api_context_tokens": api_context_tokens, "api_concurrency": api_concurrency,
        "api_rate_limit_rpm": api_rate_limit_rpm,
        "api_token_quota_millions": api_token_quota_millions,
        "supplier_capability_required": ENVIRONMENT_DELIVERY_MODES[mode]["capability_level"],
    }
    return spec, status, checks, list(dict.fromkeys(reasons))


def approved_environment_preflight(connection: sqlite3.Connection, preflight_id: object,
                                   buyer_user_id: str, listing: sqlite3.Row) -> sqlite3.Row | None:
    if not preflight_id:
        return None
    clean_id = clean_text(preflight_id, "环境预检单", 4, 80)
    row = connection.execute("SELECT * FROM environment_preflights WHERE id=?", (clean_id,)).fetchone()
    if not row or row["buyer_user_id"] != buyer_user_id:
        raise ApiError(404, "环境预检单不存在", "environment_preflight_not_found")
    if row["status"] != "approved" or not row["expires_at"] or row["expires_at"] <= now_iso():
        raise ApiError(409, "环境预检尚未通过或已经失效，不能创建支付订单", "environment_preflight_not_approved")
    if row["order_id"]:
        raise ApiError(409, "环境预检单已绑定其他订单", "environment_preflight_already_used")
    if row["gpu"] != str(listing["gpu"]).upper():
        raise ApiError(409, "环境预检的 GPU 型号与当前挂牌不一致", "environment_preflight_gpu_mismatch")
    supplier = connection.execute(
        "SELECT u.supplier_capability_level FROM users u JOIN listings l ON l.supplier_user_id=u.id WHERE l.id=?",
        (listing["id"],),
    ).fetchone()
    supplier_level = supplier["supplier_capability_level"] if supplier else "L1"
    if not re.fullmatch(r"L[1-5]", supplier_level or "") or int(supplier_level[1]) < int(row["supplier_capability_required"][1]):
        raise ApiError(409, "当前挂牌供应商的环境交付能力不足，请选择符合等级的资源", "listing_supplier_capability_insufficient")
    return row


def normalized_order_snapshot(raw_snapshot: object, listing: sqlite3.Row, quantity: float) -> dict:
    raw = raw_snapshot if isinstance(raw_snapshot, dict) else {}
    try:
        listing_version = int(raw.get("listing_version") or listing["version"])
    except (TypeError, ValueError):
        raise ApiError(422, "挂牌版本无效", "invalid_listing_version")
    if listing_version != listing["version"]:
        raise ApiError(409, "报价已更新，请按最新价格重新确认", "listing_version_changed")
    snapshot = {
        "source": clean_text(raw.get("source") or "api_order", "报价来源", 3, 40),
        "gpu": listing["gpu"],
        "listing_version": listing_version,
    }
    if listing["kind"] != "gpu" or listing["gpu"] != "H100":
        return snapshot

    config = raw.get("h100_configuration") if isinstance(raw.get("h100_configuration"), dict) else {}
    mode = clean_text(config.get("service_mode") or "exclusive", "H100 使用模式", 3, 24)
    if mode not in H100_SERVICE_MODES:
        raise ApiError(422, "H100 使用模式无效", "invalid_h100_service_mode")
    try:
        cpu_cores = int(config.get("cpu_cores") or 32)
        memory_gb = int(config.get("memory_gb") or 128)
        service_hours = round(float(config.get("service_hours") or quantity), 3)
    except (TypeError, ValueError):
        raise ApiError(422, "H100 计算配置无效", "invalid_h100_configuration")
    if cpu_cores not in H100_CPU_OPTIONS or memory_gb not in H100_MEMORY_OPTIONS:
        raise ApiError(422, "H100 CPU 或内存配置无效", "invalid_h100_configuration")
    storage = clean_text(config.get("storage") or "nvme_1tb", "存储配置", 3, 24)
    environment = clean_text(config.get("environment") or "pytorch", "运行环境", 3, 32)
    if storage not in H100_STORAGE_OPTIONS or environment not in H100_ENVIRONMENT_OPTIONS:
        raise ApiError(422, "H100 存储或运行环境无效", "invalid_h100_configuration")
    if service_hours < 1 or service_hours > 8760:
        raise ApiError(422, "H100 服务时长应为 1 至 8760 小时", "invalid_h100_service_hours")
    billing_factor = H100_SERVICE_MODES[mode]["billing_factor"]
    expected_quantity = round(service_hours * billing_factor, 6)
    if abs(expected_quantity - quantity) > 0.001:
        raise ApiError(422, "H100 服务时长与计费容量不一致，请重新确认配置", "h100_quantity_mismatch")
    start_at = clean_text(config.get("start_at") or now_iso(), "计划开始时间", 10, 40)
    try:
        datetime.fromisoformat(start_at.replace("Z", "+00:00"))
    except ValueError:
        raise ApiError(422, "计划开始时间格式无效", "invalid_h100_start_at")
    snapshot["h100_configuration"] = {
        "service_mode": mode,
        "service_mode_label": H100_SERVICE_MODES[mode]["label"],
        "gpu_memory_gb": H100_SERVICE_MODES[mode]["gpu_memory_gb"],
        "billing_factor": billing_factor,
        "service_hours": service_hours,
        "billable_gpu_hours": expected_quantity,
        "cpu_cores": cpu_cores,
        "memory_gb": memory_gb,
        "storage": storage,
        "storage_label": H100_STORAGE_OPTIONS[storage],
        "environment": environment,
        "environment_label": H100_ENVIRONMENT_OPTIONS[environment],
        "operating_system": "Ubuntu",
        "start_at": start_at,
        "delivery_mode": "隔离实例 + 脱敏端点 + 一次性交付凭证",
    }
    return snapshot


def audit(connection: sqlite3.Connection, actor_user_id: str | None, aggregate: str,
          aggregate_id: str, event_type: str, payload: dict, idempotency_key: str | None = None,
          event_id: str | None = None) -> str:
    event_id = event_id or uid("evt")
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    connection.execute(
        "INSERT INTO audit_events(event_id,actor_user_id,aggregate_type,aggregate_id,event_type,payload_json,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?)",
        (event_id, actor_user_id, aggregate, aggregate_id, event_type, serialized, idempotency_key, now_iso()),
    )
    connection.execute(
        "INSERT INTO outbox(event_id,event_type,payload_json,status,attempts,created_at) VALUES(?,?,?,'pending',0,?)",
        (event_id, event_type, serialized, now_iso()),
    )
    return event_id


def initialize_database() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db_connect() as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users(
              id TEXT PRIMARY KEY, name TEXT NOT NULL, account TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'buyer',
              enterprise_status TEXT NOT NULL DEFAULT 'unverified',
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions(
              token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS external_identities(
              provider TEXT NOT NULL, subject TEXT NOT NULL,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              email TEXT, claims_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              PRIMARY KEY(provider,subject)
            );
            CREATE INDEX IF NOT EXISTS external_identities_user_idx
              ON external_identities(user_id);
            CREATE TABLE IF NOT EXISTS oidc_transactions(
              id TEXT PRIMARY KEY, state_hash TEXT NOT NULL UNIQUE, nonce TEXT NOT NULL,
              code_verifier TEXT NOT NULL, return_to TEXT NOT NULL,
              app_callback_uri TEXT NOT NULL DEFAULT 'cloudpay://auth/callback',
              expires_at TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS mobile_login_tickets(
              ticket_hash TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              app_nonce_hash TEXT NOT NULL,
              return_to TEXT NOT NULL,
              expires_at TEXT NOT NULL,
              consumed_at TEXT,
              last_session_token_hash TEXT,
              exchange_count INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS mobile_login_tickets_expiry_idx
              ON mobile_login_tickets(expires_at);
            CREATE TABLE IF NOT EXISTS mobile_login_preparations(
              handle_hash TEXT PRIMARY KEY,
              app_nonce_hash TEXT NOT NULL,
              login_hint TEXT,
              return_to TEXT NOT NULL,
              app_callback_uri TEXT NOT NULL DEFAULT 'cloudpay://auth/callback',
              expires_at TEXT NOT NULL,
              consumed_at TEXT,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS mobile_login_preparations_expiry_idx
              ON mobile_login_preparations(expires_at);
            CREATE TABLE IF NOT EXISTS phone_verifications(
              id TEXT PRIMARY KEY, phone TEXT NOT NULL, purpose TEXT NOT NULL,
              code_hash TEXT NOT NULL, provider TEXT NOT NULL, provider_request_id TEXT,
              status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
              max_attempts INTEGER NOT NULL, request_ip_hash TEXT NOT NULL,
              expires_at TEXT NOT NULL, sent_at TEXT NOT NULL, consumed_at TEXT,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS supplier_applications(
              id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), enterprise_name TEXT NOT NULL,
              credit_code TEXT NOT NULL, agent_name TEXT NOT NULL, status TEXT NOT NULL,
              review_due_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS listings(
              id TEXT PRIMARY KEY, supplier_user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
              product_code TEXT NOT NULL, gpu TEXT NOT NULL, provider TEXT NOT NULL, region TEXT NOT NULL,
              unit TEXT NOT NULL, unit_price_cents INTEGER NOT NULL,
              verified_quantity REAL NOT NULL, quote_reserved REAL NOT NULL DEFAULT 0,
              order_locked REAL NOT NULL DEFAULT 0, delivering REAL NOT NULL DEFAULT 0,
              consumed REAL NOT NULL DEFAULT 0, frozen REAL NOT NULL DEFAULT 0,
              status TEXT NOT NULL DEFAULT 'active', version INTEGER NOT NULL DEFAULT 1,
              valid_from TEXT NOT NULL, valid_until TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS compute_products(
              id TEXT PRIMARY KEY, gpu TEXT NOT NULL, display_name TEXT NOT NULL,
              gpu_count INTEGER NOT NULL, cpu_cores INTEGER NOT NULL, memory_gb INTEGER NOT NULL,
              hourly_price_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'CNY',
              billing_unit TEXT NOT NULL DEFAULT '配置时', status TEXT NOT NULL DEFAULT 'active',
              availability_status TEXT NOT NULL DEFAULT 'confirmation_required',
              source TEXT NOT NULL, linked_listing_id TEXT REFERENCES listings(id),
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS compute_product_requests(
              id TEXT PRIMARY KEY, buyer_user_id TEXT NOT NULL REFERENCES users(id),
              gpu TEXT NOT NULL, requested_gpu_count INTEGER NOT NULL, allocated_gpu_count INTEGER NOT NULL,
              duration_hours REAL NOT NULL, region TEXT NOT NULL, budget_cents INTEGER NOT NULL,
              estimated_amount_cents INTEGER NOT NULL, plan_json TEXT NOT NULL,
              status TEXT NOT NULL, idempotency_key TEXT NOT NULL,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              UNIQUE(buyer_user_id,idempotency_key)
            );
            CREATE TABLE IF NOT EXISTS orders(
              id TEXT PRIMARY KEY, order_no TEXT NOT NULL UNIQUE, buyer_user_id TEXT NOT NULL REFERENCES users(id),
              listing_id TEXT NOT NULL REFERENCES listings(id), gpu TEXT NOT NULL, region TEXT NOT NULL,
              provider TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL,
              unit_price_cents INTEGER NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL,
              status TEXT NOT NULL, payment_provider TEXT, delivery_ref TEXT,
              idempotency_key TEXT NOT NULL, quote_snapshot_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              UNIQUE(buyer_user_id,idempotency_key)
            );
            CREATE TABLE IF NOT EXISTS payments(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), provider TEXT NOT NULL,
              amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, merchant_id TEXT,
              provider_txn_id TEXT UNIQUE, status TEXT NOT NULL, callback_event_id TEXT UNIQUE,
              callback_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS allocations(
              id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id), order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
              listing_id TEXT NOT NULL REFERENCES listings(id), gpu TEXT NOT NULL, region TEXT NOT NULL,
              quantity REAL NOT NULL, unit TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS card_hour_topups(
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id),
              order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
              payment_id TEXT UNIQUE REFERENCES payments(id),
              package_code TEXT,
              amount_cents INTEGER NOT NULL,
              card_hours_micros INTEGER NOT NULL,
              status TEXT NOT NULL,
              idempotency_key TEXT NOT NULL,
              request_hash TEXT NOT NULL,
              credited_at TEXT,
              expires_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(user_id,idempotency_key)
            );
            CREATE INDEX IF NOT EXISTS card_hour_topups_user_created_idx
              ON card_hour_topups(user_id,created_at DESC);
            CREATE TABLE IF NOT EXISTS card_hour_lots(
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id),
              topup_id TEXT NOT NULL UNIQUE REFERENCES card_hour_topups(id),
              allocation_id TEXT NOT NULL UNIQUE REFERENCES allocations(id),
              original_micros INTEGER NOT NULL,
              available_micros INTEGER NOT NULL,
              status TEXT NOT NULL,
              expires_at TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS card_hour_lots_user_expiry_idx
              ON card_hour_lots(user_id,status,expires_at);
            CREATE TABLE IF NOT EXISTS card_hour_movements(
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id),
              lot_id TEXT REFERENCES card_hour_lots(id),
              topup_id TEXT REFERENCES card_hour_topups(id),
              movement_type TEXT NOT NULL,
              amount_micros INTEGER NOT NULL,
              balance_after_micros INTEGER NOT NULL,
              reference_type TEXT NOT NULL,
              reference_id TEXT NOT NULL,
              idempotency_key TEXT NOT NULL UNIQUE,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS card_hour_movements_user_created_idx
              ON card_hour_movements(user_id,created_at,id);
            CREATE TRIGGER IF NOT EXISTS card_hour_movements_append_only_update
              BEFORE UPDATE ON card_hour_movements
              BEGIN
                SELECT RAISE(ABORT, 'card_hour_movements_append_only');
              END;
            CREATE TRIGGER IF NOT EXISTS card_hour_movements_append_only_delete
              BEFORE DELETE ON card_hour_movements
              BEGIN
                SELECT RAISE(ABORT, 'card_hour_movements_append_only');
              END;
            CREATE TABLE IF NOT EXISTS payment_worker_state(
              worker_name TEXT PRIMARY KEY,
              last_started_at TEXT,
              last_success_at TEXT,
              last_error_code TEXT,
              consecutive_failures INTEGER NOT NULL DEFAULT 0,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS qixiang_key_rotation_evidence(
              id TEXT PRIMARY KEY,
              pid TEXT NOT NULL,
              active_key_sha256 TEXT NOT NULL,
              retired_key_sha256 TEXT NOT NULL,
              provider_active INTEGER NOT NULL,
              provider_orders INTEGER NOT NULL DEFAULT 0,
              provider_orders_today INTEGER NOT NULL DEFAULT 0,
              provider_verified_at TEXT NOT NULL,
              old_key_revoked_at TEXT NOT NULL,
              revocation_reference TEXT NOT NULL,
              verification_source TEXT NOT NULL,
              verified_by TEXT,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS qixiang_key_rotation_lookup_idx
              ON qixiang_key_rotation_evidence(
                pid,active_key_sha256,retired_key_sha256,provider_verified_at DESC
              );
            CREATE TRIGGER IF NOT EXISTS qixiang_key_rotation_evidence_append_only_update
              BEFORE UPDATE ON qixiang_key_rotation_evidence
              BEGIN
                SELECT RAISE(ABORT, 'qixiang_key_rotation_evidence_append_only');
              END;
            CREATE TRIGGER IF NOT EXISTS qixiang_key_rotation_evidence_append_only_delete
              BEFORE DELETE ON qixiang_key_rotation_evidence
              BEGIN
                SELECT RAISE(ABORT, 'qixiang_key_rotation_evidence_append_only');
              END;
            CREATE TABLE IF NOT EXISTS qixiang_credential_refresh_state(
              state_key TEXT PRIMARY KEY,
              pid TEXT,
              active_key_sha256 TEXT,
              next_attempt_epoch INTEGER NOT NULL DEFAULT 0,
              consecutive_failures INTEGER NOT NULL DEFAULT 0,
              last_error_code TEXT,
              last_attempt_at TEXT,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS qixiang_query_state(
              state_key TEXT PRIMARY KEY,
              window_started_epoch INTEGER NOT NULL,
              query_count INTEGER NOT NULL DEFAULT 0,
              consecutive_failures INTEGER NOT NULL DEFAULT 0,
              circuit_open_until_epoch INTEGER NOT NULL DEFAULT 0,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS qixiang_query_leases(
              payment_id TEXT PRIMARY KEY REFERENCES payments(id) ON DELETE CASCADE,
              lease_owner TEXT NOT NULL,
              lease_until_epoch INTEGER NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS qixiang_checkout_leases(
              payment_id TEXT PRIMARY KEY REFERENCES payments(id) ON DELETE CASCADE,
              lease_owner TEXT NOT NULL,
              lease_until_epoch INTEGER NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS payment_reconciliation_reviews(
              payment_id TEXT PRIMARY KEY REFERENCES payments(id) ON DELETE CASCADE,
              reason TEXT NOT NULL,
              provider_status TEXT,
              query_attempts INTEGER NOT NULL,
              status TEXT NOT NULL,
              version INTEGER NOT NULL DEFAULT 1,
              first_flagged_at TEXT NOT NULL,
              last_checked_at TEXT,
              acknowledged_at TEXT,
              acknowledged_by TEXT REFERENCES users(id),
              acknowledgement_reason TEXT,
              evidence_digest TEXT,
              resolution TEXT,
              resolved_at TEXT,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS payment_reconciliation_reviews_status_idx
              ON payment_reconciliation_reviews(status,updated_at);
            CREATE TABLE IF NOT EXISTS payment_reconciliation_review_actions(
              id TEXT PRIMARY KEY,
              payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
              action TEXT NOT NULL,
              actor_user_id TEXT NOT NULL REFERENCES users(id),
              reason TEXT NOT NULL,
              provider_status TEXT,
              evidence_digest TEXT,
              old_version INTEGER NOT NULL,
              new_version INTEGER NOT NULL,
              idempotency_key TEXT NOT NULL,
              request_hash TEXT NOT NULL,
              created_at TEXT NOT NULL,
              UNIQUE(actor_user_id,idempotency_key)
            );
            CREATE INDEX IF NOT EXISTS payment_reconciliation_review_actions_payment_idx
              ON payment_reconciliation_review_actions(payment_id,created_at);
            CREATE TRIGGER IF NOT EXISTS payment_reconciliation_review_actions_append_only_update
              BEFORE UPDATE ON payment_reconciliation_review_actions
              BEGIN SELECT RAISE(ABORT,'payment reconciliation actions are append-only'); END;
            CREATE TRIGGER IF NOT EXISTS payment_reconciliation_review_actions_append_only_delete
              BEFORE DELETE ON payment_reconciliation_review_actions
              BEGIN SELECT RAISE(ABORT,'payment reconciliation actions are append-only'); END;
            CREATE TABLE IF NOT EXISTS payment_reconciliation_commands(
              actor_user_id TEXT NOT NULL REFERENCES users(id),
              idempotency_key TEXT NOT NULL,
              payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
              action TEXT NOT NULL,
              request_hash TEXT NOT NULL,
              state TEXT NOT NULL,
              lease_token TEXT,
              lease_until_epoch INTEGER NOT NULL DEFAULT 0,
              response_status INTEGER,
              response_json TEXT,
              last_error_code TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY(actor_user_id,idempotency_key)
            );
            CREATE TRIGGER IF NOT EXISTS payment_reconciliation_commands_completed_immutable
              BEFORE UPDATE ON payment_reconciliation_commands
              WHEN OLD.state='completed'
              BEGIN SELECT RAISE(ABORT,'completed payment reconciliation commands are immutable'); END;
            CREATE TRIGGER IF NOT EXISTS payment_reconciliation_commands_completed_no_delete
              BEFORE DELETE ON payment_reconciliation_commands
              WHEN OLD.state='completed'
              BEGIN SELECT RAISE(ABORT,'completed payment reconciliation commands are immutable'); END;
            CREATE TABLE IF NOT EXISTS withdrawal_requests(
              id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id),
              allocation_id TEXT NOT NULL REFERENCES allocations(id), quantity REAL NOT NULL,
              unit TEXT NOT NULL, status TEXT NOT NULL, decision TEXT NOT NULL,
              idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              UNIQUE(owner_user_id,idempotency_key)
            );
            CREATE TABLE IF NOT EXISTS gpu_access_requests(
              id TEXT PRIMARY KEY,
              owner_user_id TEXT NOT NULL REFERENCES users(id),
              order_id TEXT NOT NULL REFERENCES orders(id),
              allocation_id TEXT NOT NULL REFERENCES allocations(id),
              listing_id TEXT NOT NULL REFERENCES listings(id),
              contact_name TEXT NOT NULL, contact_phone TEXT NOT NULL, contact_email TEXT,
              ssh_public_key TEXT NOT NULL, ssh_key_fingerprint TEXT NOT NULL,
              booking_start_at TEXT NOT NULL, booking_end_at TEXT NOT NULL,
              requested_hours REAL NOT NULL, unit TEXT NOT NULL,
              status TEXT NOT NULL, admin_note TEXT,
              management_url TEXT, ssh_host TEXT, ssh_port INTEGER, ssh_user TEXT,
              reviewer_user_id TEXT REFERENCES users(id), reviewed_at TEXT,
              activated_at TEXT, completed_at TEXT,
              idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              UNIQUE(owner_user_id,idempotency_key)
            );
            CREATE TABLE IF NOT EXISTS purchase_requests(
              id TEXT PRIMARY KEY, buyer_user_id TEXT NOT NULL REFERENCES users(id),
              product_code TEXT NOT NULL, region TEXT NOT NULL, service_mode TEXT NOT NULL,
              service_hours REAL NOT NULL, requested_gpu_hours REAL NOT NULL,
              cpu_cores INTEGER NOT NULL, memory_gb INTEGER NOT NULL,
              storage TEXT NOT NULL, environment TEXT NOT NULL, start_at TEXT NOT NULL,
              status TEXT NOT NULL, idempotency_key TEXT NOT NULL,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              UNIQUE(buyer_user_id,idempotency_key)
            );
            CREATE TABLE IF NOT EXISTS environment_preflights(
              id TEXT PRIMARY KEY, buyer_user_id TEXT NOT NULL REFERENCES users(id),
              task TEXT NOT NULL, gpu TEXT NOT NULL, delivery_mode TEXT NOT NULL,
              template TEXT NOT NULL, image_reference TEXT, workspace_gb INTEGER NOT NULL DEFAULT 0,
              access_mode TEXT NOT NULL, network_mode TEXT NOT NULL,
              api_model TEXT, api_runtime TEXT, api_context_tokens INTEGER NOT NULL DEFAULT 0,
              api_concurrency INTEGER NOT NULL DEFAULT 0, api_rate_limit_rpm INTEGER NOT NULL DEFAULT 0,
              api_token_quota_millions INTEGER NOT NULL DEFAULT 0,
              supplier_capability_required TEXT NOT NULL, approved_supplier_capability_level TEXT,
              compatibility_json TEXT NOT NULL DEFAULT '[]', decision TEXT NOT NULL,
              decision_reasons_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
              review_note TEXT, reviewer_user_id TEXT REFERENCES users(id), reviewed_at TEXT,
              expires_at TEXT NOT NULL, order_id TEXT UNIQUE REFERENCES orders(id),
              idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              UNIQUE(buyer_user_id,idempotency_key)
            );
            CREATE TABLE IF NOT EXISTS resource_intakes(
              id TEXT PRIMARY KEY, supplier_user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
              product_code TEXT NOT NULL, region TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL,
              status TEXT NOT NULL, evidence_summary TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit_events(
              sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
              actor_user_id TEXT, aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL,
              event_type TEXT NOT NULL, payload_json TEXT NOT NULL, idempotency_key TEXT,
              created_at TEXT NOT NULL
            );
            CREATE TRIGGER IF NOT EXISTS audit_events_append_only_update
              BEFORE UPDATE ON audit_events
              BEGIN SELECT RAISE(ABORT,'audit events are append-only'); END;
            CREATE TRIGGER IF NOT EXISTS audit_events_append_only_delete
              BEFORE DELETE ON audit_events
              BEGIN SELECT RAISE(ABORT,'audit events are append-only'); END;
            CREATE TABLE IF NOT EXISTS outbox(
              sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
              event_type TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL,
              attempts INTEGER NOT NULL, created_at TEXT NOT NULL, processed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS delivery_tasks(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
              supplier_user_id TEXT NOT NULL REFERENCES users(id),
              environment_preflight_id TEXT REFERENCES environment_preflights(id), status TEXT NOT NULL,
              credential_reference TEXT, endpoint_summary TEXT, evidence_digest TEXT,
              started_at TEXT, delivered_at TEXT, acceptance_due_at TEXT,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS metering_records(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
              source TEXT NOT NULL, resource_kind TEXT NOT NULL,
              started_at TEXT NOT NULL, ended_at TEXT NOT NULL, quantity REAL NOT NULL,
              performance_json TEXT NOT NULL DEFAULT '{}', evidence_digest TEXT NOT NULL,
              signature TEXT NOT NULL, status TEXT NOT NULL,
              created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
              UNIQUE(order_id,source,evidence_digest)
            );
            CREATE TABLE IF NOT EXISTS disputes(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
              opened_by TEXT NOT NULL REFERENCES users(id), category TEXT NOT NULL,
              reason TEXT NOT NULL, original_order_status TEXT NOT NULL, status TEXT NOT NULL,
              resolution TEXT, assigned_to TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS refunds(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
              payment_id TEXT NOT NULL REFERENCES payments(id), requester_user_id TEXT NOT NULL REFERENCES users(id),
              amount_cents INTEGER NOT NULL, reason TEXT NOT NULL, original_order_status TEXT NOT NULL,
              status TEXT NOT NULL, provider_ref TEXT, reviewer_user_id TEXT,
              idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              UNIQUE(requester_user_id,idempotency_key)
            );
            CREATE TABLE IF NOT EXISTS settlements(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
              supplier_user_id TEXT NOT NULL REFERENCES users(id), gross_cents INTEGER NOT NULL,
              platform_fee_cents INTEGER NOT NULL, supplier_net_cents INTEGER NOT NULL,
              currency TEXT NOT NULL, status TEXT NOT NULL, hold_until TEXT NOT NULL,
              payout_ref TEXT, paid_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS supplier_card_hour_rebates(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
              supplier_user_id TEXT NOT NULL REFERENCES users(id),
              listing_id TEXT NOT NULL REFERENCES listings(id), amount_cents INTEGER NOT NULL,
              source_card_hours_micros INTEGER NOT NULL, rebate_rate_bps INTEGER NOT NULL,
              rebate_card_hours_micros INTEGER NOT NULL, unit TEXT NOT NULL,
              status TEXT NOT NULL, pre_hold_status TEXT, review_required INTEGER NOT NULL DEFAULT 0,
              conversion_basis TEXT NOT NULL, synthetic_order_id TEXT REFERENCES orders(id),
              allocation_id TEXT REFERENCES allocations(id), reviewer_user_id TEXT REFERENCES users(id),
              submitted_by TEXT REFERENCES users(id), submission_band TEXT,
              transaction_summary TEXT, submitted_at TEXT,
              review_reason TEXT, reviewed_at TEXT, issued_at TEXT, reversed_at TEXT,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS invoice_requests(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
              requester_user_id TEXT NOT NULL REFERENCES users(id), invoice_title TEXT NOT NULL,
              tax_id TEXT NOT NULL, email TEXT NOT NULL, status TEXT NOT NULL,
              invoice_ref TEXT, issued_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS event_deliveries(
              id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE REFERENCES outbox(event_id),
              consumer TEXT NOT NULL, status TEXT NOT NULL, delivered_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS swap_requests(
              id TEXT PRIMARY KEY, requester_user_id TEXT NOT NULL REFERENCES users(id),
              source_allocation_id TEXT NOT NULL REFERENCES allocations(id),
              source_kind TEXT NOT NULL, source_product_code TEXT NOT NULL,
              source_quantity REAL NOT NULL, source_unit TEXT NOT NULL,
              target_kind TEXT NOT NULL, target_product_code TEXT NOT NULL, target_region TEXT NOT NULL,
              target_listing_id TEXT REFERENCES listings(id), target_quantity REAL,
              source_reference_cents INTEGER NOT NULL, target_reference_cents INTEGER,
              quote_snapshot_json TEXT NOT NULL DEFAULT '{}', quote_expires_at TEXT,
              target_order_id TEXT REFERENCES orders(id), status TEXT NOT NULL,
              idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              UNIQUE(requester_user_id,idempotency_key)
            );
            CREATE TABLE IF NOT EXISTS account_deletion_requests(
              id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
              status TEXT NOT NULL, reason TEXT NOT NULL, retention_summary TEXT NOT NULL,
              requested_at TEXT NOT NULL, scheduled_for TEXT, completed_at TEXT, updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_user_id,created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_phone_verification ON phone_verifications(phone,purpose,status,created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_withdrawals_owner ON withdrawal_requests(owner_user_id,created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_gpu_access_owner ON gpu_access_requests(owner_user_id,created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_gpu_access_admin ON gpu_access_requests(status,booking_start_at);
            CREATE INDEX IF NOT EXISTS idx_gpu_access_allocation ON gpu_access_requests(allocation_id,booking_start_at,booking_end_at);
            CREATE INDEX IF NOT EXISTS idx_purchase_requests_buyer ON purchase_requests(buyer_user_id,created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_environment_preflights_buyer ON environment_preflights(buyer_user_id,created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_environment_preflights_review ON environment_preflights(status,created_at);
            CREATE INDEX IF NOT EXISTS idx_listings_active ON listings(status,kind,gpu,region);
            CREATE INDEX IF NOT EXISTS idx_compute_products_active ON compute_products(status,gpu,gpu_count);
            CREATE INDEX IF NOT EXISTS idx_compute_product_requests_buyer ON compute_product_requests(buyer_user_id,created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_events_aggregate ON audit_events(aggregate_type,aggregate_id,sequence);
            CREATE INDEX IF NOT EXISTS idx_metering_order ON metering_records(order_id,source);
            CREATE INDEX IF NOT EXISTS idx_disputes_order ON disputes(order_id,status);
            CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id,status);
            CREATE INDEX IF NOT EXISTS idx_settlements_supplier ON settlements(supplier_user_id,status);
            CREATE INDEX IF NOT EXISTS idx_supplier_card_hour_rebates_supplier ON supplier_card_hour_rebates(supplier_user_id,status,created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_supplier_card_hour_rebates_review ON supplier_card_hour_rebates(review_required,status,created_at);
            CREATE INDEX IF NOT EXISTS idx_swaps_requester ON swap_requests(requester_user_id,created_at DESC);
            """
        )
        add_column_if_missing(connection, "supplier_applications", "reviewer_user_id", "TEXT")
        add_column_if_missing(connection, "users", "must_change_password", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "oidc_transactions", "flow", "TEXT NOT NULL DEFAULT 'web'")
        add_column_if_missing(connection, "oidc_transactions", "app_nonce_hash", "TEXT")
        add_column_if_missing(connection, "supplier_applications", "review_reason", "TEXT")
        add_column_if_missing(connection, "supplier_applications", "reviewed_at", "TEXT")
        add_column_if_missing(connection, "supplier_applications", "bank_account_verified", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "supplier_applications", "invoice_verified", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "supplier_applications", "resource_proof_verified", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "supplier_applications", "license_verified", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "supplier_applications", "next_review_at", "TEXT")
        add_column_if_missing(connection, "supplier_applications", "legal_representative", "TEXT")
        add_column_if_missing(connection, "supplier_applications", "contact_phone", "TEXT")
        add_column_if_missing(connection, "supplier_applications", "license_file_name", "TEXT")
        add_column_if_missing(connection, "supplier_applications", "license_mime", "TEXT")
        add_column_if_missing(connection, "supplier_applications", "license_size", "INTEGER")
        add_column_if_missing(connection, "supplier_applications", "license_sha256", "TEXT")
        add_column_if_missing(connection, "supplier_applications", "license_storage_path", "TEXT")
        add_column_if_missing(connection, "supplier_applications", "subject_verified", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "supplier_applications", "agent_verified", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "resource_intakes", "provider", "TEXT")
        add_column_if_missing(connection, "resource_intakes", "verification_summary", "TEXT")
        add_column_if_missing(connection, "resource_intakes", "reviewer_user_id", "TEXT")
        add_column_if_missing(connection, "resource_intakes", "verified_at", "TEXT")
        add_column_if_missing(connection, "resource_intakes", "frozen_reason", "TEXT")
        add_column_if_missing(connection, "listings", "intake_id", "TEXT")
        add_column_if_missing(connection, "listings", "floor_price_cents", "INTEGER")
        add_column_if_missing(connection, "listings", "trade_mode", "TEXT NOT NULL DEFAULT 'fixed'")
        add_column_if_missing(connection, "listings", "sla", "TEXT NOT NULL DEFAULT '99.5% 标准保障'")
        add_column_if_missing(connection, "listings", "minimum_quantity", "REAL NOT NULL DEFAULT 1")
        add_column_if_missing(connection, "listings", "reviewer_user_id", "TEXT")
        add_column_if_missing(connection, "listings", "reviewed_at", "TEXT")
        add_column_if_missing(connection, "listings", "price_source_json", "TEXT NOT NULL DEFAULT '{}'")
        add_column_if_missing(connection, "orders", "reservation_expires_at", "TEXT")
        add_column_if_missing(connection, "orders", "supplier_confirmed_at", "TEXT")
        add_column_if_missing(connection, "orders", "delivered_at", "TEXT")
        add_column_if_missing(connection, "orders", "accepted_at", "TEXT")
        add_column_if_missing(connection, "orders", "acceptance_due_at", "TEXT")
        add_column_if_missing(connection, "orders", "kind", "TEXT NOT NULL DEFAULT 'gpu'")
        add_column_if_missing(connection, "orders", "product_code", "TEXT")
        add_column_if_missing(connection, "orders", "settlement_mode", "TEXT NOT NULL DEFAULT 'cash'")
        add_column_if_missing(connection, "orders", "swap_id", "TEXT")
        add_column_if_missing(connection, "payments", "gateway", "TEXT")
        add_column_if_missing(connection, "payments", "channel", "TEXT")
        add_column_if_missing(connection, "payments", "checkout_url", "TEXT")
        add_column_if_missing(connection, "payments", "provider_status", "TEXT")
        add_column_if_missing(connection, "payments", "last_checked_at", "TEXT")
        add_column_if_missing(connection, "payments", "query_attempts", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "payments", "idempotency_key", "TEXT")
        add_column_if_missing(connection, "payments", "request_hash", "TEXT")
        add_column_if_missing(connection, "payments", "checkout_state", "TEXT NOT NULL DEFAULT 'pending'")
        add_column_if_missing(connection, "refunds", "execution_state", "TEXT NOT NULL DEFAULT 'idle'")
        add_column_if_missing(connection, "refunds", "execution_claim_token", "TEXT")
        add_column_if_missing(connection, "refunds", "execution_started_at", "TEXT")
        add_column_if_missing(connection, "refunds", "execution_attempts", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "refunds", "last_error_code", "TEXT")
        add_column_if_missing(connection, "settlements", "referral_commission_cents", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "supplier_card_hour_rebates", "pre_hold_status", "TEXT")
        add_column_if_missing(connection, "supplier_card_hour_rebates", "submitted_by", "TEXT")
        add_column_if_missing(connection, "supplier_card_hour_rebates", "submission_band", "TEXT")
        add_column_if_missing(connection, "supplier_card_hour_rebates", "transaction_summary", "TEXT")
        add_column_if_missing(connection, "supplier_card_hour_rebates", "submitted_at", "TEXT")
        add_column_if_missing(connection, "supplier_card_hour_rebates", "evidence_file_name", "TEXT")
        add_column_if_missing(connection, "supplier_card_hour_rebates", "evidence_mime", "TEXT")
        add_column_if_missing(connection, "supplier_card_hour_rebates", "evidence_size", "INTEGER")
        add_column_if_missing(connection, "supplier_card_hour_rebates", "evidence_sha256", "TEXT")
        add_column_if_missing(connection, "supplier_card_hour_rebates", "evidence_storage_path", "TEXT")
        add_column_if_missing(connection, "orders", "environment_preflight_id", "TEXT")
        add_column_if_missing(connection, "delivery_tasks", "environment_preflight_id", "TEXT")
        add_column_if_missing(connection, "environment_preflights", "approved_supplier_capability_level", "TEXT")
        add_column_if_missing(connection, "environment_preflights", "api_model", "TEXT")
        add_column_if_missing(connection, "environment_preflights", "api_runtime", "TEXT")
        add_column_if_missing(connection, "environment_preflights", "api_context_tokens", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "environment_preflights", "api_concurrency", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "environment_preflights", "api_rate_limit_rpm", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "environment_preflights", "api_token_quota_millions", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "allocations", "kind", "TEXT NOT NULL DEFAULT 'gpu'")
        add_column_if_missing(connection, "allocations", "product_code", "TEXT")
        add_column_if_missing(connection, "allocations", "provider", "TEXT")
        add_column_if_missing(connection, "allocations", "swap_reserved", "REAL NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "users", "lifecycle_status", "TEXT NOT NULL DEFAULT 'active'")
        add_column_if_missing(connection, "users", "supplier_capability_level", "TEXT NOT NULL DEFAULT 'L1'")
        add_column_if_missing(connection, "users", "deletion_requested_at", "TEXT")
        add_column_if_missing(connection, "users", "anonymized_at", "TEXT")
        add_column_if_missing(connection, "mobile_login_preparations", "login_hint", "TEXT")
        add_column_if_missing(
            connection,
            "mobile_login_preparations",
            "app_callback_uri",
            "TEXT NOT NULL DEFAULT 'cloudpay://auth/callback'",
        )
        add_column_if_missing(
            connection,
            "oidc_transactions",
            "app_callback_uri",
            "TEXT NOT NULL DEFAULT 'cloudpay://auth/callback'",
        )
        add_column_if_missing(connection, "mobile_login_tickets", "last_session_token_hash", "TEXT")
        add_column_if_missing(connection, "mobile_login_tickets", "exchange_count", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(
            connection,
            "payment_reconciliation_reviews",
            "version",
            "INTEGER NOT NULL DEFAULT 1",
        )
        add_column_if_missing(connection, "payment_reconciliation_reviews", "acknowledged_at", "TEXT")
        add_column_if_missing(connection, "payment_reconciliation_reviews", "acknowledged_by", "TEXT")
        add_column_if_missing(
            connection,
            "payment_reconciliation_reviews",
            "acknowledgement_reason",
            "TEXT",
        )
        add_column_if_missing(connection, "payment_reconciliation_reviews", "evidence_digest", "TEXT")
        add_column_if_missing(connection, "payment_reconciliation_reviews", "resolution", "TEXT")
        add_column_if_missing(
            connection,
            "payment_reconciliation_review_actions",
            "request_hash",
            "TEXT",
        )
        connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_idx ON payments(idempotency_key) WHERE idempotency_key IS NOT NULL"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS payments_order_provider_idx ON payments(order_id,provider,status)"
        )
        connection.execute(
            """UPDATE payments SET status='closed',checkout_state='uncertain',updated_at=?
               WHERE status='pending' AND order_id IN (
                 SELECT id FROM orders WHERE status NOT IN ('pending_payment','paid')
               )""",
            (now_iso(),),
        )
        connection.execute(
            """UPDATE payments SET checkout_state='ready'
               WHERE checkout_url IS NOT NULL AND checkout_state IN ('pending','creating')"""
        )
        connection.execute(
            """UPDATE payments SET checkout_state='uncertain'
               WHERE checkout_url IS NULL AND status IN ('pending','closed')
                 AND checkout_state='pending'"""
        )
        created = now_iso()
        connection.execute(
            """INSERT OR IGNORE INTO payment_reconciliation_reviews(
                 payment_id,reason,provider_status,query_attempts,status,
                 first_flagged_at,last_checked_at,updated_at
               )
               SELECT id,'provider_nonterminal_after_attempt_threshold',provider_status,
                      query_attempts,'open',?,last_checked_at,?
               FROM payments
               WHERE gateway='qixiang' AND status IN ('pending','closed')
                 AND query_attempts>=?""",
            (created, created, QIXIANG_MANUAL_REVIEW_AFTER_ATTEMPTS),
        )
        connection.execute(
            """UPDATE payment_reconciliation_reviews
               SET status='resolved',resolution='payment_success',
                   resolved_at=COALESCE(resolved_at,?),version=version+1,updated_at=?
               WHERE status IN ('open','acknowledged_monitoring') AND payment_id IN (
                 SELECT id FROM payments WHERE status IN ('success','refunded')
               )""",
            (created, created),
        )
        connection.execute(
            """INSERT OR IGNORE INTO users(
               id,name,account,password_hash,role,enterprise_status,created_at,updated_at
               ) VALUES(?,?,?,?, 'supplier','verified',?,?)""",
            (
                PLATFORM_INVENTORY_SUPPLIER_ID,
                "CloudPay 平台库存",
                "platform-inventory@kai.internal",
                hash_password(secrets.token_urlsafe(48)),
                created,
                created,
            ),
        )
        connection.execute(
            """INSERT OR IGNORE INTO listings(
               id,supplier_user_id,kind,product_code,gpu,provider,region,unit,
               unit_price_cents,verified_quantity,status,valid_from,valid_until,created_at,updated_at
               ) VALUES(?,?,'card_hour_topup',?,'KAI-CARD-HOUR',?,'全区域','标准卡时',
                        0,0,'internal_topup',?,?,?,?)""",
            (
                CARD_HOUR_TOPUP_LISTING_ID,
                PLATFORM_INVENTORY_SUPPLIER_ID,
                CARD_HOUR_TOPUP_PRODUCT_CODE,
                PLATFORM_INVENTORY_PROVIDER,
                created,
                future_days_iso(3650),
                created,
                created,
            ),
        )
        connection.execute(
            """INSERT OR IGNORE INTO payment_worker_state(
               worker_name,last_started_at,last_success_at,last_error_code,consecutive_failures,updated_at
               ) VALUES('qixiang-reconciliation',NULL,NULL,NULL,0,?)""",
            (created,),
        )
        connection.execute(
            """INSERT OR IGNORE INTO qixiang_query_state(
               state_key,window_started_epoch,query_count,consecutive_failures,circuit_open_until_epoch,updated_at
               ) VALUES('merchant',?,0,0,0,?)""",
            (int(time.time()), created),
        )
        connection.execute(
            "UPDATE users SET supplier_capability_level='L3' WHERE role='supplier' AND enterprise_status='certified' AND supplier_capability_level='L1'"
        )
        connection.execute("UPDATE orders SET product_code=COALESCE(product_code,gpu) WHERE product_code IS NULL")
        connection.execute("UPDATE allocations SET product_code=COALESCE(product_code,gpu),provider=COALESCE(provider,'KAI 已验资源池') WHERE product_code IS NULL OR provider IS NULL")
        connection.execute(
            "UPDATE orders SET reservation_expires_at=? WHERE status='pending_payment' AND reservation_expires_at IS NULL",
            (future_minutes_iso(ORDER_RESERVATION_MINUTES),),
        )
        if ADMIN_ACCOUNT and ADMIN_PASSWORD:
            if len(ADMIN_PASSWORD) < 12:
                raise RuntimeError("KAI_ADMIN_PASSWORD must contain at least 12 characters")
            admin = connection.execute("SELECT * FROM users WHERE account=?", (ADMIN_ACCOUNT,)).fetchone()
            if admin:
                connection.execute(
                    "UPDATE users SET role='admin',enterprise_status='verified',updated_at=? WHERE id=?",
                    (now_iso(), admin["id"]),
                )
            else:
                created = now_iso()
                connection.execute(
                    "INSERT INTO users(id,name,account,password_hash,role,enterprise_status,created_at,updated_at,must_change_password) VALUES(?,?,?,?, 'admin','verified',?,?,1)",
                    (uid("usr"), "KAI 平台运营管理员", ADMIN_ACCOUNT, hash_password(ADMIN_PASSWORD), created, created),
                )
        seed_compute_products(connection)
        if SEED_CATALOG:
            seed_demo(connection)
        else:
            archived_at = now_iso()
            connection.execute("UPDATE listings SET status='retired_demo',updated_at=? WHERE supplier_user_id='usr_demo_supplier'", (archived_at,))
            connection.execute(
                "UPDATE supplier_applications SET status='archived_test',review_reason='上线前历史验收数据归档',updated_at=? WHERE user_id IN (SELECT id FROM users WHERE account LIKE 'online-%@example.com')",
                (archived_at,),
            )
            connection.execute(
                "UPDATE users SET role='buyer',enterprise_status='unverified',updated_at=? WHERE account LIKE 'online-%@example.com'",
                (archived_at,),
            )


def seed_compute_products(connection: sqlite3.Connection) -> None:
    created = now_iso()
    labels = {
        "B200": "NVIDIA B200", "B300": "NVIDIA B300", "H100": "NVIDIA H100",
        "H200": "NVIDIA H200", "RTX5090": "NVIDIA RTX 5090", "RTX4090": "NVIDIA RTX 4090",
    }
    for product in COMPUTE_PRODUCT_CONFIGS:
        display_name = f"{labels[product['gpu']]} × {product['gpu_count']}"
        connection.execute(
            """INSERT INTO compute_products(
                 id,gpu,display_name,gpu_count,cpu_cores,memory_gb,hourly_price_cents,currency,
                 billing_unit,status,availability_status,source,created_at,updated_at
               ) VALUES(?,?,?,?,?,?,?,'CNY','配置时','active','confirmation_required','owner_price_sheet_2026-08-21',?,?)
               ON CONFLICT(id) DO UPDATE SET gpu=excluded.gpu,display_name=excluded.display_name,
                 gpu_count=excluded.gpu_count,cpu_cores=excluded.cpu_cores,memory_gb=excluded.memory_gb,
                 hourly_price_cents=excluded.hourly_price_cents,currency=excluded.currency,
                 billing_unit=excluded.billing_unit,status='active',source=excluded.source,updated_at=excluded.updated_at""",
            (product["id"], product["gpu"], display_name, product["gpu_count"], product["cpu_cores"],
             product["memory_gb"], product["hourly_price_cents"], created, created),
        )


def seed_demo(connection: sqlite3.Connection) -> None:
    created = now_iso()
    supplier_id = "usr_demo_supplier"
    buyer_id = "usr_demo_buyer"
    connection.execute(
        "INSERT OR IGNORE INTO users(id,name,account,password_hash,role,enterprise_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
        (supplier_id, "KAI 首阶段供应商", "supplier@kai.internal", hash_password(secrets.token_urlsafe(32)), "supplier", "certified", created, created),
    )
    connection.execute("UPDATE users SET supplier_capability_level='L5' WHERE id=?", (supplier_id,))
    if ALLOW_DEMO:
        connection.execute(
            "INSERT OR IGNORE INTO users(id,name,account,password_hash,role,enterprise_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
            (buyer_id, "KAI 企业采购方", "buyer@kai.demo", hash_password("KaiBuyer#2026"), "buyer", "verified", created, created),
        )
    connection.execute(
        "INSERT OR IGNORE INTO supplier_applications(id,user_id,enterprise_name,credit_code,agent_name,status,review_due_at,created_at,updated_at) VALUES(?,?,?,?,?,'certified',?,?,?)",
        ("sup_demo", supplier_id, "KAI 首阶段供应商", "91310000KAI0000001", "系统联调经办人", future_iso(24 * 180), created, created),
    )
    catalogue = [
        ("lst_h100_bj", "H100", "NVIDIA H100 80GB", "KAI 已验资源池", "北京", 1490, 12000),
        ("lst_h200_sh", "H200", "NVIDIA H200 141GB", "认证云厂商", "上海", 1880, 6000),
        ("lst_a100_cd", "A100", "NVIDIA A100 80GB", "企业闲置池", "成都", 982, 16000),
        ("lst_h800_sz", "H800", "NVIDIA H800 80GB", "认证云厂商", "深圳", 1260, 10000),
        ("lst_mi300x_hk", "MI300X", "AMD MI300X 192GB", "KAI 已验资源池", "中国香港", 1170, 8000),
        ("lst_910b_cd", "910B", "华为昇腾 910B", "国产算力资源池", "成都", 870, 12000),
    ]
    for listing_id, gpu, product_code, provider, region, price, quantity in catalogue:
        connection.execute(
            """INSERT OR IGNORE INTO listings(
              id,supplier_user_id,kind,product_code,gpu,provider,region,unit,unit_price_cents,
              verified_quantity,status,valid_from,valid_until,created_at,updated_at
            ) VALUES(?,?,'gpu',?,?,?,?, 'GPU 时',?,?,'active',?,?,?,?)""",
            (listing_id, supplier_id, product_code, gpu, provider, region, price, quantity, created, future_iso(24 * 365), created, created),
        )


def payment_canonical(payload: dict) -> str:
    fields = ("event_id", "payment_id", "order_id", "provider_txn_id", "merchant_id", "amount_cents", "currency", "status", "timestamp")
    return "|".join(str(payload.get(field, "")) for field in fields)


def payment_secret(provider: str, mock: bool = False) -> str | None:
    if mock:
        return MOCK_SECRET
    return os.environ.get(f"KAI_{provider.upper()}_CALLBACK_SECRET")


def sign_payment(payload: dict, secret: str) -> str:
    return hmac.new(secret.encode(), payment_canonical(payload).encode(), hashlib.sha256).hexdigest()


def refund_canonical(payload: dict) -> str:
    fields = ("event_id", "refund_id", "order_id", "provider_ref", "amount_cents", "currency", "status", "timestamp")
    return "|".join(str(payload.get(field, "")) for field in fields)


def sign_refund(payload: dict, secret: str) -> str:
    return hmac.new(secret.encode(), refund_canonical(payload).encode(), hashlib.sha256).hexdigest()


def fetch_order(connection: sqlite3.Connection, order_id: str) -> sqlite3.Row:
    row = connection.execute(
        """SELECT o.*,
                  d.status AS delivery_task_status,
                  d.environment_preflight_id AS delivery_environment_preflight_id,
                  d.credential_reference AS delivery_credential_reference,
                  d.endpoint_summary AS delivery_endpoint_summary,
                  d.evidence_digest AS delivery_evidence_digest,
                  d.started_at AS delivery_started_at,
                  d.delivered_at AS delivery_task_delivered_at,
                  d.acceptance_due_at AS delivery_task_acceptance_due_at
           FROM orders o LEFT JOIN delivery_tasks d ON d.order_id=o.id WHERE o.id=?""",
        (order_id,),
    ).fetchone()
    if not row:
        raise ApiError(404, "订单不存在", "order_not_found")
    return row


def card_hour_topup_amount(package_code: str | None, amount_cents: object) -> tuple[str | None, int, int]:
    """Return the server-authoritative package/amount/card-hour tuple.

    Five standard card-hours cost exactly CNY 5.01. Custom top-ups accept an
    integer-cent amount and use the same rational price, rounded down only at
    the sixth decimal card-hour so the platform never over-credits value.
    """
    if package_code:
        package = CARD_HOUR_PACKAGES.get(package_code)
        if not package:
            raise ApiError(422, "充值套餐不存在", "card_hour_package_not_found")
        return package_code, int(package["amount_cents"]), int(package["card_hours_micros"])
    if isinstance(amount_cents, bool):
        raise ApiError(422, "自定义充值金额无效", "invalid_card_hour_topup_amount")
    try:
        cents = int(amount_cents)
    except (TypeError, ValueError):
        raise ApiError(422, "自定义充值金额无效", "invalid_card_hour_topup_amount")
    if cents < CARD_HOUR_TOPUP_MIN_CENTS or cents > CARD_HOUR_TOPUP_MAX_CENTS:
        raise ApiError(422, "自定义充值金额超出允许范围", "invalid_card_hour_topup_amount")
    micros = (
        cents * CARD_HOUR_PRICE_DENOMINATOR_HOURS * CARD_HOUR_MICROS
        // CARD_HOUR_PRICE_NUMERATOR_CENTS
    )
    if micros <= 0:
        raise ApiError(422, "自定义充值金额无效", "invalid_card_hour_topup_amount")
    return None, cents, micros


def card_hour_topup_dict(row: sqlite3.Row) -> dict:
    item = dict(row)
    item["amount_cny"] = item["amount_cents"] / 100
    item["card_hours"] = item["card_hours_micros"] / CARD_HOUR_MICROS
    item["credited"] = item["status"] == "credited"
    return item


def card_hour_balance_micros(connection: sqlite3.Connection, user_id: str,
                             moment: str | None = None) -> int:
    moment = moment or now_iso()
    return int(connection.execute(
        """SELECT COALESCE(SUM(available_micros),0) FROM card_hour_lots
           WHERE user_id=? AND status='available' AND expires_at>?""",
        (user_id, moment),
    ).fetchone()[0] or 0)


def append_card_hour_movement(connection: sqlite3.Connection, *, user_id: str,
                              lot_id: str | None, topup_id: str | None,
                              movement_type: str, amount_micros: int,
                              reference_type: str, reference_id: str,
                              idempotency_key: str, created_at: str) -> None:
    balance_after_micros = card_hour_balance_micros(connection, user_id, created_at)
    existing = connection.execute(
        "SELECT * FROM card_hour_movements WHERE idempotency_key=?",
        (idempotency_key,),
    ).fetchone()
    if existing:
        expected = (
            user_id,
            lot_id,
            topup_id,
            movement_type,
            int(amount_micros),
            int(balance_after_micros),
            reference_type,
            reference_id,
            created_at,
        )
        actual = (
            existing["user_id"],
            existing["lot_id"],
            existing["topup_id"],
            existing["movement_type"],
            int(existing["amount_micros"]),
            int(existing["balance_after_micros"]),
            existing["reference_type"],
            existing["reference_id"],
            existing["created_at"],
        )
        if not hmac.compare_digest(
            json.dumps(actual, ensure_ascii=False, separators=(",", ":")),
            json.dumps(expected, ensure_ascii=False, separators=(",", ":")),
        ):
            raise ApiError(
                409,
                "卡时流水幂等键已用于不同内容",
                "card_hour_movement_idempotency_conflict",
            )
        return
    connection.execute(
        """INSERT INTO card_hour_movements(
             id,user_id,lot_id,topup_id,movement_type,amount_micros,
             balance_after_micros,reference_type,reference_id,idempotency_key,created_at
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        (
            uid("card_hour_movement"), user_id, lot_id, topup_id, movement_type,
            amount_micros, balance_after_micros,
            reference_type, reference_id, idempotency_key, created_at,
        ),
    )


def activate_card_hour_topup(
    connection: sqlite3.Connection,
    topup: sqlite3.Row,
    order: sqlite3.Row,
    captured_at: str,
) -> str:
    existing = connection.execute(
        "SELECT * FROM card_hour_lots WHERE topup_id=?", (topup["id"],)
    ).fetchone()
    if existing:
        return existing["allocation_id"]
    if topup["status"] != "pending" or order["status"] != "pending_payment":
        raise ApiError(409, "充值单状态不能到账", "invalid_card_hour_topup_state")
    captured = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
    expires_at = future_days_iso(CARD_HOUR_VALID_DAYS, base=captured)
    allocation_id = uid("card_hour_asset")
    lot_id = uid("card_hour_lot")
    quantity = int(topup["card_hours_micros"]) / CARD_HOUR_MICROS
    connection.execute(
        """INSERT INTO allocations(
           id,owner_user_id,order_id,listing_id,gpu,region,quantity,unit,expires_at,status,
           created_at,kind,product_code,provider
           ) VALUES(?,?,?,?,?,?,?,?,?,'available',?,'card_hour',?,?)""",
        (
            allocation_id,
            topup["user_id"],
            order["id"],
            CARD_HOUR_TOPUP_LISTING_ID,
            "KAI-CARD-HOUR",
            "全区域",
            quantity,
            "标准卡时",
            expires_at,
            captured_at,
            CARD_HOUR_TOPUP_PRODUCT_CODE,
            "CloudPay 卡时充值",
        ),
    )
    connection.execute(
        """INSERT INTO card_hour_lots(
           id,user_id,topup_id,allocation_id,original_micros,available_micros,status,
           expires_at,created_at,updated_at
           ) VALUES(?,?,?,?,?,?,'available',?,?,?)""",
        (
            lot_id,
            topup["user_id"],
            topup["id"],
            allocation_id,
            topup["card_hours_micros"],
            topup["card_hours_micros"],
            expires_at,
            captured_at,
            captured_at,
        ),
    )
    connection.execute(
        """UPDATE card_hour_topups SET status='credited',credited_at=?,expires_at=?,updated_at=?
           WHERE id=? AND status='pending'""",
        (captured_at, expires_at, captured_at, topup["id"]),
    )
    if connection.execute("SELECT changes()").fetchone()[0] != 1:
        raise ApiError(409, "充值到账状态冲突", "card_hour_credit_conflict")
    append_card_hour_movement(
        connection,
        user_id=topup["user_id"],
        lot_id=lot_id,
        topup_id=topup["id"],
        movement_type="TOPUP_CREDIT",
        amount_micros=int(topup["card_hours_micros"]),
        reference_type="payment",
        reference_id=order["id"],
        idempotency_key=f"topup-credit:{topup['id']}",
        created_at=captured_at,
    )
    audit(connection, topup["user_id"], "card_hour_topup", topup["id"], "card_hour.credited", {
        "order_id": order["id"],
        "allocation_id": allocation_id,
        "lot_id": lot_id,
        "amount_cents": topup["amount_cents"],
        "card_hours_micros": topup["card_hours_micros"],
        "captured_at": captured_at,
        "expires_at": expires_at,
    })
    return allocation_id


def require_role(session: sqlite3.Row, *roles: str) -> None:
    if session["role"] not in roles:
        raise ApiError(403, "当前账户没有执行此操作的权限", "permission_denied")


def supplier_for_order(connection: sqlite3.Connection, order: sqlite3.Row) -> sqlite3.Row:
    supplier = connection.execute(
        "SELECT u.* FROM listings l JOIN users u ON u.id=l.supplier_user_id WHERE l.id=?",
        (order["listing_id"],),
    ).fetchone()
    if not supplier:
        raise ApiError(409, "订单供应商信息异常", "supplier_missing")
    return supplier


def supplier_rebate_rate_bps(amount_cents: int) -> int:
    if amount_cents < 100:
        return 0
    for maximum_cents, rate_bps in SUPPLIER_REBATE_TIERS:
        if maximum_cents is None or amount_cents <= maximum_cents:
            return rate_bps
    return 0


def supplier_rebate_policy() -> dict:
    return {
        "review_threshold_cents": SUPPLIER_REBATE_REVIEW_CENTS,
        "unit": "GPU 时",
        "tiers": [
            {"minimum_cents": 100, "maximum_cents": 100_000, "rate_bps": 100, "review_required": False},
            {"minimum_cents": 100_001, "maximum_cents": 1_000_000, "rate_bps": 80, "review_required": False},
            {"minimum_cents": 1_000_001, "maximum_cents": 3_000_000, "rate_bps": 50, "review_required": False},
            {"minimum_cents": 3_000_001, "maximum_cents": 5_000_000, "rate_bps": 30, "review_required": False},
            {"minimum_cents": 5_000_001, "maximum_cents": None, "rate_bps": 20, "review_required": True},
        ],
    }


def supplier_application_dict(row: sqlite3.Row, admin: bool = False) -> dict:
    item = dict(row)
    item.pop("license_storage_path", None)
    item["license_uploaded"] = bool(item.get("license_file_name"))
    item["license_size"] = int(item.get("license_size") or 0)
    item["license_verified"] = bool(item.get("license_verified"))
    item["subject_verified"] = bool(item.get("subject_verified"))
    item["agent_verified"] = bool(item.get("agent_verified"))
    if admin and item["license_uploaded"]:
        item["license_download_url"] = f"/api/admin/supplier-applications/{item['id']}/license"
    return item


def supplier_rebate_dict(row: sqlite3.Row) -> dict:
    item = dict(row)
    item.pop("evidence_storage_path", None)
    item["amount_cny"] = item["amount_cents"] / 100
    item["source_card_hours"] = item["source_card_hours_micros"] / CARD_HOUR_MICROS
    item["rebate_card_hours"] = item["rebate_card_hours_micros"] / CARD_HOUR_MICROS
    item["rebate_rate_percent"] = item["rebate_rate_bps"] / 100
    item["evidence_uploaded"] = bool(item.get("evidence_file_name"))
    if item["evidence_uploaded"]:
        item["evidence_download_url"] = f"/api/supplier-rebates/{item['id']}/evidence"
    return item


def issue_supplier_card_hour_rebate(
    connection: sqlite3.Connection,
    rebate: sqlite3.Row,
    actor_user_id: str | None,
    issued_at: str,
) -> sqlite3.Row:
    if rebate["allocation_id"]:
        return rebate
    order = fetch_order(connection, rebate["order_id"])
    listing = connection.execute("SELECT * FROM listings WHERE id=?", (rebate["listing_id"],)).fetchone()
    if not listing or order["kind"] != "gpu" or order["unit"] != "GPU 时":
        raise ApiError(409, "订单无法换算为标准卡时", "card_hour_conversion_unavailable")
    rebate_hours = rebate["rebate_card_hours_micros"] / CARD_HOUR_MICROS
    if rebate_hours <= 0:
        raise ApiError(409, "返佣卡时计算结果无效", "invalid_rebate_card_hours")
    synthetic_order_id = uid("rebate_order")
    allocation_id = uid("rebate_asset")
    order_no = f"KAI-REBATE-{secrets.token_hex(6).upper()}"
    snapshot = json.dumps({
        "source": "supplier_card_hour_rebate",
        "source_order_id": order["id"],
        "source_order_no": order["order_no"],
        "source_amount_cents": rebate["amount_cents"],
        "source_card_hours": rebate["source_card_hours_micros"] / CARD_HOUR_MICROS,
        "rebate_rate_bps": rebate["rebate_rate_bps"],
        "rebate_id": rebate["id"],
    }, ensure_ascii=False)
    connection.execute(
        """INSERT INTO orders(id,order_no,buyer_user_id,listing_id,gpu,region,provider,quantity,unit,
           unit_price_cents,amount_cents,currency,status,payment_provider,idempotency_key,quote_snapshot_json,
           accepted_at,created_at,updated_at,kind,product_code,settlement_mode)
           VALUES(?,?,?,?,?,?,?,?,?,?,0,'CNY','accepted','supplier_rebate',?,?,?,?,?,?,?,'rebate')""",
        (
            synthetic_order_id, order_no, rebate["supplier_user_id"], listing["id"], order["gpu"], order["region"],
            "CloudPay 供应商返佣", rebate_hours, "GPU 时", order["unit_price_cents"],
            f"supplier-rebate:{rebate['id']}", snapshot, issued_at, issued_at, issued_at,
            "gpu", order["product_code"] or order["gpu"],
        ),
    )
    connection.execute(
        """INSERT INTO allocations(id,owner_user_id,order_id,listing_id,gpu,region,quantity,unit,expires_at,status,
           created_at,kind,product_code,provider) VALUES(?,?,?,?,?,?,?,?,?,'available',?,'gpu',?,?)""",
        (
            allocation_id, rebate["supplier_user_id"], synthetic_order_id, listing["id"], order["gpu"], order["region"],
            rebate_hours, "GPU 时", listing["valid_until"], issued_at,
            order["product_code"] or order["gpu"], "CloudPay 供应商返佣",
        ),
    )
    connection.execute(
        """UPDATE supplier_card_hour_rebates SET status='issued',synthetic_order_id=?,allocation_id=?,
           issued_at=?,updated_at=? WHERE id=?""",
        (synthetic_order_id, allocation_id, issued_at, issued_at, rebate["id"]),
    )
    audit(connection, actor_user_id, "supplier_card_hour_rebate", rebate["id"], "supplier_rebate.card_hours_issued", {
        "source_order_id": order["id"], "supplier_user_id": rebate["supplier_user_id"],
        "allocation_id": allocation_id, "rebate_card_hours": rebate_hours,
        "rebate_rate_bps": rebate["rebate_rate_bps"],
    })
    return connection.execute("SELECT * FROM supplier_card_hour_rebates WHERE id=?", (rebate["id"],)).fetchone()


def create_supplier_card_hour_rebate(
    connection: sqlite3.Connection,
    order: sqlite3.Row,
    supplier_user_id: str,
    submitted_by: str,
    submission_band: str,
    transaction_summary: str,
    submitted_at: str,
) -> sqlite3.Row | None:
    existing = connection.execute(
        "SELECT * FROM supplier_card_hour_rebates WHERE order_id=?", (order["id"],)
    ).fetchone()
    if existing:
        return existing
    if order["kind"] != "gpu" or order["unit"] != "GPU 时" or order["settlement_mode"] != "cash":
        return None
    amount_cents = int(order["amount_cents"])
    rate_bps = supplier_rebate_rate_bps(amount_cents)
    source_micros = int(round(float(order["quantity"]) * CARD_HOUR_MICROS))
    rebate_micros = (source_micros * rate_bps + 5000) // 10000
    if rate_bps <= 0 or source_micros <= 0 or rebate_micros <= 0:
        return None
    review_required = amount_cents > SUPPLIER_REBATE_REVIEW_CENTS
    expected_band = "over_50000" if review_required else "up_to_50000"
    if submission_band != expected_band:
        raise ApiError(422, "所选金额区间与订单实际金额不一致", "rebate_band_mismatch")
    rebate_id = uid("supplier_rebate")
    status = "pending_review" if review_required else "calculated"
    connection.execute(
        """INSERT INTO supplier_card_hour_rebates(
           id,order_id,supplier_user_id,listing_id,amount_cents,source_card_hours_micros,
           rebate_rate_bps,rebate_card_hours_micros,unit,status,review_required,conversion_basis,
           submitted_by,submission_band,transaction_summary,submitted_at,created_at,updated_at
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,'order_quantity_gpu_hour',?,?,?,?,?,?)""",
        (
            rebate_id, order["id"], supplier_user_id, order["listing_id"], amount_cents, source_micros,
            rate_bps, rebate_micros, "GPU 时", status, int(review_required), submitted_by,
            submission_band, transaction_summary, submitted_at, submitted_at, submitted_at,
        ),
    )
    audit(connection, submitted_by, "supplier_card_hour_rebate", rebate_id,
          "supplier_rebate.pending_review" if review_required else "supplier_rebate.calculated", {
              "order_id": order["id"], "supplier_user_id": supplier_user_id,
              "amount_cents": amount_cents, "source_card_hours": source_micros / CARD_HOUR_MICROS,
              "rebate_rate_bps": rate_bps, "rebate_card_hours": rebate_micros / CARD_HOUR_MICROS,
              "review_required": review_required,
              "submission_band": submission_band,
          })
    rebate = connection.execute("SELECT * FROM supplier_card_hour_rebates WHERE id=?", (rebate_id,)).fetchone()
    if not review_required:
        rebate = issue_supplier_card_hour_rebate(connection, rebate, submitted_by, submitted_at)
    return rebate


def pause_supplier_card_hour_rebate(connection: sqlite3.Connection, order_id: str, updated_at: str) -> None:
    rebate = connection.execute(
        "SELECT * FROM supplier_card_hour_rebates WHERE order_id=?", (order_id,)
    ).fetchone()
    if not rebate or rebate["status"] not in ("issued", "pending_review"):
        return
    connection.execute(
        """UPDATE supplier_card_hour_rebates SET pre_hold_status=status,status='paused',updated_at=?
           WHERE id=?""",
        (updated_at, rebate["id"]),
    )
    if rebate["allocation_id"]:
        connection.execute(
            "UPDATE allocations SET status='frozen' WHERE id=? AND status='available'",
            (rebate["allocation_id"],),
        )


def restore_supplier_card_hour_rebate(connection: sqlite3.Connection, order_id: str, updated_at: str) -> None:
    rebate = connection.execute(
        "SELECT * FROM supplier_card_hour_rebates WHERE order_id=?", (order_id,)
    ).fetchone()
    if not rebate or rebate["status"] != "paused":
        return
    restored = rebate["pre_hold_status"] or ("pending_review" if rebate["review_required"] else "issued")
    connection.execute(
        "UPDATE supplier_card_hour_rebates SET status=?,pre_hold_status=NULL,updated_at=? WHERE id=?",
        (restored, updated_at, rebate["id"]),
    )
    if restored == "issued" and rebate["allocation_id"]:
        connection.execute(
            "UPDATE allocations SET status='available' WHERE id=? AND status='frozen'",
            (rebate["allocation_id"],),
        )


def reverse_supplier_card_hour_rebate(
    connection: sqlite3.Connection,
    order_id: str,
    actor_user_id: str | None,
    reversed_at: str,
) -> None:
    rebate = connection.execute(
        "SELECT * FROM supplier_card_hour_rebates WHERE order_id=?", (order_id,)
    ).fetchone()
    if not rebate or rebate["status"] in ("rejected", "reversed", "clawback_required"):
        return
    next_status = "reversed"
    if rebate["allocation_id"]:
        allocation = connection.execute(
            "SELECT * FROM allocations WHERE id=?", (rebate["allocation_id"],)
        ).fetchone()
        if allocation:
            expected = rebate["rebate_card_hours_micros"] / CARD_HOUR_MICROS
            withdrawal_reserved = connection.execute(
                """SELECT COALESCE(SUM(quantity),0) FROM withdrawal_requests
                   WHERE allocation_id=? AND status IN ('scheduled','processing')""",
                (allocation["id"],),
            ).fetchone()[0]
            used_or_reserved = (
                float(allocation["quantity"]) + 1e-9 < expected
                or float(allocation["swap_reserved"] or 0) > 1e-9
                or float(withdrawal_reserved or 0) > 1e-9
            )
            if used_or_reserved:
                next_status = "clawback_required"
                connection.execute("UPDATE allocations SET status='frozen' WHERE id=?", (allocation["id"],))
            else:
                connection.execute(
                    "UPDATE allocations SET quantity=0,swap_reserved=0,status='reversed' WHERE id=?",
                    (allocation["id"],),
                )
    connection.execute(
        """UPDATE supplier_card_hour_rebates SET status=?,pre_hold_status=NULL,reversed_at=?,updated_at=?
           WHERE id=?""",
        (next_status, reversed_at, reversed_at, rebate["id"]),
    )
    audit(connection, actor_user_id, "supplier_card_hour_rebate", rebate["id"],
          f"supplier_rebate.{next_status}", {
              "order_id": order_id,
              "rebate_card_hours": rebate["rebate_card_hours_micros"] / CARD_HOUR_MICROS,
          })


def release_order_capacity(connection: sqlite3.Connection, order: sqlite3.Row, source_status: str) -> None:
    if order["kind"] == "card_hour_topup":
        updated = now_iso()
        if source_status == "accepted":
            lot = connection.execute(
                """SELECT l.*,t.id AS resolved_topup_id FROM card_hour_lots l
                   JOIN card_hour_topups t ON t.id=l.topup_id WHERE t.order_id=?""",
                (order["id"],),
            ).fetchone()
            if (
                not lot
                or lot["status"] != "available"
                or int(lot["available_micros"]) != int(lot["original_micros"])
            ):
                raise ApiError(
                    409,
                    "充值卡时已使用、冻结或到期，不能原路全额退款",
                    "card_hour_refund_balance_changed",
                )
            connection.execute(
                """UPDATE card_hour_lots SET available_micros=0,status='refunded',updated_at=?
                   WHERE topup_id IN (SELECT id FROM card_hour_topups WHERE order_id=?)""",
                (updated, order["id"]),
            )
            connection.execute(
                "UPDATE allocations SET quantity=0,status='refunded' WHERE order_id=?",
                (order["id"],),
            )
            append_card_hour_movement(
                connection,
                user_id=lot["user_id"],
                lot_id=lot["id"],
                topup_id=lot["resolved_topup_id"],
                movement_type="TOPUP_REFUND",
                amount_micros=-int(lot["original_micros"]),
                reference_type="order",
                reference_id=order["id"],
                idempotency_key=f"topup-refund:{order['id']}",
                created_at=updated,
            )
        connection.execute(
            "UPDATE card_hour_topups SET status=?,updated_at=? WHERE order_id=?",
            ("refunded" if source_status == "accepted" else "expired", updated, order["id"]),
        )
        return
    counter = {
        "pending_payment": "quote_reserved",
        "paid": "order_locked",
        "supplier_confirmed": "order_locked",
        "delivered": "delivering",
    }.get(source_status)
    if counter:
        connection.execute(
            f"UPDATE listings SET {counter}=MAX(0,{counter}-?),version=version+1,updated_at=? WHERE id=?",
            (order["quantity"], now_iso(), order["listing_id"]),
        )
    elif source_status == "accepted":
        connection.execute(
            "UPDATE listings SET consumed=MAX(0,consumed-?),version=version+1,updated_at=? WHERE id=?",
            (order["quantity"], now_iso(), order["listing_id"]),
        )
        connection.execute("UPDATE allocations SET status='refunded' WHERE order_id=?", (order["id"],))


def apply_refund_success(connection: sqlite3.Connection, refund: sqlite3.Row, provider_ref: str,
                         actor_user_id: str | None = None) -> None:
    order = fetch_order(connection, refund["order_id"])
    if refund["status"] == "success" or order["status"] == "refunded":
        return
    release_order_capacity(connection, order, refund["original_order_status"])
    updated = now_iso()
    if order["kind"] == "card_hour_topup":
        connection.execute(
            "UPDATE card_hour_topups SET status='refunded',updated_at=? WHERE order_id=?",
            (updated, order["id"]),
        )
        connection.execute(
            """UPDATE card_hour_lots SET available_micros=0,status='refunded',updated_at=?
               WHERE topup_id IN (SELECT id FROM card_hour_topups WHERE order_id=?)""",
            (updated, order["id"]),
        )
        connection.execute(
            "UPDATE allocations SET quantity=0,status='refunded' WHERE order_id=?",
            (order["id"],),
        )
    connection.execute(
        "UPDATE refunds SET status='success',provider_ref=?,reviewer_user_id=COALESCE(reviewer_user_id,?),updated_at=? WHERE id=?",
        (provider_ref, actor_user_id, updated, refund["id"]),
    )
    connection.execute("UPDATE orders SET status='refunded',updated_at=? WHERE id=?", (updated, order["id"]))
    connection.execute("UPDATE payments SET status='refunded',updated_at=? WHERE id=?", (updated, refund["payment_id"]))
    connection.execute("UPDATE settlements SET status='reversed',updated_at=? WHERE order_id=? AND status!='paid'", (updated, order["id"]))
    cancelled_access = connection.execute(
        """UPDATE gpu_access_requests SET status='cancelled',
           admin_note=CASE WHEN admin_note IS NULL OR admin_note='' THEN '订单已退款，GPU 主机预约自动撤销' ELSE admin_note END,
           updated_at=? WHERE order_id=? AND status IN ('pending_admin','coordinating','ready')""",
        (updated, order["id"]),
    ).rowcount
    reverse_supplier_card_hour_rebate(connection, order["id"], actor_user_id, updated)
    audit(connection, actor_user_id, "refund", refund["id"], "refund.succeeded", {
        "order_id": order["id"], "amount_cents": refund["amount_cents"], "provider_ref": provider_ref,
        "cancelled_gpu_access_requests": max(0, cancelled_access),
    })


def metering_reconciliation(connection: sqlite3.Connection, order_id: str) -> dict:
    rows = connection.execute(
        "SELECT source,quantity,status FROM metering_records WHERE order_id=? ORDER BY created_at DESC",
        (order_id,),
    ).fetchall()
    latest = {}
    for row in rows:
        latest.setdefault(row["source"], row)
    supplier = latest.get("supplier")
    gateway = latest.get("kai_gateway")
    if not supplier or not gateway:
        return {"ready": False, "status": "awaiting_dual_source", "difference_ratio": None}
    denominator = max(abs(float(supplier["quantity"])), abs(float(gateway["quantity"])), 1e-9)
    difference = abs(float(supplier["quantity"]) - float(gateway["quantity"])) / denominator
    status = "matched" if difference <= METERING_TOLERANCE_RATIO else "manual_review"
    connection.execute("UPDATE metering_records SET status=? WHERE order_id=?", (status, order_id))
    return {"ready": status == "matched", "status": status, "difference_ratio": round(difference, 6)}


def is_platform_inventory_order(connection: sqlite3.Connection, order: sqlite3.Row) -> bool:
    listing = connection.execute(
        "SELECT supplier_user_id,provider FROM listings WHERE id=?", (order["listing_id"],)
    ).fetchone()
    return bool(
        listing
        and listing["supplier_user_id"] == PLATFORM_INVENTORY_SUPPLIER_ID
        and listing["provider"] == PLATFORM_INVENTORY_PROVIDER
        and order["provider"] == PLATFORM_INVENTORY_PROVIDER
    )


def activate_platform_inventory_order(connection: sqlite3.Connection, order: sqlite3.Row,
                                      actor_user_id: str | None, reason: str) -> str:
    """Atomically turn a paid platform-owned capacity order into a buyer allocation.

    Platform inventory is already verified and is represented as a transferable capacity
    asset. It has no interactive supplier account, so routing it through the external
    supplier delivery workflow would leave paid orders permanently locked.
    """
    listing = connection.execute("SELECT * FROM listings WHERE id=?", (order["listing_id"],)).fetchone()
    if not listing or not is_platform_inventory_order(connection, order):
        raise ApiError(409, "该订单不是平台自有库存", "not_platform_inventory_order")
    existing = connection.execute("SELECT id FROM allocations WHERE order_id=?", (order["id"],)).fetchone()
    if order["status"] == "accepted":
        if existing:
            return existing["id"]
        raise ApiError(409, "订单已验收但资产记录缺失", "accepted_allocation_missing")
    if order["status"] != "paid":
        raise ApiError(409, "平台自有库存仅可在支付成功后激活", "invalid_order_state")
    if existing:
        raise ApiError(409, "订单资产已存在但状态异常", "allocation_state_mismatch")
    quantity = float(order["quantity"])
    activated_at = now_iso()
    delivery_ref = uid("platform_delivery")
    allocation_id = uid("asset")
    evidence_digest = hashlib.sha256(
        f"platform-inventory|{order['id']}|{order['order_no']}|{quantity}|{activated_at}".encode("utf-8")
    ).hexdigest()
    connection.execute(
        """UPDATE listings SET order_locked=order_locked-?,consumed=consumed+?,version=version+1,updated_at=?
           WHERE id=? AND order_locked+1e-9>=?""",
        (quantity, quantity, activated_at, listing["id"], quantity),
    )
    if connection.execute("SELECT changes()").fetchone()[0] != 1:
        raise ApiError(409, "平台自有库存锁定容量异常", "locked_capacity_mismatch")
    connection.execute(
        """UPDATE orders SET status='accepted',supplier_confirmed_at=COALESCE(supplier_confirmed_at,?),
           delivery_ref=COALESCE(delivery_ref,?),delivered_at=COALESCE(delivered_at,?),
           acceptance_due_at=COALESCE(acceptance_due_at,?),accepted_at=?,updated_at=? WHERE id=?""",
        (activated_at, delivery_ref, activated_at, activated_at, activated_at, activated_at, order["id"]),
    )
    connection.execute(
        """INSERT INTO delivery_tasks(
           id,order_id,supplier_user_id,environment_preflight_id,status,credential_reference,
           endpoint_summary,evidence_digest,started_at,delivered_at,acceptance_due_at,created_at,updated_at
           ) VALUES(?,?,?,?, 'accepted',?,?,?,?,?,?,?,?)""",
        (uid("delivery"), order["id"], listing["supplier_user_id"], order["environment_preflight_id"],
         delivery_ref, "CloudPay 自有算力资产账本即时交付", evidence_digest,
         activated_at, activated_at, activated_at, activated_at, activated_at),
    )
    connection.execute(
        """INSERT INTO allocations(
           id,owner_user_id,order_id,listing_id,gpu,region,quantity,unit,expires_at,status,
           created_at,kind,product_code,provider
           ) VALUES(?,?,?,?,?,?,?,?,?,'available',?,?,?,?)""",
        (allocation_id, order["buyer_user_id"], order["id"], listing["id"], order["gpu"],
         order["region"], quantity, order["unit"], listing["valid_until"], activated_at,
         listing["kind"], listing["product_code"], listing["provider"]),
    )
    platform_fee = int(round(order["amount_cents"] * PLATFORM_FEE_BPS / 10000))
    supplier_net = order["amount_cents"] - platform_fee
    hold_until = (datetime.now(timezone.utc) + timedelta(hours=SETTLEMENT_HOLD_HOURS)).replace(microsecond=0).isoformat()
    settlement_id = uid("settlement")
    connection.execute(
        """INSERT INTO settlements(
           id,order_id,supplier_user_id,gross_cents,platform_fee_cents,supplier_net_cents,
           referral_commission_cents,currency,status,hold_until,created_at,updated_at
           ) VALUES(?,?,?,?,?,?,0,'CNY','holding',?,?,?)""",
        (settlement_id, order["id"], listing["supplier_user_id"], order["amount_cents"],
         platform_fee, supplier_net, hold_until, activated_at, activated_at),
    )
    audit(connection, actor_user_id, "order", order["id"], "order.platform_inventory_activated", {
        "allocation_id": allocation_id, "delivery_ref": delivery_ref, "quantity": quantity,
        "unit": order["unit"], "reason": reason, "metering_required": False,
    })
    audit(connection, actor_user_id, "settlement", settlement_id, "settlement.eligible", {
        "order_id": order["id"], "reason": "platform_inventory_activated",
        "gross_cents": order["amount_cents"], "platform_fee_cents": platform_fee,
        "supplier_net_cents": supplier_net, "hold_until": hold_until,
    })
    return allocation_id


def record_payment_worker_started() -> None:
    with db_connect() as connection:
        connection.execute(
            """UPDATE payment_worker_state SET last_started_at=?,updated_at=?
               WHERE worker_name='qixiang-reconciliation'""",
            (now_iso(), now_iso()),
        )


def claim_refund_execution(refund_id: str, reviewer_user_id: str) -> tuple[sqlite3.Row, sqlite3.Row, sqlite3.Row, str]:
    claim_token = secrets.token_urlsafe(18)
    started = now_iso()
    with db_connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            refund = connection.execute(
                "SELECT * FROM refunds WHERE id=?", (refund_id,)
            ).fetchone()
            if not refund or refund["status"] != "pending_review" or refund["execution_state"] != "idle":
                raise ApiError(409, "退款申请不存在、已审核或正在执行", "refund_execution_conflict")
            order = fetch_order(connection, refund["order_id"])
            payment = connection.execute(
                "SELECT * FROM payments WHERE id=?", (refund["payment_id"],)
            ).fetchone()
            if not payment:
                raise ApiError(404, "原支付单不存在", "payment_not_found")
            if not payment_readiness(payment["provider"])["refund_configured"]:
                raise ApiError(
                    503,
                    "退款通道尚未取得可验证的生产协议，当前保持人工待处理",
                    "refund_provider_not_enabled",
                )
            if order["kind"] == "card_hour_topup":
                lot = connection.execute(
                    """SELECT l.* FROM card_hour_lots l JOIN card_hour_topups t ON t.id=l.topup_id
                       WHERE t.order_id=?""",
                    (order["id"],),
                ).fetchone()
                if (
                    not lot
                    or lot["status"] != "available"
                    or int(lot["available_micros"]) != int(lot["original_micros"])
                ):
                    raise ApiError(
                        409,
                        "充值卡时已使用、冻结或到期，不能原路全额退款",
                        "card_hour_refund_balance_changed",
                    )
            connection.execute(
                """UPDATE refunds SET status='processing',reviewer_user_id=?,
                   execution_state='submitting',execution_claim_token=?,execution_started_at=?,
                   execution_attempts=execution_attempts+1,last_error_code=NULL,updated_at=?
                   WHERE id=? AND status='pending_review' AND execution_state='idle'""",
                (reviewer_user_id, claim_token, started, started, refund_id),
            )
            if connection.execute("SELECT changes()").fetchone()[0] != 1:
                raise ApiError(409, "退款执行抢占失败", "refund_execution_conflict")
            audit(connection, reviewer_user_id, "refund", refund_id, "refund.execution_claimed", {
                "order_id": order["id"], "attempt": int(refund["execution_attempts"] or 0) + 1,
            })
            connection.execute("COMMIT")
            return refund, order, payment, claim_token
        except Exception:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise


def record_payment_worker_result(error_code: str | None = None) -> None:
    with db_connect() as connection:
        if error_code:
            connection.execute(
                """UPDATE payment_worker_state SET last_error_code=?,
                   consecutive_failures=consecutive_failures+1,updated_at=?
                   WHERE worker_name='qixiang-reconciliation'""",
                (str(error_code)[:120], now_iso()),
            )
        else:
            connection.execute(
                """UPDATE payment_worker_state SET last_success_at=?,last_error_code=NULL,
                   consecutive_failures=0,updated_at=?
                   WHERE worker_name='qixiang-reconciliation'""",
                (now_iso(), now_iso()),
            )


def record_payment_worker_heartbeat_if_healthy() -> bool:
    """Refresh an idle worker without erasing an error written concurrently."""
    moment = now_iso()
    with db_connect() as connection:
        connection.execute(
            """UPDATE payment_worker_state SET last_success_at=?,updated_at=?
               WHERE worker_name='qixiang-reconciliation'
               AND last_error_code IS NULL AND consecutive_failures=0""",
            (moment, moment),
        )
        return connection.execute("SELECT changes()").fetchone()[0] == 1


def record_qixiang_credential_recovery() -> bool:
    """Clear only the credential-refresh error this successful refresh recovered."""
    moment = now_iso()
    with db_connect() as connection:
        connection.execute(
            """UPDATE payment_worker_state
               SET last_success_at=?,last_error_code=NULL,
                   consecutive_failures=0,updated_at=?
               WHERE worker_name='qixiang-reconciliation'
                 AND last_error_code='qixiang_credential_verification_failed'""",
            (moment, moment),
        )
        return connection.execute("SELECT changes()").fetchone()[0] == 1


def record_qixiang_credential_refresh_failure(error_code: str) -> None:
    moment = now_iso()
    now_epoch = int(time.time())
    key_fingerprint = current_qixiang_key_sha256()
    with db_connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        state = connection.execute(
            "SELECT * FROM qixiang_credential_refresh_state WHERE state_key='active'"
        ).fetchone()
        prior_failures = (
            int(state["consecutive_failures"] or 0)
            if state
            and state["pid"] == QIXIANG_PID
            and state["active_key_sha256"] == key_fingerprint
            else 0
        )
        failures = prior_failures + 1
        backoff = min(3600, 60 * (2 ** min(failures - 1, 5)))
        connection.execute(
            """INSERT INTO qixiang_credential_refresh_state(
                 state_key,pid,active_key_sha256,next_attempt_epoch,
                 consecutive_failures,last_error_code,last_attempt_at,updated_at
               ) VALUES('active',?,?,?,?,?,?,?)
               ON CONFLICT(state_key) DO UPDATE SET
                 pid=excluded.pid,
                 active_key_sha256=excluded.active_key_sha256,
                 next_attempt_epoch=excluded.next_attempt_epoch,
                 consecutive_failures=excluded.consecutive_failures,
                 last_error_code=excluded.last_error_code,
                 last_attempt_at=excluded.last_attempt_at,
                 updated_at=excluded.updated_at""",
            (
                QIXIANG_PID,
                key_fingerprint,
                now_epoch + backoff,
                failures,
                str(error_code)[:120],
                moment,
                moment,
            ),
        )
        connection.execute("COMMIT")


def refresh_qixiang_credential_evidence_if_due() -> dict[str, int]:
    result = {"attempted": 0, "verified": 0, "errors": 0}
    if PAYMENT_GATEWAY != "qixiang" or not PAYMENT_RECONCILIATION_ENABLED:
        return result
    evidence = latest_qixiang_key_rotation_evidence()
    if not evidence:
        return result
    verified_at = parse_evidence_timestamp(evidence["provider_verified_at"])
    if not verified_at:
        return result
    moment = datetime.now(timezone.utc)
    if (moment - verified_at).total_seconds() < QIXIANG_CREDENTIAL_REFRESH_SECONDS:
        return result
    now_epoch = int(time.time())
    key_fingerprint = current_qixiang_key_sha256()
    with db_connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        state = connection.execute(
            "SELECT * FROM qixiang_credential_refresh_state WHERE state_key='active'"
        ).fetchone()
        if (
            state
            and state["pid"] == QIXIANG_PID
            and state["active_key_sha256"] == key_fingerprint
            and int(state["next_attempt_epoch"] or 0) > now_epoch
        ):
            connection.execute("COMMIT")
            return result
        claimed_at = now_iso()
        connection.execute(
            """INSERT INTO qixiang_credential_refresh_state(
                 state_key,pid,active_key_sha256,next_attempt_epoch,
                 consecutive_failures,last_error_code,last_attempt_at,updated_at
               ) VALUES('active',?,?,?,0,NULL,?,?)
               ON CONFLICT(state_key) DO UPDATE SET
                 pid=excluded.pid,
                 active_key_sha256=excluded.active_key_sha256,
                 next_attempt_epoch=excluded.next_attempt_epoch,
                 last_attempt_at=excluded.last_attempt_at,
                 updated_at=excluded.updated_at""",
            (
                QIXIANG_PID,
                key_fingerprint,
                now_epoch + QIXIANG_TIMEOUT_SECONDS + 30,
                claimed_at,
                claimed_at,
            ),
        )
        connection.execute("COMMIT")
    result["attempted"] = 1
    try:
        merchant = qixiang_query_merchant(qixiang_config())
        if not merchant["active"]:
            raise QixiangPayError(
                "七相支付商户当前未启用", "qixiangpay_merchant_inactive"
            )
        record_qixiang_key_rotation_evidence(
            merchant=merchant,
            old_key_revoked_at=evidence["old_key_revoked_at"],
            revocation_reference=evidence["revocation_reference"],
            verification_source="scheduled_live_query",
            verified_by=None,
        )
    except (QixiangPayError, ApiError) as error:
        error_code = getattr(error, "code", type(error).__name__)
        record_qixiang_credential_refresh_failure(str(error_code))
        result["errors"] = 1
        return result
    result["verified"] = 1
    return result


def payment_worker_ready() -> bool:
    if ALLOW_DEMO or PAYMENT_GATEWAY != "qixiang":
        return True
    if (
        not PAYMENT_RECONCILIATION_ENABLED
        or not payment_readiness("alipay")["configured"]
    ):
        return False
    with db_connect() as connection:
        state = connection.execute(
            """SELECT last_success_at,last_error_code,consecutive_failures
               FROM payment_worker_state WHERE worker_name='qixiang-reconciliation'"""
        ).fetchone()
        query_state = connection.execute(
            "SELECT circuit_open_until_epoch FROM qixiang_query_state WHERE state_key='merchant'"
        ).fetchone()
        credential_state = connection.execute(
            "SELECT * FROM qixiang_credential_refresh_state WHERE state_key='active'"
        ).fetchone()
    if not state or not state["last_success_at"]:
        return False
    if state["last_error_code"] or int(state["consecutive_failures"] or 0) > 0:
        return False
    if query_state and int(query_state["circuit_open_until_epoch"] or 0) > int(time.time()):
        return False
    if (
        credential_state
        and credential_state["pid"] == QIXIANG_PID
        and credential_state["active_key_sha256"] == current_qixiang_key_sha256()
        and credential_state["last_error_code"]
    ):
        return False
    try:
        last_success = datetime.fromisoformat(str(state["last_success_at"]).replace("Z", "+00:00"))
    except ValueError:
        return False
    return (
        datetime.now(timezone.utc) - last_success
    ).total_seconds() <= PAYMENT_WORKER_MAX_STALENESS_SECONDS


def payment_creation_ready(provider: str) -> bool:
    if ALLOW_DEMO:
        return True
    return (
        PAYMENT_CREATE_ENABLED
        and payment_readiness(provider)["creation_configured"]
        and release_compliance_ready()
        and payment_worker_ready()
        and payment_manual_review_count() == 0
    )


def require_payment_creation_ready(provider: str) -> None:
    if ALLOW_DEMO:
        return
    if not PAYMENT_CREATE_ENABLED:
        raise ApiError(503, "新支付单创建已暂停", "payment_creation_disabled")
    if not payment_readiness(provider)["creation_configured"]:
        raise ApiError(503, "所选支付通道尚未配置完成", "payment_provider_not_configured")
    if not release_compliance_ready():
        raise ApiError(
            503,
            "App 备案与互联网信息服务审核尚未完成",
            "app_release_compliance_not_ready",
        )
    if not payment_worker_ready():
        raise ApiError(
            503,
            "支付自动核单服务尚未就绪，请稍后重试",
            "payment_worker_not_ready",
        )
    if payment_manual_review_count() > 0:
        raise ApiError(
            503,
            "存在待管理员确认的支付核单，请先完成复核并保持后台监控",
            "payment_manual_review_required",
        )


def run_maintenance_cycle() -> dict:
    record_payment_worker_started()
    expired = payable = delivered = swap_quotes_expired = platform_inventory_activated = 0
    credential_result = refresh_qixiang_credential_evidence_if_due()
    reconcile_result = reconcile_pending_qixiang_payments()
    moment = now_iso()
    with db_connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            rows = connection.execute(
                "SELECT * FROM orders WHERE status='pending_payment' AND reservation_expires_at IS NOT NULL AND reservation_expires_at<=?",
                (moment,),
            ).fetchall()
            for order in rows:
                release_order_capacity(connection, order, "pending_payment")
                connection.execute("UPDATE orders SET status='expired',updated_at=? WHERE id=?", (moment, order["id"]))
                connection.execute("UPDATE payments SET status='closed',updated_at=? WHERE order_id=? AND status='pending'", (moment, order["id"]))
                audit(connection, None, "order", order["id"], "capacity.reservation_expired", {
                    "quantity": order["quantity"], "unit": order["unit"], "expired_at": moment,
                })
                expired += 1
            expiring_lots = connection.execute(
                """SELECT * FROM card_hour_lots
                   WHERE status='available' AND expires_at<=?
                   ORDER BY expires_at,id""",
                (moment,),
            ).fetchall()
            for lot in expiring_lots:
                expired_micros = int(lot["available_micros"])
                connection.execute(
                    """UPDATE card_hour_lots SET status='expired',available_micros=0,updated_at=?
                       WHERE id=? AND status='available'""",
                    (moment, lot["id"]),
                )
                if expired_micros > 0:
                    append_card_hour_movement(
                        connection,
                        user_id=lot["user_id"],
                        lot_id=lot["id"],
                        topup_id=lot["topup_id"],
                        movement_type="EXPIRATION",
                        amount_micros=-expired_micros,
                        reference_type="lot",
                        reference_id=lot["id"],
                        idempotency_key=f"lot-expiration:{lot['id']}",
                        created_at=moment,
                    )
            connection.execute(
                """UPDATE allocations SET status='expired',quantity=0
                   WHERE kind='card_hour' AND status='available' AND expires_at<=?""",
                (moment,),
            )
            swap_rows = connection.execute(
                "SELECT * FROM swap_requests WHERE status='quoted' AND quote_expires_at IS NOT NULL AND quote_expires_at<=?",
                (moment,),
            ).fetchall()
            for swap in swap_rows:
                connection.execute("UPDATE allocations SET swap_reserved=MAX(0,swap_reserved-?) WHERE id=?", (swap["source_quantity"], swap["source_allocation_id"]))
                connection.execute("UPDATE listings SET quote_reserved=MAX(0,quote_reserved-?),version=version+1,updated_at=? WHERE id=?", (swap["target_quantity"], moment, swap["target_listing_id"]))
                connection.execute("UPDATE swap_requests SET status='quote_expired',updated_at=? WHERE id=?", (moment, swap["id"]))
                audit(connection, None, "swap", swap["id"], "swap.quote_expired", {"reservations_released": True})
                swap_quotes_expired += 1
            platform_orders = connection.execute(
                """SELECT o.* FROM orders o JOIN listings l ON l.id=o.listing_id
                   WHERE o.status='paid' AND o.provider=? AND l.provider=? AND l.supplier_user_id=?
                   ORDER BY o.created_at""",
                (PLATFORM_INVENTORY_PROVIDER, PLATFORM_INVENTORY_PROVIDER, PLATFORM_INVENTORY_SUPPLIER_ID),
            ).fetchall()
            for order in platform_orders:
                activate_platform_inventory_order(
                    connection, order, None, "maintenance_after_verified_payment"
                )
                platform_inventory_activated += 1
            settlement_rows = connection.execute(
                """SELECT s.* FROM settlements s
                   WHERE s.status='holding' AND s.hold_until<=?
                   AND NOT EXISTS(SELECT 1 FROM disputes d WHERE d.order_id=s.order_id AND d.status IN ('open','reviewing'))
                   AND NOT EXISTS(SELECT 1 FROM refunds r WHERE r.order_id=s.order_id AND r.status IN ('pending_review','approved','processing'))""",
                (moment,),
            ).fetchall()
            for settlement in settlement_rows:
                connection.execute("UPDATE settlements SET status='payable',updated_at=? WHERE id=?", (moment, settlement["id"]))
                audit(connection, None, "settlement", settlement["id"], "settlement.payable", {
                    "order_id": settlement["order_id"], "supplier_net_cents": settlement["supplier_net_cents"],
                })
                payable += 1
            events = connection.execute("SELECT * FROM outbox WHERE status='pending' ORDER BY sequence LIMIT 200").fetchall()
            for event in events:
                connection.execute(
                    "INSERT OR IGNORE INTO event_deliveries(id,event_id,consumer,status,delivered_at) VALUES(?,?,?,'delivered',?)",
                    (uid("delivery"), event["event_id"], "kai-local-projection", moment),
                )
                connection.execute(
                    "UPDATE outbox SET status='processed',attempts=attempts+1,processed_at=? WHERE event_id=?",
                    (moment, event["event_id"]),
                )
                delivered += 1
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise
    result = {
        "expired_orders": expired, "expired_swap_quotes": swap_quotes_expired,
        "payable_settlements": payable,
        "processed_events": delivered,
        "reconciled_payments": reconcile_result["confirmed"],
        "payment_queries_attempted": reconcile_result["attempted"],
        "payment_query_errors": reconcile_result["errors"],
        "pending_reconciliation_payments": reconcile_result["pending"],
        "manual_review_reconciliation_payments": reconcile_result["manual_review"],
        "credential_queries_attempted": credential_result["attempted"],
        "credential_queries_verified": credential_result["verified"],
        "credential_query_errors": credential_result["errors"],
        "platform_inventory_activated": platform_inventory_activated,
    }
    if credential_result["errors"]:
        record_payment_worker_result("qixiang_credential_verification_failed")
    elif reconcile_result["errors"]:
        record_payment_worker_result("payment_reconciliation_failed")
    elif reconcile_result["attempted"] > 0:
        record_payment_worker_result()
    elif credential_result["verified"]:
        record_qixiang_credential_recovery()
        record_payment_worker_heartbeat_if_healthy()
    elif (
        not reconcile_result["pending"]
        or reconcile_result["manual_review"] >= reconcile_result["pending"]
    ):
        record_payment_worker_heartbeat_if_healthy()
    return result


def maintenance_worker(stop_event: threading.Event) -> None:
    while not stop_event.wait(WORKER_INTERVAL_SECONDS):
        try:
            run_maintenance_cycle()
        except Exception as error:
            try:
                record_payment_worker_result(type(error).__name__)
            except Exception:
                pass
            print(f"Maintenance cycle failed: {error!r}")


def resolve_payment_reconciliation_review(
    connection: sqlite3.Connection,
    payment_id: str,
    moment: str,
) -> None:
    connection.execute(
        """UPDATE payment_reconciliation_reviews
           SET status='resolved',provider_status='1',resolution='payment_success',
               resolved_at=COALESCE(resolved_at,?),version=version+1,updated_at=?
           WHERE payment_id=? AND status IN ('open','acknowledged_monitoring')""",
        (moment, moment, payment_id),
    )


def apply_payment_callback(connection: sqlite3.Connection, provider: str, payload: dict,
                           signature: str, secret: str) -> sqlite3.Row:
    if not hmac.compare_digest(sign_payment(payload, secret), signature or ""):
        raise ApiError(401, "支付通知签名无效", "invalid_payment_signature")
    try:
        callback_time = int(payload["timestamp"])
    except (KeyError, ValueError, TypeError):
        raise ApiError(422, "支付通知时间戳无效", "invalid_payment_timestamp")
    if abs(int(time.time()) - callback_time) > 300:
        raise ApiError(409, "支付通知超出防重放时间窗", "payment_replay_window")
    if payload.get("status") != "SUCCESS" or payload.get("currency") != "CNY":
        raise ApiError(422, "支付状态或币种不符合入账条件", "payment_not_successful")

    connection.execute("BEGIN IMMEDIATE")
    try:
        payment = connection.execute("SELECT * FROM payments WHERE id=? AND provider=?", (payload.get("payment_id"), provider)).fetchone()
        if not payment:
            raise ApiError(404, "支付单不存在", "payment_not_found")
        order = fetch_order(connection, payment["order_id"])
        if str(payload.get("order_id")) != order["id"]:
            raise ApiError(409, "平台订单号不匹配", "order_mismatch")
        if str(payload.get("merchant_id")) not in ("KAI-MOCK", payment_merchant_id(provider)):
            raise ApiError(409, "商户号不匹配", "merchant_mismatch")
        if int(payload.get("amount_cents", -1)) != order["amount_cents"] or payment["amount_cents"] != order["amount_cents"]:
            raise ApiError(409, "支付金额不匹配", "amount_mismatch")
        existing = connection.execute("SELECT id FROM payments WHERE callback_event_id=?", (payload.get("event_id"),)).fetchone()
        if payment["status"] in ("success", "refunded") or existing:
            resolve_payment_reconciliation_review(
                connection, payment["id"], now_iso()
            )
            connection.execute("COMMIT")
            return fetch_order(connection, order["id"])
        callback_hash = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        late_payment = order["status"] in ("expired", "cancelled") or (
            order["status"] == "pending_payment"
            and order["reservation_expires_at"]
            and order["reservation_expires_at"] <= now_iso()
        )
        if late_payment:
            updated = now_iso()
            if order["status"] == "pending_payment":
                release_order_capacity(connection, order, "pending_payment")
            connection.execute(
                """UPDATE payments SET status='success',merchant_id=?,provider_txn_id=?,callback_event_id=?,
                   callback_hash=?,provider_status='SUCCESS',last_checked_at=?,updated_at=? WHERE id=?""",
                (payload["merchant_id"], payload["provider_txn_id"], payload["event_id"], callback_hash,
                 updated, updated, payment["id"]),
            )
            refund_id = uid("refund")
            connection.execute(
                """INSERT OR IGNORE INTO refunds(
                   id,order_id,payment_id,requester_user_id,amount_cents,reason,original_order_status,
                   status,idempotency_key,created_at,updated_at
                   ) VALUES(?,?,?,?,?,?,?,'pending_review',?,?,?)""",
                (refund_id, order["id"], payment["id"], order["buyer_user_id"], order["amount_cents"],
                 "支付完成时订单容量预留已过期，系统自动发起原路退款", "expired",
                 f"late-payment:{payment['id']}", updated, updated),
            )
            connection.execute(
                "UPDATE orders SET status='refund_pending',updated_at=? WHERE id=?",
                (updated, order["id"]),
            )
            connection.execute(
                """UPDATE card_hour_topups SET status='refund_pending',updated_at=?
                   WHERE order_id=? AND status IN ('pending','expired')""",
                (updated, order["id"]),
            )
            audit(connection, None, "order", order["id"], "payment.late_success_refund_required", {
                "payment_id": payment["id"], "provider": provider,
                "provider_txn_id": payload["provider_txn_id"], "amount_cents": order["amount_cents"],
            }, event_id=payload["event_id"])
            resolve_payment_reconciliation_review(
                connection, payment["id"], updated
            )
            connection.execute("COMMIT")
            return fetch_order(connection, order["id"])
        if order["status"] != "pending_payment":
            raise ApiError(409, "订单当前状态不能支付", "invalid_order_state")
        topup = connection.execute(
            "SELECT * FROM card_hour_topups WHERE order_id=?", (order["id"],)
        ).fetchone()
        if topup:
            captured_at = now_iso()
            connection.execute(
                """UPDATE payments SET status='success',merchant_id=?,provider_txn_id=?,callback_event_id=?,
                   callback_hash=?,provider_status='SUCCESS',last_checked_at=?,updated_at=? WHERE id=?""",
                (
                    payload["merchant_id"], payload["provider_txn_id"], payload["event_id"],
                    callback_hash, captured_at, captured_at, payment["id"],
                ),
            )
            connection.execute(
                "UPDATE orders SET status='accepted',payment_provider=?,accepted_at=?,updated_at=? WHERE id=?",
                (provider, captured_at, captured_at, order["id"]),
            )
            activate_card_hour_topup(connection, topup, order, captured_at)
            audit(connection, None, "order", order["id"], "payment.confirmed", {
                "payment_id": payment["id"], "provider": provider,
                "provider_txn_id": payload["provider_txn_id"],
                "amount_cents": order["amount_cents"], "currency": "CNY",
                "product": "card_hour_topup",
            }, event_id=payload["event_id"])
            resolve_payment_reconciliation_review(
                connection, payment["id"], captured_at
            )
            connection.execute("COMMIT")
            return fetch_order(connection, order["id"])
        listing = connection.execute("SELECT * FROM listings WHERE id=?", (order["listing_id"],)).fetchone()
        if not listing or listing["quote_reserved"] + 1e-9 < order["quantity"]:
            raise ApiError(409, "订单预留容量异常", "reservation_mismatch")
        connection.execute(
            """UPDATE payments SET status='success',merchant_id=?,provider_txn_id=?,callback_event_id=?,
               callback_hash=?,provider_status='SUCCESS',last_checked_at=?,updated_at=? WHERE id=?""",
            (payload["merchant_id"], payload["provider_txn_id"], payload["event_id"], callback_hash,
             now_iso(), now_iso(), payment["id"]),
        )
        connection.execute(
            "UPDATE listings SET quote_reserved=quote_reserved-?,order_locked=order_locked+?,version=version+1,updated_at=? WHERE id=? AND version=?",
            (order["quantity"], order["quantity"], now_iso(), listing["id"], listing["version"]),
        )
        if connection.execute("SELECT changes()").fetchone()[0] != 1:
            raise ApiError(409, "容量版本冲突，请重试", "capacity_version_conflict")
        connection.execute(
            "UPDATE orders SET status='paid',payment_provider=?,updated_at=? WHERE id=?",
            (provider, now_iso(), order["id"]),
        )
        audit(connection, None, "order", order["id"], "payment.confirmed", {
            "payment_id": payment["id"], "provider": provider, "provider_txn_id": payload["provider_txn_id"],
            "amount_cents": order["amount_cents"], "currency": "CNY"
        }, event_id=payload["event_id"])
        resolve_payment_reconciliation_review(
            connection, payment["id"], now_iso()
        )
        connection.execute("COMMIT")
        return fetch_order(connection, order["id"])
    except Exception:
        connection.execute("ROLLBACK")
        raise


def qixiang_callback_values(query: dict[str, list[str]]) -> dict[str, str]:
    if not query:
        raise ApiError(400, "七相支付通知参数为空", "empty_qixiangpay_callback")
    duplicates = [key for key, values in query.items() if len(values) != 1]
    if duplicates:
        raise ApiError(400, "七相支付通知包含重复参数", "duplicate_qixiangpay_callback_parameter")
    return {key: values[0] for key, values in query.items()}


def validate_qixiang_callback(params: dict[str, str]) -> None:
    if not QIXIANG_KEY or not QIXIANG_PID:
        raise ApiError(503, "七相支付商户配置尚未完成", "qixiangpay_not_configured")
    if str(params.get("sign_type") or "MD5").upper() != "MD5":
        raise ApiError(401, "七相支付通知签名类型无效", "invalid_qixiangpay_sign_type")
    if not qixiang_verify_signature(params, QIXIANG_KEY):
        raise ApiError(401, "七相支付通知签名无效", "invalid_qixiangpay_signature")
    if str(params.get("pid") or "") != QIXIANG_PID:
        raise ApiError(409, "七相支付通知商户号不匹配", "qixiangpay_merchant_mismatch")
    if params.get("trade_status") != "TRADE_SUCCESS":
        raise ApiError(422, "七相支付订单尚未成功", "qixiangpay_not_successful")
    if params.get("type") not in ("alipay", "wxpay"):
        raise ApiError(422, "七相支付通知支付方式无效", "invalid_qixiangpay_type")
    if not re.fullmatch(r"pay_[A-Za-z0-9_-]+", str(params.get("out_trade_no") or "")):
        raise ApiError(422, "七相支付通知订单号无效", "invalid_qixiangpay_order_number")


def record_qixiang_query_state(payment_id: str, provider_status: str) -> None:
    with db_connect() as connection:
        moment = now_iso()
        connection.execute(
            """UPDATE payments SET provider_status=?,last_checked_at=?,query_attempts=query_attempts+1,
               updated_at=? WHERE id=?""",
            (provider_status, moment, moment, payment_id),
        )
        payment = connection.execute(
            "SELECT status,provider_status,query_attempts,last_checked_at FROM payments WHERE id=?",
            (payment_id,),
        ).fetchone()
        if (
            payment
            and payment["status"] in ("pending", "closed")
            and int(payment["query_attempts"] or 0)
            >= QIXIANG_MANUAL_REVIEW_AFTER_ATTEMPTS
        ):
            connection.execute(
                """INSERT INTO payment_reconciliation_reviews(
                     payment_id,reason,provider_status,query_attempts,status,
                     first_flagged_at,last_checked_at,updated_at
                   ) VALUES(?, 'provider_nonterminal_after_attempt_threshold', ?, ?,
                            'open', ?, ?, ?)
                   ON CONFLICT(payment_id) DO UPDATE SET
                     provider_status=excluded.provider_status,
                     query_attempts=excluded.query_attempts,
                     last_checked_at=excluded.last_checked_at,
                     updated_at=excluded.updated_at
                   WHERE payment_reconciliation_reviews.status IN (
                     'open','acknowledged_monitoring'
                   )""",
                (
                    payment_id,
                    payment["provider_status"],
                    int(payment["query_attempts"] or 0),
                    moment,
                    payment["last_checked_at"],
                    moment,
                ),
            )


def payment_reconciliation_review_counts() -> dict[str, int]:
    with db_connect() as connection:
        rows = connection.execute(
            """SELECT status,COUNT(*) AS count
               FROM payment_reconciliation_reviews
               WHERE status IN ('open','acknowledged_monitoring')
               GROUP BY status"""
        ).fetchall()
    counts = {"open": 0, "acknowledged_monitoring": 0}
    for row in rows:
        counts[str(row["status"])] = int(row["count"] or 0)
    return counts


def payment_manual_review_count() -> int:
    return payment_reconciliation_review_counts()["open"]


def payment_monitored_review_count() -> int:
    counts = payment_reconciliation_review_counts()
    return counts["open"] + counts["acknowledged_monitoring"]


def qixiang_provider_order_digest(provider_order: dict) -> str:
    evidence = {
        key: str(provider_order.get(key) or "")
        for key in (
            "pid",
            "out_trade_no",
            "trade_no",
            "type",
            "money",
            "status",
            "addtime",
            "endtime",
        )
    }
    return hashlib.sha256(
        json.dumps(
            evidence,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def payment_reconciliation_action_request_hash(
    payment_id: str,
    action: str,
    reason: str,
) -> str:
    request = {
        "payment_id": str(payment_id),
        "action": str(action),
        "reason": str(reason).strip(),
    }
    return hashlib.sha256(
        json.dumps(
            request,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def claim_payment_reconciliation_command(
    *,
    payment_id: str,
    actor_user_id: str,
    action: str,
    reason: str,
    idempotency_key: str,
) -> dict:
    request_hash = payment_reconciliation_action_request_hash(
        payment_id,
        action,
        reason,
    )
    lease_token = secrets.token_urlsafe(18)
    now_epoch = int(time.time())
    moment = now_iso()
    lease_until = now_epoch + QIXIANG_TIMEOUT_SECONDS + 20
    with db_connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            command = connection.execute(
                """SELECT * FROM payment_reconciliation_commands
                   WHERE actor_user_id=? AND idempotency_key=?""",
                (actor_user_id, idempotency_key),
            ).fetchone()
            if command:
                if (
                    command["payment_id"] != payment_id
                    or command["action"] != action
                    or not hmac.compare_digest(
                        str(command["request_hash"]),
                        request_hash,
                    )
                ):
                    raise ApiError(
                        409,
                        "幂等键已用于不同的人工核单请求",
                        "payment_review_idempotency_conflict",
                    )
                if command["state"] == "completed":
                    response = json.loads(command["response_json"] or "{}")
                    connection.execute("COMMIT")
                    return {
                        "state": "completed",
                        "response_status": int(command["response_status"] or 200),
                        "response": response,
                        "request_hash": request_hash,
                    }
                if (
                    command["state"] == "processing"
                    and int(command["lease_until_epoch"] or 0) > now_epoch
                ):
                    connection.execute("COMMIT")
                    return {
                        "state": "processing",
                        "request_hash": request_hash,
                    }
                connection.execute(
                    """UPDATE payment_reconciliation_commands
                       SET state='processing',lease_token=?,lease_until_epoch=?,
                           last_error_code=NULL,updated_at=?
                       WHERE actor_user_id=? AND idempotency_key=?""",
                    (
                        lease_token,
                        lease_until,
                        moment,
                        actor_user_id,
                        idempotency_key,
                    ),
                )
            else:
                connection.execute(
                    """INSERT INTO payment_reconciliation_commands(
                         actor_user_id,idempotency_key,payment_id,action,request_hash,
                         state,lease_token,lease_until_epoch,created_at,updated_at
                       ) VALUES(?,?,?,?,?,'processing',?,?,?,?)""",
                    (
                        actor_user_id,
                        idempotency_key,
                        payment_id,
                        action,
                        request_hash,
                        lease_token,
                        lease_until,
                        moment,
                        moment,
                    ),
                )
            connection.execute("COMMIT")
            return {
                "state": "claimed",
                "lease_token": lease_token,
                "request_hash": request_hash,
            }
        except Exception:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise


def payment_reconciliation_command_result(
    actor_user_id: str,
    idempotency_key: str,
) -> dict | None:
    with db_connect() as connection:
        command = connection.execute(
            """SELECT state,response_status,response_json
               FROM payment_reconciliation_commands
               WHERE actor_user_id=? AND idempotency_key=?""",
            (actor_user_id, idempotency_key),
        ).fetchone()
    if not command or command["state"] != "completed":
        return None
    return {
        "response_status": int(command["response_status"] or 200),
        "response": json.loads(command["response_json"] or "{}"),
    }


def complete_payment_reconciliation_command(
    *,
    actor_user_id: str,
    idempotency_key: str,
    lease_token: str,
    response_status: int,
    response: dict,
) -> None:
    moment = now_iso()
    serialized = json.dumps(
        response,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    with db_connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute(
                """UPDATE payment_reconciliation_commands
                   SET state='completed',lease_token=NULL,lease_until_epoch=0,
                       response_status=?,response_json=?,last_error_code=NULL,updated_at=?
                   WHERE actor_user_id=? AND idempotency_key=?
                     AND state='processing' AND lease_token=?""",
                (
                    int(response_status),
                    serialized,
                    moment,
                    actor_user_id,
                    idempotency_key,
                    lease_token,
                ),
            )
            if connection.execute("SELECT changes()").fetchone()[0] != 1:
                command = connection.execute(
                    """SELECT state FROM payment_reconciliation_commands
                       WHERE actor_user_id=? AND idempotency_key=?""",
                    (actor_user_id, idempotency_key),
                ).fetchone()
                if not command or command["state"] != "completed":
                    raise ApiError(
                        409,
                        "人工核单命令租约已失效，请使用同一幂等键重试",
                        "payment_review_command_lease_lost",
                    )
            connection.execute("COMMIT")
        except Exception:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise


def fail_payment_reconciliation_command(
    *,
    actor_user_id: str,
    idempotency_key: str,
    lease_token: str,
    error_code: str,
) -> None:
    with db_connect() as connection:
        connection.execute(
            """UPDATE payment_reconciliation_commands
               SET state='failed_retryable',lease_token=NULL,lease_until_epoch=0,
                   last_error_code=?,updated_at=?
               WHERE actor_user_id=? AND idempotency_key=?
                 AND state='processing' AND lease_token=?""",
            (
                str(error_code)[:120],
                now_iso(),
                actor_user_id,
                idempotency_key,
                lease_token,
            ),
        )


def apply_payment_reconciliation_action(
    *,
    payment_id: str,
    actor_user_id: str,
    action: str,
    reason: str,
    idempotency_key: str,
    evidence_digest: str | None = None,
) -> tuple[sqlite3.Row, bool]:
    if action not in ("acknowledge_monitoring", "reopen"):
        raise ApiError(
            422,
            "七相未提供不可逆未支付终态，当前只能确认继续监控或重新打开核单",
            "payment_review_action_not_allowed",
        )
    request_hash = payment_reconciliation_action_request_hash(
        payment_id,
        action,
        reason,
    )
    moment = now_iso()
    with db_connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            existing = connection.execute(
                """SELECT * FROM payment_reconciliation_review_actions
                   WHERE actor_user_id=? AND idempotency_key=?""",
                (actor_user_id, idempotency_key),
            ).fetchone()
            if existing:
                existing_request_hash = str(existing["request_hash"] or "")
                if not existing_request_hash:
                    existing_request_hash = payment_reconciliation_action_request_hash(
                        existing["payment_id"],
                        existing["action"],
                        existing["reason"],
                    )
                if (
                    existing["payment_id"] != payment_id
                    or existing["action"] != action
                    or not hmac.compare_digest(
                        existing_request_hash,
                        request_hash,
                    )
                ):
                    raise ApiError(
                        409,
                        "幂等键已用于其他人工核单动作",
                        "payment_review_idempotency_conflict",
                    )
                review = connection.execute(
                    "SELECT * FROM payment_reconciliation_reviews WHERE payment_id=?",
                    (payment_id,),
                ).fetchone()
                connection.execute("COMMIT")
                return review, True
            if action == "acknowledge_monitoring" and not re.fullmatch(
                r"[0-9a-f]{64}", evidence_digest or ""
            ):
                raise ApiError(
                    422,
                    "确认继续监控前必须完成七相权威查单",
                    "payment_review_provider_evidence_required",
                )
            review = connection.execute(
                "SELECT * FROM payment_reconciliation_reviews WHERE payment_id=?",
                (payment_id,),
            ).fetchone()
            payment = connection.execute(
                "SELECT status,provider_status FROM payments WHERE id=?",
                (payment_id,),
            ).fetchone()
            if not review or not payment:
                raise ApiError(
                    404,
                    "人工核单记录不存在",
                    "payment_review_not_found",
                )
            old_version = int(review["version"] or 1)
            new_version = old_version + 1
            provider_status = str(payment["provider_status"] or "")
            if action == "acknowledge_monitoring":
                if review["status"] != "open":
                    raise ApiError(
                        409,
                        "该人工核单已确认或已解决",
                        "payment_review_not_open",
                    )
                if payment["status"] not in ("pending", "closed") or provider_status == "1":
                    raise ApiError(
                        409,
                        "支付状态已变化，不能标记为继续监控",
                        "payment_review_status_changed",
                    )
                connection.execute(
                    """UPDATE payment_reconciliation_reviews
                       SET status='acknowledged_monitoring',version=?,
                           acknowledged_at=?,acknowledged_by=?,
                           acknowledgement_reason=?,evidence_digest=?,updated_at=?
                       WHERE payment_id=? AND status='open' AND version=?""",
                    (
                        new_version,
                        moment,
                        actor_user_id,
                        reason,
                        evidence_digest,
                        moment,
                        payment_id,
                        old_version,
                    ),
                )
                event_type = "payment.reconciliation_monitoring_acknowledged"
            else:
                if review["status"] != "acknowledged_monitoring":
                    raise ApiError(
                        409,
                        "只有已确认继续监控的核单才能重新打开",
                        "payment_review_not_acknowledged",
                    )
                connection.execute(
                    """UPDATE payment_reconciliation_reviews
                       SET status='open',version=?,acknowledged_at=NULL,
                           acknowledged_by=NULL,acknowledgement_reason=NULL,
                           evidence_digest=NULL,updated_at=?
                       WHERE payment_id=? AND status='acknowledged_monitoring' AND version=?""",
                    (new_version, moment, payment_id, old_version),
                )
                event_type = "payment.reconciliation_monitoring_reopened"
            if connection.execute("SELECT changes()").fetchone()[0] != 1:
                raise ApiError(
                    409,
                    "人工核单状态发生变化，请刷新后重试",
                    "payment_review_version_conflict",
                )
            action_id = uid("pra")
            connection.execute(
                """INSERT INTO payment_reconciliation_review_actions(
                     id,payment_id,action,actor_user_id,reason,provider_status,
                     evidence_digest,old_version,new_version,idempotency_key,
                     request_hash,created_at
                   ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    action_id,
                    payment_id,
                    action,
                    actor_user_id,
                    reason,
                    provider_status,
                    evidence_digest,
                    old_version,
                    new_version,
                    idempotency_key,
                    request_hash,
                    moment,
                ),
            )
            audit(
                connection,
                actor_user_id,
                "payment_reconciliation_review",
                payment_id,
                event_type,
                {
                    "action": action,
                    "reason": reason,
                    "provider_status": provider_status,
                    "evidence_digest": evidence_digest,
                    "old_version": old_version,
                    "new_version": new_version,
                    "monitoring_continues": True,
                    "economic_state_changed": False,
                },
                idempotency_key,
            )
            updated = connection.execute(
                "SELECT * FROM payment_reconciliation_reviews WHERE payment_id=?",
                (payment_id,),
            ).fetchone()
            connection.execute("COMMIT")
            return updated, False
        except Exception:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise


def acquire_qixiang_query_permit(payment_id: str) -> str:
    now_epoch = int(time.time())
    lease_owner = secrets.token_urlsafe(18)
    with db_connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            state = connection.execute(
                "SELECT * FROM qixiang_query_state WHERE state_key='merchant'"
            ).fetchone()
            if not state:
                connection.execute(
                    """INSERT INTO qixiang_query_state(
                       state_key,window_started_epoch,query_count,consecutive_failures,
                       circuit_open_until_epoch,updated_at
                       ) VALUES('merchant',?,0,0,0,?)""",
                    (now_epoch, now_iso()),
                )
                state = connection.execute(
                    "SELECT * FROM qixiang_query_state WHERE state_key='merchant'"
                ).fetchone()
            if int(state["circuit_open_until_epoch"] or 0) > now_epoch:
                raise ApiError(503, "支付查单通道正在自动恢复，请稍后重试", "qixiang_query_circuit_open")
            window_started = int(state["window_started_epoch"] or 0)
            query_count = int(state["query_count"] or 0)
            if now_epoch - window_started >= 60:
                window_started = now_epoch
                query_count = 0
            if query_count >= QIXIANG_QUERY_LIMIT_PER_MINUTE:
                raise ApiError(429, "支付查单过于频繁，请稍后重试", "qixiang_query_rate_limited")
            lease = connection.execute(
                "SELECT * FROM qixiang_query_leases WHERE payment_id=?", (payment_id,)
            ).fetchone()
            if lease and int(lease["lease_until_epoch"] or 0) > now_epoch:
                raise ApiError(409, "该支付单正在核验，请稍后刷新", "qixiang_query_in_progress")
            connection.execute(
                """INSERT INTO qixiang_query_leases(payment_id,lease_owner,lease_until_epoch,updated_at)
                   VALUES(?,?,?,?)
                   ON CONFLICT(payment_id) DO UPDATE SET lease_owner=excluded.lease_owner,
                     lease_until_epoch=excluded.lease_until_epoch,updated_at=excluded.updated_at""",
                (payment_id, lease_owner, now_epoch + QIXIANG_TIMEOUT_SECONDS + 8, now_iso()),
            )
            connection.execute(
                """UPDATE qixiang_query_state SET window_started_epoch=?,query_count=?,updated_at=?
                   WHERE state_key='merchant'""",
                (window_started, query_count + 1, now_iso()),
            )
            connection.execute("COMMIT")
        except Exception:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise
    return lease_owner


def finish_qixiang_query(payment_id: str, lease_owner: str, *, succeeded: bool) -> None:
    with db_connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute(
                "DELETE FROM qixiang_query_leases WHERE payment_id=? AND lease_owner=?",
                (payment_id, lease_owner),
            )
            if succeeded:
                connection.execute(
                    """UPDATE qixiang_query_state SET consecutive_failures=0,
                       circuit_open_until_epoch=0,updated_at=? WHERE state_key='merchant'""",
                    (now_iso(),),
                )
            else:
                state = connection.execute(
                    "SELECT consecutive_failures FROM qixiang_query_state WHERE state_key='merchant'"
                ).fetchone()
                failures = int(state["consecutive_failures"] or 0) + 1 if state else 1
                circuit_until = (
                    int(time.time()) + QIXIANG_QUERY_CIRCUIT_SECONDS
                    if failures >= QIXIANG_QUERY_FAILURE_THRESHOLD
                    else 0
                )
                connection.execute(
                    """UPDATE qixiang_query_state SET consecutive_failures=?,
                       circuit_open_until_epoch=?,updated_at=? WHERE state_key='merchant'""",
                    (failures, circuit_until, now_iso()),
                )
            connection.execute("COMMIT")
        except Exception:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise


def acquire_qixiang_checkout_lease(payment_id: str) -> str:
    """Claim the only provider-create attempt for a payment intent.

    The state is changed to ``submitting`` in the same SQLite transaction as
    the lease.  A process crash therefore leaves an explicit ambiguous state;
    no retry is allowed to call the provider a second time for the same
    out_trade_no.  The reconciliation worker owns recovery from that state.
    """
    lease_owner = secrets.token_urlsafe(18)
    now_epoch = int(time.time())
    with db_connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            payment = connection.execute(
                "SELECT * FROM payments WHERE id=?", (payment_id,)
            ).fetchone()
            if not payment:
                raise ApiError(404, "支付单不存在", "payment_not_found")
            if payment["checkout_url"]:
                connection.execute("COMMIT")
                return ""
            if payment["checkout_state"] != "creating":
                raise ApiError(
                    503,
                    "支付下单结果正在自动核验，请稍后查看订单状态",
                    "payment_checkout_uncertain",
                )
            lease = connection.execute(
                "SELECT * FROM qixiang_checkout_leases WHERE payment_id=?", (payment_id,)
            ).fetchone()
            if lease and int(lease["lease_until_epoch"] or 0) > now_epoch:
                raise ApiError(409, "该支付单正在创建，请稍后重试", "payment_checkout_in_progress")
            connection.execute(
                """INSERT INTO qixiang_checkout_leases(
                     payment_id,lease_owner,lease_until_epoch,updated_at
                   ) VALUES(?,?,?,?)
                   ON CONFLICT(payment_id) DO UPDATE SET
                     lease_owner=excluded.lease_owner,
                     lease_until_epoch=excluded.lease_until_epoch,
                     updated_at=excluded.updated_at""",
                (payment_id, lease_owner, now_epoch + QIXIANG_CHECKOUT_LEASE_SECONDS, now_iso()),
            )
            connection.execute(
                "UPDATE payments SET checkout_state='submitting',updated_at=? WHERE id=? AND checkout_state='creating'",
                (now_iso(), payment_id),
            )
            if connection.execute("SELECT changes()").fetchone()[0] != 1:
                raise ApiError(409, "支付单创建状态冲突", "payment_checkout_state_conflict")
            connection.execute("COMMIT")
        except Exception:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise
    return lease_owner


def finish_qixiang_checkout_lease(payment_id: str, lease_owner: str) -> None:
    if not lease_owner:
        return
    with db_connect() as connection:
        connection.execute(
            "DELETE FROM qixiang_checkout_leases WHERE payment_id=? AND lease_owner=?",
            (payment_id, lease_owner),
        )


def confirm_qixiang_query(payment_id: str, provider_order: dict,
                          callback_params: dict[str, str] | None = None) -> tuple[sqlite3.Row, bool]:
    with db_connect() as connection:
        payment = connection.execute("SELECT * FROM payments WHERE id=?", (payment_id,)).fetchone()
        if not payment:
            raise ApiError(404, "支付单不存在", "payment_not_found")
        order = fetch_order(connection, payment["order_id"])
    expected_type = "alipay" if payment["provider"] == "alipay" else "wxpay"
    if str(provider_order.get("pid") or "") != QIXIANG_PID:
        raise ApiError(409, "七相支付查单商户号不匹配", "qixiangpay_query_merchant_mismatch")
    if str(provider_order.get("out_trade_no") or "") != payment["id"]:
        raise ApiError(409, "七相支付查单订单号不匹配", "qixiangpay_query_order_mismatch")
    if str(provider_order.get("type") or "") != expected_type:
        raise ApiError(409, "七相支付查单支付方式不匹配", "qixiangpay_query_type_mismatch")
    try:
        provider_amount_cents = qixiang_money_to_cents(provider_order.get("money"))
    except QixiangPayError as error:
        raise ApiError(409, str(error), error.code)
    if provider_amount_cents != int(payment["amount_cents"]) or provider_amount_cents != int(order["amount_cents"]):
        raise ApiError(409, "七相支付查单金额不匹配", "qixiangpay_query_amount_mismatch")
    provider_status = str(provider_order.get("status") or "0")
    if provider_status != "1":
        record_qixiang_query_state(payment_id, provider_status)
        return order, False
    provider_txn_id = clean_text(provider_order.get("trade_no"), "七相支付订单号", 3, 160)
    if callback_params:
        if callback_params.get("out_trade_no") != payment["id"]:
            raise ApiError(409, "七相支付通知订单号不匹配", "qixiangpay_callback_order_mismatch")
        if callback_params.get("type") != expected_type:
            raise ApiError(409, "七相支付通知支付方式不匹配", "qixiangpay_callback_type_mismatch")
        try:
            callback_amount_cents = qixiang_money_to_cents(callback_params.get("money"))
        except QixiangPayError as error:
            raise ApiError(409, str(error), error.code)
        if callback_amount_cents != provider_amount_cents:
            raise ApiError(409, "七相支付通知金额不匹配", "qixiangpay_callback_amount_mismatch")
        if callback_params.get("trade_no") != provider_txn_id:
            raise ApiError(409, "七相支付通知流水号不匹配", "qixiangpay_callback_trade_mismatch")
        if callback_params.get("param") and callback_params.get("param") != order["id"]:
            raise ApiError(409, "七相支付通知扩展参数不匹配", "qixiangpay_callback_param_mismatch")
    event_source = f"{QIXIANG_PID}|{provider_txn_id}|{payment['id']}|TRADE_SUCCESS"
    payload = {
        "event_id": "qixiang_" + hashlib.sha256(event_source.encode("utf-8")).hexdigest()[:40],
        "payment_id": payment["id"],
        "order_id": order["id"],
        "provider_txn_id": provider_txn_id,
        "merchant_id": QIXIANG_PID,
        "amount_cents": provider_amount_cents,
        "currency": "CNY",
        "status": "SUCCESS",
        "timestamp": int(time.time()),
    }
    signature = sign_payment(payload, QIXIANG_KEY)
    with db_connect() as connection:
        confirmed = apply_payment_callback(
            connection, payment["provider"], payload, signature, QIXIANG_KEY
        )
    return confirmed, True


def query_and_confirm_qixiang_payment_with_evidence(
    payment_id: str,
    callback_params: dict[str, str] | None = None,
) -> tuple[sqlite3.Row, bool, dict]:
    if not PAYMENT_RECONCILIATION_ENABLED and not ALLOW_DEMO:
        raise ApiError(
            503,
            "支付核单通道已暂停",
            "payment_reconciliation_disabled",
        )
    lease_owner = acquire_qixiang_query_permit(payment_id)
    try:
        provider_order = qixiang_query_order(qixiang_config(), out_trade_no=payment_id)
    except QixiangPayError as error:
        print(f"QixiangPay query error: {error.code}")
        finish_qixiang_query(payment_id, lease_owner, succeeded=False)
        raise ApiError(502, str(error), error.code)
    try:
        result = confirm_qixiang_query(payment_id, provider_order, callback_params)
    except Exception:
        finish_qixiang_query(payment_id, lease_owner, succeeded=False)
        raise
    finish_qixiang_query(payment_id, lease_owner, succeeded=True)
    return result[0], result[1], provider_order


def query_and_confirm_qixiang_payment(payment_id: str,
                                       callback_params: dict[str, str] | None = None) -> tuple[sqlite3.Row, bool]:
    order, paid, _ = query_and_confirm_qixiang_payment_with_evidence(
        payment_id,
        callback_params,
    )
    return order, paid


def reconcile_pending_qixiang_payments(limit: int = 10) -> dict[str, int]:
    if (
        PAYMENT_GATEWAY != "qixiang"
        or not PAYMENT_RECONCILIATION_ENABLED
        or not payment_readiness("alipay")["configured"]
    ):
        return {
            "pending": 0,
            "manual_review": payment_monitored_review_count(),
            "attempted": 0,
            "confirmed": 0,
            "errors": 0,
        }
    query_before = (datetime.now(timezone.utc) - timedelta(seconds=60)).replace(microsecond=0).isoformat()
    manual_review_before = (
        datetime.now(timezone.utc)
        - timedelta(seconds=QIXIANG_MANUAL_REVIEW_BACKOFF_SECONDS)
    ).replace(microsecond=0).isoformat()
    with db_connect() as connection:
        pending = connection.execute(
            """SELECT COUNT(*) FROM payments
               WHERE gateway='qixiang' AND status IN ('pending','closed')""",
        ).fetchone()[0]
        monitored_reviews = connection.execute(
            """SELECT COUNT(*) FROM payment_reconciliation_reviews
               WHERE status IN ('open','acknowledged_monitoring')"""
        ).fetchone()[0]
        rows = connection.execute(
            """SELECT id FROM payments
               WHERE gateway='qixiang' AND status IN ('pending','closed')
               AND (
                 last_checked_at IS NULL
                 OR (query_attempts<? AND last_checked_at<=?)
                 OR (query_attempts>=? AND last_checked_at<=?)
               )
               ORDER BY COALESCE(last_checked_at,created_at),created_at LIMIT ?""",
            (
                QIXIANG_MANUAL_REVIEW_AFTER_ATTEMPTS,
                query_before,
                QIXIANG_MANUAL_REVIEW_AFTER_ATTEMPTS,
                manual_review_before,
                max(1, min(limit, 20)),
            ),
        ).fetchall()
    confirmed = 0
    errors = 0
    for row in rows:
        try:
            _, paid = query_and_confirm_qixiang_payment(row["id"])
            confirmed += int(paid)
        except ApiError as error:
            record_qixiang_query_state(row["id"], f"ERROR:{error.code}"[:80])
            errors += 1
    return {
        "pending": int(pending or 0),
        "manual_review": int(monitored_reviews or 0),
        "attempted": len(rows),
        "confirmed": confirmed,
        "errors": errors,
    }


class KaiHandler(BaseHTTPRequestHandler):
    server_version = "KAICloud/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        # 七相使用带签名参数的 GET 回调，日志只能记录路径，不能记录查询串。
        status = args[1] if len(args) > 1 else "-"
        print(f"{self.address_string()} {self.command} {urlparse(self.path).path} {status}")

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Allow", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        try:
            parsed_request = urlparse(self.path)
            path = parsed_request.path
            if path == "/api/payments/callback/qixiang":
                return self.qixiang_payment_callback(
                    parse_qs(parsed_request.query, keep_blank_values=True)
                )
            if path == "/api/payments/return/qixiang":
                return self.qixiang_payment_return(
                    parse_qs(parsed_request.query, keep_blank_values=True)
                )
            if path == "/api/payments/return/qixiang/app":
                return self.qixiang_payment_return(
                    parse_qs(parsed_request.query, keep_blank_values=True),
                    app_surface=True,
                )
            if path == "/api/payments/status":
                return self.get_payment_status(parse_qs(parsed_request.query))
            if path == "/api/health":
                readiness = integration_readiness()
                worker_ready = payment_worker_ready()
                review_counts = payment_reconciliation_review_counts()
                provider_ready = any(item["configured"] for item in readiness["payment"].values())
                create_ready = any(
                    payment_creation_ready(provider)
                    for provider in ("alipay", "wechat")
                )
                app_release_ready = readiness["app_release"]["ready"]
                return self.json_response(200, {
                    "ok": True, "service": "kai-transaction", "phase": 1,
                    "payment_mode": "mock" if ALLOW_DEMO else "provider",
                    "auth_provider": "kai_identity",
                    "auth_ready": readiness["identity"]["configured"],
                    "sms_ready": readiness["sms"]["configured"],
                    "payment_ready": provider_ready,
                    "payment_create_enabled": PAYMENT_CREATE_ENABLED,
                    "payment_create_ready": create_ready,
                    "app_order_only_enabled": APP_ORDER_ONLY_ENABLED,
                    "app_order_only_ready": (
                        APP_ORDER_ONLY_ENABLED and readiness["identity"]["configured"]
                    ),
                    "payment_reconciliation_enabled": PAYMENT_RECONCILIATION_ENABLED,
                    "payment_reconciliation_ready": (
                        PAYMENT_RECONCILIATION_ENABLED and provider_ready and worker_ready
                    ),
                    "payment_worker_ready": worker_ready,
                    "payment_manual_review_count": review_counts["open"],
                    "payment_monitoring_acknowledged_count": review_counts["acknowledged_monitoring"],
                    "app_release_ready": app_release_ready,
                    "card_hour_topup_ready": create_ready and app_release_ready,
                })
            if path == "/api/config/readiness":
                return self.json_response(200, integration_readiness())
            if path == "/api/market/status":
                return self.json_response(200, app_market_status())
            if path == "/api/market/instruments":
                query = parse_qs(parsed_request.query)
                category = query.get("category", ["gpu"])[0]
                return self.json_response(200, app_market_instruments(category))
            if path == "/api/market/candles":
                query = parse_qs(parsed_request.query)
                instrument_id = query.get("instrumentId", [""])[0]
                if instrument_id:
                    range_id = query.get("range", ["30d"])[0]
                    app_interval = query.get("interval", ["1d"])[0]
                    return self.json_response(200, app_market_candles(instrument_id, range_id, app_interval))
                kind = query.get("kind", ["gpu"])[0]
                default_product = MARKET_PRODUCTS.get(kind, MARKET_PRODUCTS["gpu"])[0]["id"]
                product_id = query.get("product", [default_product])[0]
                region_id = query.get("region", ["chengdu"])[0]
                interval = query.get("interval", ["15m"])[0]
                try:
                    limit = int(query.get("limit", ["72"])[0])
                except ValueError:
                    raise ApiError(422, "K 线数量无效", "invalid_market_limit")
                return self.json_response(200, build_market_candles(kind, product_id, region_id, interval, limit))
            if path == "/api/auth/kai/start":
                return self.kai_identity_start(parse_qs(parsed_request.query))
            if path == "/api/auth/kai/callback":
                return self.kai_identity_callback(parse_qs(parsed_request.query))
            if path == "/api/auth/kai/mobile/start":
                return self.kai_identity_start(parse_qs(parsed_request.query), mobile=True)
            if path == "/api/auth/kai/mobile/callback":
                return self.kai_identity_callback(parse_qs(parsed_request.query), mobile=True)
            if path == "/api/auth/me":
                return self.get_me()
            if path == "/api/catalog":
                return self.get_catalog()
            if path == "/api/agent/compute-products":
                return self.get_compute_products()
            if path == "/api/purchase-requests":
                return self.get_purchase_requests()
            if path == "/api/environment-preflights":
                return self.get_environment_preflights()
            environment_preflight_match = re.fullmatch(r"/api/environment-preflights/([^/]+)", path)
            if environment_preflight_match:
                return self.get_environment_preflight(environment_preflight_match.group(1))
            if path == "/api/orders":
                return self.get_orders()
            if path == "/api/assets":
                return self.get_assets()
            if path == "/api/card-hours":
                return self.get_card_hours()
            card_hour_topup_match = re.fullmatch(r"/api/card-hours/topups/([^/]+)", path)
            if card_hour_topup_match:
                return self.get_card_hour_topup_status(card_hour_topup_match.group(1))
            if path == "/api/withdrawals":
                return self.get_withdrawals()
            if path == "/api/access-requests":
                return self.get_access_requests()
            if path == "/api/audit/recent":
                return self.get_recent_audit()
            if path == "/api/supplier/workbench":
                return self.get_supplier_workbench()
            if path in ("/api/supplier-rebate/overview", "/api/supplier-referral/overview"):
                return self.get_supplier_rebate_overview()
            if path == "/api/admin/overview":
                return self.get_admin_overview()
            if path == "/api/admin/access-requests":
                return self.get_admin_access_requests()
            if path == "/api/cases":
                return self.get_cases()
            if path == "/api/swaps":
                return self.get_swap_requests()
            if path == "/api/account/deletion-status":
                return self.get_account_deletion_status()
            if path == "/api/app/release-readiness":
                return self.get_app_release_readiness()
            if path == "/api/public/operator":
                return self.get_public_operator()
            supplier_license_match = re.fullmatch(r"/api/admin/supplier-applications/([^/]+)/license", path)
            if supplier_license_match:
                return self.download_supplier_license(supplier_license_match.group(1))
            rebate_evidence_match = re.fullmatch(r"/api/supplier-rebates/([^/]+)/evidence", path)
            if rebate_evidence_match:
                return self.download_supplier_rebate_evidence(rebate_evidence_match.group(1))
            return self.serve_static(path)
        except ApiError as error:
            self.api_error(error)
        except Exception as error:
            print(f"Unhandled GET error: {error!r}")
            self.api_error(ApiError(500, "服务暂时不可用", "internal_error"))

    def do_POST(self) -> None:
        try:
            path = urlparse(self.path).path
            if not self.origin_is_same_site():
                raise ApiError(403, "请求来源校验失败", "origin_rejected")
            if path == "/api/auth/register":
                return self.register()
            if path == "/api/auth/send-code":
                return self.send_registration_code()
            if path == "/api/auth/login":
                return self.login()
            if path == "/api/auth/kai/mobile/prepare":
                return self.prepare_mobile_identity_login()
            if path == "/api/auth/kai/mobile/session":
                return self.create_mobile_identity_session()
            if path == "/api/auth/demo-login":
                return self.demo_login()
            if path == "/api/auth/logout":
                return self.logout()
            if path == "/api/auth/change-password":
                return self.change_password()
            if path == "/api/suppliers/applications":
                return self.create_supplier_application()
            if path == "/api/assets/intake":
                return self.create_resource_intake()
            if path == "/api/supplier/listings":
                return self.create_supplier_listing()
            if path == "/api/withdrawals":
                return self.create_withdrawal()
            if path == "/api/access-requests":
                return self.create_access_request()
            if path == "/api/orders":
                return self.create_order()
            if path == "/api/agent/compute-match":
                return self.create_compute_agent_match()
            if path == "/api/agent/compute-requests":
                return self.create_compute_product_request()
            if path == "/api/purchase-requests":
                return self.create_purchase_request()
            if path == "/api/supplier-rebate/submissions":
                return self.create_supplier_rebate_submission()
            if path == "/api/environment-preflights":
                return self.create_environment_preflight()
            if path == "/api/payments/create":
                return self.create_payment()
            if path == "/api/card-hours/topups":
                return self.create_card_hour_topup()
            if path == "/api/payments/mock-complete":
                return self.mock_complete_payment()
            if path == "/api/metering":
                return self.create_metering_record()
            if path == "/api/disputes":
                return self.create_dispute()
            if path == "/api/refunds":
                return self.create_refund()
            if path == "/api/invoices":
                return self.create_invoice_request()
            if path == "/api/swaps":
                return self.create_swap_request()
            if path == "/api/account/deletion-request":
                return self.create_account_deletion_request()
            if path == "/api/account/deletion-cancel":
                return self.cancel_account_deletion_request()
            if path == "/api/admin/maintenance/run":
                return self.admin_run_maintenance()
            if path == "/api/admin/payments/qixiang/verify":
                return self.admin_verify_qixiang_merchant()
            payment_review_action_match = re.fullmatch(
                r"/api/admin/payment-reconciliation-reviews/([^/]+)/action",
                path,
            )
            if payment_review_action_match:
                return self.admin_payment_reconciliation_action(
                    payment_review_action_match.group(1)
                )
            access_cancel_match = re.fullmatch(r"/api/access-requests/([^/]+)/cancel", path)
            if access_cancel_match:
                return self.cancel_access_request(access_cancel_match.group(1))
            access_review_match = re.fullmatch(r"/api/admin/access-requests/([^/]+)/review", path)
            if access_review_match:
                return self.admin_review_access_request(access_review_match.group(1))
            callback_match = re.fullmatch(r"/api/payments/callback/(alipay|wechat)", path)
            if callback_match:
                return self.real_payment_callback(callback_match.group(1))
            refund_callback_match = re.fullmatch(r"/api/payments/refund-callback/(alipay|wechat)", path)
            if refund_callback_match:
                return self.real_refund_callback(refund_callback_match.group(1))
            deliver_match = re.fullmatch(r"/api/orders/([^/]+)/demo-deliver", path)
            if deliver_match:
                return self.demo_deliver(deliver_match.group(1))
            supplier_confirm_match = re.fullmatch(r"/api/supplier/orders/([^/]+)/confirm", path)
            if supplier_confirm_match:
                return self.supplier_confirm_order(supplier_confirm_match.group(1))
            supplier_deliver_match = re.fullmatch(r"/api/supplier/orders/([^/]+)/deliver", path)
            if supplier_deliver_match:
                return self.supplier_deliver_order(supplier_deliver_match.group(1))
            accept_match = re.fullmatch(r"/api/orders/([^/]+)/accept", path)
            if accept_match:
                return self.accept_order(accept_match.group(1))
            cancel_match = re.fullmatch(r"/api/orders/([^/]+)/cancel", path)
            if cancel_match:
                return self.cancel_order(cancel_match.group(1))
            supplier_review_match = re.fullmatch(r"/api/admin/suppliers/([^/]+)/review", path)
            if supplier_review_match:
                return self.admin_review_supplier(supplier_review_match.group(1))
            intake_review_match = re.fullmatch(r"/api/admin/intakes/([^/]+)/review", path)
            if intake_review_match:
                return self.admin_review_intake(intake_review_match.group(1))
            listing_review_match = re.fullmatch(r"/api/admin/listings/([^/]+)/review", path)
            if listing_review_match:
                return self.admin_review_listing(listing_review_match.group(1))
            environment_review_match = re.fullmatch(r"/api/admin/environment-preflights/([^/]+)/review", path)
            if environment_review_match:
                return self.admin_review_environment_preflight(environment_review_match.group(1))
            dispute_review_match = re.fullmatch(r"/api/admin/disputes/([^/]+)/resolve", path)
            if dispute_review_match:
                return self.admin_resolve_dispute(dispute_review_match.group(1))
            refund_review_match = re.fullmatch(r"/api/admin/refunds/([^/]+)/review", path)
            if refund_review_match:
                return self.admin_review_refund(refund_review_match.group(1))
            settlement_paid_match = re.fullmatch(r"/api/admin/settlements/([^/]+)/mark-paid", path)
            if settlement_paid_match:
                return self.admin_mark_settlement_paid(settlement_paid_match.group(1))
            supplier_rebate_review_match = re.fullmatch(r"/api/admin/supplier-rebates/([^/]+)/review", path)
            if supplier_rebate_review_match:
                return self.admin_review_supplier_rebate(supplier_rebate_review_match.group(1))
            invoice_issue_match = re.fullmatch(r"/api/admin/invoices/([^/]+)/issue", path)
            if invoice_issue_match:
                return self.admin_issue_invoice(invoice_issue_match.group(1))
            swap_quote_match = re.fullmatch(r"/api/admin/swaps/([^/]+)/quote", path)
            if swap_quote_match:
                return self.admin_quote_swap(swap_quote_match.group(1))
            swap_accept_match = re.fullmatch(r"/api/swaps/([^/]+)/accept", path)
            if swap_accept_match:
                return self.accept_swap_quote(swap_accept_match.group(1))
            swap_cancel_match = re.fullmatch(r"/api/swaps/([^/]+)/cancel", path)
            if swap_cancel_match:
                return self.cancel_swap_request(swap_cancel_match.group(1))
            deletion_complete_match = re.fullmatch(r"/api/admin/account-deletions/([^/]+)/complete", path)
            if deletion_complete_match:
                return self.admin_complete_account_deletion(deletion_complete_match.group(1))
            raise ApiError(404, "接口不存在", "not_found")
        except ApiError as error:
            self.api_error(error)
        except sqlite3.IntegrityError as error:
            print(f"Integrity error: {error!r}")
            self.api_error(ApiError(409, "请求与现有记录冲突", "conflict"))
        except Exception as error:
            print(f"Unhandled POST error: {error!r}")
            self.api_error(ApiError(500, "服务暂时不可用", "internal_error"))

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ApiError(400, "请求长度无效")
        if length <= 0 or length > MAX_BODY:
            raise ApiError(413 if length > MAX_BODY else 400, "请求内容为空或过大")
        try:
            value = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(400, "JSON 请求格式无效")
        if not isinstance(value, dict):
            raise ApiError(400, "JSON 请求必须是对象")
        return value

    def json_response(self, status: int, payload: dict, cookies: list[str] | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for cookie in cookies or []:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def private_file_response(self, storage_path: str, mime: str, download_name: str) -> None:
        candidate = Path(storage_path or "").resolve()
        if EVIDENCE_ROOT != candidate and EVIDENCE_ROOT not in candidate.parents:
            raise ApiError(404, "认证材料不存在", "evidence_not_found")
        if not candidate.is_file() or candidate.stat().st_size > MAX_EVIDENCE_BYTES:
            raise ApiError(404, "认证材料不存在", "evidence_not_found")
        body = candidate.read_bytes()
        extension = candidate.suffix.lower() if candidate.suffix.lower() in (".pdf", ".png", ".jpg", ".jpeg") else ""
        disposition_name = f"kai-private-evidence{extension}"
        self.send_response(200)
        self.send_header("Content-Type", mime or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Disposition", f'inline; filename="{disposition_name}"')
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("X-KAI-Evidence-Name", base64url(str(download_name or disposition_name).encode("utf-8")))
        self.end_headers()
        self.wfile.write(body)

    def download_supplier_license(self, application_id: str) -> None:
        session = self.session()
        require_role(session, "admin")
        with db_connect() as connection:
            application = connection.execute(
                "SELECT license_storage_path,license_mime,license_file_name FROM supplier_applications WHERE id=?",
                (application_id,),
            ).fetchone()
        if not application or not application["license_storage_path"]:
            raise ApiError(404, "营业执照材料不存在", "license_not_found")
        self.private_file_response(application["license_storage_path"], application["license_mime"], application["license_file_name"])

    def download_supplier_rebate_evidence(self, rebate_id: str) -> None:
        session = self.session()
        with db_connect() as connection:
            rebate = connection.execute(
                "SELECT supplier_user_id,evidence_storage_path,evidence_mime,evidence_file_name FROM supplier_card_hour_rebates WHERE id=?",
                (rebate_id,),
            ).fetchone()
        if not rebate or not rebate["evidence_storage_path"]:
            raise ApiError(404, "返佣交易凭证不存在", "rebate_evidence_not_found")
        if session["role"] != "admin" and session["user_id"] != rebate["supplier_user_id"]:
            raise ApiError(403, "当前账户无权查看该材料", "permission_denied")
        self.private_file_response(rebate["evidence_storage_path"], rebate["evidence_mime"], rebate["evidence_file_name"])

    def api_error(self, error: ApiError) -> None:
        self.json_response(error.status, {"ok": False, "error": {"code": error.code, "message": error.message}})

    def cookie_value(self, name: str) -> str | None:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            return None
        return cookie[name].value if name in cookie else None

    def session(self, csrf: bool = False) -> sqlite3.Row:
        raw = self.cookie_value("kai_session")
        if not raw:
            raise ApiError(401, "请先登录", "authentication_required")
        with db_connect() as connection:
            row = connection.execute(
                "SELECT s.*,u.name,u.account,u.role,u.enterprise_status,u.must_change_password,u.lifecycle_status,u.supplier_capability_level FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
                (token_hash(raw), now_iso()),
            ).fetchone()
        if not row:
            raise ApiError(401, "登录状态已失效，请重新登录", "session_expired")
        if csrf and not hmac.compare_digest(row["csrf_token"], self.headers.get("X-KAI-CSRF", "")):
            raise ApiError(403, "请求令牌校验失败", "csrf_rejected")
        return row

    def create_session(self, connection: sqlite3.Connection, user_id: str) -> tuple[str, str]:
        raw = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(24)
        connection.execute(
            "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)",
            (token_hash(raw), user_id, csrf, future_iso(SESSION_HOURS), now_iso()),
        )
        return raw, csrf

    def session_cookie(self, raw: str, clear: bool = False) -> str:
        parts = [f"kai_session={'' if clear else raw}", "Path=/", "HttpOnly", "SameSite=Lax"]
        if clear:
            parts.append("Max-Age=0")
        else:
            parts.append(f"Max-Age={SESSION_HOURS * 3600}")
        if COOKIE_SECURE:
            parts.append("Secure")
        return "; ".join(parts)

    def oidc_transaction_cookie(self, transaction_id: str, clear: bool = False) -> str:
        parts = [
            f"kai_oidc_transaction={'' if clear else transaction_id}",
            "Path=/api/auth/kai",
            "HttpOnly",
            "SameSite=Lax",
        ]
        parts.append("Max-Age=0" if clear else f"Max-Age={IDENTITY_TRANSACTION_MINUTES * 60}")
        if COOKIE_SECURE or IDENTITY_REDIRECT_URI.startswith("https://"):
            parts.append("Secure")
        return "; ".join(parts)

    def redirect_response(self, location: str, cookies: list[str] | None = None) -> None:
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        for cookie in cookies or []:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()

    def mobile_identity_error_response(
        self, app_callback_uri: str, error_code: str
    ) -> None:
        trusted_callback_uri = approved_mobile_app_callback_uri(app_callback_uri)
        cleared_cookie = self.oidc_transaction_cookie("", clear=True)
        if trusted_callback_uri:
            separator = "&" if "?" in trusted_callback_uri else "?"
            return self.redirect_response(
                f"{trusted_callback_uri}{separator}{urlencode({'error': error_code})}",
                [cleared_cookie],
            )
        body = "移动登录事务无效，请返回 App 重新发起登录。".encode("utf-8")
        self.send_response(400)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Set-Cookie", cleared_cookie)
        self.end_headers()
        self.wfile.write(body)

    def plain_response(self, status: int, body: str) -> None:
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def kai_identity_start(self, query: dict[str, list[str]], mobile: bool = False) -> None:
        flow = "mobile" if mobile else "web"
        self.rate_limit(f"kai-identity-start:{flow}:{self.client_address[0]}", 20, 300)
        readiness = identity_readiness()
        if not readiness["configured"]:
            raise ApiError(503, "KAI Identity 统一登录客户端尚未配置完成", "kai_identity_not_configured")
        return_to = safe_return_to(query.get("return_to", ["/"])[0])
        app_nonce_hash = None
        app_callback_uri = MOBILE_APP_CALLBACK_URI
        login_hint = ""
        if mobile:
            login_handle = str(query.get("login_handle", [""])[0]).strip()
            if not re.fullmatch(r"[A-Za-z0-9_-]{43,180}", login_handle):
                raise ApiError(422, "App 登录准备信息无效，请重新发起登录", "mobile_identity_handle_invalid")
            moment = now_iso()
            with db_connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                try:
                    preparation = connection.execute(
                        "SELECT * FROM mobile_login_preparations WHERE handle_hash=?",
                        (token_hash(login_handle),),
                    ).fetchone()
                    if not preparation or preparation["expires_at"] <= moment or preparation["consumed_at"]:
                        raise ApiError(401, "App 登录准备信息已失效，请重新登录", "mobile_identity_handle_expired")
                    return_to = safe_return_to(preparation["return_to"])
                    app_nonce_hash = preparation["app_nonce_hash"]
                    app_callback_uri = approved_mobile_app_callback_uri(
                        preparation["app_callback_uri"]
                    )
                    if not app_callback_uri:
                        raise ApiError(
                            401,
                            "App 登录回跳地址已失效，请重新登录",
                            "mobile_identity_callback_rejected",
                        )
                    login_hint = str(preparation["login_hint"] or "")
                    connection.execute(
                        "DELETE FROM mobile_login_preparations WHERE handle_hash=?",
                        (token_hash(login_handle),),
                    )
                    connection.execute("COMMIT")
                except Exception:
                    if connection.in_transaction:
                        connection.execute("ROLLBACK")
                    raise
        transaction_id = uid("oidc")
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        code_verifier = secrets.token_urlsafe(64)
        code_challenge = base64url(hashlib.sha256(code_verifier.encode("ascii")).digest())
        created = now_iso()
        expires = (
            datetime.now(timezone.utc) + timedelta(minutes=IDENTITY_TRANSACTION_MINUTES)
        ).replace(microsecond=0).isoformat()
        with db_connect() as connection:
            connection.execute("DELETE FROM oidc_transactions WHERE expires_at<=?", (created,))
            connection.execute(
                "INSERT INTO oidc_transactions(id,state_hash,nonce,code_verifier,return_to,app_callback_uri,expires_at,created_at,flow,app_nonce_hash) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (
                    transaction_id, token_hash(state), nonce, code_verifier, return_to,
                    app_callback_uri, expires, created,
                    flow, app_nonce_hash,
                ),
            )
        redirect_uri = IDENTITY_MOBILE_REDIRECT_URI if mobile else IDENTITY_REDIRECT_URI
        authorization_params = {
            'response_type': 'code',
            'client_id': IDENTITY_CLIENT_ID,
            'redirect_uri': redirect_uri,
            'scope': 'openid profile email',
            'state': state,
            'nonce': nonce,
            'code_challenge': code_challenge,
            'code_challenge_method': 'S256',
            'response_mode': 'query',
        }
        if login_hint:
            authorization_params["login_hint"] = login_hint
        authorization_url = f"{IDENTITY_AUTHORIZATION_ENDPOINT}?{urlencode(authorization_params)}"
        self.redirect_response(authorization_url, [self.oidc_transaction_cookie(transaction_id)])

    def kai_identity_request(self, request: Request, error_message: str) -> dict:
        try:
            with urlopen(request, timeout=15) as response:
                body = response.read(MAX_BODY + 1)
            if len(body) > MAX_BODY:
                raise ApiError(502, error_message, "kai_identity_response_too_large")
            payload = json.loads(body.decode("utf-8"))
        except ApiError:
            raise
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as error:
            print(f"KAI Identity request failed: {type(error).__name__}")
            raise ApiError(502, error_message, "kai_identity_unavailable")
        if not isinstance(payload, dict):
            raise ApiError(502, error_message, "kai_identity_invalid_response")
        return payload

    def exchange_kai_identity_code(self, code: str, code_verifier: str, redirect_uri: str) -> dict:
        form = urlencode({
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        }).encode("utf-8")
        basic = base64.b64encode(f"{IDENTITY_CLIENT_ID}:{IDENTITY_CLIENT_SECRET}".encode("utf-8")).decode("ascii")
        request = Request(IDENTITY_TOKEN_ENDPOINT, data=form, method="POST", headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"Basic {basic}",
            "User-Agent": "CloudPay-OIDC/1.0",
        })
        payload = self.kai_identity_request(request, "KAI Identity 暂时无法完成登录")
        access_token = str(payload.get("access_token") or "")
        if not access_token or str(payload.get("token_type") or "Bearer").lower() != "bearer":
            raise ApiError(502, "KAI Identity 返回的登录凭据无效", "kai_identity_invalid_token")
        return payload

    def fetch_kai_identity_user(self, access_token: str) -> dict:
        request = Request(IDENTITY_USERINFO_ENDPOINT, method="GET", headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {access_token}",
            "User-Agent": "CloudPay-OIDC/1.0",
        })
        return self.kai_identity_request(request, "KAI Identity 暂时无法读取账户资料")

    def complete_kai_identity_callback(self, query: dict[str, list[str]], mobile: bool = False) -> None:
        flow = "mobile" if mobile else "web"
        app_callback_uri = ""
        self.rate_limit(f"kai-identity-callback:{flow}:{self.client_address[0]}", 30, 300)
        if query.get("error"):
            raise ApiError(401, "KAI Identity 登录已取消或未获授权", "kai_identity_denied")
        code = str(query.get("code", [""])[0]).strip()
        state = str(query.get("state", [""])[0]).strip()
        transaction_id = self.cookie_value("kai_oidc_transaction") or ""
        if not code or not state or not transaction_id:
            raise ApiError(400, "统一登录回调参数不完整", "kai_identity_callback_invalid")
        moment = now_iso()
        with db_connect() as connection:
            transaction = connection.execute(
                "SELECT * FROM oidc_transactions WHERE id=?", (transaction_id,)
            ).fetchone()
            if transaction:
                connection.execute("DELETE FROM oidc_transactions WHERE id=?", (transaction_id,))
        if not transaction or transaction["expires_at"] <= moment:
            raise ApiError(400, "统一登录请求已过期，请重新登录", "kai_identity_transaction_expired")
        if transaction["flow"] != flow:
            raise ApiError(400, "统一登录回调通道不匹配", "kai_identity_flow_rejected")
        if not hmac.compare_digest(transaction["state_hash"], token_hash(state)):
            raise ApiError(400, "统一登录状态校验失败", "kai_identity_state_rejected")
        if mobile:
            app_callback_uri = approved_mobile_app_callback_uri(
                transaction["app_callback_uri"]
            )
            if not app_callback_uri:
                raise ApiError(
                    401,
                    "App 登录回跳地址已失效，请重新登录",
                    "mobile_identity_callback_rejected",
                )

        redirect_uri = IDENTITY_MOBILE_REDIRECT_URI if mobile else IDENTITY_REDIRECT_URI
        token_payload = self.exchange_kai_identity_code(code, transaction["code_verifier"], redirect_uri)
        claims = self.fetch_kai_identity_user(str(token_payload["access_token"]))
        subject = str(claims.get("sub") or "").strip()
        email = str(claims.get("email") or "").strip().lower()
        email_verified = claims.get("email_verified") in (True, 1, "true", "True")
        if not subject or len(subject) > 255:
            raise ApiError(502, "KAI Identity 账户标识无效", "kai_identity_subject_invalid")
        if not email_verified or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise ApiError(403, "请先在 KAI Identity 完成邮箱验证", "kai_identity_email_unverified")
        name = str(claims.get("name") or email.split("@", 1)[0] or "KAI 用户").strip()[:120]
        if len(name) < 2:
            name = f"KAI 用户 {name}".strip()
        created = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                identity = connection.execute(
                    "SELECT * FROM external_identities WHERE provider='kai_identity' AND subject=?", (subject,)
                ).fetchone()
                user = connection.execute("SELECT * FROM users WHERE id=?", (identity["user_id"],)).fetchone() if identity else None
                if not user:
                    user = connection.execute("SELECT * FROM users WHERE account=?", (email,)).fetchone()
                    if user and user["role"] in ("admin", "staff"):
                        raise ApiError(403, "运营账号首次绑定需由管理员在后台确认", "staff_identity_link_required")
                    if not user:
                        user_id = uid("usr")
                        connection.execute(
                            "INSERT INTO users(id,name,account,password_hash,role,enterprise_status,created_at,updated_at) VALUES(?,?,?,?, 'buyer','unverified',?,?)",
                            (user_id, name, email, hash_password(secrets.token_urlsafe(48)), created, created),
                        )
                        user = connection.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
                    connection.execute(
                        "INSERT INTO external_identities(provider,subject,user_id,email,claims_json,created_at,updated_at) VALUES('kai_identity',?,?,?,?,?,?)",
                        (subject, user["id"], email, json.dumps({"email_verified": True}, ensure_ascii=False), created, created),
                    )
                    audit(connection, user["id"], "user", user["id"], "identity.kai_linked", {
                        "subject_hash": token_hash(subject), "email_hash": token_hash(email),
                    })
                else:
                    connection.execute(
                        "UPDATE external_identities SET email=?,claims_json=?,updated_at=? WHERE provider='kai_identity' AND subject=?",
                        (email, json.dumps({"email_verified": True}, ensure_ascii=False), created, subject),
                    )
                if user["lifecycle_status"] == "anonymized":
                    raise ApiError(403, "账户已注销", "account_deleted")
                if mobile:
                    ticket = secrets.token_urlsafe(48)
                    ticket_expires = (
                        datetime.now(timezone.utc) + timedelta(minutes=MOBILE_LOGIN_TICKET_MINUTES)
                    ).replace(microsecond=0).isoformat()
                    connection.execute("DELETE FROM mobile_login_tickets WHERE expires_at<=?", (created,))
                    connection.execute(
                        "INSERT INTO mobile_login_tickets(ticket_hash,user_id,app_nonce_hash,return_to,expires_at,created_at) VALUES(?,?,?,?,?,?)",
                        (
                            token_hash(ticket), user["id"], transaction["app_nonce_hash"],
                            safe_return_to(transaction["return_to"]), ticket_expires, created,
                        ),
                    )
                    audit(connection, user["id"], "mobile_login", token_hash(ticket)[:16], "identity.mobile_ticket_created", {
                        "expires_at": ticket_expires,
                    })
                else:
                    raw, csrf = self.create_session(connection, user["id"])
                    audit(connection, user["id"], "session", token_hash(raw)[:16], "session.kai_identity_created", {
                        "channel": "web",
                    })
                connection.execute("COMMIT")
            except Exception:
                if connection.in_transaction:
                    connection.execute("ROLLBACK")
                raise
        return_to = safe_return_to(transaction["return_to"])
        if mobile:
            separator = "&" if "?" in app_callback_uri else "?"
            return self.redirect_response(
                f"{app_callback_uri}{separator}{urlencode({'ticket': ticket, 'return_to': return_to})}",
                [self.oidc_transaction_cookie("", clear=True)],
            )
        separator = "&" if "?" in return_to else "?"
        self.redirect_response(
            f"{return_to}{separator}kai_auth=success",
            [self.session_cookie(raw), self.oidc_transaction_cookie("", clear=True)],
        )

    def kai_identity_callback(self, query: dict[str, list[str]], mobile: bool = False) -> None:
        app_callback_uri = ""
        if mobile:
            transaction_id = self.cookie_value("kai_oidc_transaction") or ""
            if transaction_id:
                with db_connect() as connection:
                    transaction = connection.execute(
                        "SELECT app_callback_uri,flow,expires_at FROM oidc_transactions WHERE id=?",
                        (transaction_id,),
                    ).fetchone()
                if (
                    transaction
                    and transaction["flow"] == "mobile"
                    and transaction["expires_at"] > now_iso()
                ):
                    app_callback_uri = approved_mobile_app_callback_uri(
                        transaction["app_callback_uri"]
                    )
        try:
            self.complete_kai_identity_callback(query, mobile=mobile)
        except ApiError as error:
            if mobile:
                return self.mobile_identity_error_response(
                    app_callback_uri, error.code
                )
            self.redirect_response(
                f"/?kai_auth=error&reason={urlencode({'reason': error.code}).split('=', 1)[1]}",
                [self.oidc_transaction_cookie("", clear=True)],
            )
        except Exception as error:
            print(f"Unhandled KAI Identity callback error: {type(error).__name__}")
            if mobile:
                return self.mobile_identity_error_response(
                    app_callback_uri, "internal_error"
                )
            self.redirect_response(
                "/?kai_auth=error&reason=internal_error",
                [self.oidc_transaction_cookie("", clear=True)],
            )

    def prepare_mobile_identity_login(self) -> None:
        self.rate_limit(f"mobile-identity-prepare:{self.client_address[0]}", 20, 300)
        readiness = identity_readiness()
        if not readiness["configured"]:
            raise ApiError(503, "KAI Identity 统一登录客户端尚未配置完成", "kai_identity_not_configured")
        data = self.read_json()
        app_nonce = str(data.get("app_nonce") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{43,180}", app_nonce):
            raise ApiError(422, "App 登录绑定码无效，请重新发起登录", "mobile_identity_nonce_invalid")
        app_callback_uri = approved_mobile_app_callback_uri(
            data.get("app_callback_uri")
        )
        if not app_callback_uri:
            raise ApiError(
                422,
                "App 登录回跳地址不受信任",
                "mobile_identity_callback_rejected",
            )
        login_hint = str(data.get("login_hint") or "").strip().lower()
        if not re.fullmatch(r"[^@\s]{1,64}@[^@\s]{1,189}", login_hint):
            raise ApiError(422, "请输入有效的 KAI 账户邮箱", "mobile_identity_login_hint_invalid")
        return_to = safe_return_to(data.get("return_to") or "/")
        login_handle = secrets.token_urlsafe(48)
        created = now_iso()
        expires = (
            datetime.now(timezone.utc) + timedelta(minutes=IDENTITY_TRANSACTION_MINUTES)
        ).replace(microsecond=0).isoformat()
        with db_connect() as connection:
            connection.execute("DELETE FROM mobile_login_preparations WHERE expires_at<=?", (created,))
            connection.execute(
                "INSERT INTO mobile_login_preparations(handle_hash,app_nonce_hash,login_hint,return_to,app_callback_uri,expires_at,created_at) VALUES(?,?,?,?,?,?,?)",
                (
                    token_hash(login_handle), token_hash(app_nonce), login_hint,
                    return_to, app_callback_uri, expires, created,
                ),
            )
        self.json_response(201, {
            "ok": True,
            "login_handle": login_handle,
            "start_url": f"/api/auth/kai/mobile/start?{urlencode({'login_handle': login_handle})}",
            "expires_at": expires,
        })

    def create_mobile_identity_session(self) -> None:
        self.rate_limit(f"mobile-identity-session:{self.client_address[0]}", 12, 300)
        data = self.read_json()
        ticket = str(data.get("ticket") or "").strip()
        app_nonce = str(data.get("app_nonce") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{48,180}", ticket):
            raise ApiError(422, "App 登录票据无效，请重新登录", "mobile_identity_ticket_invalid")
        if not re.fullmatch(r"[A-Za-z0-9_-]{43,180}", app_nonce):
            raise ApiError(422, "App 登录绑定码无效，请重新登录", "mobile_identity_nonce_invalid")
        moment = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                login_ticket = connection.execute(
                    "SELECT * FROM mobile_login_tickets WHERE ticket_hash=?", (token_hash(ticket),)
                ).fetchone()
                if not login_ticket or login_ticket["expires_at"] <= moment:
                    raise ApiError(401, "App 登录票据已失效，请重新登录", "mobile_identity_ticket_expired")
                if not hmac.compare_digest(login_ticket["app_nonce_hash"], token_hash(app_nonce)):
                    raise ApiError(403, "App 登录绑定校验失败", "mobile_identity_nonce_rejected")
                if int(login_ticket["exchange_count"] or 0) >= MOBILE_LOGIN_MAX_EXCHANGES:
                    if login_ticket["last_session_token_hash"]:
                        connection.execute(
                            "DELETE FROM sessions WHERE token_hash=?",
                            (login_ticket["last_session_token_hash"],),
                        )
                    connection.execute(
                        """UPDATE mobile_login_tickets
                           SET last_session_token_hash=NULL,expires_at=?
                           WHERE ticket_hash=?""",
                        (moment, token_hash(ticket)),
                    )
                    connection.execute("COMMIT")
                    raise ApiError(
                        401,
                        "App 登录票据重试次数已用尽，请重新登录",
                        "mobile_identity_ticket_exchange_exhausted",
                    )
                user = connection.execute(
                    "SELECT * FROM users WHERE id=?", (login_ticket["user_id"],)
                ).fetchone()
                if not user or user["lifecycle_status"] == "anonymized":
                    raise ApiError(403, "账户不可用", "account_unavailable")
                if login_ticket["last_session_token_hash"]:
                    connection.execute(
                        "DELETE FROM sessions WHERE token_hash=?",
                        (login_ticket["last_session_token_hash"],),
                    )
                raw, csrf = self.create_session(connection, user["id"])
                connection.execute(
                    """UPDATE mobile_login_tickets SET consumed_at=COALESCE(consumed_at,?),
                       last_session_token_hash=?,exchange_count=exchange_count+1
                       WHERE ticket_hash=?""",
                    (moment, token_hash(raw), token_hash(ticket)),
                )
                audit(connection, user["id"], "session", token_hash(raw)[:16], "session.kai_identity_created", {
                    "channel": "mobile",
                    "ticket_exchange": int(login_ticket["exchange_count"] or 0) + 1,
                })
                connection.execute("COMMIT")
            except Exception:
                if connection.in_transaction:
                    connection.execute("ROLLBACK")
                raise
        self.json_response(200, {
            "ok": True,
            "user": public_user(user),
            "csrf_token": csrf,
            "return_to": safe_return_to(login_ticket["return_to"]),
        }, [self.session_cookie(raw)])

    def origin_is_same_site(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        parsed = urlparse(origin)
        return parsed.netloc == self.headers.get("Host") and parsed.scheme in ("http", "https")

    def rate_limit(self, key: str, limit: int = 12, window: int = 60) -> None:
        moment = time.time()
        with RATE_LOCK:
            bucket = [stamp for stamp in RATE_BUCKETS.get(key, []) if stamp > moment - window]
            if len(bucket) >= limit:
                raise ApiError(429, "请求过于频繁，请稍后再试", "rate_limited")
            bucket.append(moment)
            RATE_BUCKETS[key] = bucket

    def send_registration_code(self) -> None:
        if AUTH_PROVIDER == "kai_identity":
            raise ApiError(410, "请使用 KAI Identity 统一账户注册", "kai_identity_registration_required")
        data = self.read_json()
        phone = normalize_phone(data.get("phone") or data.get("account"))
        phone_key = hashlib.sha256(phone.encode("utf-8")).hexdigest()
        ip_key = hashlib.sha256(self.client_address[0].encode("utf-8")).hexdigest()
        self.rate_limit(f"sms-ip:{ip_key}", 5, 600)
        self.rate_limit(f"sms-phone:{phone_key}", 3, 600)
        readiness = sms_readiness()
        if not readiness["configured"]:
            raise ApiError(503, "短信验证码通道尚未配置完成", "sms_provider_not_configured")

        verification_id = uid("verify")
        code = f"{secrets.randbelow(1_000_000):06d}"
        created = now_iso()
        expires = (datetime.now(timezone.utc) + timedelta(seconds=OTP_TTL_SECONDS)).replace(microsecond=0).isoformat()
        with db_connect() as connection:
            recent = connection.execute(
                "SELECT sent_at FROM phone_verifications WHERE phone=? AND purpose='register' AND status='sent' ORDER BY created_at DESC LIMIT 1",
                (phone,),
            ).fetchone()
            if recent:
                sent_at = datetime.fromisoformat(recent["sent_at"])
                remaining = 60 - int((datetime.now(timezone.utc) - sent_at).total_seconds())
                if remaining > 0:
                    raise ApiError(429, f"请在 {remaining} 秒后重新获取验证码", "sms_resend_too_soon")
            connection.execute(
                """INSERT INTO phone_verifications(
                   id,phone,purpose,code_hash,provider,status,attempts,max_attempts,request_ip_hash,
                   expires_at,sent_at,created_at,updated_at
                   ) VALUES(?,?,'register',?,?,'sending',0,?,?,?,?,?,?)""",
                (verification_id, phone, otp_digest(verification_id, phone, code), SMS_PROVIDER,
                 OTP_MAX_ATTEMPTS, ip_key, expires, created, created, created),
            )
        try:
            provider_request_id = send_verification_message(phone, code)
        except Exception:
            with db_connect() as connection:
                connection.execute(
                    "UPDATE phone_verifications SET status='failed',updated_at=? WHERE id=?",
                    (now_iso(), verification_id),
                )
            raise
        with db_connect() as connection:
            connection.execute(
                "UPDATE phone_verifications SET status='sent',provider_request_id=?,updated_at=? WHERE id=?",
                (provider_request_id, now_iso(), verification_id),
            )
            audit(connection, None, "phone_verification", verification_id, "verification.sent", {
                "phone_hash": phone_key, "purpose": "register", "provider": SMS_PROVIDER,
                "expires_in": OTP_TTL_SECONDS,
            })
        payload = {"ok": True, "sent": True, "expires_in": OTP_TTL_SECONDS, "resend_after": 60}
        if ALLOW_DEMO and SMS_PROVIDER == "mock":
            payload["debug_code"] = code
        self.json_response(200, payload)

    def register(self) -> None:
        if AUTH_PROVIDER == "kai_identity":
            raise ApiError(410, "请使用 KAI Identity 统一账户注册", "kai_identity_registration_required")
        self.rate_limit(f"register:{self.client_address[0]}", 6, 300)
        data = self.read_json()
        name = clean_text(data.get("name"), "企业名称", 2, 120)
        account_input = clean_text(data.get("account"), "手机号或邮箱", 5, 160)
        account = normalize_phone(account_input) if REQUIRE_SMS else account_input.lower()
        password = str(data.get("password") or "")
        if not REQUIRE_SMS and not (re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", account) or re.fullmatch(r"\+?\d{8,15}", account)):
            raise ApiError(422, "请输入有效的手机号或邮箱", "invalid_account")
        if len(password) < 8 or not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
            raise ApiError(422, "密码至少 8 位，并同时包含字母和数字", "weak_password")
        verification_code = str(data.get("verification_code") or "").strip()
        if REQUIRE_SMS and not re.fullmatch(r"\d{6}", verification_code):
            raise ApiError(422, "请输入 6 位短信验证码", "verification_code_required")
        created = now_iso()
        user_id = uid("usr")
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                verification = None
                if REQUIRE_SMS:
                    verification = connection.execute(
                        """SELECT * FROM phone_verifications
                           WHERE phone=? AND purpose='register' AND status='sent' AND expires_at>?
                           ORDER BY created_at DESC LIMIT 1""",
                        (account, created),
                    ).fetchone()
                    if not verification:
                        raise ApiError(422, "验证码已失效，请重新获取", "verification_expired")
                    if verification["attempts"] >= verification["max_attempts"]:
                        raise ApiError(429, "验证码尝试次数过多，请重新获取", "verification_attempts_exhausted")
                    if not hmac.compare_digest(verification["code_hash"], otp_digest(verification["id"], account, verification_code)):
                        next_attempt = verification["attempts"] + 1
                        status = "exhausted" if next_attempt >= verification["max_attempts"] else "sent"
                        connection.execute(
                            "UPDATE phone_verifications SET attempts=?,status=?,updated_at=? WHERE id=?",
                            (next_attempt, status, created, verification["id"]),
                        )
                        connection.execute("COMMIT")
                        raise ApiError(422, "短信验证码错误", "invalid_verification_code")
                connection.execute(
                    "INSERT INTO users(id,name,account,password_hash,role,enterprise_status,created_at,updated_at) VALUES(?,?,?,?,'buyer','unverified',?,?)",
                    (user_id, name, account, hash_password(password), created, created),
                )
                if verification:
                    connection.execute(
                        "UPDATE phone_verifications SET status='consumed',consumed_at=?,updated_at=? WHERE id=? AND status='sent'",
                        (created, created, verification["id"]),
                    )
                raw, csrf = self.create_session(connection, user_id)
                audit(connection, user_id, "user", user_id, "user.registered", {
                    "account_hash": hashlib.sha256(account.encode()).hexdigest(),
                    "phone_verified": bool(verification),
                })
                connection.execute("COMMIT")
            except Exception:
                if connection.in_transaction:
                    connection.execute("ROLLBACK")
                raise
            user = connection.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        self.json_response(201, {"ok": True, "user": public_user(user), "csrf_token": csrf}, [self.session_cookie(raw)])

    def login(self) -> None:
        self.rate_limit(f"login:{self.client_address[0]}", 12, 300)
        data = self.read_json()
        account = clean_text(data.get("account"), "账号", 5, 160).lower()
        password = str(data.get("password") or "")
        with db_connect() as connection:
            user = connection.execute("SELECT * FROM users WHERE account=?", (account,)).fetchone()
            if not user or not verify_password(password, user["password_hash"]):
                raise ApiError(401, "账号或密码错误", "invalid_credentials")
            if user["lifecycle_status"] == "anonymized":
                raise ApiError(403, "账户已注销", "account_deleted")
            raw, csrf = self.create_session(connection, user["id"])
            audit(connection, user["id"], "session", token_hash(raw)[:16], "session.created", {})
        self.json_response(200, {"ok": True, "user": public_user(user), "csrf_token": csrf}, [self.session_cookie(raw)])

    def demo_login(self) -> None:
        if not ALLOW_DEMO:
            raise ApiError(404, "联调账户未启用", "demo_disabled")
        self.rate_limit(f"demo-login:{self.client_address[0]}", 20, 300)
        with db_connect() as connection:
            user = connection.execute("SELECT * FROM users WHERE id='usr_demo_buyer'").fetchone()
            raw, csrf = self.create_session(connection, user["id"])
            audit(connection, user["id"], "session", token_hash(raw)[:16], "session.demo_created", {})
        self.json_response(200, {"ok": True, "user": public_user(user), "csrf_token": csrf}, [self.session_cookie(raw)])

    def logout(self) -> None:
        row = self.session(csrf=True)
        raw = self.cookie_value("kai_session")
        with db_connect() as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(raw or ""),))
            audit(connection, row["user_id"], "session", token_hash(raw or "")[:16], "session.revoked", {})
        self.json_response(200, {"ok": True}, [self.session_cookie("", clear=True)])

    def change_password(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        current_password = str(data.get("current_password") or "")
        new_password = str(data.get("new_password") or "")
        if len(new_password) < 12 or not re.search(r"[A-Za-z]", new_password) or not re.search(r"\d", new_password) or not re.search(r"[^A-Za-z0-9]", new_password):
            raise ApiError(422, "新密码至少 12 位，并包含字母、数字和特殊字符", "weak_password")
        raw = self.cookie_value("kai_session") or ""
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                user = connection.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone()
                if not user or not verify_password(current_password, user["password_hash"]):
                    raise ApiError(401, "当前密码不正确", "invalid_current_password")
                if verify_password(new_password, user["password_hash"]):
                    raise ApiError(422, "新密码不能与当前密码相同")
                updated = now_iso()
                connection.execute("UPDATE users SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?", (hash_password(new_password), updated, user["id"]))
                connection.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", (user["id"], token_hash(raw)))
                audit(connection, user["id"], "user", user["id"], "user.password_changed", {"other_sessions_revoked": True})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "must_change_password": False})

    def get_me(self) -> None:
        try:
            row = self.session()
        except ApiError:
            return self.json_response(200, {"ok": True, "authenticated": False})
        self.json_response(200, {"ok": True, "authenticated": True, "user": {
            "id": row["user_id"], "name": row["name"], "account": row["account"],
            "role": row["role"], "enterprise_status": row["enterprise_status"],
            "lifecycle_status": row["lifecycle_status"],
            "supplier_capability_level": row["supplier_capability_level"],
            "must_change_password": bool(row["must_change_password"])
        }, "csrf_token": row["csrf_token"]})

    def get_catalog(self) -> None:
        with db_connect() as connection:
            rows = connection.execute(
                """SELECT *, verified_quantity-quote_reserved-order_locked-delivering-consumed-frozen AS available
                   FROM listings WHERE status='active' AND trade_mode='fixed' AND valid_from<=? AND valid_until>? ORDER BY kind,unit_price_cents""",
                (now_iso(), now_iso()),
            ).fetchall()
        listings = [{
            "id": row["id"], "kind": row["kind"], "product_code": row["product_code"], "gpu": row["gpu"],
            "provider": row["provider"], "region": row["region"], "unit": row["unit"],
            "unit_price_cny": row["unit_price_cents"] / 100, "available_quantity": max(0, row["available"]),
            "valid_from": row["valid_from"], "valid_until": row["valid_until"], "version": row["version"],
            "trade_mode": row["trade_mode"], "sla": row["sla"], "minimum_quantity": row["minimum_quantity"],
        } for row in rows if row["available"] > 0]
        self.json_response(200, {"ok": True, "listings": listings, "price_notice": "订单执行价以创建订单时的服务端库存快照为准"})

    def get_environment_preflights(self) -> None:
        session = self.session()
        with db_connect() as connection:
            rows = connection.execute(
                "SELECT * FROM environment_preflights WHERE buyer_user_id=? ORDER BY created_at DESC LIMIT 50",
                (session["user_id"],),
            ).fetchall()
        self.json_response(200, {"ok": True, "preflights": [environment_preflight_dict(row) for row in rows]})

    def get_environment_preflight(self, preflight_id: str) -> None:
        session = self.session()
        with db_connect() as connection:
            row = connection.execute(
                "SELECT * FROM environment_preflights WHERE id=? AND buyer_user_id=?",
                (clean_text(preflight_id, "环境预检单", 4, 80), session["user_id"]),
            ).fetchone()
        if not row:
            raise ApiError(404, "环境预检单不存在", "environment_preflight_not_found")
        self.json_response(200, {"ok": True, "preflight": environment_preflight_dict(row)})

    def create_environment_preflight(self) -> None:
        session = self.session(csrf=True)
        self.rate_limit(f"environment-preflight:{session['user_id']}", 20, 3600)
        data = self.read_json()
        idem = require_idempotency_key(self.headers)
        spec, status, checks, reasons = normalized_environment_spec(data, session["enterprise_status"])
        preflight_id = uid("env")
        created = now_iso()
        expires_at = future_iso(24 if status == "approved" else 168)
        decision = "auto_approved" if status == "approved" else "manual_review"
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute(
                    "SELECT * FROM environment_preflights WHERE buyer_user_id=? AND idempotency_key=?",
                    (session["user_id"], idem),
                ).fetchone()
                if existing:
                    connection.execute("COMMIT")
                    return self.json_response(200, {
                        "ok": True, "preflight": environment_preflight_dict(existing), "idempotent_replay": True,
                    })
                connection.execute(
                    """INSERT INTO environment_preflights(
                         id,buyer_user_id,task,gpu,delivery_mode,template,image_reference,workspace_gb,
                         access_mode,network_mode,api_model,api_runtime,api_context_tokens,api_concurrency,
                         api_rate_limit_rpm,api_token_quota_millions,
                         supplier_capability_required,compatibility_json,decision,
                         decision_reasons_json,status,expires_at,idempotency_key,created_at,updated_at
                       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (preflight_id, session["user_id"], spec["task"], spec["gpu"], spec["delivery_mode"],
                     spec["template"], spec["image_reference"], spec["workspace_gb"], spec["access_mode"],
                     spec["network_mode"], spec["api_model"], spec["api_runtime"], spec["api_context_tokens"],
                     spec["api_concurrency"], spec["api_rate_limit_rpm"], spec["api_token_quota_millions"],
                     spec["supplier_capability_required"],
                     json.dumps(checks, ensure_ascii=False), decision, json.dumps(reasons, ensure_ascii=False),
                     status, expires_at, idem, created, created),
                )
                audit(connection, session["user_id"], "environment_preflight", preflight_id,
                      "environment.preflight_auto_approved" if status == "approved" else "environment.preflight_review_requested", {
                           "task": spec["task"], "gpu": spec["gpu"], "delivery_mode": spec["delivery_mode"],
                           "api_model": spec["api_model"], "api_runtime": spec["api_runtime"],
                           "api_context_tokens": spec["api_context_tokens"],
                           "api_concurrency": spec["api_concurrency"],
                           "api_rate_limit_rpm": spec["api_rate_limit_rpm"],
                           "api_token_quota_millions": spec["api_token_quota_millions"],
                          "supplier_capability_required": spec["supplier_capability_required"],
                          "image_reference_digest": hashlib.sha256(spec["image_reference"].encode()).hexdigest() if spec["image_reference"] else None,
                          "decision_reasons": reasons, "order_creation_allowed": status == "approved",
                          "billing_allowed": False,
                      }, idem)
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            row = connection.execute("SELECT * FROM environment_preflights WHERE id=?", (preflight_id,)).fetchone()
        self.json_response(201, {"ok": True, "preflight": environment_preflight_dict(row)})

    def admin_review_environment_preflight(self, preflight_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        decision = clean_text(data.get("decision"), "审核结论", 6, 16)
        if decision not in ("approved", "rejected"):
            raise ApiError(422, "审核结论必须是 approved 或 rejected", "invalid_review_decision")
        review_note = clean_text(data.get("review_note"), "审核说明", 3, 500)
        supplied_level = clean_text(data.get("supplier_capability_level") or "L1", "供应商能力等级", 2, 2).upper()
        if not re.fullmatch(r"L[1-5]", supplied_level):
            raise ApiError(422, "供应商能力等级必须为 L1 至 L5", "invalid_supplier_capability_level")
        clean_id = clean_text(preflight_id, "环境预检单", 4, 80)
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                row = connection.execute("SELECT * FROM environment_preflights WHERE id=?", (clean_id,)).fetchone()
                if not row:
                    raise ApiError(404, "环境预检单不存在", "environment_preflight_not_found")
                if row["status"] != "pending_review":
                    raise ApiError(409, "环境预检单已经完成审核", "environment_preflight_already_reviewed")
                if decision == "approved" and int(supplied_level[1]) < int(row["supplier_capability_required"][1]):
                    raise ApiError(409, "供应商能力等级不足，不能批准该交付方式", "supplier_capability_insufficient")
                if decision == "approved":
                    available_level = connection.execute(
                        """SELECT COALESCE(MAX(CAST(SUBSTR(u.supplier_capability_level,2) AS INTEGER)),0)
                           FROM listings l JOIN users u ON u.id=l.supplier_user_id
                           WHERE l.status='active' AND UPPER(l.gpu)=? AND u.role='supplier' AND u.enterprise_status='certified'""",
                        (row["gpu"],),
                    ).fetchone()[0]
                    if int(available_level) < int(supplied_level[1]):
                        raise ApiError(409, "当前资源池没有达到所选等级的已认证供应商", "supplier_capability_unavailable")
                try:
                    checks = json.loads(row["compatibility_json"] or "[]")
                except (TypeError, json.JSONDecodeError):
                    checks = []
                terminal_check_status = "passed" if decision == "approved" else "failed"
                for check in checks:
                    if check.get("status") == "pending":
                        check["status"] = terminal_check_status
                reviewed = now_iso()
                expires_at = future_iso(24 if decision == "approved" else 168)
                connection.execute(
                    """UPDATE environment_preflights SET status=?,decision=?,compatibility_json=?,review_note=?,approved_supplier_capability_level=?,
                       reviewer_user_id=?,reviewed_at=?,expires_at=?,updated_at=? WHERE id=?""",
                    (decision, f"manual_{decision}", json.dumps(checks, ensure_ascii=False), review_note,
                     supplied_level if decision == "approved" else None,
                     session["user_id"], reviewed, expires_at, reviewed, clean_id),
                )
                audit(connection, session["user_id"], "environment_preflight", clean_id,
                      f"environment.preflight_{decision}", {
                          "review_note": review_note, "supplier_capability_level": supplied_level,
                          "order_creation_allowed": decision == "approved", "billing_allowed": False,
                      })
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            updated = connection.execute("SELECT * FROM environment_preflights WHERE id=?", (clean_id,)).fetchone()
        self.json_response(200, {"ok": True, "preflight": environment_preflight_dict(updated)})

    def get_purchase_requests(self) -> None:
        session = self.session()
        with db_connect() as connection:
            rows = connection.execute(
                """SELECT id,product_code,region,service_mode,service_hours,requested_gpu_hours,
                          cpu_cores,memory_gb,storage,environment,start_at,status,created_at,updated_at
                   FROM purchase_requests WHERE buyer_user_id=? ORDER BY created_at DESC LIMIT 20""",
                (session["user_id"],),
            ).fetchall()
        self.json_response(200, {"ok": True, "requests": [dict(row) for row in rows]})

    def create_purchase_request(self) -> None:
        session = self.session(csrf=True)
        self.rate_limit(f"purchase-request:{session['user_id']}", 10, 3600)
        data = self.read_json()
        product_code = clean_text(data.get("product_code") or "NVIDIA H100 SXM 80GB", "H100 产品", 4, 80)
        if product_code != "NVIDIA H100 SXM 80GB":
            raise ApiError(422, "当前采购需求入口仅支持 NVIDIA H100 SXM 80GB", "unsupported_purchase_product")
        region = clean_text(data.get("region") or "不限地区", "期望地区", 2, 40)
        if region not in {"不限地区", "北京", "上海", "深圳", "成都", "中国香港"}:
            raise ApiError(422, "期望地区不在可选范围内", "invalid_purchase_region")
        service_mode = clean_text(data.get("service_mode") or "exclusive", "H100 使用模式", 3, 24)
        if service_mode not in H100_SERVICE_MODES:
            raise ApiError(422, "H100 使用模式无效", "invalid_h100_service_mode")
        try:
            service_hours = round(float(data.get("service_hours")), 3)
            cpu_cores = int(data.get("cpu_cores"))
            memory_gb = int(data.get("memory_gb"))
        except (TypeError, ValueError):
            raise ApiError(422, "H100 采购配置格式无效", "invalid_h100_configuration")
        if service_hours < 1 or service_hours > 8760:
            raise ApiError(422, "H100 服务时长应为 1 至 8760 小时", "invalid_h100_service_hours")
        if cpu_cores not in H100_CPU_OPTIONS or memory_gb not in H100_MEMORY_OPTIONS:
            raise ApiError(422, "H100 CPU 或内存配置无效", "invalid_h100_configuration")
        storage = clean_text(data.get("storage") or "nvme_1tb", "存储配置", 3, 24)
        environment = clean_text(data.get("environment") or "pytorch", "运行环境", 3, 32)
        if storage not in H100_STORAGE_OPTIONS or environment not in H100_ENVIRONMENT_OPTIONS:
            raise ApiError(422, "H100 存储或运行环境无效", "invalid_h100_configuration")
        start_at = normalize_iso_time(data.get("start_at"), "计划开始时间")
        requested_gpu_hours = round(service_hours * H100_SERVICE_MODES[service_mode]["billing_factor"], 6)
        idem = require_idempotency_key(self.headers)
        request_id = uid("prq")
        created = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute(
                    "SELECT * FROM purchase_requests WHERE buyer_user_id=? AND idempotency_key=?",
                    (session["user_id"], idem),
                ).fetchone()
                if existing:
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "request": dict(existing), "idempotent_replay": True})
                connection.execute(
                    """INSERT INTO purchase_requests(
                         id,buyer_user_id,product_code,region,service_mode,service_hours,requested_gpu_hours,
                         cpu_cores,memory_gb,storage,environment,start_at,status,idempotency_key,created_at,updated_at
                       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'submitted',?,?,?)""",
                    (request_id, session["user_id"], product_code, region, service_mode, service_hours,
                     requested_gpu_hours, cpu_cores, memory_gb, storage, environment, start_at, idem, created, created),
                )
                audit(connection, session["user_id"], "purchase_request", request_id, "purchase_request.submitted", {
                    "product_code": product_code, "region": region, "service_mode": service_mode,
                    "service_hours": service_hours, "requested_gpu_hours": requested_gpu_hours,
                }, idem)
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            purchase_request = connection.execute("SELECT * FROM purchase_requests WHERE id=?", (request_id,)).fetchone()
        self.json_response(201, {"ok": True, "request": dict(purchase_request)})

    def get_supplier_workbench(self) -> None:
        session = self.session()
        require_role(session, "supplier", "supplier_pending", "admin")
        supplier_id = session["user_id"]
        with db_connect() as connection:
            applications = connection.execute(
                """SELECT id,enterprise_name,credit_code,legal_representative,agent_name,contact_phone,status,
                          review_reason,reviewed_at,next_review_at,license_file_name,license_mime,license_size,
                          license_sha256,license_verified,subject_verified,agent_verified,created_at,updated_at
                   FROM supplier_applications WHERE user_id=? ORDER BY created_at DESC""",
                (supplier_id,),
            ).fetchall()
            intakes = connection.execute(
                "SELECT id,kind,product_code,region,quantity,unit,status,evidence_summary,verification_summary,verified_at,created_at,updated_at FROM resource_intakes WHERE supplier_user_id=? ORDER BY created_at DESC",
                (supplier_id,),
            ).fetchall()
            listings = connection.execute(
                """SELECT id,intake_id,kind,product_code,gpu,provider,region,unit,unit_price_cents,
                          verified_quantity,quote_reserved,order_locked,delivering,consumed,frozen,status,
                          trade_mode,sla,minimum_quantity,valid_from,valid_until,created_at,updated_at
                   FROM listings WHERE supplier_user_id=? ORDER BY created_at DESC""",
                (supplier_id,),
            ).fetchall()
            orders = connection.execute(
                """SELECT o.* FROM orders o JOIN listings l ON l.id=o.listing_id
                   WHERE l.supplier_user_id=? ORDER BY o.created_at DESC LIMIT 100""",
                (supplier_id,),
            ).fetchall()
            settlements = connection.execute(
                "SELECT * FROM settlements WHERE supplier_user_id=? ORDER BY created_at DESC LIMIT 100",
                (supplier_id,),
            ).fetchall()
        listing_rows = []
        for row in listings:
            item = dict(row)
            item["unit_price_cny"] = item.pop("unit_price_cents") / 100
            item["available_quantity"] = max(0, item["verified_quantity"] - item["quote_reserved"] - item["order_locked"] - item["delivering"] - item["consumed"] - item["frozen"])
            listing_rows.append(item)
        self.json_response(200, {
            "ok": True,
            "supplier": {"id": supplier_id, "role": session["role"], "enterprise_status": session["enterprise_status"], "supplier_capability_level": session["supplier_capability_level"]},
            "applications": [supplier_application_dict(row) for row in applications],
            "intakes": [dict(row) for row in intakes],
            "listings": listing_rows,
            "orders": [order_dict(row) for row in orders],
            "settlements": [dict(row) for row in settlements],
        })

    def get_supplier_rebate_overview(self) -> None:
        session = self.session()
        rebates = []
        eligible_orders = []
        if session["role"] == "supplier" and session["enterprise_status"] == "certified":
            with db_connect() as connection:
                rebates = connection.execute(
                    """SELECT r.*,o.order_no,o.product_code,o.gpu,o.region
                       FROM supplier_card_hour_rebates r JOIN orders o ON o.id=r.order_id
                       WHERE r.supplier_user_id=? ORDER BY r.created_at DESC LIMIT 300""",
                    (session["user_id"],),
                ).fetchall()
                order_rows = connection.execute(
                    """SELECT o.* FROM orders o JOIN listings l ON l.id=o.listing_id
                       WHERE l.supplier_user_id=? AND o.status='accepted' AND o.kind='gpu'
                       AND o.unit='GPU 时' AND o.settlement_mode='cash'
                       AND NOT EXISTS(
                         SELECT 1 FROM supplier_card_hour_rebates r WHERE r.order_id=o.id
                       )
                       AND NOT EXISTS(
                         SELECT 1 FROM disputes d WHERE d.order_id=o.id
                         AND d.status IN ('open','reviewing')
                       )
                       AND NOT EXISTS(
                         SELECT 1 FROM refunds f WHERE f.order_id=o.id
                         AND f.status IN ('pending_review','approved','processing','success')
                       )
                       ORDER BY o.accepted_at DESC LIMIT 200""",
                    (session["user_id"],),
                ).fetchall()
                for row in order_rows:
                    amount_cents = int(row["amount_cents"])
                    eligible_orders.append({
                        "id": row["id"], "order_no": row["order_no"],
                        "product_code": row["product_code"], "gpu": row["gpu"],
                        "region": row["region"], "amount_cents": amount_cents,
                        "amount_cny": amount_cents / 100,
                        "card_hours": float(row["quantity"]), "unit": row["unit"],
                        "accepted_at": row["accepted_at"],
                        "submission_band": (
                            "over_50000" if amount_cents > SUPPLIER_REBATE_REVIEW_CENTS
                            else "up_to_50000"
                        ),
                    })
        summary = {
            "source_card_hours": sum(row["source_card_hours_micros"] for row in rebates) / CARD_HOUR_MICROS,
            "issued_card_hours": sum(
                row["rebate_card_hours_micros"] for row in rebates if row["status"] == "issued"
            ) / CARD_HOUR_MICROS,
            "pending_review_card_hours": sum(
                row["rebate_card_hours_micros"] for row in rebates if row["status"] in ("pending_review", "paused")
            ) / CARD_HOUR_MICROS,
            "order_count": len(rebates),
        }
        self.json_response(200, {
            "ok": True,
            "viewer": {
                "user_id": session["user_id"], "role": session["role"],
                "enterprise_status": session["enterprise_status"],
            },
            "eligible": session["role"] == "supplier" and session["enterprise_status"] == "certified",
            "eligible_orders": eligible_orders,
            "rebates": [supplier_rebate_dict(row) for row in rebates],
            "summary": summary,
            "policy": supplier_rebate_policy(),
        })

    def create_supplier_rebate_submission(self) -> None:
        session = self.session(csrf=True)
        require_role(session, "supplier")
        if session["enterprise_status"] != "certified":
            raise ApiError(403, "仅已认证供应商可以提交返佣申请", "supplier_not_certified")
        self.rate_limit(f"supplier-rebate-submit:{session['user_id']}", 30, 3600)
        data = self.read_json()
        order_id = clean_text(data.get("order_id"), "成交订单", 3, 100)
        submission_band = clean_text(data.get("submission_band"), "金额区间", 5, 30)
        if submission_band not in ("up_to_50000", "over_50000"):
            raise ApiError(422, "请选择正确的成交金额区间", "invalid_rebate_band")
        transaction_summary = clean_text(data.get("transaction_summary"), "交易内容", 10, 1000)
        evidence = decode_private_evidence(
            data.get("evidence_content_base64"), data.get("evidence_file_name"), "成交或结算凭证", required=False,
        )
        evidence_path = store_private_evidence(evidence, "supplier-rebates") if evidence else None
        submitted_at = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                order = connection.execute(
                    """SELECT o.*,l.supplier_user_id FROM orders o
                       JOIN listings l ON l.id=o.listing_id WHERE o.id=?""",
                    (order_id,),
                ).fetchone()
                if not order or order["supplier_user_id"] != session["user_id"]:
                    raise ApiError(404, "未找到可申报的供应商成交订单", "rebate_order_not_found")
                existing = connection.execute(
                    "SELECT * FROM supplier_card_hour_rebates WHERE order_id=?", (order_id,)
                ).fetchone()
                if existing:
                    if existing["submission_band"] and existing["submission_band"] != submission_band:
                        raise ApiError(409, "该订单已经按另一金额区间提交", "rebate_submission_conflict")
                    connection.execute("COMMIT")
                    if evidence_path:
                        Path(evidence_path).unlink(missing_ok=True)
                    return self.json_response(200, {
                        "ok": True, "rebate": supplier_rebate_dict(existing),
                        "idempotent_replay": True,
                    })
                if (
                    order["status"] != "accepted" or order["kind"] != "gpu"
                    or order["unit"] != "GPU 时" or order["settlement_mode"] != "cash"
                ):
                    raise ApiError(409, "该订单尚不符合返佣申报条件", "rebate_order_not_eligible")
                blocking_case = connection.execute(
                    """SELECT 1 FROM disputes WHERE order_id=? AND status IN ('open','reviewing')
                       UNION ALL SELECT 1 FROM refunds WHERE order_id=?
                       AND status IN ('pending_review','approved','processing','success') LIMIT 1""",
                    (order_id, order_id),
                ).fetchone()
                if blocking_case:
                    raise ApiError(409, "订单存在争议或退款，暂不能提交返佣", "rebate_submission_blocked")
                rebate = create_supplier_card_hour_rebate(
                    connection, order, session["user_id"], session["user_id"],
                    submission_band, transaction_summary, submitted_at,
                )
                if not rebate:
                    raise ApiError(409, "该订单无法换算返佣卡时", "rebate_conversion_unavailable")
                if evidence:
                    connection.execute(
                        """UPDATE supplier_card_hour_rebates SET evidence_file_name=?,evidence_mime=?,evidence_size=?,
                           evidence_sha256=?,evidence_storage_path=?,updated_at=? WHERE id=?""",
                        (evidence["file_name"], evidence["mime"], evidence["size"], evidence["sha256"],
                         evidence_path, submitted_at, rebate["id"]),
                    )
                    audit(connection, session["user_id"], "supplier_card_hour_rebate", rebate["id"],
                          "supplier_rebate.evidence_attached", {"sha256": evidence["sha256"], "size": evidence["size"]})
                    rebate = connection.execute("SELECT * FROM supplier_card_hour_rebates WHERE id=?", (rebate["id"],)).fetchone()
                connection.execute("COMMIT")
            except Exception:
                if connection.in_transaction:
                    connection.execute("ROLLBACK")
                if evidence_path:
                    Path(evidence_path).unlink(missing_ok=True)
                raise
        self.json_response(201, {"ok": True, "rebate": supplier_rebate_dict(rebate)})

    def update_supplier_referral_program(self) -> None:
        session = self.session(csrf=True)
        require_role(session, "supplier")
        if session["enterprise_status"] != "certified":
            raise ApiError(403, "仅已认证供应商可以开启返佣计划", "supplier_not_certified")
        data = self.read_json()
        try:
            rate_percent = float(data.get("commission_rate_percent"))
        except (TypeError, ValueError):
            raise ApiError(422, "返佣比例无效", "invalid_commission_rate")
        rate_bps = int(round(rate_percent * 100))
        if rate_bps < 100 or rate_bps > 2000:
            raise ApiError(422, "返佣比例必须在 1% 至 20% 之间", "invalid_commission_rate")
        status = clean_text(data.get("status") or "active", "计划状态", 4, 20)
        if status not in ("active", "paused"):
            raise ApiError(422, "返佣计划状态无效")
        updated = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                ensure_supplier_referral_program(connection, session["user_id"])
                connection.execute(
                    """UPDATE supplier_referral_programs SET commission_rate_bps=?,status=?,updated_at=?
                       WHERE supplier_user_id=?""",
                    (rate_bps, status, updated, session["user_id"]),
                )
                audit(connection, session["user_id"], "supplier_referral_program", session["user_id"],
                      "supplier_referral.program_updated", {"commission_rate_bps": rate_bps, "status": status})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            program = connection.execute(
                "SELECT * FROM supplier_referral_programs WHERE supplier_user_id=?", (session["user_id"],)
            ).fetchone()
        self.json_response(200, {"ok": True, "program": dict(program)})

    def create_supplier_referral_invitation(self) -> None:
        session = self.session(csrf=True)
        require_role(session, "supplier")
        if session["enterprise_status"] != "certified":
            raise ApiError(403, "仅已认证供应商可以邀请推广伙伴", "supplier_not_certified")
        self.rate_limit(f"supplier-referral-invite:{session['user_id']}", 20, 3600)
        data = self.read_json()
        partner_account = clean_text(data.get("partner_account"), "推广伙伴账户", 3, 160).lower()
        invited_at = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                program = ensure_supplier_referral_program(connection, session["user_id"])
                if program["status"] != "active":
                    raise ApiError(409, "返佣计划已暂停，请先恢复计划")
                partner = connection.execute(
                    "SELECT * FROM users WHERE lower(account)=? AND lifecycle_status='active'",
                    (partner_account,),
                ).fetchone()
                if not partner:
                    raise ApiError(404, "推广伙伴账户不存在", "partner_not_found")
                if partner["id"] == session["user_id"]:
                    raise ApiError(422, "不能邀请自己的账户")
                existing = connection.execute(
                    "SELECT * FROM supplier_referral_partners WHERE supplier_user_id=? AND partner_user_id=?",
                    (session["user_id"], partner["id"]),
                ).fetchone()
                if existing and existing["status"] in ("pending_confirmation", "active"):
                    raise ApiError(409, "该账户已有待确认邀请或已是推广伙伴", "partner_relation_exists")
                code = next_supplier_referral_code(connection)
                if existing:
                    relation_id = existing["id"]
                    connection.execute(
                        """UPDATE supplier_referral_partners SET commission_rate_bps=?,referral_code=?,
                           status='pending_confirmation',invited_at=?,accepted_at=NULL,rejected_at=NULL,updated_at=? WHERE id=?""",
                        (program["commission_rate_bps"], code, invited_at, invited_at, relation_id),
                    )
                else:
                    relation_id = uid("suppartner")
                    connection.execute(
                        """INSERT INTO supplier_referral_partners(
                           id,supplier_user_id,partner_user_id,commission_rate_bps,referral_code,status,invited_at,updated_at
                           ) VALUES(?,?,?,?,?,'pending_confirmation',?,?)""",
                        (relation_id, session["user_id"], partner["id"], program["commission_rate_bps"], code, invited_at, invited_at),
                    )
                audit(connection, session["user_id"], "supplier_referral_partner", relation_id,
                      "supplier_referral.invited", {"partner_user_id": partner["id"], "commission_rate_bps": program["commission_rate_bps"]})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            invitation = connection.execute(
                "SELECT * FROM supplier_referral_partners WHERE id=?", (relation_id,)
            ).fetchone()
        self.json_response(201, {"ok": True, "invitation": dict(invitation)})

    def resolve_supplier_referral_invitation(self, relation_id: str, action: str) -> None:
        session = self.session(csrf=True)
        resolved_at = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                relation = connection.execute(
                    "SELECT * FROM supplier_referral_partners WHERE id=?", (relation_id,)
                ).fetchone()
                if not relation or relation["partner_user_id"] != session["user_id"]:
                    raise ApiError(404, "返佣邀请不存在", "invitation_not_found")
                if relation["status"] != "pending_confirmation":
                    raise ApiError(409, "返佣邀请已经处理", "invitation_already_resolved")
                status = "active" if action == "accept" else "rejected"
                connection.execute(
                    """UPDATE supplier_referral_partners SET status=?,accepted_at=?,rejected_at=?,updated_at=? WHERE id=?""",
                    (status, resolved_at if action == "accept" else None,
                     resolved_at if action == "reject" else None, resolved_at, relation_id),
                )
                audit(connection, session["user_id"], "supplier_referral_partner", relation_id,
                      f"supplier_referral.invitation_{action}ed", {"supplier_user_id": relation["supplier_user_id"]})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            updated = connection.execute(
                "SELECT * FROM supplier_referral_partners WHERE id=?", (relation_id,)
            ).fetchone()
        self.json_response(200, {"ok": True, "partnership": dict(updated)})

    def claim_supplier_referral(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        referral_code = clean_text(data.get("referral_code"), "供应商推荐码", 8, 80).upper()
        attributed_at = now_iso()
        expires_at = (
            datetime.now(timezone.utc) + timedelta(days=SUPPLIER_REFERRAL_WINDOW_DAYS)
        ).replace(microsecond=0).isoformat()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                relation = connection.execute(
                    """SELECT p.*,u.name AS supplier_name,u.enterprise_status
                       FROM supplier_referral_partners p JOIN users u ON u.id=p.supplier_user_id
                       JOIN supplier_referral_programs g ON g.supplier_user_id=p.supplier_user_id
                       WHERE p.referral_code=? AND p.status='active' AND g.status='active'""",
                    (referral_code,),
                ).fetchone()
                if not relation or relation["enterprise_status"] != "certified":
                    raise ApiError(404, "供应商推荐码无效或已暂停", "referral_code_invalid")
                if session["user_id"] in (relation["supplier_user_id"], relation["partner_user_id"]):
                    raise ApiError(422, "不能对自己的推荐关系进行归因", "self_referral_blocked")
                existing = connection.execute(
                    """SELECT * FROM supplier_referral_attributions
                       WHERE buyer_user_id=? AND supplier_user_id=?""",
                    (session["user_id"], relation["supplier_user_id"]),
                ).fetchone()
                if existing and existing["locked_at"]:
                    if existing["partner_relation_id"] != relation["id"]:
                        raise ApiError(409, "该供应商的推荐关系已随首笔合格订单锁定", "attribution_locked")
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "attribution": dict(existing), "idempotent_replay": True})
                if existing:
                    attribution_id = existing["id"]
                    connection.execute(
                        """UPDATE supplier_referral_attributions SET partner_relation_id=?,status='active',
                           attributed_at=?,expires_at=?,updated_at=? WHERE id=?""",
                        (relation["id"], attributed_at, expires_at, attributed_at, attribution_id),
                    )
                else:
                    attribution_id = uid("supattrib")
                    connection.execute(
                        """INSERT INTO supplier_referral_attributions(
                           id,buyer_user_id,supplier_user_id,partner_relation_id,status,attributed_at,expires_at,updated_at
                           ) VALUES(?,?,?,?,'active',?,?,?)""",
                        (attribution_id, session["user_id"], relation["supplier_user_id"], relation["id"], attributed_at, expires_at, attributed_at),
                    )
                audit(connection, session["user_id"], "supplier_referral_attribution", attribution_id,
                      "supplier_referral.attributed", {"supplier_user_id": relation["supplier_user_id"], "partner_relation_id": relation["id"], "expires_at": expires_at})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            attribution = connection.execute(
                "SELECT * FROM supplier_referral_attributions WHERE id=?", (attribution_id,)
            ).fetchone()
        self.json_response(200, {"ok": True, "attribution": dict(attribution), "supplier_name": relation["supplier_name"]})

    def get_compute_products(self) -> None:
        with db_connect() as connection:
            rows = connection.execute(
                """SELECT p.*,l.status AS listing_status,l.region AS listing_region,
                          CASE WHEN l.id IS NULL THEN 0 ELSE
                            l.verified_quantity-l.quote_reserved-l.order_locked-l.delivering-l.consumed-l.frozen END AS linked_available
                   FROM compute_products p LEFT JOIN listings l ON l.id=p.linked_listing_id
                   WHERE p.status='active' ORDER BY p.gpu,p.gpu_count"""
            ).fetchall()
        products = [{
            "id": row["id"], "gpu": row["gpu"], "display_name": row["display_name"],
            "gpu_count": row["gpu_count"], "cpu_cores": row["cpu_cores"], "memory_gb": row["memory_gb"],
            "hourly_price_cny": row["hourly_price_cents"] / 100, "currency": row["currency"],
            "billing_unit": row["billing_unit"], "availability_status": row["availability_status"],
            "listing_id": row["linked_listing_id"], "region": row["listing_region"],
            "available_quantity": row["linked_available"],
            "checkout_ready": bool(row["linked_listing_id"] and row["listing_status"] == "active" and row["linked_available"] > 0),
            "spec_notice": "未来一个月闲置库存已确认；下单时按服务端最新可售实例时原子锁定。",
        } for row in rows]
        self.json_response(200, {
            "ok": True, "source": "owner_price_sheet_2026-08-21", "products": products,
            "gpu_types": sorted({row["gpu"] for row in rows}),
            "price_notice": "价格按整套配置每小时计算；当前闲置库存可直接下单并进入真实付款。",
        })

    def compute_agent_note(self, requirement: dict, best: dict, alternatives: list[dict]) -> tuple[str, str]:
        fallback = (
            f"推荐 {best['product_code']}：按现有产品目录组合 {best['allocated_gpu_count']} 张 GPU，"
            f"整套每小时 ¥{best['hourly_price_cny']:,.2f}，预计总价 ¥{best['total_cost_cny']:,.2f}；"
            "CPU、内存和可售台数需在锁定库存前确认。"
        )
        if not OPENAI_API_KEY:
            return fallback, "cloudpay-optimizer"
        prompt = {
            "requirement": requirement,
            "selected_plan": {
                key: best[key] for key in (
                    "product_code", "gpu", "requested_gpu_count", "allocated_gpu_count", "duration_hours",
                    "hourly_price_cny", "total_cost_cny", "within_budget", "score", "instance_count"
                )
            },
            "alternatives": [
                {key: item[key] for key in ("product_code", "gpu", "total_cost_cny", "score", "within_budget")}
                for item in alternatives[:2]
            ],
        }
        request_body = json.dumps({
            "model": OPENAI_MODEL,
            "store": False,
            "reasoning": {"effort": "high"},
            "max_output_tokens": 220,
            "instructions": (
                "你是 CloudPay 算力调度分析师。系统已经按正式产品价目和确定性约束选定配置组合；"
                "你只能解释选择理由，不能修改价格、配置或推荐结果。请用不超过120个汉字的一段中文，"
                "说明性价比、预算、拓扑，以及库存仍需确认，不要使用 Markdown。"
            ),
            "input": json.dumps(prompt, ensure_ascii=False, separators=(",", ":")),
        }, ensure_ascii=False).encode("utf-8")
        request = Request(
            f"{OPENAI_BASE_URL}/responses",
            data=request_body,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=OPENAI_TIMEOUT_SECONDS) as response:
                payload = json.loads(response.read().decode("utf-8"))
            notes: list[str] = []
            for item in payload.get("output", []):
                if item.get("type") != "message":
                    continue
                for content in item.get("content", []):
                    if content.get("type") == "output_text" and content.get("text"):
                        notes.append(str(content["text"]).strip())
            note = " ".join(notes).replace("\x00", "").strip()
            if note:
                return note[:260], OPENAI_MODEL
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
            print(f"Compute agent explanation fallback: {type(error).__name__}")
        return fallback, "cloudpay-optimizer"

    def create_compute_agent_match(self) -> None:
        ip_key = hashlib.sha256(self.client_address[0].encode("utf-8")).hexdigest()
        self.rate_limit(f"compute-agent:{ip_key}", 10, 60)
        data = self.read_json()

        workload = str(data.get("workload", "training")).strip().lower()
        workload_labels = {
            "training": "模型训练 / 微调", "inference": "在线推理",
            "render": "渲染 / 生成", "science": "科学计算",
        }
        if workload not in workload_labels:
            raise ApiError(422, "请选择有效的使用场景", "invalid_workload")

        gpu_type = str(data.get("gpu_type", "auto")).strip().upper()
        if gpu_type == "AUTO":
            gpu_type = "auto"
        duration_unit = str(data.get("duration_unit", "hours")).strip().lower()
        unit_hours = {"hours": 1, "days": 24, "months": 720}
        if duration_unit not in unit_hours:
            raise ApiError(422, "使用时长单位无效", "invalid_duration_unit")
        try:
            gpu_count = int(data.get("gpu_count", 1))
            duration_value = float(data.get("duration_value", 1))
            budget_cny = float(data.get("budget_cny", 0))
        except (TypeError, ValueError):
            raise ApiError(422, "卡数、时长或预算格式无效", "invalid_requirement_numbers")
        if not 1 <= gpu_count <= 64:
            raise ApiError(422, "显卡数量需在 1 到 64 张之间", "invalid_gpu_count")
        if not 1 <= duration_value <= 8760:
            raise ApiError(422, "使用时长超出可调度范围", "invalid_duration")
        if not 1 <= budget_cny <= 100_000_000:
            raise ApiError(422, "预算需在 ¥1 到 ¥100,000,000 之间", "invalid_budget")

        duration_hours = round(duration_value * unit_hours[duration_unit], 2)
        required_gpu_hours = round(gpu_count * duration_hours, 2)
        if required_gpu_hours > 5_000_000:
            raise ApiError(422, "本次需求规模超出在线自动调度范围，请提交企业项目", "requirement_too_large")
        region = re.sub(r"[^\w\u4e00-\u9fff· -]", "", str(data.get("region", "上海")))[:40] or "上海"
        if region != "上海":
            raise ApiError(422, "当前服务区域仅开放上海", "unsupported_region")
        start_time = str(data.get("start_time", "today")).strip().lower()
        if start_time not in {"now", "today", "tomorrow", "flexible"}:
            raise ApiError(422, "开始时间无效", "invalid_start_time")

        performance = {
            "B200": {"training": 100, "inference": 100, "render": 95, "science": 100},
            "B300": {"training": 94, "inference": 96, "render": 90, "science": 94},
            "H200": {"training": 96, "inference": 98, "render": 91, "science": 97},
            "H100": {"training": 91, "inference": 92, "render": 88, "science": 93},
            "RTX5090": {"training": 55, "inference": 80, "render": 96, "science": 64},
            "RTX4090": {"training": 40, "inference": 68, "render": 87, "science": 52},
        }
        with db_connect() as connection:
            rows = connection.execute(
                """SELECT p.*,l.status AS listing_status,l.region AS listing_region,
                          CASE WHEN l.id IS NULL THEN 0 ELSE
                            l.verified_quantity-l.quote_reserved-l.order_locked-l.delivering-l.consumed-l.frozen END AS linked_available
                   FROM compute_products p LEFT JOIN listings l ON l.id=p.linked_listing_id
                   WHERE p.status='active' ORDER BY p.gpu,p.gpu_count,p.hourly_price_cents"""
            ).fetchall()
        product_types = sorted({str(row["gpu"]).upper() for row in rows})
        if gpu_type != "auto" and gpu_type not in product_types:
            raise ApiError(409, "现有产品目录中没有该显卡配置", "gpu_unavailable")
        families: dict[str, list[sqlite3.Row]] = {}
        for row in rows:
            code = str(row["gpu"]).upper()
            if gpu_type == "auto" or gpu_type == code:
                families.setdefault(code, []).append(row)
        if not families:
            raise ApiError(409, "当前产品目录没有可用于调度的配置", "product_catalog_empty")

        candidates: list[dict] = []
        topology_penalty = {"training": .08, "science": .06, "inference": .025, "render": .025}[workload]
        for code, variants in families.items():
            max_bundle = max(int(row["gpu_count"]) for row in variants)
            limit = gpu_count + max_bundle - 1
            states: dict[tuple[int, int], tuple[int, list[str]]] = {(0, 0): (0, [])}
            for total in range(limit + 1):
                current = [(key, value) for key, value in states.items() if key[0] == total]
                for (used, instances), (hourly_cents, configuration_ids) in current:
                    for row in variants:
                        next_total = used + int(row["gpu_count"])
                        next_instances = instances + 1
                        if next_total > limit or next_instances > 64:
                            continue
                        key = (next_total, next_instances)
                        candidate_cost = hourly_cents + int(row["hourly_price_cents"])
                        existing = states.get(key)
                        if existing is None or candidate_cost < existing[0]:
                            states[key] = (candidate_cost, configuration_ids + [row["id"]])
            feasible_states = []
            for (allocated, instances), (hourly_cents, configuration_ids) in states.items():
                if allocated < gpu_count or not configuration_ids:
                    continue
                waste_ratio = (allocated - gpu_count) / gpu_count
                effective_cost = hourly_cents * (1 + max(0, instances - 1) * topology_penalty + waste_ratio * .16)
                feasible_states.append((effective_cost, hourly_cents, instances, allocated, configuration_ids))
            if not feasible_states:
                continue
            _, hourly_cents, instance_count, allocated_gpu_count, configuration_ids = min(feasible_states)
            rows_by_id = {row["id"]: row for row in variants}
            configuration_counts: dict[str, int] = {}
            for configuration_id in configuration_ids:
                configuration_counts[configuration_id] = configuration_counts.get(configuration_id, 0) + 1
            configurations = []
            cpu_cores = 0
            memory_gb = 0
            for configuration_id, quantity in sorted(configuration_counts.items(), key=lambda item: -rows_by_id[item[0]]["gpu_count"]):
                product = rows_by_id[configuration_id]
                cpu_cores += int(product["cpu_cores"]) * quantity
                memory_gb += int(product["memory_gb"]) * quantity
                configurations.append({
                    "product_id": product["id"], "display_name": product["display_name"], "quantity": quantity,
                    "gpu_count_each": product["gpu_count"], "cpu_cores_each": product["cpu_cores"],
                    "memory_gb_each": product["memory_gb"], "hourly_price_cny_each": product["hourly_price_cents"] / 100,
                    "availability_status": product["availability_status"], "listing_id": product["linked_listing_id"],
                    "available_quantity": product["linked_available"],
                })
            hourly_price = round(hourly_cents / 100, 2)
            total_cost = round(hourly_price * duration_hours, 2)
            within_budget = total_cost <= budget_cny
            waste_ratio = (allocated_gpu_count - gpu_count) / gpu_count
            topology_score = max(42.0, 100 - max(0, instance_count - 1) * (14 if workload == "training" else 8) - waste_ratio * 30)
            memory_per_gpu = memory_gb / max(1, allocated_gpu_count)
            resource_score = min(100.0, 52 + memory_per_gpu * .16)
            configuration_label = " + ".join(
                f"{item['display_name']}" + (f" × {item['quantity']} 套" if item["quantity"] > 1 else "")
                for item in configurations
            )
            direct_listing_id = None
            checkout_quantity = 0.0
            direct_region = "上海"
            if len(configuration_counts) == 1:
                direct_product = rows_by_id[next(iter(configuration_counts))]
                checkout_quantity = round(instance_count * duration_hours, 2)
                if (
                    direct_product["linked_listing_id"]
                    and direct_product["listing_status"] == "active"
                    and float(direct_product["linked_available"] or 0) >= checkout_quantity
                ):
                    direct_listing_id = direct_product["linked_listing_id"]
                    direct_region = direct_product["listing_region"] or "上海"
            checkout_ready = bool(direct_listing_id)
            candidates.append({
                "listing_id": direct_listing_id, "gpu": code, "product_code": configuration_label,
                "provider": "CloudPay 自有资源", "region": direct_region if checkout_ready else ("待下单确认" if region == "any" else f"{region} · 待确认"),
                "sla": "未来一个月闲置库存已确认" if checkout_ready else "组合资源需确认", "requested_gpu_count": gpu_count,
                "allocated_gpu_count": allocated_gpu_count, "gpu_count": gpu_count,
                "duration_hours": duration_hours, "required_gpu_hours": required_gpu_hours,
                "hourly_price_cny": hourly_price, "unit_price_cny": hourly_price,
                "total_cost_cny": total_cost, "within_budget": within_budget,
                "budget_delta_cny": round(budget_cny - total_cost, 2),
                "performance_score": float(performance.get(code, {}).get(workload, 65)),
                "topology_score": round(topology_score, 1), "resource_score": round(resource_score, 1),
                "region_score": 100.0 if region == "any" else 65.0,
                "instance_count": instance_count, "cpu_cores": cpu_cores, "memory_gb": memory_gb,
                "configurations": configurations, "configuration_ids": configuration_ids,
                "availability_status": "available" if checkout_ready else "confirmation_required",
                "checkout_ready": checkout_ready, "checkout_quantity": checkout_quantity if checkout_ready else None,
                "unit": "配置时", "pricing_basis": "整套配置每小时",
            })
        if not candidates:
            raise ApiError(409, "当前产品目录无法组合出所需卡数", "configuration_unavailable")
        minimum_hourly = min(item["hourly_price_cny"] for item in candidates)
        for item in candidates:
            item["cost_score"] = round(min(100.0, minimum_hourly / max(.01, item["hourly_price_cny"]) * 100), 1)
            budget_score = 100.0 if item["within_budget"] else max(0.0, budget_cny / item["total_cost_cny"] * 100)
            item["score"] = round(
                item["cost_score"] * .28 + item["performance_score"] * .36 + budget_score * .14
                + item["topology_score"] * .12 + item["resource_score"] * .06 + item["region_score"] * .04,
                1,
            )
        candidates.sort(key=lambda item: (-int(item["within_budget"]), -item["score"], item["total_cost_cny"]))
        best = candidates[0]
        requirement = {
            "workload": workload, "workload_label": workload_labels[workload], "gpu_type": gpu_type,
            "gpu_count": gpu_count, "duration_hours": duration_hours, "required_gpu_hours": required_gpu_hours,
            "budget_cny": round(budget_cny, 2), "region": region, "start_time": start_time,
        }
        note, agent_mode = self.compute_agent_note(requirement, best, candidates[1:3])
        self.json_response(200, {
            "ok": True, "source": "owner_compute_product_catalog", "allocation_status": "configuration_matched" if best["within_budget"] else "over_budget",
            "agent": {"mode": agent_mode, "model": OPENAI_MODEL if agent_mode == OPENAI_MODEL else None, "note": note},
            "requirement": requirement, "best": best, "alternatives": candidates[1:3],
            "constraints": {
                "price_locked_at_order": bool(best["checkout_ready"]), "automatic_payment": False,
                "availability_confirmation_required": not best["checkout_ready"], "request_submission_available": True,
                "notice": (
                    "该规格未来一个月闲置库存已确认，可立即创建订单并进入真实收银台；支付成功仅以服务端验签和主动查单为准。"
                    if best["checkout_ready"] else
                    "当前方案包含多个不同规格，需先确认组合库存；确认后再开放真实付款。"
                ),
            },
        })

    def create_compute_product_request(self) -> None:
        session = self.session(csrf=True)
        self.rate_limit(f"compute-product-request:{session['user_id']}", 10, 3600)
        data = self.read_json()
        configuration_ids = data.get("configuration_ids")
        if not isinstance(configuration_ids, list) or not configuration_ids or len(configuration_ids) > 64:
            raise ApiError(422, "产品配置组合无效", "invalid_configuration_ids")
        clean_ids = [clean_text(item, "产品配置", 4, 80) for item in configuration_ids]
        try:
            requested_gpu_count = int(data.get("requested_gpu_count"))
            duration_hours = round(float(data.get("duration_hours")), 2)
            budget_cents = round(float(data.get("budget_cny")) * 100)
        except (TypeError, ValueError):
            raise ApiError(422, "资源确认需求格式无效", "invalid_compute_request")
        if not 1 <= requested_gpu_count <= 64 or not 1 <= duration_hours <= 8760 or budget_cents < 100:
            raise ApiError(422, "资源确认需求超出范围", "invalid_compute_request")
        region = re.sub(r"[^\w\u4e00-\u9fff· -]", "", str(data.get("region", "上海")))[:40] or "上海"
        if region != "上海":
            raise ApiError(422, "当前服务区域仅开放上海", "unsupported_region")
        placeholders = ",".join("?" for _ in set(clean_ids))
        with db_connect() as connection:
            products = connection.execute(
                f"SELECT * FROM compute_products WHERE status='active' AND id IN ({placeholders})",
                tuple(set(clean_ids)),
            ).fetchall()
            product_map = {row["id"]: row for row in products}
            if len(product_map) != len(set(clean_ids)):
                raise ApiError(409, "产品配置已更新，请重新调度", "compute_product_changed")
            allocated_gpu_count = sum(int(product_map[item]["gpu_count"]) for item in clean_ids)
            if allocated_gpu_count < requested_gpu_count:
                raise ApiError(422, "产品组合不足以满足请求卡数", "configuration_capacity_mismatch")
            gpu_types = {product_map[item]["gpu"] for item in clean_ids}
            if len(gpu_types) != 1:
                raise ApiError(422, "一次资源确认只能包含一种 GPU 型号", "mixed_gpu_configuration")
            hourly_price_cents = sum(int(product_map[item]["hourly_price_cents"]) for item in clean_ids)
            estimated_amount_cents = round(hourly_price_cents * duration_hours)
            plan = {
                "configuration_ids": clean_ids, "gpu": next(iter(gpu_types)),
                "requested_gpu_count": requested_gpu_count, "allocated_gpu_count": allocated_gpu_count,
                "duration_hours": duration_hours, "hourly_price_cents": hourly_price_cents,
                "estimated_amount_cents": estimated_amount_cents,
                "notice": "CPU、内存、地区和可售台数需由运营确认；确认前不创建支付单。",
            }
            idem = require_idempotency_key(self.headers)
            created = now_iso()
            request_id = uid("cpr")
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute(
                    "SELECT * FROM compute_product_requests WHERE buyer_user_id=? AND idempotency_key=?",
                    (session["user_id"], idem),
                ).fetchone()
                if existing:
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "request": dict(existing), "idempotent_replay": True})
                connection.execute(
                    """INSERT INTO compute_product_requests(
                         id,buyer_user_id,gpu,requested_gpu_count,allocated_gpu_count,duration_hours,region,
                         budget_cents,estimated_amount_cents,plan_json,status,idempotency_key,created_at,updated_at
                       ) VALUES(?,?,?,?,?,?,?,?,?,?,'pending_capacity_confirmation',?,?,?)""",
                    (request_id, session["user_id"], plan["gpu"], requested_gpu_count, allocated_gpu_count,
                     duration_hours, region, budget_cents, estimated_amount_cents,
                     json.dumps(plan, ensure_ascii=False, separators=(",", ":")), idem, created, created),
                )
                audit(connection, session["user_id"], "compute_product_request", request_id,
                      "compute_product_request.submitted", plan, idem)
                connection.execute("COMMIT")
            except Exception:
                if connection.in_transaction:
                    connection.execute("ROLLBACK")
                raise
            row = connection.execute("SELECT * FROM compute_product_requests WHERE id=?", (request_id,)).fetchone()
        self.json_response(201, {"ok": True, "request": dict(row)})

    def get_admin_overview(self) -> None:
        session = self.session()
        require_role(session, "admin")
        with db_connect() as connection:
            applications = connection.execute(
                """SELECT a.*,u.name,u.account FROM supplier_applications a JOIN users u ON u.id=a.user_id
                   WHERE a.status IN ('reviewing','restricted') ORDER BY a.created_at"""
            ).fetchall()
            intakes = connection.execute(
                """SELECT i.*,u.name AS supplier_name FROM resource_intakes i JOIN users u ON u.id=i.supplier_user_id
                   WHERE i.status IN ('pending_verification','frozen') ORDER BY i.created_at"""
            ).fetchall()
            listings = connection.execute(
                """SELECT l.*,u.name AS supplier_name FROM listings l JOIN users u ON u.id=l.supplier_user_id
                   WHERE l.status IN ('pending_review','suspended') ORDER BY l.created_at"""
            ).fetchall()
            environment_preflights = connection.execute(
                """SELECT e.*,u.name AS buyer_name,u.account AS buyer_account
                   FROM environment_preflights e JOIN users u ON u.id=e.buyer_user_id
                   WHERE e.status='pending_review' ORDER BY e.created_at"""
            ).fetchall()
            disputes = connection.execute(
                "SELECT * FROM disputes WHERE status IN ('open','reviewing') ORDER BY created_at"
            ).fetchall()
            refunds = connection.execute(
                "SELECT * FROM refunds WHERE status IN ('pending_review','approved','processing') ORDER BY created_at"
            ).fetchall()
            settlements = connection.execute(
                "SELECT * FROM settlements WHERE status IN ('holding','payable') ORDER BY created_at"
            ).fetchall()
            supplier_rebates = connection.execute(
                """SELECT r.*,s.name AS supplier_name,s.account AS supplier_account,
                          o.order_no,o.product_code,o.gpu,o.region
                   FROM supplier_card_hour_rebates r
                   JOIN users s ON s.id=r.supplier_user_id JOIN orders o ON o.id=r.order_id
                   WHERE r.status IN ('pending_review','paused','clawback_required')
                   ORDER BY r.created_at"""
            ).fetchall()
            invoices = connection.execute(
                "SELECT * FROM invoice_requests WHERE status='requested' ORDER BY created_at"
            ).fetchall()
            metering_orders = connection.execute(
                """SELECT o.*,u.name AS supplier_name FROM orders o
                   JOIN listings l ON l.id=o.listing_id JOIN users u ON u.id=l.supplier_user_id
                   WHERE o.status='delivered'
                   AND NOT EXISTS(SELECT 1 FROM metering_records m WHERE m.order_id=o.id AND m.source='kai_gateway')
                   ORDER BY o.delivered_at"""
            ).fetchall()
            swaps = connection.execute(
                "SELECT * FROM swap_requests WHERE status IN ('matching','quoted','confirmed') ORDER BY created_at"
            ).fetchall()
            account_deletions = connection.execute(
                "SELECT d.*,u.name,u.account FROM account_deletion_requests d JOIN users u ON u.id=d.user_id WHERE d.status IN ('pending_obligations','scheduled') ORDER BY d.requested_at"
            ).fetchall()
            payment_reconciliation_reviews = connection.execute(
                """SELECT r.*,p.provider,p.status AS payment_status,p.amount_cents,
                          p.currency,o.order_no
                   FROM payment_reconciliation_reviews r
                   JOIN payments p ON p.id=r.payment_id
                   JOIN orders o ON o.id=p.order_id
                   WHERE r.status IN ('open','acknowledged_monitoring')
                   ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END,
                            r.updated_at"""
            ).fetchall()
            swap_target_listings = connection.execute(
                """SELECT l.id,l.kind,l.product_code,l.gpu,l.region,l.unit,l.unit_price_cents,l.minimum_quantity,
                          (l.verified_quantity-l.quote_reserved-l.order_locked-l.delivering-l.consumed-l.frozen) AS available_quantity,
                          u.name AS supplier_name
                   FROM listings l JOIN users u ON u.id=l.supplier_user_id
                   WHERE l.status='active' AND l.trade_mode='fixed' AND l.valid_until>?
                   ORDER BY l.kind,l.product_code,l.unit_price_cents""",
                (now_iso(),),
            ).fetchall()
            counts = {
                "pending_supplier_reviews": len(applications), "pending_intakes": len(intakes),
                "pending_listings": len(listings), "open_disputes": len(disputes),
                "pending_environment_preflights": len(environment_preflights),
                "pending_refunds": len(refunds), "pending_settlements": len(settlements),
                "pending_supplier_rebates": len(supplier_rebates),
                "pending_invoices": len(invoices),
                "pending_gateway_metering": len(metering_orders),
                "pending_swaps": len(swaps), "pending_account_deletions": len(account_deletions),
                "payment_reviews_action_required": sum(
                    row["status"] == "open"
                    for row in payment_reconciliation_reviews
                ),
                "payment_reviews_acknowledged_monitoring": sum(
                    row["status"] == "acknowledged_monitoring"
                    for row in payment_reconciliation_reviews
                ),
                "pending_outbox": connection.execute("SELECT COUNT(*) FROM outbox WHERE status='pending'").fetchone()[0],
            }
        review_queue = []

        def add_review(kind: str, label: str, tab: str, item_id: str, title: str,
                       summary: str, status: str, submitted_at: str | None) -> None:
            review_queue.append({
                "kind": kind, "label": label, "tab": tab, "id": item_id,
                "title": title, "summary": summary, "status": status,
                "submitted_at": submitted_at,
            })

        for row in applications:
            add_review("supplier", "企业认证", "suppliers", row["id"], row["enterprise_name"],
                       f"{row['name']} · {row['account']}", row["status"], row["created_at"])
        for row in intakes:
            add_review("intake", "资源验真", "resources", row["id"], row["product_code"],
                       f"{row['supplier_name']} · {row['region']} · {row['quantity']} {row['unit']}",
                       row["status"], row["created_at"])
        for row in listings:
            add_review("listing", "挂牌审核", "resources", row["id"], row["product_code"],
                       f"{row['supplier_name']} · {row['region']} · {row['verified_quantity']} {row['unit']}",
                       row["status"], row["created_at"])
        for row in environment_preflights:
            mode_label = ENVIRONMENT_DELIVERY_MODES.get(row["delivery_mode"], {}).get("label", row["delivery_mode"])
            add_review("environment", "环境预检", "environments", row["id"], mode_label,
                       f"{row['buyer_name']} · {row['gpu']} · {row['task']}", row["status"], row["created_at"])
        for row in disputes:
            add_review("dispute", "争议处理", "aftersale", row["id"], row["category"],
                       f"订单 {row['order_id']} · {row['reason']}", row["status"], row["created_at"])
        for row in refunds:
            add_review("refund", "退款审核", "aftersale", row["id"], f"订单 {row['order_id']}",
                       f"¥ {row['amount_cents'] / 100:.2f} · {row['reason']}", row["status"], row["created_at"])
        for row in supplier_rebates:
            add_review("supplier_rebate", "返佣审核", "finance", row["id"], row["order_no"],
                       f"{row['supplier_name']} · ¥ {row['amount_cents'] / 100:.2f} · {row['rebate_card_hours_micros'] / CARD_HOUR_MICROS:g} GPU 时",
                       row["status"], row["created_at"])
        for row in swaps:
            if row["status"] == "matching":
                add_review("swap", "置换撮合", "accounts", row["id"], row["target_product_code"],
                           f"{row['source_quantity']:g} {row['source_unit']} → {row['target_region']}",
                           row["status"], row["created_at"])
        for row in account_deletions:
            add_review("account_deletion", "账号注销", "accounts", row["id"], row["name"],
                       f"{row['account']} · {row['reason']}", row["status"], row["requested_at"])
        for row in payment_reconciliation_reviews:
            if row["status"] == "open":
                add_review(
                    "payment_reconciliation",
                    "支付核单",
                    "finance",
                    row["payment_id"],
                    row["order_no"],
                    f"{row['provider']} · ¥ {row['amount_cents'] / 100:.2f} · 继续后台查单中",
                    row["status"],
                    row["first_flagged_at"],
                )
        review_queue.sort(key=lambda item: item["submitted_at"] or "")
        self.json_response(200, {
            "ok": True, "counts": counts, "readiness": integration_readiness(),
            "review_queue": review_queue,
            "applications": [supplier_application_dict(row, admin=True) for row in applications], "intakes": [dict(row) for row in intakes],
            "listings": [dict(row) for row in listings], "disputes": [dict(row) for row in disputes],
            "environment_preflights": [environment_preflight_dict(row) | {"buyer_name": row["buyer_name"], "buyer_account": row["buyer_account"]} for row in environment_preflights],
            "refunds": [dict(row) for row in refunds], "settlements": [dict(row) for row in settlements],
            "supplier_rebates": [supplier_rebate_dict(row) for row in supplier_rebates],
            "invoices": [dict(row) for row in invoices], "metering_orders": [order_dict(row) | {"supplier_name": row["supplier_name"]} for row in metering_orders],
            "swaps": [dict(row) for row in swaps], "account_deletions": [dict(row) for row in account_deletions],
            "payment_reconciliation_reviews": [
                dict(row) for row in payment_reconciliation_reviews
            ],
            "swap_target_listings": [dict(row) for row in swap_target_listings],
        })

    def admin_review_supplier(self, application_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        decision = clean_text(data.get("decision"), "审核决定", 3, 20)
        if decision not in ("certified", "restricted", "needs_changes"):
            raise ApiError(422, "供应商审核决定无效")
        reason = clean_text(data.get("reason") or "审核资料符合平台规则", "审核理由", 4, 500)
        capability_level = clean_text(
            data.get("supplier_capability_level") or ("L3" if decision == "certified" else "L1"),
            "供应商能力等级", 2, 2,
        ).upper()
        if not re.fullmatch(r"L[1-5]", capability_level):
            raise ApiError(422, "供应商能力等级必须为 L1 至 L5", "invalid_supplier_capability_level")
        checks = {
            "bank_account_verified": bool(data.get("bank_account_verified")),
            "invoice_verified": bool(data.get("invoice_verified")),
            "resource_proof_verified": bool(data.get("resource_proof_verified")),
            "license_verified": bool(data.get("license_verified")),
            "subject_verified": bool(data.get("subject_verified", data.get("bank_account_verified"))),
            "agent_verified": bool(data.get("agent_verified", data.get("resource_proof_verified"))),
        }
        reviewed = now_iso()
        next_review = (datetime.now(timezone.utc) + timedelta(days=180)).replace(microsecond=0).isoformat() if decision == "certified" else None
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                application = connection.execute("SELECT * FROM supplier_applications WHERE id=?", (application_id,)).fetchone()
                if not application:
                    raise ApiError(404, "供应商申请不存在")
                if decision == "certified" and (
                    not application["license_storage_path"]
                    or not all(checks[key] for key in ("license_verified", "subject_verified", "agent_verified"))
                ):
                    raise ApiError(422, "认证通过前必须查验营业执照、企业主体和授权经办人", "supplier_checks_incomplete")
                connection.execute(
                    """UPDATE supplier_applications SET status=?,reviewer_user_id=?,review_reason=?,reviewed_at=?,
                       bank_account_verified=?,invoice_verified=?,resource_proof_verified=?,license_verified=?,
                       subject_verified=?,agent_verified=?,next_review_at=?,review_due_at=?,updated_at=? WHERE id=?""",
                    (decision, session["user_id"], reason, reviewed, int(checks["bank_account_verified"]),
                      int(checks["invoice_verified"]), int(checks["resource_proof_verified"]), int(checks["license_verified"]),
                      int(checks["subject_verified"]), int(checks["agent_verified"]), next_review, next_review, reviewed, application_id),
                )
                user_role = "supplier" if decision in ("certified", "restricted") else "supplier_pending"
                enterprise_status = decision if decision != "needs_changes" else "unverified"
                connection.execute(
                    "UPDATE users SET role=?,enterprise_status=?,supplier_capability_level=?,updated_at=? WHERE id=?",
                    (user_role, enterprise_status, capability_level, reviewed, application["user_id"]),
                )
                audit(connection, session["user_id"], "supplier_application", application_id, f"supplier.{decision}", {
                    "reason": reason, "checks": checks, "next_review_at": next_review,
                    "supplier_capability_level": capability_level,
                })
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "application_id": application_id, "status": decision, "next_review_at": next_review})

    def admin_review_intake(self, intake_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        decision = clean_text(data.get("decision"), "验真决定", 3, 20)
        if decision not in ("verified", "rejected", "frozen"):
            raise ApiError(422, "资源验真决定无效")
        summary = clean_text(data.get("verification_summary") or data.get("reason"), "验真结论", 8, 1000)
        updated = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                intake = connection.execute("SELECT * FROM resource_intakes WHERE id=?", (intake_id,)).fetchone()
                if not intake:
                    raise ApiError(404, "资源存入单不存在")
                supplier = connection.execute("SELECT * FROM users WHERE id=?", (intake["supplier_user_id"],)).fetchone()
                if decision == "verified" and (not supplier or supplier["enterprise_status"] != "certified"):
                    raise ApiError(409, "供应商尚未认证，不能确认资源验真", "supplier_not_certified")
                connection.execute(
                    "UPDATE resource_intakes SET status=?,verification_summary=?,reviewer_user_id=?,verified_at=?,frozen_reason=?,updated_at=? WHERE id=?",
                    (decision, summary, session["user_id"], updated if decision == "verified" else None,
                     summary if decision == "frozen" else None, updated, intake_id),
                )
                audit(connection, session["user_id"], "resource_intake", intake_id, f"resource.{decision}", {
                    "verification_summary": summary,
                })
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "intake_id": intake_id, "status": decision})

    def create_supplier_listing(self) -> None:
        session = self.session(csrf=True)
        require_role(session, "supplier")
        if session["enterprise_status"] != "certified":
            raise ApiError(403, "仅已认证企业供应商可以提交上架", "supplier_not_certified")
        data = self.read_json()
        intake_id = clean_text(data.get("intake_id"), "验真容量批次", 4, 80)
        kind = clean_text(data.get("kind") or "gpu", "资源类型", 3, 20)
        if kind not in RESOURCE_UNITS:
            raise ApiError(422, "资源类型无效", "invalid_resource_kind")
        product_code = clean_text(data.get("product_code"), "标准产品规格", 2, 120)
        asset_code = clean_text(data.get("asset_code") or data.get("gpu") or product_code, "产品代码", 2, 120)
        provider = clean_text(data.get("provider") or session["name"], "供应商公开名称", 2, 120)
        region = clean_text(data.get("region"), "服务地区", 2, 80)
        sla = clean_text(data.get("sla") or "99.5% 标准保障", "SLA", 3, 80)
        trade_mode = clean_text(data.get("trade_mode") or "fixed", "交易方式", 3, 20)
        if trade_mode not in ("fixed", "rfq", "reserved"):
            raise ApiError(422, "交易方式无效", "invalid_trade_mode")
        try:
            quantity = round(float(data.get("quantity")), 6)
            minimum_quantity = round(float(data.get("minimum_quantity") or 1), 6)
            target_price_cents = int(round(float(data.get("target_price_cny")) * 100))
            floor_value = data.get("floor_price_cny")
            floor_price_cents = int(round(float(floor_value) * 100)) if floor_value not in (None, "") else None
        except (TypeError, ValueError):
            raise ApiError(422, "容量或报价格式无效")
        if quantity <= 0 or minimum_quantity <= 0 or minimum_quantity > quantity or target_price_cents <= 0:
            raise ApiError(422, "容量、最低购买量或报价不符合规则")
        if floor_price_cents is not None and (floor_price_cents <= 0 or floor_price_cents > target_price_cents):
            raise ApiError(422, "供应商底价必须大于零且不能高于目标价")
        valid_from = normalize_iso_time(data.get("valid_from"), "可售开始时间")
        valid_until = normalize_iso_time(data.get("valid_until"), "可售结束时间")
        if valid_until <= valid_from or valid_until <= now_iso():
            raise ApiError(422, "可售结束时间必须晚于开始时间且尚未过期")
        listing_id = uid("lst")
        created = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                intake = connection.execute(
                    "SELECT * FROM resource_intakes WHERE id=? AND supplier_user_id=? AND status='verified'",
                    (intake_id, session["user_id"]),
                ).fetchone()
                if not intake or intake["kind"] != kind:
                    raise ApiError(409, "所选容量批次未验真或不属于当前供应商", "verified_intake_required")
                unit = str(intake["unit"]).strip()
                if unit not in RESOURCE_UNITS[kind]:
                    raise ApiError(409, f"{RESOURCE_KIND_LABELS[kind]}批次单位不符合标准产品口径", "invalid_intake_unit")
                allocated = connection.execute(
                    "SELECT COALESCE(SUM(verified_quantity),0) FROM listings WHERE intake_id=? AND status IN ('pending_review','active','suspended')",
                    (intake_id,),
                ).fetchone()[0]
                if float(intake["quantity"]) - float(allocated) + 1e-9 < quantity:
                    raise ApiError(409, "验真容量批次剩余数量不足", "intake_capacity_insufficient")
                connection.execute(
                    """INSERT INTO listings(id,supplier_user_id,kind,product_code,gpu,provider,region,unit,
                       unit_price_cents,verified_quantity,status,valid_from,valid_until,created_at,updated_at,
                       intake_id,floor_price_cents,trade_mode,sla,minimum_quantity,price_source_json)
                       VALUES(?,?,?,?,?,?,?,?,?,?,'pending_review',?,?,?,?,?,?,?,?,?,?)""",
                    (listing_id, session["user_id"], kind, product_code, asset_code, provider, region, unit,
                     target_price_cents, quantity, valid_from, valid_until, created, created, intake_id,
                     floor_price_cents, trade_mode, sla, minimum_quantity,
                     json.dumps(data.get("price_source") if isinstance(data.get("price_source"), dict) else {}, ensure_ascii=False)),
                )
                audit(connection, session["user_id"], "listing", listing_id, "listing.submitted", {
                    "intake_id": intake_id, "kind": kind, "quantity": quantity, "unit": unit, "target_price_cents": target_price_cents,
                })
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(201, {"ok": True, "listing": {"id": listing_id, "status": "pending_review"}})

    def admin_review_listing(self, listing_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        decision = clean_text(data.get("decision"), "挂牌审核决定", 3, 20)
        if decision not in ("approve", "reject", "suspend"):
            raise ApiError(422, "挂牌审核决定无效")
        reason = clean_text(data.get("reason") or "符合标准产品和价格披露规则", "审核理由", 4, 500)
        status = {"approve": "active", "reject": "rejected", "suspend": "suspended"}[decision]
        updated = now_iso()
        with db_connect() as connection:
            listing = connection.execute("SELECT * FROM listings WHERE id=?", (listing_id,)).fetchone()
            if not listing:
                raise ApiError(404, "挂牌不存在")
            if decision == "approve" and (listing["valid_until"] <= updated or not listing["intake_id"]):
                raise ApiError(409, "挂牌已过期或未绑定验真容量批次", "listing_not_approvable")
            connection.execute(
                "UPDATE listings SET status=?,reviewer_user_id=?,reviewed_at=?,updated_at=?,version=version+1 WHERE id=?",
                (status, session["user_id"], updated, updated, listing_id),
            )
            audit(connection, session["user_id"], "listing", listing_id, f"listing.{status}", {"reason": reason})
        self.json_response(200, {"ok": True, "listing_id": listing_id, "status": status})

    def create_supplier_application(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        enterprise = clean_text(data.get("enterprise_name"), "企业名称", 2, 120)
        code = clean_text(data.get("credit_code"), "统一社会信用代码", 18, 18).upper()
        if not re.fullmatch(r"[0-9A-HJ-NPQRTUWXY]{18}", code):
            raise ApiError(422, "统一社会信用代码应为 18 位数字或大写字母", "invalid_credit_code")
        agent = clean_text(data.get("agent_name"), "授权经办人", 2, 60)
        legal_representative = clean_text(data.get("legal_representative") or agent, "法定代表人", 2, 60)
        contact_phone = clean_text(data.get("contact_phone") or session["account"], "联系电话", 5, 60)
        declaration = bool(data.get("declaration_accepted"))
        if not declaration:
            raise ApiError(422, "请确认营业执照真实有效并同意平台核验", "supplier_declaration_required")
        license_evidence = decode_private_evidence(
            data.get("license_content_base64"), data.get("license_file_name"), "三证合一营业执照",
        )
        created = now_iso()
        application_id = uid("sup")
        stored_path = store_private_evidence(license_evidence, "supplier-licenses")
        previous_path = None
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute("SELECT * FROM supplier_applications WHERE user_id=? ORDER BY created_at DESC LIMIT 1", (session["user_id"],)).fetchone()
                if existing and existing["status"] == "certified":
                    connection.execute("COMMIT")
                    Path(stored_path).unlink(missing_ok=True)
                    return self.json_response(200, {"ok": True, "application": supplier_application_dict(existing)})
                if existing and existing["status"] == "reviewing":
                    application_id = existing["id"]
                    previous_path = existing["license_storage_path"]
                    connection.execute(
                        """UPDATE supplier_applications SET enterprise_name=?,credit_code=?,legal_representative=?,
                           agent_name=?,contact_phone=?,license_file_name=?,license_mime=?,license_size=?,license_sha256=?,
                           license_storage_path=?,license_verified=0,subject_verified=0,agent_verified=0,
                           review_reason=NULL,updated_at=? WHERE id=?""",
                        (enterprise, code, legal_representative, agent, contact_phone, license_evidence["file_name"],
                         license_evidence["mime"], license_evidence["size"], license_evidence["sha256"],
                         stored_path, created, application_id),
                    )
                else:
                    connection.execute(
                        """INSERT INTO supplier_applications(
                           id,user_id,enterprise_name,credit_code,legal_representative,agent_name,contact_phone,status,
                           license_file_name,license_mime,license_size,license_sha256,license_storage_path,created_at,updated_at
                           ) VALUES(?,?,?,?,?,?,?,'reviewing',?,?,?,?,?,?,?)""",
                        (application_id, session["user_id"], enterprise, code, legal_representative, agent, contact_phone,
                         license_evidence["file_name"], license_evidence["mime"], license_evidence["size"],
                         license_evidence["sha256"], stored_path, created, created),
                    )
                connection.execute("UPDATE users SET role='supplier_pending',enterprise_status='reviewing',updated_at=? WHERE id=?", (created, session["user_id"]))
                audit(connection, session["user_id"], "supplier_application", application_id, "supplier.submitted", {
                    "enterprise_name": enterprise, "credit_code": code, "legal_representative": legal_representative,
                    "license_sha256": license_evidence["sha256"], "license_size": license_evidence["size"],
                })
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                Path(stored_path).unlink(missing_ok=True)
                raise
            application = connection.execute("SELECT * FROM supplier_applications WHERE id=?", (application_id,)).fetchone()
        if previous_path and previous_path != stored_path:
            try:
                old_candidate = Path(previous_path).resolve()
                if EVIDENCE_ROOT in old_candidate.parents:
                    old_candidate.unlink(missing_ok=True)
            except OSError:
                pass
        self.json_response(201, {"ok": True, "application": supplier_application_dict(application)})

    def create_resource_intake(self) -> None:
        session = self.session(csrf=True)
        if session["role"] != "supplier" or session["enterprise_status"] != "certified":
            raise ApiError(403, "仅已认证企业供应商可以提交资源存入", "supplier_not_certified")
        data = self.read_json()
        kind = clean_text(data.get("kind"), "资源类型", 2, 20)
        if kind not in ("gpu", "tokencap", "tokenusage", "rack"):
            raise ApiError(422, "资源类型无效")
        quantity = float(data.get("quantity") or 0)
        if quantity <= 0:
            raise ApiError(422, "资源数量必须大于 0")
        intake_id = uid("intake")
        created = now_iso()
        product = clean_text(data.get("product_code"), "产品规格", 1, 120)
        region = clean_text(data.get("region"), "资源地区", 1, 80)
        unit = clean_text(data.get("unit"), "计量单位", 1, 40)
        if unit not in RESOURCE_UNITS[kind]:
            expected = " / ".join(sorted(RESOURCE_UNITS[kind]))
            raise ApiError(422, f"{RESOURCE_KIND_LABELS[kind]}的标准单位应为：{expected}", "invalid_resource_unit")
        evidence = clean_text(data.get("evidence_summary"), "证据摘要", 4, 500)
        with db_connect() as connection:
            connection.execute(
                "INSERT INTO resource_intakes(id,supplier_user_id,kind,product_code,region,quantity,unit,status,evidence_summary,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'pending_verification',?,?,?)",
                (intake_id, session["user_id"], kind, product, region, quantity, unit, evidence, created, created),
            )
            audit(connection, session["user_id"], "resource_intake", intake_id, "resource.intake_submitted", {"kind": kind, "quantity": quantity, "unit": unit})
        self.json_response(201, {"ok": True, "intake": {"id": intake_id, "status": "pending_verification"}})

    def create_order(self) -> None:
        session = self.session(csrf=True)
        self.rate_limit(f"order:{session['user_id']}", 30, 60)
        data = self.read_json()
        order_only = data.get("order_only") is True
        if order_only and not APP_ORDER_ONLY_ENABLED:
            raise ApiError(
                503,
                "测试订单通道尚未开放",
                "app_order_only_disabled",
            )
        listing_id = clean_text(data.get("listing_id"), "挂牌", 3, 80)
        try:
            quantity = round(float(data.get("quantity")), 6)
        except (TypeError, ValueError):
            raise ApiError(422, "购买数量无效")
        if quantity <= 0 or quantity > 1_000_000:
            raise ApiError(422, "购买数量超出允许范围")
        idem = require_idempotency_key(self.headers)
        created = now_iso()
        reservation_expires_at = future_minutes_iso(ORDER_RESERVATION_MINUTES)
        order_id = uid("ord")
        order_no = f"KAI{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}{secrets.randbelow(9000)+1000}"
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute("SELECT * FROM orders WHERE buyer_user_id=? AND idempotency_key=?", (session["user_id"], idem)).fetchone()
                if existing:
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "order": order_dict(existing), "idempotent_replay": True})
                listing = connection.execute("SELECT * FROM listings WHERE id=? AND status='active'", (listing_id,)).fetchone()
                if not listing or listing["valid_from"] > created or listing["valid_until"] <= created:
                    raise ApiError(409, "挂牌不可用或已过期", "listing_unavailable")
                raw_snapshot = data.get("quote_snapshot") if isinstance(data.get("quote_snapshot"), dict) else {}
                preflight = approved_environment_preflight(
                    connection, raw_snapshot.get("environment_preflight_id"), session["user_id"], listing,
                )
                snapshot = normalized_order_snapshot(raw_snapshot, listing, quantity)
                snapshot["payment_policy"] = (
                    "deferred_no_checkout" if order_only else "checkout_allowed"
                )
                if preflight:
                    snapshot["environment_preflight"] = {
                        "id": preflight["id"], "task": preflight["task"], "gpu": preflight["gpu"],
                        "delivery_mode": preflight["delivery_mode"], "template": preflight["template"],
                        "workspace_gb": preflight["workspace_gb"], "access_mode": preflight["access_mode"],
                        "network_mode": preflight["network_mode"],
                        "supplier_capability_required": preflight["supplier_capability_required"],
                        "approved_supplier_capability_level": preflight["approved_supplier_capability_level"],
                    }
                available = listing["verified_quantity"] - listing["quote_reserved"] - listing["order_locked"] - listing["delivering"] - listing["consumed"] - listing["frozen"]
                if available + 1e-9 < quantity:
                    raise ApiError(409, f"可售容量不足，当前可售 {max(0, available):g} {listing['unit']}", "insufficient_capacity")
                amount = int(round(listing["unit_price_cents"] * quantity))
                connection.execute(
                    "UPDATE listings SET quote_reserved=quote_reserved+?,version=version+1,updated_at=? WHERE id=? AND version=?",
                    (quantity, created, listing_id, listing["version"]),
                )
                if connection.execute("SELECT changes()").fetchone()[0] != 1:
                    raise ApiError(409, "容量版本冲突，请重试", "capacity_version_conflict")
                connection.execute(
                    """INSERT INTO orders(id,order_no,buyer_user_id,listing_id,gpu,region,provider,quantity,unit,unit_price_cents,amount_cents,currency,status,idempotency_key,quote_snapshot_json,reservation_expires_at,created_at,updated_at,kind,product_code,environment_preflight_id)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,'CNY','pending_payment',?,?,?,?,?,?,?,?)""",
                    (order_id, order_no, session["user_id"], listing_id, listing["gpu"], listing["region"], listing["provider"], quantity, listing["unit"], listing["unit_price_cents"], amount, idem, json.dumps(snapshot, ensure_ascii=False), reservation_expires_at, created, created, listing["kind"], listing["product_code"], preflight["id"] if preflight else None),
                )
                if preflight:
                    connection.execute(
                        "UPDATE environment_preflights SET order_id=?,updated_at=? WHERE id=? AND order_id IS NULL",
                        (order_id, created, preflight["id"]),
                    )
                    if connection.execute("SELECT changes()").fetchone()[0] != 1:
                        raise ApiError(409, "环境预检单绑定冲突，请重新提交预检", "environment_preflight_binding_conflict")
                audit(connection, session["user_id"], "order", order_id, "capacity.reserved", {"listing_id": listing_id, "quantity": quantity, "unit": listing["unit"], "listing_version": listing["version"] + 1, "expires_at": reservation_expires_at, "environment_preflight_id": preflight["id"] if preflight else None, "payment_policy": snapshot["payment_policy"]}, idem)
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            order = fetch_order(connection, order_id)
        self.json_response(201, {
            "ok": True,
            "order": order_dict(order),
            "checkout_deferred": order_only,
        })

    def qixiang_payment_callback(self, query: dict[str, list[str]]) -> None:
        self.rate_limit(f"qixiang-callback:{self.client_address[0]}", 180, 60)
        params = qixiang_callback_values(query)
        validate_qixiang_callback(params)
        _, confirmed = query_and_confirm_qixiang_payment(params["out_trade_no"], params)
        if not confirmed:
            raise ApiError(409, "七相支付主动查单尚未确认成功", "qixiangpay_query_pending")
        self.plain_response(200, "success")

    def qixiang_payment_return(
        self,
        query: dict[str, list[str]],
        *,
        app_surface: bool = False,
    ) -> None:
        order_no = ""
        payment_status = "unverified"
        try:
            params = qixiang_callback_values(query)
            validate_qixiang_callback(params)
            order, confirmed = query_and_confirm_qixiang_payment(params["out_trade_no"], params)
            order_no = order["order_no"]
            payment_status = (
                "paid" if confirmed and order["status"] in ("paid", "accepted") else order["status"]
            )
        except ApiError as error:
            print(f"QixiangPay return verification error: {error.code}")
        target_params = {"payment_status": payment_status}
        if order_no:
            target_params["payment_return"] = order_no
        target = (
            "cloudpay://payment/return?" + urlencode(target_params)
            if app_surface
            else "/?" + urlencode(target_params)
        )
        self.redirect_response(target)

    def get_payment_status(self, query: dict[str, list[str]]) -> None:
        session = self.session()
        order_no = clean_text(query.get("order_no", [""])[0], "订单号", 4, 80)
        self.rate_limit(f"payment-status:{session['user_id']}", 30, 60)
        with db_connect() as connection:
            order = connection.execute(
                "SELECT * FROM orders WHERE order_no=? AND buyer_user_id=?",
                (order_no, session["user_id"]),
            ).fetchone()
            if not order:
                raise ApiError(404, "订单不存在", "order_not_found")
            payment = connection.execute(
                "SELECT * FROM payments WHERE order_id=? ORDER BY created_at DESC LIMIT 1",
                (order["id"],),
            ).fetchone()
        confirmed = order["status"] in ("paid", "accepted")
        if (
            payment
            and PAYMENT_GATEWAY == "qixiang"
            and PAYMENT_RECONCILIATION_ENABLED
            and payment["status"] in ("pending", "closed")
        ):
            order, confirmed = query_and_confirm_qixiang_payment(payment["id"])
            with db_connect() as connection:
                payment = connection.execute(
                    "SELECT * FROM payments WHERE id=?", (payment["id"],)
                ).fetchone()
        self.json_response(200, {
            "ok": True,
            "order_no": order["order_no"],
            "order_status": order["status"],
            "payment_status": payment["status"] if payment else "not_created",
            "confirmed": bool(confirmed),
        })

    def create_payment(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        idem = require_idempotency_key(self.headers)
        order_id = clean_text(data.get("order_id"), "订单", 4, 80)
        provider = clean_text(data.get("provider"), "支付方式", 2, 20)
        if provider not in ("alipay", "wechat"):
            raise ApiError(422, "仅支持支付宝或微信支付")
        client_surface = clean_text(
            data.get("client_surface") or "web", "支付客户端", 3, 10
        )
        if client_surface not in ("web", "app"):
            raise ApiError(422, "支付客户端类型无效", "invalid_payment_client_surface")
        default_channel = "web" if provider == "alipay" else "native"
        channel = clean_text(data.get("channel") or default_channel, "支付场景", 2, 20)
        allowed_channels = {"alipay": {"web", "wap"}, "wechat": {"native", "h5"}}
        if channel not in allowed_channels[provider]:
            raise ApiError(422, "所选支付场景与支付方式不匹配", "invalid_payment_channel")
        require_payment_creation_ready(provider)
        request_hash = hashlib.sha256(
            json.dumps(
                {
                    "order_id": order_id,
                    "provider": provider,
                    "channel": channel,
                    "client_surface": client_surface,
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                order = fetch_order(connection, order_id)
                if order["buyer_user_id"] != session["user_id"]:
                    raise ApiError(403, "无权操作该订单")
                try:
                    payment_policy = json.loads(
                        order["quote_snapshot_json"] or "{}"
                    ).get("payment_policy")
                except (TypeError, json.JSONDecodeError):
                    raise ApiError(
                        409,
                        "订单支付策略无效，请联系平台处理",
                        "payment_policy_invalid",
                    )
                if payment_policy == "deferred_no_checkout":
                    raise ApiError(
                        409,
                        "该测试订单不允许创建真实支付，请重新确认正式购买",
                        "payment_deferred_test_order",
                    )
                replay = connection.execute(
                    "SELECT * FROM payments WHERE idempotency_key=?", (idem,)
                ).fetchone()
                if replay:
                    replay_order = fetch_order(connection, replay["order_id"])
                    if (
                        replay_order["buyer_user_id"] != session["user_id"]
                        or replay["request_hash"] != request_hash
                    ):
                        raise ApiError(409, "幂等键已用于不同支付请求", "idempotency_conflict")
                    existing = replay
                else:
                    if order["status"] != "pending_payment":
                        raise ApiError(409, "订单当前状态不能创建支付单", "invalid_order_state")
                    existing = connection.execute(
                        """SELECT * FROM payments WHERE order_id=? AND provider=?
                           AND status IN ('pending','closed','success') ORDER BY created_at DESC LIMIT 1""",
                        (order_id, provider),
                    ).fetchone()
                    if existing:
                        if existing["idempotency_key"] and existing["request_hash"] != request_hash:
                            raise ApiError(409, "该订单已有不同的支付请求", "payment_intent_conflict")
                        connection.execute(
                            """UPDATE payments SET idempotency_key=COALESCE(idempotency_key,?),
                               request_hash=COALESCE(request_hash,?),updated_at=? WHERE id=?""",
                            (idem, request_hash, now_iso(), existing["id"]),
                        )
                        existing = connection.execute(
                            "SELECT * FROM payments WHERE id=?", (existing["id"],)
                        ).fetchone()
                    else:
                        payment_id = uid("pay")
                        created = now_iso()
                        connection.execute(
                            """INSERT INTO payments(
                               id,order_id,provider,amount_cents,currency,status,gateway,channel,
                               idempotency_key,request_hash,checkout_state,created_at,updated_at
                               ) VALUES(?,?,?,?, 'CNY','pending',?,?,?,?, 'creating',?,?)""",
                            (
                                payment_id, order_id, provider, order["amount_cents"],
                                PAYMENT_GATEWAY, channel, idem, request_hash, created, created,
                            ),
                        )
                        connection.execute(
                            "UPDATE card_hour_topups SET payment_id=?,updated_at=? WHERE order_id=?",
                            (payment_id, created, order_id),
                        )
                        audit(connection, session["user_id"], "payment", payment_id, "payment.created", {
                            "order_id": order_id, "provider": provider,
                            "amount_cents": order["amount_cents"], "idempotency_key": idem,
                            "client_surface": client_surface,
                        })
                        existing = connection.execute(
                            "SELECT * FROM payments WHERE id=?", (payment_id,)
                        ).fetchone()
                payment_id = existing["id"]
                checkout_url = existing["checkout_url"]
                checkout_state = existing["checkout_state"]
                connection.execute("COMMIT")
            except Exception:
                if connection.in_transaction:
                    connection.execute("ROLLBACK")
                raise
        if not ALLOW_DEMO and not checkout_url:
            if checkout_state not in ("creating",):
                raise ApiError(
                    503,
                    "支付下单结果正在自动核验，请稍后查看订单状态",
                    "payment_checkout_uncertain",
                )
            checkout_lease = acquire_qixiang_checkout_lease(payment_id)
            try:
                if not checkout_lease:
                    with db_connect() as connection:
                        current = connection.execute(
                            "SELECT checkout_url FROM payments WHERE id=?", (payment_id,)
                        ).fetchone()
                    checkout_url = current["checkout_url"] if current else None
                else:
                    try:
                        checkout_result = request_provider_checkout(
                            provider,
                            payment_id,
                            order,
                            channel,
                            self.client_address[0],
                            client_surface,
                        )
                    except Exception:
                        with db_connect() as connection:
                            connection.execute(
                                """UPDATE payments SET checkout_state='uncertain',updated_at=?
                                   WHERE id=? AND checkout_state='submitting' AND checkout_url IS NULL""",
                                (now_iso(), payment_id),
                            )
                        raise
                    checkout_url = checkout_result["checkout_url"]
                    with db_connect() as connection:
                        connection.execute(
                            """UPDATE payments SET gateway=?,channel=?,checkout_url=?,
                               provider_txn_id=COALESCE(provider_txn_id,?),provider_status=?,
                               checkout_state='ready',updated_at=?
                               WHERE id=? AND status='pending' AND checkout_state='submitting'""",
                            (
                                PAYMENT_GATEWAY, channel, checkout_url,
                                checkout_result.get("trade_no") or None,
                                checkout_result.get("raw_code"), now_iso(), payment_id,
                            ),
                        )
                        if connection.execute("SELECT changes()").fetchone()[0] != 1:
                            raise ApiError(
                                409,
                                "支付收银台写入状态冲突，请稍后查看订单状态",
                                "payment_checkout_state_conflict",
                            )
            finally:
                finish_qixiang_checkout_lease(payment_id, checkout_lease)
        with db_connect() as connection:
            current_payment = connection.execute(
                "SELECT * FROM payments WHERE id=?", (payment_id,)
            ).fetchone()
        checkout_url = current_payment["checkout_url"] if current_payment else checkout_url
        self.json_response(201, {
            "ok": True,
            "payment": {
                "id": payment_id, "provider": provider, "channel": channel, "status": "pending",
                "gateway": PAYMENT_GATEWAY, "amount_cny": order["amount_cents"] / 100,
                "checkout_url": checkout_url, "client_surface": client_surface,
            },
            "idempotent_replay": bool(existing["checkout_url"]),
            "mock_allowed": ALLOW_DEMO,
        })

    def mock_complete_payment(self) -> None:
        session = self.session(csrf=True)
        if not ALLOW_DEMO:
            raise ApiError(404, "联调支付未启用", "demo_disabled")
        data = self.read_json()
        payment_id = clean_text(data.get("payment_id"), "支付单", 4, 80)
        with db_connect() as connection:
            payment = connection.execute("SELECT * FROM payments WHERE id=?", (payment_id,)).fetchone()
            if not payment:
                raise ApiError(404, "支付单不存在")
            order = fetch_order(connection, payment["order_id"])
            if order["buyer_user_id"] != session["user_id"]:
                raise ApiError(403, "无权操作该支付单")
            payload = {
                "event_id": uid("payevt"), "payment_id": payment["id"], "order_id": order["id"],
                "provider_txn_id": uid(f"{payment['provider']}_txn"), "merchant_id": "KAI-MOCK",
                "amount_cents": order["amount_cents"], "currency": "CNY", "status": "SUCCESS",
                "timestamp": int(time.time()),
            }
            signature = sign_payment(payload, MOCK_SECRET)
            updated = apply_payment_callback(connection, payment["provider"], payload, signature, MOCK_SECRET)
        self.json_response(200, {"ok": True, "order": order_dict(updated), "callback_verified": True})

    def real_payment_callback(self, provider: str) -> None:
        data = self.read_json()
        secret = payment_secret(provider)
        if not secret:
            raise ApiError(503, "支付机构回调密钥尚未配置", "payment_provider_not_configured")
        signature = self.headers.get("X-KAI-Payment-Signature", "")
        with db_connect() as connection:
            order = apply_payment_callback(connection, provider, data, signature, secret)
        self.json_response(200, {"ok": True, "order_id": order["id"], "status": order["status"]})

    def real_refund_callback(self, provider: str) -> None:
        data = self.read_json()
        secret = payment_secret(provider)
        if not secret:
            raise ApiError(503, "支付机构回调密钥尚未配置", "payment_provider_not_configured")
        signature = self.headers.get("X-KAI-Payment-Signature", "")
        if not hmac.compare_digest(sign_refund(data, secret), signature):
            raise ApiError(401, "退款通知签名无效", "invalid_refund_signature")
        try:
            callback_time = int(data["timestamp"])
            amount_cents = int(data["amount_cents"])
        except (KeyError, ValueError, TypeError):
            raise ApiError(422, "退款通知字段无效", "invalid_refund_callback")
        if abs(int(time.time()) - callback_time) > 300:
            raise ApiError(409, "退款通知超出防重放时间窗", "refund_replay_window")
        if data.get("status") != "SUCCESS" or data.get("currency") != "CNY":
            raise ApiError(422, "退款状态或币种不符合入账条件", "refund_not_successful")
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                refund = connection.execute("SELECT * FROM refunds WHERE id=?", (data.get("refund_id"),)).fetchone()
                if not refund:
                    raise ApiError(404, "退款单不存在")
                order = fetch_order(connection, refund["order_id"])
                payment = connection.execute("SELECT * FROM payments WHERE id=?", (refund["payment_id"],)).fetchone()
                if payment["provider"] != provider or data.get("order_id") != order["id"]:
                    raise ApiError(409, "退款通知与原订单不匹配", "refund_order_mismatch")
                if amount_cents != refund["amount_cents"]:
                    raise ApiError(409, "退款金额不匹配", "refund_amount_mismatch")
                apply_refund_success(connection, refund, clean_text(data.get("provider_ref"), "支付机构退款流水", 3, 160))
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "refund_id": refund["id"], "status": "success"})

    def supplier_confirm_order(self, order_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "supplier")
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                order = fetch_order(connection, order_id)
                supplier = supplier_for_order(connection, order)
                if supplier["id"] != session["user_id"]:
                    raise ApiError(403, "无权确认该订单")
                if order["status"] == "supplier_confirmed":
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "order": order_dict(order), "idempotent_replay": True})
                if order["status"] != "paid":
                    raise ApiError(409, "仅已支付订单可以确认交付", "invalid_order_state")
                updated = now_iso()
                connection.execute(
                    "UPDATE orders SET status='supplier_confirmed',supplier_confirmed_at=?,updated_at=? WHERE id=?",
                    (updated, updated, order_id),
                )
                connection.execute(
                    "INSERT OR IGNORE INTO delivery_tasks(id,order_id,supplier_user_id,environment_preflight_id,status,created_at,updated_at) VALUES(?,?,?,?,'confirmed',?,?)",
                    (uid("delivery"), order_id, session["user_id"], order["environment_preflight_id"], updated, updated),
                )
                audit(connection, session["user_id"], "order", order_id, "delivery.supplier_confirmed", {})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            order = fetch_order(connection, order_id)
        self.json_response(200, {"ok": True, "order": order_dict(order)})

    def supplier_deliver_order(self, order_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "supplier")
        data = self.read_json()
        endpoint_summary = clean_text(data.get("endpoint_summary"), "交付端点摘要", 4, 300)
        evidence_digest = clean_text(data.get("evidence_digest"), "交付证据摘要", 16, 160)
        acceptance_hours = max(1, min(168, int(data.get("acceptance_hours") or 48)))
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                order = fetch_order(connection, order_id)
                supplier = supplier_for_order(connection, order)
                if supplier["id"] != session["user_id"]:
                    raise ApiError(403, "无权交付该订单")
                if order["status"] == "delivered":
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "order": order_dict(order), "idempotent_replay": True})
                if order["status"] not in ("paid", "supplier_confirmed"):
                    raise ApiError(409, "订单当前状态不能交付", "invalid_order_state")
                listing = connection.execute("SELECT * FROM listings WHERE id=?", (order["listing_id"],)).fetchone()
                if not listing or listing["order_locked"] + 1e-9 < order["quantity"]:
                    raise ApiError(409, "订单锁定容量异常", "locked_capacity_mismatch")
                updated = now_iso()
                acceptance_due = (datetime.now(timezone.utc) + timedelta(hours=acceptance_hours)).replace(microsecond=0).isoformat()
                delivery_ref = uid("delivery_ref")
                connection.execute(
                    "UPDATE listings SET order_locked=order_locked-?,delivering=delivering+?,version=version+1,updated_at=? WHERE id=?",
                    (order["quantity"], order["quantity"], updated, listing["id"]),
                )
                connection.execute(
                    "UPDATE orders SET status='delivered',delivery_ref=?,delivered_at=?,acceptance_due_at=?,updated_at=? WHERE id=?",
                    (delivery_ref, updated, acceptance_due, updated, order_id),
                )
                connection.execute(
                    """INSERT INTO delivery_tasks(id,order_id,supplier_user_id,environment_preflight_id,status,credential_reference,endpoint_summary,evidence_digest,
                       started_at,delivered_at,acceptance_due_at,created_at,updated_at)
                       VALUES(?,?,?,?,'delivered',?,?,?,?,?,?,?,?)
                       ON CONFLICT(order_id) DO UPDATE SET status='delivered',credential_reference=excluded.credential_reference,
                       environment_preflight_id=excluded.environment_preflight_id,
                       endpoint_summary=excluded.endpoint_summary,evidence_digest=excluded.evidence_digest,delivered_at=excluded.delivered_at,
                       acceptance_due_at=excluded.acceptance_due_at,updated_at=excluded.updated_at""",
                    (uid("delivery"), order_id, session["user_id"], order["environment_preflight_id"], delivery_ref, endpoint_summary, evidence_digest,
                     order["supplier_confirmed_at"] or updated, updated, acceptance_due, updated, updated),
                )
                audit(connection, session["user_id"], "order", order_id, "delivery.credentials_issued", {
                    "delivery_ref": delivery_ref, "credential_mode": "one_time_reference",
                    "endpoint_summary": endpoint_summary, "evidence_digest": evidence_digest,
                    "acceptance_due_at": acceptance_due,
                })
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            order = fetch_order(connection, order_id)
        self.json_response(200, {"ok": True, "order": order_dict(order), "credential_reference": order["delivery_ref"]})

    def create_metering_record(self) -> None:
        session = self.session(csrf=True)
        require_role(session, "supplier", "admin")
        data = self.read_json()
        order_id = clean_text(data.get("order_id"), "订单", 4, 80)
        requested_source = clean_text(data.get("source"), "计量来源", 3, 30)
        source = "kai_gateway" if session["role"] == "admin" else "supplier"
        if requested_source != source:
            raise ApiError(403, "当前账户不能代表该计量来源上报", "metering_source_forbidden")
        started_at = normalize_iso_time(data.get("started_at"), "计量开始时间")
        ended_at = normalize_iso_time(data.get("ended_at"), "计量结束时间")
        if ended_at <= started_at:
            raise ApiError(422, "计量结束时间必须晚于开始时间")
        try:
            quantity = round(float(data.get("quantity")), 6)
        except (TypeError, ValueError):
            raise ApiError(422, "计量数量无效")
        if quantity <= 0:
            raise ApiError(422, "计量数量必须大于零")
        evidence_digest = clean_text(data.get("evidence_digest"), "原始证据摘要", 16, 160)
        signature = clean_text(data.get("signature"), "计量签名", 16, 500)
        performance = data.get("performance") if isinstance(data.get("performance"), dict) else {}
        record_id = uid("meter")
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                order = fetch_order(connection, order_id)
                if order["status"] not in ("delivered", "disputed"):
                    raise ApiError(409, "订单尚未进入可计量交付状态", "invalid_order_state")
                supplier = supplier_for_order(connection, order)
                if source == "supplier" and supplier["id"] != session["user_id"]:
                    raise ApiError(403, "无权上报该订单的供应商计量")
                listing = connection.execute("SELECT kind FROM listings WHERE id=?", (order["listing_id"],)).fetchone()
                resource_kind = listing["kind"] if listing else (order["kind"] if "kind" in order.keys() else "gpu")
                connection.execute(
                    """INSERT INTO metering_records(id,order_id,source,resource_kind,started_at,ended_at,quantity,
                       performance_json,evidence_digest,signature,status,created_by,created_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?,'received',?,?)""",
                    (record_id, order_id, source, resource_kind, started_at, ended_at, quantity,
                     json.dumps(performance, ensure_ascii=False), evidence_digest, signature, session["user_id"], now_iso()),
                )
                reconciliation = metering_reconciliation(connection, order_id)
                audit(connection, session["user_id"], "order", order_id, "metering.recorded", {
                    "record_id": record_id, "source": source, "quantity": quantity,
                    "reconciliation": reconciliation,
                })
                if reconciliation["status"] == "manual_review":
                    audit(connection, None, "order", order_id, "metering.manual_review_required", reconciliation)
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(201, {"ok": True, "record_id": record_id, "reconciliation": reconciliation})

    def demo_deliver(self, order_id: str) -> None:
        session = self.session(csrf=True)
        if not ALLOW_DEMO:
            raise ApiError(404, "联调交付未启用")
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                order = fetch_order(connection, order_id)
                if order["buyer_user_id"] != session["user_id"]:
                    raise ApiError(403, "无权操作该订单")
                if order["status"] == "delivered":
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "order": order_dict(order), "idempotent_replay": True})
                if order["status"] != "paid":
                    raise ApiError(409, "仅已支付订单可以进入交付", "invalid_order_state")
                listing = connection.execute("SELECT * FROM listings WHERE id=?", (order["listing_id"],)).fetchone()
                if listing["order_locked"] + 1e-9 < order["quantity"]:
                    raise ApiError(409, "订单锁定容量异常")
                delivery_ref = uid("delivery")
                updated = now_iso()
                acceptance_due = future_iso(48)
                connection.execute("UPDATE listings SET order_locked=order_locked-?,delivering=delivering+?,version=version+1,updated_at=? WHERE id=?", (order["quantity"], order["quantity"], updated, listing["id"]))
                connection.execute("UPDATE orders SET status='delivered',delivery_ref=?,delivered_at=?,acceptance_due_at=?,updated_at=? WHERE id=?", (delivery_ref, updated, acceptance_due, updated, order_id))
                connection.execute(
                    "INSERT OR REPLACE INTO delivery_tasks(id,order_id,supplier_user_id,environment_preflight_id,status,credential_reference,endpoint_summary,evidence_digest,started_at,delivered_at,acceptance_due_at,created_at,updated_at) VALUES(?,?,?,?,'delivered',?,?,?,?,?,?,?,?)",
                    (uid("delivery"), order_id, listing["supplier_user_id"], order["environment_preflight_id"], delivery_ref, "联调交付端点", hashlib.sha256(delivery_ref.encode()).hexdigest(), updated, updated, acceptance_due, updated, updated),
                )
                for source in ("supplier", "kai_gateway"):
                    evidence = hashlib.sha256(f"{order_id}|{source}|demo".encode()).hexdigest()
                    connection.execute(
                        "INSERT OR IGNORE INTO metering_records(id,order_id,source,resource_kind,started_at,ended_at,quantity,performance_json,evidence_digest,signature,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'received',?,?)",
                        (uid("meter"), order_id, source, listing["kind"], updated, future_iso(1), order["quantity"], '{"mode":"demo"}', evidence, evidence, session["user_id"], updated),
                    )
                metering_reconciliation(connection, order_id)
                audit(connection, "usr_demo_supplier", "order", order_id, "delivery.credentials_issued", {"delivery_ref": delivery_ref, "credential_mode": "one_time_reference"})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            order = fetch_order(connection, order_id)
        self.json_response(200, {"ok": True, "order": order_dict(order)})

    def accept_order(self, order_id: str) -> None:
        session = self.session(csrf=True)
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                order = fetch_order(connection, order_id)
                if order["buyer_user_id"] != session["user_id"]:
                    raise ApiError(403, "无权验收该订单")
                if order["status"] == "accepted":
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "order": order_dict(order), "idempotent_replay": True})
                if order["status"] == "paid" and is_platform_inventory_order(connection, order):
                    allocation_id = activate_platform_inventory_order(
                        connection, order, session["user_id"], "buyer_instant_activation"
                    )
                    connection.execute("COMMIT")
                    order = fetch_order(connection, order_id)
                    return self.json_response(200, {
                        "ok": True, "order": order_dict(order), "allocation_id": allocation_id,
                        "platform_inventory_activated": True,
                    })
                if order["status"] != "delivered":
                    raise ApiError(409, "订单尚未完成交付", "invalid_order_state")
                reconciliation = metering_reconciliation(connection, order_id)
                if not reconciliation["ready"]:
                    message = "供应商与 KAI 双源计量尚未齐备" if reconciliation["status"] == "awaiting_dual_source" else "双源计量差异超过阈值，已暂停自动验收"
                    raise ApiError(409, message, "metering_not_reconciled")
                listing = connection.execute("SELECT * FROM listings WHERE id=?", (order["listing_id"],)).fetchone()
                if listing["delivering"] + 1e-9 < order["quantity"]:
                    raise ApiError(409, "交付中容量异常")
                allocation_id = uid("asset")
                connection.execute("UPDATE listings SET delivering=delivering-?,consumed=consumed+?,version=version+1,updated_at=? WHERE id=?", (order["quantity"], order["quantity"], now_iso(), listing["id"]))
                accepted_at = now_iso()
                connection.execute("UPDATE orders SET status='accepted',accepted_at=?,updated_at=? WHERE id=?", (accepted_at, accepted_at, order_id))
                connection.execute(
                    "INSERT INTO allocations(id,owner_user_id,order_id,listing_id,gpu,region,quantity,unit,expires_at,status,created_at,kind,product_code,provider) VALUES(?,?,?,?,?,?,?,?,?,'available',?,?,?,?)",
                    (allocation_id, session["user_id"], order_id, listing["id"], order["gpu"], order["region"], order["quantity"], order["unit"], listing["valid_until"], now_iso(), listing["kind"], listing["product_code"], listing["provider"]),
                )
                audit(connection, session["user_id"], "order", order_id, "order.accepted", {"allocation_id": allocation_id, "quantity": order["quantity"], "unit": order["unit"]})
                supplier = supplier_for_order(connection, order)
                settlement_mode = order["settlement_mode"] if "settlement_mode" in order.keys() else "cash"
                if settlement_mode == "swap":
                    swap = connection.execute("SELECT * FROM swap_requests WHERE id=?", (order["swap_id"],)).fetchone()
                    source = connection.execute("SELECT * FROM allocations WHERE id=?", (swap["source_allocation_id"],)).fetchone() if swap else None
                    if not swap or swap["status"] != "confirmed" or not source or source["swap_reserved"] + 1e-9 < swap["source_quantity"]:
                        raise ApiError(409, "置换源资产锁定状态异常", "swap_source_reservation_invalid")
                    remaining = max(0, source["quantity"] - swap["source_quantity"])
                    connection.execute(
                        "UPDATE allocations SET quantity=?,swap_reserved=MAX(0,swap_reserved-?),status=? WHERE id=?",
                        (remaining, swap["source_quantity"], "transferred" if remaining <= 1e-9 else "available", source["id"]),
                    )
                    source_listing = connection.execute("SELECT * FROM listings WHERE id=?", (source["listing_id"],)).fetchone()
                    transfer_order_id = uid("ord")
                    transfer_order_no = f"KAI-SWAP-{secrets.token_hex(6).upper()}"
                    transfer_amount = int(round(swap["source_quantity"] * swap["source_reference_cents"]))
                    transfer_snapshot = json.dumps({"source": "bilateral_swap_transfer", "swap_id": swap["id"], "counter_order_id": order_id}, ensure_ascii=False)
                    connection.execute(
                        """INSERT INTO orders(id,order_no,buyer_user_id,listing_id,gpu,region,provider,quantity,unit,
                           unit_price_cents,amount_cents,currency,status,payment_provider,idempotency_key,quote_snapshot_json,
                           reservation_expires_at,accepted_at,created_at,updated_at,kind,product_code,settlement_mode,swap_id)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,'CNY','accepted','swap',?,?,?,?,?,?,?,?,'swap_transfer',?)""",
                        (transfer_order_id, transfer_order_no, supplier["id"], source["listing_id"], source["gpu"], source["region"],
                         source["provider"] or "置换转入", swap["source_quantity"], source["unit"], swap["source_reference_cents"], transfer_amount,
                         f"swap-transfer:{swap['id']}", transfer_snapshot, accepted_at, accepted_at, accepted_at, accepted_at,
                         source["kind"], source["product_code"] or source["gpu"], swap["id"]),
                    )
                    received_asset_id = uid("asset")
                    connection.execute(
                        """INSERT INTO allocations(id,owner_user_id,order_id,listing_id,gpu,region,quantity,unit,expires_at,status,
                           created_at,kind,product_code,provider) VALUES(?,?,?,?,?,?,?,?,?,'available',?,?,?,?)""",
                        (received_asset_id, supplier["id"], transfer_order_id, source["listing_id"], source["gpu"], source["region"],
                         swap["source_quantity"], source["unit"], source["expires_at"], accepted_at, source["kind"],
                         source["product_code"] or source["gpu"], source["provider"] or "置换转入"),
                    )
                    connection.execute("UPDATE swap_requests SET status='completed',updated_at=? WHERE id=?", (accepted_at, swap["id"]))
                    audit(connection, session["user_id"], "swap", swap["id"], "swap.completed", {
                        "target_order_id": order_id, "source_transfer_order_id": transfer_order_id,
                        "source_received_asset_id": received_asset_id, "cash_difference_cents": 0,
                    })
                if settlement_mode == "cash":
                    platform_fee = int(round(order["amount_cents"] * PLATFORM_FEE_BPS / 10000))
                    supplier_net = order["amount_cents"] - platform_fee
                    hold_until = (datetime.now(timezone.utc) + timedelta(hours=SETTLEMENT_HOLD_HOURS)).replace(microsecond=0).isoformat()
                    settlement_id = uid("settlement")
                    connection.execute(
                        """INSERT INTO settlements(id,order_id,supplier_user_id,gross_cents,platform_fee_cents,supplier_net_cents,
                           referral_commission_cents,currency,status,hold_until,created_at,updated_at)
                           VALUES(?,?,?,?,?,?,?,'CNY','holding',?,?,?)""",
                        (settlement_id, order_id, supplier["id"], order["amount_cents"], platform_fee,
                         supplier_net, 0, hold_until, accepted_at, accepted_at),
                    )
                    audit(connection, session["user_id"], "settlement", settlement_id, "settlement.eligible", {
                        "order_id": order_id, "reason": "buyer_accepted", "gross_cents": order["amount_cents"],
                        "platform_fee_cents": platform_fee, "supplier_net_cents": supplier_net,
                        "hold_until": hold_until,
                    })
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            order = fetch_order(connection, order_id)
        self.json_response(200, {"ok": True, "order": order_dict(order)})

    def cancel_order(self, order_id: str) -> None:
        session = self.session(csrf=True)
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                order = fetch_order(connection, order_id)
                if order["buyer_user_id"] != session["user_id"]:
                    raise ApiError(403, "无权取消该订单")
                if order["status"] == "cancelled":
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "order": order_dict(order), "idempotent_replay": True})
                if order["status"] != "pending_payment":
                    raise ApiError(409, "当前订单状态不能直接取消，请进入退款或争议流程")
                release_order_capacity(connection, order, "pending_payment")
                connection.execute("UPDATE orders SET status='cancelled',updated_at=? WHERE id=?", (now_iso(), order_id))
                audit(connection, session["user_id"], "order", order_id, "capacity.reservation_released", {"quantity": order["quantity"], "unit": order["unit"]})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            order = fetch_order(connection, order_id)
        self.json_response(200, {"ok": True, "order": order_dict(order)})

    def create_dispute(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        order_id = clean_text(data.get("order_id"), "订单", 4, 80)
        category = clean_text(data.get("category") or "delivery", "争议类型", 3, 40)
        reason = clean_text(data.get("reason"), "争议说明", 8, 1000)
        dispute_id = uid("dispute")
        created = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                order = fetch_order(connection, order_id)
                if order["buyer_user_id"] != session["user_id"]:
                    raise ApiError(403, "无权对该订单发起争议")
                if order["status"] not in ("paid", "supplier_confirmed", "delivered", "accepted"):
                    raise ApiError(409, "订单当前状态不能发起争议", "invalid_order_state")
                existing = connection.execute(
                    "SELECT * FROM disputes WHERE order_id=? AND status IN ('open','reviewing')",
                    (order_id,),
                ).fetchone()
                if existing:
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "dispute": dict(existing), "idempotent_replay": True})
                connection.execute(
                    "INSERT INTO disputes(id,order_id,opened_by,category,reason,original_order_status,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'open',?,?)",
                    (dispute_id, order_id, session["user_id"], category, reason, order["status"], created, created),
                )
                connection.execute("UPDATE orders SET status='disputed',updated_at=? WHERE id=?", (created, order_id))
                connection.execute("UPDATE settlements SET status='paused',updated_at=? WHERE order_id=? AND status IN ('holding','payable')", (created, order_id))
                pause_supplier_card_hour_rebate(connection, order_id, created)
                audit(connection, session["user_id"], "dispute", dispute_id, "dispute.opened", {
                    "order_id": order_id, "category": category, "reason": reason,
                })
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(201, {"ok": True, "dispute": {"id": dispute_id, "status": "open"}})

    def create_refund(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        order_id = clean_text(data.get("order_id"), "订单", 4, 80)
        reason = clean_text(data.get("reason"), "退款原因", 8, 1000)
        idem = require_idempotency_key(self.headers)
        refund_id = uid("refund")
        created = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute(
                    "SELECT * FROM refunds WHERE requester_user_id=? AND idempotency_key=?",
                    (session["user_id"], idem),
                ).fetchone()
                if existing:
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "refund": dict(existing), "idempotent_replay": True})
                order = fetch_order(connection, order_id)
                if order["buyer_user_id"] != session["user_id"]:
                    raise ApiError(403, "无权申请该订单退款")
                payment = connection.execute("SELECT * FROM payments WHERE order_id=? AND status='success'", (order_id,)).fetchone()
                if not payment or order["status"] not in ("paid", "supplier_confirmed", "delivered", "accepted", "disputed"):
                    raise ApiError(409, "订单当前不满足退款申请条件", "refund_not_allowed")
                if order["kind"] == "card_hour_topup":
                    lot = connection.execute(
                        """SELECT l.* FROM card_hour_lots l JOIN card_hour_topups t ON t.id=l.topup_id
                           WHERE t.order_id=?""",
                        (order_id,),
                    ).fetchone()
                    if (
                        not lot
                        or lot["status"] != "available"
                        or int(lot["available_micros"]) != int(lot["original_micros"])
                    ):
                        raise ApiError(
                            409,
                            "充值卡时已使用、冻结或到期，不能原路全额退款",
                            "card_hour_refund_balance_changed",
                        )
                original_status = order["status"]
                if original_status == "disputed":
                    dispute = connection.execute("SELECT * FROM disputes WHERE order_id=? ORDER BY created_at DESC LIMIT 1", (order_id,)).fetchone()
                    original_status = dispute["original_order_status"] if dispute else "delivered"
                connection.execute(
                    """INSERT INTO refunds(id,order_id,payment_id,requester_user_id,amount_cents,reason,original_order_status,
                       status,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'pending_review',?,?,?)""",
                    (refund_id, order_id, payment["id"], session["user_id"], order["amount_cents"], reason, original_status, idem, created, created),
                )
                connection.execute("UPDATE orders SET status='refund_pending',updated_at=? WHERE id=?", (created, order_id))
                connection.execute("UPDATE settlements SET status='paused',updated_at=? WHERE order_id=? AND status IN ('holding','payable')", (created, order_id))
                pause_supplier_card_hour_rebate(connection, order_id, created)
                audit(connection, session["user_id"], "refund", refund_id, "refund.requested", {
                    "order_id": order_id, "amount_cents": order["amount_cents"], "reason": reason,
                }, idem)
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(201, {"ok": True, "refund": {"id": refund_id, "status": "pending_review", "amount_cents": order["amount_cents"]}})

    def create_invoice_request(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        order_id = clean_text(data.get("order_id"), "订单", 4, 80)
        title = clean_text(data.get("invoice_title"), "发票抬头", 2, 160)
        tax_id = clean_text(data.get("tax_id"), "纳税人识别号", 15, 30).upper()
        email = clean_text(data.get("email"), "接收邮箱", 5, 160).lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise ApiError(422, "接收邮箱格式无效")
        request_id = uid("invoice")
        created = now_iso()
        with db_connect() as connection:
            order = fetch_order(connection, order_id)
            if order["buyer_user_id"] != session["user_id"]:
                raise ApiError(403, "无权申请该订单发票")
            if order["status"] != "accepted":
                raise ApiError(409, "订单验收后才能申请发票", "invoice_not_allowed")
            existing = connection.execute("SELECT * FROM invoice_requests WHERE order_id=?", (order_id,)).fetchone()
            if existing:
                return self.json_response(200, {"ok": True, "invoice": dict(existing), "idempotent_replay": True})
            connection.execute(
                "INSERT INTO invoice_requests(id,order_id,requester_user_id,invoice_title,tax_id,email,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'requested',?,?)",
                (request_id, order_id, session["user_id"], title, tax_id, email, created, created),
            )
            audit(connection, session["user_id"], "invoice", request_id, "invoice.requested", {"order_id": order_id})
        self.json_response(201, {"ok": True, "invoice": {"id": request_id, "status": "requested"}})

    def get_swap_requests(self) -> None:
        session = self.session()
        with db_connect() as connection:
            rows = connection.execute(
                """SELECT s.*,l.provider AS target_provider,l.unit AS target_unit,l.product_code AS quoted_product
                   FROM swap_requests s LEFT JOIN listings l ON l.id=s.target_listing_id
                   WHERE s.requester_user_id=? ORDER BY s.created_at DESC LIMIT 50""",
                (session["user_id"],),
            ).fetchall()
        swaps = []
        for row in rows:
            item = dict(row)
            try:
                item["quote_snapshot"] = json.loads(item.pop("quote_snapshot_json") or "{}")
            except json.JSONDecodeError:
                item["quote_snapshot"] = {}
            item["source_reference_cny"] = item.pop("source_reference_cents") / 100
            target_cents = item.pop("target_reference_cents")
            item["target_reference_cny"] = target_cents / 100 if target_cents else None
            swaps.append(item)
        self.json_response(200, {"ok": True, "swaps": swaps})

    def create_swap_request(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        source_id = clean_text(data.get("source_allocation_id"), "源资产批次", 4, 80)
        target_kind = clean_text(data.get("target_kind"), "目标资源类型", 3, 20)
        if target_kind not in RESOURCE_UNITS:
            raise ApiError(422, "目标资源类型无效", "invalid_resource_kind")
        target_product = clean_text(data.get("target_product_code"), "目标标准产品", 2, 120)
        target_region = clean_text(data.get("target_region") or "不限地区", "目标地区", 2, 80)
        try:
            quantity = round(float(data.get("source_quantity")), 6)
        except (TypeError, ValueError):
            raise ApiError(422, "源资产数量无效")
        if quantity <= 0:
            raise ApiError(422, "源资产数量必须大于零")
        idem = require_idempotency_key(self.headers)
        swap_id = uid("swap")
        created = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute(
                    "SELECT * FROM swap_requests WHERE requester_user_id=? AND idempotency_key=?",
                    (session["user_id"], idem),
                ).fetchone()
                if existing:
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "swap": dict(existing), "idempotent_replay": True})
                allocation = connection.execute("SELECT * FROM allocations WHERE id=?", (source_id,)).fetchone()
                if not allocation or allocation["owner_user_id"] != session["user_id"]:
                    raise ApiError(404, "源资产批次不存在", "allocation_not_found")
                if allocation["kind"] == "card_hour":
                    raise ApiError(
                        409,
                        "标准卡时只能通过卡时订单账本使用，不能作为普通资产置换",
                        "card_hour_generic_operation_rejected",
                    )
                if allocation["status"] != "available":
                    raise ApiError(409, "源资产当前已冻结或不可用", "allocation_not_available")
                withdrawal_reserved = connection.execute(
                    "SELECT COALESCE(SUM(quantity),0) FROM withdrawal_requests WHERE allocation_id=? AND status IN ('scheduled','processing')",
                    (source_id,),
                ).fetchone()[0]
                available = allocation["quantity"] - withdrawal_reserved - float(allocation["swap_reserved"] or 0)
                if available + 1e-9 < quantity:
                    raise ApiError(409, f"源资产可置换余额不足，当前可用 {max(0, available):g} {allocation['unit']}", "insufficient_swap_balance")
                source_order = fetch_order(connection, allocation["order_id"])
                source_reference_cents = int(source_order["unit_price_cents"])
                preferred_listing = clean_text(data.get("target_listing_id"), "目标挂牌", 4, 80) if data.get("target_listing_id") else None
                if preferred_listing:
                    target_listing = connection.execute(
                        "SELECT * FROM listings WHERE id=? AND status='active' AND trade_mode='fixed'",
                        (preferred_listing,),
                    ).fetchone()
                else:
                    region_clause = "" if target_region == "不限地区" else " AND region=?"
                    params = [target_kind, target_product, target_product]
                    if target_region != "不限地区":
                        params.append(target_region)
                    target_listing = connection.execute(
                        f"""SELECT * FROM listings WHERE status='active' AND trade_mode='fixed' AND kind=?
                            AND (product_code=? OR gpu=?) {region_clause}
                            AND valid_from<=? AND valid_until>? ORDER BY unit_price_cents LIMIT 1""",
                        (*params, created, created),
                    ).fetchone()
                target_reference_cents = int(target_listing["unit_price_cents"]) if target_listing else None
                estimate = round(quantity * source_reference_cents / target_reference_cents, 6) if target_reference_cents else None
                snapshot = {
                    "valuation_currency": "CNY", "valuation_time": created,
                    "source_price_layer": "source_order_execution_price",
                    "source_unit_price_cny": source_reference_cents / 100,
                    "target_price_layer": "active_verified_listing" if target_listing else "awaiting_market_match",
                    "target_unit_price_cny": target_reference_cents / 100 if target_reference_cents else None,
                    "standardization_adjustment_bps": 0,
                }
                connection.execute(
                    """INSERT INTO swap_requests(id,requester_user_id,source_allocation_id,source_kind,source_product_code,
                       source_quantity,source_unit,target_kind,target_product_code,target_region,target_listing_id,target_quantity,
                       source_reference_cents,target_reference_cents,quote_snapshot_json,status,idempotency_key,created_at,updated_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'matching',?,?,?)""",
                    (swap_id, session["user_id"], source_id, allocation["kind"], allocation["product_code"] or allocation["gpu"],
                     quantity, allocation["unit"], target_kind, target_product, target_region,
                     target_listing["id"] if target_listing else None, estimate, source_reference_cents,
                     target_reference_cents, json.dumps(snapshot, ensure_ascii=False), idem, created, created),
                )
                audit(connection, session["user_id"], "swap", swap_id, "swap.requested", {
                    "source_allocation_id": source_id, "source_quantity": quantity,
                    "target_kind": target_kind, "target_product_code": target_product,
                    "reference_value_cents": int(round(quantity * source_reference_cents)),
                }, idem)
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(201, {"ok": True, "swap": {"id": swap_id, "status": "matching", "estimated_target_quantity": estimate}})

    def admin_quote_swap(self, swap_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        listing_id = clean_text(data.get("target_listing_id"), "目标挂牌", 4, 80)
        quoted_at = now_iso()
        quote_expires = future_minutes_iso(15)
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                swap = connection.execute("SELECT * FROM swap_requests WHERE id=?", (swap_id,)).fetchone()
                if not swap or swap["status"] != "matching":
                    raise ApiError(409, "置换需求不存在或已进入其他状态")
                allocation = connection.execute("SELECT * FROM allocations WHERE id=?", (swap["source_allocation_id"],)).fetchone()
                listing = connection.execute("SELECT * FROM listings WHERE id=? AND status='active' AND trade_mode='fixed'", (listing_id,)).fetchone()
                if not allocation or not listing or listing["kind"] != swap["target_kind"]:
                    raise ApiError(409, "目标挂牌不可用或产品类型不匹配", "swap_target_unavailable")
                if swap["target_product_code"] not in (listing["product_code"], listing["gpu"]):
                    raise ApiError(409, "目标挂牌与需求中的标准产品不一致", "swap_target_product_mismatch")
                target_quantity = round(swap["source_quantity"] * swap["source_reference_cents"] / listing["unit_price_cents"], 6)
                available = listing["verified_quantity"] - listing["quote_reserved"] - listing["order_locked"] - listing["delivering"] - listing["consumed"] - listing["frozen"]
                if target_quantity < listing["minimum_quantity"] or available + 1e-9 < target_quantity:
                    raise ApiError(409, "目标挂牌容量不足或低于最低交易量", "insufficient_swap_target_capacity")
                if allocation["quantity"] - allocation["swap_reserved"] + 1e-9 < swap["source_quantity"]:
                    raise ApiError(409, "源资产可置换余额已变化", "insufficient_swap_balance")
                connection.execute("UPDATE allocations SET swap_reserved=swap_reserved+? WHERE id=?", (swap["source_quantity"], allocation["id"]))
                connection.execute("UPDATE listings SET quote_reserved=quote_reserved+?,version=version+1,updated_at=? WHERE id=?", (target_quantity, quoted_at, listing_id))
                snapshot = {
                    "valuation_currency": "CNY", "valuation_time": quoted_at,
                    "source_unit_price_cny": swap["source_reference_cents"] / 100,
                    "target_unit_price_cny": listing["unit_price_cents"] / 100,
                    "source_value_cny": round(swap["source_quantity"] * swap["source_reference_cents"] / 100, 2),
                    "target_value_cny": round(target_quantity * listing["unit_price_cents"] / 100, 2),
                    "price_source": "source execution price + active verified target listing",
                    "cash_difference_cny": 0,
                }
                connection.execute(
                    """UPDATE swap_requests SET target_listing_id=?,target_quantity=?,target_reference_cents=?,
                       quote_snapshot_json=?,quote_expires_at=?,status='quoted',updated_at=? WHERE id=?""",
                    (listing_id, target_quantity, listing["unit_price_cents"], json.dumps(snapshot, ensure_ascii=False), quote_expires, quoted_at, swap_id),
                )
                audit(connection, session["user_id"], "swap", swap_id, "swap.quoted", {"target_listing_id": listing_id, "target_quantity": target_quantity, "quote_expires_at": quote_expires})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "swap_id": swap_id, "status": "quoted", "quote_expires_at": quote_expires, "target_quantity": target_quantity})

    def accept_swap_quote(self, swap_id: str) -> None:
        session = self.session(csrf=True)
        created = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                swap = connection.execute("SELECT * FROM swap_requests WHERE id=?", (swap_id,)).fetchone()
                if not swap or swap["requester_user_id"] != session["user_id"]:
                    raise ApiError(404, "置换报价不存在")
                if swap["status"] == "confirmed":
                    order = fetch_order(connection, swap["target_order_id"])
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "swap_id": swap_id, "status": "confirmed", "order": order_dict(order), "idempotent_replay": True})
                if swap["status"] != "quoted" or not swap["quote_expires_at"] or swap["quote_expires_at"] <= created:
                    raise ApiError(409, "置换报价已失效，请重新撮合", "swap_quote_expired")
                listing = connection.execute("SELECT * FROM listings WHERE id=?", (swap["target_listing_id"],)).fetchone()
                allocation = connection.execute("SELECT * FROM allocations WHERE id=?", (swap["source_allocation_id"],)).fetchone()
                if not listing or not allocation or allocation["swap_reserved"] + 1e-9 < swap["source_quantity"] or listing["quote_reserved"] + 1e-9 < swap["target_quantity"]:
                    raise ApiError(409, "置换两侧锁定容量异常", "swap_reservation_invalid")
                order_id = uid("ord")
                order_no = f"KAI{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}{secrets.randbelow(9000)+1000}"
                amount = int(round(swap["target_quantity"] * listing["unit_price_cents"]))
                snapshot = json.loads(swap["quote_snapshot_json"] or "{}") | {"source": "bilateral_swap", "swap_id": swap_id, "listing_version": listing["version"]}
                connection.execute("UPDATE listings SET quote_reserved=quote_reserved-?,order_locked=order_locked+?,version=version+1,updated_at=? WHERE id=?", (swap["target_quantity"], swap["target_quantity"], created, listing["id"]))
                connection.execute(
                    """INSERT INTO orders(id,order_no,buyer_user_id,listing_id,gpu,region,provider,quantity,unit,
                       unit_price_cents,amount_cents,currency,status,payment_provider,idempotency_key,quote_snapshot_json,
                       reservation_expires_at,created_at,updated_at,kind,product_code,settlement_mode,swap_id)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,'CNY','paid','swap',?,?,?,?,?,?,?,'swap',?)""",
                    (order_id, order_no, session["user_id"], listing["id"], listing["gpu"], listing["region"], listing["provider"],
                     swap["target_quantity"], listing["unit"], listing["unit_price_cents"], amount, f"swap:{swap_id}",
                     json.dumps(snapshot, ensure_ascii=False), created, created, created, listing["kind"], listing["product_code"], swap_id),
                )
                connection.execute("UPDATE swap_requests SET target_order_id=?,status='confirmed',updated_at=? WHERE id=?", (order_id, created, swap_id))
                audit(connection, session["user_id"], "swap", swap_id, "swap.confirmed", {"target_order_id": order_id, "cash_difference_cents": 0})
                audit(connection, session["user_id"], "order", order_id, "capacity.locked_by_swap", {"swap_id": swap_id, "quantity": swap["target_quantity"], "unit": listing["unit"]})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            order = fetch_order(connection, order_id)
        self.json_response(200, {"ok": True, "swap_id": swap_id, "status": "confirmed", "order": order_dict(order)})

    def cancel_swap_request(self, swap_id: str) -> None:
        session = self.session(csrf=True)
        updated = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                swap = connection.execute("SELECT * FROM swap_requests WHERE id=?", (swap_id,)).fetchone()
                if not swap or swap["requester_user_id"] != session["user_id"]:
                    raise ApiError(404, "置换需求不存在")
                if swap["status"] == "cancelled":
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "swap_id": swap_id, "status": "cancelled", "idempotent_replay": True})
                if swap["status"] not in ("matching", "quoted"):
                    raise ApiError(409, "置换已确认交付，需通过争议流程处理", "swap_not_cancellable")
                if swap["status"] == "quoted":
                    connection.execute("UPDATE allocations SET swap_reserved=MAX(0,swap_reserved-?) WHERE id=?", (swap["source_quantity"], swap["source_allocation_id"]))
                    connection.execute("UPDATE listings SET quote_reserved=MAX(0,quote_reserved-?),version=version+1,updated_at=? WHERE id=?", (swap["target_quantity"], updated, swap["target_listing_id"]))
                connection.execute("UPDATE swap_requests SET status='cancelled',updated_at=? WHERE id=?", (updated, swap_id))
                audit(connection, session["user_id"], "swap", swap_id, "swap.cancelled", {"reservations_released": swap["status"] == "quoted"})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "swap_id": swap_id, "status": "cancelled"})

    def get_account_deletion_status(self) -> None:
        session = self.session()
        with db_connect() as connection:
            row = connection.execute("SELECT * FROM account_deletion_requests WHERE user_id=? ORDER BY requested_at DESC LIMIT 1", (session["user_id"],)).fetchone()
        self.json_response(200, {"ok": True, "request": dict(row) if row else None})

    def create_account_deletion_request(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        password = str(data.get("password") or "")
        reason = clean_text(data.get("reason") or "用户主动申请注销账户", "注销原因", 4, 500)
        requested = now_iso()
        request_id = uid("deletion")
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                user = connection.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone()
                if not user or not verify_password(password, user["password_hash"]):
                    raise ApiError(401, "账户密码不正确", "invalid_current_password")
                existing = connection.execute("SELECT * FROM account_deletion_requests WHERE user_id=? AND status IN ('pending_obligations','scheduled') ORDER BY requested_at DESC LIMIT 1", (user["id"],)).fetchone()
                if existing:
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "request": dict(existing), "idempotent_replay": True})
                open_orders = connection.execute("SELECT COUNT(*) FROM orders WHERE buyer_user_id=? AND status NOT IN ('accepted','cancelled','refunded','expired')", (user["id"],)).fetchone()[0]
                supplier_obligations = connection.execute("SELECT COUNT(*) FROM listings WHERE supplier_user_id=? AND status IN ('pending_review','active','suspended')", (user["id"],)).fetchone()[0]
                open_cases = connection.execute("SELECT COUNT(*) FROM disputes WHERE opened_by=? AND status IN ('open','reviewing')", (user["id"],)).fetchone()[0]
                has_obligations = (open_orders + supplier_obligations + open_cases) > 0
                status = "pending_obligations" if has_obligations else "scheduled"
                scheduled_for = None if has_obligations else (datetime.now(timezone.utc) + timedelta(days=7)).replace(microsecond=0).isoformat()
                retention = "订单、支付、计量、发票、结算、风控与审计记录按法定或合同期限保留；到期前限制使用并与公开身份分离。"
                connection.execute("INSERT INTO account_deletion_requests(id,user_id,status,reason,retention_summary,requested_at,scheduled_for,updated_at) VALUES(?,?,?,?,?,?,?,?)", (request_id, user["id"], status, reason, retention, requested, scheduled_for, requested))
                connection.execute("UPDATE users SET lifecycle_status='deletion_requested',deletion_requested_at=?,updated_at=? WHERE id=?", (requested, requested, user["id"]))
                audit(connection, user["id"], "account_deletion", request_id, "account.deletion_requested", {"status": status, "open_orders": open_orders, "supplier_obligations": supplier_obligations, "open_cases": open_cases})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(201, {"ok": True, "request": {"id": request_id, "status": status, "scheduled_for": scheduled_for, "retention_summary": retention}})

    def cancel_account_deletion_request(self) -> None:
        session = self.session(csrf=True)
        updated = now_iso()
        with db_connect() as connection:
            row = connection.execute("SELECT * FROM account_deletion_requests WHERE user_id=? AND status IN ('pending_obligations','scheduled') ORDER BY requested_at DESC LIMIT 1", (session["user_id"],)).fetchone()
            if not row:
                raise ApiError(409, "当前没有可撤销的注销申请")
            connection.execute("UPDATE account_deletion_requests SET status='cancelled',updated_at=? WHERE id=?", (updated, row["id"]))
            connection.execute("UPDATE users SET lifecycle_status='active',deletion_requested_at=NULL,updated_at=? WHERE id=?", (updated, session["user_id"]))
            audit(connection, session["user_id"], "account_deletion", row["id"], "account.deletion_cancelled", {})
        self.json_response(200, {"ok": True, "request_id": row["id"], "status": "cancelled"})

    def admin_complete_account_deletion(self, request_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        completed = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                request_row = connection.execute("SELECT * FROM account_deletion_requests WHERE id=?", (request_id,)).fetchone()
                if not request_row or request_row["status"] not in ("pending_obligations", "scheduled"):
                    raise ApiError(409, "注销申请不存在或已处理")
                user_id = request_row["user_id"]
                open_orders = connection.execute("SELECT COUNT(*) FROM orders WHERE buyer_user_id=? AND status NOT IN ('accepted','cancelled','refunded','expired')", (user_id,)).fetchone()[0]
                open_supplier_orders = connection.execute("SELECT COUNT(*) FROM orders o JOIN listings l ON l.id=o.listing_id WHERE l.supplier_user_id=? AND o.status NOT IN ('accepted','cancelled','refunded','expired')", (user_id,)).fetchone()[0]
                open_cases = connection.execute("SELECT COUNT(*) FROM disputes WHERE opened_by=? AND status IN ('open','reviewing')", (user_id,)).fetchone()[0]
                if open_orders or open_supplier_orders or open_cases:
                    raise ApiError(409, "仍有订单、交付或争议义务，暂不能完成注销", "account_deletion_obligations")
                pseudonym = hashlib.sha256(f"{user_id}|{completed}".encode()).hexdigest()[:16]
                connection.execute("UPDATE listings SET status='supplier_exited',updated_at=? WHERE supplier_user_id=? AND status IN ('pending_review','active','suspended')", (completed, user_id))
                connection.execute(
                    """UPDATE users SET name='已注销企业用户',account=?,password_hash=?,role='exited',enterprise_status='exited',
                       lifecycle_status='anonymized',anonymized_at=?,updated_at=? WHERE id=?""",
                    (f"deleted-{pseudonym}@invalid.kai", hash_password(secrets.token_urlsafe(32)), completed, completed, user_id),
                )
                connection.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
                connection.execute("UPDATE account_deletion_requests SET status='completed',completed_at=?,updated_at=? WHERE id=?", (completed, completed, request_id))
                audit(connection, session["user_id"], "account_deletion", request_id, "account.deletion_completed", {"identity_anonymized": True, "transaction_history_preserved": True})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "request_id": request_id, "status": "completed"})

    def get_public_operator(self) -> None:
        self.json_response(200, {"ok": True, "operator": {
            "app_name": APP_NAME, "legal_name": OPERATOR_LEGAL_NAME, "support_email": SUPPORT_EMAIL,
            "support_phone": SUPPORT_PHONE, "icp_filing": ICP_FILING, "app_filing": APP_FILING,
            "privacy_url": f"{PUBLIC_BASE_URL}/privacy.html" if PUBLIC_BASE_URL else "/privacy.html",
            "terms_url": f"{PUBLIC_BASE_URL}/terms.html" if PUBLIC_BASE_URL else "/terms.html",
            "deletion_url": f"{PUBLIC_BASE_URL}/account-deletion.html" if PUBLIC_BASE_URL else "/account-deletion.html",
        }})

    def get_app_release_readiness(self) -> None:
        session = self.session()
        require_role(session, "admin")
        self.json_response(200, {"ok": True, "release": integration_readiness()["app_release"]})

    def get_cases(self) -> None:
        session = self.session()
        with db_connect() as connection:
            disputes = connection.execute(
                "SELECT d.* FROM disputes d JOIN orders o ON o.id=d.order_id WHERE o.buyer_user_id=? ORDER BY d.created_at DESC",
                (session["user_id"],),
            ).fetchall()
            refunds = connection.execute(
                "SELECT * FROM refunds WHERE requester_user_id=? ORDER BY created_at DESC", (session["user_id"],)
            ).fetchall()
            invoices = connection.execute(
                "SELECT * FROM invoice_requests WHERE requester_user_id=? ORDER BY created_at DESC", (session["user_id"],)
            ).fetchall()
            settlements = []
            if session["role"] == "supplier":
                settlements = connection.execute(
                    "SELECT * FROM settlements WHERE supplier_user_id=? ORDER BY created_at DESC", (session["user_id"],)
                ).fetchall()
        self.json_response(200, {"ok": True, "disputes": [dict(row) for row in disputes], "refunds": [dict(row) for row in refunds], "invoices": [dict(row) for row in invoices], "settlements": [dict(row) for row in settlements]})

    def admin_resolve_dispute(self, dispute_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        decision = clean_text(data.get("decision"), "争议处理决定", 3, 20)
        if decision not in ("reject", "refund"):
            raise ApiError(422, "争议处理决定无效")
        resolution = clean_text(data.get("resolution"), "处理结论", 8, 1000)
        updated = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                dispute = connection.execute("SELECT * FROM disputes WHERE id=?", (dispute_id,)).fetchone()
                if not dispute or dispute["status"] not in ("open", "reviewing"):
                    raise ApiError(409, "争议不存在或已处理")
                order = fetch_order(connection, dispute["order_id"])
                if decision == "reject":
                    connection.execute("UPDATE orders SET status=?,updated_at=? WHERE id=?", (dispute["original_order_status"], updated, order["id"]))
                    connection.execute("UPDATE settlements SET status='holding',updated_at=? WHERE order_id=? AND status='paused'", (updated, order["id"]))
                    restore_supplier_card_hour_rebate(connection, order["id"], updated)
                    dispute_status = "resolved_rejected"
                else:
                    payment = connection.execute("SELECT * FROM payments WHERE order_id=? AND status='success'", (order["id"],)).fetchone()
                    if not payment:
                        raise ApiError(409, "订单不存在可退款支付记录")
                    refund_id = uid("refund")
                    connection.execute(
                        """INSERT INTO refunds(id,order_id,payment_id,requester_user_id,amount_cents,reason,original_order_status,status,idempotency_key,created_at,updated_at)
                           VALUES(?,?,?,?,?,?,?,'pending_review',?,?,?)""",
                        (refund_id, order["id"], payment["id"], dispute["opened_by"], order["amount_cents"], resolution,
                         dispute["original_order_status"], f"dispute:{dispute_id}", updated, updated),
                    )
                    connection.execute("UPDATE orders SET status='refund_pending',updated_at=? WHERE id=?", (updated, order["id"]))
                    dispute_status = "resolved_refund"
                connection.execute(
                    "UPDATE disputes SET status=?,resolution=?,assigned_to=?,updated_at=? WHERE id=?",
                    (dispute_status, resolution, session["user_id"], updated, dispute_id),
                )
                audit(connection, session["user_id"], "dispute", dispute_id, f"dispute.{dispute_status}", {"resolution": resolution})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "dispute_id": dispute_id, "status": dispute_status})

    def admin_review_refund(self, refund_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        decision = clean_text(data.get("decision"), "退款审核决定", 3, 20)
        if decision not in ("approve", "reject"):
            raise ApiError(422, "退款审核决定无效")
        reason = clean_text(data.get("reason") or "依据订单、计量和争议记录审核", "审核理由", 4, 500)
        if decision == "approve" and not ALLOW_DEMO:
            refund, order, payment, claim_token = claim_refund_execution(
                refund_id, session["user_id"]
            )
            try:
                provider_result = request_provider_refund(
                    payment["provider"], refund, order, payment
                )
            except Exception as error:
                with db_connect() as connection:
                    updated = now_iso()
                    connection.execute(
                        """UPDATE refunds SET execution_state='uncertain',last_error_code=?,updated_at=?
                           WHERE id=? AND execution_claim_token=? AND execution_state='submitting'""",
                        (type(error).__name__[:120], updated, refund_id, claim_token),
                    )
                    audit(connection, session["user_id"], "refund", refund_id, "refund.execution_uncertain", {
                        "reason": reason,
                    })
                raise
            with db_connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                try:
                    refund = connection.execute(
                        "SELECT * FROM refunds WHERE id=?", (refund_id,)
                    ).fetchone()
                    if (
                        not refund
                        or refund["execution_claim_token"] != claim_token
                        or refund["execution_state"] != "submitting"
                    ):
                        raise ApiError(409, "退款执行状态冲突", "refund_execution_conflict")
                    if provider_result.get("status") != "SUCCESS":
                        connection.execute(
                            """UPDATE refunds SET execution_state='uncertain',provider_ref=?,updated_at=?
                               WHERE id=? AND execution_claim_token=?""",
                            (provider_result.get("provider_ref"), now_iso(), refund_id, claim_token),
                        )
                        status = "processing"
                    else:
                        apply_refund_success(
                            connection,
                            refund,
                            str(provider_result.get("provider_ref") or uid("refund_ref")),
                            session["user_id"],
                        )
                        connection.execute(
                            "UPDATE refunds SET execution_state='success',last_error_code=NULL,updated_at=? WHERE id=?",
                            (now_iso(), refund_id),
                        )
                        status = "success"
                    audit(connection, session["user_id"], "refund", refund_id, f"refund.{status}", {
                        "reason": reason,
                    })
                    connection.execute("COMMIT")
                except Exception:
                    if connection.in_transaction:
                        connection.execute("ROLLBACK")
                    raise
            return self.json_response(200, {
                "ok": True, "refund_id": refund_id, "status": status,
            })
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                refund = connection.execute("SELECT * FROM refunds WHERE id=?", (refund_id,)).fetchone()
                if not refund or refund["status"] != "pending_review":
                    raise ApiError(409, "退款申请不存在或已审核")
                if decision == "reject":
                    updated = now_iso()
                    connection.execute("UPDATE refunds SET status='rejected',reviewer_user_id=?,updated_at=? WHERE id=?", (session["user_id"], updated, refund_id))
                    connection.execute("UPDATE orders SET status=?,updated_at=? WHERE id=?", (refund["original_order_status"], updated, refund["order_id"]))
                    connection.execute("UPDATE settlements SET status='holding',updated_at=? WHERE order_id=? AND status='paused'", (updated, refund["order_id"]))
                    restore_supplier_card_hour_rebate(connection, refund["order_id"], updated)
                    status = "rejected"
                elif ALLOW_DEMO:
                    apply_refund_success(connection, refund, uid("mock_refund"), session["user_id"])
                    connection.execute(
                        "UPDATE refunds SET execution_state='success',updated_at=? WHERE id=?",
                        (now_iso(), refund_id),
                    )
                    status = "success"
                else:
                    raise ApiError(409, "退款执行状态无效", "refund_execution_conflict")
                audit(connection, session["user_id"], "refund", refund_id, f"refund.{status}", {"reason": reason})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "refund_id": refund_id, "status": status})

    def admin_mark_settlement_paid(self, settlement_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        payout_ref = clean_text(data.get("payout_ref"), "持牌机构分账流水", 6, 160)
        with db_connect() as connection:
            settlement = connection.execute("SELECT * FROM settlements WHERE id=?", (settlement_id,)).fetchone()
            if not settlement or settlement["status"] != "payable":
                raise ApiError(409, "结算单尚未达到可结算状态")
            updated = now_iso()
            connection.execute("UPDATE settlements SET status='paid',payout_ref=?,paid_at=?,updated_at=? WHERE id=?", (payout_ref, updated, updated, settlement_id))
            audit(connection, session["user_id"], "settlement", settlement_id, "settlement.paid", {"payout_ref": payout_ref, "supplier_net_cents": settlement["supplier_net_cents"]})
        self.json_response(200, {"ok": True, "settlement_id": settlement_id, "status": "paid"})

    def admin_review_supplier_rebate(self, rebate_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        decision = clean_text(data.get("decision"), "审核决定", 6, 20)
        if decision not in ("approve", "reject"):
            raise ApiError(422, "审核决定无效", "invalid_rebate_review_decision")
        reason = clean_text(data.get("reason"), "审核理由", 4, 500)
        reviewed_at = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                rebate = connection.execute(
                    "SELECT * FROM supplier_card_hour_rebates WHERE id=?", (rebate_id,)
                ).fetchone()
                if not rebate or rebate["status"] != "pending_review" or not rebate["review_required"]:
                    raise ApiError(409, "返佣记录不在待审核状态", "rebate_not_pending_review")
                blocking_case = connection.execute(
                    """SELECT 1 FROM disputes WHERE order_id=? AND status IN ('open','reviewing')
                       UNION ALL SELECT 1 FROM refunds WHERE order_id=?
                       AND status IN ('pending_review','approved','processing','success') LIMIT 1""",
                    (rebate["order_id"], rebate["order_id"]),
                ).fetchone()
                if blocking_case:
                    raise ApiError(409, "订单存在争议或退款，暂不能审核返佣", "rebate_review_blocked")
                if decision == "approve":
                    connection.execute(
                        """UPDATE supplier_card_hour_rebates SET reviewer_user_id=?,review_reason=?,reviewed_at=?,
                           updated_at=? WHERE id=?""",
                        (session["user_id"], reason, reviewed_at, reviewed_at, rebate_id),
                    )
                    rebate = connection.execute(
                        "SELECT * FROM supplier_card_hour_rebates WHERE id=?", (rebate_id,)
                    ).fetchone()
                    rebate = issue_supplier_card_hour_rebate(connection, rebate, session["user_id"], reviewed_at)
                    status = rebate["status"]
                else:
                    status = "rejected"
                    connection.execute(
                        """UPDATE supplier_card_hour_rebates SET status='rejected',reviewer_user_id=?,review_reason=?,
                           reviewed_at=?,updated_at=? WHERE id=?""",
                        (session["user_id"], reason, reviewed_at, reviewed_at, rebate_id),
                    )
                    audit(connection, session["user_id"], "supplier_card_hour_rebate", rebate_id,
                          "supplier_rebate.rejected", {"order_id": rebate["order_id"], "reason": reason})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            updated = connection.execute(
                "SELECT * FROM supplier_card_hour_rebates WHERE id=?", (rebate_id,)
            ).fetchone()
        self.json_response(200, {"ok": True, "rebate": supplier_rebate_dict(updated), "status": status})

    def admin_issue_invoice(self, invoice_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        invoice_ref = clean_text(data.get("invoice_ref"), "发票号码", 6, 160)
        with db_connect() as connection:
            invoice = connection.execute("SELECT * FROM invoice_requests WHERE id=?", (invoice_id,)).fetchone()
            if not invoice or invoice["status"] != "requested":
                raise ApiError(409, "开票申请不存在或已处理")
            updated = now_iso()
            connection.execute("UPDATE invoice_requests SET status='issued',invoice_ref=?,issued_at=?,updated_at=? WHERE id=?", (invoice_ref, updated, updated, invoice_id))
            audit(connection, session["user_id"], "invoice", invoice_id, "invoice.issued", {"invoice_ref": invoice_ref})
        self.json_response(200, {"ok": True, "invoice_id": invoice_id, "status": "issued"})

    def admin_run_maintenance(self) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        result = run_maintenance_cycle()
        self.json_response(200, {"ok": True, "result": result})

    def admin_payment_reconciliation_action(self, payment_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        idempotency_key = require_idempotency_key(self.headers)
        data = self.read_json()
        action = clean_text(data.get("action"), "人工核单动作", 4, 40)
        reason = clean_text(data.get("reason"), "人工核单说明", 8, 500)
        if action not in ("acknowledge_monitoring", "reopen"):
            raise ApiError(
                422,
                "七相状态 0 不是未支付终态，只能确认继续监控或重新打开核单",
                "payment_review_action_not_allowed",
            )
        command = claim_payment_reconciliation_command(
            payment_id=payment_id,
            actor_user_id=session["user_id"],
            action=action,
            reason=reason,
            idempotency_key=idempotency_key,
        )
        if command["state"] == "completed":
            response = dict(command["response"])
            response["idempotent_replay"] = True
            return self.json_response(
                command["response_status"],
                response,
            )
        if command["state"] == "processing":
            deadline = time.monotonic() + QIXIANG_TIMEOUT_SECONDS + 2
            while time.monotonic() < deadline:
                completed = payment_reconciliation_command_result(
                    session["user_id"],
                    idempotency_key,
                )
                if completed:
                    response = dict(completed["response"])
                    response["idempotent_replay"] = True
                    return self.json_response(
                        completed["response_status"],
                        response,
                    )
                time.sleep(0.05)
            raise ApiError(
                409,
                "相同幂等请求仍在执行，请继续使用同一幂等键重试",
                "payment_review_action_in_progress",
            )
        lease_token = command["lease_token"]
        try:
            if action == "reopen":
                review, replayed = apply_payment_reconciliation_action(
                    payment_id=payment_id,
                    actor_user_id=session["user_id"],
                    action=action,
                    reason=reason,
                    idempotency_key=idempotency_key,
                )
                response = {
                    "ok": True,
                    "action": action,
                    "review": dict(review),
                    "idempotent_replay": replayed,
                }
            else:
                if PAYMENT_GATEWAY != "qixiang":
                    raise ApiError(
                        409,
                        "当前未启用七相支付网关",
                        "qixiangpay_not_enabled",
                    )
                _, paid, provider_order = (
                    query_and_confirm_qixiang_payment_with_evidence(payment_id)
                )
                if paid:
                    with db_connect() as connection:
                        review = connection.execute(
                            """SELECT * FROM payment_reconciliation_reviews
                               WHERE payment_id=?""",
                            (payment_id,),
                        ).fetchone()
                    response = {
                        "ok": True,
                        "action": "payment_success_confirmed",
                        "review": dict(review) if review else None,
                        "idempotent_replay": False,
                    }
                else:
                    review, replayed = apply_payment_reconciliation_action(
                        payment_id=payment_id,
                        actor_user_id=session["user_id"],
                        action=action,
                        reason=reason,
                        idempotency_key=idempotency_key,
                        evidence_digest=qixiang_provider_order_digest(
                            provider_order
                        ),
                    )
                    response = {
                        "ok": True,
                        "action": action,
                        "review": dict(review),
                        "monitoring_continues": True,
                        "idempotent_replay": replayed,
                    }
            complete_payment_reconciliation_command(
                actor_user_id=session["user_id"],
                idempotency_key=idempotency_key,
                lease_token=lease_token,
                response_status=200,
                response=response,
            )
        except Exception as error:
            fail_payment_reconciliation_command(
                actor_user_id=session["user_id"],
                idempotency_key=idempotency_key,
                lease_token=lease_token,
                error_code=getattr(error, "code", type(error).__name__),
            )
            raise
        self.json_response(200, response)

    def admin_verify_qixiang_merchant(self) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        if PAYMENT_GATEWAY != "qixiang":
            raise ApiError(409, "当前未启用七相支付网关", "qixiangpay_not_enabled")
        data = self.read_json()
        if data.get("old_key_revocation_confirmed") is not True:
            raise ApiError(
                422,
                "必须确认七相已撤销旧 Key 并提供换发凭证",
                "old_key_revocation_evidence_required",
            )
        old_key_revoked_at = normalized_old_key_revoked_at(
            data.get("old_key_revoked_at")
        )
        revocation_reference = clean_text(
            data.get("revocation_reference"), "七相旧 Key 撤销凭证", 8, 200
        )
        if not qixiang_key_fingerprints_distinct():
            raise ApiError(
                409,
                "服务器仍在使用已退役 Key，不能通过生产验证",
                "qixiang_key_rotation_not_completed",
            )
        if not initial_qixiang_key_rotation_proof():
            raise ApiError(
                409,
                "必须先在服务器完成旧 Key 精确失效验证",
                "initial_key_rotation_cli_proof_required",
            )
        try:
            merchant = qixiang_query_merchant(qixiang_config())
        except QixiangPayError as error:
            print(f"QixiangPay merchant verification error: {error.code}")
            raise ApiError(502, str(error), error.code)
        if not merchant["active"]:
            raise ApiError(409, "七相支付商户当前未启用", "qixiangpay_merchant_inactive")
        evidence = record_qixiang_key_rotation_evidence(
            merchant=merchant,
            old_key_revoked_at=old_key_revoked_at,
            revocation_reference=revocation_reference,
            verification_source="admin_live_query",
            verified_by=session["user_id"],
        )
        expires_at = (
            parse_evidence_timestamp(evidence["provider_verified_at"])
            + timedelta(seconds=QIXIANG_CREDENTIAL_EVIDENCE_MAX_AGE_SECONDS)
        ).replace(microsecond=0).isoformat()
        self.json_response(200, {
            "ok": True,
            "gateway": "qixiang",
            "merchant": merchant,
            "key_rotation": {
                "verified": qixiang_key_rotation_ready(),
                "provider_verified_at": evidence["provider_verified_at"],
                "evidence_expires_at": expires_at,
                "revocation_reference": evidence["revocation_reference"],
            },
        })

    def get_orders(self) -> None:
        session = self.session()
        with db_connect() as connection:
            rows = connection.execute(
                """SELECT o.*,
                          d.status AS delivery_task_status,
                          d.environment_preflight_id AS delivery_environment_preflight_id,
                          d.credential_reference AS delivery_credential_reference,
                          d.endpoint_summary AS delivery_endpoint_summary,
                          d.evidence_digest AS delivery_evidence_digest,
                          d.started_at AS delivery_started_at,
                          d.delivered_at AS delivery_task_delivered_at,
                          d.acceptance_due_at AS delivery_task_acceptance_due_at
                   FROM orders o
                   LEFT JOIN delivery_tasks d ON d.order_id=o.id
                   WHERE o.buyer_user_id=? ORDER BY o.created_at DESC LIMIT 50""",
                (session["user_id"],),
            ).fetchall()
        self.json_response(200, {"ok": True, "orders": [order_dict(row) for row in rows]})

    def create_withdrawal(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        allocation_id = clean_text(data.get("allocation_id"), "资产批次", 4, 80)
        try:
            quantity = round(float(data.get("quantity")), 6)
        except (TypeError, ValueError):
            raise ApiError(422, "取出数量无效")
        if quantity <= 0:
            raise ApiError(422, "取出数量必须大于 0")
        idem = self.headers.get("Idempotency-Key", "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{12,120}", idem):
            raise ApiError(422, "缺少有效幂等键", "invalid_idempotency_key")
        request_id = uid("withdraw")
        created = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute("SELECT * FROM withdrawal_requests WHERE owner_user_id=? AND idempotency_key=?", (session["user_id"], idem)).fetchone()
                if existing:
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "withdrawal": dict(existing), "idempotent_replay": True})
                allocation = connection.execute("SELECT * FROM allocations WHERE id=?", (allocation_id,)).fetchone()
                if not allocation or allocation["owner_user_id"] != session["user_id"]:
                    raise ApiError(404, "资产批次不存在", "allocation_not_found")
                if allocation["kind"] == "card_hour":
                    raise ApiError(
                        409,
                        "标准卡时不能作为普通资产取出",
                        "card_hour_generic_operation_rejected",
                    )
                if allocation["status"] != "available":
                    raise ApiError(409, "资产批次当前已冻结或不可用", "allocation_not_available")
                reserved = connection.execute(
                    "SELECT COALESCE(SUM(quantity),0) FROM withdrawal_requests WHERE allocation_id=? AND status IN ('scheduled','processing')",
                    (allocation_id,),
                ).fetchone()[0]
                access_reserved = connection.execute(
                    "SELECT COALESCE(SUM(requested_hours),0) FROM gpu_access_requests WHERE allocation_id=? AND status NOT IN ('rejected','cancelled')",
                    (allocation_id,),
                ).fetchone()[0]
                available = allocation["quantity"] - reserved - access_reserved - float(allocation["swap_reserved"] or 0)
                if available + 1e-9 < quantity:
                    raise ApiError(409, f"可取出余额不足，当前可取出 {max(0, available):g} {allocation['unit']}", "insufficient_withdrawable_balance")
                connection.execute(
                    "INSERT INTO withdrawal_requests(id,owner_user_id,allocation_id,quantity,unit,status,decision,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,'scheduled','scheduled_withdrawal',?,?,?)",
                    (request_id, session["user_id"], allocation_id, quantity, allocation["unit"], idem, created, created),
                )
                audit(connection, session["user_id"], "withdrawal", request_id, "withdrawal.scheduled", {
                    "allocation_id": allocation_id, "quantity": quantity, "unit": allocation["unit"],
                    "history_preserved": True
                }, idem)
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            withdrawal = connection.execute("SELECT * FROM withdrawal_requests WHERE id=?", (request_id,)).fetchone()
        self.json_response(201, {"ok": True, "withdrawal": dict(withdrawal)})

    def get_withdrawals(self) -> None:
        session = self.session()
        with db_connect() as connection:
            rows = connection.execute(
                "SELECT * FROM withdrawal_requests WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 50",
                (session["user_id"],),
            ).fetchall()
        self.json_response(200, {"ok": True, "withdrawals": [dict(row) for row in rows]})

    def create_access_request(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        allocation_id = clean_text(data.get("allocation_id"), "算力资产批次", 4, 80)
        contact_name = clean_text(data.get("contact_name"), "联系人", 2, 80)
        contact_phone = normalize_phone(data.get("contact_phone"))
        contact_email = str(data.get("contact_email") or "").strip().lower() or None
        if contact_email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", contact_email):
            raise ApiError(422, "联系邮箱格式无效", "invalid_contact_email")
        if contact_email and len(contact_email) > 160:
            raise ApiError(422, "联系邮箱过长", "invalid_contact_email")
        ssh_public_key, ssh_key_fingerprint = normalize_ssh_public_key(data.get("ssh_public_key"))
        booking_start = parse_booking_datetime(data.get("booking_start_at"), "预约开始时间")
        booking_end = parse_booking_datetime(data.get("booking_end_at"), "预约结束时间")
        current = datetime.now(timezone.utc).replace(microsecond=0)
        if booking_start <= current:
            raise ApiError(422, "预约开始时间必须晚于当前时间", "booking_must_be_future")
        if booking_end <= booking_start:
            raise ApiError(422, "预约结束时间必须晚于开始时间", "invalid_booking_range")
        if booking_start > current + timedelta(days=31) or booking_end > current + timedelta(days=31):
            raise ApiError(422, "目前仅开放未来 31 天内的预约", "booking_too_far")
        requested_hours = round((booking_end - booking_start).total_seconds() / 3600, 6)
        if requested_hours < 0.5:
            raise ApiError(422, "单次预约至少 30 分钟", "booking_too_short")
        idem = require_idempotency_key(self.headers)
        request_id = uid("access")
        created = now_iso()
        start_iso = booking_start.isoformat()
        end_iso = booking_end.isoformat()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute(
                    "SELECT * FROM gpu_access_requests WHERE owner_user_id=? AND idempotency_key=?",
                    (session["user_id"], idem),
                ).fetchone()
                if existing:
                    connection.execute("COMMIT")
                    return self.json_response(200, {
                        "ok": True, "access_request": access_request_dict(existing), "idempotent_replay": True,
                    })
                allocation = connection.execute(
                    """SELECT a.*,o.status AS order_status,o.product_code AS order_product_code,
                              l.valid_until AS listing_valid_until
                       FROM allocations a JOIN orders o ON o.id=a.order_id
                       JOIN listings l ON l.id=a.listing_id WHERE a.id=?""",
                    (allocation_id,),
                ).fetchone()
                if not allocation or allocation["owner_user_id"] != session["user_id"]:
                    raise ApiError(404, "算力资产批次不存在", "allocation_not_found")
                if allocation["kind"] == "card_hour":
                    raise ApiError(
                        409,
                        "标准卡时不能直接预约 GPU，需先创建卡时结算订单",
                        "card_hour_generic_operation_rejected",
                    )
                if allocation["status"] != "available" or allocation["order_status"] != "accepted":
                    raise ApiError(409, "该订单尚未完成支付入库，暂不能预约使用", "allocation_not_available")
                expiry = parse_booking_datetime(allocation["expires_at"], "资产有效期")
                if booking_end > expiry:
                    raise ApiError(409, "预约结束时间超过该算力资产有效期", "booking_exceeds_allocation_expiry")
                overlap = connection.execute(
                    """SELECT id FROM gpu_access_requests
                       WHERE allocation_id=? AND status NOT IN ('rejected','cancelled')
                         AND booking_start_at<? AND booking_end_at>? LIMIT 1""",
                    (allocation_id, end_iso, start_iso),
                ).fetchone()
                if overlap:
                    raise ApiError(409, "该资产在所选时段已有预约，请调整时间", "booking_time_conflict")
                withdrawal_reserved = float(connection.execute(
                    "SELECT COALESCE(SUM(quantity),0) FROM withdrawal_requests WHERE allocation_id=? AND status IN ('scheduled','processing')",
                    (allocation_id,),
                ).fetchone()[0])
                access_reserved = float(connection.execute(
                    "SELECT COALESCE(SUM(requested_hours),0) FROM gpu_access_requests WHERE allocation_id=? AND status NOT IN ('rejected','cancelled')",
                    (allocation_id,),
                ).fetchone()[0])
                available = float(allocation["quantity"]) - withdrawal_reserved - float(allocation["swap_reserved"] or 0) - access_reserved
                if available + 1e-9 < requested_hours:
                    raise ApiError(409, f"已购算力时长不足，当前可预约 {max(0, available):g} 小时", "insufficient_booking_hours")
                connection.execute(
                    """INSERT INTO gpu_access_requests(
                         id,owner_user_id,order_id,allocation_id,listing_id,contact_name,contact_phone,contact_email,
                         ssh_public_key,ssh_key_fingerprint,booking_start_at,booking_end_at,requested_hours,unit,status,
                         idempotency_key,created_at,updated_at
                       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending_admin',?,?,?)""",
                    (request_id, session["user_id"], allocation["order_id"], allocation_id, allocation["listing_id"],
                     contact_name, contact_phone, contact_email, ssh_public_key, ssh_key_fingerprint,
                     start_iso, end_iso, requested_hours, allocation["unit"], idem, created, created),
                )
                audit(connection, session["user_id"], "gpu_access_request", request_id, "gpu_access.requested", {
                    "order_id": allocation["order_id"], "allocation_id": allocation_id,
                    "ssh_key_fingerprint": ssh_key_fingerprint, "booking_start_at": start_iso,
                    "booking_end_at": end_iso, "requested_hours": requested_hours, "unit": allocation["unit"],
                }, idem)
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            created_row = connection.execute("SELECT * FROM gpu_access_requests WHERE id=?", (request_id,)).fetchone()
        self.json_response(201, {"ok": True, "access_request": access_request_dict(created_row)})

    def get_access_requests(self) -> None:
        session = self.session()
        with db_connect() as connection:
            rows = connection.execute(
                """SELECT r.*,a.gpu,a.region,a.product_code FROM gpu_access_requests r
                   JOIN allocations a ON a.id=r.allocation_id
                   WHERE r.owner_user_id=? ORDER BY r.created_at DESC LIMIT 100""",
                (session["user_id"],),
            ).fetchall()
        self.json_response(200, {"ok": True, "access_requests": [access_request_dict(row) for row in rows]})

    def cancel_access_request(self, request_id: str) -> None:
        session = self.session(csrf=True)
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                item = connection.execute("SELECT * FROM gpu_access_requests WHERE id=?", (request_id,)).fetchone()
                if not item or item["owner_user_id"] != session["user_id"]:
                    raise ApiError(404, "预约申请不存在", "access_request_not_found")
                if item["status"] not in ("pending_admin", "coordinating"):
                    raise ApiError(409, "当前状态不能取消预约", "access_request_not_cancellable")
                updated = now_iso()
                connection.execute(
                    "UPDATE gpu_access_requests SET status='cancelled',updated_at=? WHERE id=?",
                    (updated, request_id),
                )
                audit(connection, session["user_id"], "gpu_access_request", request_id, "gpu_access.cancelled", {
                    "order_id": item["order_id"], "allocation_id": item["allocation_id"],
                    "requested_hours": item["requested_hours"],
                })
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "request_id": request_id, "status": "cancelled"})

    def get_admin_access_requests(self) -> None:
        session = self.session()
        require_role(session, "admin")
        with db_connect() as connection:
            rows = connection.execute(
                """SELECT r.*,a.gpu,a.region,a.product_code,u.name AS buyer_name,u.account AS buyer_account
                   FROM gpu_access_requests r JOIN allocations a ON a.id=r.allocation_id
                   JOIN users u ON u.id=r.owner_user_id
                   ORDER BY CASE r.status WHEN 'pending_admin' THEN 0 WHEN 'coordinating' THEN 1
                                WHEN 'ready' THEN 2 ELSE 3 END,r.booking_start_at LIMIT 200"""
            ).fetchall()
        self.json_response(200, {"ok": True, "access_requests": [access_request_dict(row, admin=True) for row in rows]})

    def admin_review_access_request(self, request_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        target = clean_text(data.get("status"), "处理状态", 4, 24)
        if target not in ("coordinating", "ready", "rejected", "completed"):
            raise ApiError(422, "处理状态无效", "invalid_access_status")
        note = str(data.get("admin_note") or "").strip()
        if len(note) > 500:
            raise ApiError(422, "管理员备注不能超过 500 字", "admin_note_too_long")
        management_url = None
        ssh_host = None
        ssh_port = None
        ssh_user = None
        if target == "rejected" and len(note) < 4:
            raise ApiError(422, "驳回时请填写至少 4 个字的原因", "rejection_reason_required")
        if target == "ready":
            ssh_host = clean_text(data.get("ssh_host"), "SSH 主机", 2, 255)
            if not re.fullmatch(r"[A-Za-z0-9.:-]+", ssh_host):
                raise ApiError(422, "SSH 主机格式无效", "invalid_ssh_host")
            try:
                ssh_port = int(data.get("ssh_port") or 22)
            except (TypeError, ValueError):
                raise ApiError(422, "SSH 端口无效", "invalid_ssh_port")
            if ssh_port < 1 or ssh_port > 65535:
                raise ApiError(422, "SSH 端口无效", "invalid_ssh_port")
            ssh_user = clean_text(data.get("ssh_user"), "SSH 用户名", 1, 32)
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]{0,31}", ssh_user):
                raise ApiError(422, "SSH 用户名格式无效", "invalid_ssh_user")
            management_url = str(data.get("management_url") or "").strip() or None
            if management_url:
                parsed_url = urlparse(management_url)
                if parsed_url.scheme != "https" or not parsed_url.netloc or len(management_url) > 500:
                    raise ApiError(422, "GPU 主机管理地址必须是有效的 HTTPS 地址", "invalid_management_url")
        transitions = {
            "pending_admin": {"coordinating", "ready", "rejected"},
            "coordinating": {"ready", "rejected"},
            "ready": {"completed", "coordinating"},
        }
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                item = connection.execute("SELECT * FROM gpu_access_requests WHERE id=?", (request_id,)).fetchone()
                if not item:
                    raise ApiError(404, "预约申请不存在", "access_request_not_found")
                if target not in transitions.get(item["status"], set()):
                    raise ApiError(409, "该预约不能变更为目标状态", "invalid_access_status_transition")
                updated = now_iso()
                reviewed_at = updated if target in ("ready", "rejected") else item["reviewed_at"]
                activated_at = updated if target == "ready" else item["activated_at"]
                completed_at = updated if target == "completed" else item["completed_at"]
                connection.execute(
                    """UPDATE gpu_access_requests SET status=?,admin_note=?,management_url=COALESCE(?,management_url),
                         ssh_host=COALESCE(?,ssh_host),ssh_port=COALESCE(?,ssh_port),ssh_user=COALESCE(?,ssh_user),
                         reviewer_user_id=?,reviewed_at=?,activated_at=?,completed_at=?,updated_at=? WHERE id=?""",
                    (target, note or item["admin_note"], management_url, ssh_host, ssh_port, ssh_user,
                     session["user_id"], reviewed_at, activated_at, completed_at, updated, request_id),
                )
                audit(connection, session["user_id"], "gpu_access_request", request_id,
                      f"gpu_access.{target}", {
                          "order_id": item["order_id"], "allocation_id": item["allocation_id"],
                          "booking_start_at": item["booking_start_at"], "booking_end_at": item["booking_end_at"],
                          "ssh_key_fingerprint": item["ssh_key_fingerprint"],
                          "connection_configured": target == "ready",
                      })
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            row = connection.execute(
                """SELECT r.*,a.gpu,a.region,a.product_code,u.name AS buyer_name,u.account AS buyer_account
                   FROM gpu_access_requests r JOIN allocations a ON a.id=r.allocation_id
                   JOIN users u ON u.id=r.owner_user_id WHERE r.id=?""",
                (request_id,),
            ).fetchone()
        self.json_response(200, {"ok": True, "access_request": access_request_dict(row, admin=True)})

    def get_assets(self) -> None:
        session = self.session()
        with db_connect() as connection:
            rows = connection.execute(
                """SELECT a.*,o.unit_price_cents, COALESCE((SELECT SUM(w.quantity) FROM withdrawal_requests w
                   WHERE w.allocation_id=a.id AND w.status IN ('scheduled','processing')),0) AS withdrawal_reserved,
                   COALESCE((SELECT SUM(r.requested_hours) FROM gpu_access_requests r
                   WHERE r.allocation_id=a.id AND r.status NOT IN ('rejected','cancelled')),0) AS access_reserved
                   FROM allocations a JOIN orders o ON o.id=a.order_id WHERE a.owner_user_id=? ORDER BY a.created_at DESC""",
                (session["user_id"],),
            ).fetchall()
        assets = [{
            "id": row["id"], "order_id": row["order_id"], "gpu": row["gpu"],
            "kind": row["kind"], "product_code": row["product_code"] or row["gpu"], "provider": row["provider"],
            "region": row["region"], "quantity": row["quantity"], "withdrawal_reserved": row["withdrawal_reserved"],
            "access_reserved": row["access_reserved"], "swap_reserved": row["swap_reserved"],
            "available_quantity": max(0, row["quantity"] - row["withdrawal_reserved"] - row["access_reserved"] - row["swap_reserved"]),
            "unit": row["unit"], "unit_price_cny": row["unit_price_cents"] / 100,
            "estimated_value_cny": round(max(0, row["quantity"] - row["withdrawal_reserved"] - row["access_reserved"] - row["swap_reserved"]) * row["unit_price_cents"] / 100, 2),
            "expiry": row["expires_at"][:10], "status": row["status"]
        } for row in rows]
        self.json_response(200, {"ok": True, "assets": assets})

    def get_card_hours(self) -> None:
        session = self.session()
        moment = now_iso()
        with db_connect() as connection:
            lots = connection.execute(
                """SELECT l.*,t.amount_cents,t.package_code,t.order_id
                   FROM card_hour_lots l JOIN card_hour_topups t ON t.id=l.topup_id
                   WHERE l.user_id=? ORDER BY l.expires_at,l.created_at""",
                (session["user_id"],),
            ).fetchall()
            topups = connection.execute(
                """SELECT t.*,o.order_no,p.status AS payment_status,p.checkout_url
                   FROM card_hour_topups t JOIN orders o ON o.id=t.order_id
                   LEFT JOIN payments p ON p.id=t.payment_id
                   WHERE t.user_id=? ORDER BY t.created_at DESC LIMIT 30""",
                (session["user_id"],),
            ).fetchall()
            movements = connection.execute(
                """SELECT id,movement_type,amount_micros,balance_after_micros,
                          reference_type,reference_id,created_at
                   FROM card_hour_movements WHERE user_id=?
                   ORDER BY created_at DESC,id DESC LIMIT 50""",
                (session["user_id"],),
            ).fetchall()
        active = [
            row for row in lots
            if row["status"] == "available" and row["expires_at"] > moment
        ]
        balance_micros = sum(int(row["available_micros"]) for row in active)
        self.json_response(200, {
            "ok": True,
            "account": {
                "id": session["user_id"],
                "name": session["name"],
            },
            "balance_micros": balance_micros,
            "balance_card_hours": balance_micros / CARD_HOUR_MICROS,
            "valid_days": CARD_HOUR_VALID_DAYS,
            "pricing": {
                "basis_amount_cents": CARD_HOUR_PRICE_NUMERATOR_CENTS,
                "basis_card_hours": CARD_HOUR_PRICE_DENOMINATOR_HOURS,
                "custom_min_cents": CARD_HOUR_TOPUP_MIN_CENTS,
                "custom_max_cents": CARD_HOUR_TOPUP_MAX_CENTS,
            },
            "packages": [
                {
                    "code": code,
                    "amount_cents": package["amount_cents"],
                    "amount_cny": package["amount_cents"] / 100,
                    "card_hours": package["card_hours_micros"] / CARD_HOUR_MICROS,
                }
                for code, package in CARD_HOUR_PACKAGES.items()
            ],
            "lots": [
                {
                    "id": row["id"],
                    "topup_id": row["topup_id"],
                    "available_micros": row["available_micros"],
                    "available_card_hours": row["available_micros"] / CARD_HOUR_MICROS,
                    "original_card_hours": row["original_micros"] / CARD_HOUR_MICROS,
                    "status": row["status"],
                    "expires_at": row["expires_at"],
                }
                for row in lots
            ],
            "movements": [
                {
                    **dict(row),
                    "amount_card_hours": row["amount_micros"] / CARD_HOUR_MICROS,
                    "balance_after_card_hours": row["balance_after_micros"] / CARD_HOUR_MICROS,
                }
                for row in movements
            ],
            "topups": [card_hour_topup_dict(row) for row in topups],
        })

    def create_card_hour_topup(self) -> None:
        session = self.session(csrf=True)
        self.rate_limit(f"card-hour-topup:{session['user_id']}", 12, 600)
        data = self.read_json()
        order_only = data.get("order_only") is True
        if order_only:
            if not APP_ORDER_ONLY_ENABLED:
                raise ApiError(
                    503,
                    "App 待支付订单当前保持关闭",
                    "app_order_only_disabled",
                )
        else:
            require_payment_creation_ready("alipay")
        idem = require_idempotency_key(self.headers)
        raw_package = str(data.get("package_code") or "").strip()
        package_code, amount_cents, card_hours_micros = card_hour_topup_amount(
            raw_package or None, data.get("amount_cents")
        )
        request_hash = hashlib.sha256(
            json.dumps(
                {
                    "package_code": package_code,
                    "amount_cents": amount_cents,
                    "card_hours_micros": card_hours_micros,
                    "order_only": order_only,
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        created = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute(
                    "SELECT * FROM card_hour_topups WHERE user_id=? AND idempotency_key=?",
                    (session["user_id"], idem),
                ).fetchone()
                if existing:
                    if existing["request_hash"] != request_hash:
                        raise ApiError(409, "幂等键已用于不同充值请求", "idempotency_conflict")
                    order = fetch_order(connection, existing["order_id"])
                    payment_policy = json.loads(
                        order["quote_snapshot_json"] or "{}"
                    ).get("payment_policy")
                    connection.execute("COMMIT")
                    return self.json_response(200, {
                        "ok": True,
                        "topup": card_hour_topup_dict(existing),
                        "order_id": order["id"],
                        "order_no": order["order_no"],
                        "checkout_deferred": payment_policy == "deferred_no_checkout",
                        "idempotent_replay": True,
                    })
                topup_id = uid("card_hour_topup")
                order_id = uid("ord")
                order_no = f"KAI-CH-{secrets.token_hex(6).upper()}"
                quantity = card_hours_micros / CARD_HOUR_MICROS
                reservation_expires_at = future_minutes_iso(ORDER_RESERVATION_MINUTES)
                snapshot = json.dumps({
                    "source": "card_hour_topup",
                    "topup_id": topup_id,
                    "package_code": package_code,
                    "amount_cents": amount_cents,
                    "card_hours_micros": card_hours_micros,
                    "valid_days": CARD_HOUR_VALID_DAYS,
                    "pricing_basis": {
                        "amount_cents": CARD_HOUR_PRICE_NUMERATOR_CENTS,
                        "card_hours": CARD_HOUR_PRICE_DENOMINATOR_HOURS,
                    },
                    "payment_policy": (
                        "deferred_no_checkout" if order_only else "checkout_allowed"
                    ),
                }, ensure_ascii=False, separators=(",", ":"))
                connection.execute(
                    """INSERT INTO orders(
                       id,order_no,buyer_user_id,listing_id,gpu,region,provider,quantity,unit,
                       unit_price_cents,amount_cents,currency,status,idempotency_key,quote_snapshot_json,
                       reservation_expires_at,created_at,updated_at,kind,product_code,settlement_mode
                       ) VALUES(?,?,?,?,?,?,?,?,?,0,?,'CNY','pending_payment',?,?,?,?,?,'card_hour_topup',?,'platform')""",
                    (
                        order_id, order_no, session["user_id"], CARD_HOUR_TOPUP_LISTING_ID,
                        "KAI-CARD-HOUR", "全区域", "CloudPay 卡时充值", quantity, "标准卡时",
                        amount_cents, f"card-hour:{idem}", snapshot, reservation_expires_at,
                        created, created, CARD_HOUR_TOPUP_PRODUCT_CODE,
                    ),
                )
                connection.execute(
                    """INSERT INTO card_hour_topups(
                       id,user_id,order_id,package_code,amount_cents,card_hours_micros,status,
                       idempotency_key,request_hash,created_at,updated_at
                       ) VALUES(?,?,?,?,?,?,'pending',?,?,?,?)""",
                    (
                        topup_id, session["user_id"], order_id, package_code, amount_cents,
                        card_hours_micros, idem, request_hash, created, created,
                    ),
                )
                audit(connection, session["user_id"], "card_hour_topup", topup_id, (
                    "card_hour.topup_order_deferred" if order_only
                    else "card_hour.topup_created"
                ), {
                    "order_id": order_id, "amount_cents": amount_cents,
                    "card_hours_micros": card_hours_micros, "package_code": package_code,
                    "reservation_expires_at": reservation_expires_at,
                    "payment_policy": "deferred_no_checkout" if order_only else "checkout_allowed",
                }, idempotency_key=idem)
                connection.execute("COMMIT")
            except Exception:
                if connection.in_transaction:
                    connection.execute("ROLLBACK")
                raise
        with db_connect() as connection:
            topup = connection.execute(
                "SELECT * FROM card_hour_topups WHERE id=?", (topup_id,)
            ).fetchone()
        self.json_response(201, {
            "ok": True,
            "topup": card_hour_topup_dict(topup),
            "order_id": order_id,
            "order_no": order_no,
            "checkout_deferred": order_only,
            "idempotent_replay": False,
        })

    def get_card_hour_topup_status(self, topup_id: str) -> None:
        session = self.session()
        self.rate_limit(f"card-hour-status:{session['user_id']}", 30, 60)
        with db_connect() as connection:
            topup = connection.execute(
                "SELECT * FROM card_hour_topups WHERE id=? AND user_id=?",
                (topup_id, session["user_id"]),
            ).fetchone()
            if not topup:
                raise ApiError(404, "充值单不存在", "card_hour_topup_not_found")
            order = fetch_order(connection, topup["order_id"])
            payment = connection.execute(
                "SELECT * FROM payments WHERE id=?", (topup["payment_id"],)
            ).fetchone() if topup["payment_id"] else None
        if (
            payment
            and payment["status"] in ("pending", "closed")
            and PAYMENT_GATEWAY == "qixiang"
            and PAYMENT_RECONCILIATION_ENABLED
        ):
            try:
                query_and_confirm_qixiang_payment(payment["id"])
            except ApiError as error:
                if error.code not in (
                    "qixiang_query_in_progress", "qixiang_query_rate_limited",
                    "qixiang_query_circuit_open", "qixiangpay_query_rejected",
                ):
                    raise
            with db_connect() as connection:
                topup = connection.execute(
                    "SELECT * FROM card_hour_topups WHERE id=?", (topup_id,)
                ).fetchone()
                order = fetch_order(connection, topup["order_id"])
                payment = connection.execute(
                    "SELECT * FROM payments WHERE id=?", (topup["payment_id"],)
                ).fetchone()
        self.json_response(200, {
            "ok": True,
            "topup": card_hour_topup_dict(topup),
            "order_status": order["status"],
            "payment_status": payment["status"] if payment else "not_created",
            "checkout_deferred": (
                json.loads(order["quote_snapshot_json"] or "{}").get("payment_policy")
                == "deferred_no_checkout"
            ),
            "confirmed": topup["status"] == "credited",
        })

    def get_recent_audit(self) -> None:
        session = self.session()
        with db_connect() as connection:
            rows = connection.execute(
                "SELECT event_id,aggregate_type,aggregate_id,event_type,created_at FROM audit_events WHERE actor_user_id=? OR aggregate_id IN (SELECT id FROM orders WHERE buyer_user_id=?) ORDER BY sequence DESC LIMIT 30",
                (session["user_id"], session["user_id"]),
            ).fetchall()
        self.json_response(200, {"ok": True, "events": [dict(row) for row in rows]})

    def serve_static(self, path: str) -> None:
        relative = "index.html" if path in ("", "/") else unquote(path).lstrip("/")
        candidate = (STATIC_ROOT / relative).resolve()
        if STATIC_ROOT not in candidate.parents and candidate != STATIC_ROOT:
            raise ApiError(403, "路径无效")
        if not candidate.is_file():
            raise ApiError(404, "页面不存在", "not_found")
        body = candidate.read_bytes()
        mime = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if mime.startswith("text/") or mime in ("application/javascript", "application/json"):
            mime += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store" if candidate.suffix in (".html", ".js") else "public, max-age=300")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    initialize_database()
    run_maintenance_cycle()
    stop_event = threading.Event()
    worker = threading.Thread(target=maintenance_worker, args=(stop_event,), name="kai-maintenance", daemon=True)
    worker.start()
    server = ThreadingHTTPServer((HOST, PORT), KaiHandler)
    print(f"KAI transaction service listening on http://{HOST}:{PORT} using {DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_event.set()
        server.server_close()


if __name__ == "__main__":
    main()
