-- +goose Up
-- +goose StatementBegin
-- Rejecting a prepayment (Service.RejectPrepayment) previously only flipped
-- orders.prepayment_status to 'rejected' without ever reversing
-- orders.prepayment_amount or marking the individual order_prepayments
-- rows — so a rejected prepayment claim permanently (and silently) reduced
-- what the courier was told to collect on delivery. These columns let the
-- fix mark exactly which rows were rejected (mirroring verified_by/
-- verified_at), so a later verification pass never mistakes an already-
-- rejected row for an outstanding one.
ALTER TABLE order_prepayments
    ADD COLUMN rejected_by uuid REFERENCES users(id),
    ADD COLUMN rejected_at timestamptz,
    ADD COLUMN rejection_reason text;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE order_prepayments
    DROP COLUMN rejected_by,
    DROP COLUMN rejected_at,
    DROP COLUMN rejection_reason;
-- +goose StatementEnd
