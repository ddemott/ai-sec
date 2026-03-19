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
});
