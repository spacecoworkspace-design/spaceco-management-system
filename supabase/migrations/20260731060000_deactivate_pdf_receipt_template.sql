-- PDF receipt option removed from the app (text-only receipts now).
-- Deactivate rather than delete, so the template text isn't lost if
-- this ever comes back.
UPDATE whatsapp_templates
SET is_active = false, is_default = false, updated_at = now()
WHERE template_key = 'checkout_receipt_pdf';
