import { handle, json, readJson } from "@/lib/server/http";
import { submitPreferences } from "@/lib/server/trips";

export const dynamic = "force-dynamic";

/** Submit one participant's preferences. Write-once; locks the group on the last one. */
export async function POST(request: Request, ctx: RouteContext<"/api/groups/[id]/submissions">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const view = await submitPreferences(id, await readJson(request));
    return json(view, 201);
  });
}
