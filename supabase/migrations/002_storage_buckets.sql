-- 002_storage_buckets.sql
-- Configurazione Bucket Supabase Storage e Policy di sicurezza

-- Creazione del bucket per le immagini dei preventivi (privato)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'quote-attachments',
    'quote-attachments',
    false,
    5242880, -- 5 MB massimo per immagine (come da specifica)
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Creazione del bucket per i loghi e asset dell'utente
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'business-assets',
    'business-assets',
    true,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];

-- Policy per quote-attachments: accesso consentito solo se il path inizia con user_id dell'utente autenticato
CREATE POLICY "Users can upload their own quote attachments"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'quote-attachments' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can view their own quote attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'quote-attachments' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete their own quote attachments"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'quote-attachments' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy per business-assets
CREATE POLICY "Users can manage their business assets"
ON storage.objects FOR ALL
TO authenticated
USING (
    bucket_id = 'business-assets' AND
    (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
    bucket_id = 'business-assets' AND
    (storage.foldername(name))[1] = auth.uid()::text
);
