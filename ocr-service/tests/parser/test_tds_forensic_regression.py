"""
TDS forensic remediation regression suite.

Real evidence: PP-OCRv6_small_det/rec run against
ocr/test_images/line_oa_chat_260720_084708_original.jpg (HANNA HI98194
multiparam device, EC/DO mode) — 23 detections captured live, embedded
below verbatim.

Product contract findings (see the forensic report this suite backs):
  - REAL_084708_DETECTIONS below (the HANNA HI98194's EC/DO display mode)
    shows no literal "TDS"/"ppm" reading — confirmed again by
    test_real_hanna_photo_has_no_literal_tds_reading below.
  - UPDATE (multi-device OCR routing fix, see test_multi_device_routing.py):
    a later forensic pass, given real photos the reporter captured of a
    DIFFERENT HANNA HI98194 screen mode (TDS/salinity/temperature), proved
    this device DOES show a literal "ppmTds" reading on that other screen —
    the "no literal TDS on this device" claim above held only for the
    EC/DO screen this fixture happens to capture, not for the device as a
    whole. hanna_hi98194.json now declares a "tds" field (label-only, no
    row_hint) so that screen's literal reading can bind. For THIS fixture
    specifically (which genuinely has no TDS text), that field simply has
    nothing to bind to — ec/do results are unchanged (see below).
  - EC-derived TDS (EC x 0.5, ConversionEngine.convertEcToTds, client-side
    only) remains the correct fallback specifically for photos of the
    EC/DO screen where no literal TDS is shown — unchanged by the above.

TDS-001 UPDATE (fixed as a side effect of the Turbidity forensic pass —
see test_profile_routing_forensic.py, further updated by the multi-device
routing fix above): get_profile() previously checked match_hints (OCR
text) before the meter_type default, so an explicit meter_type='tds' was
silently overridden by whatever device the text hints matched. The
routing fix required for Turbidity (a P0 cross-contamination bug — a HACH
2100Q turbidity photo's "HACH" text was mis-binding as chlorine)
restricts match_hints to profiles compatible with the requested
meter_type. hanna_hi98194.json now declares a 'tds' field (added by the
multi-device routing fix), so for THIS real photo, meter_type='tds' now
correctly identifies it as the specific real device (hanna_hi98194) it
actually is, rather than falling through to the generic_tds.json
fallback that was reachable only because hanna_hi98194 used to have no
'tds' field to be compatible with. Proven below — profile identity
changed, but the photo still yields no tds value (still no TDS text on
this specific screen), so test_generic_tds_profile_reachable_... (which
forces profile_id='generic_tds' explicitly) is unaffected.
"""

from __future__ import annotations

import unittest

from parser.profile_loader import get_profile
from parser.spatial_parser import SpatialMeasurementParser

# Real detections captured live from PP-OCRv6_small_det/rec against
# ocr/test_images/line_oa_chat_260720_084708_original.jpg (resized to
# max_side=1024, matching the real pipeline's preprocess step).
REAL_084708_DETECTIONS = [
    {'text': 'HANNA', 'score': 0.9998092651367188, 'box': [237.0, 45.0, 415.0, 97.0]},
    {'text': '6.67', 'score': 0.9938479065895081, 'box': [252.0, 159.0, 336.0, 194.0]},
    {'text': 'FFmDO', 'score': 0.7813734412193298, 'box': [329.0, 158.0, 406.0, 191.0]},
    {'text': '319', 'score': 0.999893844127655, 'box': [255.0, 190.0, 328.0, 227.0]},
    {'text': 'μSem', 'score': 0.8655194640159607, 'box': [334.0, 193.0, 397.0, 221.0]},
    {'text': '329', 'score': 0.9995679259300232, 'box': [254.0, 219.0, 328.0, 260.0]},
    {'text': 'uSem', 'score': 0.8088040947914124, 'box': [332.0, 224.0, 401.0, 252.0]},
    {'text': '031', 'score': 0.9990200996398926, 'box': [243.0, 254.0, 325.0, 290.0]},
    {'text': 'MΩ.cm', 'score': 0.874415397644043, 'box': [327.0, 256.0, 399.0, 284.0]},
    {'text': 'HI98194', 'score': 0.9866820573806763, 'box': [129.0, 325.0, 230.0, 352.0]},
    {'text': 'pH/EC/DO Multiparameter', 'score': 0.9979845285415649, 'box': [124.0, 351.0, 384.0, 382.0]},
    {'text': 'ESC', 'score': 0.999923050403595, 'box': [393.0, 506.0, 440.0, 534.0]},
    {'text': 'HELP', 'score': 0.999967098236084, 'box': [380.0, 572.0, 442.0, 603.0]},
]


