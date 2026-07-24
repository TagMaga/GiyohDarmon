-- +goose Up
-- +goose StatementBegin

-- Public self-service worker onboarding (giyohdarmon.tj/new). An applicant
-- submits this form unauthenticated and sets their own password; the row is
-- purely a holding area until an owner reviews it — see internal/onboarding.
-- Approving promotes it into a real users row (internal/users.Service.
-- CreateWithPasswordHash, reusing the password hash set at submission time
-- rather than re-collecting/re-hashing a plaintext password). Rejecting
-- deletes the row outright, so status only ever needs "pending"/"approved"
-- (no "rejected" value — see internal/onboarding.Service.Reject).
CREATE TABLE worker_applications (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone             VARCHAR(20)  NOT NULL,
    email             VARCHAR(255),
    password_hash     VARCHAR(255) NOT NULL,
    full_name         VARCHAR(255) NOT NULL,
    surname           VARCHAR(255),
    desired_position  VARCHAR(255),
    date_of_birth     DATE,
    address           TEXT,
    status            VARCHAR(20)  NOT NULL DEFAULT 'pending', -- "pending" | "approved"
    reviewed_by       UUID REFERENCES users(id),
    reviewed_at       TIMESTAMPTZ,
    created_user_id   UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Prevents the same phone number from queuing up multiple pending
-- applications at once; once approved (or rejected+deleted) the phone frees
-- up again for a fresh application.
CREATE UNIQUE INDEX uq_worker_applications_phone_pending ON worker_applications (phone) WHERE status = 'pending';
CREATE INDEX idx_worker_applications_status ON worker_applications (status);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS worker_applications;
-- +goose StatementEnd
