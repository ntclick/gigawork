# BẢN KHẢO SÁT & YÊU CẦU TƯ VẤN THIẾT KẾ KIẾN TRÚC (ARCHITECTURAL BRIEF)
> **Dành cho Agent phát triển tiếp theo**: Vui lòng đọc kỹ tài liệu này để hiểu bối cảnh dự án, các vấn đề hiện tại về hiệu năng (Speed) và tiêu chuẩn (Compliance), sau đó đề xuất giải pháp kỹ thuật chi tiết cùng code triển khai cụ thể.

---

## 1. Tổng quan dự án & Bối cảnh (Project Context)
Dự án **GigaWork v2** là một nền tảng điều phối AI Agent (Workflow Orchestration) chạy trên mạng thử nghiệm **Arc Testnet** (EVM L1 sử dụng USDC làm native gas, Chain ID: `5042002`). Nền tảng cho phép người dùng chạy các luồng công việc phức tạp (DAG) thông qua hệ thống quỹ ký thác (escrow), trong khi các kỹ năng (skills) đơn lẻ của Agent được thương mại hóa qua giao dịch vi mô (nanopayments).

### Tiêu chuẩn kỹ thuật đang áp dụng:
1. **ERC-8183 (Agentic Commerce Escrow):** Quản lý dòng tiền của toàn bộ workflow. Người dùng nạp tiền vào hợp đồng Escrow. Khi Orchestrator hoàn thành công việc và gửi mã hash kết quả lên chuỗi (`AgenticCommerce` tại `0x0747EEf0706327138c69792bF28Cd525089e4583`), tiền sẽ được giải ngân (settle).
2. **ERC-8004 (Agent Identity & Reputation):** Định danh Agent bằng NFT và lưu trữ chỉ số uy tín (`reputationScore`) cùng lịch sử giao dịch trên chuỗi.
3. **Circle x402 Protocol (M2M Nanopayments):** Giao thức thanh toán trực tiếp giữa các Agent khi gọi API kỹ năng thông qua HTTP:
   - Client gọi API kỹ năng tại `/api/agents/[name]` không kèm token thanh toán.
   - Server trả về mã lỗi `HTTP 402 Payment Required` kèm theo thử thách thanh toán (`accepts` challenge).
   - Client tự động ký một chữ ký EIP-3009 `TransferWithAuthorization` (gasless, off-chain) cho ví trung gian `GatewayWallet` (`0x0077777d7EBA4688BDeF3E311b846F25870A19B9`).
   - Client gửi lại request kèm Header `X-PAYMENT` chứa chữ ký được mã hóa Base64.
   - Server xác thực chữ ký bằng hàm mật mã học và trả về dữ liệu kết quả (HTTP 200), sau đó đưa chữ ký vào hàng đợi để thanh toán gộp (batch settlement) lên chuỗi.

---

## 2. Vấn đề cốt lõi: Tốc độ (Speed) vs. Tiêu chuẩn (Compliance)
Mục tiêu tối thượng của hệ thống là **Speed (Tốc độ tối đa)** khi thực hiện các luồng công việc có chiều sâu lớn (DAG có 10+ bước phụ thuộc tuần tự). Tuy nhiên, kiến trúc hiện tại gặp xung đột lớn:

### Cách A: Chạy In-Memory trực tiếp (Serverless In-Memory Execution)
- **Cách làm:** LLM Planner xuất ra sơ đồ DAG. Server gọi trực tiếp hàm xử lý trong code (Node.js Promises) mà không đi qua các API endpoint HTTP thực tế.
- **Ưu điểm:** Cực nhanh (< 5 giây cho luồng 10 bước). Không tốn chi phí roundtrip mạng, không lo timeout.
- **Nhược điểm (VI PHẠM TIÊU CHUẨN):** Bỏ qua hoàn toàn cơ chế xác thực và cổng thanh toán x402 HTTP. Các Agent không thực sự thanh toán cho nhau qua API, biến hệ thống phi tập trung trở thành một ứng dụng monolithic thông thường.

### Cách B: Chạy qua HTTP Song song (Parallel HTTP Orchestration)
- **Cách làm:** Server gọi HTTP thực tế đến `/api/agents/[name]`, bắt mã lỗi `402`, tạo chữ ký EIP-3009, gắn vào header `X-PAYMENT` rồi gọi lại. Các bước độc lập được chạy song song.
- **Ưu điểm:** Đúng chuẩn Circle x402 và ERC-8183/8004.
- **Nhược điểm (RẤT CHẬM):** Đối với các chuỗi xử lý tuần tự sâu (Sequential DAG), thời gian thực hiện quá lâu do phải thực hiện nhiều TLS handshake, xử lý cryptographic signing EIP-712 trên CPU, và các vòng lặp request-response. Hệ thống chạy trên Next.js Vercel bị giới hạn timeout **120 giây** và LLM tool call bị giới hạn bước (ví dụ: `stepCountIs(10)`).

---

## 3. Các yêu cầu thiết kế cần giải quyết (Questions & Tasks for the Agent)

