export function buildCalendarDeleteArgs(args) {
  const deleteArgs = ["delete", "--id", args.id];
  if (args.futureEvents) deleteArgs.push("--future-events");
  return deleteArgs;
}

export function buildCalendarCreateArgs(args, targetCalendar) {
  const cliArgs = ["create", "--title", args.title, "--start", args.start];
  if (args.end) cliArgs.push("--end", args.end);
  if (args.duration) cliArgs.push("--duration", String(args.duration));
  if (targetCalendar) cliArgs.push("--calendar", targetCalendar);
  if (args.location) cliArgs.push("--location", args.location);
  if (args.notes) cliArgs.push("--notes", args.notes);
  if (args.url) cliArgs.push("--url", args.url);
  if (args.allDay) cliArgs.push("--all-day");
  if (args.alarm) {
    for (const minutes of args.alarm) {
      cliArgs.push("--alarm", String(minutes));
    }
  }
  if (args.recurrence) {
    cliArgs.push("--recurrence", JSON.stringify(args.recurrence));
  }
  return cliArgs;
}

export function buildCalendarUpdateArgs(args) {
  const cliArgs = ["update", "--id", args.id];
  if (args.title) cliArgs.push("--title", args.title);
  if (args.start) cliArgs.push("--start", args.start);
  if (args.end) cliArgs.push("--end", args.end);
  if (args.location) cliArgs.push("--location", args.location);
  if (args.notes) cliArgs.push("--notes", args.notes);
  if (args.url) cliArgs.push("--url", args.url);
  if (args.recurrence) cliArgs.push("--recurrence", JSON.stringify(args.recurrence));
  if (args.futureEvents) cliArgs.push("--future-events");
  return cliArgs;
}

export function applyDefaultCalendar(events, defaultCalendar) {
  return events.map((event) => ({
    ...event,
    calendar: event.calendar || defaultCalendar,
  }));
}

export function applyDefaultReminderList(reminders, defaultList) {
  return reminders.map((reminder) => ({
    ...reminder,
    list: reminder.list || defaultList,
  }));
}

export function buildReminderCreateArgs(args, targetList) {
  const cliArgs = ["create", "--title", args.title];
  if (targetList) cliArgs.push("--list", targetList);
  if (args.due) cliArgs.push("--due", args.due);
  if (args.notes) cliArgs.push("--notes", args.notes);
  if (args.priority !== undefined) cliArgs.push("--priority", String(args.priority));
  if (args.url) cliArgs.push("--url", args.url);
  if (args.alarm) {
    for (const minutes of args.alarm) {
      cliArgs.push("--alarm", String(minutes));
    }
  }
  if (args.location) cliArgs.push("--location", JSON.stringify(args.location));
  if (args.recurrence) cliArgs.push("--recurrence", JSON.stringify(args.recurrence));
  return cliArgs;
}

export function buildReminderUpdateArgs(args) {
  const cliArgs = ["update", "--id", args.id];
  if (args.title) cliArgs.push("--title", args.title);
  if (args.due) cliArgs.push("--due", args.due);
  if (args.notes) cliArgs.push("--notes", args.notes);
  if (args.priority !== undefined) cliArgs.push("--priority", String(args.priority));
  if (args.url !== undefined) cliArgs.push("--url", args.url);
  if (args.location) cliArgs.push("--location", JSON.stringify(args.location));
  if (args.recurrence) cliArgs.push("--recurrence", JSON.stringify(args.recurrence));
  return cliArgs;
}
