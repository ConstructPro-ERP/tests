import { test, expect, unique, url, uuid } from "./fixture";

interface CalendarConnection {
  connected: boolean;
  calendarId: string | null;
}
interface CalendarEvent {
  id: string;
  summary: string;
  extendedProperties?: { private?: { constructProProjectId?: string } };
}

// Events are created in the connected Google Calendar of the test ADMIN.
// Never enable against someone's personal calendar. If that account has not
// authorized Google Calendar, the integration scenario is explicitly skipped.
test.describe("Project Calendar — real connected calendar workflow", () => {
  test("authenticated connection status can be read without OAuth modification", async ({
    projectContext: c,
  }) => {
    const result = await c.get<CalendarConnection>("/calendar/status");
    expect(result.connected).toEqual(expect.any(Boolean));
    expect(
      result.calendarId === null || typeof result.calendarId === "string"
    ).toBe(true);
  });

  test("project-scoped Google Calendar event can be created, listed, edited and removed", async ({
    projectContext: c,
  }) => {
    test.setTimeout(180_000);
    test.skip(
      process.env.E2E_ENABLE_CALENDAR_WRITES !== "true",
      "Set E2E_ENABLE_CALENDAR_WRITES=true for a dedicated connected staging Google account."
    );
    const status = await c.get<CalendarConnection>("/calendar/status");
    test.skip(
      !status.connected,
      "The ADMIN staging account needs a connected Google Calendar."
    );
    const project = await c.createProject();
    const title = unique("E2E Site Meeting");
    const googleId = uuid().replaceAll("-", "");
    const startDateTime = "2026-11-16T09:00:00+05:30";
    const endDateTime = "2026-11-16T10:00:00+05:30";
    const event = await c.post<CalendarEvent>("/calendar/events", {
      projectId: project.id,
      eventId: googleId,
      summary: title,
      description: "ConstructPro dedicated E2E calendar fixture",
      timeZone: "Asia/Colombo",
      startDateTime,
      endDateTime,
    });
    expect(event.id).toBe(googleId);
    try {
      const events = await c.get<CalendarEvent[]>("/calendar/events", {
        projectId: project.id,
        timeMin: "2026-11-15T00:00:00+05:30",
        timeMax: "2026-11-18T00:00:00+05:30",
        maxResults: 100,
      });
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: event.id, summary: title }),
        ])
      );
      const renamed = `${title} revised`;
      const result = await c.request.patch(
        url(`/calendar/events/${event.id}`),
        {
          headers: c.headers,
          params: { projectId: project.id },
          data: { summary: renamed },
        }
      );
      expect(result.ok(), await result.text()).toBeTruthy();
      const updated = await c.get<CalendarEvent[]>("/calendar/events", {
        projectId: project.id,
        timeMin: "2026-11-15T00:00:00+05:30",
        timeMax: "2026-11-18T00:00:00+05:30",
        maxResults: 100,
      });
      expect(updated.find((item) => item.id === event.id)?.summary).toBe(
        renamed
      );
    } finally {
      const removed = await c.request.delete(
        url(`/calendar/events/${event.id}`),
        {
          headers: c.headers,
          params: { projectId: project.id },
        }
      );
      expect(removed.ok(), await removed.text()).toBeTruthy();
    }
  });
});
