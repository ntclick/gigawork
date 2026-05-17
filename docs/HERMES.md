# Hermes AI Orchestration

> **Manus note:** File này mô tả cách Hermes (AI brain) hoạt động. Cần 3 diagram:
> 1. Tool call sequence: planWorkflow → dispatchSkill×N → finalizeReport
> 2. State transitions của node: pending → running → completed/failed
> 3. Auto-finalize logic tree (khi nào tự động publish report)

## Tổng quan

Hermes là AI brain của GigaWork — nhận prompt từ user, lập kế hoạch, dispatch các skill agent, tổng hợp kết quả và publish báo cáo cuối cùng.

**Powered by:** OpenAI (mặc định `gpt-4.1`), hỗ trợ Kimi K2 và DeepSeek

---

## 3 Tool Calls của Hermes

### Tool 1: planWorkflow

**Mục đích:** Tạo DAG (Directed Acyclic Graph) các node cần thực hiện.

**Input:**
```json
{
  "nodes": [
    {
      "id": "n1",
      "label": "Scan PEPE on Ethereum",
      "skill_name": "crypto-scanner",
      "depends_on": []
    },
    {
      "id": "n2",
      "label": "Compose report",
      "skill_name": "report-composer",
      "depends_on": ["n1"]
    }
  ]
}
```

**Quy tắc:**
- Tối đa **4 nodes** (bao gồm report-composer)
- Node không phụ thuộc nhau (depth=0) chạy song song
- `report-composer` luôn là node cuối, phụ thuộc vào tất cả node trước
- Label phải là **action verb** ("Scan PEPE", không phải "Step 1")

**DB effect:**
```
INSERT nodes (workflowId, kind, label, skillId, status=pending, dependsOn)
UPDATE workflows SET status=running
INSERT messages (toolName=planWorkflow, toolPayload={output: nodes})
```

---

### Tool 2: dispatchSkill

**Mục đích:** Thực thi một skill agent và lấy kết quả.

**Input:**
```json
{
  "node_id": "uuid-of-node",
  "skill_name": "crypto-scanner",
  "input": {
    "token_address": "0x...",
    "chain": "ethereum"
  }
}
```

**Luồng xử lý:**

> **Manus note:** Vẽ flowchart chi tiết dispatchSkill. Bao gồm: node claim, credential injection, credit charge, skill HTTP call, output save.

```
1. Resolve node_id (UUID hoặc slug → DB lookup)
2. Kiểm tra node đã completed chưa (idempotent return)
3. CLAIM: UPDATE nodes SET status=running WHERE status IN (pending, failed)
4. Inject user credentials (email/telegram skills)
5. Charge credits: query manifest.cost_credits → chargeCredits(userId, cost)
6. HTTP call: POST skill.endpoint với timeout=20s
7. UPDATE nodes SET status=completed, output=result
8. INSERT messages (toolName=dispatchSkill, toolPayload={...})
9. Redact secrets (bot_token, api_key → "••••xxxx")
10. autoPublishIfWorkflowReady() → nếu tất cả nodes done
```

**Credit system:**
- Mỗi skill có `cost_credits` trong manifest (thường 10-50 credits)
- `InsufficientCreditsError` → trả về error 402
- Không charge nếu skill free (cost=0)

**Credential injection (tự động):**

| Skill | Inject tự động |
|-------|---------------|
| `email-sender` | `to`, `api_key`, `from` từ users table |
| `telegram-sender` | `chat_id`, `bot_token` từ users table |

---

### Tool 3: finalizeReport

**Mục đích:** Publish báo cáo cuối cùng và trigger settlement.

**Input:**
```json
{
  "summary_markdown": "# Báo cáo\n...",
  "raw_json": { "findings": [...] }
}
```

**Validation trước khi publish:**
1. Tất cả nodes phải ở trạng thái terminal (completed/failed)
2. Phải có ít nhất 1 `dispatchSkill` call
3. `raw_json` được enrich với output của tất cả nodes

