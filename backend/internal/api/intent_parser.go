package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"gigawork/internal/db"
)

type ParseIntentRequest struct {
	RawInput string `json:"raw_input"`
}

type ParseIntentResponse struct {
	Intent           string         `json:"intent"`
	RecommendedAgent *db.Agent      `json:"recommended_agent,omitempty"`
	Confidence       float64        `json:"confidence"`
	ExtractedFields  map[string]any `json:"extracted_fields"`
	MissingFields    []string       `json:"missing_fields"`
	FallbackQuestion string         `json:"fallback_question,omitempty"`
	Source           string         `json:"source"` // "ai" or "keyword_fallback"
}

// POST /api/intent/parse
func (s *Server) ParseIntent(w http.ResponseWriter, r *http.Request) {
	var req ParseIntentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.RawInput == "" {
		writeError(w, http.StatusBadRequest, "raw_input is required")
		return
	}

	// Fetch available agents to provide to LLM
	agents, err := s.DB.ListAgents(r.Context(), true, "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get agents")
		return
	}

	var activeAgents []db.Agent
	for _, a := range agents {
		if !a.IsSystem && a.VisibleOnMarketplace {
			activeAgents = append(activeAgents, a)
		}
	}

	// ─── Try DeepSeek AI first ────────────────────────────────
	if aiResp, ok := s.tryDeepSeekIntent(r, req.RawInput, activeAgents); ok {
		writeJSON(w, http.StatusOK, aiResp)
		return
	}

	// ─── Fallback: keyword-based matching ─────────────────────
	log.Printf("[IntentParser] DeepSeek unavailable, using keyword fallback for: %s", req.RawInput)

	fallbackResp := keywordFallback(req.RawInput, activeAgents)
	writeJSON(w, http.StatusOK, fallbackResp)
}

// tryDeepSeekIntent attempts AI-powered intent parsing. Returns (response, true) on success,
// or (zero, false) on any failure — allowing the caller to fall through to keyword fallback.
func (s *Server) tryDeepSeekIntent(r *http.Request, rawInput string, activeAgents []db.Agent) (ParseIntentResponse, bool) {
	apiKey := os.Getenv("DEEPSEEK_API_KEY")
	if apiKey == "" {
		log.Println("[IntentParser] DEEPSEEK_API_KEY not set, skipping AI")
		return ParseIntentResponse{}, false
	}

	agentInfos := ""
	for _, a := range activeAgents {
		schemaJSON, _ := json.Marshal(a.InputSchema)
		agentInfos += fmt.Sprintf("- Agent ID: %s, Name: %s, Best For: %v, Input Schema: %s\n", a.ID, a.Name, getMetadata(a, "best_for"), string(schemaJSON))
	}

	sysPrompt := `You are the GigaWork Intent Parser. Your job is to read a user's natural language request and match it to one of the available AI agents.
You MUST output ONLY a valid JSON object matching this exact schema:
{
  "intent": "<short summary of task type>",
  "recommended_agent_id": "<ID of the best matching agent>",
  "confidence": <float between 0.0 and 1.0>,
  "extracted_fields": {
    "<field_name>": "<extracted_value>"
  },
  "missing_fields": ["<field_name>", ...],
  "fallback_question": "<question string, required if confidence < 0.6 to ask user for missing context>"
}

Match the "extracted_fields" keys EXACTLY to the 'Input Schema' expected by the 'recommended_agent_id'.
If the user did not provide a required field defined in the schema, add its name to "missing_fields".
If your confidence in the matching agent is below 0.6, you MUST provide a natural conversational "fallback_question" asking the user for clarification.`

	payload := map[string]any{
		"model": "deepseek-chat",
		"messages": []map[string]string{
			{"role": "system", "content": sysPrompt + "\n\nAvailable Agents:\n" + agentInfos},
			{"role": "user", "content": "User Request: " + rawInput},
		},
		"temperature": 0.1,
	}

	body, _ := json.Marshal(payload)
	llmReq, _ := http.NewRequestWithContext(r.Context(), "POST", "https://api.deepseek.com/v1/chat/completions", bytes.NewReader(body))
	llmReq.Header.Set("Authorization", "Bearer "+apiKey)
	llmReq.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(llmReq)
	if err != nil {
		log.Printf("[IntentParser] DeepSeek network error: %v", err)
		return ParseIntentResponse{}, false
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		log.Printf("[IntentParser] DeepSeek returned HTTP %d", resp.StatusCode)
		return ParseIntentResponse{}, false
	}

	var dsResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&dsResp); err != nil || len(dsResp.Choices) == 0 {
		log.Printf("[IntentParser] DeepSeek response parse error: %v", err)
		return ParseIntentResponse{}, false
	}

	content := dsResp.Choices[0].Message.Content
	if len(content) > 7 && content[:7] == "\x60\x60\x60json\n" {
		content = content[7 : len(content)-3]
	}

	var parsed struct {
		Intent             string         `json:"intent"`
		RecommendedAgentID string         `json:"recommended_agent_id"`
		Confidence         float64        `json:"confidence"`
		ExtractedFields    map[string]any `json:"extracted_fields"`
		MissingFields      []string       `json:"missing_fields"`
		FallbackQuestion   string         `json:"fallback_question"`
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		log.Printf("[IntentParser] DeepSeek returned invalid JSON: %v", err)
		return ParseIntentResponse{}, false
	}

	var recommendedAgent *db.Agent
	if parsed.Confidence >= 0.6 {
		for _, a := range activeAgents {
			if a.ID == parsed.RecommendedAgentID || a.Address == parsed.RecommendedAgentID {
				cpy := a
				recommendedAgent = &cpy
				break
			}
		}
	}

	return ParseIntentResponse{
		Intent:           parsed.Intent,
		RecommendedAgent: recommendedAgent,
		Confidence:       parsed.Confidence,
		ExtractedFields:  parsed.ExtractedFields,
		MissingFields:    parsed.MissingFields,
		FallbackQuestion: parsed.FallbackQuestion,
		Source:           "ai",
	}, true
}