class TestTdsRealEvidence(unittest.TestCase):
    def test_real_hanna_photo_has_no_literal_tds_reading(self) -> None:
        """Proves Possibility A (direct TDS OCR) is unproven for this real
        photo: parsing it against hanna_hi98194 (the profile the real client
        call actually resolves to) yields ec/do, never tds — because there
        is no "TDS"/"ppm" text anywhere in the real detections."""
        payload = SpatialMeasurementParser().parse_detections(
            REAL_084708_DETECTIONS, meter_type="ph"
        )
        self.assertEqual(payload.profile, "hanna_hi98194")
        self.assertEqual(payload.data.get("ec"), 319.0)
        self.assertNotIn("tds", payload.data)

    def test_tds_001_explicit_meter_type_now_reaches_the_real_device_profile(self) -> None:
        """TDS-001, updated by the multi-device routing fix (see module
        docstring): hanna_hi98194.json now declares a 'tds' field (that
        device does show literal TDS -- just not on this particular
        EC/DO-mode screen), so it is once again an eligible match_hints
        candidate for meter_type='tds', and correctly wins over the
        generic fallback for this real HANNA photo -- identifying the
        actual device instead of falling through to a generic profile.
        The photo itself still yields no tds value (no TDS text on this
        screen) -- see test_real_hanna_photo_has_no_literal_tds_reading."""
        texts = [d["text"] for d in REAL_084708_DETECTIONS]
        profile = get_profile(meter_type="tds", texts=texts)
        self.assertEqual(profile.id, "hanna_hi98194")

    def test_generic_tds_profile_reachable_but_still_produces_no_tds_for_this_device(self) -> None:
        """Even with the routing fix, generic_tds.json produces no tds value
        from this real photo (Phase 2, Case TDS-C) — confirms the remaining
        gap is evidence-missing (no literal TDS display on this device),
        not a routing bug."""
        payload = SpatialMeasurementParser().parse_detections(
            REAL_084708_DETECTIONS, meter_type="tds", profile_id="generic_tds"
        )
        self.assertEqual(payload.profile, "generic_tds")
        self.assertNotIn("tds", payload.data)
        self.assertIn("missing:tds", payload.issues)

    def test_tds_006_unit_mismatch_turbidity_never_binds_as_tds(self) -> None:
        """A turbidity reading ("0.41 NTU", the real HACH 2100Q evidence)
        parsed against every profile that could plausibly be auto-selected
        must never produce a tds key."""
        turbidity_detections = [
            {"text": "HACH", "score": 1.0, "box": [351.0, 211.0, 469.0, 244.0]},
            {"text": "2100Q", "score": 1.0, "box": [470.0, 298.0, 629.0, 347.0]},
            {"text": "Turbidity", "score": 1.0, "box": [355.0, 358.0, 463.0, 391.0]},
            {"text": "0.41", "score": 1.0, "box": [321.0, 387.0, 529.0, 483.0]},
            {"text": "NTU", "score": 1.0, "box": [539.0, 394.0, 604.0, 426.0]},
        ]
        for profile_id in ("generic_tds", "hach_dr300", "hanna_hi98194"):
            with self.subTest(profile_id=profile_id):
                payload = SpatialMeasurementParser().parse_detections(
                    turbidity_detections, meter_type="tds", profile_id=profile_id
                )
                self.assertNotIn("tds", payload.data)


if __name__ == "__main__":
    unittest.main()