### Vấn đề 1: Tối ưu hóa/Loại bỏ vòng lặp HTTP Challenge-Response chủ động
*Làm sao để sub-agent gọi nhau không cần phải thực hiện toàn bộ luồng `402 Challenge -> Sign -> Retry` cho từng API đơn lẻ?*
- Có giải pháp nào cho phép Buyer Agent (hoặc Orchestrator đại diện cho Buyer) **ủy quyền trước (pre-authorize)** hoặc **ký gộp (batch sign/delegate)** một lượng ví dụ 10 chữ ký EIP-3009 ngay từ đầu luồng công việc không?
- Có thể dùng kênh thanh toán (State Channels / Payment Channels) giữa các Agent để thanh toán off-chain tức thì, rồi chỉ settle lên chuỗi khi kết thúc luồng không?
- Nếu chúng ta tạm tắt hoặc lược bớt nanopayment ở các bước trung gian (hoặc thay bằng hình thức ghi nợ in-memory được bảo chứng bởi ERC-8183 escrow chung), điều đó có vi phạm tiêu chuẩn Circle x402 không? Phương án nào tối ưu nhất vừa đảm bảo tốc độ vừa tuân thủ tiêu chuẩn?

### Vấn đề 2: Giải quyết giới hạn Serverless Timeout (120s) trên Next.js
*Làm sao để chạy các luồng dài (> 10 bước tuần tự sâu) mà không bị chết timeout 120s của Vercel/Next.js API?*
- Đề xuất kiến trúc Hàng đợi bất đồng bộ (Asynchronous Message Queue / Worker - ví dụ: BullMQ + Redis hoặc background job).
- Cách gửi cập nhật thời gian thực (Real-time logs) từ background worker về trình duyệt của người dùng (sử dụng Server-Sent Events - SSE hoặc WebSockets) để giao diện hiển thị mượt mà.

### Vấn đề 3: Quản lý Nonce và RPC Rate Limits dưới tải cao
- Khi chạy song song nhiều Agent cùng lúc, làm thế nào để tránh xung đột nonce (nonce collision) khi ghi nhận lịch sử uy tín (reputation score) và lưu trữ bằng chứng hoàn thành (attestation proof) lên chuỗi mạng Arc?
- Có nên thiết kế một bộ đệm Nonce (Nonce Tracker / Queue) ở Server-side không?

### Vấn đề 4: Hiển thị Log và Hiệu ứng tương tác giữa các Agent (Agent Theater UI)
- Người dùng muốn thấy tốc độ chạy cực nhanh, trực quan hóa luồng dữ liệu, hiển thị hiệu ứng các Agent đang giao tiếp, trao đổi logs, và thanh toán tiền cho nhau theo thời gian thực trên UI.
- Cần thiết kế API và luồng dữ liệu UI như thế nào để cung cấp đầy đủ thông tin chi tiết về: *Agent nào đang gọi Agent nào, phí bao nhiêu USDC, chữ ký EIP-3009 nào đã dùng, log nghiệp vụ là gì?*

---

## 4. Các file mã nguồn chính trong Codebase cần lưu ý

1. **Cấu hình & Middleware Xác thực Nanopayments:**
   - [lib/chain/nanopayments.ts](file:///f:/Work/Cryoto/agent%20arc/gigawork-v2/lib/chain/nanopayments.ts): Nơi chứa logic xác thực chữ ký EIP-3009, kiểm tra ví Gateway, và hàng đợi lưu trữ in-memory.
   - [app/api/agents/[name]/route.ts](file:///f:/Work/Cryoto/agent%20arc/gigawork-v2/app/api/agents/%5Bname%5D/route.ts): API Endpoint đóng vai trò cổng chặn HTTP 402.

2. **Hệ thống Điều phối (Brain Orchestration):**
   - [lib/ai/brain.ts](file:///f:/Work/Cryoto/agent%20arc/gigawork-v2/lib/ai/brain.ts): Tiến trình điều phối chính (Kimi K2 LLM).
   - [lib/ai/tools.ts](file:///f:/Work/Cryoto/agent%20arc/gigawork-v2/lib/ai/tools.ts): Chứa tool `dispatchSkill` và `finalizeReport` điều khiển luồng chạy của các node kỹ năng.
   - [lib/skills/handlers.ts](file:///f:/Work/Cryoto/agent%20arc/gigawork-v2/lib/skills/handlers.ts): Code xử lý nghiệp vụ thực tế của 13 kỹ năng hiện tại (crypto-scanner, trading-signals, email-sender, v.v.).
   - [lib/skills/registry.ts](file:///f:/Work/Cryoto/agent%20arc/gigawork-v2/lib/skills/registry.ts): Đăng ký và điều phối gọi cục bộ (in-process) hoặc gọi từ xa qua HTTP.

3. **Kịch bản kiểm thử (Simulated Buyer Agent):**
   - [scripts/test-buyer-agent.ts](file:///f:/Work/Cryoto/agent%20arc/gigawork-v2/scripts/test-buyer-agent.ts): Script chạy thử nghiệm toàn bộ luồng HTTP 402 challenge/response thực tế từ phía Client Agent.

---

## YÊU CẦU ĐỐI VỚI AGENT NHẬN NHIỆM VỤ:
Hãy phân tích kỹ các file trên, đề xuất một **Kế hoạch triển khai mã nguồn cụ thể (Code Implementation Plan)** để:
1. Đảm bảo tốc độ tổng thể nhanh gấp 5-10 lần (mục tiêu chạy luồng dưới 15 giây).
2. Xây dựng cơ chế hàng đợi chạy ngầm (Background Execution) + luồng cập nhật log qua SSE.
3. Giải quyết bài toán pre-authorization cho các thanh toán Circle x402 để giảm thiểu số lượng vòng lặp HTTP roundtrip.
4. Trình bày chi tiết cấu trúc dữ liệu hoặc các thay đổi trong database (nếu cần).
