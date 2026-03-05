export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (typeof window !== 'undefined'
    ? 'https://localhost:3000'
    : 'https://localhost:3000');
