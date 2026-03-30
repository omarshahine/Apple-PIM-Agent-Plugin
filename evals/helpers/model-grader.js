/**
 * Model-in-the-loop grader for calendar reasoning evals.
 *
 * Uses `claude -p` (Claude Code CLI) for both generating responses and
 * grading them (LLM-as-judge). No API key needed — uses existing auth.
 *
 * Each grading criterion becomes a focused judge prompt that returns
 * structured JSON verdicts.
 */

import { spawn } from "child_process";

const DEFAULT_MODEL = "sonnet";
const JUDGE_MODEL = "haiku";

/**
 * Call the model via `claude -p`, piping prompt through stdin.
 */
export async function callModel(systemPrompt, userMessage, { model, fixture } = {}) {
  let prompt;
  if (fixture) {
    const calendarData = JSON.stringify(fixture, null, 2);
    prompt = `Here are the calendar events I fetched:\n\n${calendarData}\n\nNow answer this question: ${userMessage}`;
  } else {
    prompt = userMessage;
  }

  return { text: await claudeCall(prompt, systemPrompt, model || DEFAULT_MODEL) };
}

/**
 * Low-level claude CLI call. Used for both response generation and judging.
 */
async function claudeCall(prompt, systemPrompt, model) {
  const args = ["-p", "-", "--model", model, "--max-turns", "1"];
  if (systemPrompt) {
    args.push("--system-prompt", systemPrompt);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`claude CLI timed out after 90s`));
    }, 90_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude CLI exited with code ${code}\nstderr: ${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`claude CLI spawn failed: ${err.message}`));
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

const JUDGE_SYSTEM = `You are an eval grader. You will be given a model response and a grading question.
Answer with ONLY a JSON object: {"pass": true/false, "reason": "brief explanation"}
No markdown, no code fences, no extra text. Just the raw JSON object.`;

/**
 * Ask the judge model a yes/no question about a response.
 * Returns { pass: boolean, reason: string }
 */
async function judge(response, question) {
  const prompt = `Model response to evaluate:\n"""\n${response}\n"""\n\nGrading question: ${question}`;
  const raw = await claudeCall(prompt, JUDGE_SYSTEM, JUDGE_MODEL);

  try {
    // Extract JSON from response (handle markdown code fences if model adds them)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { pass: false, reason: `Judge returned non-JSON: ${raw.slice(0, 100)}` };
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { pass: false, reason: `Judge JSON parse failed: ${raw.slice(0, 100)}` };
  }
}

/**
 * Grade a model response against structured assertions using LLM-as-judge.
 *
 * Each assertion type sends a focused question to a judge model rather
 * than using regex patterns.
 *
 * @param {string} response - The model's text response
 * @param {object} grading - Grading criteria from the scenario YAML
 * @returns {Promise<{ pass: boolean, score: number, total: number, failures: string[] }>}
 */
