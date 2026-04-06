package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

// ─── Types ───────────────────────────────────────────────────

type ReportOutput struct {
	Title            string          `json:"title"`
	ReportType       string          `json:"report_type"`
	Topic            string          `json:"topic"`
	GeneratedAt      string          `json:"generated_at"`
	WordCount        int             `json:"word_count"`
	ExecutiveSummary string          `json:"executive_summary"`
	Sections         []ReportSection `json:"sections"`
	KeyFindings      []string        `json:"key_findings"`
	Risks            []string        `json:"risks"`
	Opportunities    []string        `json:"opportunities"`
	Conclusion       string          `json:"conclusion"`
	DataSourcesUsed  []string        `json:"data_sources_used"`
	ConfidenceScore  float64         `json:"confidence_score"`
}

type ReportSection struct {
	Title       string   `json:"title"`
	Content     string   `json:"content"`
	DataSources []string `json:"data_sources"`
}

// reportData holds all gathered raw data before writing.
type reportData struct {
	tokenData     *CryptoScannerOutput
	redditPosts   []redditPost
	newsHeadlines []string
	cgSentimentUp float64
	cgSentimentDn float64
	webContent    string
	sources       []string
}

// ─── Section defaults per report type ────────────────────────

var reportSections = map[string][]string{
	"market_analysis":     {"market_overview", "price_analysis", "sentiment", "competitors", "outlook"},
	"project_overview":    {"introduction", "technology", "tokenomics", "team", "roadmap", "risks"},
	"investment_thesis":   {"executive_summary", "opportunity", "competitive_advantage", "risks", "valuation", "conclusion"},
	"technical_deep_dive": {"architecture", "consensus", "scalability", "security", "developer_ecosystem", "limitations"},
}

var targetWordCounts = map[string]int{
	"short":  150,
	"medium": 300,
	"long":   500,
}

// ─── Main entry ──────────────────────────────────────────────

func RunReportComposerAgent(ctx context.Context, inputs map[string]any, deepseekKey, birdeyeKey, apifyKey string) (*ReportOutput, error) {
	topic, _ := inputs["topic"].(string)
	if topic == "" {
		return nil, fmt.Errorf("topic is required")
	}

	reportType, _ := inputs["report_type"].(string)
	if reportType == "" {
		reportType = "market_analysis"
	}

	if deepseekKey == "" {
		return nil, fmt.Errorf("DEEPSEEK_API_KEY is required for report generation")
	}

	tokenAddr, _ := inputs["token_address"].(string)
	targetLength, _ := inputs["target_length"].(string)
	if targetLength == "" {
		targetLength = "medium"
	}

	var includeOverride []string
	if raw, ok := inputs["include_sections"]; ok {
		if arr, ok := raw.([]any); ok {
			for _, v := range arr {
				if s, ok := v.(string); ok {
					includeOverride = append(includeOverride, s)
				}
			}
		}
	}

	httpClient := &http.Client{Timeout: 20 * time.Second}

	// 1. Gather data from multiple sources
	log.Printf("[Composer] Gathering data for topic: %s", topic)
	data := gatherReportData(ctx, httpClient, topic, tokenAddr, birdeyeKey)

	// 2. Determine sections
	sections := getSectionsForType(reportType, includeOverride)

	// 3. Write each section via DeepSeek
	log.Printf("[Composer] Writing %d sections for %s report", len(sections), reportType)
	wordTarget := targetWordCounts[targetLength]
	if wordTarget == 0 {
		wordTarget = 300
	}

	var writtenSections []ReportSection
	totalWords := 0

	for _, sectionName := range sections {
		content, err := writeSection(ctx, httpClient, deepseekKey, sectionName, reportType, topic, data, wordTarget)
		if err != nil {
			log.Printf("[Composer] Failed to write section %s: %v", sectionName, err)
			content = fmt.Sprintf("[Section generation failed: %v]", err)
		}
		sectionWords := len(strings.Fields(content))
		totalWords += sectionWords

		writtenSections = append(writtenSections, ReportSection{
			Title:       formatSectionTitle(sectionName),
			Content:     content,
			DataSources: data.sources,
		})
	}

	// 4. Generate executive summary + findings
	log.Printf("[Composer] Writing executive summary and findings")
	execSummary, findings, risks, opportunities, conclusion := writeMetaSections(ctx, httpClient, deepseekKey, topic, reportType, writtenSections)

	totalWords += len(strings.Fields(execSummary)) + len(strings.Fields(conclusion))

	// 5. Calculate confidence
	confidence := calculateConfidence(data)

	out := &ReportOutput{
		Title:            fmt.Sprintf("%s: %s", formatSectionTitle(reportType), topic),
		ReportType:       reportType,
		Topic:            topic,
		GeneratedAt:      time.Now().UTC().Format(time.RFC3339),
		WordCount:        totalWords,
		ExecutiveSummary: execSummary,
		Sections:         writtenSections,
		KeyFindings:      findings,
		Risks:            risks,
		Opportunities:    opportunities,
		Conclusion:       conclusion,
		DataSourcesUsed:  data.sources,
		ConfidenceScore:  confidence,
	}

	return out, nil
}

