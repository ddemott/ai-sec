'use client'

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export type ThemeId = 'light' | 'dark' | 'midnight' | 'nord' | 'sunset' | 'forest' | 'high-contrast' | 'solarized'

export interface ThemeInfo {
  id: ThemeId
  name: string
  description: string
  isDark: boolean
  preview: { bg: string; surface: string; accent: string }
}

export const THEMES: ThemeInfo[] = [
  { id: 'light', name: 'Light', description: 'Clean and bright', isDark: false, preview: { bg: '#ffffff', surface: '#f9fafb', accent: '#2563eb' } },
  { id: 'dark', name: 'Dark', description: 'Easy on the eyes', isDark: true, preview: { bg: '#111111', surface: '#1a1a1a', accent: '#3b82f6' } },
  { id: 'midnight', name: 'Midnight', description: 'Deep blue-black', isDark: true, preview: { bg: '#0B0E14', surface: '#13171F', accent: '#5865F2' } },
  { id: 'nord', name: 'Nord', description: 'Arctic cool blues', isDark: true, preview: { bg: '#2E3440', surface: '#3B4252', accent: '#88C0D0' } },
  { id: 'sunset', name: 'Sunset', description: 'Warm amber tones', isDark: true, preview: { bg: '#1A1412', surface: '#231C18', accent: '#E8914F' } },
  { id: 'forest', name: 'Forest', description: 'Deep earth greens', isDark: true, preview: { bg: '#0F1A14', surface: '#152219', accent: '#4ADE80' } },
  { id: 'high-contrast', name: 'High Contrast', description: 'Maximum readability', isDark: true, preview: { bg: '#000000', surface: '#0A0A0A', accent: '#FFD60A' } },
  { id: 'solarized', name: 'Solarized', description: 'Classic developer palette', isDark: true, preview: { bg: '#002B36', surface: '#073642', accent: '#268BD2' } },
]

interface ThemeContextValue {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
  themeInfo: ThemeInfo
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
  themeInfo: THEMES[0],
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>('light')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('theme') as ThemeId | null
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

    if (saved && THEMES.some(t => t.id === saved)) {
      setThemeState(saved)
    } else if (prefersDark) {
      setThemeState('dark')
    }
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    const info = THEMES.find(t => t.id === theme) || THEMES[0]

    // Set data-theme attribute for CSS variable overrides
    document.documentElement.setAttribute('data-theme', theme)

    // Toggle dark class for backward compatibility with existing dark: prefixed classes
    if (info.isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }

    localStorage.setItem('theme', theme)
  }, [theme, mounted])

  function setTheme(t: ThemeId) {
    setThemeState(t)
  }

  const themeInfo = THEMES.find(t => t.id === theme) || THEMES[0]

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themeInfo }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
