import { FootprintController } from 'src/controllers/footprint.controller';
import { FootprintService } from 'src/services/footprint.service';
import request from 'supertest';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils';

describe(FootprintController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(FootprintService);

  beforeAll(async () => {
    ctx = await controllerSetup(FootprintController, [{ provide: FootprintService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('GET /footprints', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/footprints');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should list the regions', async () => {
      service.getAll.mockResolvedValue({ regions: [], pendingCount: 3 });

      const { status, body } = await request(ctx.getHttpServer()).get('/footprints');

      expect(status).toBe(200);
      expect(body).toEqual({ regions: [], pendingCount: 3 });
    });
  });

  describe('GET /footprints/shapes', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/footprints/shapes');
      expect(ctx.authenticate).toHaveBeenCalled();
    });
  });

  describe('GET /footprints/regions/:id', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/footprints/regions/abc');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should pass ids that are not uuids', async () => {
      service.getRegion.mockResolvedValue({} as never);

      await request(ctx.getHttpServer()).get('/footprints/regions/some-id:direct');

      expect(service.getRegion).toHaveBeenCalledWith(undefined, 'some-id:direct');
    });
  });
});
