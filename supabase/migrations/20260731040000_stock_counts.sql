-- Weekly stock count reconciliation: expected (system) vs actual (physical
-- count) per retail product, with a generated variance column.

CREATE TABLE IF NOT EXISTS stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cashier TEXT,
  product_id uuid REFERENCES products(id),
  expected_stock INT NOT NULL,
  actual_stock INT NOT NULL,
  variance INT GENERATED ALWAYS AS (actual_stock - expected_stock) STORED,
  action_taken TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS stock_counts_product_idx ON stock_counts (product_id);
CREATE INDEX IF NOT EXISTS stock_counts_counted_at_idx ON stock_counts (counted_at);

ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_counts_select_anon" ON stock_counts FOR SELECT TO anon USING (true);
CREATE POLICY "stock_counts_insert_anon" ON stock_counts FOR INSERT TO anon WITH CHECK (true);
