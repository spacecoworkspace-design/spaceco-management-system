-- WhatsApp integration (free wa.me click-to-chat flow, no paid Cloud API).
-- Logs every welcome-message / receipt send attempt for auditing.

CREATE TABLE IF NOT EXISTS whatsapp_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_phone TEXT NOT NULL,
  client_name TEXT,
  message_type TEXT NOT NULL CHECK (message_type IN ('welcome','receipt_text','receipt_pdf')),
  message_content TEXT,
  triggered_by TEXT,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','skipped')),
  session_id TEXT,
  pdf_url TEXT
);

CREATE INDEX IF NOT EXISTS whatsapp_logs_phone_idx ON whatsapp_logs (client_phone);

ALTER TABLE whatsapp_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_logs_select_anon" ON whatsapp_logs FOR SELECT TO anon USING (true);
CREATE POLICY "whatsapp_logs_insert_anon" ON whatsapp_logs FOR INSERT TO anon WITH CHECK (true);
