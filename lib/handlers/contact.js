import {
  buildContactCreateArgs,
  buildContactUpdateArgs,
} from "../tool-args.js";

export async function handleContact(args, runCLI) {
  const cliArgs = [];

  switch (args.action) {
    case "groups":
      return await runCLI("contacts-cli", ["groups"]);

    case "list":
      cliArgs.push("list");
      if (args.group) cliArgs.push("--group", args.group);
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      return await runCLI("contacts-cli", cliArgs);

    case "search":
      if (!args.query) throw new Error("Search query is required for contact search");
      cliArgs.push("search", args.query);
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      return await runCLI("contacts-cli", cliArgs);

    case "get":
      if (!args.id) throw new Error("Contact ID is required for contact get");
      return await runCLI("contacts-cli", ["get", "--id", args.id]);

    case "create":
      return await runCLI("contacts-cli", buildContactCreateArgs(args));

    case "update":
      return await runCLI("contacts-cli", buildContactUpdateArgs(args));

    case "delete":
      if (!args.id) throw new Error("Contact ID is required for contact delete");
      return await runCLI("contacts-cli", ["delete", "--id", args.id]);

    default:
      throw new Error(`Unknown contact action: ${args.action}`);
  }
}
