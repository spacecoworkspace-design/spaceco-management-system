-- Seed products from the current hardcoded menu (index.html drinksMenuData /
-- snacksMenu, prices preserved exactly) plus placeholder SKUs covering the
-- rest of the categories called out in the POS redesign spec. This is a
-- starting set (~35 items), not the full 100+ SKU catalog — the manager
-- should refine names/prices/variants via the Product Catalog page before
-- rollout to cashiers.

INSERT INTO products (display_name, category, subcategory, sale_price, inventory_mode, stock_quantity, min_stock, unit, emoji) VALUES
-- Hot drinks (prepared — no stock auto-deduct, tracked via bulk containers later)
('Nescafe',            'hot_drinks', 'nescafe',   20, 'prepared', 0, 0, 'piece', '☕'),
('Espresso',           'hot_drinks', 'espresso',  25, 'prepared', 0, 0, 'piece', '☕'),
('Americano',          'hot_drinks', 'americano', 25, 'prepared', 0, 0, 'piece', '☕'),
('Double Shot',        'hot_drinks', 'espresso',  35, 'prepared', 0, 0, 'piece', '⚡'),
('Any with Milk',      'hot_drinks', 'milk',      45, 'prepared', 0, 0, 'piece', '🥛'),
('Tea',                'hot_drinks', 'tea',       15, 'prepared', 0, 0, 'piece', '🍵'),
('Green Mint',         'hot_drinks', 'tea',       15, 'prepared', 0, 0, 'piece', '🌿'),
('Anise',              'hot_drinks', 'tea',       15, 'prepared', 0, 0, 'piece', '🌾'),

-- Drinks (retail)
('Water',              'drinks', 'water',  10, 'retail', 30, 8, 'bottle', '💧'),
('Cola Regular',       'drinks', 'cola',   20, 'retail', 20, 5, 'can',    '🥤'),
('Cola Zero',          'drinks', 'cola',   20, 'retail', 20, 5, 'can',    '🥤'),
('Sprite',             'drinks', 'cola',   20, 'retail', 20, 5, 'can',    '🥤'),
('Fanta',              'drinks', 'cola',   20, 'retail', 20, 5, 'can',    '🥤'),
('Redbull',            'drinks', 'energy', 70, 'retail', 15, 4, 'can',    '⚡'),

-- Snacks (retail)
('Lays Cheese - Small',    'snacks', 'chips',      15, 'retail', 20, 5, 'piece', '🍟'),
('Lays Cheese - Large',    'snacks', 'chips',      20, 'retail', 20, 5, 'piece', '🍟'),
('Lays Chipsy - Small',    'snacks', 'chips',      15, 'retail', 20, 5, 'piece', '🍟'),
('Lays Chipsy - Large',    'snacks', 'chips',      20, 'retail', 20, 5, 'piece', '🍟'),
('Molto Cheese - 1pc',     'snacks', 'molto',      15, 'retail', 20, 5, 'piece', '🧀'),
('Molto Cheese - 2pc',     'snacks', 'molto',      20, 'retail', 20, 5, 'piece', '🧀'),
('Molto Beef - 1pc',       'snacks', 'molto',      15, 'retail', 20, 5, 'piece', '🥩'),
('Molto Beef - 2pc',       'snacks', 'molto',      20, 'retail', 20, 5, 'piece', '🥩'),
('Bake Rollz - Small',     'snacks', 'bake_rollz', 15, 'retail', 20, 5, 'piece', '🌯'),
('Bake Rollz - Large',     'snacks', 'bake_rollz', 20, 'retail', 20, 5, 'piece', '🌯'),
('Chocolate',              'snacks', 'chocolate',  20, 'retail', 20, 5, 'piece', '🍫'),
('Biscuits',               'snacks', 'biscuits',   15, 'retail', 20, 5, 'piece', '🍪'),
('Candy',                  'snacks', 'candy',      10, 'retail', 20, 5, 'piece', '🍬'),
('Sandwich',               'snacks', 'sandwich',   35, 'retail', 10, 3, 'piece', '🥪'),

-- Supplies (retail)
('Milk Bottle',        'supplies', 'milk',    25, 'retail', 10, 3, 'bottle', '🥛'),
('Tissue Pack',        'supplies', 'tissues', 10, 'retail', 20, 5, 'pack',   '🧻'),

-- Printing (retail — priced per sheet)
('Black & White Print', 'printing', 'bw',     2, 'retail', 500, 100, 'sheet', '🖨️'),
('Color Print',         'printing', 'color',  5, 'retail', 200, 50,  'sheet', '🖨️'),

-- Stationery (retail)
('Pen',                'stationery', NULL, 10, 'retail', 20, 5, 'piece', '✏️'),
('Notebook',            'stationery', NULL, 30, 'retail', 10, 3, 'piece', '📓');
