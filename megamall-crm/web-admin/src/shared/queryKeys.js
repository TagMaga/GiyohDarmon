/**
 * Centralised TanStack Query key registry.
 * Import KEYS everywhere — never inline query keys as plain arrays.
 */
export const KEYS = {
  dispatcher: {
    board:       ['dispatcher', 'board'],
    newOrders:   ['dispatcher', 'newOrders'],
    couriers:    ['dispatcher', 'couriers'],
    handovers:   ['dispatcher', 'handovers'],
    cashSettlement: (params) => ['dispatcher', 'cashSettlement', params ?? {}],
    cashTransactions: (params) => ['dispatcher', 'cashTransactions', params ?? {}],
    orderHistory: (params) => ['dispatcher', 'orderHistory', params ?? {}],
    comments:    (orderId) => ['dispatcher', 'comments', orderId],
    issues:      ['dispatcher', 'issues'],
    returns:     ['dispatcher', 'returns'],
    delivered:   ['dispatcher', 'delivered'],
    orderDetail: (id) => ['dispatcher', 'order', id],
    timeline:    (id) => ['dispatcher', 'timeline', id],
    prepayments: (id) => ['dispatcher', 'prepayments', id],
    sellers:     ['dispatcher', 'sellers'],
  },
  seller: {
    orders:        ['seller', 'orders'],
    customers:     ['seller', 'customers'],
    products:      ['seller', 'products'],
    inventory:     (productId) => ['seller', 'inventory', productId],
    me:            ['seller', 'me'],
    compensation:  ['seller', 'compensation'],
    teamRank:      ['seller', 'teamRank'],
    myTeam:        ['seller', 'myTeam'],
    payouts:       ['seller', 'payouts'],
    orderComments: (orderId) => ['seller', 'order', orderId, 'comments'],
    cities:        ['seller', 'cities'],
  },
  customers: {
    list:  ['customers', 'list'],
    byId:  (customerId) => ['customers', 'byId', customerId],
  },
  users: {
    couriers: ['users', 'couriers'],
  },
  hr: {
    tariffActive: ['hr', 'tariffs', 'active'],
    tariffs:      ['hr', 'tariffs'],
    configs:      ['hr', 'compensation', 'configs'],
    history:      ['hr', 'compensation', 'history'],
    preview:      ['hr', 'compensation', 'preview'],
    events:       (orderId) => ['hr', 'events', orderId],
    employee:     (userId)  => ['hr', 'compensation', 'employees', userId],
    team:         (teamId)  => ['hr', 'compensation', 'teams', teamId],
    teams:        ['hr', 'teams'],
    users:        ['hr', 'users'],
    // Income reports (Phase 14)
    incomeMe:     (params)              => ['hr', 'income', 'me',    params  ?? {}],
    incomeUser:   (userId,  params)     => ['hr', 'income', 'users', userId,  params ?? {}],
    incomeTeam:   (leadId,  params)     => ['hr', 'income', 'teams', leadId,  params ?? {}],
  },
  people: {
    // Users
    employees:        (params) => ['people', 'employees', params ?? {}],
    employee:         (userId)  => ['people', 'employees', userId],
    // Teams
    teams:            (params) => ['people', 'teams', params ?? {}],
    team:             (teamId)  => ['people', 'teams', teamId],
    teamMembers:      (teamId)  => ['people', 'teams', teamId, 'members'],
    // Hierarchy
    userChain:        (userId)  => ['people', 'hierarchy', userId],
    // Compensation
    employeeConfigs:  (userId)  => ['people', 'compensation', 'employees', userId],
    teamConfigs:      (teamId)  => ['people', 'compensation', 'teams', teamId],
    globalRates:      ['people', 'compensation', 'global'],
    configs:          (params) => ['people', 'compensation', 'configs', params ?? {}],
    activeTariff:     ['people', 'tariff', 'active'],
    // Orders (performance)
    employeeOrders:   (userId, params) => ['people', 'orders', userId, params ?? {}],
    teamOrders:       (teamId, params) => ['people', 'orders', 'team', teamId, params ?? {}],
    // Fixed salary / compensation kind
    employeeSalary:        (userId) => ['people', 'compensation', 'salary', userId],
    employeeSalaryHistory: (userId) => ['people', 'compensation', 'salary', userId, 'history'],
  },
  warehouse: {
    products:   ['warehouse', 'products'],
    suppliers:  ['warehouse', 'suppliers'],
    inventory:  ['warehouse', 'inventory'],
    movements:  ['warehouse', 'movements'],
    batchesRoot: ['warehouse', 'batches'],
    batches:    (productId) => ['warehouse', 'batches', productId ?? ''],
  },
  settings: {
    delivery: ['settings', 'delivery'],
  },
  // ── Phase 15: Owner Finance Dashboard ─────────────────────────────────────
  finance: {
    summary:     (params) => ['finance', 'summary', params ?? {}],
    events:      (params) => ['finance', 'events',  params ?? {}],
    eventTotals: (params) => ['finance', 'events', 'totals', params ?? {}],
    cash:        (params) => ['finance', 'cash',     params ?? {}],
  },
  // ── Phase 16: Owner Orders Center ─────────────────────────────────────────
  orders: {
    list:   (params) => ['orders', 'list',   params ?? {}],
    detail: (id)     => ['orders', 'detail', id],
    events: (id)     => ['orders', 'events', id],
    comments: (id)   => ['orders', 'comments', id],
  },
  // ── Phase 17: Owner Logistics ─────────────────────────────────────────────
  logistics: {
    dashboard:   ['logistics', 'dashboard'],
    couriers:    ['logistics', 'couriers'],
    courier:     (id)     => ['logistics', 'couriers', id],
    courierOrders: (id, params) => ['logistics', 'couriers', id, 'orders', params ?? {}],
    performance: (id, params)   => ['logistics', 'couriers', id, 'performance', params ?? {}],
    handovers:   (params) => ['logistics', 'handovers', params ?? {}],
    handoverHistory: (id)  => ['logistics', 'handovers', 'history', id],
  },
  // ── Generalized payouts ledger (Team Lead / Manager / Seller) ─────────────
  payouts: {
    me:       ['payouts', 'me'],
    payables: (teamLeadId, params) => ['payouts', 'payables', teamLeadId, params ?? {}],
    byPayee:  (payeeId) => ['payouts', 'payee', payeeId],
  },
}
