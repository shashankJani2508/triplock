import { handle, json, readJson } from "@/lib/server/http";
import { decideTrip } from "@/lib/server/trips";

export const dynamic = "force-dynamic";

/** Lock the group's final trip. Must be one of the matched options; first decision wins. */
export async function POST(request: Request, ctx: RouteContext<"/api/groups/[id]/decision">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const view = await decideTrip(id, await readJson(request));
    return json(view);
  });
}