// ═══════════════════════════════════════════════════════════════
//  Data gathering — reuses functions from other agents
// ═══════════════════════════════════════════════════════════════

func gatherReportData(ctx context.Context, client *http.Client, topic, tokenAddr, birdeyeKey string) *reportData {
	d := &reportData{
		sources: []string{},
	}

	// Token data via CoinGecko
	coinID := searchCoinGecko(ctx, client, topic)
	if coinID != "" {
		tokenOut := &CryptoScannerOutput{RiskFactors: []string{}, DataSources: []string{}}
		fetchCoinGeckoDetails(ctx, client, coinID, tokenOut)
		if tokenOut.PriceUSD > 0 {
			d.tokenData = tokenOut
			d.sources = append(d.sources, "coingecko")
		}
	}

	// Birdeye if address provided
	if tokenAddr != "" && birdeyeKey != "" {
		if d.tokenData == nil {
			d.tokenData = &CryptoScannerOutput{RiskFactors: []string{}, DataSources: []string{}}
		}
		fetchBirdeyeOverview(ctx, client, birdeyeKey, tokenAddr, "solana", d.tokenData)
		fetchBirdeyeSecurity(ctx, client, birdeyeKey, tokenAddr, "solana", d.tokenData)
		d.sources = append(d.sources, "birdeye")
	}

	// DexScreener if address provided
	if tokenAddr != "" {
		if d.tokenData == nil {
			d.tokenData = &CryptoScannerOutput{RiskFactors: []string{}, DataSources: []string{}}
		}
		fetchDexScreener(ctx, client, tokenAddr, d.tokenData)
		d.sources = append(d.sources, "dexscreener")
	}

	// Reddit posts
	posts := fetchRedditPosts(ctx, client, topic, "week")
	if len(posts) > 0 {
		d.redditPosts = posts
		d.sources = append(d.sources, "reddit")
	}

	// News headlines
	headlines := fetchNewsHeadlines(ctx, client, topic)
	if len(headlines) > 0 {
		d.newsHeadlines = headlines
		d.sources = append(d.sources, "crypto_news_rss")
	}

	// CoinGecko sentiment
	up, dn := fetchCoinGeckoSentiment(ctx, client, topic)
	d.cgSentimentUp = up
	d.cgSentimentDn = dn

	return d
}

// ═══════════════════════════════════════════════════════════════
//  Section management
// ═══════════════════════════════════════════════════════════════

func getSectionsForType(reportType string, includeOverride []string) []string {
	if len(includeOverride) > 0 {
		return includeOverride
	}
	if sections, ok := reportSections[reportType]; ok {
		return sections
	}
	return reportSections["market_analysis"]
}

