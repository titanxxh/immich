// Mainland China maps (such as Amap) use GCJ-02, a deliberately offset version of the WGS-84 coordinates that GPS and
// photos use. The offset is a few hundred metres and only applies inside China.

const A = 6_378_245;
const EE = 0.006693421622965943;

export type LatLng = { latitude: number; longitude: number };

/** A rough bounding box of mainland China, outside which GCJ-02 equals WGS-84. */
export const isInChina = ({ latitude, longitude }: LatLng) =>
  longitude >= 72.004 && longitude <= 137.8347 && latitude >= 0.8293 && latitude <= 55.8271;

const transformLatitude = (x: number, y: number) => {
  let result = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  result += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  result += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  result += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return result;
};

const transformLongitude = (x: number, y: number) => {
  let result = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  result += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  result += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  result += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return result;
};

export const wgs84ToGcj02 = (point: LatLng): LatLng => {
  if (!isInChina(point)) {
    return point;
  }

  const { latitude, longitude } = point;
  const radians = (latitude / 180) * Math.PI;
  const magic = 1 - EE * Math.sin(radians) ** 2;
  const sqrtMagic = Math.sqrt(magic);
  const dLatitude =
    (transformLatitude(longitude - 105, latitude - 35) * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
  const dLongitude =
    (transformLongitude(longitude - 105, latitude - 35) * 180) / ((A / sqrtMagic) * Math.cos(radians) * Math.PI);
  return { latitude: latitude + dLatitude, longitude: longitude + dLongitude };
};

/** Inverts the offset by iteration, which is accurate to well under a metre. */
export const gcj02ToWgs84 = (point: LatLng): LatLng => {
  if (!isInChina(point)) {
    return point;
  }

  let guess = point;
  for (let index = 0; index < 10; index++) {
    const offset = wgs84ToGcj02(guess);
    const dLatitude = offset.latitude - point.latitude;
    const dLongitude = offset.longitude - point.longitude;
    guess = { latitude: guess.latitude - dLatitude, longitude: guess.longitude - dLongitude };
    if (Math.abs(dLatitude) < 1e-9 && Math.abs(dLongitude) < 1e-9) {
      break;
    }
  }
  return guess;
};
