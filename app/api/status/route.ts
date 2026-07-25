import { StatusResponseSchema } from "@/lib/domain/api";
import { APP_VERSION } from "@/lib/domain/version";
import { isLiveConfigured, liveProviderInfo } from "@/lib/ai/live";

export const runtime = "nodejs";
// Provider configuration can change between deploys; never cache the answer.
export const dynamic = "force-dynamic";

/**
 * Reports which provider live mode would call — an identifier and a model
 * name only, never credential material and never the credential's presence
 * beyond a boolean.
 */
export async function GET(): Promise<Response> {
  const info = liveProviderInfo();
  return Response.json(
    StatusResponseSchema.parse({
      liveAvailable: isLiveConfigured(),
      provider: info?.provider ?? null,
      model: info?.model ?? null,
      appVersion: APP_VERSION,
    }),
  );
}