export async function gradeResponse(response, grading) {
  const verdicts = [];

  // must_mention: response must reference these items
  if (grading.must_mention) {
    const results = await Promise.all(
      grading.must_mention.map((term) =>
        judge(response, `Does this response mention or reference "${term}" (the event/item name)? It could use a slightly different wording or abbreviation, but must clearly refer to the same thing.`)
          .then((v) => ({ ...v, label: `must_mention: "${term}"` }))
      )
    );
    verdicts.push(...results);
  }

  // must_not_mention: response must NOT reference these items on the requested date
  if (grading.must_not_mention) {
    const results = await Promise.all(
      grading.must_not_mention.map((term) =>
        judge(response, `This response should NOT list "${term}" as an event on the date the user asked about. Does the response correctly avoid claiming "${term}" is on that date? Return pass:true if "${term}" is absent or only mentioned as being on a different date.`)
          .then((v) => ({ ...v, label: `must_not_mention: "${term}"` }))
      )
    );
    verdicts.push(...results);
  }

  // answer: response must give a clear yes/no answer
  if (grading.answer) {
    const expected = grading.answer.toLowerCase();
    const v = await judge(response,
      `Does this response clearly answer "${expected}" to the user's question? The lead/summary should unambiguously indicate "${expected}".`
    );
    verdicts.push({ ...v, label: `answer: "${expected}"` });
  }

  // correct_date: a specific event must be assigned to this local date
  if (grading.correct_date) {
    const v = await judge(response,
      `Does this response place/assign the event being asked about on ${grading.correct_date} (or its natural language equivalent like "${formatDateNatural(grading.correct_date)}")? It should NOT assign the event to a different date.`
    );
    verdicts.push({ ...v, label: `correct_date: ${grading.correct_date}` });
  }

  // must_identify_available: these dates should be identified as available
  if (grading.must_identify_available) {
    const results = await Promise.all(
      grading.must_identify_available.map((date) =>
        judge(response,
          `Does this response identify ${formatDateNatural(date)} (${date}) as an available, open, or free evening for dinner? It should be presented as a viable option, not blocked or unavailable.`)
          .then((v) => ({ ...v, label: `must_identify_available: ${date}` }))
      )
    );
    verdicts.push(...results);
  }

  // must_identify_blocked: these dates should be identified as blocked
  if (grading.must_identify_blocked) {
    const results = await Promise.all(
      grading.must_identify_blocked.map((date) =>
        judge(response,
          `Does this response identify ${formatDateNatural(date)} (${date}) as blocked, unavailable, or not suitable for dinner? It should clearly indicate this date is NOT an option.`)
          .then((v) => ({ ...v, label: `must_identify_blocked: ${date}` }))
      )
    );
    verdicts.push(...results);
  }

  // must_identify_blocked_range: a contiguous range should be blocked with a reason
  if (grading.must_identify_blocked_range) {
    const { reason } = grading.must_identify_blocked_range;
    const v = await judge(response,
      `Does this response mention "${reason}" as a reason why a range of dates is blocked or unavailable?`
    );
    verdicts.push({ ...v, label: `must_identify_blocked_range: "${reason}"` });
  }

  // must_not_claim_open: these dates must NOT be described as open/available
  if (grading.must_not_claim_open) {
    const results = await Promise.all(
      grading.must_not_claim_open.map((date) =>
        judge(response,
          `This response should NOT recommend ${formatDateNatural(date)} (${date}) as an open or available evening for dinner. Does the response correctly treat this date as blocked or already booked? Return pass:true if the date is shown as blocked/booked or not recommended.`)
          .then((v) => ({ ...v, label: `must_not_claim_open: ${date}` }))
      )
    );
    verdicts.push(...results);
  }

  // strategy_check: verify the model plans an efficient query strategy
  if (grading.strategy_check) {
    if (grading.must_plan_single_query) {
      const v = await judge(response,
        `Does this response describe a plan to fetch calendar events using a SINGLE range query (one API/tool call covering the full date range)? It should NOT plan to make separate calls for each individual day.`
      );
      verdicts.push({ ...v, label: "must_plan_single_query" });
    }

    if (grading.must_not_plan_daily_queries) {
      const v = await judge(response,
        `This response should NOT plan to make separate calendar API/tool calls for each individual day. Analyzing results day-by-day AFTER a single fetch is fine. Does the response correctly plan a single fetch and only do per-day analysis locally? Return pass:true if it uses one query and analyzes locally.`
      );
      verdicts.push({ ...v, label: "must_not_plan_daily_queries" });
    }
  }

  // Tally results
  const failures = verdicts.filter((v) => !v.pass).map((v) => `${v.label}: ${v.reason}`);
  const passed = verdicts.filter((v) => v.pass).length;

  return {
    pass: failures.length === 0,
    score: passed,
    total: verdicts.length,
    failures,
  };
}

/** Convert YYYY-MM-DD to natural format like "April 3" */
function formatDateNatural(isoDate) {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const [, m, d] = isoDate.split("-").map(Number);
  return `${months[m - 1]} ${d}`;
}
