// Package safego provides goroutine and callback wrappers that recover
// from panics, log them with structured slog, and prevent process exit.
//
// The api holds long-lived state (whatsmeow sockets, Redis pool, asynq
// workers). A single panic in any goroutine — including those spawned
// by libraries like whatsmeow's event bus — kills the whole process and
// every active WhatsApp session with it. Tenants then have to rescan
// QR codes; some never do.
//
// Fiber's recover middleware covers HTTP handlers; asynq covers task
// handlers. This package covers everything else: whatsmeow callbacks,
// background goroutines (registry.Revive, scheduleReconnect), and any
// library callback we hand a function pointer to.
//
// Usage:
//
//	// Fire-and-forget goroutine:
//	safego.Go("wa.revive", func() {
//	    registry.Revive(ctx)
//	})
//
//	// Wrap a callback handed to a 3rd-party library:
//	client.AddEventHandler(safego.RecoverFn("wa.event_handler", c.handleWAEvent))
package safego

import (
	"log/slog"
	"runtime/debug"
)

// Go starts fn in a new goroutine, recovering from any panic with a
// structured log. The label distinguishes panics from different call
// sites in logs.
func Go(label string, fn func()) {
	go Recover(label, fn)()
}

// Recover returns fn wrapped in a deferred panic-recover with logging.
// Use directly when you want the wrapped function back (e.g., to assign
// to a callback field) without spawning a goroutine.
func Recover(label string, fn func()) func() {
	return func() {
		defer logPanic(label)
		fn()
	}
}

// RecoverFn wraps a single-argument function. Common case: whatsmeow's
// EventHandler signature `func(interface{})`. Generic over the argument
// type so the wrapped function keeps its original signature for the
// caller library to introspect.
func RecoverFn[T any](label string, fn func(T)) func(T) {
	return func(arg T) {
		defer logPanic(label)
		fn(arg)
	}
}

func logPanic(label string) {
	if r := recover(); r != nil {
		slog.Error("safego: panic recovered",
			"label", label,
			"panic", r,
			"stack", string(debug.Stack()),
		)
	}
}
