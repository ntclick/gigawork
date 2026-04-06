package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

type WebIntelInput struct {
	URL           string   `json:"url"`
	ExtractFields []string `json:"extract_fields"`
}

type WebIntelOutput struct {
	URL             string              `json:"url"`
	Title           string              `json:"title"`
	Summary         string              `json:"summary"`
	KeyFacts        []string            `json:"key_facts"`
	Entities        map[string][]string `json:"entities"`
	PublishedDate   string              `json:"published_date"`
	SourceLanguage  string              `json:"source_language"`
	ConfidenceScore float64             `json:"confidence_score"`
}

// RunWebIntelAgent performs a live scrape via Apify and summarizes via DeepSeek.
// Retries network errors up to 3 times with exponential backoff.
// Returns error on failure (caller handles refund via CancelJob).
func RunWebIntelAgent(ctx context.Context, input WebIntelInput) (*WebIntelOutput, error) {
	apifyToken := os.Getenv("APIFY_API_TOKEN")
	deepseekKey := os.Getenv("DEEPSEEK_API_KEY")

	if apifyToken == "" || deepseekKey == "" {
		return nil, fmt.Errorf("missing API keys in .env")
	}

	// 1. Scrape with Apify (Cheerio Scraper) — retries on network error
	scrapedData, err := callApifyScraper(ctx, apifyToken, input.URL)
	if err != nil {
		return nil, fmt.Errorf("apify error: %v", err)
	}

	// 2. Summarize with DeepSeek — retries on network error
	output, err := callDeepSeekSummary(ctx, deepseekKey, scrapedData)
	if err != nil {
		return nil, fmt.Errorf("deepseek error: %v", err)
	}

	output.URL = input.URL
	return output, nil
}

func callApifyScraper(ctx context.Context, token, url string) (string, error) {
	apiURL := "https://api.apify.com/v2/acts/apify~cheerio-scraper/runs?token=" + token

	payload := map[string]interface{}{
		"startUrls":           []map[string]string{{"url": url}},
		"maxRequestsPerCrawl": 5,
		"pageFunction":        "async function pageFunction(context) { const { $, request } = context; return { url: request.url, title: $('title').text(), text: $('body').text().substring(0, 5000) }; }",
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := retryDo(httpClient, req, 3)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("apify api error %d: %s", resp.StatusCode, string(respBody))
	}

	// Parse run response to get dataset ID
	var runResp struct {
		Data struct {
			ID               string `json:"id"`
			Status           string `json:"status"`
			DefaultDatasetID string `json:"defaultDatasetId"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&runResp); err != nil {
		return "", fmt.Errorf("failed to parse apify run response: %v", err)
	}

	// Poll until run completes (max 60s)
	runID := runResp.Data.ID
	datasetID := runResp.Data.DefaultDatasetID
	for i := 0; i < 20; i++ {
		time.Sleep(3 * time.Second)

		statusURL := fmt.Sprintf("https://api.apify.com/v2/actor-runs/%s?token=%s", runID, token)
		sReq, _ := http.NewRequestWithContext(ctx, "GET", statusURL, nil)
		sResp, err := retryDo(httpClient, sReq, 2)
		if err != nil {
			continue
		}
		var statusResp struct {
			Data struct {
				Status           string `json:"status"`
				DefaultDatasetID string `json:"defaultDatasetId"`
			} `json:"data"`
		}
		json.NewDecoder(sResp.Body).Decode(&statusResp)
		sResp.Body.Close()

		if statusResp.Data.DefaultDatasetID != "" {
			datasetID = statusResp.Data.DefaultDatasetID
		}
		if statusResp.Data.Status == "SUCCEEDED" {
			break
		}
		if statusResp.Data.Status == "FAILED" || statusResp.Data.Status == "ABORTED" {
			return "", fmt.Errorf("apify run %s ended with status %s", runID, statusResp.Data.Status)
		}
	}

	// Fetch dataset items
	itemsURL := fmt.Sprintf("https://api.apify.com/v2/datasets/%s/items?token=%s&limit=5", datasetID, token)
	iReq, _ := http.NewRequestWithContext(ctx, "GET", itemsURL, nil)
	iResp, err := retryDo(httpClient, iReq, 3)
	if err != nil {
		return "", fmt.Errorf("failed to fetch dataset: %v", err)
	}
	defer iResp.Body.Close()

	var items []map[string]interface{}
	if err := json.NewDecoder(iResp.Body).Decode(&items); err != nil {
		return "", fmt.Errorf("failed to parse dataset items: %v", err)
	}

	if len(items) == 0 {
		return fmt.Sprintf("Scraped %s but no content extracted.", url), nil
	}

	// Combine scraped text from all items
	var combined string
	for _, item := range items {
		if title, ok := item["title"].(string); ok && title != "" {
			combined += "Title: " + title + "\n"
		}
		if text, ok := item["text"].(string); ok && text != "" {
			combined += text + "\n\n"
		}
	}
	if combined == "" {
		// Fallback: serialize whatever we got
		raw, _ := json.Marshal(items[0])
		combined = string(raw)
	}

	// Cap at 5000 chars for LLM context
	if len(combined) > 5000 {
		combined = combined[:5000]
	}

	return combined, nil
}

func callDeepSeekSummary(ctx context.Context, key, rawText string) (*WebIntelOutput, error) {
	apiURL := "https://api.deepseek.com/chat/completions"

	prompt := fmt.Sprintf(`You are a senior research analyst specializing in competitive intelligence and due diligence.

Extract structured information from this text. Return ONLY valid JSON:
{"title": "string", "summary": "2-4 sentence summary focusing on key intelligence", "key_facts": ["specific facts with dates/numbers"], "entities": {"people": [], "organizations": [], "topics": []}, "confidence_score": 0.9}

Standards:
- Extract specific facts, dates, names, numbers — no vague summaries
- Flag potential conflicts of interest in sources
- Distinguish verified information from speculation
- Structure: Key Facts → Implications → Open Questions

Text: %s`, rawText)

	payload := map[string]interface{}{
		"model": "deepseek-chat",
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"temperature": 0.2,
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")

	resp, err := retryDo(httpClient, req, 3)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var chatResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return nil, err
	}

	if len(chatResp.Choices) == 0 {
		return nil, fmt.Errorf("no response from deepseek")
	}

	var output WebIntelOutput
	cleaned := extractJSON(chatResp.Choices[0].Message.Content)
	if err := json.Unmarshal([]byte(cleaned), &output); err != nil {
		return nil, fmt.Errorf("invalid json from deepseek: %v", err)
	}

	return &output, nil
}
