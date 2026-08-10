package main

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

// TestExtractNeighborReport covers parsing of the observer-reported neighbor
// table published on meshcore/<iata>/<observer>/neighbors.
//
// The critical distinction this locks in: a payload with NO neighbors array is
// unparseable (nil) and must NOT be recorded, whereas a well-formed report of
// ZERO neighbors is valid and meaningful ("reporting, currently hears nobody").
// Collapsing those two would make a silent observer indistinguishable from one
// that is actively reporting an empty table.
func TestExtractNeighborReport(t *testing.T) {
	parse := func(t *testing.T, raw string) map[string]interface{} {
		t.Helper()
		var m map[string]interface{}
		if err := json.Unmarshal([]byte(raw), &m); err != nil {
			t.Fatalf("bad test fixture: %v", err)
		}
		return m
	}

	t.Run("missing neighbors array is nil", func(t *testing.T) {
		if got := extractNeighborReport(parse(t, `{"origin":"x"}`)); got != nil {
			t.Fatalf("want nil for payload with no neighbors key, got %+v", got)
		}
	})

	t.Run("neighbors wrong type is nil", func(t *testing.T) {
		if got := extractNeighborReport(parse(t, `{"neighbors":"nope"}`)); got != nil {
			t.Fatalf("want nil for non-array neighbors, got %+v", got)
		}
	})

	t.Run("empty array is a valid zero report", func(t *testing.T) {
		got := extractNeighborReport(parse(t, `{"neighbors":[]}`))
		if got == nil {
			t.Fatal("empty neighbors array must parse as a valid zero-count report, not nil")
		}
		if got.Count != 0 {
			t.Fatalf("Count = %d, want 0", got.Count)
		}
		if got.Total != nil {
			t.Fatalf("Total = %v, want nil when firmware omits total_neighbors", *got.Total)
		}
		if got.Truncated {
			t.Fatal("Truncated should be false")
		}
	})

	t.Run("counts entries and honors total", func(t *testing.T) {
		got := extractNeighborReport(parse(t, `{
			"neighbors":[
				{"pubkey":"aa","snr":5.0,"heard_secs_ago":10,"scopes":"","status":"ok"},
				{"pubkey":"bb","snr":-2.5,"heard_secs_ago":null,"scopes":"","status":"ok"}
			],
			"total_neighbors":2
		}`))
		if got == nil {
			t.Fatal("unexpected nil")
		}
		if got.Count != 2 {
			t.Fatalf("Count = %d, want 2", got.Count)
		}
		if got.Total == nil || *got.Total != 2 {
			t.Fatalf("Total = %v, want 2", got.Total)
		}
		if got.Truncated {
			t.Fatal("Truncated should be false when total == count")
		}
	})

	t.Run("total exceeding count implies truncation", func(t *testing.T) {
		// Firmware may drop entries to fit MTU without setting the flag.
		got := extractNeighborReport(parse(t, `{
			"neighbors":[{"pubkey":"aa","snr":1,"status":"ok"}],
			"total_neighbors":37
		}`))
		if got == nil {
			t.Fatal("unexpected nil")
		}
		if got.Count != 1 {
			t.Fatalf("Count = %d, want 1", got.Count)
		}
		if got.Total == nil || *got.Total != 37 {
			t.Fatalf("Total = %v, want 37", got.Total)
		}
		if !got.Truncated {
			t.Fatal("Truncated must be inferred when total > count even absent the flag")
		}
	})

	t.Run("explicit truncated flag forms", func(t *testing.T) {
		for _, raw := range []string{
			`{"neighbors":[],"truncated":true}`,
			`{"neighbors":[],"truncated":"true"}`,
			`{"neighbors":[],"truncated":1}`,
		} {
			got := extractNeighborReport(parse(t, raw))
			if got == nil {
				t.Fatalf("unexpected nil for %s", raw)
			}
			if !got.Truncated {
				t.Fatalf("Truncated = false for %s, want true", raw)
			}
		}
	})

	t.Run("nonsense total below count is ignored", func(t *testing.T) {
		// Guard against a bogus total making Count look wrong; we keep the
		// entries we can actually see and drop the implausible total.
		got := extractNeighborReport(parse(t, `{
			"neighbors":[{"pubkey":"aa"},{"pubkey":"bb"},{"pubkey":"cc"}],
			"total_neighbors":1
		}`))
		if got == nil {
			t.Fatal("unexpected nil")
		}
		if got.Count != 3 {
			t.Fatalf("Count = %d, want 3", got.Count)
		}
		if got.Total != nil {
			t.Fatalf("Total = %v, want nil (implausible total discarded)", *got.Total)
		}
	})
}

