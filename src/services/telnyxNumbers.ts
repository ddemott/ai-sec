/**
 * Telnyx Numbers API wrapper. Used by phone provisioning to allocate a
 * number for a tenant and route it to the LiveKit SIP Connection.
 *
 * Flow on activate:
 *   1. searchAvailable(area_code) — find a number in stock
 *   2. orderNumber(phone_number)  — purchase it (returns number_order)
 *   3. assignToConnection(phone_number_id, connection_id) — route to LiveKit
 *
 * Flow on deactivate:
 *   release(phone_number_id) — remove from account.
 *
 * Pure fetch, no SDK — matches the style of telnyxSms.ts so no new
 * dependency is introduced.
 */

const TELNYX_BASE_URL = 'https://api.telnyx.com/v2';

export interface AvailableNumber {
  phone_number: string;
  region_information?: Array<{ region_type: string; region_name: string }>;
}

export interface OrderedNumber {
  id: string;
  phone_number: string;
}

export interface PhoneNumberDetail {
  id: string;
  phone_number: string;
  connection_id: string | null;
  status: string;
}

export class TelnyxNumbersClient {
  constructor(private apiKey: string) {}

  private async fetch<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${TELNYX_BASE_URL}${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      throw new Error(`Telnyx ${method} ${endpoint} network error: ${msg}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Telnyx ${method} ${endpoint} failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<T>;
  }

  /**
   * Find a single available phone number, optionally filtered by area code.
   * Returns null if Telnyx has no inventory matching the filter.
   */
  async searchAvailable(areaCode?: string): Promise<AvailableNumber | null> {
    const params = new URLSearchParams({
      'filter[country_code]': 'US',
      'filter[features][]': 'voice',
      'filter[limit]': '1',
    });
    if (areaCode) {
      params.append('filter[national_destination_code]', areaCode);
    }

    const res = await this.fetch<{ data: AvailableNumber[] }>(
      'GET',
      `/available_phone_numbers?${params.toString()}`
    );
    return res.data?.[0] ?? null;
  }

  /**
   * Purchase a phone number. Telnyx returns a number_order that completes
   * synchronously for single-number requests on accounts with default
   * billing — orders return status="success" inline.
   */
  async orderNumber(phoneNumber: string): Promise<OrderedNumber> {
    const orderRes = await this.fetch<{
      data: {
        id: string;
        phone_numbers: Array<{ id: string; phone_number: string; status: string }>;
      };
    }>('POST', '/number_orders', {
      phone_numbers: [{ phone_number: phoneNumber }],
    });

    const purchased = orderRes.data.phone_numbers?.[0];
    if (!purchased) {
      throw new Error(`Telnyx number_order returned no phone_numbers for ${phoneNumber}`);
    }
    return { id: purchased.id, phone_number: purchased.phone_number };
  }

  /**
   * Resolve the canonical `/phone_numbers` resource id for a number.
   *
   * The id returned by `POST /number_orders` is an order-line id and is NOT
   * guaranteed to equal the phone_numbers resource id that `PATCH/DELETE
   * /phone_numbers/{id}` operate on. Assigning or releasing with the wrong id
   * silently no-ops (connection never set; number never released). Always
   * resolve the real id here before assign/verify/release.
   *
   * Returns null if Telnyx doesn't yet list the number (e.g. order still
   * settling), so the caller can poll/retry.
   */
  async findPhoneNumberIdByNumber(phoneNumber: string): Promise<string | null> {
    const params = new URLSearchParams({ 'filter[phone_number]': phoneNumber });
    const res = await this.fetch<{ data: Array<{ id: string }> }>(
      'GET',
      `/phone_numbers?${params.toString()}`
    );
    return res.data?.[0]?.id ?? null;
  }

  /**
   * Fetch a number's current detail, including the connection it is routed to.
   * Used to verify an assignment actually took before declaring a tenant active.
   */
  async getPhoneNumber(phoneNumberId: string): Promise<PhoneNumberDetail> {
    const res = await this.fetch<{
      data: { id: string; phone_number: string; connection_id: string | null; status: string };
    }>('GET', `/phone_numbers/${phoneNumberId}`);
    return res.data;
  }

  /**
   * Assign a purchased number to a SIP Connection so inbound calls route
   * to LiveKit (the LiveKit dispatch rule then routes to the agent worker).
   */
  async assignToConnection(phoneNumberId: string, connectionId: string): Promise<void> {
    await this.fetch('PATCH', `/phone_numbers/${phoneNumberId}`, {
      connection_id: connectionId,
    });
  }

  /**
   * Release a phone number from the account. Idempotent: a 404 means the
   * number is already gone, which the caller can treat as success.
   */
  async release(phoneNumberId: string): Promise<void> {
    await this.fetch('DELETE', `/phone_numbers/${phoneNumberId}`);
  }
}
