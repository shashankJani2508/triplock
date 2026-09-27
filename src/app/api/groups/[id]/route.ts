import { handle, json } from "@/lib/server/http";
import { getTripView } from "@/lib/server/trips";

export const dynamic = "force-dynamic";
// Room for one Gemini call when this request is the one computing the match.
export const maxDuration = 60;

/** Group-level view of a trip. Computes the match if the group just locked. */
export async function GET(_request: Request, ctx: RouteContext<"/api/groups/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const view = await getTripView(id, { generate: true });
    if (!view) return json({ error: "not_found", message: "This trip doesn't exist." }, 404);
    return json(view);
  });
}
