-- Brew Beans Real Menu — Run this in Supabase SQL Editor
-- This will DELETE all existing menu items and insert the real menu

DELETE FROM menu_items;

INSERT INTO menu_items (name, category, description, price, image, is_available, is_popular) VALUES

-- HOT COFFEES
('Brew Espresso',                 'hot-coffee', 'Rich and bold espresso shot',                            300,  'https://images.unsplash.com/photo-1510591509098-f4fdc6d0ff04?w=400&q=80', true, false),
('Golden Beans Latte',            'hot-coffee', 'Smooth latte with golden aroma',                         440,  'https://images.unsplash.com/photo-1561047029-3000c68339ca?w=400&q=80', true, false),
('Cloud Brew Flat White Latte',   'hot-coffee', 'Creamy flat white with velvety microfoam',               435,  'https://images.unsplash.com/photo-1570968915860-54d5c301fa9f?w=400&q=80', true, false),
('Royal Beans Spanish Latte',     'hot-coffee', 'Our signature Spanish latte — a customer favourite',     450,  'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400&q=80', true, true),
('Caramel Brew Latte',            'hot-coffee', 'Rich espresso with sweet caramel drizzle',               470,  'https://images.unsplash.com/photo-1561047029-3000c68339ca?w=400&q=80', true, false),
('Beans Vanilla Latte',           'hot-coffee', 'Classic latte with a hint of vanilla',                   470,  'https://images.unsplash.com/photo-1570968915860-54d5c301fa9f?w=400&q=80', true, false),
('Roasted Beans Hazelnut Latte',  'hot-coffee', 'Bold roast with smooth hazelnut finish',                 470,  'https://images.unsplash.com/photo-1497515114629-f71d768fd07c?w=400&q=80', true, false),
('Emerald Brew Pistachio Latte',  'hot-coffee', 'Unique pistachio latte with earthy green notes',         540,  'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400&q=80', true, false),
('Dream Beans Tiramisu Latte',    'hot-coffee', 'Italian-inspired tiramisu flavoured latte',              470,  'https://images.unsplash.com/photo-1561047029-3000c68339ca?w=400&q=80', true, false),
('Bold Brew Americano',           'hot-coffee', 'Strong espresso diluted with hot water',                 495,  'https://images.unsplash.com/photo-1497515114629-f71d768fd07c?w=400&q=80', true, false),
('Classic Beans Hot Chocolate',   'hot-coffee', 'Rich and creamy hot chocolate',                          420,  'https://images.unsplash.com/photo-1542990253-a781e04ac2b8?w=400&q=80', true, false),
('Brew Pistachio Chocolate',      'hot-coffee', 'Luxurious pistachio hot chocolate blend',                520,  'https://images.unsplash.com/photo-1542990253-a781e04ac2b8?w=400&q=80', true, false),

