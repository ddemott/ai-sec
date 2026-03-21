-- Migrate employee_shifts and tenant_skills from SERIAL integer to UUID

-- employee_shifts: add UUID column, copy data, swap
ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS new_id UUID DEFAULT gen_random_uuid();
UPDATE employee_shifts SET new_id = gen_random_uuid() WHERE new_id IS NULL;

ALTER TABLE employee_shifts DROP CONSTRAINT IF EXISTS employee_shifts_pkey;
ALTER TABLE employee_shifts DROP COLUMN id;
ALTER TABLE employee_shifts RENAME COLUMN new_id TO id;
ALTER TABLE employee_shifts ADD PRIMARY KEY (id);
ALTER TABLE employee_shifts ALTER COLUMN id SET DEFAULT gen_random_uuid();

DROP SEQUENCE IF EXISTS employee_shifts_id_seq;

-- tenant_skills: add UUID column, copy data, swap
ALTER TABLE tenant_skills ADD COLUMN IF NOT EXISTS new_id UUID DEFAULT gen_random_uuid();
UPDATE tenant_skills SET new_id = gen_random_uuid() WHERE new_id IS NULL;

ALTER TABLE tenant_skills DROP CONSTRAINT IF EXISTS tenant_skills_pkey;
ALTER TABLE tenant_skills DROP COLUMN id;
ALTER TABLE tenant_skills RENAME COLUMN new_id TO id;
ALTER TABLE tenant_skills ADD PRIMARY KEY (id);
ALTER TABLE tenant_skills ALTER COLUMN id SET DEFAULT gen_random_uuid();

DROP SEQUENCE IF EXISTS tenant_skills_id_seq;
