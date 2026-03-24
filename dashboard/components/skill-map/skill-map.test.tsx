import { expect, test, describe, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import { renderHook } from '@testing-library/react'
import { useSkillMapData } from './useSkillMapData'
import SkillMapNode from './SkillMapNode'
import SkillMapColumn from './SkillMapColumn'
import SkillMapConnections from './SkillMapConnections'
import SkillRelationshipMap from './SkillRelationshipMap'
import SkillMapFixPanel from './SkillMapFixPanel'
import { Api } from '../../lib/api'

// --- Mock data ---
const mockEmployees = [
  { id: 'emp-uuid-1', name: 'Alice', type: 'employee' },
  { id: 'emp-uuid-2', name: 'Bob', type: 'employee' },
  { id: 'emp-uuid-3', name: 'Admin', type: 'user' }, // should be filtered out
]

const mockResources = [
  { id: 'res-uuid-1', name: 'Bay 1' },
  { id: 'res-uuid-2', name: 'Bay 2' },
]

const mockServices = [
  { id: 'svc-uuid-1', name: 'Oil Change', duration_minutes: 30 },
  { id: 'svc-uuid-2', name: 'Tire Rotation', duration_minutes: 45 },
  { id: 'svc-uuid-3', name: 'Brake Service', duration_minutes: 60 },
]

const mockEmpMappings = [
  { service_id: 'svc-uuid-1', employee_id: 'emp-uuid-1' }, // Alice -> Oil Change
  { service_id: 'svc-uuid-2', employee_id: 'emp-uuid-1' }, // Alice -> Tire Rotation
  { service_id: 'svc-uuid-2', employee_id: 'emp-uuid-2' }, // Bob -> Tire Rotation
]

const mockResMappings = [
  { service_id: 'svc-uuid-1', resource_id: 'res-uuid-1' }, // Oil Change -> Bay 1
  { service_id: 'svc-uuid-1', resource_id: 'res-uuid-2' }, // Oil Change -> Bay 2
  { service_id: 'svc-uuid-2', resource_id: 'res-uuid-1' }, // Tire Rotation -> Bay 1
]

// --- Mock SessionContext ---
vi.mock('../../lib/SessionContext', () => ({
  useSessionContext: () => ({
    tenantId: 'test-tenant',
    userName: 'Test',
    isAdmin: false,
    managedTenantId: 'test-tenant',
    managedTenantName: 'Test Tenant',
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    selectManagedTenant: vi.fn(),
    tenantsVersion: 0,
    notifyTenantsChanged: vi.fn(),
  }),
  useActiveTenantId: () => 'test-tenant',
  SessionProvider: ({ children }: any) => children,
}))

// --- Mock hooks ---
vi.mock('../../lib/hooks', () => ({
  useStaticData: () => ({
    employees: mockEmployees,
    resources: mockResources,
    skills: [],
    services: mockServices,
    customers: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

vi.mock('../../lib/api', () => ({
  Api: {
    mappings: {
      listServiceEmployee: vi.fn().mockResolvedValue([
        { service_id: 'svc-uuid-1', employee_id: 'emp-uuid-1' },
        { service_id: 'svc-uuid-2', employee_id: 'emp-uuid-1' },
        { service_id: 'svc-uuid-2', employee_id: 'emp-uuid-2' },
      ]),
      listServiceResource: vi.fn().mockResolvedValue([
        { service_id: 'svc-uuid-1', resource_id: 'res-uuid-1' },
        { service_id: 'svc-uuid-1', resource_id: 'res-uuid-2' },
        { service_id: 'svc-uuid-2', resource_id: 'res-uuid-1' },
      ]),
      assignServiceEmployee: vi.fn().mockResolvedValue({}),
      assignServiceResource: vi.fn().mockResolvedValue({}),
      unassignServiceEmployee: vi.fn().mockResolvedValue({}),
      unassignServiceResource: vi.fn().mockResolvedValue({}),
    },
    employees: { update: vi.fn().mockResolvedValue({}) },
    resources: { update: vi.fn().mockResolvedValue({}) },
  },
}))

// Mock ResizeObserver
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

// ==========================================
// useSkillMapData tests
// ==========================================
describe('useSkillMapData', () => {
  test('filters out user-type employees from employee nodes', async () => {
    const { result } = renderHook(() => useSkillMapData(mockEmployees, mockResources, mockServices, 'test-tenant'))
    await waitFor(() => {
      const empNames = result.current.employeeNodes.map(n => n.name)
      expect(empNames).toContain('Alice')
      expect(empNames).toContain('Bob')
      expect(empNames).not.toContain('Admin')
      expect(result.current.employeeNodes).toHaveLength(2)
    })
  })

  test('creates service nodes from services list', async () => {
    const { result } = renderHook(() => useSkillMapData(mockEmployees, mockResources, mockServices, 'test-tenant'))
    await waitFor(() => {
      expect(result.current.skillNodes).toHaveLength(3)
      const names = result.current.skillNodes.map(n => n.name)
      expect(names).toContain('Oil Change')
      expect(names).toContain('Tire Rotation')
      expect(names).toContain('Brake Service')
    })
  })

  test('creates left-side connections from service_employee mappings', async () => {
    const { result } = renderHook(() => useSkillMapData(mockEmployees, mockResources, mockServices, 'test-tenant'))
    await waitFor(() => {
      const leftConns = result.current.connections.filter(c => c.side === 'left')
      expect(leftConns).toHaveLength(3) // Alice->Oil, Alice->Tire, Bob->Tire
    })
  })

  test('creates right-side connections from service_resource mappings', async () => {
    const { result } = renderHook(() => useSkillMapData(mockEmployees, mockResources, mockServices, 'test-tenant'))
    await waitFor(() => {
      const rightConns = result.current.connections.filter(c => c.side === 'right')
      expect(rightConns).toHaveLength(3) // Oil->Bay1, Oil->Bay2, Tire->Bay1
    })
  })

  test('computes full coverage for services with both employee and resource connections', async () => {
    const { result } = renderHook(() => useSkillMapData(mockEmployees, mockResources, mockServices, 'test-tenant'))
    await waitFor(() => {
      expect(result.current.coverageBySkill['skill-svc-uuid-1']).toBe('full') // Oil Change
      expect(result.current.coverageBySkill['skill-svc-uuid-2']).toBe('full') // Tire Rotation
    })
  })

  test('computes uncovered for services with no connections', async () => {
    const { result } = renderHook(() => useSkillMapData(mockEmployees, mockResources, mockServices, 'test-tenant'))
    await waitFor(() => {
      expect(result.current.coverageBySkill['skill-svc-uuid-3']).toBe('uncovered') // Brake Service
    })
  })

  test('detects broken chains for uncovered services', async () => {
    const { result } = renderHook(() => useSkillMapData(mockEmployees, mockResources, mockServices, 'test-tenant'))
    await waitFor(() => {
      expect(result.current.brokenChains.some(b => b.skillName === 'Brake Service')).toBe(true)
      expect(result.current.brokenChains.some(b => b.skillName === 'Oil Change')).toBe(false)
    })
  })

  test('selection highlights connected nodes transitively', async () => {
    const { result } = renderHook(() => useSkillMapData(mockEmployees, mockResources, mockServices, 'test-tenant'))

    await waitFor(() => {
      expect(result.current.connections.length).toBeGreaterThan(0)
    })

    act(() => { result.current.selectNode('emp-emp-uuid-1') })

    // Alice is connected to Oil Change and Tire Rotation
    expect(result.current.highlightedNodeIds.has('emp-emp-uuid-1')).toBe(true)
    expect(result.current.highlightedNodeIds.has('skill-svc-uuid-1')).toBe(true) // Oil Change
    expect(result.current.highlightedNodeIds.has('skill-svc-uuid-2')).toBe(true) // Tire Rotation
    // Bay 1 connected to both Oil Change and Tire Rotation
    expect(result.current.highlightedNodeIds.has('res-res-uuid-1')).toBe(true)
    // Bob not highlighted
    expect(result.current.highlightedNodeIds.has('emp-emp-uuid-2')).toBe(false)
  })
})

// ==========================================
// SkillMapNode tests
// ==========================================
describe('SkillMapNode', () => {
  const baseNode = { id: 'emp-1', type: 'employee' as const, name: 'Alice', rawId: 1 }

  test('renders employee node with name', () => {
    render(
      <SkillMapNode node={baseNode} isHighlighted={true} isSelected={false} isBroken={false} onClick={vi.fn()} />
    )
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  test('renders service node with coverage badge', () => {
    const svcNode = { id: 'skill-svc1', type: 'skill' as const, name: 'Oil Change', rawId: 'svc1', coverage: 'full' as const }
    render(
      <SkillMapNode node={svcNode} isHighlighted={true} isSelected={false} isBroken={false} onClick={vi.fn()} />
    )
    expect(screen.getByText('Full Coverage')).toBeInTheDocument()
  })

  test('renders resource node', () => {
    const resNode = { id: 'res-1', type: 'resource' as const, name: 'Bay 1', rawId: '1' }
    render(
      <SkillMapNode node={resNode} isHighlighted={true} isSelected={false} isBroken={false} onClick={vi.fn()} />
    )
    expect(screen.getByText('Bay 1')).toBeInTheDocument()
  })

  test('shows Fix button on broken service node', () => {
    const brokenSvc = { id: 'skill-x', type: 'skill' as const, name: 'Brake Service', rawId: 'x', coverage: 'uncovered' as const }
    const onFix = vi.fn()
    render(
      <SkillMapNode node={brokenSvc} isHighlighted={true} isSelected={false} isBroken={true} onClick={vi.fn()} onFixClick={onFix} />
    )
    expect(screen.getByTestId('fix-skill-x')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('fix-skill-x'))
    expect(onFix).toHaveBeenCalled()
  })
})

// ==========================================
// SkillMapColumn tests
// ==========================================
describe('SkillMapColumn', () => {
  const MockIcon = () => <svg data-testid="mock-icon" />

  test('renders header with title, icon, and count', () => {
    render(
      <SkillMapColumn title="Employees" icon={MockIcon} iconColor="bg-green-100 text-green-600" count={5}>
        <div>Child content</div>
      </SkillMapColumn>
    )
    expect(screen.getByText('Employees')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  test('renders children', () => {
    render(
      <SkillMapColumn title="Test" icon={MockIcon} iconColor="" count={0}>
        <div data-testid="child-1">One</div>
        <div data-testid="child-2">Two</div>
      </SkillMapColumn>
    )
    expect(screen.getByTestId('child-1')).toBeInTheDocument()
    expect(screen.getByTestId('child-2')).toBeInTheDocument()
  })
})

// ==========================================
// SkillMapConnections tests
// ==========================================
describe('SkillMapConnections', () => {
  test('renders SVG element', () => {
    const containerRef = { current: document.createElement('div') }
    render(
      <SkillMapConnections
        connections={[]}
        highlightedConnectionIds={new Set()}
        hasSelection={false}
        containerRef={containerRef}
      />
    )
    expect(screen.getByTestId('skill-map-svg')).toBeInTheDocument()
  })
})

// ==========================================
// SkillRelationshipMap integration test
// ==========================================
describe('SkillRelationshipMap', () => {
  test('renders 3 columns', async () => {
    render(<SkillRelationshipMap />)
    await waitFor(() => {
      expect(screen.getByText('Employees')).toBeInTheDocument()
      expect(screen.getByText('Services')).toBeInTheDocument()
      expect(screen.getByText('Resources')).toBeInTheDocument()
    })
  })

  test('renders employee and resource names', async () => {
    render(<SkillRelationshipMap />)
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Bob')).toBeInTheDocument()
      expect(screen.getByText('Bay 1')).toBeInTheDocument()
      expect(screen.getByText('Bay 2')).toBeInTheDocument()
    })
  })

  test('renders service names from services list', async () => {
    render(<SkillRelationshipMap />)
    await waitFor(() => {
      expect(screen.getByText('Oil Change')).toBeInTheDocument()
      expect(screen.getByText('Tire Rotation')).toBeInTheDocument()
      expect(screen.getByText('Brake Service')).toBeInTheDocument()
    })
  })
})

// ==========================================
// completeLinking tests (assign via map click)
// ==========================================
describe('completeLinking', () => {
  beforeEach(() => { vi.clearAllMocks() })

  test('assigns employee to service via mapping API', async () => {
    const onChanged = vi.fn()
    const { result } = renderHook(() =>
      useSkillMapData(mockEmployees, mockResources, mockServices, 'test-tenant', onChanged)
    )

    // Wait for mappings to load
    await waitFor(() => {
      expect(result.current.skillNodes.length).toBe(3)
    })

    // Start linking from Bob
    act(() => { result.current.startLinking('emp-emp-uuid-2', 'employee') })
    expect(result.current.linking).not.toBeNull()
    expect(result.current.linking!.fromNodeId).toBe('emp-emp-uuid-2')

    // Valid targets should include all services
    expect(result.current.validLinkTargets.has('skill-svc-uuid-1')).toBe(true)
    expect(result.current.validLinkTargets.has('skill-svc-uuid-3')).toBe(true)

    // Complete link to Oil Change (Bob is not yet assigned to Oil Change)
    await act(async () => {
      await result.current.completeLinking('skill-svc-uuid-1')
    })

    expect(Api.mappings.assignServiceEmployee).toHaveBeenCalledWith('svc-uuid-1', 'emp-uuid-2', 'test-tenant')
    expect(result.current.linking).toBeNull()
  })

  test('assigns resource to service via mapping API', async () => {
    const onChanged = vi.fn()
    const { result } = renderHook(() =>
      useSkillMapData(mockEmployees, mockResources, mockServices, 'test-tenant', onChanged)
    )

    await waitFor(() => {
      expect(result.current.skillNodes.length).toBe(3)
    })

    // Start linking from Bay 2
    act(() => { result.current.startLinking('res-res-uuid-2', 'resource') })

    // Complete link to Tire Rotation (Bay 2 not yet assigned to Tire Rotation)
    await act(async () => {
      await result.current.completeLinking('skill-svc-uuid-2')
    })

    expect(Api.mappings.assignServiceResource).toHaveBeenCalledWith('svc-uuid-2', 'res-uuid-2', 'test-tenant')
  })

  test('does not duplicate existing assignment', async () => {
    const { result } = renderHook(() =>
      useSkillMapData(mockEmployees, mockResources, mockServices, 'test-tenant')
    )

    await waitFor(() => {
      expect(result.current.connections.length).toBeGreaterThan(0)
    })

    // Alice is already assigned to Oil Change — linking should skip the API call
    act(() => { result.current.startLinking('emp-emp-uuid-1', 'employee') })
    await act(async () => {
      await result.current.completeLinking('skill-svc-uuid-1')
    })

    // assignServiceEmployee should NOT be called because mapping already exists
    expect(Api.mappings.assignServiceEmployee).not.toHaveBeenCalled()
  })

  test('cancelling linking clears state', async () => {
    const { result } = renderHook(() =>
      useSkillMapData(mockEmployees, mockResources, mockServices, 'test-tenant')
    )

    await waitFor(() => {
      expect(result.current.skillNodes.length).toBe(3)
    })

    act(() => { result.current.startLinking('emp-emp-uuid-1', 'employee') })
    expect(result.current.linking).not.toBeNull()

    act(() => { result.current.cancelLinking() })
    expect(result.current.linking).toBeNull()
  })

  test('linking from service shows employees and resources as valid targets', async () => {
    const { result } = renderHook(() =>
      useSkillMapData(mockEmployees, mockResources, mockServices, 'test-tenant')
    )

    await waitFor(() => {
      expect(result.current.skillNodes.length).toBe(3)
    })

    // Start linking from Brake Service (a service node)
    act(() => { result.current.startLinking('skill-svc-uuid-3', 'skill') })

    // All employees and resources should be valid targets
    expect(result.current.validLinkTargets.has('emp-emp-uuid-1')).toBe(true)
    expect(result.current.validLinkTargets.has('emp-emp-uuid-2')).toBe(true)
    expect(result.current.validLinkTargets.has('res-res-uuid-1')).toBe(true)
    expect(result.current.validLinkTargets.has('res-res-uuid-2')).toBe(true)
  })
})

// ==========================================
// disconnectConnection tests
// ==========================================
describe('disconnectConnection', () => {
  beforeEach(() => { vi.clearAllMocks() })

  test('unassigns employee from service via mapping API', async () => {
    const onChanged = vi.fn()
    const { result } = renderHook(() =>
      useSkillMapData(mockEmployees, mockResources, mockServices, 'test-tenant', onChanged)
    )

    await waitFor(() => {
      expect(result.current.connections.length).toBeGreaterThan(0)
    })

    // Find connection: Alice -> Oil Change
    const conn = result.current.connections.find(
      c => c.side === 'left' && c.from === 'emp-emp-uuid-1' && c.to === 'skill-svc-uuid-1'
    )
    expect(conn).toBeDefined()

    await act(async () => {
      await result.current.disconnectConnection(conn!.id)
    })

    expect(Api.mappings.unassignServiceEmployee).toHaveBeenCalledWith('svc-uuid-1', 'emp-uuid-1', 'test-tenant')
  })

  test('unassigns resource from service via mapping API', async () => {
    const onChanged = vi.fn()
    const { result } = renderHook(() =>
      useSkillMapData(mockEmployees, mockResources, mockServices, 'test-tenant', onChanged)
    )

    await waitFor(() => {
      expect(result.current.connections.length).toBeGreaterThan(0)
    })

    // Find connection: Oil Change -> Bay 1
    const conn = result.current.connections.find(
      c => c.side === 'right' && c.from === 'skill-svc-uuid-1' && c.to === 'res-res-uuid-1'
    )
    expect(conn).toBeDefined()

    await act(async () => {
      await result.current.disconnectConnection(conn!.id)
    })

    expect(Api.mappings.unassignServiceResource).toHaveBeenCalledWith('svc-uuid-1', 'res-uuid-1', 'test-tenant')
  })
})

// ==========================================
// SkillMapFixPanel tests
// ==========================================
describe('SkillMapFixPanel', () => {
  const brokenChain = {
    skillId: 'skill-svc-uuid-3',
    skillName: 'Brake Service',
    missingEmployees: true,
    missingResources: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('shows eligible employees and resources for assignment', () => {
    // SkillMapFixPanel imported at top of file
    render(
      <SkillMapFixPanel
        chain={brokenChain}
        employees={mockEmployees}
        resources={mockResources}
        tenantId="test-tenant"
        empMappings={mockEmpMappings}
        resMappings={mockResMappings}
        onFixed={vi.fn()}
        onClose={vi.fn()}
      />
    )
    // All non-user employees should be eligible (none are assigned to Brake Service)
    expect(screen.getByText('+ Alice')).toBeInTheDocument()
    expect(screen.getByText('+ Bob')).toBeInTheDocument()
    // All resources should be eligible
    expect(screen.getByText('+ Bay 1')).toBeInTheDocument()
    expect(screen.getByText('+ Bay 2')).toBeInTheDocument()
  })

  test('calls mapping API when assigning employee to service', async () => {
    // SkillMapFixPanel imported at top of file
    const onFixed = vi.fn()
    render(
      <SkillMapFixPanel
        chain={brokenChain}
        employees={mockEmployees}
        resources={mockResources}
        tenantId="test-tenant"
        empMappings={mockEmpMappings}
        resMappings={mockResMappings}
        onFixed={onFixed}
        onClose={vi.fn()}
      />
    )
    await act(async () => {
      fireEvent.click(screen.getByText('+ Alice'))
    })
    expect(Api.mappings.assignServiceEmployee).toHaveBeenCalledWith('svc-uuid-3', 'emp-uuid-1', 'test-tenant')
    expect(onFixed).toHaveBeenCalled()
  })

  test('calls mapping API when assigning resource to service', async () => {
    // SkillMapFixPanel imported at top of file
    const onFixed = vi.fn()
    render(
      <SkillMapFixPanel
        chain={brokenChain}
        employees={mockEmployees}
        resources={mockResources}
        tenantId="test-tenant"
        empMappings={mockEmpMappings}
        resMappings={mockResMappings}
        onFixed={onFixed}
        onClose={vi.fn()}
      />
    )
    await act(async () => {
      fireEvent.click(screen.getByText('+ Bay 1'))
    })
    expect(Api.mappings.assignServiceResource).toHaveBeenCalledWith('svc-uuid-3', 'res-uuid-1', 'test-tenant')
    expect(onFixed).toHaveBeenCalled()
  })

  test('excludes already-assigned employees from eligible list', () => {
    // SkillMapFixPanel imported at top of file
    // Alice is already assigned to svc-uuid-1 (Oil Change)
    const chainForOilChange = {
      skillId: 'skill-svc-uuid-1',
      skillName: 'Oil Change',
      missingEmployees: true,
      missingResources: false,
    }
    render(
      <SkillMapFixPanel
        chain={chainForOilChange}
        employees={mockEmployees}
        resources={mockResources}
        tenantId="test-tenant"
        empMappings={mockEmpMappings}
        resMappings={mockResMappings}
        onFixed={vi.fn()}
        onClose={vi.fn()}
      />
    )
    // Alice IS assigned to Oil Change already — should NOT appear
    expect(screen.queryByText('+ Alice')).not.toBeInTheDocument()
    // Bob is NOT assigned to Oil Change — should appear
    expect(screen.getByText('+ Bob')).toBeInTheDocument()
  })
})
