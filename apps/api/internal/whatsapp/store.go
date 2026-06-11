// Package whatsapp wraps the whatsmeow library — opens the session
// store, builds Connections, and emits typed events.
//
// Session storage is SQLite (pure-Go modernc driver, so we keep
// CGO_ENABLED=0 for static binary builds). Single file at
// data/whatsmeow.db relative to the api's working directory. Backup
// is `cp data/whatsmeow.db backup/` — nothing fancier.
package whatsapp

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite" // registers the pure-Go SQLite driver under name "sqlite"

	"go.mau.fi/whatsmeow/store/sqlstore"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// Store wraps whatsmeow's session container. One per process — every
// Connection draws its Device row from this shared store. Close it on
// shutdown so SQLite flushes WAL files cleanly.
type Store struct {
	Container *sqlstore.Container
}

// NewStore opens (or creates) the SQLite session DB at the given path.
// dbDir is created if missing. WAL mode + foreign keys on for
// durability + concurrent-read performance during whatsmeow's burst
// resync reads.
func NewStore(ctx context.Context, dbPath string) (*Store, error) {
	// Ensure the directory exists. dbPath is typically "data/whatsmeow.db"
	// so we create "data/" if it doesn't yet.
	if dir := filepath.Dir(dbPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("mkdir %s: %w", dir, err)
		}
	}

	// modernc.org/sqlite uses URI-style PRAGMA params:
	//   _pragma=foreign_keys(on)
	//   _pragma=journal_mode(WAL)
	dsn := fmt.Sprintf(
		"file:%s?_pragma=foreign_keys(on)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)",
		dbPath,
	)

	// whatsmeow's logger interface — bridge to slog via a tiny shim.
	// The default whatsmeow logger is noisy; we only let WARN+ through
	// at INFO and DEBUG+ at debug.
	dbLog := newWALogger("whatsmeow-db", slog.LevelWarn)

	// "sqlite" is the dialect name in whatsmeow (treated identically to
	// "sqlite3" internally) — matches modernc.org/sqlite's driver name.
	container, err := sqlstore.New(ctx, "sqlite", dsn, dbLog)
	if err != nil {
		return nil, fmt.Errorf("open whatsmeow store: %w", err)
	}

	return &Store{Container: container}, nil
}

// Close drains the underlying SQLite connection. After Close any
// existing whatsmeow.Client backed by this store will fail on the
// next query — call only at shutdown after all Connections are
// Disconnected.
func (s *Store) Close() error {
	if s.Container == nil {
		return nil
	}
	return s.Container.Close()
}

// ── slog ↔ whatsmeow log bridge ───────────────────────────────────

// waLogger satisfies whatsmeow/util/log.Logger by forwarding to slog.
type waLogger struct {
	prefix string
	level  slog.Level
}

func newWALogger(prefix string, minLevel slog.Level) waLog.Logger {
	return &waLogger{prefix: prefix, level: minLevel}
}

func (l *waLogger) Errorf(msg string, args ...any) {
	slog.Error(l.prefix+": "+fmt.Sprintf(msg, args...))
}

func (l *waLogger) Warnf(msg string, args ...any) {
	if l.level <= slog.LevelWarn {
		slog.Warn(l.prefix + ": " + fmt.Sprintf(msg, args...))
	}
}

func (l *waLogger) Infof(msg string, args ...any) {
	if l.level <= slog.LevelInfo {
		slog.Info(l.prefix + ": " + fmt.Sprintf(msg, args...))
	}
}

func (l *waLogger) Debugf(msg string, args ...any) {
	if l.level <= slog.LevelDebug {
		slog.Debug(l.prefix + ": " + fmt.Sprintf(msg, args...))
	}
}

func (l *waLogger) Sub(module string) waLog.Logger {
	return &waLogger{prefix: l.prefix + "/" + module, level: l.level}
}
