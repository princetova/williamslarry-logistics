PRAGMA foreign_keys = ON;

CREATE TABLE staff_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  access_subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Owner', 'Receptionist', 'Field Staff')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_subject TEXT NOT NULL,
  deactivated_at TEXT,
  deactivated_by_subject TEXT
);

CREATE INDEX idx_staff_accounts_role_active ON staff_accounts(role, active);
CREATE UNIQUE INDEX idx_staff_accounts_email_unique ON staff_accounts(lower(email));

ALTER TABLE shipments
  ADD COLUMN assigned_staff_id TEXT REFERENCES staff_accounts(id) ON DELETE RESTRICT;

CREATE INDEX idx_shipments_assigned_staff ON shipments(assigned_staff_id, updated_at DESC);

CREATE TABLE shipment_assignment_history (
  id TEXT PRIMARY KEY NOT NULL,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE RESTRICT,
  previous_staff_id TEXT REFERENCES staff_accounts(id) ON DELETE RESTRICT,
  assigned_staff_id TEXT REFERENCES staff_accounts(id) ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL,
  assigned_by_staff_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE RESTRICT,
  assigned_by_subject TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_assignment_history_shipment_time
  ON shipment_assignment_history(shipment_id, assigned_at);
CREATE INDEX idx_assignment_history_staff_time
  ON shipment_assignment_history(assigned_staff_id, assigned_at DESC);

ALTER TABLE administrative_audit_records ADD COLUMN actor_staff_id TEXT;
ALTER TABLE administrative_audit_records ADD COLUMN actor_role TEXT;

CREATE TRIGGER staff_access_subject_prevent_update
BEFORE UPDATE OF access_subject ON staff_accounts
BEGIN
  SELECT RAISE(ABORT, 'staff access subject is immutable');
END;

CREATE TRIGGER assignment_history_prevent_update
BEFORE UPDATE ON shipment_assignment_history
BEGIN
  SELECT RAISE(ABORT, 'shipment assignment history is append-only');
END;

CREATE TRIGGER assignment_history_prevent_delete
BEFORE DELETE ON shipment_assignment_history
BEGIN
  SELECT RAISE(ABORT, 'shipment assignment history is append-only');
END;
