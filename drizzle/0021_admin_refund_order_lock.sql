CREATE TRIGGER IF NOT EXISTS admin_refund_executions_order_processing_insert_guard
BEFORE INSERT ON admin_refund_executions
WHEN NEW.status='PROCESSING' AND EXISTS (
  SELECT 1 FROM admin_refund_executions
  WHERE order_id=NEW.order_id AND status='PROCESSING'
)
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER IF NOT EXISTS admin_refund_executions_order_processing_update_guard
BEFORE UPDATE OF order_id,status ON admin_refund_executions
WHEN NEW.status='PROCESSING' AND EXISTS (
  SELECT 1 FROM admin_refund_executions
  WHERE order_id=NEW.order_id
    AND refund_case_id<>OLD.refund_case_id
    AND status='PROCESSING'
)
BEGIN
  SELECT RAISE(IGNORE);
END;
