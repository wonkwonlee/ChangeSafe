import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync("app/globals.css", "utf8");

function declarations(block: string): Map<string, string> {
  const result = new Map<string, string>();

  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name === undefined || value === undefined) {
      throw new Error("Expected every CSS declaration match to include a name and value");
    }
    result.set(name, value.trim());
  }

  return result;
}

function block(pattern: RegExp): string {
  const match = stylesheet.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Expected globals.css to contain ${pattern.source}`);
  }
  return match[1];
}

describe("operations-console design tokens", () => {
  it("exposes the semantic color families through Tailwind", () => {
    const root = declarations(block(/:root\s*\{([\s\S]*?)\n\}/));
    const theme = declarations(block(/@theme inline\s*\{([\s\S]*?)\n\}/));
    const semanticColors = [
      "canvas",
      "surface",
      "surface-elevated",
      "overlay",
      "border",
      "border-strong",
      "text-primary",
      "text-secondary",
      "text-muted",
      "action-primary",
      "action-primary-hover",
      "action-primary-foreground",
      "action-neutral",
      "action-neutral-hover",
      "action-neutral-foreground",
      "accent-provenance",
      "accent-deterministic",
      "accent-human",
      "status-pass",
      "status-warn",
      "status-block",
      "status-info",
    ];

    for (const name of semanticColors) {
      expect(root.get(`--${name}`), `${name} root token`).toBeDefined();
      expect(theme.get(`--color-${name}`), `${name} Tailwind token`).toBe(`var(--${name})`);
    }
  });

  it("keeps authority accents separate from deterministic verdict colors", () => {
    const root = declarations(block(/:root\s*\{([\s\S]*?)\n\}/));
    const verdicts = [
      root.get("--status-pass"),
      root.get("--status-warn"),
      root.get("--status-block"),
    ];
    const nonVerdictAccents = [
      root.get("--action-primary"),
      root.get("--action-neutral"),
      root.get("--accent-provenance"),
      root.get("--accent-deterministic"),
      root.get("--accent-human"),
      root.get("--status-info"),
    ];

    expect(new Set(verdicts).size).toBe(3);
    for (const accent of nonVerdictAccents) {
      expect(accent).toBeDefined();
      expect(verdicts).not.toContain(accent);
    }
  });

  it("defines operational typography, spacing, radius, focus, and motion semantics", () => {
    const root = declarations(block(/:root\s*\{([\s\S]*?)\n\}/));
    const requiredTokens = [
      "--font-body",
      "--font-code",
      "--font-size-label",
      "--font-size-body",
      "--font-size-heading",
      "--space-compact",
      "--space-control",
      "--space-section",
      "--radius-control",
      "--radius-panel",
      "--radius-pill",
      "--focus-color",
      "--focus-width",
      "--focus-offset",
      "--motion-fast",
      "--motion-base",
      "--motion-slow",
      "--motion-easing-standard",
    ];

    for (const token of requiredTokens) {
      expect(root.get(token), token).toBeDefined();
    }

    expect(block(/:root\s*\{([\s\S]*?)\n\}/)).toContain("color-scheme: dark");
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(stylesheet).not.toMatch(/(?:linear|radial|conic)-gradient\s*\(/);
  });
});
