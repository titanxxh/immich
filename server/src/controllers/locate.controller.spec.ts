import { LocateController } from 'src/controllers/locate.controller';
import { LocateService } from 'src/services/locate.service';
import request from 'supertest';
import { factory } from 'test/small.factory';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils';

describe(LocateController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(LocateService);

  beforeAll(async () => {
    ctx = await controllerSetup(LocateController, [{ provide: LocateService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('GET /locate/groups', () => {
    it('should list the groups', async () => {
      service.getGroups.mockResolvedValue({ groups: [], scattered: [] });
      const { status } = await request(ctx.getHttpServer()).get('/locate/groups');
      expect(status).toBe(200);
    });
  });

  describe('POST /locate/suggestion', () => {
    it('should require at least one photo', async () => {
      const { status } = await request(ctx.getHttpServer()).post('/locate/suggestion').send({ assetIds: [] });
      expect(status).toBe(400);
    });

    it('should suggest a location', async () => {
      service.getSuggestion.mockResolvedValue({ suggestion: null });
      const { status } = await request(ctx.getHttpServer())
        .post('/locate/suggestion')
        .send({ assetIds: [factory.uuid()] });
      expect(status).toBe(200);
    });
  });

  describe('POST /locate/ignore', () => {
    it('should require valid ids', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/locate/ignore')
        .send({ assetIds: ['invalid'] });
      expect(status).toBe(400);
    });

    it('should ignore photos', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/locate/ignore')
        .send({ assetIds: [factory.uuid()] });
      expect(status).toBe(204);
      expect(service.ignore).toHaveBeenCalled();
    });
  });

  describe('GET /locate/suspects', () => {
    it('should list suspect photos', async () => {
      const { status } = await request(ctx.getHttpServer()).get('/locate/suspects');
      expect(status).toBe(200);
      expect(service.getSuspects).toHaveBeenCalled();
    });
  });

  describe('POST /locate/suspects/confirm', () => {
    it('should require valid ids', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/locate/suspects/confirm')
        .send({ assetIds: ['invalid'] });
      expect(status).toBe(400);
    });

    it('should confirm photos', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/locate/suspects/confirm')
        .send({ assetIds: [factory.uuid()] });
      expect(status).toBe(204);
      expect(service.confirmSuspects).toHaveBeenCalled();
    });
  });
});
