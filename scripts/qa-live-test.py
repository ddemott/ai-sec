#!/usr/bin/env python3
"""
Live QA test suite for SecretaryHQ voice AI edge function.

Runs real HTTP calls against the deployed Supabase edge function,
then verifies bookings actually landed in the database with correct data.

Usage:
    python3 scripts/qa-live-test.py

Prerequisites:
    - Edge function deployed to Supabase
    - VAPI_SERVER_URL_SECRET matches between Vapi and Supabase
    - Supabase CLI authenticated (npx supabase db query --linked)
"""

import json
import subprocess
import sys
import urllib.request

# ── Config ──────────────────────────────────────────────────
SECRET = "dc4732f9e227e42988c59929dd96009d2b58f0ef2a346a5587d43ea06868e2c9"
URL = "https://sgibijfchvfuizudrmir.functions.supabase.co/vapi-tools"
TENANT = "f234e471-0e60-4163-86c9-93cfd9338e3a"
EMPLOYEE_NAME = "Mike Rivera"
TRUCK_NAME = "Service Truck 1"

tc = 0
passed = 0
failed = 0

# ── Helpers ─────────────────────────────────────────────────

def call_tool(tool_name, args, call_id=None):
    global tc
    tc += 1
    payload = {
        "message": {
            "type": "tool-calls",
            "call": {"id": call_id or f"qa-{tc}", "customer": {"number": args.get("phone", "+15555550000")}},
            "toolCalls": [{
                "id": f"tc-{tc}",
                "function": {"name": tool_name, "arguments": json.dumps(args)}
            }]
        }
    }
    data = json.dumps(payload).encode()
    req = urllib.request.Request(URL, data=data, headers={
        "Content-Type": "application/json",
        "x-vapi-secret": SECRET
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.load(resp)
            tr = result.get("results", [{}])[0].get("result", "")
            try:
                return json.loads(tr)
            except (json.JSONDecodeError, TypeError):
                return tr
    except Exception as e:
        return {"error": str(e)}


def run_sql(sql):
    result = subprocess.run(
        ["npx", "supabase", "db", "query", "--linked"],
        input=sql, capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        print(f"  SQL ERROR: {result.stderr[:200]}")
        return None
    try:
        data = json.loads(result.stdout)
        return data.get("rows", [])
    except json.JSONDecodeError:
        return None


def header(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


def check_pass(label, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        if detail:
            print(f"  PASS  {label}: {detail[:120]}")
        else:
            print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}: {detail[:120]}")
    return ok


def expect_pass(label, result):
    if isinstance(result, dict) and result.get("success") == True:
        return check_pass(label, True)
    elif isinstance(result, str) and len(result) > 0:
        return check_pass(label, True, result[:100])
    elif isinstance(result, dict) and "name" in result:
        return check_pass(label, True, json.dumps(result)[:100])
    else:
        err = ""
        if isinstance(result, dict):
            err = result.get("error_message", result.get("error", result.get("_raw", json.dumps(result)[:100])))
        return check_pass(label, False, err)


def expect_fail(label, result, expected_msg=None):
    is_error = False
    err_msg = ""

    if isinstance(result, dict):
        if result.get("success") == False:
            is_error = True
            err_msg = result.get("error_message", "")
        elif result.get("error"):
            is_error = True
            err_msg = result.get("error", "")
        elif result.get("_raw"):
            is_error = True
            err_msg = result["_raw"]

    if isinstance(result, str) and len(result) > 0 and not result.startswith("{"):
        is_error = True
        err_msg = result

    if is_error:
        if expected_msg and expected_msg.lower() not in err_msg.lower():
            return check_pass(label, False, f"wrong error — got: {err_msg}")
        return check_pass(label, True, f"correctly rejected — {err_msg[:100]}")
    else:
        detail = json.dumps(result)[:100] if isinstance(result, dict) else str(result)[:100]
        return check_pass(label, False, f"should have been rejected but got: {detail}")


def verify_booking(appointment_id, expected_name, expected_phone, expected_location=None, expected_description=None):
    """Query the DB to verify a booking actually exists with correct data."""
    rows = run_sql(f"""
        SELECT a.id, a.description, a.location, a.start_time, a.end_time, a.status,
               c.name as customer_name, c.phone as customer_phone
        FROM appointments a
        LEFT JOIN customers c ON a.customer_id = c.id
        WHERE a.id = '{appointment_id}'
        AND a.tenant_id = '{TENANT}';
    """)

    if not rows or len(rows) == 0:
        return check_pass(f"  DB: appointment exists", False, f"appointment {appointment_id} not found in database")

    row = rows[0]
    all_ok = True

    # Check appointment exists
    check_pass(f"  DB: appointment exists", True, appointment_id[:12])

    # Check customer name
    if expected_name:
        name_ok = row.get("customer_name", "") == expected_name
        all_ok = all_ok and check_pass(f"  DB: customer name", name_ok,
            f"expected '{expected_name}', got '{row.get('customer_name')}'")

    # Check phone
    if expected_phone:
        phone_ok = row.get("customer_phone", "") == expected_phone
        all_ok = all_ok and check_pass(f"  DB: customer phone", phone_ok,
            f"expected '{expected_phone}', got '{row.get('customer_phone')}'")

    # Check location
    if expected_location:
        loc_ok = row.get("location", "") == expected_location
        all_ok = all_ok and check_pass(f"  DB: location", loc_ok,
            f"expected '{expected_location}', got '{row.get('location')}'")

    # Check description
    if expected_description:
        desc_ok = expected_description.lower() in (row.get("description", "") or "").lower()
        all_ok = all_ok and check_pass(f"  DB: description", desc_ok,
            f"expected '{expected_description}', got '{row.get('description')}'")

    # Check status is scheduled
    status_ok = row.get("status") == "scheduled"
    all_ok = all_ok and check_pass(f"  DB: status = scheduled", status_ok,
        f"got '{row.get('status')}'")

    return all_ok


def verify_no_booking_created(label, before_count):
    """Verify that no new appointment was created (for rejection tests)."""
    rows = run_sql(f"SELECT count(*) as cnt FROM appointments WHERE tenant_id = '{TENANT}';")
    if rows:
        after_count = int(rows[0]["cnt"])
        return check_pass(f"  DB: no booking created ({label})", after_count == before_count,
            f"before={before_count}, after={after_count}")
    return check_pass(f"  DB: no booking created ({label})", False, "could not query count")


def get_appointment_count():
    rows = run_sql(f"SELECT count(*) as cnt FROM appointments WHERE tenant_id = '{TENANT}';")
    return int(rows[0]["cnt"]) if rows else 0


# ── Setup ───────────────────────────────────────────────────

def setup():
    header("SETUP: Preparing test environment")

    print("  Clearing all appointments...")
    run_sql(f"DELETE FROM appointments WHERE tenant_id = '{TENANT}';")

    print("  Clearing test customers...")
    run_sql(f"""
        DELETE FROM customers WHERE tenant_id = '{TENANT}'
        AND phone LIKE '+1555555%' OR phone LIKE '+1847555%' OR phone LIKE '+1630555%' OR phone LIKE '+1773555%';
    """)

    print("  Deactivating all employees except Mike Rivera...")
    run_sql(f"""
        UPDATE employees SET is_active = false
        WHERE tenant_id = '{TENANT}'
        AND name != '{EMPLOYEE_NAME}';
    """)

    print("  Deactivating shifts for inactive employees...")
    run_sql(f"""
        UPDATE employee_shifts SET is_active = false
        WHERE tenant_id = '{TENANT}'
        AND employee_id NOT IN (
            SELECT id FROM employees WHERE tenant_id = '{TENANT}' AND is_active = true
        );
    """)

    print("  Setting Mike's shifts to 24/7...")
    # Ensure all 7 days exist
    run_sql(f"""
        INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time, is_active)
        SELECT '{TENANT}',
            (SELECT id FROM employees WHERE tenant_id = '{TENANT}' AND name = '{EMPLOYEE_NAME}'),
            d, '00:00:00', '23:59:59', true
        FROM generate_series(0, 6) AS d
        ON CONFLICT DO NOTHING;
    """)
    run_sql(f"""
        UPDATE employee_shifts
        SET start_time = '00:00:00', end_time = '23:59:59', is_active = true
        WHERE tenant_id = '{TENANT}'
        AND employee_id = (
            SELECT id FROM employees WHERE tenant_id = '{TENANT}' AND name = '{EMPLOYEE_NAME}'
        );
    """)

    print("  Deactivating all resources except Service Truck 1...")
    run_sql(f"""
        UPDATE resources SET is_active = false
        WHERE tenant_id = '{TENANT}'
        AND name != '{TRUCK_NAME}';
    """)

    print("  Assigning all services to Mike...")
    run_sql(f"""
        INSERT INTO service_employee (service_id, employee_id, tenant_id)
        SELECT s.id,
            (SELECT id FROM employees WHERE tenant_id = '{TENANT}' AND name = '{EMPLOYEE_NAME}'),
            s.tenant_id
        FROM services s
        WHERE s.tenant_id = '{TENANT}'
        ON CONFLICT DO NOTHING;
    """)

    print("  Assigning all services to Service Truck 1...")
    run_sql(f"""
        INSERT INTO service_resource (service_id, resource_id, tenant_id)
        SELECT s.id,
            (SELECT id FROM resources WHERE tenant_id = '{TENANT}' AND name = '{TRUCK_NAME}' AND is_active = true),
            s.tenant_id
        FROM services s
        WHERE s.tenant_id = '{TENANT}'
        ON CONFLICT DO NOTHING;
    """)

    # Verify
    rows = run_sql(f"""
        SELECT
            (SELECT count(*) FROM employees WHERE tenant_id = '{TENANT}' AND is_active = true) as active_employees,
            (SELECT count(*) FROM resources WHERE tenant_id = '{TENANT}' AND is_active = true) as active_resources,
            (SELECT count(*) FROM appointments WHERE tenant_id = '{TENANT}') as appointments,
            (SELECT count(*) FROM services WHERE tenant_id = '{TENANT}') as services;
    """)
    if rows:
        r = rows[0]
        print(f"  Ready: {r['active_employees']} employee, {r['active_resources']} truck, "
              f"{r['services']} services, {r['appointments']} appointments")


# ── Tests ───────────────────────────────────────────────────

def run_tests():

    # ── HAPPY PATH ──────────────────────────────────────────

    header("HAPPY PATH: Full booking flow — Maria Garcia")

    r = call_tool("get_customer_context", {"phone": "+18475551234", "tenant_id": TENANT})
    expect_pass("New customer lookup", r)

    r = call_tool("get_service_catalog", {"tenant_id": TENANT})
    expect_pass("Service catalog returned", r)

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+18475551234", "name": "Maria Garcia",
        "description": "Tire Rotation", "call_id": "qa-happy",
        "location": "42 Oak Park Ave, Naperville IL",
        "requirements": {"serviceType": "Tire Rotation"},
        "window": {"from": "2026-03-31T15:00:00Z", "to": "2026-03-31T16:00:00Z"}
    })
    if expect_pass("Booking response success", r):
        verify_booking(
            r["appointment_id"],
            expected_name="Maria Garcia",
            expected_phone="+18475551234",
            expected_location="42 Oak Park Ave, Naperville IL",
            expected_description="Tire Rotation"
        )

    # ── RETURNING CUSTOMER ──────────────────────────────────

    header("RETURNING CUSTOMER: Dale DeMott")

    r = call_tool("get_customer_context", {"phone": "+16082175303", "tenant_id": TENANT})
    if isinstance(r, dict) and "name" in r:
        check_pass("Known customer found", r["name"] == "Dale DeMott", f"name='{r.get('name')}'")
    else:
        expect_pass("Known customer found", r)

    # ── UNUSUAL NAMES ───────────────────────────────────────

    header("UNUSUAL NAMES: Apostrophe and accented chars")

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+16305559876", "name": "Siobhan O'Shaughnessy",
        "description": "Balancing", "call_id": "qa-name1",
        "location": "1888 W Butterfield Rd, Wheaton IL",
        "requirements": {"serviceType": "Balancing"},
        "window": {"from": "2026-04-01T14:00:00Z", "to": "2026-04-01T15:00:00Z"}
    })
    if expect_pass("Apostrophe booking response", r):
        verify_booking(
            r["appointment_id"],
            expected_name="Siobhan O'Shaughnessy",
            expected_phone="+16305559876",
            expected_location="1888 W Butterfield Rd, Wheaton IL"
        )

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+17735551111", "name": "José García-López",
        "description": "Tire Rotation", "call_id": "qa-name2",
        "location": "500 N Michigan Ave, Chicago IL",
        "requirements": {"serviceType": "Tire Rotation"},
        "window": {"from": "2026-04-01T16:00:00Z", "to": "2026-04-01T17:00:00Z"}
    })
    if expect_pass("Accented chars booking response", r):
        verify_booking(
            r["appointment_id"],
            expected_name="José García-López",
            expected_phone="+17735551111"
        )

    # ── PAST TIME REJECTION ─────────────────────────────────

    header("PAST TIME: Should be rejected, no DB row")
    count_before = get_appointment_count()

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550001", "name": "Time Traveler",
        "description": "Flat Repair", "call_id": "qa-past",
        "location": "1 Main St",
        "requirements": {"serviceType": "Flat Repair"},
        "window": {"from": "2026-03-29T15:00:00Z", "to": "2026-03-29T16:00:00Z"}
    })
    expect_fail("Yesterday", r, "already passed")

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550001", "name": "Also Past",
        "description": "Flat Repair", "call_id": "qa-past2",
        "location": "1 Main St",
        "requirements": {"serviceType": "Flat Repair"},
        "window": {"from": "2025-12-25T15:00:00Z", "to": "2025-12-25T16:00:00Z"}
    })
    expect_fail("Last year", r, "already passed")
    verify_no_booking_created("past times", count_before)

    # ── 24/7 HOURS: All times should work ───────────────────

    header("24/7 HOURS: All times should be bookable")

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550002", "name": "Night Owl",
        "description": "Flat Repair", "call_id": "qa-3am",
        "location": "99 Dark Alley",
        "requirements": {"serviceType": "Flat Repair"},
        "window": {"from": "2026-03-31T08:00:00Z", "to": "2026-03-31T09:00:00Z"}
    })
    if expect_pass("3 AM CT booking", r):
        verify_booking(r["appointment_id"], "Night Owl", "+15555550002", "99 Dark Alley")

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550010", "name": "Saturday Person",
        "description": "Balancing", "call_id": "qa-sat",
        "location": "1 Saturday Lane",
        "requirements": {"serviceType": "Balancing"},
        "window": {"from": "2026-04-04T16:00:00Z", "to": "2026-04-04T17:00:00Z"}
    })
    if expect_pass("Saturday booking", r):
        verify_booking(r["appointment_id"], "Saturday Person", "+15555550010", "1 Saturday Lane")

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550011", "name": "Sunday Person",
        "description": "Balancing", "call_id": "qa-sun",
        "location": "1 Sunday Lane",
        "requirements": {"serviceType": "Balancing"},
        "window": {"from": "2026-04-05T16:00:00Z", "to": "2026-04-05T17:00:00Z"}
    })
    if expect_pass("Sunday booking", r):
        verify_booking(r["appointment_id"], "Sunday Person", "+15555550011", "1 Sunday Lane")

    # ── INVALID SERVICE ─────────────────────────────────────

    header("INVALID SERVICE: Should be rejected, no DB row")
    count_before = get_appointment_count()

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550003", "name": "Wrong Service",
        "description": "Oil change", "call_id": "qa-oil",
        "location": "123 Fake St",
        "requirements": {"serviceType": "Oil change"},
        "window": {"from": "2026-03-31T16:00:00Z", "to": "2026-03-31T17:00:00Z"}
    })
    expect_fail("Oil change", r, "don't offer")

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550003", "name": "Random Service",
        "description": "Car wash", "call_id": "qa-wash",
        "location": "123 Fake St",
        "requirements": {"serviceType": "Car wash"},
        "window": {"from": "2026-03-31T17:00:00Z", "to": "2026-03-31T18:00:00Z"}
    })
    expect_fail("Car wash", r, "don't offer")
    verify_no_booking_created("invalid services", count_before)

    # ── DOUBLE BOOKING ──────────────────────────────────────

    header("DOUBLE BOOKING: Same slot, 1 truck, no DB row")
    count_before = get_appointment_count()

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550004", "name": "Second Caller",
        "description": "Tire Rotation", "call_id": "qa-double",
        "location": "789 Elm St",
        "requirements": {"serviceType": "Tire Rotation"},
        "window": {"from": "2026-03-31T15:00:00Z", "to": "2026-03-31T16:00:00Z"}
    })
    expect_fail("Same slot as happy path", r, "already taken")
    verify_no_booking_created("double booking", count_before)

    # ── VARIOUS TIME SLOTS (24/7) ───────────────────────────

    header("VARIOUS TIMES: All should work with 24/7 hours")

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550012", "name": "Evening Booker",
        "description": "Flat Repair (On-site)", "call_id": "qa-evening",
        "location": "789 Sunset Blvd",
        "requirements": {"serviceType": "Flat Repair"},
        "window": {"from": "2026-03-31T22:00:00Z", "to": "2026-03-31T23:00:00Z"}
    })
    if expect_pass("5 PM CT", r):
        verify_booking(r["appointment_id"], "Evening Booker", "+15555550012", "789 Sunset Blvd")

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550014", "name": "First Thing",
        "description": "Tire Rotation", "call_id": "qa-8am",
        "location": "1 Early St",
        "requirements": {"serviceType": "Tire Rotation"},
        "window": {"from": "2026-04-01T13:00:00Z", "to": "2026-04-01T14:00:00Z"}
    })
    if expect_pass("8 AM CT", r):
        verify_booking(r["appointment_id"], "First Thing", "+15555550014", "1 Early St")

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550015", "name": "Early Riser",
        "description": "Tire Rotation", "call_id": "qa-745am",
        "location": "1 Early St",
        "requirements": {"serviceType": "Tire Rotation"},
        "window": {"from": "2026-04-02T12:45:00Z", "to": "2026-04-02T13:15:00Z"}
    })
    if expect_pass("7:45 AM CT (24/7 = open)", r):
        verify_booking(r["appointment_id"], "Early Riser", "+15555550015", "1 Early St")

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550016", "name": "Big Job",
        "description": "New Tire Install (x4)", "call_id": "qa-bigjob",
        "location": "1 Garage Ln",
        "requirements": {"serviceType": "New Tire Install"},
        "window": {"from": "2026-04-01T21:00:00Z", "to": "2026-04-01T23:00:00Z"}
    })
    if expect_pass("4 PM + 2 hr install", r):
        verify_booking(r["appointment_id"], "Big Job", "+15555550016", "1 Garage Ln", "New Tire Install")

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550017", "name": "Late Night Job",
        "description": "New Tire Install (x4)", "call_id": "qa-latenight",
        "location": "1 Garage Ln",
        "requirements": {"serviceType": "New Tire Install"},
        "window": {"from": "2026-04-02T21:30:00Z", "to": "2026-04-02T23:30:00Z"}
    })
    if expect_pass("4:30 PM + 2 hr (24/7 = open)", r):
        verify_booking(r["appointment_id"], "Late Night Job", "+15555550017", "1 Garage Ln")

    # ── VALIDATION EDGE CASES ───────────────────────────────

    header("VALIDATION: Malformed inputs")
    count_before = get_appointment_count()

    r = call_tool("get_customer_context", {"phone": "abc", "tenant_id": TENANT})
    expect_fail("Invalid phone (too short)", r)

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550007", "name": "Bad Window",
        "description": "Flat Repair", "call_id": "qa-badwindow",
        "requirements": {"serviceType": "Flat Repair"},
        "window": {"from": "not-a-date", "to": "also-not-a-date"}
    })
    expect_fail("Invalid date strings", r)

    r = call_tool("book_with_scheduling", {
        "tenant_id": "00000000-0000-0000-0000-000000000000",
        "phone": "+15555550008", "name": "Wrong Tenant",
        "description": "Flat Repair", "call_id": "qa-wrongtenant",
        "requirements": {"serviceType": "Flat Repair"},
        "window": {"from": "2026-03-31T16:00:00Z", "to": "2026-03-31T17:00:00Z"}
    })
    expect_fail("Wrong tenant ID", r)
    verify_no_booking_created("malformed inputs", count_before)

    # ── NO NAME PROVIDED ────────────────────────────────────

    header("NO NAME: Caller refuses to give name")

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550005",
        "description": "Seasonal Tire Swap", "call_id": "qa-noname",
        "location": "456 Secret St",
        "requirements": {"serviceType": "Seasonal Tire Swap"},
        "window": {"from": "2026-04-02T15:00:00Z", "to": "2026-04-02T16:30:00Z"}
    })
    if expect_pass("Booking without name (defaults to 'Caller')", r):
        verify_booking(r["appointment_id"], "Caller", "+15555550005", "456 Secret St")

    # ── LONG ADDRESS ────────────────────────────────────────

    header("LONG ADDRESS")

    long_addr = ("Unit 4B, Building 7, The Residences at Butterfield Commons, "
                 "2200 West Butterfield Road, Suite 100, Downers Grove, IL 60515")
    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550006", "name": "Verbose Person",
        "description": "Balancing", "call_id": "qa-longaddr",
        "location": long_addr,
        "requirements": {"serviceType": "Balancing"},
        "window": {"from": "2026-04-02T17:00:00Z", "to": "2026-04-02T18:00:00Z"}
    })
    if expect_pass("Very long address", r):
        verify_booking(r["appointment_id"], "Verbose Person", "+15555550006", long_addr)

    # ── GPT-4o-mini FORMAT (no Z, empty call_id) ────────────

    header("LLM FORMAT: How GPT-4o-mini actually sends args")

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550020", "name": "Real Caller",
        "description": "Flat tire repair", "call_id": "",
        "location": "331 Ridley St, North Aurora",
        "requirements": {"serviceType": "Flat tire repair"},
        "window": {"from": "2026-04-02T14:00:00-05:00", "to": "2026-04-02T15:00:00-05:00"}
    })
    if expect_pass("No Z suffix, CT offset, empty call_id", r):
        verify_booking(r["appointment_id"], "Real Caller", "+15555550020", "331 Ridley St, North Aurora")

    r = call_tool("book_with_scheduling", {
        "tenant_id": TENANT, "phone": "+15555550021", "name": "Another Caller",
        "description": "Tire Rotation", "call_id": "",
        "location": "100 Main St, Aurora",
        "requirements": {"serviceType": "Tire Rotation"},
        "window": {"from": "2026-04-03T10:00:00", "to": "2026-04-03T10:30:00"}
    })
    if expect_pass("No timezone at all", r):
        verify_booking(r["appointment_id"], "Another Caller", "+15555550021", "100 Main St, Aurora")

    # ── FINAL DB SUMMARY ────────────────────────────────────

    header("FINAL DB VERIFICATION")
    rows = run_sql(f"""
        SELECT count(*) as total,
               count(DISTINCT c.phone) as unique_customers
        FROM appointments a
        JOIN customers c ON a.customer_id = c.id
        WHERE a.tenant_id = '{TENANT}' AND a.status = 'scheduled';
    """)
    if rows:
        r = rows[0]
        print(f"  Total scheduled appointments: {r['total']}")
        print(f"  Unique customers: {r['unique_customers']}")

    # Verify no customer has empty phone
    rows = run_sql(f"""
        SELECT c.name, c.phone FROM customers c
        JOIN appointments a ON c.id = a.customer_id
        WHERE a.tenant_id = '{TENANT}'
        AND (c.phone IS NULL OR c.phone = '' OR length(c.phone) < 5);
    """)
    if rows and len(rows) > 0:
        check_pass("No customers with empty/invalid phone", False,
            f"found {len(rows)} customer(s) with bad phone: {json.dumps(rows)[:150]}")
    else:
        check_pass("No customers with empty/invalid phone", True)

    # Verify no customer has name = NULL
    rows = run_sql(f"""
        SELECT c.name, c.phone FROM customers c
        JOIN appointments a ON c.id = a.customer_id
        WHERE a.tenant_id = '{TENANT}'
        AND (c.name IS NULL OR c.name = '');
    """)
    if rows and len(rows) > 0:
        check_pass("No customers with empty name", False,
            f"found {len(rows)} customer(s) with no name: {json.dumps(rows)[:150]}")
    else:
        check_pass("No customers with empty name", True)


