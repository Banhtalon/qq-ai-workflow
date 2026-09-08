import { assertActiveAttempt, readControl, updateControl } from "./lib/control.mjs";
import { inspectCandidate } from "./lib/workflow.mjs";
const [controlPath, controlDigest, candidateHead] = process.argv.slice(2);
try {
  const { control } = await readControl(controlPath, controlDigest, process.cwd());
  if (!["IMPLEMENTING", "VERIFYING"].includes(control.state)) throw new Error("invalid binding state");
  await assertActiveAttempt(control, process.cwd());
  control.candidate_head = candidateHead;
  const risk = inspectCandidate(process.cwd(), control);
  const result = await updateControl(controlPath, controlDigest, process.cwd(), next => {
    next.candidate_head = candidateHead;
    next.effective_risk = risk.effective;
    next.state = risk.effective === "RED" ? "ESCALATED_TECHNICAL" : "VERIFYING";
    return next;
  });
  console.log(JSON.stringify({ ...risk, controller_digest: result.digest, state: result.control.state }, null, 2));
  if (risk.effective === "RED") process.exitCode = 20;
} catch {
  console.error("BLOCKED: Controller binding or Git risk inspection failed");
  process.exitCode = 2;
}
