/**
 * BusinessTypePicker Tests
 * Tests template loading, search, category expansion, and selection.
 * Each section has happy + sad paths with 5W diagnostic context.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// Mock API
const mockTemplatesList = vi.fn();

vi.mock('../../lib/api', () => ({
  Api: {
    templates: {
      list: () => mockTemplatesList(),
    },
  },
}));

import { BusinessTypePicker } from './BusinessTypePicker';

const mockTemplates = [
  { business_type: 'salon', display_name: 'Hair Salon', category: 'Beauty & Wellness' },
  { business_type: 'barbershop', display_name: 'Barbershop', category: 'Beauty & Wellness' },
  { business_type: 'spa', display_name: 'Day Spa', category: 'Beauty & Wellness' },
  { business_type: 'tire-shop', display_name: 'Tire Shop', category: 'Automotive' },
  { business_type: 'auto-repair', display_name: 'Auto Repair', category: 'Automotive' },
  { business_type: 'plumber', display_name: 'Plumbing Service', category: 'Trades' },
  { business_type: 'electrician', display_name: 'Electrician', category: 'Trades' },
  { business_type: 'fitness', display_name: 'Fitness Studio', category: 'Fitness' },
];

describe('BusinessTypePicker', () => {
  const mockOnSelect = vi.fn();
  const mockOnClose = vi.fn();
  const mockOnBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockTemplatesList.mockResolvedValue(mockTemplates);
  });

  describe('Happy Paths', () => {
    test('renders modal with header and search', async () => {
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      expect(screen.getByText('What kind of business?')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Search business types...')).toBeInTheDocument();
      // WHO: new tenant setup | WHAT: business type picker modal
      // WHEN: creating tenant | WHERE: SetupWizard
      // WHY: users need to select their business type
    });

    test('loads and displays template categories', async () => {
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      await waitFor(() => {
        expect(screen.getByText('Automotive')).toBeInTheDocument();
        expect(screen.getByText('Beauty & Wellness')).toBeInTheDocument();
        expect(screen.getByText('Fitness')).toBeInTheDocument();
        expect(screen.getByText('Trades')).toBeInTheDocument();
      });
      // WHO: users | WHAT: category display
      // WHEN: templates loaded | WHERE: picker list
      // WHY: organized by category for easy discovery
    });

    test('shows template count per category', async () => {
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      await waitFor(() => {
        // Beauty & Wellness has 3 items
        const beautyCategory = screen.getByText('Beauty & Wellness');
        const countBadge = beautyCategory.parentElement?.querySelector('.text-xs');
        expect(countBadge?.textContent).toBe('3');
      });
      // WHO: users | WHAT: category counts
      // WHEN: viewing categories | WHERE: category headers
      // WHY: helps users know what's inside
    });

    test('expands category on click to show templates', async () => {
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      await waitFor(() => {
        expect(screen.getByText('Beauty & Wellness')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Beauty & Wellness'));

      expect(screen.getByText('Hair Salon')).toBeInTheDocument();
      expect(screen.getByText('Barbershop')).toBeInTheDocument();
      expect(screen.getByText('Day Spa')).toBeInTheDocument();
      // WHO: users browsing | WHAT: category expansion
      // WHEN: clicking category | WHERE: category row
      // WHY: progressive disclosure of options
    });

    test('collapses category on second click', async () => {
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      await waitFor(() => {
        expect(screen.getByText('Beauty & Wellness')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Beauty & Wellness'));
      expect(screen.getByText('Hair Salon')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Beauty & Wellness'));
      expect(screen.queryByText('Hair Salon')).not.toBeInTheDocument();
      // WHO: users | WHAT: category collapse
      // WHEN: clicking expanded category | WHERE: category row
      // WHY: toggle behavior for clean UI
    });

    test('calls onSelect with business_type when template is clicked', async () => {
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      await waitFor(() => {
        expect(screen.getByText('Beauty & Wellness')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Beauty & Wellness'));
      fireEvent.click(screen.getByText('Hair Salon'));

      expect(mockOnSelect).toHaveBeenCalledWith('salon');
      // WHO: user selecting | WHAT: template selection callback
      // WHEN: clicking template | WHERE: expanded category
      // WHY: pass selected business type back to wizard
    });

    test('calls onClose when X button is clicked', async () => {
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      fireEvent.click(screen.getByRole('button', { name: '' })); // X button has no text
      expect(mockOnClose).toHaveBeenCalled();
      // WHO: user cancelling | WHAT: close modal
      // WHEN: clicking X | WHERE: header
      // WHY: allow escape from picker
    });

    test('calls onBack when Back button is clicked', async () => {
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      fireEvent.click(screen.getByText('← Back'));
      expect(mockOnBack).toHaveBeenCalled();
      // WHO: user navigating | WHAT: back navigation
      // WHEN: clicking back | WHERE: footer
      // WHY: return to previous step
    });

    test('search filters templates by display_name', async () => {
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      await waitFor(() => {
        expect(screen.getByText('Beauty & Wellness')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText('Search business types...'), {
        target: { value: 'salon' },
      });

      // Should show Beauty & Wellness category with Hair Salon
      expect(screen.getByText('Beauty & Wellness')).toBeInTheDocument();
      expect(screen.getByText('Hair Salon')).toBeInTheDocument();
      // Automotive and others should be hidden
      expect(screen.queryByText('Automotive')).not.toBeInTheDocument();
      // WHO: users searching | WHAT: search filtering
      // WHEN: typing in search | WHERE: search input
      // WHY: quickly find specific business type
    });

    test('search filters templates by category', async () => {
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      await waitFor(() => {
        expect(screen.getByText('Automotive')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText('Search business types...'), {
        target: { value: 'auto' },
      });

      expect(screen.getByText('Automotive')).toBeInTheDocument();
      expect(screen.getByText('Tire Shop')).toBeInTheDocument();
      expect(screen.getByText('Auto Repair')).toBeInTheDocument();
      // WHO: users | WHAT: category-based search
      // WHEN: typing category name | WHERE: search input
      // WHY: alternative way to find relevant types
    });

    test('search auto-expands all matching categories', async () => {
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      await waitFor(() => {
        expect(screen.getByText('Beauty & Wellness')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText('Search business types...'), {
        target: { value: 'shop' },
      });

      // Should show both Barbershop and Tire Shop, both expanded
      expect(screen.getByText('Barbershop')).toBeInTheDocument();
      expect(screen.getByText('Tire Shop')).toBeInTheDocument();
      // WHO: users | WHAT: auto-expand on search
      // WHEN: searching | WHERE: template list
      // WHY: show results without manual expansion
    });
  });

  describe('Sad Paths', () => {
    test('shows loading state initially', async () => {
      mockTemplatesList.mockImplementation(() => new Promise(() => {})); // Never resolves
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      expect(screen.getByText('Loading...')).toBeInTheDocument();
      // WHO: users | WHAT: loading indicator
      // WHEN: fetching templates | WHERE: template list area
      // WHY: feedback while API call in progress
    });

    test('handles API error gracefully', async () => {
      mockTemplatesList.mockRejectedValue(new Error('Network error'));
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });
      // Should not crash, just show empty state
      // WHO: users | WHAT: error handling
      // WHEN: API fails | WHERE: template list
      // WHY: graceful degradation on network issues
    });

    test('shows no results message when search has no matches', async () => {
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      await waitFor(() => {
        expect(screen.getByText('Beauty & Wellness')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText('Search business types...'), {
        target: { value: 'xyznonexistent' },
      });

      expect(screen.getByText('No matching business types found.')).toBeInTheDocument();
      // WHO: users | WHAT: no results message
      // WHEN: search has no matches | WHERE: template list
      // WHY: clear feedback that search found nothing
    });

    test('handles empty template list from API', async () => {
      mockTemplatesList.mockResolvedValue([]);
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });
      // Should show no categories
      expect(screen.queryByText('Beauty & Wellness')).not.toBeInTheDocument();
      // WHO: users | WHAT: empty state
      // WHEN: no templates configured | WHERE: template list
      // WHY: handle edge case of empty database
    });

    test('handles non-array API response', async () => {
      mockTemplatesList.mockResolvedValue({ error: 'something wrong' });
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });
      // Should not crash
      // WHO: users | WHAT: malformed response handling
      // WHEN: API returns wrong format | WHERE: template parsing
      // WHY: defensive coding against API errors
    });
  });

  describe('Edge Cases', () => {
    test('sorts categories alphabetically', async () => {
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      await waitFor(() => {
        expect(screen.getByText('Beauty & Wellness')).toBeInTheDocument();
      });

      const buttons = screen.getAllByRole('button');
      const categoryButtons = buttons.filter(
        (btn) =>
          btn.textContent?.includes('Beauty') ||
          btn.textContent?.includes('Automotive') ||
          btn.textContent?.includes('Fitness') ||
          btn.textContent?.includes('Trades')
      );

      // Categories should be in alphabetical order
      expect(categoryButtons[0].textContent).toContain('Automotive');
      expect(categoryButtons[1].textContent).toContain('Beauty');
      expect(categoryButtons[2].textContent).toContain('Fitness');
      expect(categoryButtons[3].textContent).toContain('Trades');
    });

    test('handles template without category (defaults to Other)', async () => {
      mockTemplatesList.mockResolvedValue([
        { business_type: 'generic', display_name: 'Generic Business', category: '' },
      ]);
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      await waitFor(() => {
        expect(screen.getByText('Other')).toBeInTheDocument();
      });
    });

    test('search is case-insensitive', async () => {
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      await waitFor(() => {
        expect(screen.getByText('Beauty & Wellness')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText('Search business types...'), {
        target: { value: 'SALON' },
      });

      expect(screen.getByText('Hair Salon')).toBeInTheDocument();
    });

    test('clearing search restores all categories collapsed', async () => {
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      await waitFor(() => {
        expect(screen.getByText('Beauty & Wellness')).toBeInTheDocument();
      });

      // Search to expand
      fireEvent.change(screen.getByPlaceholderText('Search business types...'), {
        target: { value: 'salon' },
      });
      expect(screen.getByText('Hair Salon')).toBeInTheDocument();

      // Clear search
      fireEvent.change(screen.getByPlaceholderText('Search business types...'), {
        target: { value: '' },
      });

      // Templates should be hidden again (categories collapsed)
      expect(screen.queryByText('Hair Salon')).not.toBeInTheDocument();
    });

    test('prevents modal click propagation', async () => {
      const outerClick = vi.fn();
      render(
        <div onClick={outerClick}>
          <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
        </div>
      );

      // Click inside modal content
      const modal = screen.getByText('What kind of business?').closest('div');
      if (modal) fireEvent.click(modal);

      // outerClick should not be triggered (stopPropagation)
      expect(outerClick).not.toHaveBeenCalled();
    });

    test('search input has autofocus', async () => {
      render(
        <BusinessTypePicker onSelect={mockOnSelect} onClose={mockOnClose} onBack={mockOnBack} />
      );
      const searchInput = screen.getByPlaceholderText('Search business types...');
      // React autoFocus prop renders as autofocus in the DOM
      expect(searchInput).toHaveFocus();
    });
  });
});
