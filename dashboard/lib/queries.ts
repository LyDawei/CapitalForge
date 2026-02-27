import { prisma } from './prisma';

export async function getLatestPortfolioState() {
  return prisma.sandboxState.findFirst({
    orderBy: { createdAt: 'desc' },
  });
}

export async function getRecentCycles(limit = 10) {
  return prisma.dailyCycle.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      decision: true,
      trade: true,
      evaluations: true,
    },
  });
}

export async function getCycles(filters: {
  dateFrom?: string;
  dateTo?: string;
  symbol?: string;
  decision?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  const where: Record<string, unknown> = {};

  if (filters.dateFrom || filters.dateTo) {
    const dateFilter: Record<string, string> = {};
    if (filters.dateFrom) dateFilter.gte = filters.dateFrom;
    if (filters.dateTo) dateFilter.lte = filters.dateTo;
    where.date = dateFilter;
  }
  if (filters.symbol) where.symbol = filters.symbol;
  if (filters.status) where.status = filters.status;
  if (filters.decision) {
    where.decision = { decision: filters.decision };
  }

  const pageSize = filters.pageSize || 25;
  const page = filters.page || 1;

  const [cycles, total] = await Promise.all([
    prisma.dailyCycle.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        decision: true,
        trade: true,
      },
    }),
    prisma.dailyCycle.count({ where }),
  ]);

  return { cycles, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function getCycleDetail(id: string) {
  return prisma.dailyCycle.findUnique({
    where: { id },
    include: {
      evaluations: {
        orderBy: { agentName: 'asc' },
      },
      decision: true,
      trade: true,
    },
  });
}

export async function getEquityCurve() {
  const snapshots = await prisma.sandboxState.findMany({
    orderBy: [{ date: 'asc' }, { createdAt: 'desc' }],
    select: {
      date: true,
      currentEquity: true,
      cashBalance: true,
      drawdownPct: true,
      positionSymbol: true,
      positionQty: true,
      peakEquity: true,
    },
  });

  // Deduplicate to latest snapshot per date
  const byDate = new Map<string, typeof snapshots[0]>();
  for (const s of snapshots) {
    byDate.set(s.date, s);
  }
  return Array.from(byDate.values());
}

export async function getDistinctSymbols() {
  const result = await prisma.dailyCycle.findMany({
    distinct: ['symbol'],
    select: { symbol: true },
    orderBy: { symbol: 'asc' },
  });
  return result.map((r) => r.symbol);
}

export async function getSandboxHistory() {
  const snapshots = await prisma.sandboxState.findMany({
    orderBy: [{ date: 'asc' }, { createdAt: 'desc' }],
  });

  // Deduplicate to latest snapshot per date
  const byDate = new Map<string, typeof snapshots[0]>();
  for (const s of snapshots) {
    byDate.set(s.date, s);
  }
  return Array.from(byDate.values());
}
