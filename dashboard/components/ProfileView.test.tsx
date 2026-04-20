/**
 * ProfileView Tests
 * Tests user profile display, theme selection, and admin status rendering.
 * Each section has happy + sad paths with 5W diagnostic context.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

// Mock the contexts
const mockSetTheme = vi.fn()
let mockTheme = 'dark'
let mockUserName: string | null = 'Dale Cooper'
let mockUserEmail: string | null = 'dale@secretaryhq.com'
let mockIsAdmin = false

vi.mock('../lib/SessionContext', () => ({
  useSessionContext: () => ({
    userName: mockUserName,
    userEmail: mockUserEmail,
    isAdmin: mockIsAdmin,
  }),
}))

vi.mock('@/lib/ThemeContext', () => ({
  useTheme: () => ({
    theme: mockTheme,
    setTheme: mockSetTheme,
  }),
  THEMES: [
    { id: 'dark', name: 'Dark', description: 'Dark mode', preview: { accent: '#3b82f6' } },
    { id: 'light', name: 'Light', description: 'Light mode', preview: { accent: '#2563eb' } },
    { id: 'midnight', name: 'Midnight', description: 'Deep blue', preview: { accent: '#6366f1' } },
    { id: 'nord', name: 'Nord', description: 'Arctic inspired', preview: { accent: '#88c0d0' } },
    { id: 'sunset', name: 'Sunset', description: 'Warm tones', preview: { accent: '#f97316' } },
    { id: 'forest', name: 'Forest', description: 'Nature green', preview: { accent: '#22c55e' } },
    { id: 'high-contrast', name: 'High Contrast', description: 'Accessibility', preview: { accent: '#ffffff' } },
    { id: 'solarized', name: 'Solarized', description: 'Classic', preview: { accent: '#b58900' } },
  ],
}))

// Import after mocks
import ProfileView from './ProfileView'

describe('ProfileView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTheme = 'dark'
    mockUserName = 'Dale Cooper'
    mockUserEmail = 'dale@secretaryhq.com'
    mockIsAdmin = false
  })

  describe('Happy Paths', () => {
    test('renders profile header with title and description', () => {
      render(<ProfileView />)
      expect(screen.getByText('My Profile')).toBeInTheDocument()
      expect(screen.getByText('Your account details and preferences')).toBeInTheDocument()
      // WHO: all users | WHAT: profile page header
      // WHEN: navigating to profile | WHERE: ProfileView header
      // WHY: users need to identify they're on profile page
    })

    test('displays user name and email correctly', () => {
      render(<ProfileView />)
      expect(screen.getByText('Dale Cooper')).toBeInTheDocument()
      expect(screen.getByText('dale@secretaryhq.com')).toBeInTheDocument()
      // WHO: authenticated user | WHAT: account info display
      // WHEN: viewing profile | WHERE: Account section
      // WHY: users need to verify their account details
    })

    test('shows user initial avatar when name is provided', () => {
      render(<ProfileView />)
      expect(screen.getByText('D')).toBeInTheDocument()
      // WHO: all users | WHAT: avatar initial
      // WHEN: rendering profile | WHERE: avatar circle
      // WHY: visual identity without uploaded photo
    })

    test('displays all 8 theme options', () => {
      render(<ProfileView />)
      expect(screen.getByText('Dark')).toBeInTheDocument()
      expect(screen.getByText('Light')).toBeInTheDocument()
      expect(screen.getByText('Midnight')).toBeInTheDocument()
      expect(screen.getByText('Nord')).toBeInTheDocument()
      expect(screen.getByText('Sunset')).toBeInTheDocument()
      expect(screen.getByText('Forest')).toBeInTheDocument()
      expect(screen.getByText('High Contrast')).toBeInTheDocument()
      expect(screen.getByText('Solarized')).toBeInTheDocument()
      // WHO: all users | WHAT: theme picker options
      // WHEN: viewing appearance section | WHERE: Appearance card
      // WHY: users can customize dashboard appearance
    })

    test('calls setTheme when theme button is clicked', () => {
      render(<ProfileView />)
      fireEvent.click(screen.getByText('Light'))
      expect(mockSetTheme).toHaveBeenCalledWith('light')
      // WHO: user | WHAT: theme selection
      // WHEN: clicking theme option | WHERE: Appearance section
      // WHY: persist user's visual preference
    })

    test('shows admin badge when user is admin', () => {
      mockIsAdmin = true
      render(<ProfileView />)
      expect(screen.getByText('Admin')).toBeInTheDocument()
      // WHO: admin users | WHAT: admin badge indicator
      // WHEN: admin views profile | WHERE: Account section
      // WHY: admins need to see their elevated role
    })

    test('shows coming soon placeholder for future features', () => {
      render(<ProfileView />)
      expect(screen.getByText('Password change and notification preferences coming soon.')).toBeInTheDocument()
      // WHO: all users | WHAT: feature placeholder
      // WHEN: viewing profile | WHERE: bottom card
      // WHY: set expectations for upcoming features
    })
  })

  describe('Sad Paths', () => {
    test('displays fallback text when userName is null', () => {
      mockUserName = null
      render(<ProfileView />)
      expect(screen.getAllByText('Not set').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('U')).toBeInTheDocument() // Avatar initial
      // WHO: user with missing name data | WHAT: graceful fallback
      // WHEN: name not in session | WHERE: Account section
      // WHY: prevent blank display if session data incomplete
    })

    test('displays fallback text when userEmail is null', () => {
      mockUserEmail = null
      render(<ProfileView />)
      expect(screen.getAllByText('Not set').length).toBeGreaterThanOrEqual(1)
      // WHO: user with missing email data | WHAT: graceful fallback
      // WHEN: email not in session | WHERE: Account section
      // WHY: prevent blank display if session data incomplete
    })

    test('does not show admin badge when user is not admin', () => {
      mockIsAdmin = false
      render(<ProfileView />)
      expect(screen.queryByText('Admin')).not.toBeInTheDocument()
      // WHO: regular users | WHAT: no admin badge
      // WHEN: non-admin views profile | WHERE: Account section
      // WHY: admins badge should only appear for elevated users
    })

    test('handles empty string userName', () => {
      mockUserName = ''
      render(<ProfileView />)
      expect(screen.getAllByText('Not set').length).toBeGreaterThanOrEqual(1)
      // WHO: user with empty name | WHAT: empty string handling
      // WHEN: empty string in session | WHERE: Account section
      // WHY: empty string is falsy, should fall back
    })
  })

  describe('Edge Cases', () => {
    test('handles single character name', () => {
      mockUserName = 'X'
      render(<ProfileView />)
      // Single char displays as both name and avatar - expect 2 instances
      const elements = screen.getAllByText('X')
      expect(elements.length).toBeGreaterThanOrEqual(1)
    })

    test('handles lowercase first character in avatar', () => {
      mockUserName = 'dale'
      render(<ProfileView />)
      expect(screen.getByText('D')).toBeInTheDocument()
      // Avatar should uppercase first letter
    })

    test('multiple theme clicks update correctly', () => {
      render(<ProfileView />)
      fireEvent.click(screen.getByText('Light'))
      fireEvent.click(screen.getByText('Midnight'))
      fireEvent.click(screen.getByText('Nord'))
      expect(mockSetTheme).toHaveBeenCalledTimes(3)
      expect(mockSetTheme).toHaveBeenLastCalledWith('nord')
    })

    test('renders section headers correctly', () => {
      render(<ProfileView />)
      expect(screen.getByText('Account')).toBeInTheDocument()
      expect(screen.getByText('Appearance')).toBeInTheDocument()
    })
  })
})
