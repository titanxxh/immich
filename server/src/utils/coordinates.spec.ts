import { gcj02ToWgs84, isInChina, wgs84ToGcj02 } from 'src/utils/coordinates';
import { describe, expect, it } from 'vitest';

describe(wgs84ToGcj02.name, () => {
  it('should offset points in China by a few hundred metres', () => {
    const gcj = wgs84ToGcj02({ latitude: 31.2304, longitude: 121.4737 });
    expect(gcj.latitude).toBeCloseTo(31.2285, 3);
    expect(gcj.longitude).toBeCloseTo(121.4781, 3);
  });

  it('should leave points outside China alone', () => {
    expect(wgs84ToGcj02({ latitude: 48.8566, longitude: 2.3522 })).toEqual({ latitude: 48.8566, longitude: 2.3522 });
  });
});

describe(gcj02ToWgs84.name, () => {
  it('should undo the offset to well under a metre', () => {
    const wgs = { latitude: 31.2304, longitude: 121.4737 };
    const back = gcj02ToWgs84(wgs84ToGcj02(wgs));
    expect(back.latitude).toBeCloseTo(wgs.latitude, 6);
    expect(back.longitude).toBeCloseTo(wgs.longitude, 6);
  });

  it('should leave points outside China alone', () => {
    expect(gcj02ToWgs84({ latitude: 37.39, longitude: -5.99 })).toEqual({ latitude: 37.39, longitude: -5.99 });
  });
});

describe(isInChina.name, () => {
  it('should tell points in and outside China apart', () => {
    expect(isInChina({ latitude: 39.9, longitude: 116.4 })).toBe(true);
    expect(isInChina({ latitude: 40.7, longitude: -74 })).toBe(false);
  });
});
