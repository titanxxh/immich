# Fork features

What this fork (titanxxh/immich, branch `release/v3.3`) adds on top of upstream Immich. The base is the upstream tag `v3.3.1`; see the diff with `git diff v3.3.1..fork/release/v3.3`.

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

## Reorganizing

Moves the photos of a folder of an external library, or of an album, into date folders, keeping each photo the same asset (a _reorganization_). Moving the files by hand would make the next library scan import them as new photos and lose their albums, faces and edits.

- **Preview**: where every photo would go for a target folder and one of three presets (`2026/09`, `2026-09-27`, `2026/2026-09-27`), with an optional label per day (`2026-09-27 match`); a day that already has a folder in the target joins it. Photos stay where they are, with the reason, when their name is taken (unless auto rename is on), when their date fell back on the file times (see _date source_), or when they are offline, trashed, uploaded or not the user's.
- The target must be inside an import path of one of the user's own libraries and not excluded by it, so that the next library scan finds the photos where they were put. Photos from another library of the same user join the library of the target.
- **Running**: one reorganization at a time, as the `Reorganize` background job. It pauses the library queue while it runs, so that scans only ever see a consistent database, and refuses to run while library watching is on (a watcher answers a file losing its name by deleting the asset at that path). A photo, its sidecar and the video of a live photo move together or not at all; a sidecar written after the reorganization was planned travels with its photo too.
- **Never overwrites**: a file gets its new name with a hard link, which fails when the name is taken (a rename would silently replace the file on sshfs). Between two file systems the file is copied to a hidden temporary file, compared with the original by size and hash, given its real name, and only then is the original removed.
- **Stopping**: a photo that fails is recorded and the run goes on; when the storage goes away the run pauses. It can be cancelled, and a run cut short by a restart is marked interrupted after the photo it was busy with is brought back in line with the database. None of these continue on their own: the user continues or undoes them. Continuing retries the photos that failed or whose place was taken. Sorting out a half-moved photo only removes a file whose content is still there under the photo's other name, and never a path that belongs to another asset.
- **Undo**: any past reorganization can be undone as a whole. A photo goes back only if it is still where the reorganization put it and its old place is free; undoing again retries the ones that were left. The _reorganization record_ (tables `reorganization`, `reorganization_item`) is kept until the user deletes it.
- **Album**: a reorganization can name an album; the photos that move are added to it as they arrive (photos already in their folder are not), and an undo takes out the ones it added. The preview offers the album the last reorganization into the same target used. A workflow cannot do this, because a moved photo is not a new asset and triggers none.
- **Limits**: one microservices worker is assumed (a second one starting up would mark a running reorganization as interrupted). Emptied subfolders are only removed for a folder source.
- **Deployment**: the external library folders must be mounted writable in the server container (upstream suggests read-only).
- **Page** (Utilities → Reorganize): settings on the left (source, target, structure, auto rename, libraries of an album source), the target's date folders after the reorganization on the right with a label field per day, the photos that stay grouped by reason, and each expandable into the photos concerned. A second tab lists past reorganizations with continue, retry, undo, details and delete. The folder view and the album menu link to the page with the source filled in.
- **Code**: `server/src/utils/reorganize.ts` (the plan), `reorganize.service.ts` (preview and API), `reorganize-job.service.ts` (moving files), `reorganize.controller.ts` (`/reorganizations`), `reorganize.repository.ts`; web `routes/(user)/utilities/reorganize`.

## Searching with Gemma

Smart search can compare with the embeddings of a second _search model_, EmbeddingGemma 2, to see on one's own library how it does next to the CLIP model of the machine learning settings. Everything else keeps using the CLIP model: duplicate detection, the mobile app, and a search that does not ask for Gemma.

- **Off by default**: it is on when the `IMMICH_GEMMA_URL` environment variable of the server points to the Gemma service and smart search is enabled; the server then reports the feature `smartSearchGemma`.
- **Gemma service** (`machine-learning-gemma/`, see its README): the model behind the protocol of Immich Machine Learning, in a container of its own, since the model has no ONNX release and the upstream service only runs ONNX. It needs a GPU to be of use.
- **Embeddings** are in table `smart_search_gemma` (768 dimensions, index `gemma_index`), next to `smart_search`. The `SmartSearchGemma` job fills it: for a new photo after its thumbnails, with the `SmartSearch` job; for the others, the smart search jobs "missing" and "all" of the admin jobs page queue both. The index is looked after with the other vector indexes.
- **Search**: `POST /search/smart` takes `searchModel` (`default` or `gemma`), for a text query and for the photos similar to one. It is named so because `model` is the camera model.
- **Page**: on the results of a smart search, two buttons choose the model. The choice is part of the search in the address, and a new search from the search bar keeps it.
- **Code**: `machine-learning-gemma/`; server `machine-learning.repository.ts`, `search.repository.ts` (`EMBEDDINGS`), `search.service.ts`, `smart-info.service.ts`, table `smart_search_gemma`; web `routes/(user)/search`, `search-manager.svelte.ts`.

## Smaller fixes

- **Faces before birth**: setting a person's birth date releases their machine-learning faces on photos taken before it and re-queues them for facial recognition, so look-alike siblings separate. Manually tagged faces stay. The birth-date check uses the photo's local date.
- **Date source**: metadata extraction records on `asset_job_status.dateFromExif` whether a photo's capture date comes from its metadata (or sidecar) or fell back on the file times. `MetadataService.backfillDateSources` fills it in on demand for photos extracted earlier, reading only the date tags; the reorganization preview calls it.
- **Keyframes beyond an integer**: metadata extraction skips a video's keyframe row (used for real-time HLS) when a value does not fit the integer columns, instead of failing the whole extraction. Surveillance cameras keep a running clock, so their timestamps start beyond 2^31 at a 90 kHz time base; before, such a video got no metadata at all, and editing its date silently did nothing.
- **Cross-border reverse geocoding**: a nearest place in a different country than the country polygon containing the point is discarded in favour of the country result.

## Following upstream

A release of upstream is merged in, not rebased onto, so that the fork's commits keep their ids.

- **Migrations out of order**: the fork's migrations and upstream's are written side by side, so a release of upstream brings migrations whose names sort before some that already ran here. `DatabaseRepository.createMigrator` allows that (`allowUnorderedMigrations`); upstream only does in development, and its server would refuse to start.
- **No way back without a backup**: a server refuses to start on a database with a migration it does not know, so an older image needs the database of before the upgrade.
- **`i18n-iso-countries`** stays a dependency of the server although upstream dropped it: trips name countries in Chinese with it, and reverse geocoding checks borders with it.
- **Faces before birth** only releases faces on the photos of the person's owner, since upstream's person sharing gives each user a birth date of their own for a shared person.

## Fork tooling

- `AGENTS.md`, `CONTEXT.md`, `docs/agents/`: agent skill configuration and the domain glossary.
- All new strings are in `i18n/en.json` and `i18n/zh_Hans.json`.
