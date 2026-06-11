package ai

import "fmt"

// ProviderError is returned by adapters when the upstream API responds
// with a non-2xx status. Callers can type-assert to extract the raw
// status code and body for logging or retry decisions.
type ProviderError struct {
	Provider string
	Status   int
	Body     string
}

func (e *ProviderError) Error() string {
	return fmt.Sprintf("ai/%s: HTTP %d: %s", e.Provider, e.Status, e.Body)
}
