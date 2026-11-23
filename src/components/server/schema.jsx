-- ============================================================
-- ProdIntel StageOps - Complete PostgreSQL Schema
-- Run: psql -U postgres -d prodintel -f schema.sql
-- ============================================================

-- Create database (run separately if needed):
-- CREATE DATABASE prodintel;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date  TIMESTAMPTZ DEFAULT NOW(),
    updated_date  TIMESTAMPTZ DEFAULT NOW(),
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    full_name     TEXT        NOT NULL,
    role          TEXT        NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'manager', 'viewer')),
    phone                TEXT,
    profile_image_url    TEXT
);

-- Default admin user (password: admin123 - CHANGE IN PRODUCTION)
INSERT INTO users (id, email, password_hash, full_name, role)
VALUES (
    gen_random_uuid(),
    'admin@prodintel.local',
    '$2b$10$rQZ9uAVUUkMBmLhB3LxHp.N3mH9BZHy/9Q3oQIHGKPJGON7MuWBgC',
    'System Admin',
    'admin'
) ON CONFLICT (email) DO NOTHING;

-- ─── Venues ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS venues (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date TIMESTAMPTZ DEFAULT NOW(),
    updated_date TIMESTAMPTZ DEFAULT NOW(),
    created_by   TEXT        NOT NULL,
    name         TEXT        NOT NULL,
    location     TEXT,
    capacity     NUMERIC,
    contact_info TEXT
);

-- ─── Productions ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS productions (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date  TIMESTAMPTZ DEFAULT NOW(),
    updated_date  TIMESTAMPTZ DEFAULT NOW(),
    created_by    TEXT        NOT NULL,
    name          TEXT        NOT NULL,
    venue_id      UUID        REFERENCES venues(id) ON DELETE SET NULL,
    start_date    DATE,
    end_date      DATE,
    status        TEXT        DEFAULT 'planning'
                              CHECK (status IN ('planning','rehearsal','active','completed','cancelled','archived')),
    description   TEXT,
    version       INTEGER     DEFAULT 1,
    archived_date DATE
);

CREATE INDEX IF NOT EXISTS idx_productions_status ON productions(status);
CREATE INDEX IF NOT EXISTS idx_productions_created_by ON productions(created_by);

-- ─── Production Templates ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS production_templates (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date    TIMESTAMPTZ DEFAULT NOW(),
    updated_date    TIMESTAMPTZ DEFAULT NOW(),
    created_by      TEXT        NOT NULL,
    name            TEXT        NOT NULL,
    description     TEXT,
    category        TEXT        NOT NULL
                                CHECK (category IN ('theater','concert','corporate_event','conference','workshop','other')),
    default_status  TEXT        DEFAULT 'planning'
                                CHECK (default_status IN ('planning','rehearsal','active')),
    template_tasks  TEXT        DEFAULT '[]',
    template_roles  TEXT        DEFAULT '[]',
    default_settings TEXT       DEFAULT '{}',
    is_public       BOOLEAN     DEFAULT false,
    usage_count     INTEGER     DEFAULT 0
);

-- ─── Asset Locations ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_locations (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date  TIMESTAMPTZ DEFAULT NOW(),
    updated_date  TIMESTAMPTZ DEFAULT NOW(),
    created_by    TEXT        NOT NULL,
    location_name TEXT        NOT NULL,
    description   TEXT,
    venue_id      UUID        REFERENCES venues(id) ON DELETE SET NULL
);

