# Workflow Lifecycle

## 1. Plan

Hermes creates a small DAG. The current planner target is four nodes or fewer unless a user explicitly asks for a larger workflow.

## 2. Dispatch

Each node calls a registered skill. Bundled skills run in process for speed. External provider skills are called by HTTPS with a 20 second timeout.

## 3. Compose

`report-composer` receives upstream JSON and returns markdown. If the LLM composer is unavailable, a deterministic fallback report is generated from the raw outputs.

## 4. Finalize

`finalizeReport` persists the final markdown and raw JSON. It refuses to finalize if no skill dispatch was attempted.

## 5. Settle

When ERC-8183 is enabled, the workflow submit and complete transactions are written after finalization.

## 6. Reputation

After successful settlement:

- The workflow creator identity token score increases.
- Each completed provider agent token score increases.
- DB reputation cache updates only after the on-chain transaction succeeds.

## Operational Notes

- Admin transactions use a process-local nonce queue to avoid concurrent nonce collisions.
- Failed dispatches are persisted so the UI can show real failure states after reload.
- Final reports prefer composer markdown from raw JSON when the model attempts to finalize with a weak placeholder.
