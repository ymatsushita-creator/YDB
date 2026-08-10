ALTER TABLE partners
    ADD COLUMN photo_data_url text,
    ADD CONSTRAINT partners_photo_data_url_image
        CHECK (photo_data_url IS NULL OR photo_data_url ~ '^data:image/(jpeg|png|webp);base64,');
