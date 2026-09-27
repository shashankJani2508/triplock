import { handle, json, readJson } from "@/lib/server/http";
import { createTrip } from "@/lib/server/trips";

export const dynamic = "force-dynamic";

/** Start a new trip session for the group. */
export async function POST(request: Request) {
  return handle(async () => {
    const id = await createTrip(await readJson(request));
    return json({ id }, 201);
  });
}
