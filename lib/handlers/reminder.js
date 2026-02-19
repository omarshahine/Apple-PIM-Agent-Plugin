import {
  buildReminderCreateArgs,
  buildReminderUpdateArgs,
} from "../tool-args.js";

export async function handleReminder(args, runCLI) {
  const cliArgs = [];

  switch (args.action) {
    case "lists":
      return await runCLI("reminder-cli", ["lists"]);

    case "items":
      cliArgs.push("items");
      if (args.list) cliArgs.push("--list", args.list);
      if (args.filter) cliArgs.push("--filter", args.filter);
      if (!args.filter && args.completed) cliArgs.push("--completed");
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      return await runCLI("reminder-cli", cliArgs);

    case "get":
      if (!args.id) throw new Error("Reminder ID is required for reminder get");
      return await runCLI("reminder-cli", ["get", "--id", args.id]);

    case "search":
      if (!args.query) throw new Error("Search query is required for reminder search");
      cliArgs.push("search", args.query);
      if (args.list) cliArgs.push("--list", args.list);
      if (args.completed) cliArgs.push("--completed");
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      return await runCLI("reminder-cli", cliArgs);

    case "create":
      return await runCLI(
        "reminder-cli",
        buildReminderCreateArgs(args, args.list)
      );

    case "complete":
      if (!args.id) throw new Error("Reminder ID is required for reminder complete");
      cliArgs.push("complete", "--id", args.id);
      if (args.undo) cliArgs.push("--undo");
      return await runCLI("reminder-cli", cliArgs);

    case "update":
      return await runCLI("reminder-cli", buildReminderUpdateArgs(args));

    case "delete":
      if (!args.id) throw new Error("Reminder ID is required for reminder delete");
      return await runCLI("reminder-cli", ["delete", "--id", args.id]);

    case "batch_create":
      if (!args.reminders || !Array.isArray(args.reminders) || args.reminders.length === 0) {
        throw new Error("Reminders array is required and cannot be empty");
      }
      return await runCLI("reminder-cli", [
        "batch-create",
        "--json",
        JSON.stringify(args.reminders),
      ]);

    case "batch_complete":
      if (!args.ids || !Array.isArray(args.ids) || args.ids.length === 0) {
        throw new Error("IDs array is required and cannot be empty");
      }
      cliArgs.push("batch-complete", "--json", JSON.stringify(args.ids));
      if (args.undo) cliArgs.push("--undo");
      return await runCLI("reminder-cli", cliArgs);

    case "batch_delete":
      if (!args.ids || !Array.isArray(args.ids) || args.ids.length === 0) {
        throw new Error("IDs array is required and cannot be empty");
      }
      return await runCLI("reminder-cli", [
        "batch-delete",
        "--json",
        JSON.stringify(args.ids),
      ]);

    default:
      throw new Error(`Unknown reminder action: ${args.action}`);
  }
}
