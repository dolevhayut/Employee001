import { getOpsHealth } from "@/lib/ops-health";

export async function GET(): Promise<Response> {
  return Response.json(await getOpsHealth(), {
    headers: { "Cache-Control": "no-store" },
  });
}
