// Package tenant resolves which Vintra tenant a Supabase user
// belongs to.
//
// Single tenant per user is the assumption today (mirrors apps/web's
// model). The TenantCtx struct is attached to every authenticated
// request and consumed by handlers via the TenantFrom helper in the
// middleware package.
package tenant

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
)

// Ctx is the per-request tenant context attached after auth +
// membership resolution.
type Ctx struct {
	UserID   string `json:"userId"`
	TenantID string `json:"tenantId"`
	Role     string `json:"role"`
}

// ErrNoMembership is returned when a user is authenticated but has no
// tenant_members row. Middleware converts this to 403.
var ErrNoMembership = errors.New("tenant: no membership for user")

// Service loads tenant memberships from Postgres. Stateless — safe to
// share across goroutines.
type Service struct {
	db *db.DB
}

func New(database *db.DB) *Service {
	return &Service{db: database}
}

// Get returns the tenant membership for the given userID. Returns
// ErrNoMembership when the user has no tenant_members row.
//
// Mirrors the SQL pattern used by apps/web's requireAuth middleware
// (apps/web/src/server/middleware/auth.ts:256-264) so the two apps
// agree on tenancy semantics.
func (s *Service) Get(ctx context.Context, userID string) (*Ctx, error) {
	const q = `
SELECT tm.tenant_id, tm.role
FROM tenant_members tm
WHERE tm.user_id = $1
LIMIT 1
`
	var c Ctx
	c.UserID = userID
	err := s.db.QueryRow(ctx, q, userID).Scan(&c.TenantID, &c.Role)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoMembership
		}
		return nil, err
	}
	return &c, nil
}
