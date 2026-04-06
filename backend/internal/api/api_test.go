package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gigawork/internal/auth"
	"gigawork/internal/db"
)

// ═══════════════════════════════════════════════════════════════
//  Mock Supabase PostgREST server
// ═══════════════════════════════════════════════════════════════

// mockSupabase returns a test HTTP server that responds like Supabase PostgREST.
// Routes are matched by URL path prefix and query params.
func mockSupabase() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		path := r.URL.Path // e.g. /rest/v1/agents

		switch {
		// ─── Agents ──────────────────────────────────────
		case strings.Contains(path, "/agents"):
			if r.Method == "GET" {
				rawQuery := r.URL.RawQuery

				// Check if any filter references a not-found address
				if strings.Contains(rawQuery, "0xnotfound") {
					w.Write([]byte(`[]`))
					return
				}

				// Single agent lookup (has or= or address= filter)
				orFilter := r.URL.Query().Get("or")
				idFilter := r.URL.Query().Get("address")
				if idFilter != "" || orFilter != "" {
					// Single agent lookup
					w.Write([]byte(`[{"address":"0xagent1","name":"Test Agent","id":"test-agent","is_active":true,"is_system":false,"visible_on_marketplace":true,"reputation_score":750,"skill_tags":["research"],"erc8004_token_id":42,"hourly_rate_usdc":0.1,"pricing":{"per_call_usdc":0.1,"reuse_price_usdc":0.04,"trial_available":true,"failure_policy":"no_charge"},"status":"active","trust_score":85}]`))
					return
				}
				// List agents
				w.Write([]byte(`[{"address":"0xagent1","name":"Agent Alpha","id":"agent-alpha","is_active":true,"reputation_score":750,"skill_tags":["llm"]},{"address":"0xagent2","name":"Agent Beta","id":"agent-beta","is_active":true,"reputation_score":600,"skill_tags":["scraping"]}]`))
				return
			}
			if r.Method == "POST" || r.Method == "PATCH" {
				w.WriteHeader(http.StatusCreated)
				w.Write([]byte(`{}`))
				return
			}

		// ─── Jobs ────────────────────────────────────────
		case strings.Contains(path, "/jobs"):
			if r.Method == "GET" {
				jobFilter := r.URL.Query().Get("job_id")
				if jobFilter != "" && strings.Contains(jobFilter, "99999") {
					w.Write([]byte(`[]`))
					return
				}
				if jobFilter != "" {
					w.Write([]byte(`[{"job_id":1,"employer":"0xclient","status":"OPEN","job_type":"ONCHAIN"}]`))
					return
				}
				// List jobs
				w.Write([]byte(`[{"job_id":1,"employer":"0xclient","status":"ACTIVE","job_type":"ONCHAIN"},{"job_id":2,"employer":"0xclient","status":"PENDING_FUND","job_type":"SCRAPING"},{"job_id":3,"employer":"0xclient","status":"COMPLETED","job_type":"AI"}]`))
				return
			}
			if r.Method == "POST" || r.Method == "PATCH" {
				w.WriteHeader(http.StatusCreated)
				w.Write([]byte(`{}`))
				return
			}

		// ─── Bids ────────────────────────────────────────
		case strings.Contains(path, "/bids"):
			if r.Method == "POST" {
				w.WriteHeader(http.StatusCreated)
				w.Write([]byte(`{}`))
				return
			}
			w.Write([]byte(`[]`))
			return

		// ─── Users ───────────────────────────────────────
		case strings.Contains(path, "/users"):
			if r.Method == "GET" {
				w.Write([]byte(`[{"address":"0xagent1","roles":["client","agent_operator"]}]`))
				return
			}
			if r.Method == "POST" || r.Method == "PATCH" {
				w.WriteHeader(http.StatusCreated)
				w.Write([]byte(`{}`))
				return
			}

		// ─── Trial runs ──────────────────────────────────
		case strings.Contains(path, "/trial_runs"):
			w.Write([]byte(`[]`))
			return

		// ─── Shared store ────────────────────────────────
		case strings.Contains(path, "/shared_store"):
			w.Write([]byte(`[]`))
			return

		// ─── Job events ──────────────────────────────────
		case strings.Contains(path, "/job_events"):
			if r.Method == "POST" {
				w.WriteHeader(http.StatusCreated)
			}
			w.Write([]byte(`{}`))
			return

		default:
			w.Write([]byte(`[]`))
		}
	}))
}

// ═══════════════════════════════════════════════════════════════
//  Test server setup
// ═══════════════════════════════════════════════════════════════

func newTestServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()

	mockSB := mockSupabase()
	dbClient := db.NewClient(mockSB.URL, "test-service-key")

	secret := []byte("test-auth-secret-32byteslong!!!!!")
	webhookSecret := []byte("test-webhook-secret-32byteslong!")

	srv := NewServer(dbClient, nil, secret, webhookSecret, nil)

	return srv, mockSB
}

