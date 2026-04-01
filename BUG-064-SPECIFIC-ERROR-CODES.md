# BUG-064: Specific Error Codes for Booking Failures

**Status:** ✅ FIXED  
**Date:** April 1, 2026 06:30 CDT  
**Reported by:** Dale  

---

## Problem

When a booking failed, the system returned a generic error message:
```
"No available resource/employee combination found for the requested time"
```

This made it impossible for the Vapi AI assistant to give specific, helpful responses to customers. The assistant couldn't distinguish between:
- Time slot already booked
- No employee with the required skills
- Employee not working at that time
- Other failures

As a result, the assistant would either hang up or give unhelpful generic responses.

---

## Solution

Added specific error codes to the `book_with_scheduling_atomic` database function:

### Error Codes

| Code | Message | Meaning |
|------|---------|---------|
| `TIMESLOT_OCCUPIED` | "Requested time slot is already booked" | Resource or employee already has an appointment at that time |
| `NO_SKILLED_EMPLOYEE` | "No employee with required skills available" | No employee in the system has the skills needed for this service |
| `EMPLOYEE_NOT_SCHEDULED` | "No employee available during requested time" | Employees with the skills exist but aren't scheduled to work at that time |
| `NO_AVAILABILITY` | "No available resource/employee combination found" | Generic failure (catchall) |
| `INVALID_PARAMS` | "Either (start_time + end_time) or (window_from + window_to) required" | Missing required parameters |

---

## Changes Made

### 1. Database Function (`book_with_scheduling_atomic`)

**File:** `supabase/migrations/20260401000001_specific_booking_errors.sql`

- Added `error_code TEXT` column to return type
- Added diagnostic queries to determine the specific failure reason
- Returns structured error codes instead of generic messages

**Before:**
```sql
RETURN QUERY SELECT FALSE, ..., 
  'No available resource/employee combination found for the requested time'::TEXT;
```

**After:**
```sql
-- Check if employee with skills exists
IF NOT v_employee_exists THEN
  RETURN QUERY SELECT FALSE, ...,
    'No employee with required skills available'::TEXT,
    'NO_SKILLED_EMPLOYEE'::TEXT;
END IF;

-- Check if time slot is occupied
IF v_employee_occupied OR v_resource_occupied THEN
  RETURN QUERY SELECT FALSE, ...,
    'Requested time slot is already booked'::TEXT,
    'TIMESLOT_OCCUPIED'::TEXT;
END IF;
```

### 2. TypeScript Interfaces

**File:** `supabase/functions/vapi-tools/core/interfaces.ts`

Added `error_code: string | null` to `bookWithSchedulingAtomic` return type.

### 3. Repository Layer

**File:** `supabase/functions/vapi-tools/db/repository.ts`

Added `error_code: string | null` to the `queryObject` type definition.

### 4. Error Classes

**File:** `supabase/functions/vapi-tools/core/errors.ts`

Updated `AvailabilityError` to include error code:

```typescript
export class AvailabilityError extends DomainError {
  public readonly code: string;
  
  constructor(message = "...", code = "NO_AVAILABILITY") {
    super(message);
    this.code = code;
  }
}
```

### 5. Service Layer

**File:** `supabase/functions/vapi-tools/core/service.ts`

Pass error code when throwing `AvailabilityError`:

```typescript
throw new AvailabilityError(
  result.error_message || "No available scheduling options",
  result.error_code || "NO_AVAILABILITY"
);
```

### 6. Dispatcher

**File:** `supabase/functions/vapi-tools/core/dispatcher.ts`

Return structured error object for `AvailabilityError`:

```typescript
if (error.name === "AvailabilityError" && "code" in error) {
  return this.vapiToolResponse(toolCallId, {
    success: false,
    error_message: error.message,
    error_code: (error as any).code
  });
}
```

### 7. Vapi Assistant Prompt

**File:** `scripts/fix-vapi-assistant.js`

Added specific instructions for handling each error code:

```javascript
**Error Handling:**
The booking tool returns specific error codes. Handle each differently:

- **TIMESLOT_OCCUPIED**: "I'm sorry, that time is already booked. 
  Would you like to try 30 minutes earlier or later?"
  
- **NO_SKILLED_EMPLOYEE**: "I'm sorry, we don't have anyone available 
  who specializes in that service."
  
- **EMPLOYEE_NOT_SCHEDULED**: "I'm sorry, our technicians aren't 
  working at that time."
```

---

## Testing

### Test 1: Time Slot Already Booked

```sql
SELECT success, error_message, error_code 
FROM book_with_scheduling_atomic(
  ...,
  '2026-04-02 14:00:00-05'::TIMESTAMPTZ,  -- Already booked
  '2026-04-02 15:00:00-05'::TIMESTAMPTZ,
  ARRAY['tire-rotation']::TEXT[],
  ...
);
```

**Result:**
```
success | error_message                          | error_code
--------|----------------------------------------|------------------
f       | Requested time slot is already booked  | TIMESLOT_OCCUPIED
```

✅ **Correct!**

### Test 2: No Employee with Required Skills

```sql
SELECT success, error_message, error_code 
FROM book_with_scheduling_atomic(
  ...,
  ARRAY['nuclear-repair']::TEXT[],  -- No one has this skill
  ...
);
```

**Result:**
```
success | error_message                              | error_code
--------|--------------------------------------------|--------------------
f       | No employee with required skills available | NO_SKILLED_EMPLOYEE
```

✅ **Correct!**

---

## Benefits

1. **Better Customer Experience**
   - Vapi assistant can give specific, helpful responses
   - Customers understand why their time wasn't available
   - Assistant can offer relevant alternatives

2. **Easier Debugging**
   - Error codes make it clear what went wrong
   - Logs include specific failure reasons
   - Support team can identify systemic issues (e.g., all employees missing a skill)

3. **Future Extensibility**
   - Easy to add new error codes as needed
   - Error codes can drive analytics (e.g., "how often do we get NO_SKILLED_EMPLOYEE?")
   - Can implement automatic fallbacks based on error code

---

## Next Steps

1. ✅ Database migration applied
2. ✅ TypeScript interfaces updated
3. ✅ Vapi assistant prompt updated
4. ⏭️ **Test with actual phone call** to verify Vapi assistant handles errors correctly
5. ⏭️ Monitor logs for error code distribution
6. ⏭️ Consider adding retry logic for TIMESLOT_OCCUPIED (try adjacent times automatically)

---

## Related Bugs

- **BUG-063**: Call hangs up when booking unavailable time (parent issue)
- **BUG-061**: Wrong date booked (hardcoded date in prompt)
- **BUG-062**: No employee assigned (missing skills parameter)

---

**Status: Ready for re-test via phone call to +1 (630) 397-0194**
