import { describe, it, expect, vi } from "vitest";
import { createNormalizer } from "../shared/normalizeForEmbedding";

describe("normalizeForEmbedding", () => {
  it("returns original text when no API key is provided", async () => {
    const normalize = createNormalizer("");
    const result = await normalize("I think Suzy is great at oil changes");
    expect(result).toBe("I think Suzy is great at oil changes");
  });

  it("returns short text unchanged (under 20 chars)", async () => {
    const normalize = createNormalizer("");
    const result = await normalize("Hi there");
    expect(result).toBe("Hi there");
  });

  it("returns empty string for empty input", async () => {
    const normalize = createNormalizer("");
    const result = await normalize("");
    expect(result).toBe("");
  });

  it("trims whitespace from input", async () => {
    const normalize = createNormalizer("");
    const result = await normalize("   short   ");
    expect(result).toBe("short");
  });

  it("accepts custom options", async () => {
    const normalize = createNormalizer("");
    // With no API key, just returns trimmed text regardless of options
    const result = await normalize("This is a test sentence for normalization", {
      context: "call summary",
      maxTokens: 100,
    });
    expect(result).toBe("This is a test sentence for normalization");
  });

  it("calls OpenAI API with correct parameters when API key is set", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Customer prefers Suzy for oil changes." } }],
      }),
    };
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(mockResponse as any);

    const normalize = createNormalizer("test-api-key");
    const result = await normalize("I think Suzy is great at oil changes", {
      context: "call summary",
    });

    expect(result).toBe("Customer prefers Suzy for oil changes.");
    expect(fetchSpy).toHaveBeenCalledOnce();

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse((options as any).body);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.temperature).toBe(0);
    expect(body.messages[1].content).toContain("call summary");
    expect(body.messages[1].content).toContain("I think Suzy is great at oil changes");
    expect((options as any).headers.Authorization).toBe("Bearer test-api-key");

    fetchSpy.mockRestore();
  });

  it("falls back to original text when LLM returns empty response", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "" } }],
      }),
    };
    vi.spyOn(global, "fetch").mockResolvedValueOnce(mockResponse as any);

    const normalize = createNormalizer("test-api-key");
    const result = await normalize("I think Suzy is great at oil changes");

    expect(result).toBe("I think Suzy is great at oil changes");

    vi.restoreAllMocks();
  });

  it("throws on API error", async () => {
    const mockResponse = {
      ok: false,
      json: async () => ({ error: { message: "Invalid API key" } }),
    };
    vi.spyOn(global, "fetch").mockResolvedValueOnce(mockResponse as any);

    const normalize = createNormalizer("bad-key");
    await expect(normalize("I think Suzy is great at oil changes")).rejects.toThrow(
      "Normalization LLM Error"
    );

    vi.restoreAllMocks();
  });

  // --- Sad path tests ---

  it("throws timeout error when fetch is aborted via AbortController", async () => {
    // The source wraps AbortError into a descriptive timeout message.
    // Simulate what happens when the AbortController signal fires during fetch.
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    vi.spyOn(global, "fetch").mockImplementationOnce(async () => {
      throw abortError;
    });

    const normalize = createNormalizer("test-api-key");
    await expect(normalize("I think Suzy is great at oil changes")).rejects.toThrow(
      "Normalization request timed out after 15000ms"
    );

    vi.restoreAllMocks();
  });

  it("throws on OpenAI 500 server error", async () => {
    const mockResponse = {
      ok: false,
      json: async () => ({ error: { message: "Internal server error", type: "server_error" } }),
    };
    vi.spyOn(global, "fetch").mockResolvedValueOnce(mockResponse as any);

    const normalize = createNormalizer("test-api-key");
    await expect(normalize("I think Suzy is great at oil changes")).rejects.toThrow(
      "Normalization LLM Error"
    );

    vi.restoreAllMocks();
  });

  it("throws on OpenAI 429 rate limit error", async () => {
    const mockResponse = {
      ok: false,
      json: async () => ({
        error: { message: "Rate limit exceeded", type: "rate_limit_error" },
      }),
    };
    vi.spyOn(global, "fetch").mockResolvedValueOnce(mockResponse as any);

    const normalize = createNormalizer("test-api-key");
    await expect(normalize("I think Suzy is great at oil changes")).rejects.toThrow(
      "Normalization LLM Error"
    );

    vi.restoreAllMocks();
  });

  it("throws when OpenAI returns malformed JSON", async () => {
    const mockResponse = {
      ok: false,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      },
    };
    vi.spyOn(global, "fetch").mockResolvedValueOnce(mockResponse as any);

    const normalize = createNormalizer("test-api-key");
    await expect(normalize("I think Suzy is great at oil changes")).rejects.toThrow(
      SyntaxError
    );

    vi.restoreAllMocks();
  });

  it("falls back to original text when OpenAI returns empty choices array", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ choices: [] }),
    };
    vi.spyOn(global, "fetch").mockResolvedValueOnce(mockResponse as any);

    const normalize = createNormalizer("test-api-key");
    const result = await normalize("I think Suzy is great at oil changes");
    expect(result).toBe("I think Suzy is great at oil changes");

    vi.restoreAllMocks();
  });

  it("falls back to original text when choices[0].message.content is null", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: null } }],
      }),
    };
    vi.spyOn(global, "fetch").mockResolvedValueOnce(mockResponse as any);

    const normalize = createNormalizer("test-api-key");
    const result = await normalize("I think Suzy is great at oil changes");
    expect(result).toBe("I think Suzy is great at oil changes");

    vi.restoreAllMocks();
  });

  it("re-throws network error (TypeError: Failed to fetch)", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const normalize = createNormalizer("test-api-key");
    await expect(normalize("I think Suzy is great at oil changes")).rejects.toThrow(
      "Failed to fetch"
    );

    vi.restoreAllMocks();
  });

  it("handles input with special unicode characters without crashing", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Customer asks about brake service. Name: Rene." } }],
      }),
    };
    vi.spyOn(global, "fetch").mockResolvedValueOnce(mockResponse as any);

    const normalize = createNormalizer("test-api-key");
    const result = await normalize("Hey! 😊 I'm René — do you guys do brakes? 🚗💨");
    expect(result).toBe("Customer asks about brake service. Name: Rene.");

    vi.restoreAllMocks();
  });

  it("handles very long input text without crashing", async () => {
    const longText = "I need an oil change. ".repeat(5000); // ~110k chars
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Customer requests oil change." } }],
      }),
    };
    vi.spyOn(global, "fetch").mockResolvedValueOnce(mockResponse as any);

    const normalize = createNormalizer("test-api-key");
    const result = await normalize(longText);
    expect(result).toBe("Customer requests oil change.");

    vi.restoreAllMocks();
  });
});
