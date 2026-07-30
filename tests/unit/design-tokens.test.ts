import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync("app/globals.css", "utf8");

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

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

function relativeLuminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`Expected a six-digit hexadecimal color, received "${hex}"`);
  }
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const [red = 0, green = 0, blue = 0] = linear;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
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

  it("keeps normal semantic text and status colors at WCAG AA contrast on every console surface", () => {
    const root = declarations(block(/:root\s*\{([\s\S]*?)\n\}/));
    const surfaceTokens = [
      "--canvas",
      "--surface",
      "--surface-elevated",
      "--overlay",
    ] as const;
    const textTokens = [
      "--text-primary",
      "--text-secondary",
      "--text-muted",
      "--action-primary",
      "--action-primary-hover",
      "--accent-provenance",
      "--accent-deterministic",
      "--accent-human",
      "--status-pass",
      "--status-warn",
      "--status-block",
      "--status-info",
    ] as const;

    for (const textToken of textTokens) {
      const foreground = root.get(textToken);
      expect(foreground, textToken).toBeDefined();
      if (!foreground) continue;
      for (const surfaceToken of surfaceTokens) {
        const background = root.get(surfaceToken);
        expect(background, surfaceToken).toBeDefined();
        if (!background) continue;
        expect(
          contrastRatio(foreground, background),
          `${textToken} on ${surfaceToken}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }

    const primary = root.get("--text-primary");
    const secondary = root.get("--text-secondary");
    const muted = root.get("--text-muted");
    expect(primary).toBeDefined();
    expect(secondary).toBeDefined();
    expect(muted).toBeDefined();
    if (primary && secondary && muted) {
      expect(relativeLuminance(primary)).toBeGreaterThan(
        relativeLuminance(secondary),
      );
      expect(relativeLuminance(secondary)).toBeGreaterThan(
        relativeLuminance(muted),
      );
    }
  });

  it("keeps filled control foregrounds at WCAG AA normal-text contrast", () => {
    const root = declarations(block(/:root\s*\{([\s\S]*?)\n\}/));
    const pairs = [
      ["--action-primary-foreground", "--action-primary"],
      ["--action-primary-foreground", "--action-primary-hover"],
      ["--action-neutral-foreground", "--action-neutral"],
      ["--action-neutral-foreground", "--action-neutral-hover"],
    ] as const;

    for (const [foregroundToken, backgroundToken] of pairs) {
      const foreground = root.get(foregroundToken);
      const background = root.get(backgroundToken);
      expect(foreground, foregroundToken).toBeDefined();
      expect(background, backgroundToken).toBeDefined();
      if (!foreground || !background) continue;
      expect(
        contrastRatio(foreground, background),
        `${foregroundToken} on ${backgroundToken}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("binds every filled primary surface to the foreground token whose contrast is tested", () => {
    const filledPrimaryClasses = sourceFiles("components").flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return [...source.matchAll(/className="([^"]+)"/g)]
        .map((match) => match[1] ?? "")
        .filter((className) => className.split(/\s+/).includes("bg-active"));
    });

    expect(filledPrimaryClasses.length).toBeGreaterThan(0);
    for (const className of filledPrimaryClasses) {
      expect(className.split(/\s+/)).toContain(
        "text-action-primary-foreground",
      );
      expect(className.split(/\s+/)).not.toContain("text-white");
    }
  });
});
