import { useCallback, useState } from "react";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useAtomValue, useSetAtom } from "jotai";
import { CheckCheck, History } from "lucide-react-native";
import { View } from "react-native";
import type { EventRecord } from "@srdt/contracts";
import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { Hairline } from "@/components/hairline";
import { Screen } from "@/components/screen";
import { SegmentedControl } from "@/components/segmented-control";
import { TabHeader } from "@/components/tab-header";
import { Text } from "@/components/text";
import { markAlertsSeenAtom } from "@/features/activity/_atoms/unseen";
import { EventRow } from "@/features/activity/components/event-row";
import { CommandRow } from "@/features/controls/components/command-row";
import { commandsAtom, eventsAtom } from "@/features/twin/_atoms/state";

type View_ = "events" | "commands";

/** "Today", "Yesterday" or the date, for grouping rows by local day. */
function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const key = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (key(d) === key(now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (key(d) === key(y)) return "Yesterday";
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

export default function ActivityScreen() {
  const params = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<View_>(params.view === "commands" ? "commands" : "events");
  const markSeen = useSetAtom(markAlertsSeenAtom);
  const events = useAtomValue(eventsAtom);

  useFocusEffect(
    useCallback(() => {
      if (params.view === "commands") setView("commands");
    }, [params.view]),
  );
  // Opening the tab (and every new alert while it is open) counts as seen.
  useFocusEffect(useCallback(() => markSeen(), [markSeen, events]));

  return (
    <Screen refreshable header={<TabHeader title="Activity" description="What your room noticed, and what it was asked to do." />}>
      <SegmentedControl
        label="Activity view"
        value={view}
        onChange={setView}
        segments={[
          { value: "events", label: "Events" },
          { value: "commands", label: "Commands" },
        ]}
      />
      {view === "events" ? <Events events={events} /> : <Commands />}
    </Screen>
  );
}

function Events({ events }: { events: EventRecord[] }) {
  if (events.length === 0)
    return (
      <Card>
        <EmptyState icon={CheckCheck} title="All quiet for now" description="Room updates and alerts will appear here." />
      </Card>
    );
  const groups: { day: string; items: EventRecord[] }[] = [];
  for (const e of events) {
    const day = dayLabel(e.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }
  return (
    <>
      {groups.map((g) => (
        <View key={g.day} style={{ gap: 8 }}>
          <Text variant="eyebrow" tone="muted">
            {g.day}
          </Text>
          <Card style={{ paddingVertical: 4 }}>
            {g.items.map((e, i) => (
              <View key={e.id}>
                {i > 0 && <Hairline />}
                <EventRow event={e} />
              </View>
            ))}
          </Card>
        </View>
      ))}
    </>
  );
}

function Commands() {
  const commands = useAtomValue(commandsAtom);
  return (
    <Card style={{ paddingVertical: commands.length ? 6 : 20 }}>
      {commands.length === 0 ? (
        <EmptyState icon={History} title="No commands yet." description="Commands from this app, the dashboard and the assistant will appear here." />
      ) : (
        commands.map((c, i) => (
          <View key={c.id}>
            {i > 0 && <Hairline />}
            <CommandRow command={c} showLatency />
          </View>
        ))
      )}
    </Card>
  );
}