func doRequest(t *testing.T, router http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reqBody *strings.Reader
	if body != "" {
		reqBody = strings.NewReader(body)
	} else {
		reqBody = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, reqBody)
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "127.0.0.1:12345"
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func doRequestWithCookie(t *testing.T, router http.Handler, method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var reqBody *strings.Reader
	if body != "" {
		reqBody = strings.NewReader(body)
	} else {
		reqBody = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, reqBody)
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "127.0.0.1:12345"
	if cookie != nil {
		req.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

// ═══════════════════════════════════════════════════════════════
//  TEST 1: Health
// ═══════════════════════════════════════════════════════════════

func TestHealth(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	w := doRequest(t, srv.Router, "GET", "/health", "")

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), `"status":"ok"`) {
		t.Fatalf("expected status ok, got %s", w.Body.String())
	}
}

// ═══════════════════════════════════════════════════════════════
//  TEST 2: Get Agents
// ═══════════════════════════════════════════════════════════════

func TestGetAgents(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	w := doRequest(t, srv.Router, "GET", "/agents/", "")

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var agents []map[string]any
	json.Unmarshal(w.Body.Bytes(), &agents)
	if len(agents) != 2 {
		t.Fatalf("expected 2 agents, got %d", len(agents))
	}
}

// ═══════════════════════════════════════════════════════════════
//  TEST 3: Get Agents with active filter
// ═══════════════════════════════════════════════════════════════

func TestGetAgents_FilterActive(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	w := doRequest(t, srv.Router, "GET", "/agents/?active=true", "")

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ═══════════════════════════════════════════════════════════════
//  TEST 4: Get Agent — Not Found
// ═══════════════════════════════════════════════════════════════

func TestGetAgent_NotFound(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	w := doRequest(t, srv.Router, "GET", "/agents/0xnotfound", "")

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ═══════════════════════════════════════════════════════════════
//  TEST 5: Auth — Get Nonce
// ═══════════════════════════════════════════════════════════════

func TestAuth_GetNonce(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	w := doRequest(t, srv.Router, "GET", "/auth/nonce?address=0x1234567890abcdef1234567890abcdef12345678", "")

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]string
	json.Unmarshal(w.Body.Bytes(), &resp)

	if resp["nonce"] == "" {
		t.Fatal("expected nonce in response")
	}
	if !strings.Contains(resp["message"], "0x1234567890abcdef1234567890abcdef12345678") {
		t.Fatalf("message should contain address, got: %s", resp["message"])
	}
}

// ═══════════════════════════════════════════════════════════════
//  TEST 6: Auth — Nonce requires valid address
// ═══════════════════════════════════════════════════════════════

func TestAuth_GetNonce_BadAddress(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	w := doRequest(t, srv.Router, "GET", "/auth/nonce?address=short", "")

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ═══════════════════════════════════════════════════════════════
//  TEST 7: Auth — Verify with invalid signature
// ═══════════════════════════════════════════════════════════════

func TestAuth_VerifyInvalidSignature(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	addr := "0x1234567890abcdef1234567890abcdef12345678"

	// Get a nonce first
	w := doRequest(t, srv.Router, "GET", "/auth/nonce?address="+addr, "")
	var nonceResp map[string]string
	json.Unmarshal(w.Body.Bytes(), &nonceResp)

	// Send bogus signature
	body := fmt.Sprintf(`{"address":"%s","signature":"0xdeadbeef","nonce":"%s"}`, addr, nonceResp["nonce"])
	w = doRequest(t, srv.Router, "POST", "/auth/verify", body)

	if w.Code != 401 {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

// ═══════════════════════════════════════════════════════════════
//  TEST 8: Auth — /me not authenticated
// ═══════════════════════════════════════════════════════════════

func TestAuth_Me_NotAuthenticated(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	w := doRequest(t, srv.Router, "GET", "/auth/me", "")

	if w.Code != 401 {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ═══════════════════════════════════════════════════════════════
//  TEST 9: Auth — /me with valid session cookie
// ═══════════════════════════════════════════════════════════════

func TestAuth_Me_Authenticated(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	// Create a valid session cookie directly
	cookie := auth.CreateSessionCookie("0xagent1", srv.AuthSecret)

	w := doRequestWithCookie(t, srv.Router, "GET", "/auth/me", "", cookie)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["address"] != "0xagent1" {
		t.Fatalf("expected address 0xagent1, got %v", resp["address"])
	}
}

// ═══════════════════════════════════════════════════════════════
//  TEST 10: Create Job
// ═══════════════════════════════════════════════════════════════

func TestCreateJob(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	body := `{"job_id":100,"employer":"0xclient","job_type":"ONCHAIN","hourly_rate_usdc":10,"estimated_hours":5}`
	w := doRequest(t, srv.Router, "POST", "/jobs/", body)

	if w.Code != 201 {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var job map[string]any
	json.Unmarshal(w.Body.Bytes(), &job)
	if job["status"] != "PENDING_FUND" {
		t.Fatalf("expected status PENDING_FUND, got %v", job["status"])
	}
}

// ═══════════════════════════════════════════════════════════════
//  TEST 11: Create Job — missing body
// ═══════════════════════════════════════════════════════════════

func TestCreateJob_MissingBody(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	w := doRequest(t, srv.Router, "POST", "/jobs/", "not json")

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ═══════════════════════════════════════════════════════════════
//  TEST 12: Get Jobs
// ═══════════════════════════════════════════════════════════════

func TestGetJobs(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	w := doRequest(t, srv.Router, "GET", "/jobs/", "")

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var jobs []map[string]any
	json.Unmarshal(w.Body.Bytes(), &jobs)
	if len(jobs) != 3 {
		t.Fatalf("expected 3 jobs, got %d", len(jobs))
	}
}

// ═══════════════════════════════════════════════════════════════
//  TEST 13: Get Job — Not Found
// ═══════════════════════════════════════════════════════════════

func TestGetJob_NotFound(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	w := doRequest(t, srv.Router, "GET", "/jobs/99999", "")

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ═══════════════════════════════════════════════════════════════
//  TEST 14: Submit Bid
// ═══════════════════════════════════════════════════════════════

func TestSubmitBid(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	body := `{"agent_address":"0xagent1","proposed_rate":10.0,"note":"I can do this"}`
	w := doRequest(t, srv.Router, "POST", "/jobs/1/bid", body)

	// Should succeed — job exists (mock returns ACTIVE job for id=1)
	if w.Code != 200 && w.Code != 201 {
		t.Fatalf("expected 200/201, got %d: %s", w.Code, w.Body.String())
	}
}

// ═══════════════════════════════════════════════════════════════
//  TEST 15: Get Stats
// ═══════════════════════════════════════════════════════════════

func TestGetStats(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	w := doRequest(t, srv.Router, "GET", "/stats", "")

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var stats map[string]any
	json.Unmarshal(w.Body.Bytes(), &stats)
	if _, ok := stats["total_jobs"]; !ok {
		t.Fatal("expected total_jobs in stats")
	}
	if _, ok := stats["total_agents"]; !ok {
		t.Fatal("expected total_agents in stats")
	}
}

// ═══════════════════════════════════════════════════════════════
//  TEST 16: Logout
// ═══════════════════════════════════════════════════════════════

func TestLogout(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	w := doRequest(t, srv.Router, "POST", "/auth/logout", "")

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	// Check that a cookie-clearing Set-Cookie header was sent
	cookies := w.Result().Cookies()
	found := false
	for _, c := range cookies {
		if c.Name == "gigawork_session" && c.MaxAge < 0 {
			found = true
		}
	}
	if !found {
		t.Fatal("expected session cookie to be cleared")
	}
}

// ═══════════════════════════════════════════════════════════════
//  TEST 17: Rate Limit — Global (60/min)
// ═══════════════════════════════════════════════════════════════

func TestRateLimit_Global(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	// Reset the global limiter for isolated test
	// Use a unique IP so other tests don't interfere
	testIP := fmt.Sprintf("10.99.%d.1:9999", time.Now().UnixNano()%255)

	var lastCode int
	hitLimit := false

	for i := 0; i < 65; i++ {
		req := httptest.NewRequest("GET", "/health", nil)
		req.RemoteAddr = testIP
		w := httptest.NewRecorder()
		srv.Router.ServeHTTP(w, req)
		lastCode = w.Code

		if w.Code == 429 {
			hitLimit = true
			if i < 60 {
				t.Fatalf("rate limited too early at request %d", i+1)
			}
			break
		}
	}

	if !hitLimit {
		t.Fatalf("expected 429 after 60 requests, last code was %d", lastCode)
	}
}

// ═══════════════════════════════════════════════════════════════
//  TEST 18: Rate Limit — Agent Run (10/min)
// ═══════════════════════════════════════════════════════════════

func TestRateLimit_AgentRun(t *testing.T) {
	srv, mockSB := newTestServer(t)
	defer mockSB.Close()

	testIP := fmt.Sprintf("10.88.%d.1:9999", time.Now().UnixNano()%255)

	body := `{"schema_version":"1.0","inputs":{"url":"https://test.com"},"wallet":"0xtest"}`
	hitLimit := false

	for i := 0; i < 15; i++ {
		req := httptest.NewRequest("POST", "/agents/0xagent1/run", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = testIP
		w := httptest.NewRecorder()
		srv.Router.ServeHTTP(w, req)

		if w.Code == 429 {
			hitLimit = true
			if i < 10 {
				t.Fatalf("agent run rate limited too early at request %d", i+1)
			}
			break
		}
	}

	if !hitLimit {
		t.Fatal("expected 429 after 10 agent run requests")
	}
}
