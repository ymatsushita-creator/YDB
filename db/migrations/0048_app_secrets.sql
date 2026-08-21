-- ALL権限で登録する外部APIキー。平文は置かず、アプリ側のAES-GCM暗号文だけを持つ。
CREATE TABLE app_secrets (
    name          text        PRIMARY KEY,
    ciphertext    text        NOT NULL,
    iv            text        NOT NULL,
    auth_tag      text        NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_secrets_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT app_secrets_ciphertext_not_blank CHECK (btrim(ciphertext) <> ''),
    CONSTRAINT app_secrets_iv_not_blank CHECK (btrim(iv) <> ''),
    CONSTRAINT app_secrets_auth_tag_not_blank CHECK (btrim(auth_tag) <> '')
);

COMMENT ON TABLE app_secrets IS
  '外部サービスの秘密値。値はYOUTHDB_SESSION_SECRETから導いた鍵で暗号化し、画面へ復号値を返さない。';
