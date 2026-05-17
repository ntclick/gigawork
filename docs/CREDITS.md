# Credits & Payments

> **Manus note:** Vẽ diagram luồng credits: signup bonus → charge per skill → topup.

## Tổng quan

Credits là đơn vị nội bộ dùng để trả phí cho skill agents. 1 credit ≈ 1 đơn vị chi phí compute. Credits được mua bằng USDC hoặc cấp free khi signup.

---

## Credit Lifecycle

```
User signup → +300 credits (signup bonus, 1 lần duy nhất)
                    ↓
User topup  → +N credits (mua bằng USDC)
                    ↓
dispatchSkill → -cost_credits (mỗi skill call)
```

---

## Signup Bonus

```
grantSignupBonus(userId)
  → Kiểm tra: có ledger row với reason="signup_grant" chưa?
  → Nếu chưa:
      INSERT credit_ledger (delta=+300, reason="signup_grant")
      UPDATE users SET credits=credits+300
  → Trả về user row mới
```

Được gọi từ:
- `/api/identity/confirm` (sau khi mint identity NFT)
- `/api/me` (auto-sync nếu user chưa có bonus)

**Giá trị:** `SIGNUP_GRANT = 300` credits (constant trong service.ts)

---

## Topup

```
POST /api/me/topup
  → Nhận: { txHash, usdcAmount }
  → Verify tx on-chain: target=USDC, function=transfer, to=PLATFORM_WALLET
  → INSERT credit_ledger (delta=+N, reason="topup", tx_hash=txHash)
  → UPDATE users SET credits+=N
```

**Chống replay:** `UNIQUE` constraint trên `credit_ledger.tx_hash` → `DuplicateTopupError` nếu cùng tx hash.

> **Manus note — TODO:** Cần thêm thông tin về tỉ lệ USDC → credits (1 USDC = ? credits). Chưa thấy constant này trong code.

---

## Charge per Skill

```
dispatchSkill → chargeCredits(userId, cost)
  → Kiểm tra: users.credits >= cost
  → Nếu không: throw InsufficientCreditsError(have, need)
  → UPDATE users SET credits=credits-cost
  → INSERT credit_ledger (delta=-cost, reason="skill_dispatch", workflowId)
```

**Nếu thiếu credits:**
- Brain nhận lỗi `InsufficientCreditsError`
- Trả về `{ ok: false, error: "Insufficient credits: have X, need Y" }`
- Node status → failed
- Workflow có thể vẫn tiếp tục với các node khác

---

## Bảng credit_ledger

| Column | Type | Mô tả |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK → users |
| delta | integer | +N (topup/bonus) hoặc -N (charge) |
| reason | text | "signup_grant", "topup", "skill_dispatch" |
| workflow_id | uuid | FK → workflows (nullable) |
| tx_hash | text | UNIQUE — ngăn replay topup |
| created_at | timestamp | |

---

## Error Classes

```typescript
class InsufficientCreditsError extends Error {
  constructor(have: number, need: number)
  // message: "Insufficient credits: have X, need Y"
}

class DuplicateTopupError extends Error {
  constructor(txHash: string)
  // message: "Topup already processed: 0x..."
}
```
