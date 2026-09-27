import { SetupNotice } from "@/components/notices";
import { ResultsView } from "@/components/results-view";
import { loadTrip } from "../load";

export const dynamic = "force-dynamic";

export default async function Page(props: PageProps<"/t/[id]/results">) {
  const { id } = await props.params;
  const trip = await loadTrip(id);
  if ("setupError" in trip) return <SetupNotice />;
  return <ResultsView initial={trip.view} />;
}
