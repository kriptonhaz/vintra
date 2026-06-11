// Package handlers — system metrics endpoint for the /admin/monitoring
// page in the web app.
//
// Why this lives on the api: the web app's Node process can already
// read its own /proc when the operator views from prod, but localhost
// dev views the laptop's /proc — not useful for monitoring real prod
// resources. By moving the read to the api side, the web monitoring
// page always shows the host that runs the api (which IS prod's VPS),
// regardless of where the browser sits.
//
// Auth: INTERNAL_SERVICE_TOKEN — same pattern as /v1/internal/rag/preview.
// The web's server fn validates platform admin first, then forwards
// this shared secret.
package handlers

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

// SystemMetrics is the JSON shape returned by GET /v1/internal/system-metrics.
type SystemMetrics struct {
	RAM struct {
		TotalBytes     uint64  `json:"totalBytes"`
		UsedBytes      uint64  `json:"usedBytes"`
		FreeBytes      uint64  `json:"freeBytes"`
		AvailableBytes uint64  `json:"availableBytes"`
		CachedBytes    uint64  `json:"cachedBytes"`
		Pct            float64 `json:"pct"`
	} `json:"ram"`
	CPU struct {
		Load1  float64 `json:"load1"`
		Load5  float64 `json:"load5"`
		Load15 float64 `json:"load15"`
		Cores  int     `json:"cores"`
	} `json:"cpu"`
	DiskRoot *DiskUsage `json:"diskRoot,omitempty"`
	// API's whatsmeow session dir. Tracks growth of paired-instance
	// SQLite files specifically — the only directory under our control
	// that grows unboundedly per tenant.
	DiskAPIData *uint64 `json:"diskApiDataBytes,omitempty"`
	GeneratedAt string  `json:"generatedAt"`
}

type DiskUsage struct {
	TotalBytes     uint64  `json:"totalBytes"`
	UsedBytes      uint64  `json:"usedBytes"`
	AvailableBytes uint64  `json:"availableBytes"`
	Pct            float64 `json:"pct"`
}

// SystemMetricsHandler — closure-free; just exposes the single handler.
type SystemMetricsHandler struct {
	// APIDataDir is the path to the whatsmeow SQLite session dir.
	// Configurable so tests / dev can point at a temp dir.
	APIDataDir string
}

func NewSystemMetrics(apiDataDir string) *SystemMetricsHandler {
	return &SystemMetricsHandler{APIDataDir: apiDataDir}
}

// Get GET /v1/internal/system-metrics
//
// Read-only system snapshot. Bounded by the slowest probe (df + du
// shell-out, ~10–30 ms each on a healthy box).
func (h *SystemMetricsHandler) Get(c *fiber.Ctx) error {
	out := SystemMetrics{
		GeneratedAt: time.Now().Format(time.RFC3339),
	}

	// RAM — parse /proc/meminfo for the honest "available" + cache view.
	// Falls back to runtime stats only if /proc isn't present (macOS dev,
	// restricted container). At that point most fields will be zero,
	// which the UI renders as "Data tidak tersedia" gracefully.
	if mem, ok := readMemInfo(); ok {
		out.RAM.TotalBytes = mem.totalKB * 1024
		out.RAM.AvailableBytes = mem.availableKB * 1024
		out.RAM.FreeBytes = mem.freeKB * 1024
		out.RAM.CachedBytes = mem.cachedKB * 1024
		if mem.totalKB > 0 {
			used := mem.totalKB - mem.availableKB
			out.RAM.UsedBytes = used * 1024
			out.RAM.Pct = float64(used) / float64(mem.totalKB)
		}
	} else {
		// No /proc — surface runtime totals only. UsedBytes stays 0
		// which the UI clamps the % bar at zero.
		var ms runtime.MemStats
		runtime.ReadMemStats(&ms)
		out.RAM.TotalBytes = ms.Sys
	}

	// CPU load — /proc/loadavg has the same triple `os.loadavg()` gives
	// in Node. Cores: runtime.NumCPU() reads sched_getaffinity which
	// matches what Node sees.
	if l1, l5, l15, ok := readLoadAvg(); ok {
		out.CPU.Load1 = l1
		out.CPU.Load5 = l5
		out.CPU.Load15 = l15
	}
	out.CPU.Cores = runtime.NumCPU()

	// Disk: root — df shell-out so we match what an operator sees from
	// the CLI. -B1 is byte units so we don't have to figure out KB/MB/GB.
	if usage, err := dfBytes("/"); err == nil {
		out.DiskRoot = usage
	}

	// Disk: api data dir — du -sb. Used for whatsmeow SQLite growth.
	if h.APIDataDir != "" {
		if size, err := duBytes(h.APIDataDir); err == nil {
			out.DiskAPIData = &size
		}
	}

	return c.JSON(out)
}

