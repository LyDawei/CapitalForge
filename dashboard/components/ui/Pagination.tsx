import Link from 'next/link';

export default function Pagination({
  page,
  totalPages,
  baseHref,
}: {
  page: number;
  totalPages: number;
  baseHref: string;
}) {
  if (totalPages <= 1) return null;

  const separator = baseHref.includes('?') ? '&' : '?';

  return (
    <div className="flex items-center gap-2 mt-4">
      {page > 1 ? (
        <Link
          href={`${baseHref}${separator}page=${page - 1}`}
          className="px-3 py-1.5 text-sm bg-gray-800 text-gray-300 rounded hover:bg-gray-700 transition-colors"
        >
          Previous
        </Link>
      ) : (
        <span className="px-3 py-1.5 text-sm bg-gray-800/50 text-gray-600 rounded">Previous</span>
      )}
      <span className="text-sm text-gray-500">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link
          href={`${baseHref}${separator}page=${page + 1}`}
          className="px-3 py-1.5 text-sm bg-gray-800 text-gray-300 rounded hover:bg-gray-700 transition-colors"
        >
          Next
        </Link>
      ) : (
        <span className="px-3 py-1.5 text-sm bg-gray-800/50 text-gray-600 rounded">Next</span>
      )}
    </div>
  );
}
