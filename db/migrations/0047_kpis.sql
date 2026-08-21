-- 0047 期ごとのKPI。現在値を上書きせず、編集とアーカイブを改訂として残す。
CREATE TABLE kpis (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id  uuid NOT NULL REFERENCES seasons(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kpi_revisions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kpi_id      uuid NOT NULL REFERENCES kpis(id),
    revision_no integer NOT NULL,
    title       text NOT NULL,
    variable    text NOT NULL,
    value       numeric NOT NULL,
    memo        text,
    archived_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kpi_revision_title_not_blank CHECK (btrim(title, E' \t\n\r　') <> ''),
    CONSTRAINT kpi_revision_variable_not_blank CHECK (btrim(variable, E' \t\n\r　') <> ''),
    CONSTRAINT kpi_revision_number_positive CHECK (revision_no > 0),
    CONSTRAINT kpi_revision_number_unique UNIQUE (kpi_id, revision_no)
);

CREATE INDEX kpis_season_idx ON kpis (season_id, created_at, id);
CREATE INDEX kpi_revisions_latest_idx ON kpi_revisions (kpi_id, revision_no DESC);

COMMENT ON TABLE kpi_revisions IS
    'KPIの追記専用改訂。編集は新しい行、アーカイブは archived_at 付きの新しい行で残す。';