# ── Cleanup ─────────────────────────────────────────────────

def cleanup():
    header("CLEANUP: Removing test data")

    print("  Deleting test appointments...")
    run_sql(f"DELETE FROM appointments WHERE tenant_id = '{TENANT}';")

    print("  Deleting test customers (preserving real ones)...")
    run_sql(f"""
        DELETE FROM customers WHERE tenant_id = '{TENANT}'
        AND phone LIKE '+1555555%' OR phone LIKE '+1847555%'
        OR phone LIKE '+1630555%' OR phone LIKE '+1773555%';
    """)

    rows = run_sql(f"""
        SELECT
            (SELECT count(*) FROM appointments WHERE tenant_id = '{TENANT}') as appointments,
            (SELECT count(*) FROM customers WHERE tenant_id = '{TENANT}') as customers;
    """)
    if rows:
        r = rows[0]
        print(f"  Done: {r['appointments']} appointments, {r['customers']} customers remaining")


# ── Main ────────────────────────────────────────────────────

if __name__ == "__main__":
    setup()
    run_tests()
    cleanup()

    print(f"\n{'='*60}")
    print(f"  RESULTS: {passed} passed, {failed} failed, {tc} tool calls")
    print(f"{'='*60}")

    if failed > 0:
        sys.exit(1)