-- ─── Equipment Assets ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS equipment_assets (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date  TIMESTAMPTZ DEFAULT NOW(),
    updated_date  TIMESTAMPTZ DEFAULT NOW(),
    created_by    TEXT        NOT NULL,
    asset_name    TEXT        NOT NULL,
    category      TEXT        NOT NULL
                              CHECK (category IN ('lighting','sound','rigging','staging','video','props','tools','safety','other')),
    serial_number TEXT,
    status        TEXT        DEFAULT 'available'
                              CHECK (status IN ('available','in_use','maintenance','retired')),
    location_id   UUID        REFERENCES asset_locations(id) ON DELETE SET NULL,
    purchase_date DATE,
    notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment_assets(status);
CREATE INDEX IF NOT EXISTS idx_equipment_category ON equipment_assets(category);

-- ─── Equipment Schedules ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS equipment_schedules (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date  TIMESTAMPTZ DEFAULT NOW(),
    updated_date  TIMESTAMPTZ DEFAULT NOW(),
    created_by    TEXT        NOT NULL,
    asset_id      UUID        NOT NULL REFERENCES equipment_assets(id) ON DELETE CASCADE,
    production_id UUID        NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
    task_id       UUID,
    start_date    DATE        NOT NULL,
    end_date      DATE        NOT NULL,
    status        TEXT        DEFAULT 'scheduled'
                              CHECK (status IN ('scheduled','in_use','returned','cancelled')),
    notes         TEXT,
    booked_by     TEXT
);

CREATE INDEX IF NOT EXISTS idx_equip_schedule_asset ON equipment_schedules(asset_id);
CREATE INDEX IF NOT EXISTS idx_equip_schedule_production ON equipment_schedules(production_id);

-- ─── Maintenance Records ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS maintenance_records (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date        TIMESTAMPTZ DEFAULT NOW(),
    updated_date        TIMESTAMPTZ DEFAULT NOW(),
    created_by          TEXT        NOT NULL,
    asset_id            UUID        NOT NULL REFERENCES equipment_assets(id) ON DELETE CASCADE,
    maintenance_type    TEXT        NOT NULL
                                    CHECK (maintenance_type IN ('routine','repair','inspection','calibration','emergency')),
    performed_by        TEXT,
    performed_date      DATE        NOT NULL,
    notes               TEXT,
    next_scheduled_date DATE
);

CREATE INDEX IF NOT EXISTS idx_maintenance_asset ON maintenance_records(asset_id);

-- ─── Usage Metrics ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS usage_metrics (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date  TIMESTAMPTZ DEFAULT NOW(),
    updated_date  TIMESTAMPTZ DEFAULT NOW(),
    created_by    TEXT        NOT NULL,
    asset_id      UUID        NOT NULL REFERENCES equipment_assets(id) ON DELETE CASCADE,
    usage_hours   NUMERIC     NOT NULL,
    usage_date    DATE        NOT NULL,
    production_id UUID        REFERENCES productions(id) ON DELETE SET NULL,
    notes         TEXT
);

-- ─── Crew Members ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crew_members (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date      TIMESTAMPTZ DEFAULT NOW(),
    updated_date      TIMESTAMPTZ DEFAULT NOW(),
    created_by        TEXT        NOT NULL,
    full_name         TEXT        NOT NULL,
    email             TEXT,
    phone             TEXT,
    user_id           UUID        REFERENCES users(id) ON DELETE SET NULL,
    primary_role      TEXT        NOT NULL
                                  CHECK (primary_role IN ('stage_manager','lighting','sound','props','wardrobe','set','technical_director','rigger','carpenter','electrician','other')),
    secondary_roles   TEXT,
    preferred_roles   TEXT,
    status            TEXT        DEFAULT 'active'
                                  CHECK (status IN ('active','inactive','on_leave')),
    notes             TEXT,
    emergency_contact TEXT,
    certifications    TEXT        DEFAULT '[]',
    skills            TEXT,
    skill_levels      TEXT        DEFAULT '{}',
    skill_endorsements TEXT       DEFAULT '[]',
    blocked_dates     TEXT        DEFAULT '[]',
    available_days    TEXT        DEFAULT '[]',
    max_hours_per_week NUMERIC,
    hourly_rate       NUMERIC,
    profile_image_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_crew_status ON crew_members(status);
CREATE INDEX IF NOT EXISTS idx_crew_role ON crew_members(primary_role);

-- ─── Crew Assignments ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crew_assignments (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date     TIMESTAMPTZ DEFAULT NOW(),
    updated_date     TIMESTAMPTZ DEFAULT NOW(),
    created_by       TEXT        NOT NULL,
    production_id    UUID        NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
    crew_member_id   UUID        REFERENCES crew_members(id) ON DELETE SET NULL,
    crew_member_name TEXT,
    role             TEXT        NOT NULL
                                 CHECK (role IN ('stage_manager','lighting','sound','props','wardrobe','set','technical_director','rigger','carpenter','electrician','other')),
    contact_info     TEXT,
    status           TEXT        DEFAULT 'assigned'
                                 CHECK (status IN ('assigned','confirmed','active','completed','cancelled')),
    start_date       DATE,
    end_date         DATE,
    notes            TEXT
);

CREATE INDEX IF NOT EXISTS idx_crew_assign_production ON crew_assignments(production_id);
CREATE INDEX IF NOT EXISTS idx_crew_assign_member ON crew_assignments(crew_member_id);

-- ─── Crew Onboarding ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crew_onboarding (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date     TIMESTAMPTZ DEFAULT NOW(),
    updated_date     TIMESTAMPTZ DEFAULT NOW(),
    created_by       TEXT        NOT NULL,
    crew_member_id   UUID        REFERENCES crew_members(id) ON DELETE CASCADE,
    crew_member_name TEXT        NOT NULL,
    status           TEXT        DEFAULT 'pending'
                                 CHECK (status IN ('pending','in_progress','completed')),
    checklist_items  TEXT        DEFAULT '[]',
    start_date       DATE,
    completion_date  DATE,
    assigned_mentor  TEXT,
    notes            TEXT
);

CREATE INDEX IF NOT EXISTS idx_onboarding_crew ON crew_onboarding(crew_member_id);

-- ─── Task Checklists ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_checklists (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date        TIMESTAMPTZ DEFAULT NOW(),
    updated_date        TIMESTAMPTZ DEFAULT NOW(),
    created_by          TEXT        NOT NULL,
    production_id       UUID        NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
    task_name           TEXT        NOT NULL,
    description         TEXT,
    assigned_to         TEXT,
    assigned_to_email   TEXT,
    due_date            DATE,
    completion_status   TEXT        DEFAULT 'pending'
                                    CHECK (completion_status IN ('pending','in_progress','completed','blocked')),
    priority            TEXT        DEFAULT 'medium'
                                    CHECK (priority IN ('low','medium','high','critical')),
    parent_task_id      UUID        REFERENCES task_checklists(id) ON DELETE SET NULL,
    depends_on          TEXT        DEFAULT '[]',
    is_recurring        BOOLEAN     DEFAULT false,
    recurrence_pattern  TEXT        CHECK (recurrence_pattern IN ('daily','weekly','biweekly','monthly')),
    recurrence_end_date DATE,
    last_generated_date DATE,
    category            TEXT        CHECK (category IN ('technical','administrative','creative','logistics','safety','other')),
    estimated_hours     NUMERIC,
    actual_hours        NUMERIC,
    completed_date      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tasks_production ON task_checklists(production_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON task_checklists(completion_status);

-- ─── Incident Logs ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS incident_logs (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date      TIMESTAMPTZ DEFAULT NOW(),
    updated_date      TIMESTAMPTZ DEFAULT NOW(),
    created_by        TEXT        NOT NULL,
    production_id     UUID        NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
    description       TEXT        NOT NULL,
    severity          TEXT        DEFAULT 'medium'
                                  CHECK (severity IN ('low','medium','high','critical')),
    resolution_status TEXT        DEFAULT 'open'
                                  CHECK (resolution_status IN ('open','investigating','resolved','closed')),
    reported_by       TEXT,
    assigned_to       TEXT,
    resolution_notes  TEXT,
    closed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_incidents_production ON incident_logs(production_id);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incident_logs(severity);

-- ─── Budgets ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS budgets (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date     TIMESTAMPTZ DEFAULT NOW(),
    updated_date     TIMESTAMPTZ DEFAULT NOW(),
    created_by       TEXT        NOT NULL,
    production_id    UUID        NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
    category         TEXT        NOT NULL
                                 CHECK (category IN ('labor','equipment','venue','materials','transportation','catering','marketing','insurance','permits','contingency','other')),
    category_name    TEXT,
    allocated_amount NUMERIC     NOT NULL DEFAULT 0,
    actual_amount    NUMERIC     DEFAULT 0,
    notes            TEXT
);

CREATE INDEX IF NOT EXISTS idx_budgets_production ON budgets(production_id);

-- ─── Budget Expenses ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS budget_expenses (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date  TIMESTAMPTZ DEFAULT NOW(),
    updated_date  TIMESTAMPTZ DEFAULT NOW(),
    created_by    TEXT        NOT NULL,
    budget_id     UUID        NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    production_id UUID        NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
    description   TEXT        NOT NULL,
    amount        NUMERIC     NOT NULL,
    expense_date  DATE,
    vendor        TEXT,
    receipt_url   TEXT,
    status        TEXT        DEFAULT 'pending'
                              CHECK (status IN ('pending','approved','paid','rejected'))
);

CREATE INDEX IF NOT EXISTS idx_expenses_budget ON budget_expenses(budget_id);
CREATE INDEX IF NOT EXISTS idx_expenses_production ON budget_expenses(production_id);

-- ─── Knowledge Records ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_records (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date  TIMESTAMPTZ DEFAULT NOW(),
    updated_date  TIMESTAMPTZ DEFAULT NOW(),
    created_by    TEXT        NOT NULL,
    production_id UUID        REFERENCES productions(id) ON DELETE SET NULL,
    title         TEXT        NOT NULL,
    category      TEXT        NOT NULL
                              CHECK (category IN ('procedure','technical','safety','reference','lesson_learned','other')),
    content       TEXT,
    tags          TEXT
);

-- ─── Cue Documentation ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cue_documentations (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date    TIMESTAMPTZ DEFAULT NOW(),
    updated_date    TIMESTAMPTZ DEFAULT NOW(),
    created_by      TEXT        NOT NULL,
    production_id   UUID        NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
    cue_number      TEXT        NOT NULL,
    description     TEXT,
    department      TEXT        CHECK (department IN ('lighting','sound','staging','video','fly','props','special_effects')),
    revision_number INTEGER     DEFAULT 1,
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_cues_production ON cue_documentations(production_id);

-- ─── Procedure Library ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS procedure_libraries (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date       TIMESTAMPTZ DEFAULT NOW(),
    updated_date       TIMESTAMPTZ DEFAULT NOW(),
    created_by         TEXT        NOT NULL,
    title              TEXT        NOT NULL,
    category           TEXT        NOT NULL
                                   CHECK (category IN ('safety','technical','operational','emergency','maintenance','setup','teardown')),
    description        TEXT,
    last_reviewed_date DATE,
    version            NUMERIC     DEFAULT 1
);

-- ─── Automation Rules ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS automation_rules (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date     TIMESTAMPTZ DEFAULT NOW(),
    updated_date     TIMESTAMPTZ DEFAULT NOW(),
    created_by       TEXT        NOT NULL,
    rule_name        TEXT        NOT NULL,
    trigger_event    TEXT        NOT NULL,
    condition_logic  TEXT,
    action_definition TEXT       NOT NULL,
    is_active        BOOLEAN     DEFAULT true
);

-- ─── Trigger Conditions ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trigger_conditions (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date        TIMESTAMPTZ DEFAULT NOW(),
    updated_date        TIMESTAMPTZ DEFAULT NOW(),
    created_by          TEXT        NOT NULL,
    rule_id             UUID        NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    entity_type         TEXT        NOT NULL,
    field_name          TEXT        NOT NULL,
    comparison_operator TEXT        NOT NULL
                                    CHECK (comparison_operator IN ('equals','not_equals','greater_than','less_than','contains','is_empty','is_not_empty')),
    value               TEXT
);

-- ─── Workflow Actions ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflow_actions (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date  TIMESTAMPTZ DEFAULT NOW(),
    updated_date  TIMESTAMPTZ DEFAULT NOW(),
    created_by    TEXT        NOT NULL,
    rule_id       UUID        NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    action_type   TEXT        NOT NULL
                              CHECK (action_type IN ('notify','create_task','update_status','send_email','log_event')),
    target_entity TEXT,
    parameters    TEXT
);

-- ─── Execution Logs ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS execution_logs (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date   TIMESTAMPTZ DEFAULT NOW(),
    updated_date   TIMESTAMPTZ DEFAULT NOW(),
    created_by     TEXT,
    rule_id        UUID        NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    execution_date TIMESTAMPTZ DEFAULT NOW(),
    status         TEXT        NOT NULL CHECK (status IN ('success','failed','partial')),
    result_message TEXT
);

-- ─── Historical Incident Analysis ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS historical_incident_analyses (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date        TIMESTAMPTZ DEFAULT NOW(),
    updated_date        TIMESTAMPTZ DEFAULT NOW(),
    created_by          TEXT        NOT NULL,
    incident_id         UUID        NOT NULL REFERENCES incident_logs(id) ON DELETE CASCADE,
    root_cause          TEXT        NOT NULL,
    corrective_action   TEXT,
    preventative_action TEXT,
    analyzed_by         TEXT
);

-- ─── Activity Logs ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS activity_logs (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date  TIMESTAMPTZ DEFAULT NOW(),
    updated_date  TIMESTAMPTZ DEFAULT NOW(),
    created_by    TEXT,
    production_id UUID        REFERENCES productions(id) ON DELETE SET NULL,
    activity_type TEXT        NOT NULL
                              CHECK (activity_type IN ('comment','task_created','task_completed','task_updated','incident_logged','incident_resolved','crew_assigned','status_change','budget_update')),
    entity_type   TEXT,
    entity_id     TEXT,
    user_email    TEXT,
    user_name     TEXT,
    description   TEXT        NOT NULL,
    metadata      TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_production ON activity_logs(production_id);
CREATE INDEX IF NOT EXISTS idx_activity_date ON activity_logs(created_date DESC);

-- ─── Audit Logs ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date    TIMESTAMPTZ DEFAULT NOW(),
    updated_date    TIMESTAMPTZ DEFAULT NOW(),
    created_by      TEXT,
    user_email      TEXT        NOT NULL,
    user_name       TEXT,
    action          TEXT        NOT NULL CHECK (action IN ('create','update','delete')),
    entity_type     TEXT        NOT NULL,
    entity_id       TEXT        NOT NULL,
    entity_name     TEXT,
    changes         TEXT,
    previous_values TEXT,
    ip_address      TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_email);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

-- ─── Comments ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS comments (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date      TIMESTAMPTZ DEFAULT NOW(),
    updated_date      TIMESTAMPTZ DEFAULT NOW(),
    created_by        TEXT        NOT NULL,
    entity_type       TEXT        NOT NULL CHECK (entity_type IN ('production','task','incident')),
    entity_id         TEXT        NOT NULL,
    content           TEXT        NOT NULL,
    mentions          TEXT        DEFAULT '[]',
    author_email      TEXT,
    author_name       TEXT,
    parent_comment_id UUID        REFERENCES comments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_type, entity_id);

-- ─── Notifications ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date TIMESTAMPTZ DEFAULT NOW(),
    updated_date TIMESTAMPTZ DEFAULT NOW(),
    created_by  TEXT,
    user_email  TEXT        NOT NULL,
    type        TEXT        NOT NULL
                            CHECK (type IN ('mention','incident_created','task_overdue','task_assigned','production_status_change','new_message')),
    message     TEXT        NOT NULL,
    is_read     BOOLEAN     DEFAULT false,
    link        TEXT,
    entity_type TEXT,
    entity_id   TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_email, is_read);

-- ─── Notification Preferences ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_preferences (
    id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date             TIMESTAMPTZ DEFAULT NOW(),
    updated_date             TIMESTAMPTZ DEFAULT NOW(),
    created_by               TEXT,
    user_email               TEXT        NOT NULL UNIQUE,
    mention_enabled          BOOLEAN     DEFAULT true,
    incident_enabled         BOOLEAN     DEFAULT true,
    task_overdue_enabled     BOOLEAN     DEFAULT true,
    task_assigned_enabled    BOOLEAN     DEFAULT true,
    production_status_enabled BOOLEAN    DEFAULT true,
    message_enabled          BOOLEAN     DEFAULT true
);

-- ─── Announcements ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS announcements (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date         TIMESTAMPTZ DEFAULT NOW(),
    updated_date         TIMESTAMPTZ DEFAULT NOW(),
    created_by           TEXT        NOT NULL,
    title                TEXT        NOT NULL,
    content              TEXT        NOT NULL,
    author_email         TEXT,
    author_name          TEXT,
    visibility           TEXT        DEFAULT 'all'
                                     CHECK (visibility IN ('all','production','department','role')),
    target_production_id UUID        REFERENCES productions(id) ON DELETE SET NULL,
    target_department    TEXT,
    target_roles         TEXT        DEFAULT '[]',
    priority             TEXT        DEFAULT 'normal' CHECK (priority IN ('normal','important','urgent')),
    is_pinned            BOOLEAN     DEFAULT false,
    expires_at           TIMESTAMPTZ,
    read_by              TEXT        DEFAULT '[]'
);

-- ─── Conversations ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversations (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date         TIMESTAMPTZ DEFAULT NOW(),
    updated_date         TIMESTAMPTZ DEFAULT NOW(),
    created_by           TEXT        NOT NULL,
    type                 TEXT        NOT NULL
                                     CHECK (type IN ('direct_message','production_channel','department_channel','group_chat')),
    production_id        UUID        REFERENCES productions(id) ON DELETE SET NULL,
    department           TEXT,
    name                 TEXT,
    topic                TEXT,
    participants         TEXT        NOT NULL DEFAULT '[]',
    admins               TEXT        DEFAULT '[]',
    last_message_preview TEXT,
    last_message_date    TIMESTAMPTZ,
    is_archived          BOOLEAN     DEFAULT false
);

-- ─── Messages ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_date    TIMESTAMPTZ DEFAULT NOW(),
    updated_date    TIMESTAMPTZ DEFAULT NOW(),
    created_by      TEXT        NOT NULL,
    conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_email    TEXT        NOT NULL,
    sender_name     TEXT,
    content         TEXT        NOT NULL,
    read_by         TEXT        DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_date DESC);

-- ─── Done ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  RAISE NOTICE '✅ ProdIntel StageOps schema applied successfully.';
  RAISE NOTICE '   Default login: admin@prodintel.local / admin123';
END $$;