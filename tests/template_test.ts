/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
/**
 * Heavy dynamic template + error path testing.
 * Disables intentional.
 * See REFACTORING_TODO.md item 10.
 */
import postgres from 'postgres';
import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.220.0/assert/mod.ts';

const DB_URL =
  Deno.env.get('DATABASE_URL') || 'postgres://postgres:postgres@localhost:5433/postgres';
const sql = postgres(DB_URL);

// Helper to clear the DB before tests
async function clearDB() {
  await sql`TRUNCATE tenants, resources, customers, appointments, call_summaries CASCADE;`;
}

Deno.test('Business Template Integration', async (t) => {
  await clearDB();

  await t.step("Should apply 'salon' template on tenant creation", async () => {
    // Insert a new tenant with 'salon' type
    const [tenant] = await sql`
            INSERT INTO tenants (name, business_type) 
            VALUES ('Alice Salon', 'salon') 
            RETURNING *;
        `;

    assertEquals(tenant.name, 'Alice Salon');
    assertEquals(tenant.business_type, 'salon');

    // System prompt should have been applied
    assertNotEquals(tenant.system_prompt, null);
    assertEquals(tenant.system_prompt.includes('hair salon'), true);

    // Voice ID should be the salon default (Rachel)
    assertEquals(tenant.voice_id, '21m00Tcm4llvDq8ikWAM');

    // First message should be from template
    assertEquals(
      tenant.first_message,
      'Welcome to the salon! This is your booking assistant. Would you like to schedule a haircut or coloring today?'
    );

    // A default resource should have been created
    const resources = await sql`
            SELECT * FROM resources WHERE tenant_id = ${tenant.id};
        `;
    assertEquals(resources.length, 1);
    assertEquals(resources[0].name, 'Styling Station 1');
  });

  await t.step("Should apply 'dentist' template on tenant creation", async () => {
    const [tenant] = await sql`
            INSERT INTO tenants (name, business_type) 
            VALUES ('Dr. Smile', 'dentist') 
            RETURNING *;
        `;

    assertEquals(tenant.system_prompt.includes('dental clinic'), true);
    assertEquals(tenant.voice_id, 'ErXwSzhRj4IW3zYCt9a2');

    const resources = await sql`
            SELECT * FROM resources WHERE tenant_id = ${tenant.id};
        `;
    assertEquals(resources.length, 1);
    assertEquals(resources[0].name, 'Operatory 1');
  });

  await t.step('Should respect manual overrides during insertion', async () => {
    const [tenant] = await sql`
            INSERT INTO tenants (name, business_type, system_prompt, voice_id) 
            VALUES ('Custom Shop', 'auto-shop', 'Custom Prompt', 'custom-voice') 
            RETURNING *;
        `;

    assertEquals(tenant.system_prompt, 'Custom Prompt');
    assertEquals(tenant.voice_id, 'custom-voice');

    // Resource should still be created
    const resources = await sql`
            SELECT * FROM resources WHERE tenant_id = ${tenant.id};
        `;
    assertEquals(resources.length, 1);
    assertEquals(resources[0].name, 'Service Bay 1');
  });

  await sql.end();
});