// ─── Keyword fallback ────────────────────────────────────────

var keywordMap = map[string][]string{
	"web-intel-agent":        {"scrape", "crawl", "website", "url", "extract", "web", "link", "page"},
	"crypto-scanner-agent":   {"crypto", "token", "blockchain", "defi", "nft", "price", "coin", "protocol"},
	"social-sentiment-agent": {"twitter", "sentiment", "social", "reddit", "community", "trend", "opinion"},
	"document-digest-agent":  {"document", "pdf", "summarize", "digest", "whitepaper", "analyze", "paper"},
	"report-composer-agent":  {"write", "compose", "content", "blog", "post", "draft", "report", "memo"},
}

const defaultFallbackAgent = "web-intel-agent"

func keywordFallback(rawInput string, activeAgents []db.Agent) ParseIntentResponse {
	lower := strings.ToLower(rawInput)
	words := strings.Fields(lower)

	// Score each agent by keyword hits
	scores := make(map[string]int)
	for agentID, keywords := range keywordMap {
		for _, word := range words {
			for _, kw := range keywords {
				if strings.Contains(word, kw) {
					scores[agentID]++
				}
			}
		}
	}

	// Find best match
	bestID := defaultFallbackAgent
	bestScore := 0
	for agentID, score := range scores {
		if score > bestScore {
			bestScore = score
			bestID = agentID
		}
	}

	// Find agent record
	var recommendedAgent *db.Agent
	for _, a := range activeAgents {
		if a.ID == bestID {
			cpy := a
			recommendedAgent = &cpy
			break
		}
	}

	confidence := 0.5
	if bestScore >= 3 {
		confidence = 0.8
	} else if bestScore >= 1 {
		confidence = 0.6
	}

	intent := "general_task"
	if bestScore > 0 {
		switch bestID {
		case "web-intel-agent":
			intent = "web_extraction"
		case "crypto-scanner-agent":
			intent = "crypto_research"
		case "social-sentiment-agent":
			intent = "sentiment_analysis"
		case "document-digest-agent":
			intent = "document_analysis"
		case "report-composer-agent":
			intent = "content_creation"
		}
	}

	return ParseIntentResponse{
		Intent:           intent,
		RecommendedAgent: recommendedAgent,
		Confidence:       confidence,
		ExtractedFields:  map[string]any{},
		MissingFields:    []string{},
		Source:           "keyword_fallback",
	}
}

func getMetadata(a db.Agent, key string) any {
	if a.Metadata == nil {
		return ""
	}
	m, ok := a.Metadata.(map[string]any)
	if !ok {
		return ""
	}
	return m[key]
}
