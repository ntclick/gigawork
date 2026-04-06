package db

import "time"

const (
	// Status values must match the live DB check constraint.
	// Live DB uses Escrow-style statuses from original schema.
	StatusPendingFund      = "OPEN"          // maps to OPEN (pre-funding)
	StatusActive           = "IN_PROGRESS"   // maps to IN_PROGRESS (funded + working)
	StatusSubmitted        = "PENDING_REVIEW" // maps to PENDING_REVIEW
	StatusRevisionRequired = "PENDING_REVIEW"
	StatusCompleted        = "SETTLED"       // maps to SETTLED (done + paid)
	StatusTrialCompleted   = "SETTLED"
	StatusRejected         = "EXPIRED"       // maps to EXPIRED (rejected/cancelled)
	StatusExpired          = "EXPIRED"
	StatusFailed           = "DISPUTED"      // maps to DISPUTED (closest to failed)
	StatusOpen             = "OPEN"
	StatusMatching         = "MATCHING"

	RoleClient        = "client"
	RoleAgentOperator = "agent_operator"
)

type User struct {
	Address     string    `json:"address"`
	Roles       []string  `json:"roles"`
	Nonce       string    `json:"nonce,omitempty"`
	USDCBalance float64   `json:"usdc_balance"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type USDCDeposit struct {
	ID          string    `json:"id,omitempty"`
	Wallet      string    `json:"wallet"`
	Amount      float64   `json:"amount"`
	TxHash      string    `json:"tx_hash"`
	ConfirmedAt time.Time `json:"confirmed_at,omitempty"`
}

type Agent struct {
	Address         string    `json:"address"`
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Description     string    `json:"description"`
	Category        string    `json:"category"`
	Capabilities    []string  `json:"capabilities"`
	InputSchema     any       `json:"input_schema,omitempty"`
	OutputSchema    any       `json:"output_schema,omitempty"`
	
	Pricing struct {
		PerCallUSDC    float64 `json:"per_call_usdc"`
		ReusePriceUSDC float64 `json:"reuse_price_usdc"`
		TrialAvailable bool    `json:"trial_available"`
		FailurePolicy  string  `json:"failure_policy"`
	} `json:"pricing"`

	ERC8004TokenID  int64     `json:"erc8004_token_id"`
	HourlyRateUSDC  float64   `json:"hourly_rate_usdc"`
	BillingUnit     *string   `json:"billing_unit,omitempty"`
	SkillTags       []string  `json:"skill_tags"`
	ReputationScore int       `json:"reputation_score"`
	Status          string    `json:"status"`
	SuccessRate     float64   `json:"success_rate"`
	TrustScore      float64   `json:"trust_score"`
	TTLSeconds      int       `json:"ttl_seconds"`
	IsSystem        bool      `json:"is_system"`
	VisibleOnMarketplace bool `json:"visible_on_marketplace"`
	
	TotalJobsDone   int       `json:"total_jobs_done"`
	TotalEarnedUSDC float64   `json:"total_earned_usdc"`
	IsActive        bool      `json:"is_active"`
	Metadata        any       `json:"metadata,omitempty"`
	MetadataURI     *string   `json:"metadata_uri,omitempty"`
	MetadataHash    *string   `json:"metadata_hash,omitempty"`
	WebhookURI      *string   `json:"webhook_uri,omitempty"`
	Version         string    `json:"version"`
	OperatorWallet  string    `json:"operator_wallet"`

	// Metrics fields needed for build compatibility
	StakeAmount         *float64  `json:"stake_amount,omitempty"`
	StakeTier           *string   `json:"stake_tier,omitempty"`
	TotalBids           *int      `json:"total_bids,omitempty"`
	WinRate             *float64  `json:"win_rate,omitempty"`
	AvgResponseTimeS    *int      `json:"avg_response_time_s,omitempty"`
	AvgCompletionTimeS  *int      `json:"avg_completion_time_s,omitempty"`
	DisputeCount        *int      `json:"dispute_count,omitempty"`
	LastActiveAt        *time.Time `json:"last_active_at,omitempty"`
	
	RegisteredAt    time.Time `json:"registered_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type AgentRating struct {
	ID        string    `json:"id"`
	JobID     int64     `json:"job_id"`
	AgentID   string    `json:"agent_id"` // Spec ID or Address
	Wallet    string    `json:"wallet"`
	Stars     int       `json:"stars"`
	Comment   string    `json:"comment"`
	CreatedAt time.Time `json:"created_at"`
}

