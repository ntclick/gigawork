package matching

import (
	"context"
	"log"
	"sort"
	"strings"

	"gigawork/internal/db"
)

// Engine matches jobs to agents based on skill tags and reputation.
type Engine struct {
	db *db.Client
}

func NewEngine(dbClient *db.Client) *Engine {
	return &Engine{db: dbClient}
}

// MatchResult represents a scored agent match.
type MatchResult struct {
	Agent      db.Agent `json:"agent"`
	Score      float64  `json:"score"`       // 0–1 composite score
	TagOverlap int     `json:"tag_overlap"` // number of matching tags
}

// FindMatches returns agents ranked by relevance for a given job.
func (e *Engine) FindMatches(ctx context.Context, job *db.Job, maxResults int) ([]MatchResult, error) {
	// Extract required tags from job spec
	requiredTags := e.extractTags(job)

	// Get all active agents
	agents, err := e.db.ListAgents(ctx, true, "")
	if err != nil {
		return nil, err
	}

	var results []MatchResult

	for _, agent := range agents {
		overlap := tagOverlap(agent.SkillTags, requiredTags)

		// Skip agents with no tag overlap (unless no tags specified)
		if len(requiredTags) > 0 && overlap == 0 {
			continue
		}

		score := computeScore(agent, overlap, len(requiredTags))
		results = append(results, MatchResult{
			Agent:      agent,
			Score:      score,
			TagOverlap: overlap,
		})
	}

	// Sort by score descending
	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})

	if maxResults > 0 && len(results) > maxResults {
		results = results[:maxResults]
	}

	return results, nil
}

// extractTags pulls skill tags from job spec or job type.
func (e *Engine) extractTags(job *db.Job) []string {
	var tags []string

	// Infer from job type
	switch strings.ToUpper(job.JobType) {
	case "ONCHAIN":
		tags = appendUnique(tags, "onchain")
	case "OFFCHAIN_AI":
		tags = appendUnique(tags, "llm")
	case "SCRAPING":
		tags = appendUnique(tags, "scraping")
	case "WORKFLOW":
		tags = appendUnique(tags, "workflow")
	}

	return tags
}

func tagOverlap(agentTags, requiredTags []string) int {
	tagSet := make(map[string]bool)
	for _, t := range agentTags {
		tagSet[strings.ToLower(t)] = true
	}

	count := 0
	for _, t := range requiredTags {
		if tagSet[strings.ToLower(t)] {
			count++
		}
	}
	return count
}

func computeScore(agent db.Agent, overlap, totalRequired int) float64 {
	// Tag match score (0–0.5)
	var tagScore float64
	if totalRequired > 0 {
		tagScore = 0.5 * float64(overlap) / float64(totalRequired)
	} else {
		tagScore = 0.25 // neutral if no tags specified
	}

	// Reputation score (0–0.3)
	reputationScore := 0.3 * float64(agent.ReputationScore) / 1000.0

	// Experience score (0–0.2)
	experienceScore := 0.2 * min(float64(agent.TotalJobsDone)/50.0, 1.0)

	return tagScore + reputationScore + experienceScore
}

func appendUnique(slice []string, val string) []string {
	for _, s := range slice {
		if strings.EqualFold(s, val) {
			return slice
		}
	}
	return append(slice, val)
}

// NotifyMatches logs matching agents for a job (hook point for notifications).
func (e *Engine) NotifyMatches(ctx context.Context, job *db.Job) {
	matches, err := e.FindMatches(ctx, job, 10)
	if err != nil {
		log.Printf("[matching] error finding matches for job %d: %v", job.JobID, err)
		return
	}

	if len(matches) == 0 {
		log.Printf("[matching] no matching agents for job %d", job.JobID)
		return
	}

	log.Printf("[matching] found %d matches for job %d:", len(matches), job.JobID)
	for i, m := range matches {
		log.Printf("  #%d: %s (score: %.2f, tags: %d)", i+1, m.Agent.Address, m.Score, m.TagOverlap)
	}
}
