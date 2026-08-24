"""
Meter profile loader — JSON configs under parser/profiles/.

Adding a new meter = drop a new JSON file. No Python changes required.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

PROFILES_DIR = Path(__file__).resolve().parent / "profiles"

# meter_type → default profile id
METER_TYPE_DEFAULTS: dict[str, str] = {
    "ph": "hanna_hi98194",  # multiparam LCD is the primary pH device in this project
    "tds": "generic_tds",
    "ec": "generic_ec",
    "orp": "generic_orp",
    "do": "generic_do",
    "multiparam": "hanna_hi98194",
    "chlorine": "hach_dr300",
    "turbidity": "hach_2100q",
}


@dataclass(frozen=True)
class FieldConfig:
    key: str
    aliases: tuple[str, ...]
    exclude_aliases: tuple[str, ...] = ()
    range: tuple[float, float] | None = None
    required: bool = False
    row_hint: int | None = None


@dataclass(frozen=True)
class MeterProfile:
    id: str
    name: str = ""
    match_hints: tuple[str, ...] = ()
    ignore_tokens: tuple[str, ...] = ()
    y_threshold_ratio: float = 0.55
    fields: tuple[FieldConfig, ...] = ()
    primary_field: str | None = None

    def field_map(self) -> dict[str, FieldConfig]:
        return {f.key: f for f in self.fields}

    def aliases_map(self) -> dict[str, list[str]]:
        return {f.key: list(f.aliases) for f in self.fields}


def _parse_field(key: str, raw: dict[str, Any]) -> FieldConfig:
    rng = raw.get("range")
    range_tuple: tuple[float, float] | None = None
    if isinstance(rng, (list, tuple)) and len(rng) >= 2:
        range_tuple = (float(rng[0]), float(rng[1]))
    aliases = tuple(str(a) for a in (raw.get("aliases") or []))
    exclude = tuple(str(a) for a in (raw.get("exclude_aliases") or []))
    row_hint = raw.get("row_hint")
    return FieldConfig(
        key=key,
        aliases=aliases or (key,),
        exclude_aliases=exclude,
        range=range_tuple,
        required=bool(raw.get("required", False)),
        row_hint=int(row_hint) if row_hint is not None else None,
    )


def _parse_profile(raw: dict[str, Any]) -> MeterProfile:
    fields_raw = raw.get("fields") or {}
    fields = tuple(_parse_field(k, v) for k, v in fields_raw.items() if isinstance(v, dict))
    hints = raw.get("match_hints") or {}
    text_any = hints.get("text_any") if isinstance(hints, dict) else []
    row_grouping = raw.get("row_grouping") or {}
    ratio = float(row_grouping.get("y_threshold_ratio", 0.55)) if isinstance(row_grouping, dict) else 0.55
    return MeterProfile(
        id=str(raw.get("id") or "unknown"),
        name=str(raw.get("name") or ""),
        match_hints=tuple(str(x) for x in (text_any or [])),
        ignore_tokens=tuple(str(x) for x in (raw.get("ignore_tokens") or [])),
        y_threshold_ratio=ratio,
        fields=fields,
        primary_field=raw.get("primary_field"),
    )


@lru_cache(maxsize=1)
def load_all_profiles() -> dict[str, MeterProfile]:
    profiles: dict[str, MeterProfile] = {}
    if not PROFILES_DIR.is_dir():
        return profiles
    for path in sorted(PROFILES_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        profile = _parse_profile(data)
        profiles[profile.id] = profile
    return profiles


def get_profile(
    *,
    profile_id: str | None = None,
    meter_type: str | None = None,
    texts: list[str] | None = None,
) -> MeterProfile:
    """
    Resolve profile:
      1. explicit profile_id
      2. match_hints against OCR texts, restricted to profiles compatible
         with the requested meter_type when that's known (see below)
      3. meter_type default mapping
      4. generic_ph fallback

    meter_type='multi' (or any value that is not a field key any profile
    declares) is treated as "device unknown, decide from the photo" — it
    intentionally never appears in METER_TYPE_DEFAULTS, so step 3 is a
    no-op for it and resolution rests entirely on step 2's unrestricted
    match_hints scan across every profile. Used by capture flows (e.g. the
    multi-device "Meter Readings" session) where a single task photographs
    several different physical meters and the client cannot know in advance
    which device is in any given shot.
    """
    profiles = load_all_profiles()

    if profile_id and profile_id in profiles:
        return profiles[profile_id]

    kind = (meter_type or "").lower()

    # Auto-detect from OCR text hints — restricted to profiles compatible
    # with the requested meter_type (i.e. profiles that declare a field with
    # that exact key) whenever we have compatibility information for it.
    # Proven necessary by a real cross-contamination bug: a HACH 2100Q
    # turbidity photo's "HACH" text was matching hach_dr300 (a chlorine
    # profile) purely because both are HACH-brand devices, silently
    # mis-binding turbidity=0.41 as chlorine=0.41 even under meter_type='ph'.
    # Only restricts when `kind` is a field key declared by at least one
    # profile — an unrecognized/empty meter_type falls back to the original
    # unrestricted matching so this never narrows behavior we have no
    # compatibility information for.
    joined = " ".join(texts or []).lower()
    if joined:
        known_kind = bool(kind) and any(kind in profile.field_map() for profile in profiles.values())
        for profile in profiles.values():
            if known_kind and kind not in profile.field_map():
                continue
            for hint in profile.match_hints:
                if hint.lower() in joined:
                    return profile

    default_id = METER_TYPE_DEFAULTS.get(kind)
    if default_id and default_id in profiles:
        return profiles[default_id]

    # Last resort — reached whenever hint matching finds nothing (e.g. a
    # multi-device photo whose brand/model text was cropped out or missed by
    # OCR) and there's no meter_type default to fall back to. hanna_hi98194
    # goes first: it's the richest profile (9 fields vs generic_ph's 2), so a
    # misidentified device still has a chance to bind its reading instead of
    # being silently reduced to ph/mv only. Matches the safety net every
    # meter_type='ph' request already had before 'multi' existed, since
    # METER_TYPE_DEFAULTS['ph'] also resolves to hanna_hi98194.
    for fallback in ("hanna_hi98194", "generic_tds", "generic_ph"):
        if fallback in profiles:
            return profiles[fallback]

    # Empty profile — binder will return nothing
    return MeterProfile(id="empty", fields=())
