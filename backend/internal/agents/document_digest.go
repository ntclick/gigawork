package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ledongthuc/pdf"
)

// ─── Types ───────────────────────────────────────────────────

type DigestOutput struct {
	Title              string            `json:"title"`
	SourceURL          string            `json:"source_url"`
	DocumentType       string            `json:"document_type"`
	WordCount          int               `json:"word_count"`
	ReadingTimeMinutes int               `json:"reading_time_minutes"`
	Summary            string            `json:"summary"`
	KeyPoints          []string          `json:"key_points"`
	Sections           []DigestSection   `json:"sections"`
	Entities           DigestEntities    `json:"entities"`
	FocusAnalysis      map[string]string `json:"focus_analysis,omitempty"`
	Sentiment          string            `json:"sentiment"`
	CredibilitySignals []string          `json:"credibility_signals"`
	RedFlags           []string          `json:"red_flags"`
}

type DigestSection struct {
	Heading string `json:"heading"`
	Summary string `json:"summary"`
}

type DigestEntities struct {
	People         []string `json:"people"`
	Organizations  []string `json:"organizations"`
	Technologies   []string `json:"technologies"`
	Dates          []string `json:"dates"`
}

const maxDocChars = 50000

// ─── Main entry ──────────────────────────────────────────────

func RunDocumentDigestAgent(ctx context.Context, inputs map[string]any, deepseekKey, apifyKey string) (*DigestOutput, error) {
	url, _ := inputs["url"].(string)
	if url == "" {
		return nil, fmt.Errorf("url is required")
	}

	var focusAreas []string
	if raw, ok := inputs["focus_areas"]; ok {
		if arr, ok := raw.([]any); ok {
			for _, v := range arr {
				if s, ok := v.(string); ok {
					focusAreas = append(focusAreas, s)
				}
			}
		}
	}
	outputFormat, _ := inputs["output_format"].(string)
	if outputFormat == "" {
		outputFormat = "summary"
	}

	httpClient := &http.Client{Timeout: 30 * time.Second}

	// 1. Fetch document content
	rawText, docType, err := fetchDocument(ctx, httpClient, url)
	if err != nil || strings.TrimSpace(rawText) == "" {
		log.Printf("[Digest] Direct fetch failed or empty for %s: %v, trying Apify", url, err)
		if apifyKey != "" {
			rawText, err = fetchViaApify(ctx, httpClient, apifyKey, url)
			if err != nil {
				return nil, fmt.Errorf("failed to fetch document: %v", err)
			}
			docType = "webpage"
		} else if err != nil {
			return nil, fmt.Errorf("failed to fetch document: %v", err)
		}
	}

	if strings.TrimSpace(rawText) == "" {
		return nil, fmt.Errorf("no text content extracted from %s", url)
	}

	// Cap content
	if len(rawText) > maxDocChars {
		rawText = rawText[:maxDocChars]
	}

	wordCount := len(strings.Fields(rawText))
	readingTime := wordCount / 230
	if readingTime < 1 {
		readingTime = 1
	}

	out := &DigestOutput{
		SourceURL:          url,
		DocumentType:       docType,
		WordCount:          wordCount,
		ReadingTimeMinutes: readingTime,
		KeyPoints:          []string{},
		Sections:           []DigestSection{},
		Entities: DigestEntities{
			People:        []string{},
			Organizations: []string{},
			Technologies:  []string{},
			Dates:         []string{},
		},
		CredibilitySignals: []string{},
		RedFlags:           []string{},
	}

	// 2. Analyze with DeepSeek (or fallback)
	if deepseekKey != "" {
		digestAnalyze(ctx, httpClient, deepseekKey, rawText, focusAreas, outputFormat, out)
	} else {
		log.Printf("[Digest] No DeepSeek key, using basic digest")
		basicDigest(rawText, out)
	}

	return out, nil
}

// ═══════════════════════════════════════════════════════════════
//  Document fetching
// ═══════════════════════════════════════════════════════════════

