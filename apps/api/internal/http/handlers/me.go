// Package handlers holds the HTTP handlers wired into the Fiber app.
//
// One file per feature area. This file: the smoke-test /v1/me endpoint
// that returns the authenticated tenant context — proves the
// auth+tenant middleware chain is working end-to-end.
package handlers

import (
	"github.com/gofiber/fiber/v2"

	"github.com/kriptonhaz/vintra/apps/api/internal/http/middleware"
)

// Me returns the resolved { userId, tenantId, role } for the
// authenticated caller. Requires Auth + Tenant middlewares.
func Me(c *fiber.Ctx) error {
	return c.JSON(middleware.TenantFrom(c))
}
