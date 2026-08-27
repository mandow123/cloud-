#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import http.client
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class AppOrderOnlyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        os.environ["KAI_DB_PATH"] = str(Path(self.temp_dir.name) / "kai-test.db")
        os.environ["KAI_APP_ORDER_ONLY_ENABLED"] = "true"
        os.environ["KAI_PAYMENT_CREATE_ENABLED"] = "false"
        os.environ["KAI_PAYMENT_RECONCILIATION_ENABLED"] = "false"
        os.environ["KAI_SEED_CATALOG"] = "true"
        sys.path.insert(0, str(ROOT))
        spec = importlib.util.spec_from_file_location(
            f"kai_app_order_test_{id(self)}", ROOT / "server.py"
        )
        assert spec and spec.loader
        self.server = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.server)
        self.server.initialize_database()
        self.user_id = "usr_app_order_buyer"
        self.session_token = "app-order-session-token"
        self.csrf = "app-order-csrf-token"
        created = self.server.now_iso()
        with self.server.db_connect() as connection:
            connection.execute(
                """INSERT INTO users(
                     id,name,account,password_hash,role,enterprise_status,created_at,updated_at
                   ) VALUES(?,?,?,?, 'buyer','verified',?,?)""",
                (
                    self.user_id,
                    "App Order Buyer",
                    "app-order-buyer@kai.test",
                    self.server.hash_password("unused-password"),
                    created,
                    created,
                ),
            )
            connection.execute(
                """INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at)
                   VALUES(?,?,?,?,?)""",
                (
                    self.server.token_hash(self.session_token),
                    self.user_id,
                    self.csrf,
                    self.server.future_iso(1),
                    created,
                ),
            )
        self.http_server = self.server.ThreadingHTTPServer(
            ("127.0.0.1", 0), self.server.KaiHandler
        )
        self.thread = threading.Thread(
            target=self.http_server.serve_forever,
            daemon=True,
        )
        self.thread.start()

    def tearDown(self) -> None:
        self.http_server.shutdown()
        self.http_server.server_close()
        self.thread.join(timeout=2)
        if str(ROOT) in sys.path:
            sys.path.remove(str(ROOT))
        self.temp_dir.cleanup()

    def post(self, path: str, payload: dict, idempotency_key: str) -> tuple[int, dict]:
        connection = http.client.HTTPConnection(
            "127.0.0.1", self.http_server.server_port, timeout=5
        )
        body = json.dumps(payload).encode()
        connection.request(
            "POST",
            path,
            body=body,
            headers={
                "Content-Type": "application/json",
                "Content-Length": str(len(body)),
                "Cookie": f"kai_session={self.session_token}",
                "X-KAI-CSRF": self.csrf,
                "Idempotency-Key": idempotency_key,
            },
        )
        response = connection.getresponse()
        decoded = json.loads(response.read())
        connection.close()
        return response.status, decoded

    def get(self, path: str) -> tuple[int, dict]:
        connection = http.client.HTTPConnection(
            "127.0.0.1", self.http_server.server_port, timeout=5
        )
        connection.request(
            "GET",
            path,
            headers={"Cookie": f"kai_session={self.session_token}"},
        )
        response = connection.getresponse()
        decoded = json.loads(response.read())
        connection.close()
        return response.status, decoded

    def test_order_only_topup_is_audited_and_cannot_create_payment(self) -> None:
        status, payload = self.post(
            "/api/card-hours/topups",
            {"package_code": "starter_5", "order_only": True},
            "app-order-topup-idem-0001",
        )
        self.assertEqual(status, 201, payload)
        self.assertTrue(payload["checkout_deferred"])
        topup_id = payload["topup"]["id"]
        order_id = payload["order_id"]
        with self.server.db_connect() as connection:
            payment_count = connection.execute(
                "SELECT COUNT(*) FROM payments WHERE order_id=?", (order_id,)
            ).fetchone()[0]
            event = connection.execute(
                """SELECT event_type,payload_json FROM audit_events
                   WHERE aggregate_type='card_hour_topup' AND aggregate_id=?""",
                (topup_id,),
            ).fetchone()
        self.assertEqual(payment_count, 0)
        self.assertEqual(event["event_type"], "card_hour.topup_order_deferred")
        self.assertEqual(
            json.loads(event["payload_json"])["payment_policy"],
            "deferred_no_checkout",
        )

        original_gate = self.server.require_payment_creation_ready
        self.server.require_payment_creation_ready = lambda _provider: None
        try:
            status, payload = self.post(
                "/api/payments/create",
                {
                    "order_id": order_id,
                    "provider": "alipay",
                    "channel": "wap",
                    "client_surface": "app",
                },
                "app-order-payment-idem-0001",
            )
        finally:
            self.server.require_payment_creation_ready = original_gate
        self.assertEqual(status, 409, payload)
        self.assertEqual(payload["error"]["code"], "payment_deferred_test_order")
        with self.server.db_connect() as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM payments WHERE order_id=?", (order_id,)
                ).fetchone()[0],
                0,
            )

    def test_order_only_resource_reservation_cannot_create_payment(self) -> None:
        with self.server.db_connect() as connection:
            listing = connection.execute(
                "SELECT id FROM listings WHERE status='active' ORDER BY id LIMIT 1"
            ).fetchone()
        self.assertIsNotNone(listing)
        status, payload = self.post(
            "/api/orders",
            {
                "listing_id": listing["id"],
                "quantity": 1,
                "order_only": True,
                "quote_snapshot": {"source": "kai_cloud_android_test_order"},
            },
            "app-order-resource-idem-0001",
        )
        self.assertEqual(status, 201, payload)
        self.assertTrue(payload["checkout_deferred"])
        order_id = payload["order"]["id"]
        with self.server.db_connect() as connection:
            order = connection.execute(
                "SELECT quote_snapshot_json FROM orders WHERE id=?", (order_id,)
            ).fetchone()
        self.assertEqual(
            json.loads(order["quote_snapshot_json"])["payment_policy"],
            "deferred_no_checkout",
        )

        original_gate = self.server.require_payment_creation_ready
        self.server.require_payment_creation_ready = lambda _provider: None
        try:
            status, payload = self.post(
                "/api/payments/create",
                {
                    "order_id": order_id,
                    "provider": "alipay",
                    "channel": "wap",
                    "client_surface": "app",
                },
                "app-order-resource-payment-idem-0001",
            )
        finally:
            self.server.require_payment_creation_ready = original_gate
        self.assertEqual(status, 409, payload)
        self.assertEqual(payload["error"]["code"], "payment_deferred_test_order")

    def test_card_hour_catalog_exposes_packages_custom_limits_and_validity(self) -> None:
        status, payload = self.get("/api/card-hours")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["valid_days"], 364)
        self.assertEqual(payload["pricing"]["custom_min_cents"], 100)
        self.assertEqual(payload["pricing"]["custom_max_cents"], 5_000_000)
        self.assertEqual(
            {item["code"] for item in payload["packages"]},
            {"starter_5", "standard_50", "pro_100", "business_500"},
        )

    def test_signed_callback_credits_once_and_expires_after_364_days(self) -> None:
        original_gate = self.server.require_payment_creation_ready
        self.server.require_payment_creation_ready = lambda _provider: None
        try:
            status, payload = self.post(
                "/api/card-hours/topups",
                {"package_code": "starter_5"},
                "card-hour-credit-topup-0001",
            )
        finally:
            self.server.require_payment_creation_ready = original_gate
        self.assertEqual(status, 201, payload)
        topup_id = payload["topup"]["id"]
        order_id = payload["order_id"]
        payment_id = "pay_card_hour_credit_test"
        created = self.server.now_iso()
        with self.server.db_connect() as connection:
            connection.execute(
                """INSERT INTO payments(
                     id,order_id,provider,amount_cents,currency,status,
                     created_at,updated_at,gateway,channel,checkout_state
                   ) VALUES(?,?, 'alipay',501,'CNY','pending',?,?,
                            'qixiang','wap','ready')""",
                (payment_id, order_id, created, created),
            )
            connection.execute(
                "UPDATE card_hour_topups SET payment_id=? WHERE id=?",
                (payment_id, topup_id),
            )

        secret = "isolated-test-signing-secret"
        callback = {
            "event_id": "evt_card_hour_credit_test",
            "payment_id": payment_id,
            "order_id": order_id,
            "provider_txn_id": "provider_card_hour_credit_test",
            "merchant_id": "KAI-MOCK",
            "amount_cents": 501,
            "currency": "CNY",
            "status": "SUCCESS",
            "timestamp": int(time.time()),
        }
        signature = self.server.sign_payment(callback, secret)
        with self.server.db_connect() as connection:
            self.server.apply_payment_callback(
                connection, "alipay", callback, signature, secret
            )
            self.server.apply_payment_callback(
                connection, "alipay", callback, signature, secret
            )
            topup = connection.execute(
                "SELECT * FROM card_hour_topups WHERE id=?", (topup_id,)
            ).fetchone()
            lot = connection.execute(
                "SELECT * FROM card_hour_lots WHERE topup_id=?", (topup_id,)
            ).fetchone()
            movements = connection.execute(
                "SELECT COUNT(*) FROM card_hour_movements WHERE topup_id=?",
                (topup_id,),
            ).fetchone()[0]
            payment = connection.execute(
                "SELECT status FROM payments WHERE id=?", (payment_id,)
            ).fetchone()
            order = connection.execute(
                "SELECT status FROM orders WHERE id=?", (order_id,)
            ).fetchone()

        self.assertEqual(topup["status"], "credited")
        self.assertEqual(payment["status"], "success")
        self.assertEqual(order["status"], "accepted")
        self.assertEqual(lot["status"], "available")
        self.assertEqual(lot["original_micros"], 5_000_000)
        self.assertEqual(lot["available_micros"], 5_000_000)
        self.assertEqual(movements, 1)
        credited_at = datetime.fromisoformat(topup["credited_at"])
        expires_at = datetime.fromisoformat(topup["expires_at"])
        self.assertEqual((expires_at - credited_at).days, 364)


if __name__ == "__main__":
    unittest.main()