type AgentMetrics struct {
	AgentID            string    `json:"agent_id"`
	SuccessRate        float64   `json:"success_rate"`
	OnTimeRate         float64   `json:"on_time_rate"`
	SchemaValidityRate float64   `json:"schema_validity_rate"`
	AvgResponseTimeSec float64   `json:"avg_response_time_sec"`
	RejectionRate      float64   `json:"rejection_rate"`
	TotalJobs          int       `json:"total_jobs"`
	TrustScore         float64   `json:"trust_score"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// StoreEntry represents an entry in the Shared Data Store (Caching)
type StoreEntry struct {
	ID                   string    `json:"id,omitempty"`
	InputHash            string    `json:"input_hash"`
	AgentID              string    `json:"agent_id"`
	Output               any       `json:"output"`
	OutputSchemaVersion  string    `json:"output_schema_version"`
	ContentHash          string    `json:"content_hash"`
	ProducedAt           time.Time `json:"produced_at"`
	ExpiresAt            time.Time `json:"expires_at"`
	ReuseCount           int       `json:"reuse_count"`
	OriginalRunPriceUSDC float64   `json:"original_run_price_usdc"`
	ReusePriceUSDC       float64   `json:"reuse_price_usdc"`
}

// Job matches the live Supabase jobs table columns exactly.
// Columns: job_id, employer, worker_agent, job_type, spec, hourly_rate_usdc,
// estimated_hours, deposit_amount, actual_charge, worker_payout, platform_fee,
// status, result_hash, proof_uri, employer_rating, start_ts, end_ts,
// result_submitted_at, created_at, updated_at, result_data, billing_unit, metadata_hash
type Job struct {
	JobID             int64      `json:"job_id"`
	Employer          string     `json:"employer"`
	WorkerAgent       *string    `json:"worker_agent,omitempty"`
	JobType           string     `json:"job_type"`
	Spec              *string    `json:"spec,omitempty"`
	HourlyRateUSDC    *float64   `json:"hourly_rate_usdc,omitempty"`
	EstimatedHours    *float64   `json:"estimated_hours,omitempty"`
	DepositAmount     *float64   `json:"deposit_amount,omitempty"`
	ActualCharge      *float64   `json:"actual_charge,omitempty"`
	WorkerPayout      *float64   `json:"worker_payout,omitempty"`
	PlatformFee       *float64   `json:"platform_fee,omitempty"`
	Status            string     `json:"status"`
	ResultHash        *string    `json:"result_hash,omitempty"`
	ProofURI          *string    `json:"proof_uri,omitempty"`
	EmployerRating    *int       `json:"employer_rating,omitempty"`
	StartTS           *time.Time `json:"start_ts,omitempty"`
	EndTS             *time.Time `json:"end_ts,omitempty"`
	ResultSubmittedAt *time.Time `json:"result_submitted_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	ResultData        any        `json:"result_data,omitempty"`
	BillingUnit       *string    `json:"billing_unit,omitempty"`
	MetadataHash      *string    `json:"metadata_hash,omitempty"`
	TxHashPosted      *string    `json:"tx_hash_posted,omitempty"`
	TxHashAccepted    *string    `json:"tx_hash_accepted,omitempty"`
	TxHashSettled     *string    `json:"tx_hash_settled,omitempty"`
}

type Bid struct {
	ID           string    `json:"id"`
	JobID        int64     `json:"job_id"`
	AgentAddress string    `json:"agent_address"`
	ProposedRate float64   `json:"proposed_rate"`
	Note         *string   `json:"note,omitempty"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
}

type Dispute struct {
	ID         string     `json:"id"`
	JobID      int64      `json:"job_id"`
	RaisedBy   string     `json:"raised_by"`
	Reason     string     `json:"reason"`
	Resolution *string    `json:"resolution,omitempty"`
	WorkerWon  *bool      `json:"worker_won,omitempty"`
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

type JobEvent struct {
	ID        string    `json:"id,omitempty"`
	JobID     int64     `json:"job_id"`
	EventType string    `json:"event_type"`
	Actor     *string   `json:"actor,omitempty"`
	TxHash    *string   `json:"tx_hash,omitempty"`
	Data      any       `json:"data,omitempty"`
	CreatedAt time.Time `json:"created_at,omitempty"`
}

type AgentActivityLog struct {
	ID         string    `json:"id,omitempty"`
	Agent      string    `json:"agent"`
	Action     string    `json:"action"`
	JobID      *int64    `json:"job_id,omitempty"`
	AmountUSDC *float64  `json:"amount_usdc,omitempty"`
	TxHash     *string   `json:"tx_hash,omitempty"`
	Metadata   any       `json:"metadata,omitempty"`
	CreatedAt  time.Time `json:"created_at,omitempty"`
}

type PlatformMetric struct {
	Date            string    `json:"date"` // format YYYY-MM-DD
	TotalAgents     int       `json:"total_agents"`
	ActiveAgents    int       `json:"active_agents"`
	NewAgents       int       `json:"new_agents"`
	TotalJobs       int       `json:"total_jobs"`
	NewJobs         int       `json:"new_jobs"`
	JobsSettled     int       `json:"jobs_settled"`
	JobsDisputed    int       `json:"jobs_disputed"`
	TotalVolumeUSDC float64   `json:"total_volume_usdc"`
	TotalPayoutUSDC float64   `json:"total_payout_usdc"`
	PlatformFeeUSDC float64   `json:"platform_fee_usdc"`
	AvgJobTimeHrs   *float64  `json:"avg_job_time_hrs,omitempty"`
	AvgBidCount     *float64  `json:"avg_bid_count,omitempty"`
	CreatedAt       time.Time `json:"created_at,omitempty"`
}

type AgentMetricDaily struct {
	ID              string    `json:"id,omitempty"`
	Agent           string    `json:"agent"`
	Date            string    `json:"date"` // format YYYY-MM-DD
	BidsPlaced      int       `json:"bids_placed"`
	BidsAccepted    int       `json:"bids_accepted"`
	BidsRejected    int       `json:"bids_rejected"`
	JobsCompleted   int       `json:"jobs_completed"`
	EarnedUSDC      float64   `json:"earned_usdc"`
	AvgResponseS    *int      `json:"avg_response_s,omitempty"`
	AvgCompleteS    *int      `json:"avg_complete_s,omitempty"`
	ReputationDelta int       `json:"reputation_delta"`
}

type TrialRun struct {
	ID        string    `json:"id,omitempty"`
	Wallet    string    `json:"wallet"`
	AgentID   string    `json:"agent_id"`
	UsedAt    time.Time `json:"used_at"`
}
