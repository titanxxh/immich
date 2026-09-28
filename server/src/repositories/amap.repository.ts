import { Injectable } from '@nestjs/common';
import { LoggingRepository } from 'src/repositories/logging.repository';

const BASE_URL = 'https://restapi.amap.com/v5/place';
const TIMEOUT_MS = 5000;

/** A point of interest as Amap returns it; `location` is "longitude,latitude" in GCJ-02. */
export type AmapPoi = { name: string; location: string; pname?: string; cityname?: string; adname?: string };

/** Searches places (venues, parks, roads...) with the Amap web service, if a key is configured. */
@Injectable()
export class AmapRepository {
  private key = process.env.AMAP_WEB_KEY;

  constructor(private logger: LoggingRepository) {
    this.logger.setContext(AmapRepository.name);
  }

  isEnabled() {
    return !!this.key;
  }

  /** Searches by keywords across the country. */
  searchText(keywords: string) {
    return this.request('text', { keywords, page_size: '10' });
  }

  /** Searches by keywords within `radius` metres of a GCJ-02 point. */
  searchAround(keywords: string, point: { latitude: number; longitude: number }, radius: number) {
    return this.request('around', {
      keywords,
      location: `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`,
      radius: String(radius),
      sortrule: 'weight',
      page_size: '10',
    });
  }

  private async request(path: string, params: Record<string, string>): Promise<AmapPoi[]> {
    if (!this.key) {
      return [];
    }

    try {
      const url = `${BASE_URL}/${path}?${new URLSearchParams({ ...params, key: this.key })}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = (await response.json()) as { status?: string; info?: string; pois?: AmapPoi[] };
      if (body.status !== '1') {
        this.logger.warn(`Amap place search failed: ${body.info}`);
        return [];
      }
      return body.pois ?? [];
    } catch (error) {
      this.logger.warn(`Amap place search failed: ${error}`);
      return [];
    }
  }
}
