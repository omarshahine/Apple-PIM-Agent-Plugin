export function buildCalendarDeleteArgs(args) {
  const deleteArgs = ["delete", "--id", args.id];
  if (args.futureEvents) deleteArgs.push("--future-events");
  return deleteArgs;
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
