-- Stock receiving (incoming orders) + bulk container tracking for
-- prepared-mode ingredients (Nescafe, sugar, milk, tea).

CREATE TABLE IF NOT EXISTS stock_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_by TEXT,
  total_value INT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS stock_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid REFERENCES stock_receipts(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  quantity INT NOT NULL,
  unit_cost INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bulk_containers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_name TEXT NOT NULL,
  container_size TEXT,
  opened_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'unopened' CHECK (status IN ('unopened','open','empty')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_receipt_items_receipt_idx ON stock_receipt_items (receipt_id);
CREATE INDEX IF NOT EXISTS bulk_containers_status_idx ON bulk_containers (status);

ALTER TABLE stock_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_containers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_receipts_select_anon" ON stock_receipts FOR SELECT TO anon USING (true);
CREATE POLICY "stock_receipts_insert_anon" ON stock_receipts FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "stock_receipt_items_select_anon" ON stock_receipt_items FOR SELECT TO anon USING (true);
CREATE POLICY "stock_receipt_items_insert_anon" ON stock_receipt_items FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "bulk_containers_select_anon" ON bulk_containers FOR SELECT TO anon USING (true);
CREATE POLICY "bulk_containers_insert_anon" ON bulk_containers FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "bulk_containers_update_anon" ON bulk_containers FOR UPDATE TO anon USING (true) WITH CHECK (true);
