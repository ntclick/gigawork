package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ─── Types ───────────────────────────────────────────────────

type SentimentOutput struct {
	Topic              string          `json:"topic"`
	Timeframe          string          `json:"timeframe"`
	OverallSentiment   string          `json:"overall_sentiment"`
	SentimentScore     int             `json:"sentiment_score"`
	Confidence         float64         `json:"confidence"`
	Sources            SentimentSources `json:"sources"`
	KeyNarratives      []string        `json:"key_narratives"`
	RiskSignals        []string        `json:"risk_signals"`
	OpportunitySignals []string        `json:"opportunity_signals"`
	Summary            string          `json:"summary"`
}

type SentimentSources struct {
	Reddit  SourceData `json:"reddit"`
	Twitter SourceData `json:"twitter"`
	News    SourceData `json:"news"`
}

type SourceData struct {
	Sentiment   string   `json:"sentiment"`
	PostCount   int      `json:"post_count"`
	MentionCount int     `json:"mention_count,omitempty"`
	ArticleCount int     `json:"article_count,omitempty"`
	TopKeywords []string `json:"top_keywords"`
	Headlines   []string `json:"headlines,omitempty"`
}

type redditPost struct {
	Title       string
	Text        string
	Score       int
	Comments    int
	CreatedUTC  float64
	Subreddit   string
}

// ─── Main entry ──────────────────────────────────────────────

func RunSocialSentimentAgent(ctx context.Context, inputs map[string]any, deepseekKey string) (*SentimentOutput, error) {
	topic, _ := inputs["topic"].(string)
	if topic == "" {
		return nil, fmt.Errorf("topic is required")
	}

	timeframe, _ := inputs["timeframe"].(string)
	if timeframe == "" {
		timeframe = "24h"
	}

	httpClient := &http.Client{Timeout: 15 * time.Second}

	out := &SentimentOutput{
		Topic:     topic,
		Timeframe: timeframe,
		Sources: SentimentSources{
			Reddit:  SourceData{TopKeywords: []string{}},
			Twitter: SourceData{TopKeywords: []string{}},
			News:    SourceData{TopKeywords: []string{}, Headlines: []string{}},
		},
		KeyNarratives:      []string{},
		RiskSignals:        []string{},
		OpportunitySignals: []string{},
	}

	// 1. Reddit
	redditTimeParam := redditTimeParam(timeframe)
	posts := fetchRedditPosts(ctx, httpClient, topic, redditTimeParam)
	out.Sources.Reddit.PostCount = len(posts)
	out.Sources.Reddit.TopKeywords = extractKeywords(posts, 5)
	out.Sources.Reddit.Sentiment = keywordSentimentLabel(posts)

	// 2. CoinGecko community sentiment
	cgUp, cgDown := fetchCoinGeckoSentiment(ctx, httpClient, topic)
	if cgUp > 0 || cgDown > 0 {
		if cgUp > 70 {
			out.Sources.Twitter.Sentiment = "bullish"
		} else if cgDown > 70 {
			out.Sources.Twitter.Sentiment = "bearish"
		} else {
			out.Sources.Twitter.Sentiment = "neutral"
		}
		out.Sources.Twitter.MentionCount = int(cgUp + cgDown)
		out.Sources.Twitter.TopKeywords = []string{fmt.Sprintf("%.0f%% bullish", cgUp), fmt.Sprintf("%.0f%% bearish", cgDown)}
	}

	// 3. News headlines
	headlines := fetchNewsHeadlines(ctx, httpClient, topic)
	out.Sources.News.ArticleCount = len(headlines)
	out.Sources.News.Headlines = headlines
	out.Sources.News.Sentiment = headlineSentimentLabel(headlines)

	// Calculate total posts for confidence
	totalPosts := out.Sources.Reddit.PostCount + out.Sources.News.ArticleCount + out.Sources.Twitter.MentionCount
	log.Printf("[Sentiment] Data collected: reddit=%d, news=%d, coingecko=%d, total=%d",
		out.Sources.Reddit.PostCount, out.Sources.News.ArticleCount, out.Sources.Twitter.MentionCount, totalPosts)

	// Set confidence based on data volume
	if totalPosts < 5 {
		out.Confidence = 0.2
		log.Printf("[Sentiment] WARNING: insufficient data (%d total posts), low confidence", totalPosts)
	}

	// 4. DeepSeek analysis (or fallback)
	analyzeWithDeepSeek(ctx, httpClient, deepseekKey, posts, headlines, out)

	return out, nil
}

