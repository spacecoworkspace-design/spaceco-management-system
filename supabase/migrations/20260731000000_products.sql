-- Phase 1: Product Catalog + POS grid
-- Replaces the hardcoded snacksMenu/drinksMenuData KV blobs with a real,
-- manager-editable product catalog. Stock receiving, bulk containers, and
-- stock counts (weekly reconciliation) are deliberately left for a later
-- phase — this migration only covers what the Product Catalog + POS grid
-- need to function.

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('snacks','drinks','hot_drinks','supplies','printing','stationery')),
  subcategory TEXT,
  sale_price INT NOT NULL CHECK (sale_price >= 0),
  inventory_mode TEXT NOT NULL CHECK (inventory_mode IN ('retail','prepared')),
  stock_quantity INT NOT NULL DEFAULT 0,
  min_stock INT NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'piece',
  emoji TEXT,
  barcode TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_category_idx ON products (category);
CREATE INDEX IF NOT EXISTS products_active_idx ON products (is_active);

-- Same trust model as the rest of this app: the anon key is used directly
-- from the client (see spaceco_kv), so RLS is enabled with a permissive
-- policy rather than left wide open by default.
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products_select_anon" ON products FOR SELECT TO anon USING (true);
CREATE POLICY "products_insert_anon" ON products FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "products_update_anon" ON products FOR UPDATE TO anon USING (true) WITH CHECK (true);
