package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// LXMFNode represents a Sideband/Reticulum node that publishes LXMF telemetry.
type LXMFNode struct {
	DestHash        string   `json:"dest_hash"`
	DisplayName     string   `json:"display_name,omitempty"`
	Lat             *float64 `json:"lat,omitempty"`
	Lon             *float64 `json:"lon,omitempty"`
	Altitude        *float64 `json:"altitude,omitempty"`
	Speed           *float64 `json:"speed,omitempty"`
	Heading         *float64 `json:"heading,omitempty"`
	Accuracy        *float64 `json:"accuracy,omitempty"`
	BatteryPct      *float64 `json:"battery_pct,omitempty"`
	LastSeen        int64    `json:"last_seen"`
	LocationUpdated *int64   `json:"location_updated,omitempty"`
	Source          string   `json:"source"`
}

// scanLXMFNode reads one row from a query that selects all LXMFNode columns in
// the canonical order used by GetLXMFNodes and LXMFPoller.
func scanLXMFNode(rows *sql.Rows) (LXMFNode, error) {
	var n LXMFNode
	var displayName sql.NullString
	var lat, lon, altitude, speed, heading, accuracy, batteryPct sql.NullFloat64
	var locationUpdated sql.NullInt64
	err := rows.Scan(
		&n.DestHash,
		&displayName,
		&lat, &lon, &altitude, &speed, &heading, &accuracy, &batteryPct,
		&n.LastSeen,
		&locationUpdated,
		&n.Source,
	)
	if err != nil {
		return n, err
	}
	if displayName.Valid {
		n.DisplayName = displayName.String
	}
	if lat.Valid {
		v := lat.Float64
		n.Lat = &v
	}
	if lon.Valid {
		v := lon.Float64
		n.Lon = &v
	}
	if altitude.Valid {
		v := altitude.Float64
		n.Altitude = &v
	}
	if speed.Valid {
		v := speed.Float64
		n.Speed = &v
	}
	if heading.Valid {
		v := heading.Float64
		n.Heading = &v
	}
	if accuracy.Valid {
		v := accuracy.Float64
		n.Accuracy = &v
	}
	if batteryPct.Valid {
		v := batteryPct.Float64
		n.BatteryPct = &v
	}
	if locationUpdated.Valid {
		v := locationUpdated.Int64
		n.LocationUpdated = &v
	}
	return n, nil
}

// GetLXMFNodes returns all LXMF nodes that have a location and were seen within
// staleHours.  Returns an empty slice (not an error) if the table doesn't exist.
func (db *DB) GetLXMFNodes(staleHours int) ([]LXMFNode, error) {
	cutoff := time.Now().Add(-time.Duration(staleHours) * time.Hour).Unix()
	rows, err := db.conn.Query(`
		SELECT dest_hash,
		       COALESCE(display_name, ''),
		       lat, lon, altitude, speed, heading, accuracy, battery_pct,
		       last_seen, location_updated,
		       COALESCE(source, 'sideband')
		FROM lxmf_nodes
		WHERE last_seen >= ?
		  AND lat  IS NOT NULL
		  AND lon  IS NOT NULL
		ORDER BY last_seen DESC
	`, cutoff)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			return []LXMFNode{}, nil
		}
		return nil, err
	}
	defer rows.Close()

	var nodes []LXMFNode
	for rows.Next() {
		n, err := scanLXMFNode(rows)
		if err != nil {
			continue
		}
		nodes = append(nodes, n)
	}
	if nodes == nil {
		nodes = []LXMFNode{}
	}
	return nodes, rows.Err()
}

// handleLXMFNodes serves GET /api/lxmf/nodes.
// Optional query param: stale_hours (default 24).
func (s *Server) handleLXMFNodes(w http.ResponseWriter, r *http.Request) {
	staleHours := 24
	if q := r.URL.Query().Get("stale_hours"); q != "" {
		if v, err := strconv.Atoi(q); err == nil && v > 0 {
			staleHours = v
		}
	}
	nodes, err := s.db.GetLXMFNodes(staleHours)
	if err != nil {
		log.Printf("[lxmf] GetLXMFNodes error: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(nodes)
}

// ─── LXMF WebSocket Poller ────────────────────────────────────────────────────

// LXMFPoller polls lxmf_nodes for recently-updated rows and broadcasts a
// "lxmf_node" WSMessage to all connected WebSocket clients.
type LXMFPoller struct {
	db       *DB
	hub      *Hub
	interval time.Duration
	stop     chan struct{}
}

func NewLXMFPoller(db *DB, hub *Hub, interval time.Duration) *LXMFPoller {
	return &LXMFPoller{db: db, hub: hub, interval: interval, stop: make(chan struct{})}
}

func (p *LXMFPoller) Start() {
	// Start cursor at now-5s to avoid broadcasting the full table on startup.
	lastCheck := time.Now().Unix() - 5

	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			p.poll(&lastCheck)
		case <-p.stop:
			return
		}
	}
}

func (p *LXMFPoller) poll(lastCheck *int64) {
	rows, err := p.db.conn.Query(`
		SELECT dest_hash,
		       COALESCE(display_name, ''),
		       lat, lon, altitude, speed, heading, accuracy, battery_pct,
		       last_seen, location_updated,
		       COALESCE(source, 'sideband')
		FROM lxmf_nodes
		WHERE last_seen > ?
		  AND lat  IS NOT NULL
		  AND lon  IS NOT NULL
		ORDER BY last_seen ASC
		LIMIT 100
	`, *lastCheck)
	if err != nil {
		if !strings.Contains(err.Error(), "no such table") {
			log.Printf("[lxmf-poller] query error: %v", err)
		}
		return
	}
	defer rows.Close()

	maxSeen := *lastCheck
	for rows.Next() {
		n, err := scanLXMFNode(rows)
		if err != nil {
			continue
		}
		if n.LastSeen > maxSeen {
			maxSeen = n.LastSeen
		}
		p.hub.Broadcast(WSMessage{Type: "lxmf_node", Data: n})
	}
	if maxSeen > *lastCheck {
		*lastCheck = maxSeen
	}
}

func (p *LXMFPoller) Stop() {
	close(p.stop)
}