-- COLD COFFEES
('Brew Iced Latte',               'cold-coffee', 'Classic iced latte, smooth and refreshing',             525,  'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=400&q=80', true, false),
('Iced Beans Spanish Latte',      'cold-coffee', 'Chilled version of our signature Spanish latte',        545,  'https://images.unsplash.com/photo-1460660416604-4954e4d2c594?w=400&q=80', true, false),
('Vanilla Brew Iced Latte',       'cold-coffee', 'Iced latte with smooth vanilla notes',                  575,  'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=400&q=80', true, false),
('French Vanilla Latte',          'cold-coffee', 'Rich French vanilla cold latte',                        575,  'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=400&q=80', true, false),
('Brewed Americano',              'cold-coffee', 'Chilled Americano over ice',                            520,  'https://images.unsplash.com/photo-1460660416604-4954e4d2c594?w=400&q=80', true, false),
('Creamy Brew Iced Cappuccino',   'cold-coffee', 'Creamy iced cappuccino with velvety foam',              530,  'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=400&q=80', true, false),
('Chocolate Beans Iced Latte',    'cold-coffee', 'Chocolatey iced latte for choco lovers',               585,  'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=400&q=80', true, false),
('Chill Brew Iced Chocolate',     'cold-coffee', 'Cold rich chocolate drink over ice',                   550,  'https://images.unsplash.com/photo-1534040385115-33dcb3acba5b?w=400&q=80', true, false),
('Tiramisu Beans Iced Delight',   'cold-coffee', 'Iced tiramisu-inspired coffee delight',                595,  'https://images.unsplash.com/photo-1460660416604-4954e4d2c594?w=400&q=80', true, false),
('Hazelnut Brewed Iced Latte',    'cold-coffee', 'Smooth iced latte with hazelnut flavour',              575,  'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=400&q=80', true, false),
('Caramel Beans Iced Macchiato',  'cold-coffee', 'Layered iced macchiato with caramel drizzle',          580,  'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=400&q=80', true, false),
('Pistachio Brew Iced Latte',     'cold-coffee', 'Earthy pistachio cold latte with a twist',             645,  'https://images.unsplash.com/photo-1534040385115-33dcb3acba5b?w=400&q=80', true, false),

-- FRAPPES
('Vanilla Beans Bliss',           'frappes', 'Classic vanilla frappe blended to perfection',              620,  'https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=400&q=80', true, false),
('Caramel Rush Brew',             'frappes', 'Caramel frappe with a coffee rush',                         630,  'https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=400&q=80', true, false),
('Strawberry Beans Bliss',        'frappes', 'Fruity strawberry frappe with cream',                       650,  'https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=400&q=80', true, false),
('Tiramisu Brew Frappe',          'frappes', 'Tiramisu-flavoured blended frappe',                         680,  'https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=400&q=80', true, false),
('Pistachio Cocoa Crush',         'frappes', 'Pistachio and cocoa blended frappe',                        695,  'https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=400&q=80', true, false),
('Lotus Frappe',                  'frappes', 'Trending lotus biscoff frappe — try it!',                   720,  'https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=400&q=80', true, true),
('Fresh Chill Mocha',             'frappes', 'Chilled mocha frappe with rich chocolate',                  635,  'https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=400&q=80', true, false),
('Roasted Hazelnut Frappe',       'frappes', 'Roasted hazelnut blended frappe',                           660,  'https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=400&q=80', true, false),
('Raspberry Frappe',              'frappes', 'Tangy raspberry frappe with whipped cream',                 680,  'https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=400&q=80', true, false),

-- SUMMER COOLERS
('Blue Lagoon Smash',             'summer-coolers', 'Refreshing blue lagoon mocktail',                    420,  'https://images.unsplash.com/photo-1544145945-f90425340c7e?w=400&q=80', true, false),
('Strawberry Lemonade',           'summer-coolers', 'Fresh strawberry and lemonade blend',                420,  'https://images.unsplash.com/photo-1523677011781-c91d1bbe2f9e?w=400&q=80', true, false),
('Peach Ice Tea',                 'summer-coolers', 'Sweet peach flavoured iced tea',                     420,  'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400&q=80', true, false),
('Raspberry Ice Tea',             'summer-coolers', 'Tangy raspberry iced tea',                           420,  'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400&q=80', true, false),

-- DESSERTS
('Chocolate Croissants',          'desserts', 'Flaky croissant with chocolate filling',                  420,  'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=400&q=80', true, false),
('Chocolate Chip Cookies',        'desserts', 'Classic homestyle chocolate chip cookies',                 350,  'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?w=400&q=80', true, true),
('Double Chocolate Cookies',      'desserts', 'Double chocolate indulgence in every bite',                350,  'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?w=400&q=80', true, false),
('Banana Bread',                  'desserts', 'Moist homemade banana bread slice',                        315,  'https://images.unsplash.com/photo-1588195538326-c5b1e9f80a1b?w=400&q=80', true, false);
