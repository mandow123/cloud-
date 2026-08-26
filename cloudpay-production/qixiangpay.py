"""Small, dependency-free client for the QixiangPay (易支付兼容) gateway.

The module deliberately knows nothing about CloudPay's database.  It only
normalises money, signs/verifies gateway parameters and performs the documented
checkout, order-query and refund HTTP calls.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


MAX_RESPONSE_BYTES = 1_048_576


class QixiangPayError(Exception):
    """Safe provider error suitable for translation at the application edge."""

    def __init__(self, message: str, code: str = "qixiangpay_error"):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class QixiangPayConfig:
    pid: str
    key: str
    checkout_url: str = "https://api.payqixiang.cn/mapi.php"
    api_url: str = "https://api.payqixiang.cn/api.php"
    timeout_seconds: int = 12
    allow_insecure_http: bool = False
    checkout_hosts: tuple[str, ...] = ("api.payqixiang.cn",)

    def validate(self) -> None:
        if not self.pid or not self.key:
            raise QixiangPayError("七相支付商户号或密钥未配置", "qixiangpay_not_configured")
        for label, endpoint in (("统一下单", self.checkout_url), ("订单接口", self.api_url)):
            parsed = urlparse(endpoint)
            valid_scheme = parsed.scheme == "https" or (
                self.allow_insecure_http and parsed.scheme == "http"
            )
            if not valid_scheme or not parsed.netloc:
                raise QixiangPayError(f"七相支付{label}地址无效", "invalid_qixiangpay_endpoint")
        if self.timeout_seconds < 1 or self.timeout_seconds > 60:
            raise QixiangPayError("七相支付请求超时配置无效", "invalid_qixiangpay_timeout")


def _string_params(params: Mapping[str, object]) -> dict[str, str]:
    return {str(key): str(value) for key, value in params.items() if value is not None}


def canonical_string(params: Mapping[str, object]) -> str:
    """Build the ASCII-key-sorted string documented by QixiangPay."""
    values = _string_params(params)
    return "&".join(
        f"{key}={values[key]}"
        for key in sorted(values)
        if key not in ("sign", "sign_type") and values[key] != ""
    )


def sign_params(params: Mapping[str, object], key: str) -> str:
    if not key:
        raise QixiangPayError("七相支付密钥未配置", "qixiangpay_not_configured")
    source = (canonical_string(params) + key).encode("utf-8")
    return hashlib.md5(source).hexdigest()  # nosec B324 - provider protocol requires MD5


def verify_signature(params: Mapping[str, object], key: str) -> bool:
    import hmac

    supplied = str(params.get("sign") or "").strip().lower()
    if len(supplied) != 32 or any(char not in "0123456789abcdef" for char in supplied):
        return False
    return hmac.compare_digest(sign_params(params, key), supplied)


def cents_to_money(cents: int) -> str:
    if isinstance(cents, bool) or not isinstance(cents, int) or cents <= 0:
        raise QixiangPayError("支付金额必须大于 0", "invalid_payment_amount")
    return f"{Decimal(cents) / Decimal(100):.2f}"


def money_to_cents(value: object) -> int:
    text = str(value or "").strip()
    try:
        amount = Decimal(text)
    except InvalidOperation:
        raise QixiangPayError("支付机构返回的金额无效", "invalid_provider_amount")
    quantized = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if amount != quantized or quantized <= 0:
        raise QixiangPayError("支付机构返回的金额无效", "invalid_provider_amount")
    return int(quantized * 100)


def build_signed_params(params: Mapping[str, object], key: str) -> dict[str, str]:
    result = _string_params(params)
    result["sign"] = sign_params(result, key)
    result["sign_type"] = "MD5"
    return result


def _request_json(
    request: Request,
    timeout_seconds: int,
    opener: Callable[..., object] = urlopen,
) -> dict:
    try:
        with opener(request, timeout=timeout_seconds) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        raise QixiangPayError("七相支付网关暂时不可用", "qixiangpay_unavailable") from error
    if len(raw) > MAX_RESPONSE_BYTES:
        raise QixiangPayError("七相支付响应过大", "qixiangpay_response_too_large")
    try:
        result = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise QixiangPayError("七相支付返回了无效数据", "invalid_qixiangpay_response") from error
    if not isinstance(result, dict):
        raise QixiangPayError("七相支付返回了无效数据", "invalid_qixiangpay_response")
    return result


def create_checkout(
    config: QixiangPayConfig,
    *,
    payment_type: str,
    out_trade_no: str,
    notify_url: str,
    return_url: str,
    subject: str,
    amount_cents: int,
    client_ip: str,
    device: str = "jump",
    param: str = "",
    opener: Callable[..., object] = urlopen,
) -> dict:
    config.validate()
    if payment_type not in ("alipay", "wxpay"):
        raise QixiangPayError("七相支付方式无效", "invalid_qixiangpay_type")
    if device not in ("pc", "mobile", "wechat", "jump"):
        raise QixiangPayError("七相支付设备类型无效", "invalid_qixiangpay_device")
    params = build_signed_params({
        "pid": config.pid,
        "type": payment_type,
        "out_trade_no": out_trade_no,
        "notify_url": notify_url,
        "return_url": return_url,
        "name": subject.encode("utf-8")[:127].decode("utf-8", errors="ignore"),
        "money": cents_to_money(amount_cents),
        "clientip": client_ip or "127.0.0.1",
        "device": device,
        "param": param,
    }, config.key)
    request = Request(
        config.checkout_url,
        data=urlencode(params).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            "Accept": "application/json",
            "User-Agent": "KAI-CloudPay/1.0",
        },
    )
    result = _request_json(request, config.timeout_seconds, opener)
    if str(result.get("code")) != "1":
        raise QixiangPayError(
            str(result.get("msg") or "七相支付未接受本次下单"),
            "qixiangpay_checkout_rejected",
        )
    checkout_url = str(result.get("payurl") or result.get("qrcode") or "").strip()
    parsed = urlparse(checkout_url)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port is not None
        or parsed.params
        or parsed.query
        or parsed.fragment
        or not re.fullmatch(r"/pay/submit/\d{8,32}/", parsed.path)
    ):
        raise QixiangPayError("七相支付返回的收银台地址无效", "invalid_checkout_url")
    if config.checkout_hosts and parsed.hostname not in config.checkout_hosts:
        raise QixiangPayError("七相支付返回了未授权的收银台域名", "untrusted_checkout_host")
    trade_no = str(result.get("trade_no") or "").strip()
    return {"checkout_url": checkout_url, "trade_no": trade_no, "raw_code": "1"}


def query_order(
    config: QixiangPayConfig,
    *,
    out_trade_no: str = "",
    trade_no: str = "",
    opener: Callable[..., object] = urlopen,
) -> dict:
    config.validate()
    if not out_trade_no and not trade_no:
        raise QixiangPayError("查询订单号不能为空", "missing_qixiangpay_order_number")
    params = {"act": "order", "pid": config.pid, "key": config.key}
    if trade_no:
        params["trade_no"] = trade_no
    else:
        params["out_trade_no"] = out_trade_no
    separator = "&" if "?" in config.api_url else "?"
    request = Request(
        config.api_url + separator + urlencode(params),
        method="GET",
        headers={"Accept": "application/json", "User-Agent": "KAI-CloudPay/1.0"},
    )
    result = _request_json(request, config.timeout_seconds, opener)
    if str(result.get("code")) != "1":
        raise QixiangPayError(
            str(result.get("msg") or "七相支付查单失败"),
            "qixiangpay_query_rejected",
        )
    return result


def query_merchant(
    config: QixiangPayConfig,
    *,
    opener: Callable[..., object] = urlopen,
) -> dict:
    config.validate()
    params = {"act": "query", "pid": config.pid, "key": config.key}
    separator = "&" if "?" in config.api_url else "?"
    request = Request(
        config.api_url + separator + urlencode(params),
        method="GET",
        headers={"Accept": "application/json", "User-Agent": "KAI-CloudPay/1.0"},
    )
    result = _request_json(request, config.timeout_seconds, opener)
    if str(result.get("code")) != "1":
        message = str(result.get("msg") or "").strip()
        # The live Qixiang endpoint currently returns this exact pair for an
        # invalidated credential.  Do not broaden it: all other failures may be
        # throttling, account suspension, maintenance, or an undocumented
        # provider condition and therefore cannot prove key revocation.
        error_code = (
            "qixiangpay_merchant_key_invalid"
            if str(result.get("code")) == "-3" and message == "商户密钥错误"
            else "qixiangpay_merchant_query_rejected"
        )
        raise QixiangPayError(
            message or "七相支付商户验证失败",
            error_code,
        )
    if str(result.get("pid") or "") != config.pid:
        raise QixiangPayError("七相支付返回的商户号不匹配", "qixiangpay_merchant_mismatch")
    return {
        "pid": config.pid,
        "active": str(result.get("active") or "0") == "1",
        "fee_balance": str(result.get("money") or "0.00"),
        "orders": int(result.get("orders") or 0),
        "orders_today": int(result.get("order_today") or 0),
    }


def refund_order(
    config: QixiangPayConfig,
    *,
    amount_cents: int,
    out_trade_no: str = "",
    trade_no: str = "",
    opener: Callable[..., object] = urlopen,
) -> dict:
    config.validate()
    if not out_trade_no and not trade_no:
        raise QixiangPayError("退款订单号不能为空", "missing_qixiangpay_order_number")
    params = {
        "pid": config.pid,
        "key": config.key,
        "money": cents_to_money(amount_cents),
    }
    if trade_no:
        params["trade_no"] = trade_no
    else:
        params["out_trade_no"] = out_trade_no
    request = Request(
        config.api_url + ("&" if "?" in config.api_url else "?") + "act=refund",
        data=urlencode(params).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            "Accept": "application/json",
            "User-Agent": "KAI-CloudPay/1.0",
        },
    )
    result = _request_json(request, config.timeout_seconds, opener)
    # The legacy protocol documents code=1 as success for create/query.
    # Refunds remain disabled in production; if enabled later, fail closed on
    # every other value instead of interpreting an ambiguous code=0 as paid.
    if str(result.get("code")) != "1":
        raise QixiangPayError(
            str(result.get("msg") or "七相支付未接受退款"),
            "qixiangpay_refund_rejected",
        )
    return {
        "status": "SUCCESS",
        "provider_ref": str(result.get("refund_no") or result.get("trade_no") or trade_no or out_trade_no),
        "message": str(result.get("msg") or "退款成功"),
    }
