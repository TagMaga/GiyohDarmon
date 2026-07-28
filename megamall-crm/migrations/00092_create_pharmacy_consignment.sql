-- +goose Up
-- +goose StatementBegin

-- Pharmacy consignment is intentionally kept in dedicated ledgers. The
-- existing inventory table remains the implicit main warehouse; accepted
-- invoices/returns maintain the physical pharmacy balance below.

CREATE TABLE pharmacies (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  VARCHAR(255) NOT NULL,
    address               TEXT NOT NULL,
    owner_name            VARCHAR(255) NOT NULL,
    owner_phone           VARCHAR(30) NOT NULL,
    contact_details       TEXT,
    comment               TEXT,
    responsible_seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    archived_at           TIMESTAMPTZ,
    archived_by           UUID REFERENCES users(id) ON DELETE RESTRICT,
    created_by            UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pharmacies_seller ON pharmacies(responsible_seller_id) WHERE archived_at IS NULL;
CREATE INDEX idx_pharmacies_active ON pharmacies(created_at DESC) WHERE archived_at IS NULL;

CREATE TABLE pharmacy_responsibility_history (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id        UUID NOT NULL REFERENCES pharmacies(id) ON DELETE RESTRICT,
    previous_seller_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    new_seller_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    changed_by         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    comment            TEXT,
    changed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pharmacy_responsibility_history ON pharmacy_responsibility_history(pharmacy_id, changed_at DESC);

CREATE TABLE pharmacy_invoices (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number        VARCHAR(40) NOT NULL UNIQUE,
    pharmacy_id           UUID NOT NULL REFERENCES pharmacies(id) ON DELETE RESTRICT,
    responsible_seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    manager_id            UUID REFERENCES users(id) ON DELETE RESTRICT,
    team_lead_id          UUID REFERENCES users(id) ON DELETE RESTRICT,
    status                VARCHAR(20) NOT NULL DEFAULT 'issued'
                          CHECK (status IN ('issued', 'accepted', 'rejected')),
    total_amount          NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
    paid_amount           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    returned_amount       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (returned_amount >= 0),
    comment               TEXT,
    rejection_reason      TEXT,
    created_by            UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    accepted_at           TIMESTAMPTZ,
    rejected_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pharmacy_invoices_pharmacy ON pharmacy_invoices(pharmacy_id, created_at DESC);
CREATE INDEX idx_pharmacy_invoices_seller ON pharmacy_invoices(responsible_seller_id, created_at DESC);
CREATE INDEX idx_pharmacy_invoices_status ON pharmacy_invoices(status, created_at DESC);

CREATE TABLE pharmacy_invoice_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id      UUID NOT NULL REFERENCES pharmacy_invoices(id) ON DELETE RESTRICT,
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    net_unit_price  NUMERIC(12,2) NOT NULL CHECK (net_unit_price >= 0),
    unit_cost       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    line_total      NUMERIC(14,2) NOT NULL CHECK (line_total >= 0),
    UNIQUE(invoice_id, product_id)
);
CREATE INDEX idx_pharmacy_invoice_items_product ON pharmacy_invoice_items(product_id);

CREATE TABLE pharmacy_financial_snapshots (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id             UUID NOT NULL UNIQUE REFERENCES pharmacy_invoices(id) ON DELETE RESTRICT,
    seller_rate            NUMERIC(6,5) NOT NULL,
    manager_team_rate      NUMERIC(6,5) NOT NULL,
    team_lead_pool_rate    NUMERIC(6,5) NOT NULL,
    company_rate           NUMERIC(6,5) NOT NULL,
    seller_config_id       UUID REFERENCES commission_configs(id) ON DELETE RESTRICT,
    manager_config_id      UUID REFERENCES commission_configs(id) ON DELETE RESTRICT,
    team_lead_config_id    UUID REFERENCES commission_configs(id) ON DELETE RESTRICT,
    company_config_id      UUID REFERENCES commission_configs(id) ON DELETE RESTRICT,
    snapshot_json          JSONB NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE pharmacy_stock (
    pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE RESTRICT,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity    INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(pharmacy_id, product_id)
);

CREATE TABLE pharmacy_payments (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_number        VARCHAR(40) NOT NULL UNIQUE,
    pharmacy_id           UUID NOT NULL REFERENCES pharmacies(id) ON DELETE RESTRICT,
    responsible_seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount                NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    method                VARCHAR(20) NOT NULL CHECK (method IN ('cash', 'cashless')),
    status                VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected', 'corrected')),
    comment               TEXT,
    rejection_reason      TEXT,
    created_by            UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    confirmed_by          UUID REFERENCES users(id) ON DELETE RESTRICT,
    confirmed_at          TIMESTAMPTZ,
    rejected_by           UUID REFERENCES users(id) ON DELETE RESTRICT,
    rejected_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pharmacy_payments_pharmacy ON pharmacy_payments(pharmacy_id, created_at DESC);
CREATE INDEX idx_pharmacy_payments_status ON pharmacy_payments(status, created_at DESC);

CREATE TABLE pharmacy_payment_edits (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id  UUID NOT NULL REFERENCES pharmacy_payments(id) ON DELETE RESTRICT,
    edited_by   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    old_amount  NUMERIC(14,2) NOT NULL,
    new_amount  NUMERIC(14,2) NOT NULL,
    old_method  VARCHAR(20) NOT NULL,
    new_method  VARCHAR(20) NOT NULL,
    old_comment TEXT,
    new_comment TEXT,
    edited_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pharmacy_payment_edits_payment ON pharmacy_payment_edits(payment_id, edited_at DESC);

CREATE TABLE pharmacy_payment_allocations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES pharmacy_payments(id) ON DELETE RESTRICT,
    invoice_id UUID REFERENCES pharmacy_invoices(id) ON DELETE RESTRICT,
    amount     NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    is_credit  BOOLEAN NOT NULL DEFAULT FALSE,
    reversed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pharmacy_payment_allocations_payment ON pharmacy_payment_allocations(payment_id);
CREATE INDEX idx_pharmacy_payment_allocations_invoice ON pharmacy_payment_allocations(invoice_id);

CREATE TABLE pharmacy_returns (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_number         VARCHAR(40) NOT NULL UNIQUE,
    pharmacy_id           UUID NOT NULL REFERENCES pharmacies(id) ON DELETE RESTRICT,
    responsible_seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status                VARCHAR(30) NOT NULL DEFAULT 'requested'
                          CHECK (status IN ('requested', 'accepted', 'partially_accepted', 'rejected')),
    reason                TEXT NOT NULL,
    rejection_reason      TEXT,
    created_by            UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    processed_by          UUID REFERENCES users(id) ON DELETE RESTRICT,
    processed_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pharmacy_returns_pharmacy ON pharmacy_returns(pharmacy_id, created_at DESC);

CREATE TABLE pharmacy_return_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id         UUID NOT NULL REFERENCES pharmacy_returns(id) ON DELETE RESTRICT,
    product_id        UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
    accepted_quantity INTEGER NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0),
    unit_debt_value   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_debt_value >= 0),
    returned_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (returned_amount >= 0),
    UNIQUE(return_id, product_id),
    CHECK (accepted_quantity <= requested_quantity)
);

CREATE TABLE pharmacy_return_allocations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_item_id UUID NOT NULL REFERENCES pharmacy_return_items(id) ON DELETE RESTRICT,
    invoice_id     UUID NOT NULL REFERENCES pharmacy_invoices(id) ON DELETE RESTRICT,
    quantity       INTEGER NOT NULL CHECK (quantity > 0),
    amount         NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pharmacy_return_allocations_item ON pharmacy_return_allocations(return_item_id);
CREATE INDEX idx_pharmacy_return_allocations_invoice ON pharmacy_return_allocations(invoice_id);

-- Immutable domain audit. Updates to business rows always append a companion event.
CREATE TABLE pharmacy_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE RESTRICT,
    entity_type VARCHAR(40) NOT NULL,
    entity_id   UUID NOT NULL,
    event_type  VARCHAR(60) NOT NULL,
    actor_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pharmacy_events_timeline ON pharmacy_events(pharmacy_id, created_at DESC);

-- Immutable, non-order financial ledger. It is UNIONed into finance/income reads.
CREATE TABLE pharmacy_financial_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE RESTRICT,
    payment_id  UUID NOT NULL REFERENCES pharmacy_payments(id) ON DELETE RESTRICT,
    invoice_id  UUID REFERENCES pharmacy_invoices(id) ON DELETE RESTRICT,
    event_type  VARCHAR(50) NOT NULL CHECK (event_type IN (
        'seller_commission_earned',
        'manager_team_commission_earned',
        'team_lead_pool_earned',
        'company_revenue_earned'
    )),
    user_id     UUID REFERENCES users(id) ON DELETE RESTRICT,
    seller_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    manager_id  UUID REFERENCES users(id) ON DELETE RESTRICT,
    team_lead_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    amount      NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
    metadata    JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pharmacy_fin_events_user ON pharmacy_financial_events(user_id, event_type, created_at DESC);
CREATE INDEX idx_pharmacy_fin_events_payment ON pharmacy_financial_events(payment_id);
CREATE INDEX idx_pharmacy_fin_events_hierarchy ON pharmacy_financial_events(team_lead_id, manager_id, seller_id, created_at DESC);

CREATE VIEW unified_income_events AS
SELECT fe.id, fe.order_id, NULL::uuid AS pharmacy_id, NULL::uuid AS payment_id,
       fe.event_type::text AS event_type, fe.user_id, fe.amount, fe.created_at
FROM financial_events fe
UNION ALL
SELECT pfe.id, NULL::uuid AS order_id, pfe.pharmacy_id, pfe.payment_id,
       pfe.event_type, pfe.user_id, pfe.amount, pfe.created_at
FROM pharmacy_financial_events pfe;

-- A payment may exceed current debt. Credit is financial only and is
-- automatically consumed by future accepted invoices.
CREATE TABLE pharmacy_credit_ledger (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE RESTRICT,
    payment_id  UUID REFERENCES pharmacy_payments(id) ON DELETE RESTRICT,
    invoice_id  UUID REFERENCES pharmacy_invoices(id) ON DELETE RESTRICT,
    return_id   UUID REFERENCES pharmacy_returns(id) ON DELETE RESTRICT,
    amount      NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
    entry_type  VARCHAR(20) NOT NULL CHECK (entry_type IN ('credit', 'applied')),
    created_by  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pharmacy_credit_ledger_pharmacy ON pharmacy_credit_ledger(pharmacy_id, created_at);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS pharmacy_credit_ledger;
DROP VIEW IF EXISTS unified_income_events;
DROP TABLE IF EXISTS pharmacy_financial_events;
DROP TABLE IF EXISTS pharmacy_events;
DROP TABLE IF EXISTS pharmacy_return_allocations;
DROP TABLE IF EXISTS pharmacy_return_items;
DROP TABLE IF EXISTS pharmacy_returns;
DROP TABLE IF EXISTS pharmacy_payment_allocations;
DROP TABLE IF EXISTS pharmacy_payment_edits;
DROP TABLE IF EXISTS pharmacy_payments;
DROP TABLE IF EXISTS pharmacy_stock;
DROP TABLE IF EXISTS pharmacy_financial_snapshots;
DROP TABLE IF EXISTS pharmacy_invoice_items;
DROP TABLE IF EXISTS pharmacy_invoices;
DROP TABLE IF EXISTS pharmacy_responsibility_history;
DROP TABLE IF EXISTS pharmacies;
-- +goose StatementEnd
