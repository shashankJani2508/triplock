import { after } from "next/server";
import { handle, json, readJson } from "@/lib/server/http";
import { ensureMatch, submitPreferences } from "@/lib/server/trips";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Submit one participant's preferences. Write-once; locks the group on the last one. */
export async function POST(request: Request, ctx: RouteContext<"/api/groups/[id]/submissions">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const view = await submitPreferences(id, await readJson(request));
    // The last submission locks the group: start matching without making this person wait.
    if (view.phase === "locked" && !view.results) {
      after(() => ensureMatch(id).catch((error) => console.error("[match] background run failed", error)));
    }
    return json(view, 201);
  });
}
