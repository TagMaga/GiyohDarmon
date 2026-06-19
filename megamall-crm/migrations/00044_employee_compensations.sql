-- +goose Up
-- +goose StatementBegin
CREATE TYPE compensation_kind AS ENUM ('percent', 'fixed', 'mixed', 'none');

CREATE TABLE employee_compensations (
    id                UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID             NOT NULL REFERENCES users(id),
    compensation_type compensation_kind NOT NULL,
    commission_rate   NUMERIC(6,5),          -- for percent/mixed (decimal 0-1)
    fixed_salary      NUMERIC(12,2),          -- monthly fixed, in currency below
    currency          VARCHAR(10)      NOT NULL DEFAULT 'TJS',
    effective_from    TIMESTAMPTZ      NOT NULL,
    effective_to      TIMESTAMPTZ,            -- NULL = currently active
    is_active         BOOLEAN          NOT NULL DEFAULT TRUE,
    notes             TEXT             NOT NULL DEFAULT '',
    created_by        UUID             REFERENCES users(id),
    created_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_emp_comp_user_active ON employee_compensations (user_id, effective_from DESC);
CREATE INDEX idx_emp_comp_active      ON employee_compensations (user_id) WHERE is_active = TRUE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS employee_compensations;
DROP TYPE IF EXISTS compensation_kind;
-- +goose StatementEnd
