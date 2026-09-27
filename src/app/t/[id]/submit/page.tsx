import { SetupNotice } from "@/components/notices";
import { PreferenceForm } from "@/components/preference-form";
import { loadTrip } from "../load";

export const dynamic = "force-dynamic";

export default async function Page(props: PageProps<"/t/[id]/submit">) {
  const { id } = await props.params;
  const { p } = await props.searchParams;
  const trip = await loadTrip(id);
  if ("setupError" in trip) return <SetupNotice />;
  return <PreferenceForm initial={trip.view} initialParticipantId={typeof p === "string" ? p : null} />;
}
