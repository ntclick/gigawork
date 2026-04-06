package db

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"time"
)

// Client wraps Supabase PostgREST API calls.
type Client struct {
	baseURL    string
	serviceKey string
	httpClient *http.Client
}

func NewClient(baseURL, serviceKey string) *Client {
	return &Client{
		baseURL:    baseURL + "/rest/v1",
		serviceKey: serviceKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

// ─── Users ───────────────────────────────────────────────

func (c *Client) UpsertUser(ctx context.Context, user *User) error {
	return c.upsert(ctx, "users", user)
}

func (c *Client) GetUser(ctx context.Context, address string) (*User, error) {
	var users []User
	err := c.query(ctx, "users", fmt.Sprintf("address=ilike.%s", address), &users)
	if err != nil {
		return nil, err
	}
	if len(users) == 0 {
		return nil, fmt.Errorf("user not found: %s", address)
	}
	return &users[0], nil
}

// ─── Balance ─────────────────────────────────────────────

func (c *Client) CreditBalance(ctx context.Context, address string, amount float64) error {
	user, err := c.GetUser(ctx, address)
	if err != nil {
		// Create user if not exists
		user = &User{Address: address, Roles: []string{"client"}, USDCBalance: amount}
		return c.upsert(ctx, "users", user)
	}
	user.USDCBalance += amount
	return c.upsert(ctx, "users", user)
}

func (c *Client) DebitBalance(ctx context.Context, address string, amount float64) error {
	user, err := c.GetUser(ctx, address)
	if err != nil {
		return fmt.Errorf("user not found: %s", address)
	}
	if user.USDCBalance < amount {
		return fmt.Errorf("insufficient balance: have %.6f, need %.6f", user.USDCBalance, amount)
	}
	user.USDCBalance -= amount
	return c.upsert(ctx, "users", user)
}

func (c *Client) GetBalance(ctx context.Context, address string) (float64, error) {
	user, err := c.GetUser(ctx, address)
	if err != nil {
		return 0, nil // new user, 0 balance
	}
	return user.USDCBalance, nil
}

func (c *Client) InsertDeposit(ctx context.Context, deposit *USDCDeposit) error {
	return c.insert(ctx, "usdc_deposits", deposit)
}

// ─── Agents ──────────────────────────────────────────────

func (c *Client) UpsertAgent(ctx context.Context, agent *Agent) error {
	return c.upsert(ctx, "agents", agent)
}

func (c *Client) GetAgent(ctx context.Context, identifier string) (*Agent, error) {
	var agents []Agent

	// Try exact address match first (most common for /agents/{address}/run)
	err := c.query(ctx, "agents", fmt.Sprintf("address=eq.%s&is_system=eq.false", identifier), &agents)
	if err == nil && len(agents) > 0 {
		return &agents[0], nil
	}

	// Fallback: search by spec ID (e.g. "web-intel-agent")
	agents = nil
	err = c.query(ctx, "agents", fmt.Sprintf("id=eq.%s&is_system=eq.false", identifier), &agents)
	if err == nil && len(agents) > 0 {
		return &agents[0], nil
	}

	// Fallback: case-insensitive address match
	agents = nil
	err = c.query(ctx, "agents", fmt.Sprintf("address=ilike.%s&is_system=eq.false", identifier), &agents)
	if err == nil && len(agents) > 0 {
		return &agents[0], nil
	}

	return nil, fmt.Errorf("agent not found: %s", identifier)
}

func (c *Client) ListAgents(ctx context.Context, activeOnly bool, tag string) ([]Agent, error) {
	params := "order=reputation_score.desc&is_system=eq.false"
	if activeOnly {
		params += "&is_active=eq.true"
	}
	if tag != "" {
		params += fmt.Sprintf("&skill_tags=cs.{%s}", url.QueryEscape(tag))
	}
	var agents []Agent
	err := c.query(ctx, "agents", params, &agents)
	return agents, err
}

// ─── Jobs ────────────────────────────────────────────────

func (c *Client) UpsertJob(ctx context.Context, job *Job) error {
	return c.upsert(ctx, "jobs", job)
}

func (c *Client) GetJob(ctx context.Context, jobID int64) (*Job, error) {
	var jobs []Job
	err := c.query(ctx, "jobs", fmt.Sprintf("job_id=eq.%d", jobID), &jobs)
	if err != nil {
		return nil, err
	}
	if len(jobs) == 0 {
		return nil, fmt.Errorf("job not found: %d", jobID)
	}
	return &jobs[0], nil
}

func (c *Client) ListJobs(ctx context.Context, status string, employer string, worker string) ([]Job, error) {
	params := "order=created_at.desc&limit=100"
	if status != "" {
		params += fmt.Sprintf("&status=eq.%s", url.QueryEscape(status))
	}
	if employer != "" {
		params += fmt.Sprintf("&employer=eq.%s", url.QueryEscape(employer))
	}
	if worker != "" {
		params += fmt.Sprintf("&worker_agent=eq.%s", url.QueryEscape(worker))
	}
	var jobs []Job
	err := c.query(ctx, "jobs", params, &jobs)
	return jobs, err
}

func (c *Client) GetPendingReviewJobs(ctx context.Context, before time.Time) ([]Job, error) {
	params := fmt.Sprintf(
		"status=eq.%s&result_submitted_at=lt.%s&order=result_submitted_at.asc",
		StatusSubmitted,
		before.UTC().Format(time.RFC3339),
	)
	var jobs []Job
	err := c.query(ctx, "jobs", params, &jobs)
	return jobs, err
}

// ─── Bids ────────────────────────────────────────────────

func (c *Client) InsertBid(ctx context.Context, bid *Bid) error {
	return c.insert(ctx, "bids", bid)
}

func (c *Client) GetBidsByJob(ctx context.Context, jobID int64) ([]Bid, error) {
	var bids []Bid
	err := c.query(ctx, "bids", fmt.Sprintf("job_id=eq.%d&order=created_at.asc", jobID), &bids)
	return bids, err
}

func (c *Client) UpdateBidStatus(ctx context.Context, bidID string, status string) error {
	body := map[string]string{"status": status}
	return c.patch(ctx, "bids", fmt.Sprintf("id=eq.%s", bidID), body)
}

// ─── Disputes ────────────────────────────────────────────

func (c *Client) InsertDispute(ctx context.Context, dispute *Dispute) error {
	return c.insert(ctx, "disputes", dispute)
}

func (c *Client) GetDisputesByJob(ctx context.Context, jobID int64) ([]Dispute, error) {
	var disputes []Dispute
	err := c.query(ctx, "disputes", fmt.Sprintf("job_id=eq.%d", jobID), &disputes)
	return disputes, err
}

func (c *Client) UpdateDispute(ctx context.Context, dispute *Dispute) error {
	body := map[string]any{
		"resolution":  dispute.Resolution,
		"worker_won":  dispute.WorkerWon,
		"resolved_at": dispute.ResolvedAt,
	}
	return c.patch(ctx, "disputes", fmt.Sprintf("id=eq.%s", dispute.ID), body)
}

// ─── Shared Store ───────────────────────────────────────

func (c *Client) GetStoreEntry(ctx context.Context, inputHash string) (*StoreEntry, error) {
	var entries []StoreEntry
	err := c.query(ctx, "shared_store", fmt.Sprintf("input_hash=eq.%s", inputHash), &entries)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("cache miss: %s", inputHash)
	}
	return &entries[0], nil
}

func (c *Client) GetStoreEntryByContentHash(ctx context.Context, contentHash string) (*StoreEntry, error) {
	var entries []StoreEntry
	err := c.query(ctx, "shared_store", fmt.Sprintf("content_hash=eq.%s", contentHash), &entries)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("cache miss by content_hash: %s", contentHash)
	}
	return &entries[0], nil
}

