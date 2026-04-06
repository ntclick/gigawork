package api

import (
	"encoding/json"
	"net"
	"net/http"
	"sync"
	"time"
)

// rateBucket tracks request counts per window for a single key.
type rateBucket struct {
	count    int
	windowAt time.Time
}

// rateLimiter is a simple per-key token bucket with fixed 1-minute windows.
// No external dependencies — uses sync.Map for concurrent access.
type rateLimiter struct {
	buckets sync.Map // key → *rateBucket
	limit   int
	window  time.Duration
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	rl := &rateLimiter{limit: limit, window: window}

	// Cleanup stale entries every 5 minutes
	go func() {
		for {
			time.Sleep(5 * time.Minute)
			now := time.Now()
			rl.buckets.Range(func(key, val any) bool {
				b := val.(*rateBucket)
				if now.Sub(b.windowAt) > rl.window*2 {
					rl.buckets.Delete(key)
				}
				return true
			})
		}
	}()

	return rl
}

// allow returns true if the request is within the limit.
func (rl *rateLimiter) allow(key string) bool {
	now := time.Now()
	val, _ := rl.buckets.LoadOrStore(key, &rateBucket{count: 0, windowAt: now})
	b := val.(*rateBucket)

	// Reset window if expired
	if now.Sub(b.windowAt) > rl.window {
		b.count = 0
		b.windowAt = now
	}

	b.count++
	return b.count <= rl.limit
}

// extractIP gets the client IP from RemoteAddr (strips port).
func extractIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// write429 sends a rate-limit exceeded response.
func write429(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Retry-After", "60")
	w.WriteHeader(http.StatusTooManyRequests)
	json.NewEncoder(w).Encode(map[string]any{
		"error":       "rate limit exceeded",
		"retry_after": 60,
	})
}

// ─── Middleware constructors ─────────────────────────────────

// Global per-IP rate limiter: 60 req/min
var globalLimiter = newRateLimiter(60, time.Minute)

// Strict per-wallet limiters for expensive endpoints
var agentRunLimiter = newRateLimiter(10, time.Minute)
var intentParseLimiter = newRateLimiter(20, time.Minute)
var executeJobLimiter = newRateLimiter(3, time.Minute)
var registerAgentLimiter = newRateLimiter(5, time.Minute)

// RateLimitByIP is chi middleware for global per-IP limiting.
func RateLimitByIP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := extractIP(r)
		if !globalLimiter.allow("ip:" + ip) {
			write429(w)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RateLimitAgentRun wraps a handler with strict per-wallet limiting (10/min).
func RateLimitAgentRun(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := extractIP(r) // default to IP
		// If authenticated, use wallet from cookie for fairer limiting
		if addr := r.Context().Value("wallet_address"); addr != nil {
			key = addr.(string)
		}
		if !agentRunLimiter.allow("run:" + key) {
			write429(w)
			return
		}
		next(w, r)
	}
}

// RateLimitExecuteJob wraps a handler with strict per-IP limiting (3/min).
func RateLimitExecuteJob(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := extractIP(r)
		if !executeJobLimiter.allow("exec:" + key) {
			write429(w)
			return
		}
		next(w, r)
	}
}

// RateLimitRegisterAgent wraps a handler with per-IP limiting (5/min).
func RateLimitRegisterAgent(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := extractIP(r)
		if !registerAgentLimiter.allow("register:" + key) {
			write429(w)
			return
		}
		next(w, r)
	}
}

// RateLimitIntentParse wraps a handler with per-wallet limiting (20/min).
func RateLimitIntentParse(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := extractIP(r)
		if addr := r.Context().Value("wallet_address"); addr != nil {
			key = addr.(string)
		}
		if !intentParseLimiter.allow("intent:" + key) {
			write429(w)
			return
		}
		next(w, r)
	}
}
