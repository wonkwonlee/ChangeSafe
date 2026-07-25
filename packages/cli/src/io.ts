import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/** A usage-level failure: the gate could not even start. Exit code 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function readJsonFile(filePath: string, label: string): unknown {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    throw new UsageError(`cannot read ${label}: ${path.resolve(filePath)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError(`${label} is not valid JSON: ${path.resolve(filePath)}`);
  }
}

/** Parse with a schema, turning validation failure into a readable usage error. */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const issues = result.error.issues
    .slice(0, 5)
    .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  const more =
    result.error.issues.length > 5
      ? `\n  … and ${result.error.issues.length - 5} more`
      : "";
  throw new UsageError(`${label} failed validation:\n${issues}${more}`);
}
