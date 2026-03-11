import React, { useState } from "react";

const initialState = {
  businessName: "",
  businessType: "",
  serviceDescription: "",
  tenantId: "",
  resourceId: "",
  voiceId: "",
  serverUrl: "",
  serverUrlSecret: "",
};

export default function OnboardBusiness() {
  const [form, setForm] = useState(initialState);
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitted(true);
    // Here you would save the config or call an API
  };

  return (
    <div className="max-w-xl mx-auto mt-10 p-6 bg-white rounded shadow">
      <h2 className="text-2xl font-bold mb-4">Add New Business</h2>
      <form onSubmit={handleSubmit}>
        <label className="block mb-2">Business Name
          <input name="businessName" value={form.businessName} onChange={handleChange} className="w-full border p-2 rounded mb-4" required />
        </label>
        <label className="block mb-2">Business Type
          <input name="businessType" value={form.businessType} onChange={handleChange} className="w-full border p-2 rounded mb-4" required />
        </label>
        <label className="block mb-2">Service Description
          <input name="serviceDescription" value={form.serviceDescription} onChange={handleChange} className="w-full border p-2 rounded mb-4" required />
        </label>
        <label className="block mb-2">Tenant ID
          <input name="tenantId" value={form.tenantId} onChange={handleChange} className="w-full border p-2 rounded mb-4" required />
        </label>
        <label className="block mb-2">Resource ID
          <input name="resourceId" value={form.resourceId} onChange={handleChange} className="w-full border p-2 rounded mb-4" required />
        </label>
        <label className="block mb-2">Voice ID
          <input name="voiceId" value={form.voiceId} onChange={handleChange} className="w-full border p-2 rounded mb-4" />
        </label>
        <label className="block mb-2">Server URL
          <input name="serverUrl" value={form.serverUrl} onChange={handleChange} className="w-full border p-2 rounded mb-4" />
        </label>
        <label className="block mb-2">Server URL Secret
          <input name="serverUrlSecret" value={form.serverUrlSecret} onChange={handleChange} className="w-full border p-2 rounded mb-4" />
        </label>
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded">Create Agent Config</button>
      </form>
      {submitted && (
        <div className="mt-6 p-4 bg-green-100 rounded">
          <h3 className="font-bold mb-2">Agent Config Preview</h3>
          <pre className="text-xs bg-gray-100 p-2 rounded overflow-x-auto">
{JSON.stringify({
  name: form.businessName,
  transcriber: {
    provider: "deepgram",
    model: "nova-2",
    language: "en-US"
  },
  model: {
    provider: "groq",
    model: "llama-3-70b-8192",
    messages: [
      {
        role: "system",
        content: `You are a professional, helpful secretary for ${form.businessName}, a ${form.businessType}. Your goal is to help customers book appointments for ${form.serviceDescription}. Always start by identifying if they are a returning customer using the get_customer_context tool. If they are returning, greet them by name and mention their last issue if relevant. If new, collect their name, relevant info, and issue. Be concise and human-sounding. Once you have a date/time, check availability using check_availability before confirming and then use book_appointment to finalize. Tenant ID is '${form.tenantId}' and Resource ID is '${form.resourceId}'.`
      }
    ],
    tools: ["get_customer_context", "check_availability", "book_appointment"]
  },
  voice: {
    provider: "cartesia",
    voiceId: form.voiceId
  },
  firstMessage: `Thanks for calling ${form.businessName}! This is your AI assistant. How can I help you today?`,
  endCallMessage: `Thank you for calling ${form.businessName}. Have a great day!`,
  serverUrl: form.serverUrl,
  serverUrlSecret: form.serverUrlSecret
}, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
