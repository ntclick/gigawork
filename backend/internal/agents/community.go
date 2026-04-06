package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"gigawork/internal/db"
)

// communityClient has a longer timeout for external community agents.
var communityClient = &http.Client{
	Timeout: 120 * time.Second,
	Transport: &http.Transport{
		MaxIdleConns:        50,
		MaxIdleConnsPerHost: 5,
		IdleConnTimeout:     90 * time.Second,
	},
}

// RunCommunityAgent calls an external agent's HTTP endpoint with job inputs
// and returns the parsed result.
func RunCommunityAgent(ctx context.Context, agent *db.Agent, jobID int64, inputs map[string]any) (map[string]any, error) {
	if agent.EndpointURL == nil || *agent.EndpointURL == "" {
		return nil, fmt.Errorf("community agent %s has no endpoint URL configured", agent.ID)
	}

	endpointURL := *agent.EndpointURL

	payload := map[string]any{
		"job_id": jobID,
		"inputs": inputs,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}

	log.Printf("[Community] Calling agent %s at %s (job #%d)", agent.ID, endpointURL, jobID)

	req, err := http.NewRequestWithContext(ctx, "POST", endpointURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GigaWork-Job-ID", fmt.Sprintf("%d", jobID))

	// Add auth if configured
	if agent.EndpointAuth != nil && *agent.EndpointAuth != "" {
		req.Header.Set("Authorization", *agent.EndpointAuth)
	}

	resp, err := communityClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("community agent request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		log.Printf("[Community] Agent %s returned HTTP %d: %s", agent.ID, resp.StatusCode, string(respBody[:min(len(respBody), 200)]))
		return nil, fmt.Errorf("community agent returned HTTP %d", resp.StatusCode)
	}

	// Parse response — expect { "result": {...}, "status": "success" }
	var agentResp struct {
		Result map[string]any `json:"result"`
		Status string         `json:"status"`
		Error  string         `json:"error,omitempty"`
	}
	if err := json.Unmarshal(respBody, &agentResp); err != nil {
		// Try parsing as raw result object
		var rawResult map[string]any
		if err2 := json.Unmarshal(respBody, &rawResult); err2 != nil {
			return nil, fmt.Errorf("parse community agent response: %w (body: %s)", err, string(respBody[:min(len(respBody), 200)]))
		}
		log.Printf("[Community] Agent %s returned raw result (no wrapper)", agent.ID)
		return rawResult, nil
	}

	if agentResp.Status == "error" || agentResp.Error != "" {
		return nil, fmt.Errorf("community agent error: %s", agentResp.Error)
	}

	if agentResp.Result == nil {
		return nil, fmt.Errorf("community agent returned empty result")
	}

	log.Printf("[Community] Agent %s completed successfully for job #%d", agent.ID, jobID)
	return agentResp.Result, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
