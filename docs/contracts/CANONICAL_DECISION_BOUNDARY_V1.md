# Canonical Decision Boundary V1

## Purpose

Define a provider-neutral boundary for future model execution without changing
the active runtime contract.

## Backend-Owned Input

```text
request_id_hash
tenant_id
authority_context
channel_type
normalized_user_message
conversation_state
memory_summary
recent_messages
approved_knowledge_summary
allowed_actions
forbidden_actions
runtime_constraints
```

Raw phone numbers, remote JIDs, group ids, credentials, provider SDK clients,
Assistant ids, thread/run objects and Responses blocks are forbidden.

## Model-Owned Proposal

The model may propose:

- intent classification
- a user-facing reply
- allowed actions
- evidence-restricted state patch fields
- escalation and risk flags
- policy fact references

The model may not:

- grant a role or permission
- execute a backend command
- write state, memory, queue or knowledge
- choose a WhatsApp destination
- call the WhatsApp sender
- approve or publish knowledge

## Backend Acceptance

The backend must validate:

1. strict schema;
2. allowed action membership;
3. policy fact grounding;
4. role and group boundaries;
5. semantic quality and prohibited claims;
6. state patch evidence;
7. final public reply safety;
8. idempotency and single outbound ownership.

## Provider Isolation

Assistants-specific threads and Responses-specific input/output items stay
inside their adapters. Both adapters must implement one canonical interface and
produce one canonical execution result. Provider raw output is never a public
reply and is not persisted as conversation state.

## Initial Responses Policy

- strict Conversation Decision V3 output
- stateless backend ownership; no provider state as source of truth
- no tools or function calling
- no model-driven outbound
- no vector or knowledge mutation
- shadow mode before any scoped canary
- Assistants fallback retained until explicit retirement approval
