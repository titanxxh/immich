# Immich (titanxxh fork)

A self-hosted photo library. This glossary covers the fork's own additions on top of upstream Immich.

## Trips

**Home**:
A place the user lives, configured in their settings as a point, a radius and optionally the days it applies to. A user can have several.
_Avoid_: Base, residence

**Trip**:
A stretch of photos taken away from every home, not interrupted by 12 hours at home or by a gap longer than 36 hours, with at least the minimum number of located photos.
_Avoid_: Journey, vacation, event

**Concurrent trips**:
Trips at the same time by two groups apart, such as family members travelling separately. Two groups are apart when photos by two different devices are taken within 15 minutes of each other more than 30 km apart, in at least two different hours with at least three photos on each side; they met, and stay one trip, when their photos were ever taken within 3 hours and 30 km of each other. Detection gives each group of a new stretch its own trip; existing trips are never split.
_Avoid_: Parallel trips, overlapping trips

**Suspect location**:
A located photo that contradicts one taken at the same moment: either apart from the rest too briefly to split a trip, or placed with the other group. Trip detection flags it for the user to check on the Locate page, unless the user said it is placed right.
_Avoid_: Wrong location, bad GPS

**Day trip**:
A trip whose photos all fall on a single calendar day. It only gets an album when the user asks for day trips.
_Avoid_: Excursion, outing

**Trip album**:
The ordinary album created for a trip. The user can rename or edit it freely; deleting it dismisses the trip. Photos the user adds to it within a week of the trip widen the trip's dates, stepping from photo to photo; removing photos never narrows them.
_Avoid_: Smart album, auto album

**Dismissed trip**:
A trip whose album the user deleted. It keeps its time window so it is never detected again.
_Avoid_: Ignored trip, hidden trip

## Locating photos

**Photo to locate**:
A camera photo (one with a camera make) that has no location and has not been ignored.
_Avoid_: Unlocated photo, missing-GPS photo

**Location group**:
At least three photos to locate taken no more than three hours apart, which were most likely taken at the same place.
_Avoid_: Cluster, event

**Scattered photos**:
Photos to locate too few to form a location group; they are handled together in one list.
_Avoid_: Leftovers, singles

## Picking from bursts

**Burst**:
A duplicate group of at least two photos, most often shots taken seconds apart. The user keeps the best one (or a few) and trashes or stacks the rest.
_Avoid_: Duplicate (for the whole group), series

**Sharpness**:
A score of how sharp a photo is, computed from its preview. It only means something compared to the other photos of the same burst.
_Avoid_: Quality, focus score

**Recommended photo**:
The sharpest photo of a burst, kept unless the user picks another one.
_Avoid_: Best shot, suggested keeper

## Footprints

**Region**:
An area on the footprint map: a prefecture-level city in mainland China, or an area of the same scale abroad. Hong Kong and Macau are one region each; Taiwan's counties and cities are regions. It comes from a fixed set of boundaries, not from the place names written on each photo. The footprint page shows regions to users as "cities".
_Avoid_: Place, city (in code and docs, since the photo's city field is a town or district in China)

**Visited region**:
A region where at least one camera photo was taken, unless the user hid it. The regions around a home count too.
_Avoid_: Lit region, check-in

**First visit**:
The date of the earliest camera photo taken in a visited region.
_Avoid_: First trip

**Hidden region**:
A region the user removed from the footprint map because its photos were placed there by mistake. Its photos keep their locations.
_Avoid_: Ignored region, deleted region

## Reorganizing

**Reorganization**:
Moving the photos of one source (a folder of an external library, or an album) into date folders under a target folder, while each photo stays the same photo with its albums, people and edits. The user starts it once, after a preview; it is not a standing rule.
_Avoid_: Move, migration, archive (which already means hiding a photo from the timeline)

**Date folder**:
A folder a reorganization puts photos in, named after a month or a day. A day folder can carry a label after the date, such as `2026-09-27 match`; a day has one folder per reorganization.
_Avoid_: Day directory, bucket

**Date source**:
Where a photo's capture date comes from: the photo's own metadata (or its sidecar), or, when that has no date, the times of the file. A date that fell back on the file times is not trusted, and a reorganization leaves such a photo where it is.
_Avoid_: Date quality, reliable flag

**Reorganization record**:
What one reorganization did, photo by photo: where each was and where it went, or why it stayed. It is what an undo goes by, and it is kept until the user deletes it.
_Avoid_: Move history (an unrelated upstream table), log

**Undo** (of a reorganization):
Moving the photos of a reorganization back to where they were, all of them at once. A photo goes back only if it is still where the reorganization put it and its old place is free.
_Avoid_: Revert, rollback
