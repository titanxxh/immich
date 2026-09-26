import { TripController } from 'src/controllers/trip.controller';
import { TripService } from 'src/services/trip.service';
import request from 'supertest';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils';

describe(TripController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(TripService);

  beforeAll(async () => {
    ctx = await controllerSetup(TripController, [{ provide: TripService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('POST /trips/preview', () => {
    it('should preview trips', async () => {
      service.preview.mockResolvedValue([]);
      const home = { name: 'Home', latitude: 30, longitude: 120, radiusKm: 50, from: '2020-01-01', to: null };

      const { status } = await request(ctx.getHttpServer())
        .post('/trips/preview')
        .send({ homes: [home], minAssets: 10, includeDayTrips: false });

      expect(status).toBe(200);
      expect(service.preview).toHaveBeenCalled();
    });

    it('should reject an invalid home', async () => {
      const home = { name: 'Home', latitude: 91, longitude: 120, radiusKm: 0, from: 'yesterday' };

      const { status } = await request(ctx.getHttpServer())
        .post('/trips/preview')
        .send({ homes: [home], minAssets: 10, includeDayTrips: false });

      expect(status).toBe(400);
      expect(service.preview).not.toHaveBeenCalled();
    });
  });

  describe('POST /trips/detect', () => {
    it('should queue trip detection', async () => {
      const { status } = await request(ctx.getHttpServer()).post('/trips/detect');

      expect(status).toBe(204);
      expect(service.detect).toHaveBeenCalled();
    });
  });
});
