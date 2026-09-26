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
