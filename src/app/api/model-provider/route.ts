import { currentProvider, providerLabel } from "@/lib/model-provider";

export const runtime = "nodejs";

/** Configuration is intentionally read-only in the UI; setup owns `.env`. */
export async function GET() {
  const provider = currentProvider();
  return Response.json({ provider, label: providerLabel(provider) });
}
