-- Storage bucket for PDF receipts, publicly readable (a receipt link sent
-- over WhatsApp has to be openable by the client without any auth).

INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "receipts_public_read" ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'receipts');

CREATE POLICY "receipts_anon_upload" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'receipts');