// TestUpsertObserverNeighborReportPersists verifies the write path stores a
// report and, critically, that it does NOT bump last_seen or packet_count.
//
// Rationale: neighbors publish on a 24h default interval. If a neighbors
// report refreshed last_seen, an otherwise-silent observer would appear to
// come back to life once a day and would never age into the inactive state.
func TestUpsertObserverNeighborReportPersists(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "t.db"))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	defer store.Close()

	const id = "AABBCCDD"

	// Seed via the normal status path so last_seen/packet_count are set.
	if err := store.UpsertObserverAt(id, "obs-1", "ORD", nil, "2020-01-01T00:00:00Z"); err != nil {
		t.Fatalf("seed UpsertObserverAt: %v", err)
	}
	var seedLastSeen string
	var seedPkts int
	if err := store.db.QueryRow(`SELECT last_seen, packet_count FROM observers WHERE id = ?`, id).
		Scan(&seedLastSeen, &seedPkts); err != nil {
		t.Fatalf("read seed row: %v", err)
	}

	total := 9
	report := &NeighborReport{Count: 4, Total: &total, Truncated: true}
	if err := store.UpsertObserverNeighborReport(id, "ord", report); err != nil {
		t.Fatalf("UpsertObserverNeighborReport: %v", err)
	}

	var gotAt string
	var gotCount, gotTotal, gotTrunc int
	var gotLastSeen string
	var gotPkts int
	if err := store.db.QueryRow(`SELECT neighbors_last_report_at, neighbors_count,
		neighbors_total, neighbors_truncated, last_seen, packet_count
		FROM observers WHERE id = ?`, id).
		Scan(&gotAt, &gotCount, &gotTotal, &gotTrunc, &gotLastSeen, &gotPkts); err != nil {
		t.Fatalf("read row: %v", err)
	}

	if gotAt == "" {
		t.Fatal("neighbors_last_report_at not written")
	}
	if gotCount != 4 {
		t.Fatalf("neighbors_count = %d, want 4", gotCount)
	}
	if gotTotal != 9 {
		t.Fatalf("neighbors_total = %d, want 9", gotTotal)
	}
	if gotTrunc != 1 {
		t.Fatalf("neighbors_truncated = %d, want 1", gotTrunc)
	}
	if gotLastSeen != seedLastSeen {
		t.Fatalf("last_seen mutated by a neighbors report: %q -> %q", seedLastSeen, gotLastSeen)
	}
	if gotPkts != seedPkts {
		t.Fatalf("packet_count mutated by a neighbors report: %d -> %d", seedPkts, gotPkts)
	}
}

// TestUpsertObserverNeighborReportInsertsUnknownObserver covers a neighbors
// report arriving before any /status or packet from that observer. The row
// must be created with packet_count 0 -- a neighbors report is not a packet
// observation and must not inflate traffic counters.
func TestUpsertObserverNeighborReportInsertsUnknownObserver(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "t.db"))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	defer store.Close()

	const id = "FEEDFACE"
	if err := store.UpsertObserverNeighborReport(id, "ORD", &NeighborReport{Count: 0}); err != nil {
		t.Fatalf("UpsertObserverNeighborReport: %v", err)
	}

	var pkts int
	var iata, at string
	var count interface{}
	if err := store.db.QueryRow(`SELECT packet_count, iata, neighbors_last_report_at, neighbors_count
		FROM observers WHERE id = ?`, id).Scan(&pkts, &iata, &at, &count); err != nil {
		t.Fatalf("read row: %v", err)
	}
	if pkts != 0 {
		t.Fatalf("packet_count = %d, want 0 for a neighbors-only observer", pkts)
	}
	if iata != "ORD" {
		t.Fatalf("iata = %q, want ORD (normalized)", iata)
	}
	if at == "" {
		t.Fatal("neighbors_last_report_at not written on insert")
	}
	// Zero-count must persist as 0, not NULL -- that is the whole
	// "reporting but hears nobody" signal.
	if count == nil {
		t.Fatal("neighbors_count is NULL, want 0 for a valid zero report")
	}
}

// TestNilReportIsNoop guards the dispatch contract: main.go returns early on a
// nil parse, but the store must also tolerate nil rather than writing a
// timestamp it cannot substantiate.
func TestNilReportIsNoop(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "t.db"))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	defer store.Close()

	if err := store.UpsertObserverNeighborReport("NOPE", "ORD", nil); err != nil {
		t.Fatalf("nil report should be a silent no-op, got %v", err)
	}
	var n int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM observers WHERE id = 'NOPE'`).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("nil report created %d row(s), want 0", n)
	}
}
