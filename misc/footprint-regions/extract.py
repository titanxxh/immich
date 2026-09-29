#!/usr/bin/env python3
"""Build the footprint region files from Overture Maps divisions.

Run by hand when moving to a new Overture release, then publish the output as a GitHub
release of the fork (see README.md). Needs `pip install duckdb shapely numpy`.

Every photo location is assigned to a *leaf*: a polygon that knows its region, province
and country. Leaves are prefecture-level cities in mainland China, provinces in Spain,
France and Italy, and first-level regions everywhere else. Hong Kong and Macau are one
leaf each and, with Taiwan, count as provinces of China.

Counties (Overture's name for the prefecture/province level) only cover land, so the land
of a region that no county covers becomes a leaf of its own: a whole municipality such as
Shanghai, or the counties administered directly by a province such as Xiantao. Sea next to
a county is left uncovered on purpose; the server assigns it to the nearest leaf.
"""

import argparse
import gzip
import json
import math
import pickle
import time
import urllib.request
from pathlib import Path

import duckdb
import numpy as np
import shapely
from shapely import wkb

OVERTURE_RELEASE = '2026-09-23.1'
NATURAL_EARTH = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson'
# bump when the output changes for the same Overture release
SCRIPT_VERSION = 1

COUNTY_COUNTRIES = ('CN', 'ES', 'FR', 'IT')
# become provinces of China: the dependency (or country) is the province, and for Hong Kong
# and Macau also the only region
CHINA_PROVINCES = {'HK': 'dependency', 'MO': 'dependency', 'TW': 'country'}
ONE_REGION = ('HK', 'MO')

LEAF_TOLERANCE = 0.001  # ~100 m, used to assign photos
COUNTRY_TOLERANCE = 0.005  # only used for photos far out at sea
DISPLAY_TOLERANCE = 0.01  # map colouring in the browser
MIN_GAP_KM2 = 50  # smaller uncovered land is a mismatch between county and region outlines


