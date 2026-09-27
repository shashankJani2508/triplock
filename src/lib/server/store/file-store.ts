import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { WeekendId } from "@/lib/config";
import type {
  GroupRecord,
  ParticipantRecord,
  PreferenceInput,
  SubmissionRecord,
} from "@/lib/types";
import { StoreError, type GroupSnapshot, type Store, type SubmitResult } from "./types";

interface Data {
  groups: GroupRecord[];
  participants: ParticipantRecord[];
  submissions: SubmissionRecord[];
}

/**
 * Local-development store backed by a JSON file. Mirrors the rules in
 * supabase/schema.sql exactly; every operation runs one at a time.
 * Not for production: serverless hosts have no durable local disk.
 */
export class FileStore implements Store {
  readonly kind = "file" as const;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async read(): Promise<Data> {
    try {
      return JSON.parse(await fs.readFile(this.filePath, "utf8")) as Data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { groups: [], participants: [], submissions: [] };
      }
      throw error;
    }
  }

  private async write(data: Data): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  /** Serialises read-modify-write cycles. Nothing is written if `fn` throws. */
  private exclusive<T>(fn: (data: Data) => T, mutate: boolean): Promise<T> {
    const run = this.queue.then(async () => {
      const data = await this.read();
      const result = fn(data);
      if (mutate) await this.write(data);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  createGroup(input: { name: string; deadline: string; participantNames: string[] }): Promise<string> {
    return this.exclusive((data) => {
      const now = this.now();
      if (Date.parse(input.deadline) <= now.getTime()) throw new StoreError("invalid_deadline");
      const id = randomUUID();
      data.groups.push({
        id,
        name: input.name,
        deadline: new Date(input.deadline).toISOString(),
        status: "open",
        selected_trip_id: null,
        selected_weekend: null,
        locked_at: null,
        decided_at: null,
        created_at: now.toISOString(),
      });
      input.participantNames.forEach((name, i) => {
        data.participants.push({ id: randomUUID(), group_id: id, name, position: i + 1 });
      });
      return id;
    }, true);
  }

  getSnapshot(groupId: string): Promise<GroupSnapshot | null> {
    return this.exclusive((data) => {
      const group = data.groups.find((g) => g.id === groupId);
      if (!group) return null;
      return structuredClone({
        group,
        participants: data.participants
          .filter((p) => p.group_id === groupId)
          .sort((a, b) => a.position - b.position),
        submissions: data.submissions.filter((s) => s.group_id === groupId),
      });
    }, false);
  }

  submit(groupId: string, participantId: string, prefs: PreferenceInput): Promise<SubmitResult> {
    return this.exclusive((data) => {
      const now = this.now();
      const group = data.groups.find((g) => g.id === groupId);
      if (!group) throw new StoreError("not_found");
      if (group.status !== "open") throw new StoreError("preferences_locked");
      if (now.getTime() > Date.parse(group.deadline)) throw new StoreError("deadline_passed");
      if (!data.participants.some((p) => p.id === participantId && p.group_id === groupId)) {
        throw new StoreError("participant_not_found");
      }
      if (data.submissions.some((s) => s.participant_id === participantId)) {
        throw new StoreError("already_submitted");
      }

      const at = now.toISOString();
      data.submissions.push({
        participant_id: participantId,
        group_id: groupId,
        budget_band: prefs.budget_band,
        free_weekends: [...prefs.free_weekends],
        destination_types: [...prefs.destination_types],
        dealbreakers: [...prefs.dealbreakers],
        submitted_at: at,
        locked_at: at,
      });

      const total = data.participants.filter((p) => p.group_id === groupId).length;
      const submitted = data.submissions.filter((s) => s.group_id === groupId).length;
      const locked = submitted >= total;
      if (locked) {
        group.status = "locked";
        group.locked_at = at;
      }
      return { submitted, total, locked };
    }, true);
  }

  decide(groupId: string, tripId: string, weekendId: WeekendId): Promise<void> {
    return this.exclusive((data) => {
      const group = data.groups.find((g) => g.id === groupId);
      if (!group) throw new StoreError("not_found");
      if (group.status === "decided") throw new StoreError("already_decided");
      if (group.status !== "locked") throw new StoreError("not_locked");
      group.status = "decided";
      group.selected_trip_id = tripId;
      group.selected_weekend = weekendId;
      group.decided_at = this.now().toISOString();
    }, true);
  }

  extendDeadline(groupId: string, hours: number): Promise<string> {
    return this.exclusive((data) => {
      const now = this.now();
      const group = data.groups.find((g) => g.id === groupId);
      if (!group) throw new StoreError("not_found");
      if (group.status !== "open") throw new StoreError("preferences_locked");
      if (Date.parse(group.deadline) > now.getTime()) throw new StoreError("not_expired");
      group.deadline = new Date(now.getTime() + hours * 3_600_000).toISOString();
      return group.deadline;
    }, true);
  }
}
