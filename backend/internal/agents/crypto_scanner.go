package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// CryptoScannerOutput is the structured result from the crypto scanner agent.
type CryptoScannerOutput struct {
	TokenName      string   `json:"token_name"`
	Symbol         string   `json:"symbol"`
	PriceUSD       float64  `json:"price_usd"`
	MarketCapUSD   float64  `json:"market_cap_usd"`
	Volume24h      float64  `json:"volume_24h"`
	PriceChange24h float64  `json:"price_change_24h"`
	Holders        int      `json:"holders"`
	Description    string   `json:"description"`
	RiskScore      int      `json:"risk_score"`
	RiskFactors    []string `json:"risk_factors"`
	Sentiment      string   `json:"sentiment"`
	Summary        string   `json:"summary"`
	DataSources    []string `json:"data_sources"`
}

// RunCryptoScannerAgent researches a crypto token using Birdeye, CoinGecko,
// DexScreener, and DeepSeek for risk analysis.
func RunCryptoScannerAgent(ctx context.Context, inputs map[string]any, deepseekKey, birdeyeKey string) (*CryptoScannerOutput, error) {
	tokenName, _ := inputs["token_name"].(string)
	contractAddr, _ := inputs["contract_address"].(string)
	chain, _ := inputs["chain"].(string)

	if tokenName == "" && contractAddr == "" {
		return nil, fmt.Errorf("provide token_name or contract_address")
	}

	out := &CryptoScannerOutput{
		TokenName:   tokenName,
		RiskFactors: []string{},
		DataSources: []string{},
	}

	httpClient := &http.Client{Timeout: 15 * time.Second}

	// ─── Route 1: Contract address provided + Birdeye key available ───
	if contractAddr != "" && birdeyeKey != "" {
		log.Printf("[CryptoScanner] Using Birdeye for address %s", contractAddr)
		fetchBirdeyeOverview(ctx, httpClient, birdeyeKey, contractAddr, chain, out)
		fetchBirdeyeSecurity(ctx, httpClient, birdeyeKey, contractAddr, chain, out)
		fetchDexScreener(ctx, httpClient, contractAddr, out)
	} else if tokenName != "" {
		// ─── Route 2: Token name → CoinGecko search ───
		log.Printf("[CryptoScanner] Using CoinGecko for token %s", tokenName)
		coinID := searchCoinGecko(ctx, httpClient, tokenName)
		if coinID != "" {
			fetchCoinGeckoDetails(ctx, httpClient, coinID, out)
		}
		// If CoinGecko found a contract address, also hit DexScreener
		if contractAddr != "" {
			fetchDexScreener(ctx, httpClient, contractAddr, out)
		}
	} else if contractAddr != "" {
		// ─── Route 3: Contract address but no Birdeye key → DexScreener only ───
		log.Printf("[CryptoScanner] No Birdeye key, using DexScreener for %s", contractAddr)
		fetchDexScreener(ctx, httpClient, contractAddr, out)
	}

	// If we still have no name, use whatever we found
	if out.TokenName == "" {
		out.TokenName = tokenName
	}

	// ─── DeepSeek summary + risk assessment ───
	generateAnalysis(ctx, httpClient, deepseekKey, out)

	return out, nil
}

// ═══════════════════════════════════════════════════════════════
//  Birdeye API
// ═══════════════════════════════════════════════════════════════

func birdeyeChainParam(chain string) string {
	chain = strings.ToLower(chain)
	switch chain {
	case "ethereum", "eth":
		return "ethereum"
	case "base":
		return "base"
	case "bsc", "bnb":
		return "bsc"
	case "arbitrum", "arb":
		return "arbitrum"
	case "polygon", "matic":
		return "polygon"
	default:
		return "solana"
	}
}

