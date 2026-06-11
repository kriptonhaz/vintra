package config

import (
	"os"
	"strings"
	"testing"
)

// allRequired returns a map of every required env var set to a
// placeholder value — enough to make Parse() succeed.
func allRequired() map[string]string {
	return map[string]string{
		"DATABASE_URL":        "postgresql://x:y@h:6543/postgres",
		"SUPABASE_URL":        "https://x.supabase.co",
		"SUPABASE_SECRET_KEY": "sb_secret_xxx",
		"REDIS_URL":           "redis://127.0.0.1:6379",
	}
}

// withEnv sets the given vars for the test, unsets everything ELSE we
// care about so the host's real env doesn't leak in, and restores
// prior state on cleanup.
func withEnv(t *testing.T, vars map[string]string) {
	t.Helper()

	allKeys := []string{
		"NODE_ENV", "PORT", "LOG_LEVEL", "APP_URL",
		"DATABASE_URL", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "REDIS_URL",
		"OPENAI_API_KEY", "GEMINI_API_KEY",
	}

	prior := map[string]struct {
		val string
		had bool
	}{}
	for _, k := range allKeys {
		v, had := os.LookupEnv(k)
		prior[k] = struct {
			val string
			had bool
		}{v, had}
	}

	// Wipe every key so unset() actually unsets them, not "" them.
	for _, k := range allKeys {
		_ = os.Unsetenv(k)
	}
	// Then set the ones the test wants.
	for k, v := range vars {
		if err := os.Setenv(k, v); err != nil {
			t.Fatalf("setenv %s: %v", k, err)
		}
	}

	t.Cleanup(func() {
		for k, p := range prior {
			if p.had {
				_ = os.Setenv(k, p.val)
			} else {
				_ = os.Unsetenv(k)
			}
		}
	})
}

func TestParse_AllDefaultsWhenRequiredSet(t *testing.T) {
	withEnv(t, allRequired())

	cfg, err := Parse()
	if err != nil {
		t.Fatalf("Parse: unexpected error: %v", err)
	}

	if cfg.NodeEnv != "development" {
		t.Errorf("NodeEnv default = %q, want development", cfg.NodeEnv)
	}
	if cfg.Port != 4000 {
		t.Errorf("Port default = %d, want 4000", cfg.Port)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel default = %q, want info", cfg.LogLevel)
	}
	if cfg.AppURL != "http://localhost:3000" {
		t.Errorf("AppURL default = %q, want http://localhost:3000", cfg.AppURL)
	}
	if cfg.IsProduction() {
		t.Errorf("IsProduction true on default NodeEnv")
	}
}

func TestParse_MissingRequiredFails(t *testing.T) {
	required := []string{"DATABASE_URL", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "REDIS_URL"}

	for _, missing := range required {
		t.Run("missing_"+missing, func(t *testing.T) {
			env := allRequired()
			delete(env, missing) // remove this one — must be UNSET, not ""
			withEnv(t, env)

			_, err := Parse()
			if err == nil {
				t.Fatalf("Parse: expected error when %s is missing", missing)
			}
			if !strings.Contains(err.Error(), missing) {
				t.Errorf("error %q does not mention %s", err.Error(), missing)
			}
		})
	}
}

func TestParse_ProductionFlag(t *testing.T) {
	env := allRequired()
	env["NODE_ENV"] = "production"
	withEnv(t, env)

	cfg, err := Parse()
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if !cfg.IsProduction() {
		t.Error("IsProduction() = false, want true")
	}
}

func TestParse_OptionalAiKeysEmpty(t *testing.T) {
	withEnv(t, allRequired())

	cfg, err := Parse()
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if cfg.OpenAIKey != "" {
		t.Errorf("OpenAIKey = %q, want empty when not set", cfg.OpenAIKey)
	}
	if cfg.GeminiKey != "" {
		t.Errorf("GeminiKey = %q, want empty when not set", cfg.GeminiKey)
	}
}
