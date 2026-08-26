#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import http.client
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class PaymentReconciliationActionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "kai-test.db"
        os.environ["KAI_DB_PATH"] = str(self.db_path)
        os.environ["KAI_PAYMENT_RECONCILIATION_ENABLED"] = "false"
        sys.path.insert(0, str(ROOT))
        spec = importlib.util.spec_from_file_location(
            f"kai_reconciliation_action_test_{id(self)}", ROOT / "server.py"
        )
        assert spec and spec.loader
        self.server = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.server)
        self.server.initialize_database()
        self.admin_id = "usr_review_admin"
        self.buyer_id = "usr_review_buyer"
        self.supplier_id = "usr_review_supplier"
        self.listing_id = "lst_review_test"
        self.payment_id = "pay_review_test"
        self.order_id = "ord_review_test"
        self.insert_review_fixture()

    def tearDown(self) -> None:
        if str(ROOT) in sys.path:
            sys.path.remove(str(ROOT))
        self.temp_dir.cleanup()

    def insert_review_fixture(self) -> None:
        created = self.server.now_iso()
        stale = (
            datetime.now(timezone.utc) - timedelta(hours=7)
        ).replace(microsecond=0).isoformat()
        with self.server.db_connect() as connection:
            connection.execute(
                """INSERT INTO users(
                     id,name,account,password_hash,role,enterprise_status,created_at,updated_at
                   ) VALUES(?,?,?,?, 'admin','verified',?,?)""",
                (
                    self.admin_id,
                    "Review Admin",
                    "review-admin@kai.test",
                    self.server.hash_password("unused-admin-password"),
                    created,
                    created,
                ),
            )
            connection.execute(
                """INSERT INTO users(
                     id,name,account,password_hash,role,enterprise_status,created_at,updated_at
                   ) VALUES(?,?,?,?, 'supplier','certified',?,?)""",
                (
                    self.supplier_id,
                    "Review Supplier",
                    "review-supplier@kai.test",
                    self.server.hash_password("unused-supplier-password"),
                    created,
                    created,
                ),
            )
            connection.execute(
                """INSERT INTO listings(
                     id,supplier_user_id,kind,product_code,gpu,provider,region,unit,
                     unit_price_cents,verified_quantity,status,valid_from,valid_until,
                     created_at,updated_at
                   ) VALUES(?,?,'gpu','NVIDIA H100 80GB','H100','KAI 已验资源池',
                            '北京','GPU 时',300,100,'active',?,?,?,?)""",
                (
                    self.listing_id,
                    self.supplier_id,
                    created,
                    self.server.future_iso(24),
                    created,
                    created,
                ),
            )
            connection.execute(
                """INSERT INTO users(
                     id,name,account,password_hash,role,enterprise_status,created_at,updated_at
                   ) VALUES(?,?,?,?, 'buyer','verified',?,?)""",
                (
                    self.buyer_id,
                    "Review Buyer",
                    "review-buyer@kai.test",
                    self.server.hash_password("unused-buyer-password"),
                    created,
                    created,
                ),
            )
            connection.execute(
                """INSERT INTO orders(
                     id,order_no,buyer_user_id,listing_id,gpu,region,provider,
                     quantity,unit,unit_price_cents,amount_cents,currency,status,
                     idempotency_key,created_at,updated_at
                   ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    self.order_id,
                    "KAI-REVIEW-TEST",
                    self.buyer_id,
                    self.listing_id,
                    "H100",
                    "北京",
                    "KAI 已验资源池",
                    1.0,
                    "GPU 时",
                    300,
                    300,
                    "CNY",
                    "expired",
                    "order-review-test-idem",
                    created,
                    created,
                ),
            )
            connection.execute(
                """INSERT INTO payments(
                     id,order_id,provider,amount_cents,currency,status,created_at,updated_at,
                     gateway,provider_status,last_checked_at,query_attempts,idempotency_key,
                     request_hash,checkout_state
                   ) VALUES(?,?,?,?,?,'closed',?,?,?,?,?,?,?,?,?)""",
                (
                    self.payment_id,
                    self.order_id,
                    "alipay",
                    300,
                    "CNY",
                    created,
                    created,
                    "qixiang",
                    "0",
                    stale,
                    1414,
                    "payment-review-test-idem",
                    "request-hash",
                    "uncertain",
                ),
            )
            connection.execute(
                """INSERT INTO payment_reconciliation_reviews(
                     payment_id,reason,provider_status,query_attempts,status,version,
                     first_flagged_at,last_checked_at,updated_at
                   ) VALUES(?, 'provider_nonterminal_after_attempt_threshold', '0',
                            1414, 'open', 1, ?, ?, ?)""",
                (self.payment_id, created, stale, created),
            )

    def row(self, sql: str, parameters=()) -> sqlite3.Row | None:
        with self.server.db_connect() as connection:
            return connection.execute(sql, parameters).fetchone()

    def table_snapshot(self, table: str) -> list[tuple]:
        with self.server.db_connect() as connection:
            return [tuple(row) for row in connection.execute(f"SELECT * FROM {table}")]

    def create_session(self, user_id: str, raw_token: str, csrf: str) -> None:
        with self.server.db_connect() as connection:
            connection.execute(
                """INSERT INTO sessions(
                     token_hash,user_id,csrf_token,expires_at,created_at
                   ) VALUES(?,?,?,?,?)""",
                (
                    self.server.token_hash(raw_token),
                    user_id,
                    csrf,
                    self.server.future_iso(1),
                    self.server.now_iso(),
                ),
            )

    def http_post(
        self,
        port: int,
        *,
        cookie: str = "",
        csrf: str = "",
        idempotency_key: str = "review-http-idem-0001",
        reason: str = "已完成七相权威查单，状态仍为 0，继续后台监控晚到账",
    ) -> tuple[int, dict]:
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        encoded = json.dumps(
            {
                "action": "acknowledge_monitoring",
                "reason": reason,
            }
        ).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Content-Length": str(len(encoded)),
            "Idempotency-Key": idempotency_key,
        }
        if cookie:
            headers["Cookie"] = f"kai_session={cookie}"
        if csrf:
            headers["X-KAI-CSRF"] = csrf
        connection.request(
            "POST",
            f"/api/admin/payment-reconciliation-reviews/{self.payment_id}/action",
            body=encoded,
            headers=headers,
        )
        response = connection.getresponse()
        payload = json.loads(response.read())
        connection.close()
        return response.status, payload

    def acknowledge(self, idempotency_key: str = "review-ack-idem-0001"):
        return self.server.apply_payment_reconciliation_action(
            payment_id=self.payment_id,
            actor_user_id=self.admin_id,
            action="acknowledge_monitoring",
            reason="已通过七相权威查单核验，状态仍为 0，继续后台监控晚到账",
            idempotency_key=idempotency_key,
            evidence_digest="a" * 64,
        )

    def test_acknowledge_is_append_only_and_changes_no_economic_state(self) -> None:
        economic_tables = (
            "orders",
            "card_hour_topups",
            "card_hour_lots",
            "card_hour_movements",
            "settlements",
            "refunds",
        )
        before = {table: self.table_snapshot(table) for table in economic_tables}

        review, replayed = self.acknowledge()

        self.assertFalse(replayed)
        self.assertEqual(review["status"], "acknowledged_monitoring")
        self.assertEqual(review["version"], 2)
        self.assertEqual(review["evidence_digest"], "a" * 64)
        self.assertEqual(
            {table: self.table_snapshot(table) for table in economic_tables},
            before,
        )
        action = self.row(
            "SELECT * FROM payment_reconciliation_review_actions WHERE payment_id=?",
            (self.payment_id,),
        )
        self.assertEqual(action["action"], "acknowledge_monitoring")
        self.assertEqual(action["old_version"], 1)
        self.assertEqual(action["new_version"], 2)
        audit = self.row(
            """SELECT event_id,event_type FROM audit_events
               WHERE aggregate_type='payment_reconciliation_review'
                 AND aggregate_id=?""",
            (self.payment_id,),
        )
        self.assertEqual(
            audit["event_type"],
            "payment.reconciliation_monitoring_acknowledged",
        )
        with self.assertRaises(sqlite3.IntegrityError):
            with self.server.db_connect() as connection:
                connection.execute(
                    "UPDATE payment_reconciliation_review_actions SET reason='changed'"
                )
        with self.assertRaises(sqlite3.IntegrityError):
            with self.server.db_connect() as connection:
                connection.execute(
                    "UPDATE audit_events SET payload_json='{}' WHERE event_id=?",
                    (audit["event_id"],),
                )
        with self.assertRaises(sqlite3.IntegrityError):
            with self.server.db_connect() as connection:
                connection.execute(
                    "DELETE FROM audit_events WHERE aggregate_id=?",
                    (self.payment_id,),
                )

    def test_admin_action_endpoint_enforces_auth_role_and_csrf(self) -> None:
        admin_token = "admin-session-token"
        buyer_token = "buyer-session-token"
        admin_csrf = "admin-csrf-token"
        buyer_csrf = "buyer-csrf-token"
        self.create_session(self.admin_id, admin_token, admin_csrf)
        self.create_session(self.buyer_id, buyer_token, buyer_csrf)
        original = {
            "PAYMENT_GATEWAY": self.server.PAYMENT_GATEWAY,
            "PAYMENT_RECONCILIATION_ENABLED": self.server.PAYMENT_RECONCILIATION_ENABLED,
            "QIXIANG_PID": self.server.QIXIANG_PID,
            "qixiang_query_order": self.server.qixiang_query_order,
        }
        http_server = self.server.ThreadingHTTPServer(
            ("127.0.0.1", 0), self.server.KaiHandler
        )
        server_thread = threading.Thread(target=http_server.serve_forever, daemon=True)
        provider_queries: list[str] = []
        try:
            self.server.PAYMENT_GATEWAY = "qixiang"
            self.server.PAYMENT_RECONCILIATION_ENABLED = True
            self.server.QIXIANG_PID = "4611"
            def pending_query(_config, **_kwargs):
                provider_queries.append(self.payment_id)
                return {
                    "pid": "4611",
                    "out_trade_no": self.payment_id,
                    "trade_no": "provider-pending-test",
                    "type": "alipay",
                    "money": "3.00",
                    "status": "0",
                    "addtime": "2026-08-22 08:00:00",
                    "endtime": "",
                }

            self.server.qixiang_query_order = pending_query
            server_thread.start()

            status, payload = self.http_post(http_server.server_port)
            self.assertEqual(status, 401, payload)
            status, payload = self.http_post(
                http_server.server_port,
                cookie=buyer_token,
                csrf=buyer_csrf,
            )
            self.assertEqual(status, 403, payload)
            status, payload = self.http_post(
                http_server.server_port,
                cookie=admin_token,
            )
            self.assertEqual(status, 403, payload)
            status, payload = self.http_post(
                http_server.server_port,
                cookie=admin_token,
                csrf=admin_csrf,
            )
            self.assertEqual(status, 200, payload)
            self.assertEqual(payload["review"]["status"], "acknowledged_monitoring")
            self.assertTrue(payload["monitoring_continues"])
            self.assertEqual(provider_queries, [self.payment_id])

            status, payload = self.http_post(
                http_server.server_port,
                cookie=admin_token,
                csrf=admin_csrf,
            )
            self.assertEqual(status, 200, payload)
            self.assertTrue(payload["idempotent_replay"])
            self.assertEqual(provider_queries, [self.payment_id])

            before_actions = self.row(
                "SELECT COUNT(*) AS count FROM payment_reconciliation_review_actions"
            )["count"]
            before_audits = self.row(
                """SELECT COUNT(*) AS count FROM audit_events
                   WHERE aggregate_type='payment_reconciliation_review'"""
            )["count"]
            status, payload = self.http_post(
                http_server.server_port,
                cookie=admin_token,
                csrf=admin_csrf,
                reason="同一幂等键不得接受已经变更的人工审核说明",
            )
            self.assertEqual(status, 409, payload)
            self.assertEqual(
                payload["error"]["code"],
                "payment_review_idempotency_conflict",
            )
            self.assertEqual(provider_queries, [self.payment_id])
            self.assertEqual(
                self.row(
                    "SELECT COUNT(*) AS count FROM payment_reconciliation_review_actions"
                )["count"],
                before_actions,
            )
            self.assertEqual(
                self.row(
                    """SELECT COUNT(*) AS count FROM audit_events
                       WHERE aggregate_type='payment_reconciliation_review'"""
                )["count"],
                before_audits,
            )
        finally:
            http_server.shutdown()
            http_server.server_close()
            server_thread.join(timeout=5)
            for name, value in original.items():
                setattr(self.server, name, value)

    def test_acknowledgement_is_idempotent(self) -> None:
        first, first_replay = self.acknowledge()
        second, second_replay = self.acknowledge()

        self.assertFalse(first_replay)
        self.assertTrue(second_replay)
        self.assertEqual(first["version"], second["version"])
        self.assertEqual(
            self.row(
                "SELECT COUNT(*) AS count FROM payment_reconciliation_review_actions"
            )["count"],
            1,
        )

    def test_same_idempotency_with_changed_reason_is_conflict(self) -> None:
        self.acknowledge()
        before_actions = self.table_snapshot(
            "payment_reconciliation_review_actions"
        )
        with self.assertRaises(self.server.ApiError) as raised:
            self.server.apply_payment_reconciliation_action(
                payment_id=self.payment_id,
                actor_user_id=self.admin_id,
                action="acknowledge_monitoring",
                reason="同一幂等键改成了另一段审核说明",
                idempotency_key="review-ack-idem-0001",
                evidence_digest="b" * 64,
            )
        self.assertEqual(
            raised.exception.code,
            "payment_review_idempotency_conflict",
        )
        self.assertEqual(
            self.table_snapshot("payment_reconciliation_review_actions"),
            before_actions,
        )

    def test_command_claim_covers_processing_completed_and_request_conflict(self) -> None:
        kwargs = {
            "payment_id": self.payment_id,
            "actor_user_id": self.admin_id,
            "action": "acknowledge_monitoring",
            "reason": "同一审核命令必须在外呼前完成幂等占位",
            "idempotency_key": "review-command-idem-0001",
        }
        first = self.server.claim_payment_reconciliation_command(**kwargs)
        self.assertEqual(first["state"], "claimed")
        concurrent = self.server.claim_payment_reconciliation_command(**kwargs)
        self.assertEqual(concurrent["state"], "processing")

        with self.assertRaises(self.server.ApiError) as raised:
            self.server.claim_payment_reconciliation_command(
                **(kwargs | {"reason": "相同幂等键但请求说明已经改变"})
            )
        self.assertEqual(
            raised.exception.code,
            "payment_review_idempotency_conflict",
        )
        response = {
            "ok": True,
            "action": "payment_success_confirmed",
            "idempotent_replay": False,
        }
        self.server.complete_payment_reconciliation_command(
            actor_user_id=self.admin_id,
            idempotency_key=kwargs["idempotency_key"],
            lease_token=first["lease_token"],
            response_status=200,
            response=response,
        )
        replay = self.server.claim_payment_reconciliation_command(**kwargs)
        self.assertEqual(replay["state"], "completed")
        self.assertEqual(replay["response"], response)
        with self.assertRaises(sqlite3.IntegrityError):
            with self.server.db_connect() as connection:
                connection.execute(
                    """UPDATE payment_reconciliation_commands
                       SET response_json='{}'
                       WHERE actor_user_id=? AND idempotency_key=?""",
                    (self.admin_id, kwargs["idempotency_key"]),
                )

    def test_open_review_blocks_new_payment_until_acknowledged(self) -> None:
        original = {
            "ALLOW_DEMO": self.server.ALLOW_DEMO,
            "PAYMENT_CREATE_ENABLED": self.server.PAYMENT_CREATE_ENABLED,
            "payment_readiness": self.server.payment_readiness,
            "release_compliance_ready": self.server.release_compliance_ready,
            "payment_worker_ready": self.server.payment_worker_ready,
        }
        try:
            self.server.ALLOW_DEMO = False
            self.server.PAYMENT_CREATE_ENABLED = True
            self.server.payment_readiness = lambda _provider: {
                "creation_configured": True
            }
            self.server.release_compliance_ready = lambda: True
            self.server.payment_worker_ready = lambda: True
            with self.assertRaises(self.server.ApiError) as raised:
                self.server.require_payment_creation_ready("alipay")
            self.assertEqual(
                raised.exception.code,
                "payment_manual_review_required",
            )
            self.acknowledge()
            self.server.require_payment_creation_ready("alipay")
        finally:
            for name, value in original.items():
                setattr(self.server, name, value)

    def test_paid_http_result_is_persisted_and_replayed_without_second_query(self) -> None:
        admin_token = "admin-paid-session-token"
        admin_csrf = "admin-paid-csrf-token"
        self.create_session(self.admin_id, admin_token, admin_csrf)
        original = {
            "PAYMENT_GATEWAY": self.server.PAYMENT_GATEWAY,
            "PAYMENT_RECONCILIATION_ENABLED": self.server.PAYMENT_RECONCILIATION_ENABLED,
            "QIXIANG_PID": self.server.QIXIANG_PID,
            "qixiang_query_order": self.server.qixiang_query_order,
        }
        http_server = self.server.ThreadingHTTPServer(
            ("127.0.0.1", 0), self.server.KaiHandler
        )
        server_thread = threading.Thread(target=http_server.serve_forever, daemon=True)
        provider_queries: list[str] = []
        try:
            self.server.PAYMENT_GATEWAY = "qixiang"
            self.server.PAYMENT_RECONCILIATION_ENABLED = True
            self.server.QIXIANG_PID = "4611"

            def paid_query(_config, **_kwargs):
                provider_queries.append(self.payment_id)
                return {
                    "pid": "4611",
                    "out_trade_no": self.payment_id,
                    "trade_no": "provider-paid-idempotency-test",
                    "type": "alipay",
                    "money": "3.00",
                    "status": "1",
                    "addtime": "2026-08-22 08:00:00",
                    "endtime": "2026-08-22 08:01:00",
                }

            self.server.qixiang_query_order = paid_query
            server_thread.start()
            status, payload = self.http_post(
                http_server.server_port,
                cookie=admin_token,
                csrf=admin_csrf,
                idempotency_key="review-paid-http-idem-0001",
            )
            self.assertEqual(status, 200, payload)
            self.assertEqual(payload["action"], "payment_success_confirmed")
            self.assertFalse(payload["idempotent_replay"])
            self.assertEqual(provider_queries, [self.payment_id])
            command = self.row(
                """SELECT state,response_status,response_json
                   FROM payment_reconciliation_commands
                   WHERE actor_user_id=? AND idempotency_key=?""",
                (self.admin_id, "review-paid-http-idem-0001"),
            )
            self.assertEqual(command["state"], "completed")

            status, payload = self.http_post(
                http_server.server_port,
                cookie=admin_token,
                csrf=admin_csrf,
                idempotency_key="review-paid-http-idem-0001",
            )
            self.assertEqual(status, 200, payload)
            self.assertEqual(payload["action"], "payment_success_confirmed")
            self.assertTrue(payload["idempotent_replay"])
            self.assertEqual(provider_queries, [self.payment_id])
        finally:
            http_server.shutdown()
            http_server.server_close()
            server_thread.join(timeout=5)
            for name, value in original.items():
                setattr(self.server, name, value)

    def test_concurrent_http_same_command_waits_and_replays_one_provider_query(self) -> None:
        admin_token = "admin-concurrent-session-token"
        admin_csrf = "admin-concurrent-csrf-token"
        self.create_session(self.admin_id, admin_token, admin_csrf)
        original = {
            "PAYMENT_GATEWAY": self.server.PAYMENT_GATEWAY,
            "PAYMENT_RECONCILIATION_ENABLED": self.server.PAYMENT_RECONCILIATION_ENABLED,
            "QIXIANG_PID": self.server.QIXIANG_PID,
            "qixiang_query_order": self.server.qixiang_query_order,
        }
        http_server = self.server.ThreadingHTTPServer(
            ("127.0.0.1", 0), self.server.KaiHandler
        )
        server_thread = threading.Thread(target=http_server.serve_forever, daemon=True)
        provider_entered = threading.Event()
        provider_release = threading.Event()
        provider_queries: list[str] = []
        responses: list[tuple[int, dict]] = []
        errors: list[Exception] = []
        try:
            self.server.PAYMENT_GATEWAY = "qixiang"
            self.server.PAYMENT_RECONCILIATION_ENABLED = True
            self.server.QIXIANG_PID = "4611"

            def pending_query(_config, **_kwargs):
                provider_queries.append(self.payment_id)
                provider_entered.set()
                if not provider_release.wait(timeout=5):
                    raise RuntimeError("provider release timeout")
                return {
                    "pid": "4611",
                    "out_trade_no": self.payment_id,
                    "trade_no": "provider-concurrent-pending-test",
                    "type": "alipay",
                    "money": "3.00",
                    "status": "0",
                    "addtime": "2026-08-22 08:00:00",
                    "endtime": "",
                }

            self.server.qixiang_query_order = pending_query
            server_thread.start()

            def request() -> None:
                try:
                    responses.append(
                        self.http_post(
                            http_server.server_port,
                            cookie=admin_token,
                            csrf=admin_csrf,
                            idempotency_key="review-http-concurrent-0001",
                        )
                    )
                except Exception as error:  # pragma: no cover - surfaced below
                    errors.append(error)

            first = threading.Thread(target=request)
            second = threading.Thread(target=request)
            first.start()
            self.assertTrue(provider_entered.wait(timeout=5))
            second.start()
            time.sleep(0.1)
            provider_release.set()
            first.join(timeout=10)
            second.join(timeout=10)

            self.assertEqual(errors, [])
            self.assertEqual([status for status, _ in responses], [200, 200])
            self.assertEqual(
                sorted(payload["idempotent_replay"] for _, payload in responses),
                [False, True],
            )
            self.assertEqual(provider_queries, [self.payment_id])
        finally:
            provider_release.set()
            http_server.shutdown()
            http_server.server_close()
            server_thread.join(timeout=5)
            for name, value in original.items():
                setattr(self.server, name, value)

    def test_concurrent_same_idempotency_creates_one_action(self) -> None:
        barrier = threading.Barrier(2)
        results: list[tuple[int, bool]] = []
        errors: list[Exception] = []

        def run() -> None:
            try:
                barrier.wait(timeout=5)
                review, replayed = self.acknowledge("review-ack-concurrent-0001")
                results.append((int(review["version"]), replayed))
            except Exception as error:  # pragma: no cover - surfaced below
                errors.append(error)

        threads = [threading.Thread(target=run) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)

        self.assertEqual(errors, [])
        self.assertEqual(sorted(results), [(2, False), (2, True)])
        self.assertEqual(
            self.row(
                "SELECT COUNT(*) AS count FROM payment_reconciliation_review_actions"
            )["count"],
            1,
        )

    def test_status_zero_cannot_be_resolved_as_terminal_unpaid(self) -> None:
        with self.assertRaises(self.server.ApiError) as raised:
            self.server.apply_payment_reconciliation_action(
                payment_id=self.payment_id,
                actor_user_id=self.admin_id,
                action="resolve_terminal_unpaid",
                reason="错误地把状态 0 当作未支付终态",
                idempotency_key="review-terminal-idem-0001",
                evidence_digest="b" * 64,
            )
        self.assertEqual(raised.exception.code, "payment_review_action_not_allowed")
        self.assertEqual(
            self.row(
                "SELECT status FROM payment_reconciliation_reviews WHERE payment_id=?",
                (self.payment_id,),
            )["status"],
            "open",
        )

    def test_missing_authoritative_query_digest_writes_nothing(self) -> None:
        before = self.table_snapshot("payment_reconciliation_reviews")
        with self.assertRaises(self.server.ApiError) as raised:
            self.server.apply_payment_reconciliation_action(
                payment_id=self.payment_id,
                actor_user_id=self.admin_id,
                action="acknowledge_monitoring",
                reason="查单失败时不允许确认继续监控",
                idempotency_key="review-no-evidence-0001",
            )
        self.assertEqual(
            raised.exception.code,
            "payment_review_provider_evidence_required",
        )
        self.assertEqual(
            self.table_snapshot("payment_reconciliation_reviews"),
            before,
        )
        self.assertEqual(
            self.row(
                "SELECT COUNT(*) AS count FROM payment_reconciliation_review_actions"
            )["count"],
            0,
        )

    def test_acknowledged_review_stays_in_long_tail_reconciliation(self) -> None:
        self.acknowledge()
        original = {
            "PAYMENT_GATEWAY": self.server.PAYMENT_GATEWAY,
            "PAYMENT_RECONCILIATION_ENABLED": self.server.PAYMENT_RECONCILIATION_ENABLED,
            "payment_readiness": self.server.payment_readiness,
            "query_and_confirm_qixiang_payment": self.server.query_and_confirm_qixiang_payment,
        }
        attempted: list[str] = []
        try:
            self.server.PAYMENT_GATEWAY = "qixiang"
            self.server.PAYMENT_RECONCILIATION_ENABLED = True
            self.server.payment_readiness = lambda _provider: {"configured": True}
            self.server.query_and_confirm_qixiang_payment = (
                lambda payment_id: attempted.append(payment_id) or (None, False)
            )
            result = self.server.reconcile_pending_qixiang_payments()
        finally:
            for name, value in original.items():
                setattr(self.server, name, value)

        self.assertEqual(attempted, [self.payment_id])
        self.assertEqual(result["attempted"], 1)
        self.assertEqual(result["manual_review"], 1)

    def test_reopen_is_versioned_and_audited(self) -> None:
        self.acknowledge()
        review, replayed = self.server.apply_payment_reconciliation_action(
            payment_id=self.payment_id,
            actor_user_id=self.admin_id,
            action="reopen",
            reason="运营复核发现需要重新进入待处理队列",
            idempotency_key="review-reopen-idem-0001",
        )
        self.assertFalse(replayed)
        self.assertEqual(review["status"], "open")
        self.assertEqual(review["version"], 3)
        self.assertIsNone(review["acknowledged_at"])
        self.assertEqual(
            self.row(
                "SELECT COUNT(*) AS count FROM payment_reconciliation_review_actions"
            )["count"],
            2,
        )

    def test_late_success_after_acknowledgement_still_closes_review_and_refunds(self) -> None:
        self.acknowledge()
        secret = "test-callback-secret"
        payload = {
            "event_id": "qixiang_late_success_test",
            "payment_id": self.payment_id,
            "order_id": self.order_id,
            "provider_txn_id": "qixiang-provider-late-success-test",
            "merchant_id": "KAI-MOCK",
            "amount_cents": 300,
            "currency": "CNY",
            "status": "SUCCESS",
            "timestamp": int(time.time()),
        }
        with self.server.db_connect() as connection:
            self.server.apply_payment_callback(
                connection,
                "alipay",
                payload,
                self.server.sign_payment(payload, secret),
                secret,
            )

        review = self.row(
            "SELECT * FROM payment_reconciliation_reviews WHERE payment_id=?",
            (self.payment_id,),
        )
        payment = self.row("SELECT * FROM payments WHERE id=?", (self.payment_id,))
        order = self.row("SELECT * FROM orders WHERE id=?", (self.order_id,))
        refund = self.row("SELECT * FROM refunds WHERE payment_id=?", (self.payment_id,))
        self.assertEqual(review["status"], "resolved")
        self.assertEqual(review["resolution"], "payment_success")
        self.assertEqual(payment["status"], "success")
        self.assertEqual(order["status"], "refund_pending")
        self.assertEqual(refund["status"], "pending_review")


if __name__ == "__main__":
    unittest.main()
