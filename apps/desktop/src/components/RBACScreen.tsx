// RBACScreen — Roles & Permissions admin (owner-only).
//
// ADR-0038. Backed by @pharmacare/rbac (29 tests green).
// Lists all users in the shop, lets owner change role, adds per-user
// permission overrides, surfaces MFA enrollment status.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, KeyRound, AlertTriangle, UserCog, Plus } from "lucide-react";
import { Glass, Badge, Button, Input } from "@pharmacare/design-system";
import {
  ROLE_PERMS, listPermissions, requiresMfa, rolePermsDiff,
  type Role, type Permission,
} from "@pharmacare/rbac";
import {
  rbacListUsersRpc,
  rbacSetRoleRpc,
  rbacListOverridesRpc,
  rbacUpsertOverrideRpc,
  rbacDeleteOverrideRpc,
  type UserRowDTO,
  type PermissionOverrideDTO,
  type RoleDTO,
} from "../lib/ipc.js";

const ALL_ROLES: readonly RoleDTO[] = ["owner", "manager", "pharmacist", "technician", "cashier"];
const ALL_PERMS: readonly Permission[] = (Object.keys(ROLE_PERMS) as Role[])
  .flatMap((r) => listPermissions(r))
  .filter((p, i, arr) => arr.indexOf(p) === i)
  .sort();

