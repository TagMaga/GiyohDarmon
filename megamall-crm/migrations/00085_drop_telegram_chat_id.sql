-- +goose Up
-- +goose StatementBegin

-- telegram_chat_id was never wired to an actual Telegram bot/notification
-- flow anywhere in the app; it was only a stored, mostly-unset field that
-- ended up incorrectly required on courier profile edits. Drop it.
ALTER TABLE users DROP COLUMN IF EXISTS telegram_chat_id;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE users ADD COLUMN telegram_chat_id VARCHAR(100);
-- +goose StatementEnd
