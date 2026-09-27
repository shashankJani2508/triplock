import { DatabaseZap, MapPinOff } from "lucide-react";
import type { ReactNode } from "react";
import { Shell } from "./shell";
import { ButtonLink, Card } from "./ui";

export function Notice({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="animate-fade-up p-6 text-center sm:p-8">
      <span className="mx-auto mb-4 inline-flex size-12 items-center justify-center rounded-2xl bg-canvas text-ink">
        {icon}
      </span>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-2 text-muted">{children}</div>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </Card>
  );
}

export function SetupNotice() {
  return (
    <Shell>
      <Notice icon={<DatabaseZap className="size-5" aria-hidden />} title="Database not connected yet">
        <p>
          Connect Supabase to this project in Vercel (Storage → Supabase), then redeploy. The tables are created
          automatically during the build. For manual setup, set{" "}
          <code className="font-mono text-sm">SUPABASE_URL</code> and{" "}
          <code className="font-mono text-sm">SUPABASE_SERVICE_ROLE_KEY</code> and run{" "}
          <code className="font-mono text-sm">supabase/schema.sql</code>.
        </p>
      </Notice>
    </Shell>
  );
}

export function TripNotFound() {
  return (
    <Shell>
      <Notice
        icon={<MapPinOff className="size-5" aria-hidden />}
        title="Trip not found"
        action={<ButtonLink href="/">Start a new trip</ButtonLink>}
      >
        <p>This link doesn&apos;t match any trip. Check the link your group shared.</p>
      </Notice>
    </Shell>
  );
}