func formatSectionTitle(name string) string {
	words := strings.Split(name, "_")
	for i, w := range words {
		if len(w) > 0 {
			words[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	return strings.Join(words, " ")
}

// ═══════════════════════════════════════════════════════════════
//  DeepSeek section writing
// ═══════════════════════════════════════════════════════════════

func buildDataContext(d *reportData) string {
	var parts []string

	if d.tokenData != nil {
		t := d.tokenData
		parts = append(parts, fmt.Sprintf("Token: %s (%s), Price: $%.6f, MCap: $%.0f, Vol24h: $%.0f, Change24h: %.1f%%",
			t.TokenName, t.Symbol, t.PriceUSD, t.MarketCapUSD, t.Volume24h, t.PriceChange24h))
		if t.Holders > 0 {
			parts = append(parts, fmt.Sprintf("Holders: %d", t.Holders))
		}
		if len(t.RiskFactors) > 0 {
			parts = append(parts, fmt.Sprintf("Risk factors: %s", strings.Join(t.RiskFactors, "; ")))
		}
		if t.Description != "" {
			desc := t.Description
			if len(desc) > 300 {
				desc = desc[:300]
			}
			parts = append(parts, fmt.Sprintf("Description: %s", desc))
		}
	}

	if len(d.redditPosts) > 0 {
		var titles []string
		for i, p := range d.redditPosts {
			if i >= 10 {
				break
			}
			titles = append(titles, fmt.Sprintf("[score:%d] %s", p.Score, p.Title))
		}
		parts = append(parts, fmt.Sprintf("Reddit posts (%d total): %s", len(d.redditPosts), strings.Join(titles, " | ")))
	}

	if len(d.newsHeadlines) > 0 {
		parts = append(parts, fmt.Sprintf("News headlines: %s", strings.Join(d.newsHeadlines, " | ")))
	}

	if d.cgSentimentUp > 0 || d.cgSentimentDn > 0 {
		parts = append(parts, fmt.Sprintf("CoinGecko sentiment: %.0f%% bullish, %.0f%% bearish", d.cgSentimentUp, d.cgSentimentDn))
	}

	if len(parts) == 0 {
		return "Limited data available. Write based on general knowledge."
	}
	return strings.Join(parts, "\n")
}

func writeSection(ctx context.Context, client *http.Client, deepseekKey, sectionName, reportType, topic string, data *reportData, wordTarget int) (string, error) {
	dataCtx := buildDataContext(data)

	sectionTitle := formatSectionTitle(sectionName)
	contextData := dataCtx

	prompt := fmt.Sprintf(`You are a principal-level research director who has authored institutional research reports for hedge funds and family offices.

Write the "%s" section for a %s report about "%s".

Standards:
- Bloomberg/Goldman Sachs research quality. Professional, precise, no hyperbole.
- Every claim must be backed by data or flagged as speculation.
- Be concise but complete. No filler words.

Available data:
%s

Write 2-4 paragraphs. Use markdown formatting.`, sectionTitle, formatSectionTitle(reportType), topic, contextData)

	content, err := callDeepSeekChat(ctx, client, deepseekKey, prompt, 0.4)
	if err != nil {
		return "", err
	}
	return content, nil
}

func writeMetaSections(ctx context.Context, client *http.Client, deepseekKey, topic, reportType string, sections []ReportSection) (execSummary string, findings, risks, opportunities []string, conclusion string) {
	// Collect all section content for context
	var allContent strings.Builder
	for _, s := range sections {
		allContent.WriteString(s.Title + ": ")
		content := s.Content
		if len(content) > 500 {
			content = content[:500]
		}
		allContent.WriteString(content + "\n\n")
	}

	sectionsText := allContent.String()

	prompt := fmt.Sprintf(`You are a principal research director. Based on this %s report about "%s", generate a JSON summary:
{
  "key_findings": ["3-5 most important findings with supporting data"],
  "risks": ["specific risks with likelihood H/M/L and impact H/M/L"],
  "opportunities": ["specific opportunities with timeframe"],
  "conclusion": "2-3 sentence conclusion with bull/base/bear case"
}

Report sections:
%s`, formatSectionTitle(reportType), topic, sectionsText)

	raw, err := callDeepSeekChat(ctx, client, deepseekKey, prompt, 0.2)
	if err != nil {
		log.Printf("[Composer] Meta-section generation failed: %v", err)
		execSummary = fmt.Sprintf("This report provides a %s analysis of %s based on available market data and community sentiment.", reportType, topic)
		findings = []string{"See individual sections for detailed findings"}
		risks = []string{"Insufficient data for comprehensive risk assessment"}
		opportunities = []string{"Further research recommended"}
		conclusion = "This report was generated with limited AI analysis."
		return
	}

	raw = extractJSON(raw)

	var meta struct {
		ExecutiveSummary string   `json:"executive_summary"`
		KeyFindings      []string `json:"key_findings"`
		Risks            []string `json:"risks"`
		Opportunities    []string `json:"opportunities"`
		Conclusion       string   `json:"conclusion"`
	}
	if err := json.Unmarshal([]byte(raw), &meta); err != nil {
		log.Printf("[Composer] Meta JSON parse failed: %v", err)
		execSummary = raw // Use raw text as summary
		findings = []string{"See report sections"}
		risks = []string{"See risk sections"}
		opportunities = []string{"See opportunity sections"}
		conclusion = "Report generation completed."
		return
	}

	return meta.ExecutiveSummary, meta.KeyFindings, meta.Risks, meta.Opportunities, meta.Conclusion
}

// ─── DeepSeek chat helper ────────────────────────────────────

func callDeepSeekChat(ctx context.Context, client *http.Client, key, prompt string, temperature float64) (string, error) {
	payload := map[string]any{
		"model": "deepseek-chat",
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"temperature": temperature,
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequestWithContext(ctx, "POST", "https://api.deepseek.com/chat/completions", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")

	resp, err := retryDo(client, req, 3)
	if err != nil {
		return "", fmt.Errorf("deepseek request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("deepseek HTTP %d", resp.StatusCode)
	}

	var chatResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return "", fmt.Errorf("deepseek response parse error: %v", err)
	}
	if len(chatResp.Choices) == 0 {
		return "", fmt.Errorf("deepseek returned no choices")
	}

	return chatResp.Choices[0].Message.Content, nil
}

// ─── Confidence calculation ──────────────────────────────────

func calculateConfidence(d *reportData) float64 {
	score := 0.3 // base

	if d.tokenData != nil && d.tokenData.PriceUSD > 0 {
		score += 0.2
	}
	if len(d.redditPosts) > 5 {
		score += 0.15
	} else if len(d.redditPosts) > 0 {
		score += 0.08
	}
	if len(d.newsHeadlines) > 3 {
		score += 0.15
	} else if len(d.newsHeadlines) > 0 {
		score += 0.08
	}
	if d.cgSentimentUp > 0 || d.cgSentimentDn > 0 {
		score += 0.1
	}
	if len(d.sources) >= 4 {
		score += 0.1
	}

	if score > 1.0 {
		score = 1.0
	}
	return score
}
