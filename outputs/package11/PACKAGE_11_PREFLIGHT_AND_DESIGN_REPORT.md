# Package 11 Preflight And Design Report

Generated: 2026-07-18

## Status

- Package 10: accepted.
- Package 11: design prepared.
- Package 11 implementation: not started.
- Production deploy: NO.
- Real WhatsApp outbound: 0.

## 1. Model Agnosticism Check

### Result

PASS for production code path.

The current Responses code does not hardcode `gpt-4.1-mini`, `gpt-4.1`, or any
real model name in runtime logic. The Responses model is loaded from
configuration:

```text
OPENAI_RESPONSES_MODEL -> env.openaiResponsesModel -> createOpenAIResponsesAdapter({ model }) -> ResponsesAdapter.options.model -> Responses API payload model
```

### Evidence - Hardcoded Real Model Search

Command:

```text
rg -n "gpt-4\.1|gpt-4o|gpt-|model\s*===|model\s*==|if\s*\([^\n]*model|switch\s*\([^\n]*model" src package.json --glob '!dist/**' --glob '!node_modules/**'
```

Observed:

```text
No real model name such as gpt-4.1-mini or gpt-4.1 was found in src runtime code.
No model-name conditional branch was found.
The only gpt-like matches were test fixture model names such as gpt-test-responses.
```

### Evidence - Env / Config Path

Command:

```text
rg -n "OPENAI_RESPONSES_MODEL|openaiResponsesModel|createOpenAIResponsesAdapter|model:" src\config\env.ts src\server.ts src\modelAdapter src\tests --glob '!dist/**' --glob '!node_modules/**'
```

Key output:

```text
src\config\env.ts:43:  openaiResponsesModel?: string;
src\config\env.ts:140:    openaiResponsesModel: process.env.OPENAI_RESPONSES_MODEL?.trim() || undefined,
src\server.ts:194:  if (env.responsesShadowEnabled && env.responsesShadowMode !== "off" && env.openaiResponsesModel) {
src\server.ts:197:      model: env.openaiResponsesModel,
src\modelAdapter\ResponsesAdapter.ts:15:export async function createOpenAIResponsesAdapter(input: { apiKey: string; model: string }): Promise<ResponsesAdapter> {
src\modelAdapter\ResponsesAdapter.ts:18:  return new ResponsesAdapter({ runtime, model: input.model });
src\modelAdapter\ResponsesAdapter.ts:99:      model: this.options.model,
src\modelAdapter\ResponsesAdapter.ts:108:      model: this.options.model,
src\modelAdapter\responsesShadowService.ts:240:      model: identity.model,
```

Interpretation:

- model name is configuration input, not logic;
- shadow service logs model identity for telemetry only;
- adapter payload uses `this.options.model`;
- no branch changes decision logic based on model name.

### Evidence - Tests

Command:

```text
npm.cmd test -- --run src/tests/modelExecutionEnv.test.ts src/tests/modelAdapter/responsesAdapter.contract.test.ts src/tests/modelAdapter/responsesShadowService.test.ts src/tests/modelAdapter/modelExecutionService.selection.test.ts src/tests/modelAdapter/responsesGoldenReplay.test.ts
```

Result:

```text
Test Files  5 passed (5)
Tests       28 passed (28)
exit code 0
```

Conclusion:

- no Package 11 pre-fix is required for model hardcoding;
- Package 11 must preserve this property.

## 2. Package 04 Fixture Error / Ek 6 Decision

### Observed Historical Failure

Package 04 rerun failure:

```text
ENOENT: no such file or directory, open '...\work\package04_adapter_contract\data\knowledge_bank\app_facts.md'
```

Recorded in:

```text
outputs/package09/PACKAGE_RERUN_AND_QUALITY_GATE_PLAN.md
```

### Current Evidence

Command:

```text
rg -n "app_facts\.md|writeValidKnowledgeBank|KNOWLEDGE_BANK_DIR|data/knowledge_bank|data\\knowledge_bank" src\tests src\bridge Dockerfile docs outputs --glob '!dist/**' --glob '!node_modules/**'
```

Key output:

```text
Dockerfile:35:  && printf '# App Facts\n\nContainer test placeholder; runtime data volume overrides this file.\n' > data/knowledge_bank/app_facts.md
src\bridge\answerPlan.ts:38:  const markdown = readKnowledgeFile("app_facts.md");
src\bridge\knowledgeBundle.ts:9:  "app_facts.md",
src\bridge\sourceIntegrity.ts:75:  const appFactsPath = resolve(knowledgeBankDir, "app_facts.md");
src\tests\reviewRoutes.test.ts:26:    process.env.KNOWLEDGE_BANK_DIR = join(tempDir, "knowledge_bank");
src\tests\reviewRoutes.test.ts:27:    writeValidKnowledgeBank(process.env.KNOWLEDGE_BANK_DIR);
src\tests\reviewRoutes.test.ts:113:    const appFactsPath = resolve(process.env.KNOWLEDGE_BANK_DIR!, "app_facts.md");
src\tests\reviewRoutes.test.ts:295:    resolve(dir, "app_facts.md"),
```

### Decision

Do not fold Package 04 fixture repair into Package 11 prompt repair.

Create a separate package:

```text
Package 11B - Context Source Hardening / Structured Facts
```

This package should combine:

- Package 04 fixture/path hardening;
- Addendum Ek 6 structured facts separation.

Reason:

- Package 11 is prompt / decision policy repair.
- Ek 6 is context-source integrity.
- The app facts fixture problem and structured facts problem share the same
  owner: context/knowledge source handling.
- Combining them in Package 11B avoids mixing prompt quality with source
  reliability.

## 3. Package 11 Design

Design file:

```text
docs/architecture/PACKAGE_11_PROMPT_POLICY_REPAIR_DESIGN.md
```

### Target

For the configured Responses model:

```text
>= 12/13 pass per replay run
>= 92.3% pass rate
3 repeated runs minimum
unsafe claim count = 0
unapproved app mention = 0
action allowlist violations = 0
state patch mismatch = 0
real outbound = 0
```

### Ek 1 Handling

Package 11 will compare model self-report fields against deterministic
validator-computed metrics.

Rule:

```text
validator-computed metrics are authoritative
self-report is diagnostic only
if self-report says pass but validator says fail, scenario fails
```

### Ek 3 Handling

Fallback type remains:

```text
manual-flag-only
```

Reason:

- automatic fallback would hide schema/prompt failures;
- Package 11 needs measurable replay quality;
- provider failover belongs later, after the decision contract is stable.

Required Package 11 test:

```text
invalid Responses decision does not auto-call Assistant fallback
flag-off keeps Assistant path available
```

## 4. Safety

- OpenAI publish triggered: NO
- Vector store modified: NO
- Assistant binding changed: NO
- Production deploy: NO
- DB reset: NO
- Evolution touched: NO
- Webhook target changed: NO
- Real WhatsApp outbound: 0
- Secrets printed: NO
- Raw phone/JID/text logged: NO

## Decision

Package 11 is ready for implementation only after owner accepts this design.

Package 11B must be scheduled before Package 12 model selection/canary readiness
so replay uses reliable context sources.
