PRAGMA foreign_keys = ON;

CREATE TABLE shipments (
  id TEXT PRIMARY KEY NOT NULL,
  tracking_number TEXT NOT NULL UNIQUE,
  sender_name TEXT NOT NULL,
  sender_phone TEXT NOT NULL,
  receiver_name TEXT NOT NULL,
  receiver_phone TEXT NOT NULL,
  origin_address TEXT NOT NULL,
  origin_public TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  destination_public TEXT NOT NULL,
  item_description TEXT NOT NULL,
  public_item_summary TEXT NOT NULL,
  current_status TEXT NOT NULL DEFAULT 'Registered' CHECK (
    current_status IN (
      'Registered', 'Picked up', 'In transit', 'Arrived at destination',
      'Out for delivery', 'Delivered', 'Delayed', 'Cancelled', 'Returned'
    )
  ),
  estimated_delivery_date TEXT,
  internal_notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_shipments_tracking_number ON shipments(tracking_number);
CREATE INDEX idx_shipments_status ON shipments(current_status);
CREATE INDEX idx_shipments_created_at ON shipments(created_at DESC);
CREATE INDEX idx_shipments_updated_at ON shipments(updated_at DESC);

CREATE TABLE shipment_status_history (
  id TEXT PRIMARY KEY NOT NULL,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (
    status IN (
      'Registered', 'Picked up', 'In transit', 'Arrived at destination',
      'Out for delivery', 'Delivered', 'Delayed', 'Cancelled', 'Returned'
    )
  ),
  public_location TEXT NOT NULL DEFAULT '',
  public_note TEXT NOT NULL DEFAULT '',
  internal_note TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by_subject TEXT NOT NULL,
  created_by_email TEXT
);

CREATE INDEX idx_shipment_history_shipment_time
  ON shipment_status_history(shipment_id, occurred_at, created_at);

CREATE TABLE administrative_audit_records (
  id TEXT PRIMARY KEY NOT NULL,
  actor_subject TEXT NOT NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  request_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_admin_audit_resource
  ON administrative_audit_records(resource_type, resource_id, created_at DESC);
CREATE INDEX idx_admin_audit_actor
  ON administrative_audit_records(actor_subject, created_at DESC);

CREATE TRIGGER shipment_history_prevent_update
BEFORE UPDATE ON shipment_status_history
BEGIN
  SELECT RAISE(ABORT, 'shipment status history is append-only');
END;

CREATE TRIGGER shipment_history_prevent_delete
BEFORE DELETE ON shipment_status_history
BEGIN
  SELECT RAISE(ABORT, 'shipment status history is append-only');
END;

CREATE TRIGGER admin_audit_prevent_update
BEFORE UPDATE ON administrative_audit_records
BEGIN
  SELECT RAISE(ABORT, 'administrative audit records are append-only');
END;

CREATE TRIGGER admin_audit_prevent_delete
BEFORE DELETE ON administrative_audit_records
BEGIN
  SELECT RAISE(ABORT, 'administrative audit records are append-only');
END;
