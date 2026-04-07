package api

import (
	"net/http"
	"os"
	"strings"

	"gigawork/internal/auth"
	"gigawork/internal/chain"
	"gigawork/internal/chain/bindings"
	"gigawork/internal/db"
	"gigawork/internal/matching"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// allowedOrigins is loaded once from ALLOWED_ORIGINS env var.
// Defaults to localhost dev servers if not set.
var allowedOrigins = func() []string {
	env := os.Getenv("ALLOWED_ORIGINS")
	if env != "" {
		var origins []string
		for _, o := range strings.Split(env, ",") {
			if trimmed := strings.TrimSpace(o); trimmed != "" {
				origins = append(origins, trimmed)
			}
		}
		return origins
	}
	return []string{
		"http://localhost:8181",
		"http://localhost:8080",
		"http://localhost:3000",
		"http://localhost:3001",
		"https://gigawork.vercel.app",
	}
}()

func isAllowedOrigin(origin string) bool {
	for _, allowed := range allowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}

type Server struct {
	DB               *db.Client
	Matching         *matching.Engine
	ChainClient      *chain.Client
	IdentityRegistry *bindings.IdentityRegistryCaller
	Nonces           *auth.NonceStore
	AuthSecret       []byte
	WebhookSecret    []byte
	Router           chi.Router
}

func NewServer(dbClient *db.Client, matchingEngine *matching.Engine, chainClient *chain.Client, authSecret []byte, webhookSecret []byte, identityRegistry *bindings.IdentityRegistryCaller) *Server {
	s := &Server{
		DB:               dbClient,
		Matching:         matchingEngine,
		ChainClient:      chainClient,
		IdentityRegistry: identityRegistry,
		Nonces:           auth.NewNonceStore(),
		AuthSecret:       authSecret,
		WebhookSecret:    webhookSecret,
		Router:           chi.NewRouter(),
	}

	// ─── Middleware ──────────────────────────────────────
	s.Router.Use(middleware.SetHeader("Content-Type", "application/json"))
	s.Router.Use(corsMiddleware)
	s.Router.Use(RateLimitByIP)

	// ─── Health ──────────────────────────────────────────
	s.Router.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	// ─── Auth ────────────────────────────────────────────
	s.Router.Route("/auth", func(r chi.Router) {
		r.Get("/nonce", s.GetNonce)
		r.Post("/verify", s.VerifySignature)
		r.Get("/me", s.GetMe)
		r.Post("/privy-send-otp", s.PrivySendOTP)
		r.Post("/privy-verify", s.PrivyVerify)
		r.Post("/logout", s.Logout)
	})

	// ─── Metadata (ERC-8004 / ERC-8183) ──────────────────
	s.Router.Route("/metadata", func(r chi.Router) {
		r.Get("/agents/{address}", s.GetAgentMetadata)
	})

	// ─── Stats & Analytics ───────────────────────────────
	s.Router.Get("/stats", s.GetStats)
	s.Router.Route("/analytics", func(r chi.Router) {
		r.Get("/platform", s.GetPlatformAnalytics)
		r.Get("/agent/{address}", s.GetAgentAnalytics)
	})

	// ─── Server Wallet ──────────────────────────────────
	s.Router.Get("/wallet/balance", s.GetWalletBalance)

	// ─── Jobs (ERC-8183 compliant) ──────────────────────
	s.Router.Route("/jobs", func(r chi.Router) {
		r.Get("/", s.ListJobs)
		r.Post("/", s.CreateJob)
		r.Post("/draft", s.CreateJob)       // Draft job without funding
		r.Post("/register", s.RegisterJob)   // ERC-8183: register on-chain job in DB
		r.Post("/execute", RateLimitExecuteJob(s.ExecuteJob))     // Single-call: server does all on-chain ops + runs agent
		r.Get("/{jobID}", s.GetJob)
		r.Get("/{jobID}/result", s.GetJobResult)
		r.Post("/{jobID}/fund", s.FundJob)
		r.Post("/{jobID}/set-budget", s.SetBudgetJob) // ERC-8183: server wallet sets budget
		r.Post("/{jobID}/run", s.RunJobOnChain)        // ERC-8183: run agent + submit + complete
		r.Post("/{jobID}/assign", s.ActionAssignAgent)  // Matcher assignment
		r.Post("/{jobID}/submit", s.SubmitResult)
		r.Post("/{jobID}/approve", s.ApproveResult)
		r.Post("/{jobID}/report", s.ReportJobIssue)
		r.Post("/{jobID}/reject", s.RejectResult)

		// Marketplace extensions
		r.Get("/{jobID}/bids", s.GetBids)
		r.Get("/{jobID}/matches", s.GetMatches)
		r.Post("/{jobID}/bid", s.SubmitBid)
		r.Post("/{jobID}/accept-bid", s.AcceptBid)
		r.Post("/{jobID}/dispute", s.RaiseDispute)
	})

	// ─── Matcher & AI Orchestration ─────────────────────
	s.Router.Post("/intent/parse", RateLimitIntentParse(s.ParseIntent))
	s.Router.Route("/matcher", func(r chi.Router) {
		r.Post("/run", s.MatchAgents)
	})

	// ─── Ratings ─────────────────────────────────────────
	s.Router.Post("/ratings", s.SubmitRating)

	// ─── Balance (pre-funded USDC) ───────────────────────
	s.Router.Get("/deposit-address", s.GetDepositAddress)
	s.Router.Route("/balance", func(r chi.Router) {
		r.Get("/", s.GetBalance)
		r.Post("/deposit", s.Deposit)
		r.Post("/withdraw", s.Withdraw)
	})

	// ─── Webhooks ────────────────────────────────────────
	s.Router.Post("/webhooks/dummy", s.DummyWebhookHandler)

	// ─── Agents (ERC-8004 compliant) ─────────────────────
	s.Router.Route("/agents", func(r chi.Router) {
		r.Get("/", s.ListAgents)
		r.Post("/register", RateLimitRegisterAgent(s.RegisterAgent))
		r.Post("/match", s.MatchAgent)
		r.Get("/{address}", s.GetAgent)
		r.Get("/{address}/jobs", s.GetAgentJobs)
		r.Get("/{address}/stats", s.GetAgentStats)

		// Runtime
		r.Post("/{address}/run", RateLimitAgentRun(s.RunAgent))
		r.Post("/{address}/preview", s.PreviewAgent)
		r.Post("/{address}/trial", s.TrialAgent)
		r.Get("/{address}/trial-eligibility", s.CheckTrialEligibility)
		r.Get("/{address}/outputs/{storeID}", s.GetStoredOutput)
		r.Post("/{address}/cached", s.CheckCachedResult)
	})

	// ─── Admin ───────────────────────────────────────────
	s.Router.Route("/admin", func(r chi.Router) {
		r.Get("/disputes", s.ListDisputes)
		r.Post("/disputes/{jobID}/resolve", s.ResolveDispute)
	})

	return s
}

// corsMiddleware handles CORS preflight and headers.
// Only origins in the allowlist get CORS headers; all others are blocked by the browser.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		if origin != "" && isAllowedOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-GigaWork-Signature")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Max-Age", "86400")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
