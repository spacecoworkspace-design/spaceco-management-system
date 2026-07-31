-- Editable WhatsApp message templates, so wording can change without a
-- code deploy. {{variable}} tokens are rendered client-side at send time
-- (see renderTemplate() in index.html).

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL UNIQUE,
  template_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('checkin','checkout','marketing','alert')),
  message_body TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  variables_used TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS template_key TEXT REFERENCES whatsapp_templates(template_key);

ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_templates_select_anon" ON whatsapp_templates FOR SELECT TO anon USING (true);
CREATE POLICY "whatsapp_templates_insert_anon" ON whatsapp_templates FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "whatsapp_templates_update_anon" ON whatsapp_templates FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "whatsapp_templates_delete_anon" ON whatsapp_templates FOR DELETE TO anon USING (true);

-- Seed the 3 templates the app actually sends today, using {{business_*}}
-- and {{room_pricing}} tokens instead of hardcoded/placeholder text, plus
-- one inactive-by-default example (not wired to any trigger yet).
INSERT INTO whatsapp_templates (template_key, template_name, category, message_body, description, variables_used, is_default, is_active) VALUES
(
  'welcome_new_client',
  'Welcome - New Client',
  'checkin',
  'Welcome to Space-Co Workspace! 🚀

Here are our packages & pricing:

{{room_pricing}}

📦 Academy Packages:
• Custom hour packages available
• Ask our staff for details!

📍 Location: {{business_address}}
📞 Call us: {{business_phone}}
🕐 Hours: {{business_hours}}

We hope you enjoy your session! ☕',
  'Sent when a phone number with no prior visit is entered at check-in',
  ARRAY['{{business_address}}','{{business_phone}}','{{business_hours}}','{{room_pricing}}'],
  true,
  true
),
(
  'checkout_receipt_text',
  'Checkout Receipt - Text',
  'checkout',
  'Hi {{client_name}}, thanks for visiting Space-Co!

📅 Date: {{date}}
🏠 Room: {{room}}
⏱️ Duration: {{duration}}
💰 Room Cost: {{room_cost}} LE
☕ Drinks & Snacks: {{snacks_cost}} LE
🎯 Grand Total: {{total}} LE
💳 Paid via: {{payment_method}}

See you next time! 🌟
Space-Co Workspace',
  'Sent to returning clients after checkout, when they choose the text receipt',
  ARRAY['{{client_name}}','{{date}}','{{room}}','{{duration}}','{{room_cost}}','{{snacks_cost}}','{{total}}','{{payment_method}}'],
  true,
  true
),
(
  'checkout_receipt_pdf',
  'Checkout Receipt - PDF Link',
  'checkout',
  'Hi {{client_name}}, your receipt from Space-Co is ready!

📅 Date: {{date}}
💰 Total: {{total}} LE

Download receipt: {{pdf_url}}

Thank you! 🌟
Space-Co Workspace',
  'Sent to returning clients after checkout, when they choose the PDF receipt',
  ARRAY['{{client_name}}','{{date}}','{{total}}','{{pdf_url}}'],
  true,
  true
),
(
  'welcome_back_returning',
  'Welcome Back - Returning Client',
  'checkin',
  'Welcome back to Space-Co, {{client_name}}! 👋

Great to see you again. Your favorite room is waiting.

Need anything? Just ask our staff.

Enjoy your session! ☕',
  'Example template, not currently sent by any automatic trigger — available for future use',
  ARRAY['{{client_name}}'],
  false,
  true
)
ON CONFLICT (template_key) DO NOTHING;
