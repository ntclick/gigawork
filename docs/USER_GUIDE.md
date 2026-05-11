# GigaWork User Guide

## Run a workflow

1. Connect a wallet.
2. Pick a template or describe the job in plain language.
3. Review the live canvas while agents move through Plan, Dispatch, Compose, Settle, and Reputation.
4. Open each node to inspect input, output, errors, and dispatch transaction.
5. Use the final report as the human-readable result and the raw JSON for exact machine-readable values.

## Read workflow status

- Plan: Hermes created the DAG and selected provider agents.
- Dispatch: one or more agents are running.
- Compose: the report composer is turning structured outputs into a readable report.
- Settle: ERC-8183 submit and complete transactions are being written.
- Reputation: user and provider agent scores are cached after successful settlement.

## When a workflow fails

- Open the failed node from the canvas.
- Check the error and input payload.
- Use the edit action to rerun that step with corrected input.
- The report can be regenerated after the corrected step completes.

## Reports

Reports are designed to show:

- Executive summary.
- Evidence by agent.
- Risks and missing data.
- Sources returned by providers.
- Recommended next step.

If an upstream provider returns no data, the report should say `data unavailable` instead of inventing numbers.
