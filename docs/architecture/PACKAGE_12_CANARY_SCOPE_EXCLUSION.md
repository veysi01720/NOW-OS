# Package 12 Canary Scope Exclusion

Status: APPROVED FOR CURRENT ARM SCOPE

`p12_unknown_app_missing_info` remains in the Package 12 quality catalog and
continues to be reported in the full replay. It is excluded from the current
canary eligibility gate because the canary is limited to these intents:

- `greeting_or_first_contact`
- `candidate_first_contact`

The fixture carries unknown-app semantics, and the fail-closed selector rejects
it with `denied_intent`. The scenario is tracked as a known Package 14
candidate, not silently removed from quality coverage.

The eligibility score uses all 13 baseline scenarios, the two targeted
scenarios other than the excluded scenario, and the nine expanded scenarios
other than the excluded scenario.

Provider retry handling is infrastructure-only: up to two transient retries
with a short delay between attempts. Prompt, model decision, and semantic
policy rules are unchanged.