func (c *Client) ListStoreEntriesByAgent(ctx context.Context, agentID string, limit int) ([]StoreEntry, error) {
	var entries []StoreEntry
	params := fmt.Sprintf("agent_id=eq.%s&order=produced_at.desc&limit=%d", agentID, limit)
	err := c.query(ctx, "shared_store", params, &entries)
	return entries, err
}

func (c *Client) UpsertStoreEntry(ctx context.Context, entry *StoreEntry) error {
	return c.upsert(ctx, "shared_store", entry)
}

// ─── Trials ─────────────────────────────────────────────

func (c *Client) GetTrialRun(ctx context.Context, wallet, agentID string) (*TrialRun, error) {
	var trials []TrialRun
	err := c.query(ctx, "trial_runs", fmt.Sprintf("wallet=eq.%s&agent_id=eq.%s", wallet, agentID), &trials)
	if err != nil {
		return nil, err
	}
	if len(trials) == 0 {
		return nil, fmt.Errorf("no trial found")
	}
	return &trials[0], nil
}

func (c *Client) RecordTrialRun(ctx context.Context, trial *TrialRun) error {
	return c.insert(ctx, "trial_runs", trial)
}

// ─── Ratings & Metrics ───────────────────────────────────

func (c *Client) InsertRating(ctx context.Context, rating *AgentRating) error {
	return c.insert(ctx, "agent_ratings", rating)
}

