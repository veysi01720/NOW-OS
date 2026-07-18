# Package 13 Path B - Intent Scope Decision

Status: NOT WATERTIGHT / PATH B REJECTED / NOT ARMED
Date: 2026-07-18

## Decision

The canonical Conversation Decision V2 branch correctly limits candidate
greeting/first-contact selection to the exact scalar intent values:

- `greeting_or_first_contact`
- `candidate_first_contact`

Its qualification fixture intent is `app_fact_question`; the production context
classifier currently returns `null` for the fixture message. Both values are
rejected by the canary selector as `denied_intent` when the intent scope is
present.

However, the overall runtime boundary is not watertight. The legacy execution
callsite in `handleIncomingMessage` omits `model_adapter_canary_intents`,
`model_adapter_canary_percent`, and `inferredIntent`. The selector applies intent
and private-channel checks only when the intent list is non-empty; an empty list
falls through to tenant/role selection. Approval reservation validates the
approval window but does not re-check event intent. Therefore a route/config
change can bypass the narrow intent boundary.

Path B cannot be used. The Package 12 gate remains unchanged and the workflow
returns to Path A.

## Code Boundary

1. `ConversationContextBuilder.inferConversationIntent` returns one scalar
   intent or `null` and stores it as `latest_message.inferred_intent`.
2. `ConversationDecisionEngine` copies that scalar to adapter metadata without
   reinterpretation.
3. `resolveModelAdapterExecution` uses exact array membership. It does not use
   substring matching, category expansion, model output, or reply text.
4. This chain is safe only for the canonical V2 callsite; it is not enforced at
   every production model-execution callsite.

## Proven Bypass Boundary

1. `handleIncomingMessage` legacy execution metadata omits intent scope,
   percentage, and inferred intent.
2. `resolveModelAdapterExecution` guards intent/channel/traffic only inside
   `intentScope.length > 0`.
3. With an empty intent list, tenant/role mode can still return
   `enabled_tenant_allowlist`.
4. `ModelAdapterCanaryControl.reserve` checks approval validity and budget, not
   the event's intent scope.

## Boundary Cases

| Input / semantic source | Single intent value | Canary result |
| --- | --- | --- |
| `Selam` | `greeting_or_first_contact` | intent-eligible |
| `Selam, is icin yazdim` | `candidate_first_contact` | intent-eligible |
| Unknown-app fixture through production classifier | `null` | `denied_intent` |
| Unknown-app qualification fixture label | `app_fact_question` | `denied_intent` |

The regression test proves the intended V2 branch. It does not erase the legacy
callsite bypass identified above.

## Operational State

```text
PACKAGE_12_GATE_RELAXED=NO
UNKNOWN_APP_BLOCKER_FIXED=NO
UNKNOWN_APP_CURRENT_CANARY_RELEVANCE=NOT_PROVEN_OUT_OF_SCOPE
PATH_B_SCOPE_PROOF=FAILED
PATH_A_REQUIRED=YES
OWNER_APPROVAL_CREATED=NO
DEPLOY_EXECUTED=NO
CANARY_ARMED=NO
```

Owner approval and deployment are blocked.
