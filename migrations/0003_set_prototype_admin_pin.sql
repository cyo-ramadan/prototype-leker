-- Prototype-only admin PIN reset.
-- SHA-256("123456") = 8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92
UPDATE store_settings
SET admin_pin_hash = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;
