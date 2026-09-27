import { SetupNotice } from "@/components/notices";
import { TripOverview } from "@/components/trip-overview";
import { loadTrip } from "./load";

export const dynamic = "force-dynamic";

export default async function Page(props: PageProps<"/t/[id]">) {
  const { id } = await props.params;
  const trip = await loadTrip(id);
  if ("setupError" in trip) return <SetupNotice />;
  return <TripOverview initial={trip.view} />;
}
