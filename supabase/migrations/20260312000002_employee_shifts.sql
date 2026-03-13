-- Employee shifts to define working hours
CREATE TABLE IF NOT EXISTS employee_shifts (
    id SERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday, 6 = Saturday
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE employee_shifts ENABLE ROW LEVEL SECURITY;

-- Policy
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'employee_shifts' 
        AND policyname = 'Tenant isolation for shifts'
    ) THEN
        CREATE POLICY "Tenant isolation for shifts" ON employee_shifts
            FOR ALL USING (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::UUID);
    END IF;
END
$$;

-- Indexes for fast lookup during scheduling
CREATE INDEX IF NOT EXISTS idx_shifts_employee_day ON employee_shifts(employee_id, day_of_week);
