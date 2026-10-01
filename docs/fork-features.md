# Fork features

What this fork (titanxxh/immich, branch `release/v3.2`) adds on top of upstream Immich. The base is the upstream tag `v3.2.4`; see the diff with `git diff v3.2.4..fork/release/v3.2`.

Terms in _italics_ are defined in the root `CONTEXT.md`.

## Trips

Detects _trips_ away from every _home_ and turns each into an ordinary album (the _trip album_).

- **Settings** (user settings → Trips): homes as point + radius + optional date range, minimum located photos, whether _day trips_ get an album, and a live preview of the trips that would be found. Stored in user preferences (`trips`).
- **Detection**: the `TripDetection` job, run nightly when the admin setting `nightlyTasks.detectTrips` is on, or on demand. New trips get albums; auto trips keep their albums up to date. Deleting a trip album makes it a _dismissed trip_.
- **Album dates follow the album**: photos added to a trip album within a week of it widen the trip's dates; removing photos never narrows them.
- **Concurrent trips**: two groups far apart at the same time (see _concurrent trips_) split a new stretch into one trip per group. Existing trips are never split; the trip panel can merge trips at the same time.
- **Manual trips**: any album can be marked as a trip (and unmarked); detection leaves manual trips alone.
- **Trip view**: the `/trips` page (map and timeline of all trips); on a trip album, a side panel with days, stops and the route, and day titles in the timeline.
- **Code**: `server/src/utils/trip.ts` (detection rules), `server/src/services/trip.service.ts`, `trip.controller.ts` (`/trips`), table `trip`; web `routes/(user)/trips`, `components/album-page/trip`, `user-settings/TripSettings.svelte`.

## Locating photos

The Locate utility (Utilities → Locate) gives a location to _photos to locate_.

- Groups them into _location groups_ by time, plus one list of _scattered photos_; suggests a location from located photos in the same folders or nearby in time; photos can be ignored.
- Larger previews, three thumbnail sizes, shift-click to select a run of photos.
- Lists photos with a _suspect location_ found by trip detection; the user fixes them or confirms they are right. Giving a photo a new location clears its suspect flag.
- **Place search** also queries Amap (venues, landmarks, roads) when the `AMAP_WEB_KEY` environment variable is set, biased towards home. A town named exactly as searched comes first, and GeoNames towns are shown with their Chinese names when available.
- **Code**: `server/src/utils/locate.ts`, `locate.service.ts`, `locate.controller.ts` (`/locate`), `amap.repository.ts`, `search.service.ts` (`searchPlaces`); web `routes/(user)/utilities/locate`.

## Picking from bursts

The Bursts utility (Utilities → Bursts) walks through _bursts_ (duplicate groups), largest first, and suggests the _recommended photo_ by _sharpness_.

- Sharpness is computed from the preview on demand and stored on `asset_job_status.sharpness`. Adding a column to `asset_job_status` means updating the conflict branch of its upsert too.
- **Code**: `server/src/utils/burst.ts`, `burst.service.ts`, `burst.controller.ts` (`/bursts`), `duplicate.repository.ts`; web `routes/(user)/utilities/bursts`.

## Footprints

A map of every _visited region_, with _first visits_, a replayable timeline, a yearly chart of new regions and a drawer per region. Regions can be hidden (_hidden region_), and the timeline can be filtered to one region (`regionId` on time buckets).

- On startup the microservices worker imports the boundaries into table `region` when their version changed (footprints are disabled without the files). The `FootprintAssign` job then fills `asset_region`; it also runs after metadata extraction and nightly, and is cheap when nothing changed.
- **Boundary data** is built by `misc/footprint-regions/extract.py` (see its README and NOTICE) and kept on the build machine only, never committed or published. The server image takes it with `docker build --build-context footprints=<folder> ...`.
- **Code**: `server/src/utils/footprint.ts`, `footprint.service.ts`, `footprint.controller.ts` (`/footprints`), `footprint.repository.ts`; web `routes/(user)/footprints`.

## Smaller fixes

- **Faces before birth**: setting a person's birth date releases their machine-learning faces on photos taken before it and re-queues them for facial recognition, so look-alike siblings separate. Manually tagged faces stay. The birth-date check uses the photo's local date.
- **Date source**: metadata extraction records on `asset_job_status.dateFromExif` whether a photo's capture date comes from its metadata (or sidecar) or fell back on the file times. `MetadataService.backfillDateSources` fills it in on demand for photos extracted earlier, reading only the date tags.
- **Cross-border reverse geocoding**: a nearest place in a different country than the country polygon containing the point is discarded in favour of the country result.

## Fork tooling

- `AGENTS.md`, `CONTEXT.md`, `docs/agents/`: agent skill configuration and the domain glossary.
- All new strings are in `i18n/en.json` and `i18n/zh_Hans.json`.
