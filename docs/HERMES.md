# Hermes — AI Orchestration Engine

Hermes là AI brain của GigaWork. Người dùng nhập một yêu cầu → Hermes tự động lên kế hoạch, gọi các agent, tổng hợp kết quả thành báo cáo.

Powered by OpenAI `gpt-4.1` (fallback `gpt-4o`). Hỗ trợ swap sang Kimi K2 hoặc DeepSeek qua env.

---

## Hermes làm gì?

Mỗi workflow chạy đúng 3 bước theo thứ tự:

**1. planWorkflow** — Lên kế hoạch  
Hermes phân tích yêu cầu và tạo danh sách tối đa 4 task (nodes). Mỗi node là một skill agent cụ thể với dependency rõ ràng.

**2. dispatchSkill** — Thực thi  
Gọi từng skill agent theo thứ tự dependency. Các node không phụ thuộc nhau chạy song song. Mỗi skill trả về dữ liệu thực (giá token, sentiment, yield, v.v.).

**3. finalizeReport** — Tổng hợp  
Sau khi tất cả agent xong, Hermes viết báo cáo markdown từ dữ liệu thực. Trigger on-chain settlement (ERC-8183) và ghi reputation (ERC-8004).

---

## Skill Agents hiện có

| Skill | Chức năng | Input cần |
|-------|-----------|-----------|
| `crypto-scanner` | Phân tích on-chain token | token_address, chain |
| `trading-signals` | Tín hiệu kỹ thuật (RSI, MACD, EMA) | symbol, timeframe, exchange |
| `social-sentiment` | Phân tích tâm lý cộng đồng | topic, window_hours, channels |
| `whale-tracker` | Theo dõi giao dịch cá voi | wallet, network, limit |
| `defi-yields` | So sánh lãi suất DeFi | top_n, min_tvl_usd, stablecoin_only |
| `web-intel` | Tìm kiếm + tổng hợp tin tức | query, max_results |
| `polymarket-pulse` | Dữ liệu prediction market | query, limit |
| `nft-floor-watch` | Giá sàn NFT collection | collection, chain |
| `report-composer` | Tổng hợp thành báo cáo | (nhận output từ các skill trên) |
| `email-sender` | Gửi email kết quả | subject, body_markdown |
| `telegram-sender` | Gửi Telegram kết quả | message, parse_mode |

---

## Giới hạn

- Tối đa 4 nodes/workflow
- Timeout 90 giây/stream
- Skill call timeout 20 giây

---

## Cấu hình

```env
AI_PROVIDER=openai          # openai | kimi | deepseek
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1        # optional, default gpt-4.1
```