func fetchBirdeyeOverview(ctx context.Context, client *http.Client, apiKey, address, chain string, out *CryptoScannerOutput) {
	chainParam := birdeyeChainParam(chain)
	url := fmt.Sprintf("https://public-api.birdeye.so/defi/token_overview?address=%s", address)

	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("X-API-KEY", apiKey)
	req.Header.Set("x-chain", chainParam)

	resp, err := retryDo(client, req, 3)
	if err != nil {
		log.Printf("[CryptoScanner] Birdeye overview error: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("[CryptoScanner] Birdeye overview HTTP %d: %s", resp.StatusCode, string(body))
		return
	}

	var result struct {
		Data struct {
			Name           string  `json:"name"`
			Symbol         string  `json:"symbol"`
			Price          float64 `json:"price"`
			MarketCap      float64 `json:"mc"`
			Volume24h      float64 `json:"v24hUSD"`
			PriceChange24h float64 `json:"priceChange24hPercent"`
			Holder         int     `json:"holder"`
			Description    string  `json:"description"`
		} `json:"data"`
		Success bool `json:"success"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("[CryptoScanner] Birdeye overview parse error: %v", err)
		return
	}

	if !result.Success {
		return
	}

	d := result.Data
	out.TokenName = d.Name
	out.Symbol = d.Symbol
	out.PriceUSD = d.Price
	out.MarketCapUSD = d.MarketCap
	out.Volume24h = d.Volume24h
	out.PriceChange24h = d.PriceChange24h
	out.Holders = d.Holder
	out.Description = d.Description
	out.DataSources = append(out.DataSources, "birdeye_overview")
}

func fetchBirdeyeSecurity(ctx context.Context, client *http.Client, apiKey, address, chain string, out *CryptoScannerOutput) {
	chainParam := birdeyeChainParam(chain)
	url := fmt.Sprintf("https://public-api.birdeye.so/defi/token_security?address=%s", address)

	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("X-API-KEY", apiKey)
	req.Header.Set("x-chain", chainParam)

	resp, err := retryDo(client, req, 3)
	if err != nil {
		log.Printf("[CryptoScanner] Birdeye security error: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return
	}

	var result struct {
		Data struct {
			IsHoneypot      *bool `json:"isHoneypot"`
			HasFreezeAuth   *bool `json:"freezeAuthority"`
			HasMintAuth     *bool `json:"mintAuthority"`
			IsMutable       *bool `json:"mutableMetadata"`
			TopHolderPct    float64 `json:"top10HolderPercent"`
		} `json:"data"`
		Success bool `json:"success"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return
	}

	if !result.Success {
		return
	}

	d := result.Data
	if d.IsHoneypot != nil && *d.IsHoneypot {
		out.RiskFactors = append(out.RiskFactors, "HONEYPOT detected")
	}
	if d.HasFreezeAuth != nil && *d.HasFreezeAuth {
		out.RiskFactors = append(out.RiskFactors, "Freeze authority enabled")
	}
	if d.HasMintAuth != nil && *d.HasMintAuth {
		out.RiskFactors = append(out.RiskFactors, "Mint authority enabled (unlimited supply risk)")
	}
	if d.IsMutable != nil && *d.IsMutable {
		out.RiskFactors = append(out.RiskFactors, "Mutable metadata")
	}
	if d.TopHolderPct > 50 {
		out.RiskFactors = append(out.RiskFactors, fmt.Sprintf("Top 10 holders own %.1f%% of supply", d.TopHolderPct))
	}
	out.DataSources = append(out.DataSources, "birdeye_security")
}

// ═══════════════════════════════════════════════════════════════
//  CoinGecko API (free, no key)
// ═══════════════════════════════════════════════════════════════

func searchCoinGecko(ctx context.Context, client *http.Client, query string) string {
	url := fmt.Sprintf("https://api.coingecko.com/api/v3/search?query=%s", query)
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)

	resp, err := retryDo(client, req, 3)
	if err != nil {
		log.Printf("[CryptoScanner] CoinGecko search error: %v", err)
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return ""
	}

	var result struct {
		Coins []struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Symbol string `json:"symbol"`
		} `json:"coins"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil || len(result.Coins) == 0 {
		return ""
	}

	return result.Coins[0].ID
}

func fetchCoinGeckoDetails(ctx context.Context, client *http.Client, coinID string, out *CryptoScannerOutput) {
	url := fmt.Sprintf("https://api.coingecko.com/api/v3/coins/%s?localization=false&tickers=false&community_data=true&developer_data=false", coinID)
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)

	resp, err := retryDo(client, req, 3)
	if err != nil {
		log.Printf("[CryptoScanner] CoinGecko details error: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return
	}

	var result struct {
		Name        string `json:"name"`
		Symbol      string `json:"symbol"`
		Description struct {
			En string `json:"en"`
		} `json:"description"`
		MarketData struct {
			CurrentPrice       map[string]float64 `json:"current_price"`
			MarketCap          map[string]float64 `json:"market_cap"`
			TotalVolume        map[string]float64 `json:"total_volume"`
			PriceChangePct24h  float64            `json:"price_change_percentage_24h"`
		} `json:"market_data"`
		SentimentUp   float64 `json:"sentiment_votes_up_percentage"`
		SentimentDown float64 `json:"sentiment_votes_down_percentage"`
		Platforms     map[string]string `json:"platforms"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("[CryptoScanner] CoinGecko details parse error: %v", err)
		return
	}

	out.TokenName = result.Name
	out.Symbol = strings.ToUpper(result.Symbol)
	out.PriceUSD = result.MarketData.CurrentPrice["usd"]
	out.MarketCapUSD = result.MarketData.MarketCap["usd"]
	out.Volume24h = result.MarketData.TotalVolume["usd"]
	out.PriceChange24h = result.MarketData.PriceChangePct24h

	// Trim description to first 500 chars
	desc := result.Description.En
	if len(desc) > 500 {
		desc = desc[:500] + "..."
	}
	out.Description = desc

	// CoinGecko sentiment
	if result.SentimentUp > 70 {
		out.Sentiment = "bullish"
	} else if result.SentimentDown > 70 {
		out.Sentiment = "bearish"
	}

	out.DataSources = append(out.DataSources, "coingecko")
}