**Sau khi publish:**
```
publishFinalReport()
  → settleWorkflowJob() [ERC-8183: submit + complete]
  → cacheReputation()   [ERC-8004: DB +1 + on-chain giveFeedback]
  → attestWorkflow()    [ERC-8004: validationRequest + Response]
  → UPDATE workflows: status=completed
```

---

## Auto-Finalize Logic

Hermes có thể không gọi `finalizeReport` (stream kết thúc đột ngột). Hệ thống có nhiều cơ chế tự động:

> **Manus note:** Vẽ decision tree / flowchart cho auto-finalize. Nhiều nhánh phức tạp.

```
streamText.onFinish({ text, finishReason })
  │
  ├── alreadyFinalized? → EXIT (idempotent)
  │
  ├── dispatchCount == 0?
  │     → INSERT stream_error message
  │     → failWorkflow()
  │
  ├── text.length > 0 && !allTerminal?
  │     → persistIncompleteWorkflow() + failWorkflow()
  │
  ├── text.length > 0 && allTerminal?
  │     → publishFinalReport(text) [toolName=auto_finalize]
  │
  ├── text.length == 0 && allTerminal && report-composer completed?
  │     → tìm markdown từ report-composer output
  │     → publishFinalReport(composerMarkdown)
  │
  └── finishReason != "tool-calls"?
        → failWorkflow()
```

---

## Crash Recovery

**Scenario:** Brain stream crash (timeout, network, server restart) → workflow stuck ở `running`.

**Phát hiện:** `STALE_RUNNING_MS = 3 phút` kể từ lần cuối có activity (message mới nhất).

**Recovery flow:**

```
POST /api/workflow/[id]/stream (request mới)
  → Nếu status=running + không có activity > 3 phút:
      DELETE nodes WHERE workflowId=id
      DELETE messages WHERE workflowId=id
      UPDATE workflows SET status=planning
  → Tiếp tục như workflow bình thường mới
```

**Client-side (page.tsx):**
```
Nếu snapshot.status=running && status=ready (useChat idle):
  → delay 1.5s
  → setMessages([])
  → sendMessage(workflow.prompt)  [trigger recovery]
```

---

## Model Configuration

| Provider | Key | Model mặc định | Fallback |
|---------|-----|---------------|---------|
| OpenAI | `OPENAI_API_KEY` | `gpt-4.1` | `gpt-4o` |
| Kimi | `KIMI_API_KEY` | `kimi-k2-0905-preview` | `moonshot-v1-128k` |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek-chat` | _(none)_ |

**Model probe:** Mỗi khi cold start, hệ thống ping `/chat/completions` với `max_tokens=1` để kiểm tra model availability. Nếu 404/403 → tự động fallback.

**Timeout:** 90 giây hard limit (`AbortSignal.timeout(90_000)`)

---

## Skill Registry

Các skill được seed vào DB qua `/api/admin/seed-skills` hoặc `scripts/seed-skills.ts`.

Mỗi skill có:
- `name`: slug (ví dụ: `crypto-scanner`)
- `manifest`: JSON với `description`, `category`, `cost_credits`, `input_schema`, `best_for_keywords`
- `endpoint`: URL của skill server
- `agent_token_id`: Identity NFT (sau khi mint)

> **Manus note — TODO:** Cần danh sách đầy đủ tất cả skill hiện có với `input_schema` và cost. Thông tin này ở trong DB, không hard-code trong code.

---

## Giới hạn hiện tại

| Giới hạn | Giá trị | Ghi chú |
|---------|---------|--------|
| Max nodes/workflow | 4 | Có thể điều chỉnh trong HERMES_SYSTEM_PROMPT |
| Max tool steps | 10 | `stopWhen: stepCountIs(10)` |
| Stream timeout | 90s | AbortSignal.timeout |
| Max request duration | 120s | `maxDuration = 120` trong route |
| Skill HTTP timeout | 20s | Per-skill call |
| Stale workflow recovery | 3 phút | Sau đó wipe + retry |
