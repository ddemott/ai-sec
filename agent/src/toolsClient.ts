/**
 * Thin HTTP client for /agent-tools/* routes on the Fastify backend.
 *
 * Every call attaches the shared `x-agent-secret` header — that's the only
 * auth between the worker and the backend (these routes bypass JWT /
 * tenantMiddleware because the worker isn't logged in as a tenant user).
 *
 * Every route returns the same envelope: `{ success: true, result }` on OK
 * (HTTP 200), `{ success: false, error, error_code? }` on conversational
 * failure (also HTTP 200 so the LLM can relay the message verbatim), and
 * HTTP 401 for auth failures.
 *
 * This client surfaces all three as a discriminated union so tool handlers
 * can pattern-match instead of catching exceptions.
 */

export type ToolResponse<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: string; errorCode?: string; status?: number };

export interface ToolsClientConfig {
  backendUrl: string;
  agentSecret: string;
  /** Per-request timeout in ms. Live calls can't wait long. */
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class ToolsClient {
  private backendUrl: string;
  private agentSecret: string;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(cfg: ToolsClientConfig) {
    // Strip trailing slash so `${backendUrl}${path}` never doubles up.
    this.backendUrl = cfg.backendUrl.replace(/\/$/, '');
    this.agentSecret = cfg.agentSecret;
    this.timeoutMs = cfg.timeoutMs ?? 8000;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async call<T = unknown>(path: string, body: unknown): Promise<ToolResponse<T>> {
    // Normalize path so callers can pass either "/agent-tools/x" or "agent-tools/x".
    const fullPath = path.startsWith('/') ? path : `/${path}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(`${this.backendUrl}${fullPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-secret': this.agentSecret,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // Parse body regardless of status so we can surface structured errors.
      const data: unknown = await res.json().catch(() => null);

      if (res.status === 401) {
        return {
          ok: false,
          error: 'Agent not authorized — check AGENT_SECRET config',
          status: 401,
        };
      }

      // Backend uses HTTP 200 for conversational failures too; only 5xx /
      // unexpected shapes count as real errors.
      if (!res.ok && res.status >= 500) {
        return {
          ok: false,
          error: `Backend returned ${res.status}`,
          status: res.status,
        };
      }

      // Expected envelope shape.
      if (data && typeof data === 'object' && 'success' in data) {
        const envelope = data as {
          success: boolean;
          result?: T;
          error?: string;
          error_code?: string;
        };
        if (envelope.success) {
          return { ok: true, result: envelope.result as T };
        }
        return {
          ok: false,
          error: envelope.error ?? 'Tool returned success:false with no message',
          errorCode: envelope.error_code,
          status: res.status,
        };
      }

      return {
        ok: false,
        error: 'Unexpected response shape from backend',
        status: res.status,
      };
    } catch (err) {
      const message =
        err instanceof Error
          ? err.name === 'AbortError'
            ? `Tool call timed out after ${this.timeoutMs}ms`
            : err.message
          : 'Unknown fetch error';
      return { ok: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  }
}
