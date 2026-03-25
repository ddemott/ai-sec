'use client'

import React, { useState, useEffect, useRef } from 'react'
import { 
  BookOpen, 
  Upload, 
  Trash2, 
  FileText, 
  AlertCircle, 
  CheckCircle2,
  Search,
  Loader2,
  Plus
} from 'lucide-react'
import { Api } from '../lib/api'
import { useActiveTenantId } from '../lib/SessionContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Badge } from './ui/Badge'

export default function KnowledgeBaseView() {
  const tenantId = useActiveTenantId()
  const [docs, setDocs] = useState<{ id: string; content: string; source?: string; created_at: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchDocs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  async function fetchDocs() {
    if (!tenantId) return
    setLoading(true)
    try {
      const data = await Api.knowledge.list(tenantId)
      setDocs(data)
    } catch (err) {
      console.error("Failed to fetch knowledge", err)
    } finally {
      setLoading(false)
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !tenantId) return

    setUploading(true)
    setMessage(null)
    try {
      const res = await Api.knowledge.ingest(tenantId, file)
      if (res.success) {
        setMessage({ type: 'success', text: `Successfully ingested ${res.chunksIngested} knowledge chunks.` })
        fetchDocs()
      } else {
        setMessage({ type: 'error', text: res.error || "Upload failed" })
      }
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : "An error occurred during upload" })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this knowledge chunk? The AI will no longer be able to use this specific information.")) return
    
    try {
      await Api.knowledge.delete(id, tenantId)
      setDocs(docs.filter(d => d.id !== id))
    } catch {
      alert("Failed to delete")
    }
  }

  const filteredDocs = docs.filter(d => 
    d.content.toLowerCase().includes(searchTerm.toLowerCase()) || 
    d.source?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-8 transition-colors duration-200" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
      <header className="mb-8 shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center">
          <div className="bg-orange-100 dark:bg-orange-900/30 p-2 rounded-lg mr-4 text-orange-600 dark:text-orange-400">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display">Knowledge Base</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Feed the AI with PDFs and documents to handle complex business questions.</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
            accept=".pdf,.txt"
          />
          <Button 
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            variant="primary"
            icon={uploading ? Loader2 : Upload}
            className={uploading ? "animate-pulse" : ""}
          >
            {uploading ? "Ingesting..." : "Upload Document"}
          </Button>
        </div>
      </header>

      {message && (
        <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2 ${
          message.type === 'success' 
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-100 dark:border-green-800' 
            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-100 dark:border-red-800'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <span className="font-medium">{message.text}</span>
          <button onClick={() => setMessage(null)} className="ml-auto text-current opacity-50 hover:opacity-100 font-bold">×</button>
        </div>
      )}

      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input 
          placeholder="Search through knowledge chunks..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 italic">
            <Loader2 className="w-8 h-8 animate-spin mb-4 opacity-20" />
            <p>Loading knowledge base...</p>
          </div>
        ) : filteredDocs.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredDocs.map((doc) => (
              <Card key={doc.id} className="group relative flex flex-col h-full hover:border-orange-200 dark:hover:border-orange-900/50 transition-all duration-300" style={{ borderColor: 'var(--border-soft)' }}>
                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-orange-500 uppercase tracking-widest">
                      <FileText className="w-3 h-3" />
                      {doc.source || "Manual Entry"}
                    </div>
                    <button 
                      onClick={() => handleDelete(doc.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                      title="Delete Chunk"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <p className="text-sm line-clamp-6 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {doc.content}
                  </p>
                  
                  <div className="mt-auto pt-4 flex items-center justify-between">
                    <span className="text-[10px] text-gray-400 font-medium">
                      Added {new Date(doc.created_at).toLocaleDateString()}
                    </span>
                    <Badge variant="secondary" className="text-[9px] py-0 px-1.5 opacity-50">
                      ID: {doc.id.split('-')[0]}
                    </Badge>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 rounded-3xl border-2 border-dashed" style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}>
            <BookOpen className="w-12 h-12 text-gray-200 dark:text-gray-800 mb-4" />
            <p className="font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>The Knowledge Base is empty</p>
            <p className="text-sm max-w-xs text-center mb-6" style={{ color: 'var(--text-muted)' }}>
              Upload your first business document to give the AI context about your policies and services.
            </p>
            <Button 
              variant="secondary" 
              onClick={() => fileInputRef.current?.click()}
              icon={Plus}
            >
              Get Started
            </Button>
          </div>
        )}
      </div>

      <footer className="mt-6 p-4 bg-orange-50 dark:bg-orange-900/10 rounded-2xl border border-orange-100/50 dark:border-orange-900/20 shrink-0">
        <p className="text-xs text-orange-800 dark:text-orange-300/70 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>
            <strong>Pro Tip:</strong> For best results, use documents with clear headings and natural language. 
            The AI uses &quot;Semantic Search&quot; to find the most relevant chunk, so detailed explanations are better than short bullet points.
          </span>
        </p>
      </footer>
    </div>
  )
}
