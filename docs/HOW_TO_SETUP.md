# AI Secretary SaaS – Verbose Setup Guide

This guide is designed for someone who has never set up an AI voice system before. It explains every concept and provides exact instructions for each service.

---

## 1. Concepts You Must Know

### 1.1 What is an "AI Agent"?
Think of an **Agent** as a "Virtual Employee." In our system (Vapi), an agent is made of three parts:
1.  **The Ears (Transcriber)**: Converts the caller's voice into text. We use **Deepgram**.
2.  **The Brain (Model)**: A Large Language Model (LLM) that reads the text and decides what to say next. We use **Groq** (running Llama 3) for speed.
3.  **The Mouth (Voice)**: Converts the text back into a human-sounding voice. We use **Cartesia**.

### 1.2 What are "Tools" (Function Calling)?
A **Tool** is how the AI "Brain" interacts with the real world. Without tools, the AI can only talk. With tools, the AI can say: *"Let me check the calendar for you,"* and it actually sends a request to our database to see if a slot is open.

### 1.3 What is a "SIP Trunk"?
A **SIP Trunk** is a virtual phone line. It connects a real phone number (from **Telnyx**) to the AI system (**Vapi**) over the internet.

---

## 2. Supabase Setup (The Foundation)
Supabase stores all your data (customers, bookings) and hosts your "Tool" logic.

1.  **Account**: Create an account at [supabase.com](https://supabase.com).
2.  **New Project**: Click "New Project." Name it `ai-sec`. Choose a region close to you.
3.  **Database Password**: Set a strong password. You will need this later.
4.  **Wait**: It takes about 2 minutes for the database to "provision."
5.  **Apply Schema**:
    - On the left sidebar, click the **SQL Editor** (looks like a `>_` icon).
    - Click "New Query."
    - Open the file `supabase/migrations/20260228000000_initial_schema.sql` in this project.
    - Copy **everything** in that file and paste it into the Supabase SQL Editor.
    - Click **Run**.
    - Repeat this for the other `.sql` files in the `supabase/migrations/` folder in order (000001, 000002, 000003).
6.  **Get Keys**:
    - Click the **Settings** (gear icon) → **API**.
    - You need two things for your Dashboard:
        - `Project URL` (e.g., `https://xyz.supabase.co`)
        - `anon public` key.

---

## 3. Vapi Setup (The Orchestrator)
Vapi is where the "Live Call" happens.

1.  **Account**: Create an account at [vapi.ai](https://vapi.ai).
2.  **Create Agent**:
    - Click **Agents** → **Create Agent** → **Blank**.
    - Open `vapi/agent.json` in this project. 
    - You don't need to upload the file; just look at the `system_prompt` and `firstMessage` and copy them into the Vapi UI.
3.  **Import Tools**:
    - Click **Tools** in the Vapi sidebar.
    - Click **Create Tool**.
    - Open `vapi/tools.json`. This file contains the "Blueprints" for your tools.
    - For each tool (e.g., `check_availability`), copy the JSON from `vapi/tools.json` and paste it into Vapi.
    - **Crucial**: Set the `Server URL` in Vapi to your Supabase Edge Function URL. You get this after deploying (see `README.md`).

---

## 4. Telnyx Setup (The Phone Number)
1.  **Account**: Create an account at [telnyx.com](https://telnyx.com).
2.  **Buy a Number**: Click **Numbers** → **Search & Buy**. Pick any number you like.
3.  **The "Glue"**: Follow the step-by-step guide in `vapi/TELNYX_SETUP.md`. This explains how to tell Telnyx to send calls to Vapi.

---

## 5. n8n Setup (The Background Worker)
n8n is like "Zapier" but more powerful. It handles the "slow" tasks after the call is over.

1.  **Account**: Create an account at [n8n.io](https://n8n.io) (Cloud) or run it locally via Docker.
2.  **Import Workflow**:
    - In n8n, click **Workflows** → **Add Workflow**.
    - Click the three dots `...` in the top right → **Import from File**.
    - Select `n8n/post_call_summarizer.json` from this project.
3.  **Connect Credentials**:
    - Click on the **Supabase Node**. Click "Add New Credential."
    - Enter your Supabase `Project URL` and `Service Role Key` (found in Supabase Settings → API).
    - Click on the **OpenAI Node**. Add your OpenAI API key.

---

## 6. Dashboard Deployment (The Control Center)
1.  **Vercel**: Create an account at [vercel.com](https://vercel.com).
2.  **New Project**: Select your GitHub repository.
3.  **Environment Variables**:
    - Before clicking "Deploy," add these two:
        - `NEXT_PUBLIC_SUPABASE_URL`: (Your Supabase Project URL)
        - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: (Your Supabase Anon Key)
4.  **Deploy**: Vercel will give you a URL (e.g., `https://my-dashboard.vercel.app`). This is where you will manage your business.
