# Footprint regions

The footprint map assigns every located photo to a region: a prefecture-level city in mainland
China, a province in Spain, France and Italy, and a first-level region elsewhere. The outlines
come from [Overture Maps divisions](https://docs.overturemaps.org/guides/divisions/) and ship in
the server image, like upstream Immich's reverse geocoding data, but from a local folder rather than a download.

`extract.py` builds the files:

| File                             | Contents                                                             |
| -------------------------------- | -------------------------------------------------------------------- |
| `footprint-regions.json.gz`      | every country, province and region: ids, names, a point inside       |
| `footprint-leaves.geojson.gz`    | outlines photos are assigned to (~100 m), each with its three ids    |
| `footprint-countries.geojson.gz` | country outlines (~500 m), for photos far from every region          |
| `footprint-display.geojson.gz`   | one simplified outline per region (~1 km), for colouring the map     |
| `footprint-version.txt`          | Overture release and script version; a new value re-assigns photos   |

## Updating

The files are not published anywhere: they stay on the machine that builds the server image
(`/home/xxh/immich-app/footprint-regions` here) and are passed to the build as a named context.

1. `pip install duckdb shapely numpy`, then
   `python extract.py <folder> --release <overture release>` (about five minutes, most of it
   downloading). Bump `SCRIPT_VERSION` instead when only the script changes.
2. Build the server image with the folder as the `footprints` context:
   `docker build -f server/Dockerfile --build-context footprints=<folder> ...`

The server imports the region list on startup when `footprint-version.txt` changes, and the
assignment job then finds the regions of every photo again.
