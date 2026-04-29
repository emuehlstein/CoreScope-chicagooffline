package main

import (
	"log"
	"strconv"
	"strings"
	"time"
)

// handleLXMFTelemetry processes a single LXMF telemetry MQTT message.
//
// Topic format: lxmf/telemetry/{dest_hash}/{sensor}/{field}
// Payload is a raw scalar value (float, int, or string) — NOT JSON.
//
// Each field arrives as a separate message; this function performs a
// partial upsert so only the arriving field overwrites the stored value.
func handleLXMFTelemetry(store *Store, parts []string, payload []byte) {
	// parts[0]="lxmf"  parts[1]="telemetry"  parts[2]=dest_hash
	// parts[3]=sensor  parts[4]=field
	if len(parts) < 5 {
		return
	}
	destHash := parts[2]
	sensor := parts[3]
	field := parts[4]

	// Validate dest_hash: must be exactly 64 lowercase hex chars
	if len(destHash) != 64 {
		return
	}

	val := strings.TrimSpace(string(payload))

	f := &LXMFUpsertFields{
		DestHash: destHash,
		LastSeen: time.Now().Unix(),
	}

	switch sensor + "/" + field {
	case "location/latitude":
		if v, err := strconv.ParseFloat(val, 64); err == nil {
			f.Lat = &v
		}
	case "location/longitude":
		if v, err := strconv.ParseFloat(val, 64); err == nil {
			f.Lon = &v
		}
	case "location/altitude":
		if v, err := strconv.ParseFloat(val, 64); err == nil {
			f.Altitude = &v
		}
	case "location/speed":
		if v, err := strconv.ParseFloat(val, 64); err == nil {
			f.Speed = &v
		}
	case "location/heading":
		if v, err := strconv.ParseFloat(val, 64); err == nil {
			f.Heading = &v
		}
	case "location/accuracy":
		if v, err := strconv.ParseFloat(val, 64); err == nil {
			f.Accuracy = &v
		}
	case "location/updated":
		if v, err := strconv.ParseInt(val, 10, 64); err == nil {
			f.LocationUpdated = &v
		}
	case "information/text":
		f.DisplayName = &val
	case "battery/percent":
		if v, err := strconv.ParseFloat(val, 64); err == nil {
			f.BatteryPct = &v
		}
	default:
		// time/utc and received/by are acknowledged but not stored
		return
	}

	if err := store.UpsertLXMFNode(f); err != nil {
		short := destHash
		if len(short) > 12 {
			short = short[:12]
		}
		log.Printf("[lxmf] upsert error for %s...: %v", short, err)
	}
}
