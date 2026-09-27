import { SetupNotice } from "@/components/notices";
import { StatusBoard } from "@/components/status-board";
import { loadTrip } from "../load";

export const dynamic = "force-dynamic";

export default async function Page(props: PageProps<"/t/[id]/status">) {
  const { id } = await props.params;
  const trip = await loadTrip(id);
  if ("setupError" in trip) return <SetupNotice />;
  return <StatusBoard initial={trip.view} />;
}
