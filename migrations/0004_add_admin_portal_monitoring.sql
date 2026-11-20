PRAGMA foreign_keys = ON;

CREATE TABLE shipment_delivery_issue_resolutions (
  id TEXT PRIMARY KEY NOT NULL,
  issue_id TEXT NOT NULL UNIQUE REFERENCES shipment_delivery_issues(id) ON DELETE RESTRICT,
  resolved_by_staff_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE RESTRICT,
  resolution_note TEXT NOT NULL,
  resolved_at TEXT NOT NULL
);

CREATE INDEX idx_issue_resolutions_staff_time
  ON shipment_delivery_issue_resolutions(resolved_by_staff_id, resolved_at DESC);

CREATE INDEX idx_delivery_issues_occurred_at
  ON shipment_delivery_issues(occurred_at DESC);

CREATE INDEX idx_delivery_issues_type_time
  ON shipment_delivery_issues(issue_type, occurred_at DESC);

CREATE TRIGGER issue_resolutions_prevent_update
BEFORE UPDATE ON shipment_delivery_issue_resolutions
BEGIN
  SELECT RAISE(ABORT, 'shipment delivery issue resolutions are append-only');
END;

CREATE TRIGGER issue_resolutions_prevent_delete
BEFORE DELETE ON shipment_delivery_issue_resolutions
BEGIN
  SELECT RAISE(ABORT, 'shipment delivery issue resolutions are append-only');
END;
