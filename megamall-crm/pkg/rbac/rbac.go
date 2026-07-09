// Package rbac holds small, dependency-free role-comparison helpers shared
// across handler and service layers (which must not import pkg/middleware,
// as that would create a layering violation).
package rbac

// IsOwnerLevel reports whether role has the same full-access permissions as
// "owner". "it_specialist" is a distinct role for audit/reporting purposes
// but is always owner-equivalent in every permission check.
func IsOwnerLevel(role string) bool {
	return role == "owner" || role == "it_specialist"
}