def load(release: str):
    con = duckdb.connect()
    con.sql("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
    base = f's3://overturemaps-us-west-2/release/{release}/theme=divisions'
    county_countries = ', '.join(f"'{code}'" for code in COUNTY_COUNTRIES)
    con.sql(f"""
        CREATE TABLE area AS
        SELECT division_id, subtype, country, names.primary AS name,
                      coalesce(names.common['zh-Hans'], names.common['zh-CN'], names.common['zh']) AS zh,
                      is_land, is_territorial, ST_AsWKB(geometry) AS geometry
        FROM read_parquet('{base}/type=division_area/*', hive_partitioning = 1)
        WHERE subtype IN ('country', 'dependency', 'region')
              OR (subtype = 'county' AND country IN ({county_countries}))
    """)
    con.sql(f"""
        CREATE TABLE division AS
        SELECT id, wikidata, parent_division_id
        FROM read_parquet('{base}/type=division/*', hive_partitioning = 1)
        WHERE id IN (SELECT division_id FROM area)
    """)
    divisions = {row[0]: {'wikidata': row[1], 'parent': row[2]} for row in con.sql('SELECT * FROM division').fetchall()}
    areas = {}
    for division_id, subtype, country, name, zh, is_land, is_territorial, geometry in con.sql('SELECT * FROM area').fetchall():
        area = areas.setdefault(
            division_id,
            {'id': division_id, 'subtype': subtype, 'country': country, 'name': name, 'zh': zh, **divisions.get(division_id, {})},
        )
        geometry = shapely.make_valid(wkb.loads(bytes(geometry)))
        if is_land:
            area['land'] = geometry
        if is_territorial:
            area['territorial'] = geometry
    return list(areas.values())


def natural_earth_names():
    with urllib.request.urlopen(NATURAL_EARTH) as response:
        features = json.load(response)['features']
    return {f['properties']['wikidataid']: f['properties']['name_zh'] for f in features if f['properties'].get('name_zh')}


def area_km2(geometry):
    # good enough for a threshold: degrees² scaled at the centroid's latitude
    return geometry.area * 111.32**2 * math.cos(math.radians(geometry.centroid.y))


def build(areas, ne_names):
    countries = {a['country']: a for a in areas if a['subtype'] in ('country', 'dependency')}
    china = countries['CN']['id']

    regions = []  # metadata rows
    leaves = []  # (geometry, region, province, country)

    def row(area, level, country_id, province_id, name=None, zh=None, row_id=None):
        zh = zh or area.get('zh') or ne_names.get(area.get('wikidata'))
        regions.append(
            {
                'id': row_id or area['id'],
                'level': level,
                'countryId': country_id,
                'provinceId': province_id,
                'countryCode': 'CN' if area['country'] in CHINA_PROVINCES else area['country'],
                'name': name or area['name'],
                'nameZh': zh,
            }
        )
        return regions[-1]['id']

    def geometry(area, prefer='territorial'):
        return area.get(prefer) or area.get('land') or area.get('territorial')

    for code, area in countries.items():
        if code in CHINA_PROVINCES:
            continue
        row(area, 'country', area['id'], None)

    children = {}
    for area in areas:
        if area['subtype'] in ('region', 'county'):
            children.setdefault(area['parent'], []).append(area)

    for code, country in countries.items():
        if code in CHINA_PROVINCES:
            country_id = china
            province_id = row(country, 'province', china, None)
            if code in ONE_REGION:
                leaves.append((geometry(country), province_id, province_id, china))
                continue
            provinces = [(country, province_id)]
        else:
            country_id = country['id']
            provinces = [(area, row(area, 'province', country_id, None)) for area in children.get(country['id'], []) if area['subtype'] == 'region']
            if not provinces:
                # a country without regions is its own region
                leaves.append((geometry(country), country_id, None, country_id))
                continue

        for province, province_id in provinces:
            counties = [a for a in children.get(province['id'], []) if a['subtype'] == 'county']
            if code in CHINA_PROVINCES or code not in COUNTY_COUNTRIES:
                # the province is also the region, except for Taiwan whose regions sit below it
                if code == 'TW':
                    for region in children.get(province['id'], []):
                        if region['subtype'] == 'region':
                            leaves.append((geometry(region), row(region, 'region', china, province_id), province_id, china))
                else:
                    leaves.append((geometry(province), province_id, province_id, country_id))
                continue

            for county in counties:
                leaves.append((geometry(county, 'land'), row(county, 'region', country_id, province_id), province_id, country_id))

            land = province.get('land')
            if land is None:
                continue
            covered = shapely.union_all([geometry(c, 'land') for c in counties]) if counties else None
            gap = land.difference(covered) if covered is not None else land
            parts = [part for part in getattr(gap, 'geoms', [gap]) if not part.is_empty and area_km2(part) >= MIN_GAP_KM2]
            if not parts:
                continue
            gap = shapely.union_all(parts)
            if counties:
                # land a province administers directly, e.g. Xiantao in Hubei
                zh = (province.get('zh') or ne_names.get(province.get('wikidata')) or '') + '（省直辖）' if code == 'CN' else None
                region_id = row(province, 'region', country_id, province_id, name=f"{province['name']} (directly administered)", zh=zh or None, row_id=f"{province['id']}:direct")
                leaves.append((gap, region_id, province_id, country_id))
            else:
                # a municipality such as Shanghai: the province is also the region
                leaves.append((gap, province_id, province_id, country_id))

    country_layer = []
    for code, area in countries.items():
        province_id = area['id'] if code in CHINA_PROVINCES else None
        country_layer.append((geometry(area), china if code in CHINA_PROVINCES else area['id'], province_id))

    return regions, leaves, country_layer


def feature(geometry, properties, tolerance):
    simplified = shapely.simplify(geometry, tolerance, preserve_topology=True)
    return {'type': 'Feature', 'properties': properties, 'geometry': json.loads(shapely.to_geojson(shapely.transform(simplified, lambda xy: np.round(xy, 5))))}


def write(path: Path, features):
    with gzip.open(path, 'wt', encoding='utf-8') as file:
        json.dump({'type': 'FeatureCollection', 'features': features}, file, ensure_ascii=False, separators=(',', ':'))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('output', type=Path)
    parser.add_argument('--release', default=OVERTURE_RELEASE)
    parser.add_argument('--cache', type=Path, help='keep the downloaded divisions in this file between runs')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    start = time.time()
    if args.cache and args.cache.exists():
        areas = pickle.loads(args.cache.read_bytes())
    else:
        areas = load(args.release)
        if args.cache:
            args.cache.write_bytes(pickle.dumps(areas))
    print(f'loaded {len(areas)} divisions in {time.time() - start:.0f}s')
    regions, leaves, countries = build(areas, natural_earth_names())

    write(
        args.output / 'footprint-leaves.geojson.gz',
        [feature(g, {'regionId': r, 'provinceId': p, 'countryId': c}, LEAF_TOLERANCE) for g, r, p, c in leaves],
    )
    write(
        args.output / 'footprint-countries.geojson.gz',
        [feature(g, {'countryId': c, 'provinceId': p}, COUNTRY_TOLERANCE) for g, c, p in countries],
    )

    # one display shape per region: the union of its leaves, land only where Overture has it
    shapes = {}
    land = {area['id']: area.get('land') for area in areas}
    for geometry, region_id, _, _ in leaves:
        shapes.setdefault(region_id, []).append(land.get(region_id) or geometry)
    display = {region_id: shapely.union_all(parts) for region_id, parts in shapes.items()}
    write(
        args.output / 'footprint-display.geojson.gz',
        [feature(shape, {'id': region_id}, DISPLAY_TOLERANCE) for region_id, shape in display.items()],
    )

    # a point inside each region (and province, country) for the map to fly to
    by_id = {area['id']: area for area in areas}
    for region in regions:
        shape = display.get(region['id'])
        if shape is None:
            area = by_id[region['id']]
            shape = area.get('land') or area.get('territorial')
        point = shape.representative_point()
        region['center'] = [round(point.x, 5), round(point.y, 5)]

    with gzip.open(args.output / 'footprint-regions.json.gz', 'wt', encoding='utf-8') as file:
        json.dump(regions, file, ensure_ascii=False, separators=(',', ':'))

    (args.output / 'footprint-version.txt').write_text(f'overture-{args.release}+{SCRIPT_VERSION}\n')
    print(f'{len(regions)} regions, {len(leaves)} leaves, {len(countries)} countries in {time.time() - start:.0f}s')


if __name__ == '__main__':
    main()
