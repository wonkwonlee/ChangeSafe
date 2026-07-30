import { StatusResponseSchema } from "@/lib/domain/api";
import { APP_VERSION } from "@/lib/domain/version";

export const runtime = "nodejs";
// Deployment identity can change between deploys; never cache the answer.
export const dynamic = "force-dynamic";

/**
 * Reports this application's identity and nothing else.
 *
 * The app performs validated bundled replay only. Reporting a configured
 * provider or model here would advertise a live-analysis capability this
 * route's own analysis endpoint refuses, so no provider state is read.
 */
export function GET(): Response {
  return Response.json(
    StatusResponseSchema.parse({
      appVersion: APP_VERSION,
    }),
  );
}
