'use client'

import React, { useState } from 'react'
import { 
  Award, 
  Plus, 
  Trash2, 
  Tag, 
  AlertCircle
} from 'lucide-react'
import { Api } from '../lib/api'
import { useSession, useStaticData } from '../lib/hooks'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

export default function SkillManagementView() {
  const { tenantId } = useSession()
  const { skills, loading, refresh } = useStaticData(tenantId)
  
  const [newSkill, setNewSkill] = useState({ name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreateSkill(e: React.FormEvent) {
    e.preventDefault()
    if (!newSkill.name.trim() || !tenantId) return
    
    setSaving(true)
    setError(null)
    try {
      const res = await Api.skills.create(tenantId, newSkill)
      if (res.success) {
        setNewSkill({ name: '', description: '' })
        refresh()
      } else {
        setError(res.error || "Failed to create skill")
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteSkill(id: number) {
    if (!confirm("Are you sure? This will NOT remove the skill from employees who already have it, but it will be removed from the master list.")) return
    
    try {
      await Api.skills.delete(id, tenantId)
      refresh()
    } catch {
      alert("Delete failed")
    }
  }

  if (loading && skills.length === 0) {
    return <div className="p-8 text-gray-500 italic">Loading skills...</div>
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-[#111] overflow-y-auto text-gray-900 dark:text-gray-100 p-8 transition-colors duration-200">
      <header className="mb-10 shrink-0">
        <div className="flex items-center mb-6">
          <div className="bg-purple-100 dark:bg-purple-900/30 p-2 rounded-lg mr-4 text-purple-600 dark:text-purple-400">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Skills Master List</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Define the certified expertise and capabilities for your business.</p>
          </div>
        </div>

        <form onSubmit={handleCreateSkill} className="max-w-2xl bg-gray-50 dark:bg-[#1a1a1a] p-6 rounded-3xl border border-gray-100 dark:border-gray-800 flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Skill Name (Slug)</label>
              <Input 
                placeholder="e.g. oil-change"
                value={newSkill.name}
                onChange={e => setNewSkill({ ...newSkill, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Description</label>
              <Input 
                placeholder="Briefly describe this expertise..."
                value={newSkill.description}
                onChange={e => setNewSkill({ ...newSkill, description: e.target.value })}
              />
            </div>
          </div>
          <Button 
            type="submit" 
            disabled={saving || !newSkill.name.trim()}
            icon={Plus}
            loading={saving}
            className="md:mb-1"
          >
            Define Skill
          </Button>
        </form>
      </header>

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl text-red-700 dark:text-red-400 flex items-center gap-3">
          <AlertCircle className="w-5 h-5" />
          <span className="font-bold">{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {skills.map(skill => (
          <Card key={skill.id} className="group hover:border-purple-200 dark:hover:border-purple-900/50 transition-all">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Tag className="w-3 h-3 text-purple-500" />
                  <span className="font-mono text-sm font-black text-purple-600 dark:text-purple-400 uppercase">{skill.name}</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  {skill.description || "No description provided."}
                </p>
              </div>
              <button 
                onClick={() => handleDeleteSkill(skill.id)}
                className="opacity-0 group-hover:opacity-100 p-2 text-gray-300 hover:text-red-500 transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </Card>
        ))}

        {skills.length === 0 && (
          <div className="col-span-full h-40 flex flex-col items-center justify-center border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-3xl text-gray-400 italic">
            <Award className="w-8 h-8 mb-2 opacity-20" />
            <p>No master skills defined yet.</p>
          </div>
        )}
      </div>

      <Card variant="info" className="mt-10">
        <div className="flex gap-4">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg h-fit text-blue-600">
            <Award className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold mb-1">Why manage skills centrally?</h4>
            <p className="text-xs leading-relaxed text-blue-800 dark:text-blue-300/80">
              Defining skills here ensures consistency across your team and physical bays. 
              Once a skill is defined, you can assign it to <strong>Staff</strong> (People) and <strong>Resources</strong> (Places). 
              The AI will only book appointments where both the Person and the Place share the required skills for the service.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
