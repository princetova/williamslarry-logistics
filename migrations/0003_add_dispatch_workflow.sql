PRAGMA foreign_keys = ON;

ALTER TABLE shipments ADD COLUMN assignment_sequence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shipments ADD COLUMN last_assignment_event_id TEXT;
ALTER TABLE shipments ADD COLUMN assignment_acknowledged_at TEXT;
ALTER TABLE shipments ADD COLUMN assignment_acknowledged_by_staff_id TEXT REFERENCES staff_accounts(id) ON DELETE RESTRICT;
ALTER TABLE shipments ADD COLUMN last_acknowledgement_event_id TEXT;
ALTER TABLE shipments ADD COLUMN last_status_event_id TEXT;
ALTER TABLE shipments ADD COLUMN last_issue_event_id TEXT;

UPDATE shipments SET
  assignment_sequence = (
    SELECT COUNT(*) FROM shipment_assignment_history
    WHERE shipment_assignment_history.shipment_id = shipments.id
  ),
  last_assignment_event_id = (
    SELECT id FROM shipment_assignment_history
    WHERE shipment_assignment_history.shipment_id = shipments.id
    ORDER BY assigned_at DESC, rowid DESC LIMIT 1
  ),
  last_status_event_id = (
    SELECT id FROM shipment_status_history
    WHERE shipment_status_history.shipment_id = shipments.id
    ORDER BY occurred_at DESC, created_at DESC LIMIT 1
  );

CREATE TABLE shipment_assignment_acknowledgements (
  id TEXT PRIMARY KEY NOT NULL,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE RESTRICT,
  assignment_event_id TEXT NOT NULL REFERENCES shipment_assignment_history(id) ON DELETE RESTRICT,
  staff_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE RESTRICT,
  acknowledged_at TEXT NOT NULL,
  UNIQUE(shipment_id, assignment_event_id)
);

CREATE INDEX idx_assignment_ack_staff_time
  ON shipment_assignment_acknowledgements(staff_id, acknowledged_at DESC);

CREATE TABLE shipment_delivery_issues (
  id TEXT PRIMARY KEY NOT NULL,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE RESTRICT,
  assignment_event_id TEXT NOT NULL REFERENCES shipment_assignment_history(id) ON DELETE RESTRICT,
  reported_by_staff_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE RESTRICT,
  issue_type TEXT NOT NULL CHECK (issue_type IN ('Delay', 'Delivery issue')),
  public_location TEXT NOT NULL DEFAULT '',
  public_note TEXT NOT NULL DEFAULT '',
  operational_note TEXT NOT NULL DEFAULT '',
  status_history_id TEXT REFERENCES shipment_status_history(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_delivery_issues_shipment_time
  ON shipment_delivery_issues(shipment_id, occurred_at DESC);
CREATE INDEX idx_delivery_issues_staff_time
  ON shipment_delivery_issues(reported_by_staff_id, occurred_at DESC);

CREATE TRIGGER assignment_ack_prevent_update
BEFORE UPDATE ON shipment_assignment_acknowledgements
BEGIN
  SELECT RAISE(ABORT, 'shipment assignment acknowledgements are append-only');
END;

CREATE TRIGGER assignment_ack_prevent_delete
BEFORE DELETE ON shipment_assignment_acknowledgements
BEGIN
  SELECT RAISE(ABORT, 'shipment assignment acknowledgements are append-only');
END;

CREATE TRIGGER delivery_issues_prevent_update
BEFORE UPDATE ON shipment_delivery_issues
BEGIN
  SELECT RAISE(ABORT, 'shipment delivery issues are append-only');
END;

CREATE TRIGGER delivery_issues_prevent_delete
BEFORE DELETE ON shipment_delivery_issues
BEGIN
  SELECT RAISE(ABORT, 'shipment delivery issues are append-only');
END;
