import { Kysely } from 'kysely';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MapRepository } from 'src/repositories/map.repository';
import { DB } from 'src/schema/index';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let database: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(MapRepository) };
};

// Everest base camp on the Tibetan side. The nearest populated place by straight-line distance is
// Lobuche in Nepal, ~22km away on the far side of the Himalayan crest; the nearest place in China is
// ~56km away and therefore outside the 25km search radius.
const everestBaseCamp = { latitude: 28.147, longitude: 86.855 };
const lobuche = { latitude: 27.94967, longitude: 86.81 };

// A polygon covering the query point, standing in for the Natural Earth boundary of China.
const chinaBoundary = '((80,27.9),(80,40),(120,40),(120,27.9))';

const addPlace = async (place: { name: string; countryCode: string; admin1Name: string } & typeof everestBaseCamp) =>
  database
    .insertInto('geodata_places')
    .values({
      id: Math.floor(Math.random() * 1_000_000_000),
      name: place.name,
      countryCode: place.countryCode,
      admin1Name: place.admin1Name,
      latitude: place.latitude,
      longitude: place.longitude,
      modificationDate: new Date().toISOString(),
    })
    .execute();

const addBoundary = async (admin_a3: string, coordinates: string) =>
  database
    .insertInto('naturalearth_countries')
    .values({ admin: admin_a3, admin_a3, type: 'Country', coordinates })
    .execute();

beforeAll(async () => {
  database = await getKyselyDB();
});

beforeEach(async () => {
  await database.deleteFrom('geodata_places').execute();
  await database.deleteFrom('naturalearth_countries').execute();
});

describe(MapRepository.name, () => {
  describe('reverseGeocode', () => {
    it('should return the nearest place when it is in the same country as the point', async () => {
      const { sut } = setup();
      await addPlace({ ...everestBaseCamp, name: 'Zuobude', countryCode: 'CN', admin1Name: 'Tibet' });
      await addBoundary('CHN', chinaBoundary);

      await expect(sut.reverseGeocode(everestBaseCamp)).resolves.toEqual({
        country: "People's Republic of China",
        state: 'Tibet',
        city: 'Zuobude',
      });
    });

    it('should discard the nearest place when it is across a national border', async () => {
      const { sut } = setup();
      await addPlace({ ...lobuche, name: 'Lobuche', countryCode: 'NP', admin1Name: 'Koshi' });
      await addBoundary('CHN', chinaBoundary);

      // Lobuche is the only place inside the search radius, but the point is inside the Chinese
      // boundary, so the country must come from the boundary and no city may be reported.
      await expect(sut.reverseGeocode(everestBaseCamp)).resolves.toEqual({
        country: "People's Republic of China",
        state: null,
        city: null,
      });
    });

    it('should keep the nearest place when the point is outside every country boundary', async () => {
      const { sut } = setup();
      await addPlace({ ...lobuche, name: 'Lobuche', countryCode: 'NP', admin1Name: 'Koshi' });

      // With no boundary to check against there is nothing to contradict the nearest place.
      await expect(sut.reverseGeocode(everestBaseCamp)).resolves.toEqual({
        country: 'Nepal',
        state: 'Koshi',
        city: 'Lobuche',
      });
    });

    it('should fall back to the country boundary when no place is within range', async () => {
      const { sut } = setup();
      await addBoundary('CHN', chinaBoundary);

      await expect(sut.reverseGeocode(everestBaseCamp)).resolves.toEqual({
        country: "People's Republic of China",
        state: null,
        city: null,
      });
    });

    it('should return nothing when there is neither a place nor a boundary', async () => {
      const { sut } = setup();

      await expect(sut.reverseGeocode(everestBaseCamp)).resolves.toEqual({
        country: null,
        state: null,
        city: null,
      });
    });
  });
});
