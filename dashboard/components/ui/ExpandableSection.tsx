'use client';

import { useState } from 'react';

export default function ExpandableSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        {open ? '▾' : '▸'} {label}
      </button>
      {open && (
        <div className="mt-2 p-3 bg-gray-950 rounded text-xs font-mono text-gray-400 whitespace-pre-wrap max-h-64 overflow-y-auto border border-gray-800">
          {children}
        </div>
      )}
    </div>
  );
}
