# Immich (titanxxh fork)

A self-hosted photo library. This glossary covers the fork's own additions on top of upstream Immich.

## Trips

**Home**:
A place the user lives, configured in their settings as a point, a radius and optionally the days it applies to. A user can have several.
_Avoid_: Base, residence

**Trip**:
A stretch of photos taken away from every home, not interrupted by 12 hours at home or by a gap longer than 36 hours, with at least the minimum number of located photos.
_Avoid_: Journey, vacation, event

**Day trip**:
A trip whose photos all fall on a single calendar day. It only gets an album when the user asks for day trips.
_Avoid_: Excursion, outing

**Trip album**:
The ordinary album created for a trip. The user can rename or edit it freely; deleting it dismisses the trip.
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
An area on the footprint map: a prefecture-level city in mainland China, or an area of the same scale abroad. It comes from a fixed set of boundaries, not from the place names written on each photo.
_Avoid_: Place, city (the photo's city field is a town or district in China)

**Visited region**:
A region where at least one camera photo was taken, unless the user hid it. The regions around a home count too.
_Avoid_: Lit region, check-in

**First visit**:
The date of the earliest camera photo taken in a visited region.
_Avoid_: First trip

**Hidden region**:
A region the user removed from the footprint map because its photos were placed there by mistake. Its photos keep their locations.
_Avoid_: Ignored region, deleted region
