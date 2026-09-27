import { handle, json } from "@/lib/server/http";
import { getTripView } from "@/lib/server/trips";

export const dynamic = "force-dynamic";

/** Group-level view of a trip: who has submitted, never what they answered. */
export async function GET(_request: Request, ctx: RouteContext<"/api/groups/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const view = await getTripView(id);
    if (!view) return json({ error: "not_found", message: "This trip doesn't exist." }, 404);
    return json(view);
  });
}