// ═══════════════════════════════════════════════════════════════
//  DexScreener API (free, no key)
// ═══════════════════════════════════════════════════════════════

func fetchDexScreener(ctx context.Context, client *http.Client, address string, out *CryptoScannerOutput) {
	url := fmt.Sprintf("https://api.dexscreener.com/latest/dex/tokens/%s", address)
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)

	resp, err := retryDo(client, req, 3)
	if err != nil {
		log.Printf("[CryptoScanner] DexScreener error: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return
	}

	var result struct {
		Pairs []struct {
			BaseToken struct {
				Name    string `json:"name"`
				Symbol  string `json:"symbol"`
				Address string `json:"address"`
			} `json:"baseToken"`
			PriceUsd    string  `json:"priceUsd"`
			Volume      struct {
				H24 float64 `json:"h24"`
			} `json:"volume"`
			PriceChange struct {
				H24 float64 `json:"h24"`
			} `json:"priceChange"`
			Liquidity struct {
				Usd float64 `json:"usd"`
			} `json:"liquidity"`
			FDV float64 `json:"fdv"`
		} `json:"pairs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil || len(result.Pairs) == 0 {
		return
	}

	p := result.Pairs[0]

	// Only fill if not already set by a higher-priority source
	if out.TokenName == "" || out.TokenName == "" {
		out.TokenName = p.BaseToken.Name
	}
	if out.Symbol == "" {
		out.Symbol = p.BaseToken.Symbol
	}
	if out.PriceUSD == 0 {
		fmt.Sscanf(p.PriceUsd, "%f", &out.PriceUSD)
	}
	if out.Volume24h == 0 {
		out.Volume24h = p.Volume.H24
	}
	if out.PriceChange24h == 0 {
		out.PriceChange24h = p.PriceChange.H24
	}
	if out.MarketCapUSD == 0 {
		out.MarketCapUSD = p.FDV
	}

	// Liquidity check
	if p.Liquidity.Usd < 10000 {
		out.RiskFactors = append(out.RiskFactors, fmt.Sprintf("Very low liquidity ($%.0f)", p.Liquidity.Usd))
	} else if p.Liquidity.Usd < 50000 {
		out.RiskFactors = append(out.RiskFactors, fmt.Sprintf("Low liquidity ($%.0f)", p.Liquidity.Usd))
	}

	out.DataSources = append(out.DataSources, "dexscreener")
}

// ═══════════════════════════════════════════════════════════════
//  DeepSeek Analysis (summary + risk score)
// ═══════════════════════════════════════════════════════════════

func generateAnalysis(ctx context.Context, client *http.Client, deepseekKey string, out *CryptoScannerOutput) {
	// Build raw data context for LLM
	rawData, _ := json.Marshal(map[string]any{
		"token":          out.TokenName,
		"symbol":         out.Symbol,
		"price":          out.PriceUSD,
		"market_cap":     out.MarketCapUSD,
		"volume_24h":     out.Volume24h,
		"price_change":   out.PriceChange24h,
		"holders":        out.Holders,
		"risk_factors":   out.RiskFactors,
		"description":    out.Description,
		"data_sources":   out.DataSources,
	})

	// If no DeepSeek key, generate basic summary from numbers
	if deepseekKey == "" {
		out.Summary = generateBasicSummary(out)
		out.RiskScore = estimateBasicRisk(out)
		if out.Sentiment == "" {
			out.Sentiment = estimateBasicSentiment(out)
		}
		return
	}

	prompt := fmt.Sprintf(`You are a quantitative analyst with CFA designation specializing in crypto market microstructure.

Analyze this token data and return ONLY valid JSON:
{
  "summary": "<institutional-grade 3-5 sentence analysis>",
  "risk_score": <0-100>,
  "risk_factors": ["<specific risks with data backing>"],
  "sentiment": "<bullish|bearish|neutral>"
}

Standards:
- Evaluate price in context of broader market (BTC/ETH correlation)
- Analyze volume patterns: accumulation, distribution, or manipulation
- Risk score: 0-30=low risk (established), 30-60=medium, 60-100=high/speculative
- Be precise with numbers. Use actual values not vague descriptions.
- Never recommend buy/sell. Provide analysis framework only.

Token data:
%s`, string(rawData))

	payload := map[string]any{
		"model": "deepseek-chat",
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"temperature": 0.2,
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequestWithContext(ctx, "POST", "https://api.deepseek.com/chat/completions", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+deepseekKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := retryDo(client, req, 3)
	if err != nil {
		log.Printf("[CryptoScanner] DeepSeek error: %v, using basic summary", err)
		out.Summary = generateBasicSummary(out)
		out.RiskScore = estimateBasicRisk(out)
		if out.Sentiment == "" {
			out.Sentiment = estimateBasicSentiment(out)
		}
		return
	}
	defer resp.Body.Close()

	var chatResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil || len(chatResp.Choices) == 0 {
		log.Printf("[CryptoScanner] DeepSeek parse failed, using basic summary")
		out.Summary = generateBasicSummary(out)
		out.RiskScore = estimateBasicRisk(out)
		if out.Sentiment == "" {
			out.Sentiment = estimateBasicSentiment(out)
		}
		return
	}

	content := extractJSON(chatResp.Choices[0].Message.Content)

	var analysis struct {
		RiskScore       int      `json:"risk_score"`
		Sentiment       string   `json:"sentiment"`
		Summary         string   `json:"summary"`
		AdditionalRisks []string `json:"additional_risks"`
	}
	if err := json.Unmarshal([]byte(content), &analysis); err != nil {
		log.Printf("[CryptoScanner] DeepSeek JSON invalid: %v, using basic summary", err)
		out.Summary = generateBasicSummary(out)
		out.RiskScore = estimateBasicRisk(out)
		if out.Sentiment == "" {
			out.Sentiment = estimateBasicSentiment(out)
		}
		return
	}

	out.RiskScore = analysis.RiskScore
	out.Summary = analysis.Summary
	if analysis.Sentiment != "" {
		out.Sentiment = analysis.Sentiment
	}
	out.RiskFactors = append(out.RiskFactors, analysis.AdditionalRisks...)
}

// ─── Basic fallbacks when DeepSeek unavailable ───────────────

func generateBasicSummary(out *CryptoScannerOutput) string {
	name := out.TokenName
	if name == "" {
		name = out.Symbol
	}
	if name == "" {
		name = "Unknown token"
	}

	parts := []string{fmt.Sprintf("%s (%s)", name, out.Symbol)}

	if out.PriceUSD > 0 {
		parts = append(parts, fmt.Sprintf("is trading at $%.6f", out.PriceUSD))
	}
	if out.MarketCapUSD > 0 {
		parts = append(parts, fmt.Sprintf("with a market cap of $%.0f", out.MarketCapUSD))
	}
	if out.PriceChange24h != 0 {
		direction := "up"
		if out.PriceChange24h < 0 {
			direction = "down"
		}
		parts = append(parts, fmt.Sprintf("%s %.1f%% in 24h", direction, out.PriceChange24h))
	}

	summary := strings.Join(parts, ", ") + "."
	if len(out.RiskFactors) > 0 {
		summary += fmt.Sprintf(" %d risk factor(s) detected.", len(out.RiskFactors))
	}
	return summary
}

func estimateBasicRisk(out *CryptoScannerOutput) int {
	score := 30 // base
	score += len(out.RiskFactors) * 15
	if out.Volume24h < 1000 {
		score += 20
	}
	if out.MarketCapUSD < 100000 {
		score += 15
	}
	if score > 100 {
		score = 100
	}
	return score
}

func estimateBasicSentiment(out *CryptoScannerOutput) string {
	if out.PriceChange24h > 5 {
		return "bullish"
	}
	if out.PriceChange24h < -5 {
		return "bearish"
	}
	return "neutral"
}
