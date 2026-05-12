'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { Plus, ShieldCheck, UserCircle2 } from 'lucide-react'
import { Api } from '../lib/api'
import { useActiveTenantId } from '@/lib/SessionContext'
import type { TeamUser } from '@/lib/types'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Modal } from './ui/Modal'
import { showToast } from './ui/Toast'

type Role = 'owner' | 'front_desk'

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  front_desk: 'Front Desk',
}

const ROLE_DESCRIPTION: Record<Role, string> = {
  owner: 'Full access — can configure services, staff, vocabulary, and team logins.',
  front_desk: 'Daily-use access only — schedule, customers, calls. No configuration.',
}

export default function TeamAccessView() {
  const tenantId = useActiveTenantId()
  const [users, setUsers] = useState<TeamUser[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('front_desk')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [pendingRoleId, setPendingRoleId] = useState<string | null>(null)

  const loadUsers = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    try {
      const res = await Api.users.list(tenantId)
      setUsers(res.users)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not load team logins', 'error')
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { void loadUsers() }, [loadUsers])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviteError(null)
    if (!tenantId) return
    setInviting(true)
    const res = await Api.users.invite(tenantId, {
      email: inviteEmail.trim(),
      full_name: inviteName.trim(),
      role: inviteRole,
    })
    setInviting(false)
    if (res.success) {
      setInviteOpen(false)
      setInviteEmail('')
      setInviteName('')
      setInviteRole('front_desk')
      showToast(`Invite sent to ${inviteEmail.trim()}`, 'success')
      void loadUsers()
    } else {
      setInviteError(res.error || 'Invite failed')
    }
  }

  const handleRoleChange = async (user: TeamUser, nextRole: Role) => {
    if (!tenantId || nextRole === user.role) return
    setPendingRoleId(user.user_id)
    const res = await Api.users.updateRole(user.user_id, tenantId, nextRole)
    setPendingRoleId(null)
    if (res.success) {
      setUsers((prev) => prev.map((u) => (u.user_id === user.user_id ? { ...u, role: nextRole } : u)))
      showToast(`${user.email} is now ${ROLE_LABEL[nextRole]}`, 'success')
    } else {
      showToast(res.error || 'Could not update role', 'error')
    }
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-2xl font-display tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Team Logins
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Invite staff to sign in. Owners see everything. Front Desk sees only the daily schedule, customers, and calls.
            </p>
          </div>
          <Button icon={Plus} onClick={() => setInviteOpen(true)} aria-label="Invite teammate">
            Invite
          </Button>
        </header>

        {loading && (
          <div className="text-sm py-8 text-center" style={{ color: 'var(--text-secondary)' }}>
            Loading…
          </div>
        )}

        {!loading && users.length === 0 && (
          <div className="text-sm py-8 text-center border rounded-xl" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)' }}>
            No team logins yet. Invite your first teammate to get started.
          </div>
        )}

        {!loading && users.length > 0 && (
          <ul className="space-y-2" role="list">
            {users.map((u) => (
              <li
                key={u.user_id}
                className="flex items-center justify-between gap-4 p-4 border rounded-xl"
                style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {u.role === 'owner' ? (
                    <ShieldCheck className="w-5 h-5 shrink-0" style={{ color: 'var(--accent-soft)' }} aria-hidden="true" />
                  ) : (
                    <UserCircle2 className="w-5 h-5 shrink-0" style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                      {u.full_name || u.email}
                      {u.is_self && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}>
                          You
                        </span>
                      )}
                    </div>
                    <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{u.email}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <label className="sr-only" htmlFor={`role-${u.user_id}`}>Role for {u.email}</label>
                  <select
                    id={`role-${u.user_id}`}
                    value={u.role}
                    disabled={u.is_self || pendingRoleId === u.user_id}
                    onChange={(e) => void handleRoleChange(u, e.target.value as Role)}
                    className="text-xs rounded-md px-2 py-1.5 outline-none transition disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: 'var(--bg-raised)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border)',
                    }}
                    title={u.is_self ? "You can't change your own role" : `Change ${u.email}'s role`}
                  >
                    <option value="owner">Owner</option>
                    <option value="front_desk">Front Desk</option>
                  </select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        isOpen={inviteOpen}
        onClose={() => { if (!inviting) setInviteOpen(false) }}
        title="Invite a teammate"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setInviteOpen(false)} disabled={inviting}>
              Cancel
            </Button>
            <Button type="submit" form="invite-form" isLoading={inviting}>
              Send invite
            </Button>
          </div>
        }
      >
        <form id="invite-form" onSubmit={handleInvite} className="space-y-4">
          <Input
            label="Full name"
            type="text"
            required
            autoComplete="name"
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
            placeholder="Pat Lopez"
          />
          <Input
            label="Email"
            type="email"
            required
            autoComplete="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="pat@business.com"
          />
          <div>
            <label className="block text-xs font-bold uppercase mb-1" style={{ color: 'var(--text-secondary)' }}>
              Role
            </label>
            <div className="space-y-2">
              {(['front_desk', 'owner'] as Role[]).map((r) => (
                <label
                  key={r}
                  className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition"
                  style={{
                    borderColor: inviteRole === r ? 'var(--accent)' : 'var(--border)',
                    backgroundColor: inviteRole === r ? 'var(--accent-muted)' : 'var(--bg-card)',
                  }}
                >
                  <input
                    type="radio"
                    name="invite-role"
                    value={r}
                    checked={inviteRole === r}
                    onChange={() => setInviteRole(r)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{ROLE_LABEL[r]}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{ROLE_DESCRIPTION[r]}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          {inviteError && (
            <p role="alert" className="text-sm text-red-500">{inviteError}</p>
          )}
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            They&rsquo;ll receive an email with a link to set their password and sign in. The link expires in 3 days.
          </p>
        </form>
      </Modal>
    </div>
  )
}
