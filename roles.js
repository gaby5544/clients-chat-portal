// Multi-admin role tiers.
//
//   SUPER_ADMIN  Full control — everything ADMIN can do, plus Branding
//                Center and any future account-level settings.
//   ADMIN        Group management — create/delete/rename groups, uploads,
//                transactions, tasks, announcements, kicking users, DMs.
//   MODERATOR    Message moderation only — edit/delete/pin/select messages,
//                view edit history. No group management, no branding.
//
// Each tier is unlocked by its own passkey (set via environment variables).
// A key matching a HIGHER tier also grants everything a LOWER tier can do.

const SUPER_ADMIN_PASSKEY = process.env.SUPER_ADMIN_PASSKEY || 'SUPERADMIN123';
const ADMIN_PASSKEY = process.env.ADMIN_PASSKEY || 'ADMIN123';
const MODERATOR_PASSKEY = process.env.MODERATOR_PASSKEY || 'MODERATOR123';

const LEVEL = { MODERATOR: 1, ADMIN: 2, SUPER_ADMIN: 3 };

/**
 * Resolve which admin role tier (if any) a submitted passkey unlocks.
 * Returns 'SUPER_ADMIN' | 'ADMIN' | 'MODERATOR' | null.
 */
function resolveAdminRole(adminKey) {
  if (!adminKey) return null;
  if (adminKey === SUPER_ADMIN_PASSKEY) return 'SUPER_ADMIN';
  if (adminKey === ADMIN_PASSKEY) return 'ADMIN';
  if (adminKey === MODERATOR_PASSKEY) return 'MODERATOR';
  return null;
}

/** True if `role` meets or exceeds `minRole`. */
function hasMinRole(role, minRole) {
  if (!role) return false;
  return (LEVEL[role] || 0) >= (LEVEL[minRole] || 0);
}

module.exports = { SUPER_ADMIN_PASSKEY, ADMIN_PASSKEY, MODERATOR_PASSKEY, LEVEL, resolveAdminRole, hasMinRole };
