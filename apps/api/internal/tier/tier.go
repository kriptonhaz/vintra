// Package tier provides WA subscription tier ordering helpers.
// Shared by internal/rag and HTTP handlers to avoid import cycles.
package tier

// Order maps tier names to numeric rank. Empty string = free (no wa_settings row).
var Order = map[string]int{
	"":           0,
	"basic":      1,
	"komplit":    2,
	"enterprise": 3,
}

// AtLeast returns true when current tier meets or exceeds the required tier.
// Free tier ("") never meets any paid requirement.
func AtLeast(current, required string) bool {
	return Order[current] >= Order[required]
}
