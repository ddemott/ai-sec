import React, { useState, useEffect } from 'react'
import { Phone, Loader2, CheckCircle2, AlertCircle, Rocket } from 'lucide-react'
import { Api } from '../../lib/api'
import { useActiveTenantId } from '../../lib/SessionContext'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import type { Step7Props } from './types'

export function Step7GoLive({ phoneStatus: initialStatus, inboundPhone: initialPhone }: Step7Props) {
  const tenantId = useActiveTenantId()
  const [areaCode, setAreaCode] = useState('')
  const [phoneStatus, setPhoneStatus] = useState(initialStatus)
  const [inboundPhone, setInboundPhone] = useState(initialPhone)
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Refresh status on mount
  useEffect(() => {
    if (!tenantId) return
    Api.provisioning.status(tenantId).then(data => {
      setPhoneStatus(data.phone_status)
      setInboundPhone(data.inbound_phone)
    }).catch(() => {})
  }, [tenantId])

  async function handleActivate() {
    if (!tenantId) return
    setActivating(true)
    setError(null)
    setPhoneStatus('provisioning')
    try {
      const result = await Api.provisioning.activate(tenantId, areaCode.trim() || undefined)
      setPhoneStatus('active')
      setInboundPhone(result.phone_number)
    } catch (err: unknown) {
      setPhoneStatus('failed')
      setError(err instanceof Error ? err.message : 'Failed to activate phone')
    } finally {
      setActivating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Rocket className="w-5 h-5 text-blue-500" />
          Go Live
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Activate your AI phone line. Once active, callers will reach your AI receptionist who can book appointments, answer questions, and manage your schedule.
        </p>
      </div>

      {phoneStatus === 'active' && inboundPhone ? (
        <div className="p-6 rounded-xl border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-950/20">
          <div className="flex items-center gap-3 mb-3">
            <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
            <span className="text-lg font-bold text-green-700 dark:text-green-300">Your AI line is live</span>
          </div>
          <div className="flex items-center gap-3 ml-9">
            <Phone className="w-4 h-4 text-green-600 dark:text-green-400" />
            <span className="text-xl font-display tracking-wide text-green-800 dark:text-green-200">{inboundPhone}</span>
          </div>
          <p className="text-sm text-green-600 dark:text-green-400 mt-4 ml-9">
            Try calling this number to test your AI receptionist.
          </p>
        </div>
      ) : phoneStatus === 'provisioning' || activating ? (
        <div className="p-6 rounded-xl border border-yellow-200 dark:border-yellow-900/40 bg-yellow-50 dark:bg-yellow-950/20 flex items-center gap-4">
          <Loader2 className="w-6 h-6 text-yellow-600 dark:text-yellow-400 animate-spin" />
          <div>
            <div className="font-bold text-yellow-700 dark:text-yellow-300">Setting up your phone line...</div>
            <div className="text-sm text-yellow-600 dark:text-yellow-400 mt-1">This usually takes 10-30 seconds.</div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-1 block">
                  Preferred area code (optional)
                </label>
                <Input
                  placeholder="e.g. 312"
                  value={areaCode}
                  onChange={e => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  className="max-w-[120px]"
                />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  We&apos;ll try to get a number with this area code. Leave blank for any available number.
                </p>
              </div>

              <Button
                variant="primary"
                onClick={handleActivate}
                disabled={activating}
                isLoading={activating}
                icon={Phone}
                className="w-full py-3"
              >
                Activate AI Phone Line
              </Button>
            </div>
          </div>

          {phoneStatus === 'failed' && error && (
            <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-red-700 dark:text-red-300 text-sm">Activation failed</div>
                <div className="text-sm text-red-600 dark:text-red-400 mt-1">{error}</div>
              </div>
            </div>
          )}

          {!error && (
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
              You can skip this step and activate later from Settings.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
