/**
 * Shared constants and lookups for the dashboard
 */

// Day names
export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
export const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

// Default shift times
export const DEFAULT_SHIFT_START = '08:00';
export const DEFAULT_SHIFT_END = '17:00';

// Pagination
export const DEFAULT_PAGE_SIZE = 50;

export const US_STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
];

export const US_TIMEZONES = [
  { label: '(UTC-5) Eastern Time - New York, Miami, Atlanta', value: 'America/New_York' },
  { label: '(UTC-6) Central Time - Chicago, Houston, Dallas', value: 'America/Chicago' },
  { label: '(UTC-7) Mountain Time - Denver, Salt Lake City', value: 'America/Denver' },
  { label: '(UTC-7) Mountain Time (No DST) - Phoenix, Tucson', value: 'America/Phoenix' },
  {
    label: '(UTC-8) Pacific Time - Los Angeles, San Francisco, Seattle',
    value: 'America/Los_Angeles',
  },
  { label: '(UTC-9) Alaska Time - Anchorage, Fairbanks', value: 'America/Anchorage' },
  { label: '(UTC-10) Hawaii Time - Honolulu, Maui', value: 'Pacific/Honolulu' },
];

export const CITY_TIMEZONE_MAP: Record<string, string> = {
  // Eastern
  'new york': 'America/New_York',
  miami: 'America/New_York',
  atlanta: 'America/New_York',
  boston: 'America/New_York',
  philadelphia: 'America/New_York',
  washington: 'America/New_York',
  charlotte: 'America/New_York',
  jacksonville: 'America/New_York',
  columbus: 'America/New_York',
  indianapolis: 'America/New_York',
  detroit: 'America/New_York',
  nashville: 'America/Chicago',
  pittsburgh: 'America/New_York',
  raleigh: 'America/New_York',
  tampa: 'America/New_York',
  orlando: 'America/New_York',
  richmond: 'America/New_York',
  baltimore: 'America/New_York',
  cleveland: 'America/New_York',
  cincinnati: 'America/New_York',
  // Central
  chicago: 'America/Chicago',
  houston: 'America/Chicago',
  dallas: 'America/Chicago',
  'san antonio': 'America/Chicago',
  austin: 'America/Chicago',
  'fort worth': 'America/Chicago',
  memphis: 'America/Chicago',
  milwaukee: 'America/Chicago',
  'kansas city': 'America/Chicago',
  'new orleans': 'America/Chicago',
  minneapolis: 'America/Chicago',
  'st louis': 'America/Chicago',
  'oklahoma city': 'America/Chicago',
  omaha: 'America/Chicago',
  'des moines': 'America/Chicago',
  'little rock': 'America/Chicago',
  // Mountain
  denver: 'America/Denver',
  'salt lake city': 'America/Denver',
  albuquerque: 'America/Denver',
  'el paso': 'America/Denver',
  boise: 'America/Denver',
  'colorado springs': 'America/Denver',
  // Mountain (no DST)
  phoenix: 'America/Phoenix',
  tucson: 'America/Phoenix',
  mesa: 'America/Phoenix',
  scottsdale: 'America/Phoenix',
  // Pacific
  'los angeles': 'America/Los_Angeles',
  seattle: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  'san diego': 'America/Los_Angeles',
  portland: 'America/Los_Angeles',
  sacramento: 'America/Los_Angeles',
  'las vegas': 'America/Los_Angeles',
  'san jose': 'America/Los_Angeles',
  oakland: 'America/Los_Angeles',
  fresno: 'America/Los_Angeles',
  reno: 'America/Los_Angeles',
  // Alaska & Hawaii
  anchorage: 'America/Anchorage',
  fairbanks: 'America/Anchorage',
  juneau: 'America/Anchorage',
  honolulu: 'Pacific/Honolulu',
};

export const STATE_TIMEZONE_MAP: Record<string, string> = {
  // Eastern
  CT: 'America/New_York',
  DE: 'America/New_York',
  FL: 'America/New_York',
  GA: 'America/New_York',
  MA: 'America/New_York',
  MD: 'America/New_York',
  ME: 'America/New_York',
  MI: 'America/New_York',
  NC: 'America/New_York',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NY: 'America/New_York',
  OH: 'America/New_York',
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  VA: 'America/New_York',
  VT: 'America/New_York',
  WV: 'America/New_York',
  // Central
  AL: 'America/Chicago',
  AR: 'America/Chicago',
  IA: 'America/Chicago',
  IL: 'America/Chicago',
  KS: 'America/Chicago',
  KY: 'America/New_York',
  LA: 'America/Chicago',
  MN: 'America/Chicago',
  MO: 'America/Chicago',
  MS: 'America/Chicago',
  OK: 'America/Chicago',
  TN: 'America/Chicago',
  TX: 'America/Chicago',
  WI: 'America/Chicago',
  // Mountain
  CO: 'America/Denver',
  ID: 'America/Denver',
  MT: 'America/Denver',
  NM: 'America/Denver',
  UT: 'America/Denver',
  WY: 'America/Denver',
  // Mountain (no DST)
  AZ: 'America/Phoenix',
  // Pacific
  CA: 'America/Los_Angeles',
  NV: 'America/Los_Angeles',
  OR: 'America/Los_Angeles',
  WA: 'America/Los_Angeles',
  // Other
  AK: 'America/Anchorage',
  HI: 'Pacific/Honolulu',
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

// Demo / marketing phone number (Thinking Hammer / platform demo line).
// This is the real owned + routed Telnyx DID that reaches the agent.
// NOTE: 630-866-9086 was a long-standing documentation error (never owned —
// it belongs to another business). The live line is 630-822-9086.
export const DEMO_PHONE_NUMBER = '630-822-9086';
export const DEMO_PHONE_E164 = '+16308229086';
export const DEMO_PHONE_DISPLAY = '(630) 822-9086';
