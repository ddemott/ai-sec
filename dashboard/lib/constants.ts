/**
 * Shared constants and lookups for the dashboard
 */

export const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
];

export const US_TIMEZONES = [
  { label: '(UTC-5) Eastern Time - New York, Miami, Atlanta', value: 'America/New_York' },
  { label: '(UTC-6) Central Time - Chicago, Houston, Dallas', value: 'America/Chicago' },
  { label: '(UTC-7) Mountain Time - Denver, Salt Lake City', value: 'America/Denver' },
  { label: '(UTC-7) Mountain Time (No DST) - Phoenix, Tucson', value: 'America/Phoenix' },
  { label: '(UTC-8) Pacific Time - Los Angeles, San Francisco, Seattle', value: 'America/Los_Angeles' },
  { label: '(UTC-9) Alaska Time - Anchorage, Fairbanks', value: 'America/Anchorage' },
  { label: '(UTC-10) Hawaii Time - Honolulu, Maui', value: 'Pacific/Honolulu' },
];

export const CITY_TIMEZONE_MAP: Record<string, string> = {
  'chicago': 'America/Chicago',
  'new york': 'America/New_York',
  'los angeles': 'America/Los_Angeles',
  'denver': 'America/Denver',
  'phoenix': 'America/Phoenix',
  'houston': 'America/Chicago',
  'miami': 'America/New_York',
  'seattle': 'America/Los_Angeles',
  'atlanta': 'America/New_York',
  'dallas': 'America/Chicago'
};

export const STATE_TIMEZONE_MAP: Record<string, string> = {
  'NY': 'America/New_York',
  'CA': 'America/Los_Angeles',
  'IL': 'America/Chicago',
  'FL': 'America/New_York',
  'TX': 'America/Chicago',
  'GA': 'America/New_York',
  'WA': 'America/Los_Angeles',
  'CO': 'America/Denver',
  'AZ': 'America/Phoenix'
};

/**
 * Simple helper to detect timezone from city/state
 */
export function detectTimezone(city: string, state: string): string | null {
  const cityLower = city.toLowerCase().trim();
  if (CITY_TIMEZONE_MAP[cityLower]) return CITY_TIMEZONE_MAP[cityLower];
  if (STATE_TIMEZONE_MAP[state]) return STATE_TIMEZONE_MAP[state];
  return null;
}
