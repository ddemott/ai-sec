-- The name-splitting trigger never fired for a customer created BY PHONE.
--
-- `customers` carries the same name twice: `name` (one string) and
-- `first_name`/`last_name` (split). `sync_customer_names()` keeps them in step —
-- edit either side and the other follows. It is a good trigger. It was attached to
-- BEFORE UPDATE only.
--
-- So every customer the VOICE AGENT has ever created — which is every customer the
-- product creates on its own, via /agent-tools/identify-caller's INSERT ... ON
-- CONFLICT — got `name` set and `first_name`/`last_name` left NULL. Nothing errored.
-- The dashboard looked right, because the list renders `name`. But the split columns
-- were empty, so a CSV export of a caller the agent captured had no first or last
-- name in it, and any code composing a display name from the split fields saw an
-- anonymous contact.
--
-- Found 2026-07-14 on the first browser call that actually reached the CRM: the
-- agent captured "Jack Jones" correctly, wrote it to `name`, and left the split
-- columns blank. The INSERT path had simply never been covered — an ON CONFLICT
-- upsert takes the UPDATE branch only for a RETURNING caller, and until today
-- almost every caller was new.
--
-- The old function cannot be reused as-is: it compares against OLD, which is NULL on
-- INSERT, so `NEW.name IS DISTINCT FROM OLD.name` is trivially true but
-- `NEW.first_name IS NOT DISTINCT FROM OLD.first_name` compares against NULL and the
-- logic reads confusingly at best. Branch on TG_OP explicitly instead — the INSERT
-- case has no prior row to reconcile with, so it is simply "fill in whichever side
-- was left empty".

CREATE OR REPLACE FUNCTION public.sync_customer_names()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- No OLD row. Whichever side the caller supplied is authoritative; derive
        -- the other. If they supplied both, believe both and touch nothing.
        IF NEW.name IS NOT NULL AND NEW.name <> ''
           AND NEW.first_name IS NULL AND NEW.last_name IS NULL THEN
            NEW.first_name := split_part(NEW.name, ' ', 1);
            NEW.last_name := CASE
                WHEN position(' ' in NEW.name) > 0
                THEN substring(NEW.name from position(' ' in NEW.name) + 1)
                ELSE NULL
            END;
        ELSIF (NEW.name IS NULL OR NEW.name = '')
              AND (NEW.first_name IS NOT NULL OR NEW.last_name IS NOT NULL) THEN
            NEW.name := trim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''));
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE: unchanged from the original — whichever side MOVED wins, and a change
    -- to both at once is left alone (the caller means what they said).
    IF NEW.name IS DISTINCT FROM OLD.name
       AND (NEW.first_name IS NOT DISTINCT FROM OLD.first_name
            AND NEW.last_name IS NOT DISTINCT FROM OLD.last_name) THEN
        NEW.first_name := split_part(NEW.name, ' ', 1);
        NEW.last_name := CASE
            WHEN position(' ' in NEW.name) > 0
            THEN substring(NEW.name from position(' ' in NEW.name) + 1)
            ELSE NULL
        END;
    ELSIF (NEW.first_name IS DISTINCT FROM OLD.first_name
           OR NEW.last_name IS DISTINCT FROM OLD.last_name)
          AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
        NEW.name := trim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''));
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_customer_names ON customers;
CREATE TRIGGER trg_sync_customer_names
    BEFORE INSERT OR UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION sync_customer_names();

-- Backfill everyone the agent already created. `name` is the truth on these rows;
-- the split columns were simply never written.
UPDATE customers
   SET first_name = split_part(name, ' ', 1),
       last_name = CASE
           WHEN position(' ' in name) > 0
           THEN substring(name from position(' ' in name) + 1)
           ELSE NULL
       END
 WHERE name IS NOT NULL
   AND name <> ''
   AND first_name IS NULL
   AND last_name IS NULL;
