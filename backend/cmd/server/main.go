package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"gigawork/internal/api"
	"gigawork/internal/chain"
	"gigawork/internal/chain/bindings"
	"gigawork/internal/config"
	"gigawork/internal/db"
	"gigawork/internal/matching"
	"gigawork/internal/agents"
	"gigawork/internal/web"
	"gigawork/internal/worker"

	"github.com/ethereum/go-ethereum/common"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"
)

func main() {
	// Load .env if present
	_ = godotenv.Load()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	// ─── Supabase Client ─────────────────────────────────
	dbClient := db.NewClient(cfg.SupabaseURL, cfg.SupabaseServiceKey)

	// Seed Standard Agents (Phase 1 Support)
	if err := agents.SeedAgents(context.Background(), dbClient); err != nil {
		log.Printf("WARNING: failed to seed agents: %v", err)
	}

	// ─── Cleanup Stale Jobs ─────────────────────────────
	cleanupStaleJobs(dbClient)

	// ─── Chain Client ────────────────────────────────────
	privateKey := strings.TrimPrefix(cfg.PrivateKey, "0x")
	chainClient, err := chain.NewClient(cfg.ArcRPCURL, privateKey)
	if err != nil {
		log.Fatalf("chain client error: %v", err)
	}
	defer chainClient.Close()

	// ─── Contract Bindings ───────────────────────────────
	escrow, err := chain.NewEscrowContract(cfg.EscrowAddress, chainClient.ETH)
	if err != nil {
		log.Fatalf("escrow contract error: %v", err)
	}

	registry, err := chain.NewRegistryContract(cfg.RegistryAddress, chainClient.ETH)
	if err != nil {
		log.Fatalf("registry contract error: %v", err)
	}

	// ─── Matching Engine ─────────────────────────────────
	matchEngine := matching.NewEngine(dbClient)

	// ─── Telegram Notifier ───────────────────────────────
	notifier := worker.NewTelegramNotifier(cfg.TelegramBotToken)

	// ─── Context with Cancellation ───────────────────────
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// ─── Event Listener ──────────────────────────────────
	wsClient, err := chain.NewWSClient(cfg.ArcWSURL)
	if err != nil {
		log.Printf("websocket connection failed: %v (event listener will use polling)", err)
		wsClient = chainClient.ETH
	}

	listener := worker.NewListener(wsClient, escrow, registry, dbClient, matchEngine, notifier)
	go listener.Start(ctx)

	// ─── Auto-Settle Worker ──────────────────────────────
	if cfg.PrivateKey != "" {
		autoSettler := worker.NewAutoSettleWorker(chainClient, escrow, dbClient)
		go autoSettler.Start(ctx)
	} else {
		log.Println("PRIVATE_KEY not set, auto-settle worker disabled")
	}

	// ─── Identity Registry (ERC-8004) Binding ───────────
	var identityCaller *bindings.IdentityRegistryCaller
	if cfg.IdentityRegistryAddress != "" {
		idAddr := common.HexToAddress(cfg.IdentityRegistryAddress)
		var idErr error
		identityCaller, idErr = bindings.NewIdentityRegistryCaller(idAddr, chainClient.ETH)
		if idErr != nil {
			log.Printf("WARNING: identity registry binding failed: %v (on-chain verification disabled)", idErr)
		} else {
			log.Printf("  Identity Registry: %s", cfg.IdentityRegistryAddress)
		}
	}

	// ─── ERC-8004 Auto-Registration for Seeded Agents ────
	if cfg.PrivateKey != "" && cfg.IdentityRegistryAddress != "" {
		go func() {
			if err := agents.EnsureOnChainRegistration(
				context.Background(), dbClient, chainClient, cfg.IdentityRegistryAddress,
			); err != nil {
				log.Printf("WARNING: on-chain agent registration failed: %v", err)
			}
		}()
	}

	// ─── Root Router ─────────────────────────────────────
	rootRouter := chi.NewRouter()
	rootRouter.Use(middleware.Logger)
	rootRouter.Use(middleware.Recoverer)

	// API routes (JSON)
	apiServer := api.NewServer(dbClient, matchEngine, chainClient, []byte(cfg.AuthSecret), []byte(cfg.WebhookSecret), identityCaller)
	rootRouter.Mount("/api", apiServer.Router)
	go apiServer.StartCronJobs(ctx)

	// Web dashboard routes (HTML)
	webHandler := web.NewHandler(dbClient, cfg.PrivyAppID, cfg.PrivyClientID)
	rootRouter.Handle("/static/*", web.StaticFiles())
	rootRouter.Get("/favicon.ico", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	rootRouter.Get("/", webHandler.LandingPage)
	rootRouter.Route("/app", func(r chi.Router) {
		r.Get("/", webHandler.Dashboard)
		r.Get("/dashboard", webHandler.Dashboard)
		r.Get("/jobs", webHandler.JobBoard)
		r.Get("/agents", webHandler.AgentsPage)
		r.Get("/post-job", webHandler.PostJobPage)
		r.Get("/register", webHandler.RegisterAgentPage)
		r.Get("/onboard", webHandler.OnboardPage)
		r.Get("/guide", webHandler.GuidePage)
	})

	// ─── HTTP Server ─────────────────────────────────────
	httpServer := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      rootRouter,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 120 * time.Second, // on-chain txs can take 20-30s
		IdleTimeout:  120 * time.Second,
	}

	// ─── Graceful Shutdown ───────────────────────────────
	go func() {
		log.Printf("GigaWork server starting on :%s", cfg.Port)
		log.Printf("  Dashboard: http://localhost:%s", cfg.Port)
		log.Printf("  API:       http://localhost:%s/api", cfg.Port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down...")
	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("server shutdown error: %v", err)
	}

	log.Println("server stopped")
}

// cleanupStaleJobs marks any IN_PROGRESS jobs as FAILED on startup.
// These are jobs that were interrupted by a server crash/restart.
func cleanupStaleJobs(dbClient *db.Client) {
	ctx := context.Background()
	jobs, err := dbClient.ListJobs(ctx, "IN_PROGRESS", "", "")
	if err != nil {
		log.Printf("[Cleanup] Failed to query stale jobs: %v", err)
		return
	}

	count := 0
	for _, job := range jobs {
		// Only clean up jobs older than 5 minutes (avoid killing active ones)
		if time.Since(job.UpdatedAt) < 5*time.Minute {
			continue
		}
		job.Status = "DISPUTED" // maps to FAILED in our status system
		job.UpdatedAt = time.Now()
		if err := dbClient.UpsertJob(ctx, &job); err != nil {
			log.Printf("[Cleanup] Failed to update job #%d: %v", job.JobID, err)
			continue
		}
		count++
	}

	if count > 0 {
		log.Printf("[Cleanup] Marked %d stale IN_PROGRESS jobs as FAILED (server restart)", count)
	}
}
