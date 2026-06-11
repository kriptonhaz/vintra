package whatsapp

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestNewStore_CreatesDirAndFile(t *testing.T) {
	tmp := t.TempDir()
	dbPath := filepath.Join(tmp, "nested", "subdir", "whatsmeow.db")

	ctx := context.Background()
	store, err := NewStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if _, err := os.Stat(dbPath); err != nil {
		t.Errorf("expected db file at %s, stat: %v", dbPath, err)
	}
}

func TestNewStore_Idempotent(t *testing.T) {
	// Opening the same file twice should succeed both times (second
	// open just re-attaches to an existing schema).
	tmp := t.TempDir()
	dbPath := filepath.Join(tmp, "whatsmeow.db")
	ctx := context.Background()

	s1, err := NewStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("first NewStore: %v", err)
	}
	if err := s1.Close(); err != nil {
		t.Fatalf("close 1: %v", err)
	}

	s2, err := NewStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("second NewStore: %v", err)
	}
	t.Cleanup(func() { _ = s2.Close() })
}

func TestStore_Close_NilSafe(t *testing.T) {
	s := &Store{Container: nil}
	if err := s.Close(); err != nil {
		t.Errorf("Close on nil container should be a no-op, got: %v", err)
	}
}