func (c *Client) ListRatings(ctx context.Context, agentID string) ([]AgentRating, error) {
	var ratings []AgentRating
	err := c.query(ctx, "agent_ratings", fmt.Sprintf("agent_id=eq.%s&order=created_at.desc", agentID), &ratings)
	return ratings, err
}

func (c *Client) UpsertMetrics(ctx context.Context, metrics *AgentMetrics) error {
	return c.upsert(ctx, "agent_metrics", metrics)
}

func (c *Client) GetMetrics(ctx context.Context, agentID string) (*AgentMetrics, error) {
	var metrics []AgentMetrics
	err := c.query(ctx, "agent_metrics", fmt.Sprintf("agent_id=eq.%s", agentID), &metrics)
	if err != nil || len(metrics) == 0 {
		return nil, err
	}
	return &metrics[0], nil
}

// ─── Events & Analytics ───────────────────────────────────

func (c *Client) InsertJobEvent(ctx context.Context, evt *JobEvent) error {
	return c.insert(ctx, "job_events", evt)
}

func (c *Client) InsertAgentActivity(ctx context.Context, act *AgentActivityLog) error {
	return c.insert(ctx, "agent_activity_log", act)
}

// ─── HTTP Helpers ────────────────────────────────────────

func (c *Client) query(ctx context.Context, table, params string, dest any) error {
	reqURL := fmt.Sprintf("%s/%s?%s", c.baseURL, table, params)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return err
	}
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("supabase query error %d: %s", resp.StatusCode, string(body))
	}

	return json.NewDecoder(resp.Body).Decode(dest)
}

func (c *Client) insert(ctx context.Context, table string, data any) error {
	body, err := json.Marshal(data)
	if err != nil {
		return err
	}

	reqURL := fmt.Sprintf("%s/%s", c.baseURL, table)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	c.setHeaders(req)
	req.Header.Set("Prefer", "return=minimal")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("supabase insert error %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

func (c *Client) upsert(ctx context.Context, table string, data any) error {
	body, err := json.Marshal(data)
	if err != nil {
		return err
	}

	reqURL := fmt.Sprintf("%s/%s", c.baseURL, table)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	c.setHeaders(req)
	req.Header.Set("Prefer", "resolution=merge-duplicates,return=minimal")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		log.Printf("[DB Upsert] Error %d: %s | URL: %s | Payload: %s", resp.StatusCode, string(respBody), reqURL, string(body))
		return fmt.Errorf("supabase upsert error %d: %s", resp.StatusCode, string(respBody))
	}
	log.Printf("[DB Upsert] Success %d: Table %s", resp.StatusCode, table)
	return nil
}

func (c *Client) patch(ctx context.Context, table, params string, data any) error {
	body, err := json.Marshal(data)
	if err != nil {
		return err
	}

	reqURL := fmt.Sprintf("%s/%s?%s", c.baseURL, table, params)
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, reqURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	c.setHeaders(req)
	req.Header.Set("Prefer", "return=minimal")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("supabase patch error %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

func (c *Client) delete(ctx context.Context, table, filter string) error {
	reqURL := fmt.Sprintf("%s/%s?%s", c.baseURL, table, filter)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, reqURL, nil)
	if err != nil {
		return err
	}
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("supabase delete error %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// DeleteAgentBySpecID deletes an agent by its spec ID (e.g. "web-intel-agent").
func (c *Client) DeleteAgentBySpecID(ctx context.Context, specID string) error {
	return c.delete(ctx, "agents", fmt.Sprintf("id=eq.%s", specID))
}

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("apikey", c.serviceKey)
	req.Header.Set("Authorization", "Bearer "+c.serviceKey)
	req.Header.Set("Content-Type", "application/json")
}
