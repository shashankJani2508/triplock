import { handle, json } from "@/lib/server/http";
import { extendTripDeadline } from "@/lib/server/trips";

export const dynamic = "force-dynamic";

/** Give missing participants more time, only after the deadline has passed. */
export async function POST(_request: Request, ctx: RouteContext<"/api/groups/[id]/extend">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const view = await extendTripDeadline(id);
    return json(view);
  });
}
