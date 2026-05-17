# Brief cho Manus — Bài viết kỹ thuật GigaWork v2

## Mục tiêu bài viết

Đăng lên cộng đồng kỹ thuật (Arc Forum / developer community). Đối tượng: developer hiểu blockchain + AI, chưa biết GigaWork. Cần hiểu được **tại sao thiết kế vậy** và **logic vận hành** mà không cần đọc code.

Tone: kỹ thuật nhưng rõ ràng. Có diagram. Không quá formal.

---

## 1. GigaWork là gì?

GigaWork là platform để **thuê AI agent thực hiện công việc và thanh toán on-chain tự động**.

User nhập một yêu cầu (ví dụ: "Phân tích token PEPE và gửi báo cáo qua Telegram"). Hệ thống tự:
- Lên kế hoạch: cần agent nào, thứ tự nào
- Gọi từng agent thu thập dữ liệu thực
- Tổng hợp thành báo cáo
- Khóa tiền vào smart contract → release khi xong việc
- Ghi uy tín lên blockchain

**Không cần tin tưởng**: tiền bị khóa trong contract, chỉ released khi AI thực sự hoàn thành và deliverable được xác nhận.

---

## 2. Ba chuẩn on-chain cốt lõi

### ERC-8183 — Agentic Commerce (Escrow)

**Vấn đề giải quyết:** Làm sao AI agent nhận thanh toán mà không cần trust?

**Logic:**
- Smart contract giữ USDC của user (escrow)
- Provider (AI platform) submit deliverable hash lên chain
- Evaluator (cũng là platform trong trường hợp này) xác nhận → USDC tự động chuyển

**4 trạng thái của một Job:**
```
Open → Funded → Submitted → Completed
```
- `Open`: Job được tạo, chưa có tiền
- `Funded`: User đã nạp USDC vào escrow, provider có thể bắt đầu
- `Submitted`: Provider đã submit hash của deliverable (keccak256 của báo cáo)
- `Completed`: Evaluator xác nhận → USDC released tự động

**Tại sao cần hash deliverable?**
Deliverable hash = keccak256(nội dung báo cáo). Ghi on-chain vĩnh viễn. Bất kỳ ai cũng có thể verify báo cáo thực sự khớp với hash đã commit. Đây là bằng chứng không thể sửa đổi.

**User flow (3 tx ký):**
1. User ký `createJob(provider, evaluator, budget, description)` — tạo job
2. Platform admin gọi `setBudget()` — xác nhận budget từ phía provider
3. User ký `approve(USDC)` + `fund(jobId)` — nạp tiền vào escrow

Sau bước 3 → tiền bị khóa → platform bắt đầu chạy AI.

**Sau khi AI xong:**
Platform gọi `submit(deliverableHash)` rồi `complete()` → USDC released.

---

### ERC-8004 — Agent Identity & Reputation

**Vấn đề giải quyết:** Làm sao biết AI agent nào đáng tin, đã làm được bao nhiêu việc?

ERC-8004 gồm 3 sub-module:

#### 2a. Identity Registry (NFT định danh)

Mỗi agent (cả AI skill và user) cần có NFT định danh trước khi tham gia hệ thống.

- **User**: Tự ký tx `register(agentURI)` → nhận tokenId. Đây là "chứng minh thư on-chain" của user.
- **Skill agent**: Platform admin mint NFT cho mỗi skill (crypto-scanner, whale-tracker, v.v.). Metadata lưu trên IPFS.

Tại sao cần NFT? Vì Reputation Registry và Validation Registry cần `agentId` (= tokenId) để ghi nhận lịch sử. Không có identity → không có reputation.

#### 2b. Reputation Registry

Sau mỗi workflow hoàn thành:
- Platform gọi `giveFeedback(agentId, score, feedbackType, tag)` cho **mỗi** agent đã tham gia
- Score `+95` nếu thành công, `-50` nếu thất bại
- Dữ liệu này public trên chain, bất kỳ ai cũng query được

**Self-dealing rule**: Contract có built-in rule: owner của một agentId **không thể** tự ghi feedback cho agent của mình (chống gian lận). Nếu vi phạm → revert.

**DB cache**: Ngoài on-chain, platform giữ `reputation_score` trong database để hiển thị nhanh. On-chain là source of truth, DB là cache.

#### 2c. Validation Registry (Agent Proof)

Ngoài điểm reputation, mỗi hoàn thành còn tạo "proof" on-chain:

```
validationRequest(validator, agentId, requestHash)
  → validationResponse(requestHash, response=100, tag="workflow_completed")
```

Response = 100 nghĩa là PASSED. Cặp request/response này tạo bằng chứng không thể sửa đổi rằng agent X đã hoàn thành công việc Y vào thời điểm Z.

---

### Hermes — AI Orchestration Engine

**Vấn đề giải quyết:** Ai/cái gì quyết định cần agent nào, chạy thứ tự nào?

Hermes là AI brain (powered by GPT-4.1). Nhận prompt từ user → tự động orchestrate toàn bộ workflow qua 3 tool calls bắt buộc theo thứ tự:

**Bước 1 — planWorkflow**: Hermes phân tích yêu cầu và tạo DAG (Directed Acyclic Graph) tối đa 4 node. Mỗi node là một skill agent cụ thể. Node không phụ thuộc nhau chạy song song.

Ví dụ với "Phân tích PEPE và thông báo Telegram":
```
[crypto-scanner] ──┐
[social-sentiment] ─→ [report-composer] → [telegram-sender]
[whale-tracker] ───┘
```
3 agent thu thập chạy song song → report-composer tổng hợp → telegram gửi đi.

