export const ENTRY_POINT_FILES = ["AGENTS.md", "GEMINI.md"];

export const REFERENCE_GUIDANCE_FILES = [
  "AGENTS.md",
  "GEMINI.md",
  "README.md",
  ".ai-workflow/POLICY.md",
  ".ai-workflow/BOOTSTRAP.md",
  ".ai-workflow/ACTOR_REGISTRY.md",
  ".ai-workflow/ROUTING.md",
  ".ai-workflow/STATE_MACHINE.md",
  ".ai-workflow/OWNER_STATUS.md",
  ".ai-workflow/HANDOFF_FILES.md",
  ".ai-workflow/DATA_MODEL.md",
  ".ai-workflow/CLI_BRIDGE.md",
  ".ai-workflow/FAST_LANE.md",
  ".ai-workflow/MIGRATION.md",
  ".ai-workflow/OWNER_GUIDE.md",
  ".ai-workflow/prompts/LEAD_BOOTSTRAP.md",
  ".ai-workflow/prompts/IMPLEMENTER_BOOTSTRAP.md",
  ".ai-workflow/prompts/REVIEWER_BOOTSTRAP.md",
  ".ai-workflow/prompts/OWNER_QUICK_PROMPTS.md"
];

const RULE_SIGNALS = [
  ["must", /\bmust\b/iu],
  ["never", /\bnever\b/iu],
  ["only", /\bonly\b/iu],
  ["required", /\brequired\b/iu],
  ["mandatory", /\bmandatory\b/iu],
  ["do not", /\bdo not\b/iu],
  ["phải", /\bphải\b/iu],
  ["không được", /không được/iu],
  ["bắt buộc", /bắt buộc/iu]
];

export function guidanceRuleDriftTerms(contents) {
  return RULE_SIGNALS
    .filter(([, pattern]) => pattern.test(contents))
    .map(([term]) => term);
}
