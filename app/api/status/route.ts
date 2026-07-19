import { StatusResponseSchema } from "@/lib/domain/api";
import { RUNTIME_MODEL, APP_VERSION } from "@/lib/domain/version";
import { isLiveConfigured } from "@/lib/ai/live";

export const runtime = "nodejs";
// Key presence can change between deploys; never cache the answer statically.
export const dynamic = "force-dynamic";

/** Reports whether live mode is configured — a boolean only, never key material. */
export async function GET(): Promise<Response> {
  return Response.json(
    StatusResponseSchema.parse({
      liveAvailable: isLiveConfigured(),
      model: RUNTIME_MODEL,
      appVersion: APP_VERSION,
    }),
  );
}