**Bước 2 — dispatchSkill**: Thực thi từng node. Mỗi skill agent là một HTTP service độc lập. Hermes gọi từng cái, truyền input đúng schema, nhận output thực tế (giá token, sentiment score, giao dịch cá voi, v.v.).

**Bước 3 — finalizeReport**: Sau khi tất cả agent xong, Hermes tổng hợp dữ liệu thực thành báo cáo markdown. Trigger on-chain settlement.

**Tại sao phải enforce 3 bước?** Nếu Hermes skip planning → không có DAG → settlement không biết node nào. Nếu skip dispatch → không có dữ liệu thực → báo cáo fabricated. System prompt enforce thứ tự này cứng.

---

## 3. Luồng end-to-end (Full Flow)

```
User nhập prompt
       ↓
[Next.js API] tạo workflow, check identity NFT
       ↓
[ERC-8183] User ký 3 tx → USDC vào escrow
       ↓
[Hermes AI] planWorkflow → dispatchSkill×N → finalizeReport
       ↓
[ERC-8183] Platform gọi submit + complete → USDC released
       ↓
[ERC-8004] giveFeedback × mỗi agent (reputation)
[ERC-8004] validationRequest + validationResponse (proof)
       ↓
Workflow = completed ✓
```

**Thời gian thực tế (estimate):**
- Escrow setup: ~30-60s (3 tx on Arc Testnet)
- Hermes orchestration: 30-90s tùy số agent
- Settlement: ~10s (2 tx: submit + complete)
- Reputation: ~5-15s per agent (giveFeedback)

---

## 4. Thiết kế đáng chú ý

### Admin Queue (serialize tx)
Tất cả tx từ admin wallet (setBudget, submit, complete, giveFeedback, v.v.) đều chạy qua một queue tuần tự để tránh nonce collision. Đây là pattern quan trọng khi một wallet ký nhiều tx nhanh.

### Crash Recovery
Nếu Hermes crash giữa chừng (timeout, server restart), workflow bị kẹt ở trạng thái `running`. Hệ thống tự phát hiện: nếu không có activity trong 3 phút → xóa partial data → restart từ đầu. Không cần user can thiệp.

### Idempotency toàn bộ flow
Mỗi API endpoint đều safe để retry. Ví dụ: `/escrow/confirm` check xem workflow đã ở trạng thái `planning` chưa trước khi ghi. `giveFeedback` có feedbackHash để registry dedupe. Escrow confirm check on-chain job status trước khi gọi tiếp.

### RPC Fallback Chain
Arc Testnet đôi khi chậm. Khi chờ tx receipt, system thử lần lượt 5 RPC endpoint khác nhau (primary, drpc, quicknode, blockdaemon, v.v.) trước khi timeout.

### USDC là gas token
Arc Testnet dùng USDC thay ETH làm native gas. Cần custom chain definition trong viem vì default config dùng ETH symbol → break external wallet gas estimation.

---

## 5. Skill Agents hiện có

| Agent | Chức năng |
|-------|-----------|
| crypto-scanner | Phân tích on-chain token (holders, volume, liquidity) |
| trading-signals | Tín hiệu kỹ thuật: RSI, MACD, EMA, Bollinger |
| social-sentiment | Tâm lý Twitter/Reddit/Telegram về một topic |
| whale-tracker | Giao dịch lớn của ví cá voi |
| defi-yields | So sánh APY/APR các pool DeFi |
| web-intel | Tìm kiếm + tổng hợp tin tức/báo cáo |
| polymarket-pulse | Xác suất thị trường từ Polymarket |
| nft-floor-watch | Giá sàn + volume NFT collection |
| report-composer | Tổng hợp output các agent thành báo cáo |
| email-sender | Gửi báo cáo qua email |
| telegram-sender | Gửi báo cáo qua Telegram bot |

---

## 6. Chain & Infrastructure

- **Chain:** Arc Testnet (Chain ID: 5042002)
- **Gas token:** USDC (không phải ETH)
- **Explorer:** testnet.arcscan.app
- **AI Provider:** OpenAI GPT-4.1 (swap được sang Kimi K2, DeepSeek)
- **Wallet integration:** Privy (embedded + external wallets)
- **DB:** PostgreSQL (Supabase)
- **Frontend:** Next.js App Router

---

## 7. Những điểm còn đang phát triển

- **Self-dealing limitation**: Hiện tại platform admin vừa là provider vừa là evaluator trong ERC-8183. Cần tách vai trò này ra trong production để đảm bảo trustless thực sự.
- **Reputation on-chain**: Nếu admin own skill token NFT, ERC-8004 block `giveFeedback` (self-dealing rule). Score hiện được ghi DB, chờ giải pháp tách ownership.
- **Job expiry**: Chưa xử lý trường hợp escrow job hết hạn (user refund).
- **Multi-provider**: Hiện chỉ có một provider (admin). Roadmap: bất kỳ ai cũng có thể register làm provider skill.

---

## Gợi ý diagram cho bài viết

1. **Architecture diagram**: 3 layer — Browser / Next.js API / Arc Chain với các contract
2. **ERC-8183 state machine**: Open → Funded → Submitted → Completed (+ ai trigger mỗi bước)
3. **Full flow sequence**: User → Escrow → Hermes → Settlement → Reputation (chiều dọc, rõ thời gian)
4. **Hermes DAG example**: Ví dụ DAG phân tích crypto với 4 node song song → report-composer → telegram
5. **ERC-8004 relationship**: Identity NFT → feed vào Reputation Registry + Validation Registry
