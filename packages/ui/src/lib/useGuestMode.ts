import { useSearchParams } from 'react-router-dom';

export function useGuestMode(): boolean {
  const [searchParams] = useSearchParams();
  return searchParams.get('guest') === 'true';
}