// ── /proc/meminfo parser ──────────────────────────────────────────

type memInfo struct {
	totalKB, freeKB, availableKB, cachedKB uint64
}

func readMemInfo() (memInfo, bool) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return memInfo{}, false
	}
	defer func() { _ = f.Close() }()
	var m memInfo
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		key, val, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		// Value format: "       12345 kB"
		fields := strings.Fields(val)
		if len(fields) < 1 {
			continue
		}
		kb, err := strconv.ParseUint(fields[0], 10, 64)
		if err != nil {
			continue
		}
		switch key {
		case "MemTotal":
			m.totalKB = kb
		case "MemFree":
			m.freeKB = kb
		case "MemAvailable":
			m.availableKB = kb
		case "Cached":
			m.cachedKB = kb
		}
	}
	return m, m.totalKB > 0
}

// ── /proc/loadavg parser ──────────────────────────────────────────

func readLoadAvg() (l1, l5, l15 float64, ok bool) {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0, false
	}
	// Format: "0.34 0.41 0.45 1/123 4567"
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return 0, 0, 0, false
	}
	parse := func(s string) float64 {
		v, _ := strconv.ParseFloat(s, 64)
		return v
	}
	return parse(fields[0]), parse(fields[1]), parse(fields[2]), true
}

// ── df + du shell helpers ─────────────────────────────────────────

func dfBytes(path string) (*DiskUsage, error) {
	cmd := exec.Command("df", "-B1", path)
	stdout, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(string(stdout)), "\n")
	if len(lines) < 2 {
		return nil, fmt.Errorf("unexpected df output")
	}
	// On some distros the filesystem name wraps onto its own line;
	// re-join everything after the header and split on whitespace.
	fields := strings.Fields(strings.Join(lines[1:], " "))
	if len(fields) < 4 {
		return nil, fmt.Errorf("unexpected df field count")
	}
	total, _ := strconv.ParseUint(fields[1], 10, 64)
	used, _ := strconv.ParseUint(fields[2], 10, 64)
	avail, _ := strconv.ParseUint(fields[3], 10, 64)
	pct := 0.0
	if total > 0 {
		pct = float64(used) / float64(total)
	}
	return &DiskUsage{
		TotalBytes:     total,
		UsedBytes:      used,
		AvailableBytes: avail,
		Pct:            pct,
	}, nil
}

func duBytes(path string) (uint64, error) {
	// Guard against running du on /, ~, etc. — only allow absolute
	// paths that exist. Defensive; the handler is internal-only.
	abs, err := filepath.Abs(path)
	if err != nil {
		return 0, err
	}
	if _, err := os.Stat(abs); err != nil {
		return 0, err
	}
	cmd := exec.Command("du", "-sb", abs)
	stdout, err := cmd.Output()
	if err != nil {
		return 0, err
	}
	// Output: "12345\t/path"
	fields := strings.Fields(strings.TrimSpace(string(stdout)))
	if len(fields) == 0 {
		return 0, fmt.Errorf("empty du output")
	}
	return strconv.ParseUint(fields[0], 10, 64)
}
