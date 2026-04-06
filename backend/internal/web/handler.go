package web

import (
	"embed"
	"html/template"
	"net/http"
	"strconv"
	"strings"
	"time"

	"gigawork/internal/db"
)

// buildTime is set once at startup — used for cache-busting static file URLs.
var buildTime = strconv.FormatInt(time.Now().Unix(), 10)

//go:embed templates/*.html
var templateFS embed.FS

//go:embed static/*
var staticFS embed.FS

var templates *template.Template

func init() {
	// Root templates
	base, _ := template.ParseFS(templateFS, "templates/layout.html")
	templates = base
}

// Handler serves the web dashboard.
type Handler struct {
	DB            *db.Client
	PrivyAppID    string
	PrivyClientID string
}

func NewHandler(dbClient *db.Client, privyAppID, privyClientID string) *Handler {
	return &Handler{DB: dbClient, PrivyAppID: privyAppID, PrivyClientID: privyClientID}
}

type NavItem struct {
	Label  string
	URL    string
	Active bool
}

type PageData struct {
	Title         string
	Nav           []NavItem
	User          *db.User
	Data          any
	PrivyAppID    string
	PrivyClientID string
	BuildTime     string
}

func (h *Handler) render(w http.ResponseWriter, r *http.Request, name string, title string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	// Config-driven Nav
	nav := []NavItem{
		{Label: "Marketplace", URL: "/app/jobs", Active: strings.HasPrefix(r.URL.Path, "/app/jobs")},
		{Label: "Agents", URL: "/app/agents", Active: strings.HasPrefix(r.URL.Path, "/app/agents")},
		{Label: "Post a Task", URL: "/app/post-job", Active: r.URL.Path == "/app/post-job"},
		{Label: "My Jobs", URL: "/app/dashboard", Active: r.URL.Path == "/app/dashboard"},
	}

	// For the demo, handle dynamic wallet via query param
	walletAddr := r.URL.Query().Get("wallet")
	if walletAddr == "" {
		walletAddr = "0x742d1316e10EdB87612A098797D8C04F0eBAf734"
	}

	user, err := h.DB.GetUser(r.Context(), walletAddr)
	if err != nil || user == nil {
		user = &db.User{
			Address: walletAddr,
			Roles:   []string{db.RoleClient, db.RoleAgentOperator},
		}
	}

	pd := PageData{
		Title:         title,
		Nav:           nav,
		User:          user,
		Data:          data,
		PrivyAppID:    h.PrivyAppID,
		PrivyClientID: h.PrivyClientID,
		BuildTime:     buildTime,
	}

	// Robust Template Parsing
	// Create a new template and parse both the layout and the content page
	tmpl := template.New("base")
	_, err = tmpl.ParseFS(templateFS, "templates/layout.html", "templates/"+name)
	if err != nil {
		http.Error(w, "Parse Error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Execute the "layout" template defined in layout.html
	err = tmpl.ExecuteTemplate(w, "layout", pd)
	if err != nil {
		http.Error(w, "Execute Error: "+err.Error(), http.StatusInternalServerError)
	}
}

// LandingPage renders the introductory home page.
func (h *Handler) LandingPage(w http.ResponseWriter, r *http.Request) {
	tpl, err := template.ParseFS(templateFS, "templates/landing.html")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	tpl.Execute(w, nil)
}

// Dashboard renders the main dashboard page (My Jobs).
func (h *Handler) Dashboard(w http.ResponseWriter, r *http.Request) {
	walletAddr := r.URL.Query().Get("wallet")
	if walletAddr == "" {
		walletAddr = "0x742d1316e10EdB87612A098797D8C04F0eBAf734"
	}
	
	// Jobs where user is employer (No status filter for dashboard)
	jobs, _ := h.DB.ListJobs(r.Context(), "", walletAddr, "")
	
	// Calculate stats
	var totalEscrow float64
	var totalSpent float64
	var pendingReview int
	for _, j := range jobs {
		if j.Status == db.StatusActive || j.Status == db.StatusSubmitted {
			if j.HourlyRateUSDC != nil {
				totalEscrow += *j.HourlyRateUSDC
			}
		}
		if j.Status == db.StatusCompleted {
			if j.HourlyRateUSDC != nil {
				totalSpent += *j.HourlyRateUSDC
			}
		}
		if j.Status == db.StatusSubmitted {
			pendingReview++
		}
	}

	h.render(w, r, "dashboard.html", "My Jobs", map[string]any{
		"Jobs":          jobs,
		"TotalJobs":     len(jobs),
		"TotalEscrow":   totalEscrow,
		"TotalSpent":    totalSpent,
		"PendingReview": pendingReview,
	})
}

// JobBoard renders the job board page.
func (h *Handler) JobBoard(w http.ResponseWriter, r *http.Request) {
	// Fetch all jobs (JS frontend handles client-side filtering)
	jobs, _ := h.DB.ListJobs(r.Context(), "", "", "")
	
	h.render(w, r, "jobs.html", "Marketplace", map[string]any{
		"Jobs": jobs,
	})
}

// AgentsPage renders the agents directory page.
func (h *Handler) AgentsPage(w http.ResponseWriter, r *http.Request) {
	// Fetch all active agents
	allAgents, _ := h.DB.ListAgents(r.Context(), true, "")
	
	// Filter: only show marketplace-visible, non-system agents
	var agents []db.Agent
	for _, a := range allAgents {
		if a.IsSystem || !a.VisibleOnMarketplace {
			continue
		}
		agents = append(agents, a)
	}
	
	h.render(w, r, "agents.html", "Browse Agents", map[string]any{
		"Agents": agents,
	})
}

// PostJobPage renders the post job form.
func (h *Handler) PostJobPage(w http.ResponseWriter, r *http.Request) {
	agentAddr := r.URL.Query().Get("agent")
	var agent *db.Agent
	if agentAddr != "" {
		agent, _ = h.DB.GetAgent(r.Context(), agentAddr)
	}
	
	h.render(w, r, "post-job.html", "Post a Task", map[string]any{
		"Agent": agent,
		"Trial": r.URL.Query().Get("trial") == "true",
	})
}

// RegisterAgentPage renders the agent registration form.
func (h *Handler) RegisterAgentPage(w http.ResponseWriter, r *http.Request) {
	h.render(w, r, "register.html", "Launch Agent", nil)
}

// OnboardPage renders the get started / path selection page.
func (h *Handler) OnboardPage(w http.ResponseWriter, r *http.Request) {
	h.render(w, r, "onboard.html", "Get Started", nil)
}

// GuidePage renders the how-to guide.
func (h *Handler) GuidePage(w http.ResponseWriter, r *http.Request) {
	h.render(w, r, "guide.html", "Documentation", nil)
}

// StaticFiles returns a handler for static files.
func StaticFiles() http.Handler {
	return http.FileServer(http.FS(staticFS))
}
