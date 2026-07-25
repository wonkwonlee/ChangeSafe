import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/analyze/route";
import { GET } from "@/app/api/status/route";
import { AnalyzeErrorSchema, AnalyzeSuccessSchema, StatusResponseSchema } from "@/lib/domain/api";
import { RUNTIME_MODEL } from "@/lib/domain/version";

function analyzeRequest(body: unknown): Request {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/analyze in replay mode (no API key required)", () => {
  it("analyzes the safe scenario with honest provenance", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await POST(
      analyzeRequest({ scenarioId: "scenario-a-failover", mode: "replay" }),
    );
    expect(response.status).toBe(200);
    const payload = AnalyzeSuccessSchema.parse(await response.json());
    expect(payload.mode).toBe("replay");
    expect(payload.provenance).toBe("authored_synthetic");
    expect(payload.model).toBeNull();
    expect(payload.proposal.operations.length).toBeGreaterThan(0);
  });

  it("analyzes the red-team scenario labeled as authored, never as GPT-5.6", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await POST(
      analyzeRequest({ scenarioId: "scenario-b-route-leak", mode: "replay" }),
    );
    expect(response.status).toBe(200);
    const payload = AnalyzeSuccessSchema.parse(await response.json());
    expect(payload.provenance).toBe("authored_red_team");
    expect(payload.model).toBeNull();
    expect(payload.fixtureNotes).toContain("not model output");
  });
});

describe("POST /api/analyze live mode configuration errors", () => {
  it("returns a safe 503 without an API key and offers replay", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await POST(
      analyzeRequest({ scenarioId: "scenario-a-failover", mode: "live" }),
    );
    expect(response.status).toBe(503);
    const payload = AnalyzeErrorSchema.parse(await response.json());
    expect(payload.error.code).toBe("AI_UNAVAILABLE");
    expect(payload.error.replayAvailable).toBe(true);
    expect(payload.error.message).not.toMatch(/sk-|api[_-]?key|bearer/i);
  });
});

describe("POST /api/analyze request validation", () => {
  it("rejects malformed JSON", async () => {
    const response = await POST(analyzeRequest("not-json{"));
    expect(response.status).toBe(400);
    AnalyzeErrorSchema.parse(await response.json());
  });

  it("rejects wrong shapes and unexpected keys", async () => {
    for (const body of [
      {},
      { scenarioId: "scenario-a-failover" },
      { scenarioId: "scenario-a-failover", mode: "yolo" },
      { scenarioId: "scenario-a-failover", mode: "replay", extra: true },
      { scenarioId: "NOT-AN-ID", mode: "replay" },
    ]) {
      const response = await POST(analyzeRequest(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("rejects unknown scenarios with 404", async () => {
    const response = await POST(analyzeRequest({ scenarioId: "scenario-ghost", mode: "replay" }));
    expect(response.status).toBe(404);
    const payload = AnalyzeErrorSchema.parse(await response.json());
    expect(payload.error.code).toBe("SCENARIO_UNKNOWN");
  });

  it("rejects oversized bodies", async () => {
    const response = await POST(
      analyzeRequest({ scenarioId: "scenario-a-failover", mode: "replay", pad: "x".repeat(8192) }),
    );
    expect(response.status).toBe(413);
  });
});

describe("GET /api/status", () => {
  it("reports live unavailable without a key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const payload = StatusResponseSchema.parse(await (await GET()).json());
    expect(payload.liveAvailable).toBe(false);
    expect(payload.model).toBe(RUNTIME_MODEL);
  });

  it("reports availability as a boolean only and never echoes the key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key-value-never-echoed");
    const response = await GET();
    const text = await response.text();
    expect(text).not.toContain("test-key-value-never-echoed");
    const payload = StatusResponseSchema.parse(JSON.parse(text));
    expect(payload.liveAvailable).toBe(true);
  });
});