export default function RBACScreen(): React.ReactElement {
  const [users, setUsers] = useState<readonly UserRowDTO[]>([]);
  const [selected, setSelected] = useState<UserRowDTO | null>(null);
  const [overrides, setOverrides] = useState<readonly PermissionOverrideDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newOverridePerm, setNewOverridePerm] = useState<Permission>("bill.create");
  const [newOverrideGranted, setNewOverrideGranted] = useState(true);
  const [newOverrideReason, setNewOverrideReason] = useState("");

  const reloadUsers = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const u = await rbacListUsersRpc("shop_local");
      setUsers(u);
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void reloadUsers(); }, [reloadUsers]);

  const onSelect = useCallback(async (u: UserRowDTO) => {
    setSelected(u);
    try {
      const ov = await rbacListOverridesRpc(u.id);
      setOverrides(ov);
    } catch (e) { setErr(String(e)); }
  }, []);

  const onChangeRole = useCallback(async (u: UserRowDTO, role: RoleDTO) => {
    setBusy(true); setErr(null);
    try {
      const updated = await rbacSetRoleRpc(u.id, role);
      setUsers(users.map((x) => x.id === u.id ? updated : x));
      if (selected?.id === u.id) setSelected(updated);
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }, [users, selected]);

  const onAddOverride = useCallback(async () => {
    if (!selected) return;
    setBusy(true); setErr(null);
    try {
      const next = await rbacUpsertOverrideRpc({
        userId: selected.id,
        permission: newOverridePerm,
        granted: newOverrideGranted,
        reason: newOverrideReason || undefined,
        grantedByUserId: "owner_local",   // TODO: read from auth context
        grantedAt: new Date().toISOString(),
      } as PermissionOverrideDTO);
      const exists = overrides.some((o) => o.permission === next.permission);
      setOverrides(exists
        ? overrides.map((o) => o.permission === next.permission ? next : o)
        : [...overrides, next]);
      setNewOverrideReason("");
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }, [selected, newOverridePerm, newOverrideGranted, newOverrideReason, overrides]);

  const onRemoveOverride = useCallback(async (perm: string) => {
    if (!selected) return;
    setBusy(true); setErr(null);
    try {
      await rbacDeleteOverrideRpc(selected.id, perm);
      setOverrides(overrides.filter((o) => o.permission !== perm));
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }, [selected, overrides]);

  const rolePerms = useMemo(() => selected ? listPermissions(selected.role as Role) : [], [selected]);
  const ownerOnly = useMemo(() => selected ? rolePermsDiff("owner", selected.role as Role).onlyA : [], [selected]);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="rbac">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Roles & Permissions</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              5 roles · {ALL_PERMS.length} permissions · MFA gate on sensitive actions
            </p>
          </div>
        </div>
        <Badge variant="warning">OWNER ONLY</Badge>
      </header>

      {err && (
        <Glass>
          <div className="flex gap-2 p-3 text-[13px] text-[var(--pc-state-danger)]">
            <AlertTriangle size={16} /> {err}
          </div>
        </Glass>
      )}

      {/* ── Users list ───────────────────────────────────────────────── */}
      <Glass>
        <div className="p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <UserCog size={16} aria-hidden />
            <h2 className="font-medium">Users in this shop</h2>
          </div>
          {users.length === 0 ? (
            <div className="text-[12px] text-[var(--pc-text-tertiary)] py-4 text-center">
              No users yet. Use Settings → User Management to add the first one.
            </div>
          ) : (
            <table className="text-[13px] w-full" data-testid="users-table">
              <thead>
                <tr className="text-left text-[var(--pc-text-tertiary)] text-[11px] uppercase border-b border-[var(--pc-border-subtle)]">
                  <th className="py-1.5 font-medium">Name</th>
                  <th className="py-1.5 font-medium">Role</th>
                  <th className="py-1.5 font-medium">MFA</th>
                  <th className="py-1.5 font-medium">Active</th>
                  <th className="py-1.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}
                      className={`border-b border-[var(--pc-border-subtle)] last:border-0 cursor-pointer hover:bg-[var(--pc-bg-hover)] ${selected?.id === u.id ? "bg-[var(--pc-bg-hover)]" : ""}`}
                      onClick={() => void onSelect(u)}>
                    <td className="py-2">{u.name}</td>
                    <td className="py-2">
                      <select
                        value={u.role}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => void onChangeRole(u, e.target.value as RoleDTO)}
                        className="bg-transparent border border-[var(--pc-border-subtle)] rounded px-2 py-0.5 text-[12px]"
                        disabled={busy}
                      >
                        {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="py-2">
                      {u.mfaEnrolled
                        ? <Badge variant="success"><KeyRound size={10} /> ENROLLED</Badge>
                        : <Badge variant="warning">NOT ENROLLED</Badge>}
                    </td>
                    <td className="py-2">
                      {u.isActive ? <Badge variant="success">ACTIVE</Badge> : <Badge variant="neutral">DISABLED</Badge>}
                    </td>
                    <td className="py-2 text-right">
                      <Button variant="ghost" onClick={(e) => { e.stopPropagation(); void onSelect(u); }}>
                        Manage
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Glass>

      {/* ── Selected user permission detail ──────────────────────────── */}
      {selected && (
        <>
          <Glass>
            <div className="p-4 flex flex-col gap-3" data-testid="user-perms">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">{selected.name} · permissions ({selected.role})</h2>
                <span className="text-[12px] text-[var(--pc-text-secondary)]">
                  {rolePerms.length} default · {overrides.length} overrides
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {rolePerms.map((p) => (
                  <span key={p}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono bg-[var(--pc-bg-surface)] border border-[var(--pc-border-subtle)]`}>
                    {p}
                    {requiresMfa(p) && <KeyRound size={10} className="text-[var(--pc-state-warning)]" />}
                  </span>
                ))}
              </div>
              {ownerOnly.length > 0 && (
                <div className="text-[11px] text-[var(--pc-text-tertiary)]">
                  <strong>Owner-only:</strong> {ownerOnly.slice(0, 6).join(", ")}{ownerOnly.length > 6 ? `, +${ownerOnly.length - 6} more` : ""}
                </div>
              )}
            </div>
          </Glass>

          {/* Override matrix */}
          <Glass>
            <div className="p-4 flex flex-col gap-3" data-testid="overrides-card">
              <h2 className="font-medium">Per-user overrides</h2>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-[var(--pc-text-secondary)] font-medium">Permission</label>
                  <select
                    value={newOverridePerm}
                    onChange={(e) => setNewOverridePerm(e.target.value as Permission)}
                    className="bg-transparent border border-[var(--pc-border-subtle)] rounded px-2 py-1 text-[12px] font-mono"
                    disabled={busy}
                  >
                    {ALL_PERMS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-[var(--pc-text-secondary)] font-medium">Action</label>
                  <select
                    value={newOverrideGranted ? "grant" : "revoke"}
                    onChange={(e) => setNewOverrideGranted(e.target.value === "grant")}
                    className="bg-transparent border border-[var(--pc-border-subtle)] rounded px-2 py-1 text-[12px]"
                    disabled={busy}
                  >
                    <option value="grant">Grant</option>
                    <option value="revoke">Revoke</option>
                  </select>
                </div>
                <div className="flex-1 min-w-[180px] flex flex-col gap-1">
                  <label className="text-[11px] text-[var(--pc-text-secondary)] font-medium">Reason</label>
                  <Input
                    type="text"
                    value={newOverrideReason}
                    onChange={(e) => setNewOverrideReason(e.target.value)}
                    placeholder="audit trail comment"
                    disabled={busy}
                  />
                </div>
                <Button onClick={onAddOverride} disabled={busy}><Plus size={14} /> Apply</Button>
              </div>
              {overrides.length > 0 && (
                <table className="text-[12px] w-full mt-2">
                  <thead>
                    <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[11px] border-b border-[var(--pc-border-subtle)]">
                      <th className="py-1 font-medium">Permission</th>
                      <th className="py-1 font-medium">State</th>
                      <th className="py-1 font-medium">Reason</th>
                      <th className="py-1 font-medium">Granted by · at</th>
                      <th className="py-1 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {overrides.map((o) => (
                      <tr key={o.permission} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                        <td className="py-1.5 font-mono">{o.permission}</td>
                        <td className="py-1.5">
                          {o.granted ? <Badge variant="success">GRANT</Badge> : <Badge variant="danger">REVOKE</Badge>}
                        </td>
                        <td className="py-1.5 text-[var(--pc-text-secondary)]">{o.reason ?? ""}</td>
                        <td className="py-1.5 text-[var(--pc-text-tertiary)]">{o.grantedByUserId} · {new Date(o.grantedAt).toLocaleDateString("en-IN")}</td>
                        <td className="py-1.5 text-right">
                          <Button variant="ghost" onClick={() => void onRemoveOverride(o.permission)}>Remove</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Glass>
        </>
      )}
    </div>
  );
}