// ═══════════════════════════════════════════════════════════════
//  Reddit
// ═══════════════════════════════════════════════════════════════

func redditTimeParam(tf string) string {
	switch tf {
	case "7d":
		return "week"
	case "30d":
		return "month"
	default:
		return "day"
	}
}

func fetchRedditPosts(ctx context.Context, client *http.Client, topic, timeParam string) []redditPost {
	var allPosts []redditPost

	urls := []string{
		fmt.Sprintf("https://www.reddit.com/search.json?q=%s+crypto&sort=new&limit=25&t=%s", topic, timeParam),
		fmt.Sprintf("https://www.reddit.com/r/CryptoCurrency/search.json?q=%s&restrict_sr=on&sort=new&limit=15&t=%s", topic, timeParam),
	}

	for _, u := range urls {
		posts := fetchSingleReddit(ctx, client, u)
		allPosts = append(allPosts, posts...)
	}

	return allPosts
}

func fetchSingleReddit(ctx context.Context, client *http.Client, url string) []redditPost {
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("User-Agent", "GigaWork-SentimentAgent/1.0")

	resp, err := retryDo(client, req, 3)
	if err != nil {
		log.Printf("[Sentiment] Reddit fetch error: %v", err)
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		log.Printf("[Sentiment] Reddit HTTP %d for %s", resp.StatusCode, url)
		return nil
	}

	var result struct {
		Data struct {
			Children []struct {
				Data struct {
					Title      string  `json:"title"`
					Selftext   string  `json:"selftext"`
					Score      int     `json:"score"`
					NumComments int    `json:"num_comments"`
					CreatedUTC float64 `json:"created_utc"`
					Subreddit  string  `json:"subreddit"`
				} `json:"data"`
			} `json:"children"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("[Sentiment] Reddit parse error: %v", err)
		return nil
	}

	var posts []redditPost
	for _, child := range result.Data.Children {
		d := child.Data
		text := d.Selftext
		if len(text) > 500 {
			text = text[:500]
		}
		posts = append(posts, redditPost{
			Title:      d.Title,
			Text:       text,
			Score:      d.Score,
			Comments:   d.NumComments,
			CreatedUTC: d.CreatedUTC,
			Subreddit:  d.Subreddit,
		})
	}
	return posts
}

// ═══════════════════════════════════════════════════════════════
//  CoinGecko community sentiment
// ═══════════════════════════════════════════════════════════════

func fetchCoinGeckoSentiment(ctx context.Context, client *http.Client, topic string) (upPct, downPct float64) {
	// Search for the coin first
	searchURL := fmt.Sprintf("https://api.coingecko.com/api/v3/search?query=%s", topic)
	req, _ := http.NewRequestWithContext(ctx, "GET", searchURL, nil)
	resp, err := retryDo(client, req, 3)
	if err != nil {
		return 0, 0
	}
	defer resp.Body.Close()

	var search struct {
		Coins []struct {
			ID string `json:"id"`
		} `json:"coins"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&search); err != nil || len(search.Coins) == 0 {
		return 0, 0
	}

	coinID := search.Coins[0].ID

	detailURL := fmt.Sprintf("https://api.coingecko.com/api/v3/coins/%s?localization=false&tickers=false&community_data=false&developer_data=false", coinID)
	req2, _ := http.NewRequestWithContext(ctx, "GET", detailURL, nil)
	resp2, err := retryDo(client, req2, 3)
	if err != nil {
		return 0, 0
	}
	defer resp2.Body.Close()

	var detail struct {
		SentimentUp   float64 `json:"sentiment_votes_up_percentage"`
		SentimentDown float64 `json:"sentiment_votes_down_percentage"`
	}
	if err := json.NewDecoder(resp2.Body).Decode(&detail); err != nil {
		return 0, 0
	}

	return detail.SentimentUp, detail.SentimentDown
}

// ═══════════════════════════════════════════════════════════════
//  News RSS
// ═══════════════════════════════════════════════════════════════

func fetchNewsHeadlines(ctx context.Context, client *http.Client, topic string) []string {
	feeds := []string{
		fmt.Sprintf("https://news.google.com/rss/search?q=%s+crypto&hl=en", url.QueryEscape(topic)),
		"https://cointelegraph.com/rss",
		"https://cryptonews.com/news/feed/",
	}

	topicLower := strings.ToLower(topic)
	var headlines []string

	for _, feedURL := range feeds {
		titles := parseFeed(ctx, client, feedURL)
		for _, t := range titles {
			if strings.Contains(strings.ToLower(t), topicLower) {
				headlines = append(headlines, t)
			}
		}
		if len(headlines) >= 10 {
			break
		}
	}

	if len(headlines) > 10 {
		headlines = headlines[:10]
	}
	return headlines
}

func parseFeed(ctx context.Context, client *http.Client, feedURL string) []string {
	req, _ := http.NewRequestWithContext(ctx, "GET", feedURL, nil)
	req.Header.Set("User-Agent", "GigaWork-SentimentAgent/1.0")

	resp, err := retryDo(client, req, 3)
	if err != nil {
		log.Printf("[Sentiment] RSS fetch error for %s: %v", feedURL, err)
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil
	}

	// Parse RSS 2.0 XML
	var rss struct {
		Channel struct {
			Items []struct {
				Title string `xml:"title"`
			} `xml:"item"`
		} `xml:"channel"`
	}
	if err := xml.Unmarshal(body, &rss); err != nil {
		// Try Atom format
		var atom struct {
			Entries []struct {
				Title string `xml:"title"`
			} `xml:"entry"`
		}
		if err := xml.Unmarshal(body, &atom); err != nil {
			return nil
		}
		var titles []string
		for _, e := range atom.Entries {
			if e.Title != "" {
				titles = append(titles, e.Title)
			}
		}
		return titles
	}

	var titles []string
	for _, item := range rss.Channel.Items {
		if item.Title != "" {
			titles = append(titles, item.Title)
		}
	}
	return titles
}

// ═══════════════════════════════════════════════════════════════
//  DeepSeek analysis
// ═══════════════════════════════════════════════════════════════

func analyzeWithDeepSeek(ctx context.Context, client *http.Client, deepseekKey string, posts []redditPost, headlines []string, out *SentimentOutput) {
	// Build context for LLM
	var postSummaries []string
	for i, p := range posts {
		if i >= 15 {
			break
		}
		postSummaries = append(postSummaries, fmt.Sprintf("[r/%s score:%d] %s", p.Subreddit, p.Score, p.Title))
	}

	rawData, _ := json.Marshal(map[string]any{
		"topic":           out.Topic,
		"timeframe":       out.Timeframe,
		"reddit_posts":    postSummaries,
		"reddit_count":    out.Sources.Reddit.PostCount,
		"news_headlines":  headlines,
		"coingecko_sentiment": out.Sources.Twitter.TopKeywords,
	})

	// If no DeepSeek key → keyword fallback
	if deepseekKey == "" {
		log.Printf("[Sentiment] No DeepSeek key, using keyword fallback")
		applyKeywordFallback(posts, headlines, out)
		return
	}

	prompt := fmt.Sprintf(`You are a senior crypto market analyst with 10 years experience at a top-tier hedge fund. You have the analytical rigor of a Bloomberg Intelligence analyst.

Analyze social sentiment data about "%s" and return ONLY valid JSON:
{
  "sentiment_score": <-100 to +100>,
  "overall_sentiment": "<bullish|bearish|neutral>",
  "confidence": <0.0 to 1.0>,
  "key_narratives": ["<3-5 specific talking points with evidence>"],
  "risk_signals": ["<specific negative signals with source attribution>"],
  "opportunity_signals": ["<specific positive signals with source attribution>"],
  "summary": "<3-sentence professional market sentiment summary>"
}

Standards:
- Weight sources by credibility: verified news > Reddit posts with high engagement > low-score posts
- Distinguish organic sentiment from coordinated campaigns
- Identify specific catalysts (partnerships, listings, regulatory news)
- Confidence: <5 posts=0.1-0.2, 5-20=0.3-0.5, 20-100=0.5-0.8, 100+=0.8-1.0
- Never fabricate signals. Base everything on provided data.
- If data insufficient, state it explicitly.

Social data:
%s`, out.Topic, string(rawData))

	payload := map[string]any{
		"model": "deepseek-chat",
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"temperature": 0.3,
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequestWithContext(ctx, "POST", "https://api.deepseek.com/chat/completions", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+deepseekKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := retryDo(client, req, 3)
	if err != nil {
		log.Printf("[Sentiment] DeepSeek error: %v, using fallback", err)
		applyKeywordFallback(posts, headlines, out)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		log.Printf("[Sentiment] DeepSeek HTTP %d, using fallback", resp.StatusCode)
		applyKeywordFallback(posts, headlines, out)
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
		log.Printf("[Sentiment] DeepSeek parse failed, using fallback")
		applyKeywordFallback(posts, headlines, out)
		return
	}

	content := extractJSON(chatResp.Choices[0].Message.Content)

	var analysis struct {
		SentimentScore     int      `json:"sentiment_score"`
		OverallSentiment   string   `json:"overall_sentiment"`
		Confidence         float64  `json:"confidence"`
		KeyNarratives      []string `json:"key_narratives"`
		RiskSignals        []string `json:"risk_signals"`
		OpportunitySignals []string `json:"opportunity_signals"`
		Summary            string   `json:"summary"`
	}
	if err := json.Unmarshal([]byte(content), &analysis); err != nil {
		log.Printf("[Sentiment] DeepSeek JSON invalid: %v, using fallback", err)
		applyKeywordFallback(posts, headlines, out)
		return
	}

	out.SentimentScore = analysis.SentimentScore
	out.OverallSentiment = analysis.OverallSentiment
	out.Confidence = analysis.Confidence
	out.KeyNarratives = analysis.KeyNarratives
	out.RiskSignals = analysis.RiskSignals
	out.OpportunitySignals = analysis.OpportunitySignals
	out.Summary = analysis.Summary
}

// ═══════════════════════════════════════════════════════════════
//  Keyword-based fallbacks
// ═══════════════════════════════════════════════════════════════

var bullishWords = []string{"bullish", "moon", "pump", "breakout", "buy", "long", "undervalued", "gem", "ath", "rocket", "huge", "launch", "airdrop", "gains"}
var bearishWords = []string{"bearish", "dump", "crash", "sell", "short", "overvalued", "scam", "rug", "dead", "avoid", "risk", "hack", "exploit", "fraud"}

func countSentimentWords(text string) (bullish, bearish int) {
	lower := strings.ToLower(text)
	for _, w := range bullishWords {
		if strings.Contains(lower, w) {
			bullish++
		}
	}
	for _, w := range bearishWords {
		if strings.Contains(lower, w) {
			bearish++
		}
	}
	return
}

func keywordSentimentLabel(posts []redditPost) string {
	var totalBull, totalBear int
	for _, p := range posts {
		b, br := countSentimentWords(p.Title + " " + p.Text)
		totalBull += b
		totalBear += br
	}
	if totalBull > totalBear*2 {
		return "bullish"
	}
	if totalBear > totalBull*2 {
		return "bearish"
	}
	return "neutral"
}

func headlineSentimentLabel(headlines []string) string {
	var totalBull, totalBear int
	for _, h := range headlines {
		b, br := countSentimentWords(h)
		totalBull += b
		totalBear += br
	}
	if totalBull > totalBear {
		return "bullish"
	}
	if totalBear > totalBull {
		return "bearish"
	}
	return "neutral"
}

func applyKeywordFallback(posts []redditPost, headlines []string, out *SentimentOutput) {
	var totalBull, totalBear int
	for _, p := range posts {
		b, br := countSentimentWords(p.Title + " " + p.Text)
		totalBull += b
		totalBear += br
	}
	for _, h := range headlines {
		b, br := countSentimentWords(h)
		totalBull += b
		totalBear += br
	}

	total := totalBull + totalBear
	if total == 0 {
		out.SentimentScore = 0
		out.OverallSentiment = "neutral"
		out.Confidence = 0.3
		out.Summary = fmt.Sprintf("Insufficient data to determine sentiment for %s. Found %d Reddit posts and %d news articles.",
			out.Topic, out.Sources.Reddit.PostCount, out.Sources.News.ArticleCount)
		return
	}

	// Score: -100 to +100
	score := int((float64(totalBull-totalBear) / float64(total)) * 100)
	if score > 100 {
		score = 100
	}
	if score < -100 {
		score = -100
	}

	out.SentimentScore = score
	out.Confidence = 0.5

	if score > 30 {
		out.OverallSentiment = "bullish"
	} else if score < -30 {
		out.OverallSentiment = "bearish"
	} else {
		out.OverallSentiment = "neutral"
	}

	out.Summary = fmt.Sprintf("Keyword analysis of %d Reddit posts and %d news articles for %s shows %s sentiment (score: %d). "+
		"Found %d bullish and %d bearish signals.",
		out.Sources.Reddit.PostCount, out.Sources.News.ArticleCount, out.Topic,
		out.OverallSentiment, score, totalBull, totalBear)

	if totalBear > 3 {
		out.RiskSignals = append(out.RiskSignals, fmt.Sprintf("%d bearish keyword signals detected", totalBear))
	}
	if totalBull > 3 {
		out.OpportunitySignals = append(out.OpportunitySignals, fmt.Sprintf("%d bullish keyword signals detected", totalBull))
	}
}

func extractKeywords(posts []redditPost, limit int) []string {
	wordCount := make(map[string]int)
	stopWords := map[string]bool{
		"the": true, "a": true, "an": true, "is": true, "are": true, "was": true,
		"in": true, "on": true, "at": true, "to": true, "for": true, "of": true,
		"and": true, "or": true, "but": true, "not": true, "it": true, "this": true,
		"that": true, "with": true, "from": true, "by": true, "has": true, "have": true,
		"will": true, "can": true, "be": true, "do": true, "what": true, "how": true,
		"i": true, "you": true, "we": true, "my": true, "your": true, "just": true,
	}

	for _, p := range posts {
		words := strings.Fields(strings.ToLower(p.Title))
		for _, w := range words {
			w = strings.Trim(w, ".,!?()[]{}\"':;")
			if len(w) < 3 || stopWords[w] {
				continue
			}
			wordCount[w]++
		}
	}

	// Find top N by count
	type kv struct {
		Key   string
		Count int
	}
	var sorted []kv
	for k, v := range wordCount {
		sorted = append(sorted, kv{k, v})
	}
	// Simple selection sort for small dataset
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j].Count > sorted[i].Count {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}

	var result []string
	for i := 0; i < limit && i < len(sorted); i++ {
		result = append(result, sorted[i].Key)
	}
	return result
}
