package safego

import (
	"sync/atomic"
	"testing"
	"time"
)

// TestRecover_SwallowsPanic verifies a panic inside the wrapped function
// does NOT escape — caller continues normally. Without this guarantee
// any goroutine panic would kill the api process.
func TestRecover_SwallowsPanic(t *testing.T) {
	// If recover failed, this test would itself panic and the test
	// runner would mark the package as crashed.
	wrapped := Recover("test.panic", func() {
		panic("synthetic panic for test")
	})
	wrapped() // must NOT panic
}

// TestRecover_PassesThroughNormal ensures the wrapper is transparent
// when no panic happens.
func TestRecover_PassesThroughNormal(t *testing.T) {
	called := false
	wrapped := Recover("test.normal", func() {
		called = true
	})
	wrapped()
	if !called {
		t.Error("wrapped fn should have been invoked")
	}
}

// TestGo_StartsGoroutineAndRecovers — black-box test that Go() actually
// spawns a goroutine, runs the function, and recovers from any panic
// inside it. Uses a counter and a small sleep to give the goroutine
// time to execute. A panic that escaped would crash the test binary.
func TestGo_StartsGoroutineAndRecovers(t *testing.T) {
	var counter atomic.Int32
	Go("test.go", func() {
		counter.Add(1)
		panic("synthetic")
	})
	// Give the goroutine time to run. 50ms is generous; the actual
	// work is one atomic add.
	time.Sleep(50 * time.Millisecond)
	if counter.Load() != 1 {
		t.Errorf("expected counter=1, got %d", counter.Load())
	}
}

// TestRecoverFn_PassesArgument verifies the generic single-arg wrapper
// preserves the argument value AND recovers from panic.
func TestRecoverFn_PassesArgument(t *testing.T) {
	got := ""
	wrapped := RecoverFn("test.arg", func(s string) {
		got = s
		if s == "boom" {
			panic("from arg")
		}
	})
	wrapped("hello")
	if got != "hello" {
		t.Errorf("expected got=hello, got %q", got)
	}
	wrapped("boom") // must NOT panic
}
