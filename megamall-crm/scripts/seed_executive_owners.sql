-- seed_executive_owners.sql — One-off seed for three named owner-level
-- accounts, created directly rather than through the HR "Create Employee"
-- UI (which no longer offers the owner role as an option — see
-- CreateEmployeeModal.jsx / EditEmployeeModal.jsx).
--
-- All three get role = 'owner' (full, unrestricted permissions, identical
-- to any other owner account) and a `position` value used purely for
-- display. Password hashes below are bcrypt (cost 12, matching
-- internal/users/service.go's bcryptCost) for the password "Parol123",
-- generated and verified locally before this file was written — this file
-- never contains the plaintext password.
--
-- Idempotent: safe to run more than once. Requires migration 00084 (adds
-- users.position) to already be applied.

BEGIN;

INSERT INTO users (id, phone, password_hash, full_name, surname, position, role, is_active, status)
VALUES
    (gen_random_uuid(), '+992018868383',
     '$2a$12$JLaS/HsyMKqNfmODnXJGSuecf9rYiOUm/u6p0yhU6QHjwaCj2hX16',
     'Абдувахоб Майдонов', 'Майдонов', 'Генеральный директор', 'owner', true, 'offline'),

    (gen_random_uuid(), '+992071519797',
     '$2a$12$Hk6TTDWW2RqDE4Gb2vZ6duFn5o.xDHYE65PdLf4RTHakB9V6aVutm',
     'Мухаммадсидик Хочаев', 'Хочаев', 'Владелец компании', 'owner', true, 'offline'),

    (gen_random_uuid(), '+992986792020',
     '$2a$12$/60XNoQVWcAA/VFeu.MFfeCel4PaTd.sT.hby7NrnvMi0EEhR0RUe',
     'Некрузчон Махмадуллоев', 'Махмадуллоев', 'Генеральный директор по маркетингу', 'owner', true, 'offline')
ON CONFLICT (phone) WHERE deleted_at IS NULL DO NOTHING;

COMMIT;
