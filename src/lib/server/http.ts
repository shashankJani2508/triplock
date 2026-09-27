import "server-only";
import { ServiceError } from "./trips";

const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE });
}

/** Runs a route body and turns known failures into clean JSON errors. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ServiceError) {
      return json({ error: error.code, message: error.message }, error.status);
    }
    console.error(error);
    return json({ error: "internal", message: "Something went wrong. Please try again." }, 500);
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ServiceError("invalid_input", 400, "Request body must be JSON.");
  }
}
