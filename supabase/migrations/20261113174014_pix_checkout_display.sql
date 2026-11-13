-- Configuração pública de recebimento Pix para o checkout.
ALTER TABLE public.public_store_settings
  ADD COLUMN IF NOT EXISTS pix_key text,
  ADD COLUMN IF NOT EXISTS pix_receiver_name text,
  ADD COLUMN IF NOT EXISTS pix_city text;

COMMENT ON COLUMN public.public_store_settings.pix_key IS 'Chave Pix exibida no checkout público.';
COMMENT ON COLUMN public.public_store_settings.pix_receiver_name IS 'Nome do beneficiário usado no BR Code Pix.';
COMMENT ON COLUMN public.public_store_settings.pix_city IS 'Cidade do beneficiário usada no BR Code Pix.';
