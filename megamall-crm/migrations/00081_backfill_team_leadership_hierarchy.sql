-- +goose Up
-- +goose StatementBegin

-- Backfills user_hierarchy for existing teams whose manager_id/team_lead_id
-- was set through CreateTeamModal/EditTeamModal (POST/PATCH /teams), a path
-- that — before this release — only wrote those two columns on the teams
-- row and never created the corresponding user_hierarchy entry. Team
-- rosters, "my team" self-service lookups, and RBAC scoping all read
-- user_hierarchy, not these columns, so any manager/lead assigned this way
-- shows a correctly-linked team but an empty roster, and is themselves
-- scoped to zero users/orders everywhere else in the app (see
-- users.Service.List: a caller with no user_hierarchy row is scoped to
-- nothing, regardless of any ids[]/filter they pass).
--
-- Only inserts rows that don't exist yet — a user who already has a
-- user_hierarchy entry (even pointing at a different team_id) is left
-- untouched, since that could reflect a deliberate, different assignment
-- this backfill has no way to disambiguate. New code (internal/teams:
-- Service.syncHierarchy) keeps this from recurring going forward.
INSERT INTO user_hierarchy (user_id, team_id)
SELECT t.team_lead_id, t.id
FROM teams t
WHERE t.team_lead_id IS NOT NULL
  AND t.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM user_hierarchy uh WHERE uh.user_id = t.team_lead_id
  );

INSERT INTO user_hierarchy (user_id, team_id)
SELECT t.manager_id, t.id
FROM teams t
WHERE t.manager_id IS NOT NULL
  AND t.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM user_hierarchy uh WHERE uh.user_id = t.manager_id
  );

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Not reversible: rows inserted here are indistinguishable from rows
-- created by normal app traffic after this migration ran.
SELECT 1;
-- +goose StatementEnd