func fetchDocument(ctx context.Context, client *http.Client, url string) (string, string, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("User-Agent", "GigaWork-DigestAgent/1.0")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/pdf,*/*")

	resp, err := retryDo(client, req, 3)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return "", "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	ct := resp.Header.Get("Content-Type")

	if strings.Contains(ct, "pdf") {
		text, err := extractPDFText(resp.Body)
		return text, "pdf", err
	}

	// HTML or plain text
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxDocChars+10000))
	if err != nil {
		return "", "", err
	}

	raw := string(body)
	if !utf8.ValidString(raw) {
		raw = strings.ToValidUTF8(raw, "")
	}

	if strings.Contains(ct, "html") {
		text := stripHTML(raw)
		docType := "webpage"
		lowerURL := strings.ToLower(url)
		if strings.Contains(lowerURL, "whitepaper") || strings.Contains(lowerURL, "wp") {
			docType = "whitepaper"
		} else if strings.Contains(lowerURL, "docs") || strings.Contains(lowerURL, "documentation") {
			docType = "docs"
		}
		return text, docType, nil
	}

	return raw, "webpage", nil
}

func extractPDFText(r io.Reader) (string, error) {
	data, err := io.ReadAll(io.LimitReader(r, 10*1024*1024))
	if err != nil {
		return "", err
	}

	// Use github.com/ledongthuc/pdf — pure Go PDF parser
	reader, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("PDF parse failed: %w", err)
	}

	var result strings.Builder
	totalPages := reader.NumPage()

	for pageNum := 1; pageNum <= totalPages; pageNum++ {
		page := reader.Page(pageNum)
		if page.V.IsNull() {
			continue
		}

		// Use Content() to get positioned text runs — add spaces between runs
		// because PDFs often use positioning instead of space chars.
		content := page.Content()
		var lastX, lastY float64
		firstRun := true
		for _, t := range content.Text {
			// New line if Y position changed significantly
			if !firstRun && (lastY-t.Y > 5 || t.Y-lastY > 5) {
				result.WriteString("\n")
			} else if !firstRun && t.X-lastX > 2 {
				// Same line but X moved forward → space
				result.WriteString(" ")
			}
			result.WriteString(t.S)
			lastX = t.X + t.W
			lastY = t.Y
			firstRun = false
		}
		result.WriteString("\n\n")

		// Stop if we've extracted enough
		if result.Len() > maxDocChars {
			break
		}
	}

	extracted := result.String()

	// Clean up whitespace and ensure valid UTF-8
	if !utf8.ValidString(extracted) {
		extracted = strings.ToValidUTF8(extracted, "")
	}
	// Collapse multiple spaces but preserve newlines
	extracted = regexp.MustCompile(`[ \t]+`).ReplaceAllString(extracted, " ")
	extracted = regexp.MustCompile(`\n{3,}`).ReplaceAllString(extracted, "\n\n")
	extracted = strings.TrimSpace(extracted)

	if len(extracted) > maxDocChars {
		extracted = extracted[:maxDocChars]
	}

	if len(strings.Fields(extracted)) < 10 {
		return "", fmt.Errorf("PDF text extraction yielded too little text (%d words from %d pages)", len(strings.Fields(extracted)), totalPages)
	}

	log.Printf("[Digest] Extracted %d words from %d PDF pages", len(strings.Fields(extracted)), totalPages)
	return extracted, nil
}

var htmlTagRe = regexp.MustCompile(`<[^>]*>`)
var htmlScriptRe = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>|<style[^>]*>.*?</style>|<noscript[^>]*>.*?</noscript>`)
var htmlEntityRe = regexp.MustCompile(`&[a-zA-Z]+;|&#[0-9]+;`)
var whitespaceRe = regexp.MustCompile(`[ \t]+`)
var newlineRe = regexp.MustCompile(`\n{3,}`)

func stripHTML(html string) string {
	// Remove script/style blocks
	text := htmlScriptRe.ReplaceAllString(html, "")
	// Remove tags
	text = htmlTagRe.ReplaceAllString(text, "\n")
	// Remove HTML entities
	text = htmlEntityRe.ReplaceAllString(text, " ")
	// Collapse whitespace
	text = whitespaceRe.ReplaceAllString(text, " ")
	text = newlineRe.ReplaceAllString(text, "\n\n")
	return strings.TrimSpace(text)
}

func fetchViaApify(ctx context.Context, client *http.Client, apifyKey, url string) (string, error) {
	apiURL := "https://api.apify.com/v2/acts/apify~cheerio-scraper/runs?token=" + apifyKey
	payload := map[string]any{
		"startUrls":           []map[string]string{{"url": url}},
		"maxRequestsPerCrawl": 1,
		"pageFunction":        "async function pageFunction(context) { const { $, request } = context; return { url: request.url, title: $('title').text(), text: $('body').text().substring(0, 50000) }; }",
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := retryDo(client, req, 3)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("apify error %d: %s", resp.StatusCode, string(respBody))
	}

	var runResp struct {
		Data struct {
			ID               string `json:"id"`
			DefaultDatasetID string `json:"defaultDatasetId"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&runResp); err != nil {
		return "", err
	}

	// Poll for completion (max 60s)
	runID := runResp.Data.ID
	datasetID := runResp.Data.DefaultDatasetID
	for i := 0; i < 20; i++ {
		time.Sleep(3 * time.Second)
		sURL := fmt.Sprintf("https://api.apify.com/v2/actor-runs/%s?token=%s", runID, apifyKey)
		sReq, _ := http.NewRequestWithContext(ctx, "GET", sURL, nil)
		sResp, err := retryDo(client, sReq, 2)
		if err != nil {
			continue
		}
		var sr struct {
			Data struct {
				Status           string `json:"status"`
				DefaultDatasetID string `json:"defaultDatasetId"`
			} `json:"data"`
		}
		json.NewDecoder(sResp.Body).Decode(&sr)
		sResp.Body.Close()
		if sr.Data.DefaultDatasetID != "" {
			datasetID = sr.Data.DefaultDatasetID
		}
		if sr.Data.Status == "SUCCEEDED" {
			break
		}
		if sr.Data.Status == "FAILED" || sr.Data.Status == "ABORTED" {
			return "", fmt.Errorf("apify run %s: %s", runID, sr.Data.Status)
		}
	}

	// Fetch items
	iURL := fmt.Sprintf("https://api.apify.com/v2/datasets/%s/items?token=%s&limit=1", datasetID, apifyKey)
	iReq, _ := http.NewRequestWithContext(ctx, "GET", iURL, nil)
	iResp, err := retryDo(client, iReq, 3)
	if err != nil {
		return "", err
	}
	defer iResp.Body.Close()

	var items []map[string]any
	if err := json.NewDecoder(iResp.Body).Decode(&items); err != nil || len(items) == 0 {
		return "", fmt.Errorf("no items from apify")
	}

	text, _ := items[0]["text"].(string)
	if text == "" {
		raw, _ := json.Marshal(items[0])
		text = string(raw)
	}
	return text, nil
}

// ═══════════════════════════════════════════════════════════════
//  DeepSeek analysis
// ═══════════════════════════════════════════════════════════════

func digestAnalyze(ctx context.Context, client *http.Client, deepseekKey, rawText string, focusAreas []string, outputFormat string, out *DigestOutput) {
	// Cap text sent to LLM
	llmText := rawText
	if len(llmText) > 12000 {
		llmText = llmText[:12000]
	}

	focusPrompt := ""
	if len(focusAreas) > 0 {
		focusPrompt = fmt.Sprintf(`
Also analyze these specific focus areas and include a "focus_analysis" object with one key per area:
Focus areas: %s`, strings.Join(focusAreas, ", "))
	}

	prompt := fmt.Sprintf(`You are a senior analyst specializing in crypto, DeFi, and blockchain technical documents.

Analyze the document below and return a JSON object matching EXACTLY this schema. ALL fields are REQUIRED — never leave arrays empty if the document contains relevant information.

{
  "title": "extract the document's actual title from the first few lines",
  "summary": "3-5 sentence executive synthesis. Lead with the single most important insight. What problem does it solve? What is the key innovation? What are the implications?",
  "key_points": ["5-10 specific findings with numbers, dates, and technical details"],
  "sections": [
    {"heading": "Section name from document", "summary": "1-2 sentence summary of this section"}
  ],
  "entities": {
    "people": ["named individuals mentioned"],
    "organizations": ["companies, protocols, DAOs mentioned"],
    "technologies": ["specific tech, protocols, standards (e.g. ERC-20, zk-SNARK, BFT consensus)"],
    "dates": ["important dates mentioned (e.g. launch dates, milestones)"]
  },
  "sentiment": "positive|negative|neutral",
  "credibility_signals": ["indicators this document is credible: cited papers, named authors, clear methodology, verifiable claims, team backgrounds"],
  "red_flags": ["vague claims, missing team info, no audit, unrealistic promises, plagiarism, grammatical issues"]
}

CRITICAL RULES:
- Extract REAL content from the document. Never invent entities.
- If the document mentions specific numbers ("$47B market cap", "3000 TPS", "Layer 1"), include them in key_points.
- sections must have "heading" key (not "title"). Extract actual section headings from the document.
- Include at least 3-5 sections if the document has them.
- Include at least 2-3 entities per category if they exist in the document.
- Return ONLY the JSON object, no markdown code fences, no explanation.
%s
Document text:
%s`, focusPrompt, llmText)
	_ = outputFormat

	payload := map[string]any{
		"model": "deepseek-chat",
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"temperature":      0.3,
		"response_format":  map[string]string{"type": "json_object"},
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequestWithContext(ctx, "POST", "https://api.deepseek.com/chat/completions", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+deepseekKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := retryDo(client, req, 3)
	if err != nil {
		log.Printf("[Digest] DeepSeek error: %v, using basic digest", err)
		basicDigest(rawText, out)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		log.Printf("[Digest] DeepSeek HTTP %d, using basic digest", resp.StatusCode)
		basicDigest(rawText, out)
		return
	}

	var chatResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil || len(chatResp.Choices) == 0 {
		log.Printf("[Digest] DeepSeek parse failed, using basic digest")
		basicDigest(rawText, out)
		return
	}

	content := extractJSON(chatResp.Choices[0].Message.Content)

	var analysis struct {
		Title              string            `json:"title"`
		Summary            string            `json:"summary"`
		KeyPoints          []string          `json:"key_points"`
		Sections           []DigestSection   `json:"sections"`
		Entities           DigestEntities    `json:"entities"`
		FocusAnalysis      map[string]string `json:"focus_analysis"`
		Sentiment          string            `json:"sentiment"`
		CredibilitySignals []string          `json:"credibility_signals"`
		RedFlags           []string          `json:"red_flags"`
	}
	if err := json.Unmarshal([]byte(content), &analysis); err != nil {
		log.Printf("[Digest] DeepSeek JSON invalid: %v, using basic digest", err)
		basicDigest(rawText, out)
		return
	}

	out.Title = analysis.Title
	out.Summary = analysis.Summary
	out.KeyPoints = analysis.KeyPoints
	out.Sections = analysis.Sections
	out.Entities = analysis.Entities
	out.Sentiment = analysis.Sentiment
	if analysis.FocusAnalysis != nil {
		out.FocusAnalysis = analysis.FocusAnalysis
	}
	if analysis.CredibilitySignals != nil {
		out.CredibilitySignals = analysis.CredibilitySignals
	}
	if analysis.RedFlags != nil {
		out.RedFlags = analysis.RedFlags
	}
}

// ═══════════════════════════════════════════════════════════════
//  Basic fallback (no AI)
// ═══════════════════════════════════════════════════════════════

func basicDigest(rawText string, out *DigestOutput) {
	// Split into sentences
	sentences := splitSentences(rawText)

	// Title: first sentence or first line
	if len(sentences) > 0 {
		title := sentences[0]
		if len(title) > 100 {
			title = title[:100] + "..."
		}
		out.Title = title
	}

	// Summary: first 3 sentences
	summaryCount := 3
	if len(sentences) < summaryCount {
		summaryCount = len(sentences)
	}
	out.Summary = strings.Join(sentences[:summaryCount], " ")

	// Key points: next 10 sentences with substance
	var points []string
	for i := summaryCount; i < len(sentences) && len(points) < 10; i++ {
		s := strings.TrimSpace(sentences[i])
		if len(s) > 30 {
			points = append(points, s)
		}
	}
	out.KeyPoints = points

	out.Sentiment = "neutral"
	out.CredibilitySignals = []string{"Document was accessible and parseable"}

	if out.WordCount < 500 {
		out.RedFlags = append(out.RedFlags, "Very short document — may be incomplete")
	}
}

func splitSentences(text string) []string {
	// Split on . ! ? followed by space or newline
	re := regexp.MustCompile(`[.!?]\s+`)
	raw := re.Split(text, -1)
	var sentences []string
	for _, s := range raw {
		s = strings.TrimSpace(s)
		if len(s) > 10 {
			sentences = append(sentences, s)
		}
	}
	return sentences
}
