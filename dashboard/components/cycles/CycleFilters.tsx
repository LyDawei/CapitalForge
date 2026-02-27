'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

export default function CycleFilters({ symbols }: { symbols: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete('page'); // Reset to page 1 on filter change
      router.push(`/cycles?${params.toString()}`);
    },
    [router, searchParams]
  );

  return (
    <div className="flex flex-wrap gap-3 mb-4">
      <div>
        <label className="text-xs text-gray-500 block mb-1">From</label>
        <input
          type="date"
          value={searchParams.get('dateFrom') || ''}
          onChange={(e) => updateFilter('dateFrom', e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-gray-500"
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">To</label>
        <input
          type="date"
          value={searchParams.get('dateTo') || ''}
          onChange={(e) => updateFilter('dateTo', e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-gray-500"
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">Symbol</label>
        <select
          value={searchParams.get('symbol') || ''}
          onChange={(e) => updateFilter('symbol', e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-gray-500"
        >
          <option value="">All</option>
          {symbols.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">Decision</label>
        <select
          value={searchParams.get('decision') || ''}
          onChange={(e) => updateFilter('decision', e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-gray-500"
        >
          <option value="">All</option>
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
          <option value="HOLD">HOLD</option>
        </select>
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">Status</label>
        <select
          value={searchParams.get('status') || ''}
          onChange={(e) => updateFilter('status', e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-gray-500"
        >
          <option value="">All</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
      </div>
    </div>
  );
}
