# Telnyx + Vapi Setup Guide (The "Glue")

To connect your phone number to the AI Secretary, follow these steps in the Telnyx and Vapi Dashboards.

---

### 1. Telnyx: Create a SIP Trunk
1.  Go to **Voice** → **SIP Trunking** → **Create SIP Trunk**.
2.  Name it `AI Secretary (Vapi)`.
3.  In **Inbound Settings**, set the **Webhook URL** to Vapi's SIP endpoint (usually provided in the Vapi dashboard under "Phone Numbers" → "Import").
4.  In **Outbound Settings**, set the **SIP Auth** to "IP-based" or "Credentials" depending on Vapi's current requirement.

### 2. Telnyx: Buy and Assign a Number
1.  Go to **Numbers** → **Search and Buy Numbers**.
2.  Purchase a number for DynaTire.
3.  Assign the number to the `AI Secretary (Vapi)` SIP Trunk.

### 3. Vapi: Import the Number
1.  Go to the **Vapi Dashboard** → **Phone Numbers**.
2.  Click **Import from Provider** or **Link SIP Trunk**.
3.  Enter the Telnyx Number and the Trunk ID.
4.  Assign the **DynaTire AI Secretary** Agent to this number.

### 4. Vapi: Configure the Server URL
1.  In the Vapi Agent settings, ensure the **Server URL** points to your Supabase Edge Function:
    `https://[PROJECT_ID].functions.supabase.co/vapi-tools`
2.  Set the **Server URL Secret** to a random string (ensure this matches the check in your Edge Function logic).

---

### 5. Verify the "Human" Quality
Call the number!
- The AI should greet you: *"Thanks for calling DynaTire! This is your AI assistant..."*
- Ask: *"Do you remember me?"* (Triggers `get_customer_context`).
- Ask: *"Can I book a tire swap for tomorrow at 10 AM?"* (Triggers `check_availability` and `book_appointment`).

---

### Troubleshooting
- **No response?** Check Supabase Edge Function logs for "Incoming Request" errors.
- **Latency?** Ensure you are using Groq (Llama 3) and Cartesia in the Vapi Agent settings.
- **Booking Failed?** Run `npm test` locally to ensure the Postgres RPC isn't throwing errors.
